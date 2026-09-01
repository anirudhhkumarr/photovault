import React, { useState, useEffect, useRef } from 'react';
import Header from './components/Header';
import PhotoGrid from './components/PhotoGrid';
import InspectorModal from './components/InspectorModal';
import ErrorBanner from './components/ErrorBanner';

import { createVaultPipeline } from './lib/VaultQueue';
import { connectDrive, getProfile, initAuth, disconnectDrive } from './lib/auth';
import { uploadContainer, syncFromDrive, downloadContainer, deleteContainerItem, fetchVaultMetadata } from './lib/driveSync';
import { getAllPhotos, getFileHash, addPhoto, exportContainerMetadata, clearDB, deletePhoto, addVideo, getVideo, deleteVideo, getAllVideos, initDB, deleteVaultSkeletons } from './lib/db';
import { encodeContainer, extractFrame } from './lib/videoEncoder';
import { analyzeVisualFeatures, isSameScene } from './lib/phash';

const defaultServices = {
  encoder: { encodeContainer, extractFrame },
  drive: { uploadContainer, syncFromDrive, downloadContainer, deleteContainerItem, fetchVaultMetadata },
  db: { getAllPhotos, getFileHash, addPhoto, exportContainerMetadata, clearDB, deletePhoto, addVideo, getVideo, deleteVideo, getAllVideos, initDB, deleteVaultSkeletons },
  phash: { analyzeVisualFeatures, isSameScene },
  image: { createImageBitmap: (f) => window.createImageBitmap(f) }
};

const services = window.__E2E_MOCKS__ 
  ? { ...defaultServices, ...window.__E2E_MOCKS__ } 
  : defaultServices;

const { vaultQueue, forceFlushCluster } = createVaultPipeline(services);

function App() {
  const [error, setError] = useState(null);
  const [profile, setProfile] = useState(null);
  const [photos, setPhotos] = useState([]);
  const [selectedPhoto, setSelectedPhoto] = useState(null);
  const [queueIdle, setQueueIdle] = useState(true);
  const [totalSavedBytes, setTotalSavedBytes] = useState(0);
  const [isSyncing, setIsSyncing] = useState(false);
  const [progressMsg, setProgressMsg] = useState('');
  const [uploadStats, setUploadStats] = useState({ active: false, completed: 0, total: 0 });
  const photoUpdatesQueue = useRef(new Map());
  const loadingVaultsRef = useRef(new Set());

  // Load photos from DB on mount
  const loadData = async () => {
    try {
      const storedPhotos = await services.db.getAllPhotos();
      if (storedPhotos && storedPhotos.length > 0) {
        // Sort by newest first
        storedPhotos.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
        setPhotos(storedPhotos);
        
        const allVideos = await services.db.initDB().then(db => db.getAll('videos'));
        
        // Calculate storage savings based on loaded photos vs an 85% compression assumption
        const loadedPhotos = storedPhotos.filter(p => !p.isSkeleton && p.originalSize);
        const originalBytes = loadedPhotos.reduce((acc, p) => acc + p.originalSize, 0);
        setTotalSavedBytes(originalBytes * 0.85);

        // Auto-retry stranded uploads
        if (allVideos.length > 0) {
          const activeTasks = Array.from(vaultQueue.tasks.values())
            .filter(t => t.type === 'UPLOAD_CONTAINER' && (t.status === 'PENDING' || t.status === 'RUNNING'));
          const activeContainerIds = new Set(activeTasks.map(t => t.payload.containerId));

          for (const video of allVideos) {
            if (!activeContainerIds.has(video.id)) {
              vaultQueue.enqueue('UPLOAD_CONTAINER', {
                containerId: video.id,
                blob: video.blob,
                manifest: video.manifest,
                photos: video.photos,
                originalTotalBytes: video.originalTotalBytes
              });
            }
          }
        }
      } else {
        setPhotos([]);
      }
    } catch (err) {
      console.error("Failed to load local DB", err);
    }
  };

  useEffect(() => {
    // ALWAYS load local data first, so the app is useful offline
    loadData();

    if (initAuth()) {
      setProfile(getProfile());
      setIsSyncing(true);
      services.drive.syncFromDrive(services.db.addPhoto, services.db.deletePhoto)
        .then(async () => await loadData())
        .catch(err => {
          console.error(err);
        })
        .finally(() => setIsSyncing(false));
    }
  }, []);

  // Batched UI updater to prevent React stuttering
  useEffect(() => {
    const timer = setInterval(() => {
      if (photoUpdatesQueue.current.size > 0) {
        setPhotos(prev => {
          const next = [...prev];
          let changed = false;
          photoUpdatesQueue.current.forEach((update, id) => {
            const idx = next.findIndex(p => p.id === id || p.skeletonId === id);
            if (idx !== -1) {
              next[idx] = { ...next[idx], ...update };
              changed = true;
            }
          });
          photoUpdatesQueue.current.clear();
          return changed ? next : prev;
        });
      }
    }, 150);
    return () => clearInterval(timer);
  }, []);

  // Hook up VaultQueue listeners to UI state
  useEffect(() => {
    const handleStarted = () => setQueueIdle(false);
    
    const handleIdle = (e) => {
      // ONLY force flush when the ANALYZE_PHOTO queue is specifically idle
      if (e.detail && e.detail.type === 'ANALYZE_PHOTO') {
        setQueueIdle(true);
        forceFlushCluster();
      }
    };
    
    const handleError = (e) => {
      setError(e.detail.error);
    };

    const handleTaskCompleted = (e) => {
      const task = e.detail;
      
      if (task.type === 'ANALYZE_PHOTO') {
        const photoData = task.result;
        if (photoData.isDuplicate) {
          // Immediately drop duplicates from the UI
          setPhotos(prev => prev.filter(p => p.skeletonId !== photoData.skeletonId));
          return;
        }
        photoUpdatesQueue.current.set(photoData.skeletonId, photoData);
      }
      
      if (task.type === 'UPLOAD_CONTAINER') {
        const { originalTotalBytes, photos } = task.result;
        setTotalSavedBytes(prev => prev + (originalTotalBytes * 0.85));
        
        setUploadStats(prev => {
          if (!prev.active) return prev;
          const newCompleted = prev.completed + (photos ? photos.length : 0);
          return {
            ...prev,
            completed: newCompleted,
            active: newCompleted < prev.total
          };
        });
        
        loadData(); // Reload photos to update syncStatus to 'synced'
      }
    };

    const handleProgress = (e) => {
      const { message, itemIds, state } = e.detail;
      if (message) setProgressMsg(message);
      if (itemIds && state) {
        itemIds.forEach(id => {
          if (state === 'duplicate') {
             setPhotos(prev => prev.filter(p => p.skeletonId !== id));
          } else {
             photoUpdatesQueue.current.set(id, { syncStatus: state });
          }
        });
      }
    };

    vaultQueue.addEventListener('task:started', handleStarted);
    vaultQueue.addEventListener('idle', handleIdle);
    vaultQueue.addEventListener('task:error', handleError);
    vaultQueue.addEventListener('task:completed', handleTaskCompleted);
    vaultQueue.addEventListener('vault:progress', handleProgress);

    return () => {
      vaultQueue.removeEventListener('task:started', handleStarted);
      vaultQueue.removeEventListener('idle', handleIdle);
      vaultQueue.removeEventListener('task:error', handleError);
      vaultQueue.removeEventListener('task:completed', handleTaskCompleted);
      vaultQueue.removeEventListener('vault:progress', handleProgress);
    };
  }, []);

  // Background polling removed in favor of manual sync

  const handleConnect = async () => {
    try {
      setError(null);
      await connectDrive();
      setProfile(getProfile());
      
      setIsSyncing(true);
      const count = await services.drive.syncFromDrive(
        services.db.addPhoto,
        services.db.deletePhoto,
        services.db.getAllPhotos
      );
      await loadData();
      setIsSyncing(false);
    } catch (err) {
      setError(err);
      setIsSyncing(false);
    }
  };

  const handleDisconnect = async () => {
    disconnectDrive();
    await clearDB();
    setProfile(null);
    setPhotos([]);
    setTotalSavedBytes(0);
  };

  const handleFilesAdded = async (files) => {
    try {
      if (!profile) {
        setError(new Error("Please connect to Google Drive first before uploading photos."));
        return;
      }

      // Filter out non-images and directories
      const imageFiles = files.filter(f => f.type && f.type.startsWith('image/'));
      
      if (imageFiles.length < files.length) {
        setError(new Error(`Skipped ${files.length - imageFiles.length} non-image files.`));
      }
      
      if (imageFiles.length === 0) return;
      
      setUploadStats(prev => ({
        active: true,
        completed: prev.active ? prev.completed : 0,
        total: (prev.active ? prev.total : 0) + imageFiles.length
      }));

      // 1. Create optimistic skeleton entries
      const newSkeletons = imageFiles.map((f, i) => {
        const skelId = `skel-${Date.now()}-${i}`;
        return {
          id: skelId,
          skeletonId: skelId,
          isSkeleton: true,
          file: f,
          originalName: f.name,
          createdAt: Date.now(),
          syncStatus: 'reading'
        };
      });
      
      setPhotos((prev) => [...newSkeletons, ...prev]);

      // 2. Dispatch to the actual background queue
      for (const skeleton of newSkeletons) {
        vaultQueue.enqueue('ANALYZE_PHOTO', { file: skeleton.file, skeletonId: skeleton.skeletonId });
      }
    } catch (err) {
      setError(err);
    }
  };

  const handleDownload = async (photo) => {
    try {
      let url;
      let ext = photo.mimeType.split('/')[1] || 'jpg';
      if (ext === 'jpeg') ext = 'jpg';
      let isBlobUrl = false;
      
      if (photo.file) {
        url = URL.createObjectURL(photo.file);
        isBlobUrl = true;
      } else {
        // Fetch container from Google Drive and extract frame
        const { blob, mimeType } = await services.drive.downloadContainer(photo.videoId);
        const dataUrl = await services.encoder.extractFrame(blob, photo.frameIndex, photo.mimeType);
        url = dataUrl;
      }
      
      const a = document.createElement('a');
      a.href = url;
      a.download = photo.filename || photo.originalName || `download.${ext}`;
      a.setAttribute('target', '_self');
      document.body.appendChild(a);
      
      const evt = new MouseEvent('click', {
        view: window,
        bubbles: true,
        cancelable: true
      });
      a.dispatchEvent(evt);
      
      const cleanup = () => {
        if (document.body.contains(a)) {
          document.body.removeChild(a);
        }
        if (isBlobUrl) {
          URL.revokeObjectURL(url);
        }
        window.removeEventListener('focus', cleanup);
      };
      
      window.addEventListener('focus', cleanup);
    } catch (err) {
      setError(err);
    }
  };

  const handleFetchFullRes = async (photo) => {
    try {
      const { blob } = await services.drive.downloadContainer(photo.videoId);
      return await services.encoder.extractFrame(blob, photo.frameIndex, photo.mimeType);
    } catch (err) {
      console.error('Failed to fetch full res', err);
      throw err;
    }
  };

  const handleDelete = async (photo) => {
    try {
      // 1. Optimistically remove from UI and Local DB
      setPhotos(prev => prev.filter(p => p.id !== photo.id));
      await services.db.deletePhoto(photo.id);
      setSelectedPhoto(null);
      
      // 2. Sync deletion to Drive (rewrites metadata)
      console.log('App.jsx: calling deleteContainerItem for photo', photo.id);
      await services.drive.deleteContainerItem(photo);
      console.log('App.jsx: deleteContainerItem completed successfully');
    } catch (err) {
      console.error('App.jsx: handleDelete error', err);
      setError(err);
      await loadData(); // rollback UI on failure
    }
  };

  const handleManualSync = async () => {
    if (!profile || !navigator.onLine || !queueIdle) return;
    setIsSyncing(true);
    try {
      // Discard local cache completely and rebuild from metadata files as requested
      await services.db.clearDB();
      setPhotos([]); // Clear UI immediately
      
      const count = await services.drive.syncFromDrive(
        services.db.addPhoto, 
        services.db.deletePhoto, 
        services.db.getAllPhotos
      );
      await loadData();
    } catch (err) {
      console.error('Manual sync failed:', err);
    } finally {
      setIsSyncing(false);
    }
  };

  const handleLazyLoadVault = async (photo) => {
    if (!photo.metaFileId || !photo.videoId) return;
    if (loadingVaultsRef.current.has(photo.videoId)) return; // Prevent duplicate requests
    
    loadingVaultsRef.current.add(photo.videoId);
    try {
      const photos = await services.drive.fetchVaultMetadata(photo.metaFileId);
      await services.db.deleteVaultSkeletons(photo.videoId);
      for (const p of photos) {
        await services.db.addPhoto({ ...p, syncStatus: 'synced' });
      }
      await loadData();
    } catch (err) {
      console.error('Failed to lazy load vault:', err);
      loadingVaultsRef.current.delete(photo.videoId); // Allow retry on failure
    }
  };

  return (
    <div className="app-container">
      <Header 
        profile={profile} 
        onConnect={handleConnect} 
        onDisconnect={handleDisconnect}
        onSync={handleManualSync}
        queueIdle={queueIdle} 
        totalSavedBytes={totalSavedBytes} 
      />
      
      <ErrorBanner error={error} onDismiss={() => setError(null)} />

      {progressMsg && !queueIdle && (
        <div className="card mb-8 animate-fade-in flex flex-col gap-4" style={{ backgroundColor: 'var(--card-bg)', border: '1px solid var(--border-color)', padding: '1.5rem', borderRadius: '16px', marginBottom: '1.5rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            <div className="spinner" style={{ width: '20px', height: '20px', borderWidth: '2px', borderTopColor: 'var(--accent-color)' }}></div>
            <span style={{ fontWeight: 600, color: 'var(--text-color)' }}>Processing Uploads</span>
          </div>
          
          {uploadStats.active && (
            <div style={{ width: '100%', marginTop: '0.5rem' }}>
              <div style={{ width: '100%', height: '6px', backgroundColor: 'var(--glass-border)', borderRadius: '3px', overflow: 'hidden' }}>
                <div style={{ width: `${Math.min(100, (uploadStats.completed / uploadStats.total) * 100)}%`, height: '100%', backgroundColor: 'var(--primary)', transition: 'width 0.3s ease' }}></div>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '0.5rem' }}>
                <span style={{ fontSize: '13px', color: 'var(--text-muted)' }}>{uploadStats.completed} of {uploadStats.total} photos completed</span>
                <span style={{ fontSize: '13px', color: 'var(--text-muted)' }}>{Math.round((uploadStats.completed / uploadStats.total) * 100)}%</span>
              </div>
            </div>
          )}
          
          <div style={{ fontSize: '13px', color: 'var(--text-muted)', marginTop: uploadStats.active ? '0.5rem' : '0' }}>
            {progressMsg}
          </div>
        </div>
      )}
      
      <PhotoGrid 
        photos={photos}  
        onFilesAdded={handleFilesAdded} 
        onPhotoClick={setSelectedPhoto} 
        onLazyLoad={handleLazyLoadVault}
      />
      
      {selectedPhoto && (
        <InspectorModal 
          photo={selectedPhoto} 
          onClose={() => setSelectedPhoto(null)} 
          onDownload={handleDownload}
          onDelete={handleDelete}
          onFetchFullRes={handleFetchFullRes}
        />
      )}
    </div>
  );
}

export default App;
