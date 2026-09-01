import { useState, useEffect } from 'react';
import Header from './components/Header';
import PhotoGrid from './components/PhotoGrid';
import InspectorModal from './components/InspectorModal';
import ErrorBanner from './components/ErrorBanner';

import { createVaultPipeline } from './lib/VaultQueue';
import { connectDrive, getProfile, initAuth, disconnectDrive } from './lib/auth';
import { uploadContainer, syncFromDrive, downloadContainer, deleteContainerItem } from './lib/driveSync';
import { getAllPhotos, getFileHash, addPhoto, exportContainerMetadata, clearDB, deletePhoto, addVideo, getVideo, deleteVideo, getAllVideos } from './lib/db';
import { encodeContainer, extractFrame } from './lib/videoEncoder';
import { analyzeVisualFeatures, isSameScene } from './lib/phash';

const defaultServices = {
  encoder: { encodeContainer, extractFrame },
  drive: { uploadContainer, syncFromDrive, downloadContainer, deleteContainerItem },
  db: { getFileHash, addPhoto, exportContainerMetadata, clearDB, deletePhoto, addVideo, getVideo, deleteVideo, getAllVideos },
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

  // Load photos from DB on mount
  const loadData = async () => {
    try {
      const storedPhotos = await getAllPhotos();
      if (storedPhotos && storedPhotos.length > 0) {
        // Sort by newest first
        storedPhotos.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
        setPhotos(storedPhotos);
        
        const allVideos = await services.db.getAllVideos();
      const savedBytes = allVideos.reduce((acc, v) => acc + (v.blob?.size || 0), 0);
      setTotalSavedBytes(savedBytes);

      // Auto-retry stranded uploads
      if (allVideos.length > 0) {
        for (const video of allVideos) {
          vaultQueue.enqueue('UPLOAD_CONTAINER', {
            containerId: video.id,
            blob: video.blob,
            manifest: video.manifest,
            photos: video.photos,
            originalTotalBytes: video.originalTotalBytes
          });
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

  // Hook up VaultQueue listeners to UI state
  useEffect(() => {
    const handleStarted = () => setQueueIdle(false);
    
    const handleIdle = () => {
      setQueueIdle(true);
      // Force flush any remaining items in the buffer when queue goes idle
      forceFlushCluster();
    };
    
    const handleError = (e) => {
      setError(e.detail.error);
    };

    const handleTaskCompleted = (e) => {
      const task = e.detail;
      
      if (task.type === 'ANALYZE_PHOTO') {
        const photoData = task.result;
        setPhotos(prev => prev.map(p => p.id === photoData.skeletonId ? photoData : p));
      }
      
      if (task.type === 'UPLOAD_CONTAINER') {
        const { originalTotalBytes } = task.result;
        setTotalSavedBytes(prev => prev + (originalTotalBytes * 0.85));
        loadData(); // Reload photos to update syncStatus to 'synced'
      }
    };

    const handleProgress = (e) => setProgressMsg(e.detail.message);

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

  useEffect(() => {
    let syncInterval;
    if (profile && queueIdle) {
      // Background Polling
      syncInterval = setInterval(() => {
        setIsSyncing(true);
        services.drive.syncFromDrive(services.db.addPhoto, services.db.deletePhoto)
          .then(async () => await loadData())
          .catch(console.error)
          .finally(() => setIsSyncing(false));
      }, window.__E2E_SYNC_INTERVAL__ || 30000);
    }
    return () => clearInterval(syncInterval);
  }, [profile, queueIdle]);

  const handleConnect = async () => {
    try {
      setError(null);
      await connectDrive();
      setProfile(getProfile());
      
      setIsSyncing(true);
      await services.drive.syncFromDrive(services.db.addPhoto, services.db.deletePhoto);
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
      // Filter out non-images and directories
      const imageFiles = files.filter(f => f.type && f.type.startsWith('image/'));
      
      if (imageFiles.length < files.length) {
        setError(new Error(`Skipped ${files.length - imageFiles.length} non-image files.`));
      }
      
      if (imageFiles.length === 0) return;

      // 1. Create optimistic skeleton entries
      const newSkeletons = imageFiles.map((f, i) => {
        const skelId = `skel-${Date.now()}-${i}`;
        return {
          id: skelId,
          skeletonId: skelId,
          isSkeleton: true,
          file: f,
          originalName: f.name,
          createdAt: Date.now()
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
        const { blob, mimeType } = await downloadContainer(photo.videoId);
        const dataUrl = await extractFrame(blob, photo.frameIndex, photo.mimeType);
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

  const handleDelete = async (photo) => {
    try {
      // 1. Optimistically remove from UI and Local DB
      setPhotos(prev => prev.filter(p => p.id !== photo.id));
      await services.db.deletePhoto(photo.id);
      setSelectedPhoto(null);
      
      // 2. Sync tombstone to Drive
      if (profile) {
        await services.drive.deleteContainerItem(photo.hash || photo.id);
      }
    } catch (err) {
      setError(err);
      await loadData(); // rollback UI on failure
    }
  };

  return (
    <div className="app-container">
      <Header 
        profile={profile} 
        onConnect={handleConnect} 
        onDisconnect={handleDisconnect}
        queueIdle={queueIdle} 
        totalSavedBytes={totalSavedBytes} 
      />
      
      <ErrorBanner error={error} onDismiss={() => setError(null)} />

      {progressMsg && !queueIdle && (
        <div className="card mb-8 animate-fade-in flex flex-col gap-4" style={{ backgroundColor: 'var(--card-bg)', border: '1px solid var(--border-color)', padding: '1rem', borderRadius: '16px', marginBottom: '1.5rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            <div className="spinner" style={{ width: '20px', height: '20px', borderWidth: '2px', borderTopColor: 'var(--accent-color)' }}></div>
            <span style={{ fontWeight: 600, color: 'var(--text-color)' }}>{progressMsg}</span>
          </div>
        </div>
      )}
      
      <PhotoGrid 
        photos={photos}  
        onFilesAdded={handleFilesAdded} 
        onPhotoClick={setSelectedPhoto} 
      />
      
      {selectedPhoto && (
        <InspectorModal 
          photo={selectedPhoto} 
          onClose={() => setSelectedPhoto(null)} 
          onDownload={handleDownload}
          onDelete={handleDelete}
        />
      )}
    </div>
  );
}

export default App;
