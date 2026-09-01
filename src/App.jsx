import { useState, useEffect } from 'react';
import Header from './components/Header';
import PhotoGrid from './components/PhotoGrid';
import InspectorModal from './components/InspectorModal';
import ErrorBanner from './components/ErrorBanner';

import { createVaultPipeline } from './lib/VaultQueue';
import { connectDrive, getProfile } from './lib/auth';
import { uploadContainer, syncFromDrive, downloadContainer } from './lib/driveSync';
import { getAllPhotos, getFileHash, addPhoto, exportContainerMetadata } from './lib/db';
import { encodeContainer, extractFrame } from './lib/videoEncoder';
import { analyzeVisualFeatures, isSameScene } from './lib/phash';

const defaultServices = {
  encoder: { encodeContainer, extractFrame },
  drive: { uploadContainer, syncFromDrive, downloadContainer },
  db: { getFileHash, addPhoto, exportContainerMetadata },
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

  // Load photos from DB on mount
  const loadData = async () => {
    try {
      const storedPhotos = await getAllPhotos();
      if (storedPhotos && storedPhotos.length > 0) {
        // Sort by newest first
        storedPhotos.sort((a, b) => b.createdAt - a.createdAt);
        setPhotos(storedPhotos);
        
        // Calculate saved bytes (assuming ~85% compression)
        const saved = storedPhotos.reduce((sum, p) => sum + (p.originalSize * 0.85), 0);
        setTotalSavedBytes(saved);
      } else {
        setPhotos([]);
      }
    } catch (err) {
      console.error("Failed to load local DB", err);
    }
  };

  useEffect(() => {
    loadData();
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
      
      // When analysis is complete, replace skeleton with analyzed photo
      if (task.type === 'ANALYZE_PHOTO') {
        const photoData = task.result;
        setPhotos(prev => prev.map(p => p.id === photoData.skeletonId ? photoData : p));
      }
      
      // When upload is complete, update saved bytes
      if (task.type === 'UPLOAD_CONTAINER') {
        const { originalTotalBytes } = task.result;
        setTotalSavedBytes(prev => prev + (originalTotalBytes * 0.85));
      }
    };

    vaultQueue.addEventListener('task:started', handleStarted);
    vaultQueue.addEventListener('idle', handleIdle);
    vaultQueue.addEventListener('task:error', handleError);
    vaultQueue.addEventListener('task:completed', handleTaskCompleted);

    return () => {
      vaultQueue.removeEventListener('task:started', handleStarted);
      vaultQueue.removeEventListener('idle', handleIdle);
      vaultQueue.removeEventListener('task:error', handleError);
      vaultQueue.removeEventListener('task:completed', handleTaskCompleted);
    };
  }, []);

  const handleConnect = async () => {
    try {
      setError(null);
      await connectDrive();
      setProfile(getProfile());
      
      setIsSyncing(true);
      await syncFromDrive(addPhoto);
      await loadData();
      setIsSyncing(false);
    } catch (err) {
      setError(err);
      setIsSyncing(false);
    }
  };

  const handleFilesAdded = async (files) => {
    try {
      // 1. Create optimistic skeleton entries
      const newSkeletons = files.map((f, i) => {
        const skelId = `skel-${Date.now()}-${i}`;
        return {
          id: skelId,
          skeletonId: skelId,
          isSkeleton: true,
          file: f,
          originalName: f.name
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

  return (
    <div className="app-container">
      <Header 
        profile={profile} 
        onConnect={handleConnect} 
        queueIdle={queueIdle} 
        totalSavedBytes={totalSavedBytes} 
      />
      
      <ErrorBanner error={error} onDismiss={() => setError(null)} />
      
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
        />
      )}
    </div>
  );
}

export default App;
