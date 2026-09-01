import { useState, useEffect } from 'react';
import Header from './components/Header';
import PhotoGrid from './components/PhotoGrid';
import InspectorModal from './components/InspectorModal';
import ErrorBanner from './components/ErrorBanner';

import { vaultQueue } from './lib/VaultQueue';
import { connectDrive, getProfile } from './lib/googleDrive';
import { getFileHash, analyzeVisualFeatures } from './lib/phash';

function App() {
  const [error, setError] = useState(null);
  const [profile, setProfile] = useState(null);
  const [photos, setPhotos] = useState([]);
  const [selectedPhoto, setSelectedPhoto] = useState(null);
  const [queueIdle, setQueueIdle] = useState(true);
  const [totalSavedBytes, setTotalSavedBytes] = useState(0);

  // Hook up VaultQueue listeners to UI state
  useEffect(() => {
    const handleStarted = () => setQueueIdle(false);
    const handleIdle = () => setQueueIdle(true);
    const handleError = (e) => {
      setError(e.detail.error);
    };

    vaultQueue.addEventListener('task:started', handleStarted);
    vaultQueue.addEventListener('idle', handleIdle);
    vaultQueue.addEventListener('task:error', handleError);

    return () => {
      vaultQueue.removeEventListener('task:started', handleStarted);
      vaultQueue.removeEventListener('idle', handleIdle);
      vaultQueue.removeEventListener('task:error', handleError);
    };
  }, []);

  const handleConnect = async () => {
    try {
      setError(null);
      await connectDrive();
      setProfile(getProfile());
    } catch (err) {
      setError(err);
    }
  };

  const handleFilesAdded = async (files) => {
    try {
      // 1. Create optimistic skeleton entries
      const newSkeletons = files.map((f, i) => ({
        id: `skel-${Date.now()}-${i}`,
        isSkeleton: true,
        file: f,
        originalName: f.name
      }));
      
      setPhotos((prev) => [...newSkeletons, ...prev]);

      // 2. Process each file (Normally via VaultQueue, but we'll simulate the pipeline here for UI feedback)
      for (const skeleton of newSkeletons) {
        try {
          const hash = await getFileHash(skeleton.file);
          
          // Image bitmap to get width/height
          const bitmap = await createImageBitmap(skeleton.file);
          const width = bitmap.width;
          const height = bitmap.height;
          
          const features = await analyzeVisualFeatures(skeleton.file);
          
          const completePhoto = {
            id: hash,
            hash,
            width,
            height,
            mimeType: skeleton.file.type,
            originalName: skeleton.originalName,
            originalSize: skeleton.file.size,
            thumbnailDataUrl: features.thumbnailDataUrl,
            file: skeleton.file, // Keep for inspector
            isSkeleton: false
          };

          setPhotos((prev) => 
            prev.map(p => p.id === skeleton.id ? completePhoto : p)
          );

          // Simulated compression savings for UI demonstration
          setTotalSavedBytes(prev => prev + (completePhoto.originalSize * 0.85));

        } catch (err) {
          setError(err);
          // Remove skeleton on fail
          setPhotos((prev) => prev.filter(p => p.id !== skeleton.id));
        }
      }
    } catch (err) {
      setError(err);
    }
  };

  const handleDownload = (photo) => {
    try {
      if (!photo.file) throw new Error("File not available locally");
      
      const url = URL.createObjectURL(photo.file);
      const a = document.createElement('a');
      a.href = url;
      // Ensure proper extension
      let ext = photo.mimeType.split('/')[1] || 'jpg';
      if (ext === 'jpeg') ext = 'jpg';
      
      a.download = photo.originalName || `download.${ext}`;
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
        URL.revokeObjectURL(url);
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
