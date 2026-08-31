import React, { useState, useEffect } from 'react';
import { Header } from './components/Header';
import { StorageSummary } from './components/StorageSummary';
import { PhotoGrid } from './components/PhotoGrid';
import { PhotoViewerModal } from './components/PhotoViewerModal';
import { GoogleDriveModal } from './components/GoogleDriveModal';
import { Cloud, AlertCircle, X } from 'lucide-react';

import { computeContentHash, extractSceneFingerprint, arePhotosInSameScene, generateThumbnail } from './lib/phash';
import { 
  getPhotos, addPhoto, updatePhoto, deletePhotoFromDB, 
  getVideos, addVideo, updateVideo, deleteVideoFromDB, 
  getVideoBlob, clearDB, exportContainerMetadata, importContainerMetadata
} from './lib/db';
import { encodeImagesToVideo, extractAllFramesFromVideo, extractSingleFrame } from './lib/videoEncoder';
import { downloadFileDirectly } from './lib/driveSync';
import { 
  GOOGLE_CLIENT_ID,
  initGoogleAuth, 
  requestGoogleSignIn, 
  signOutGoogle, 
  getAccessToken, 
  getUserProfile, 
  uploadFileToGoogleDrive,
  listVaultFilesFromGoogleDrive,
  downloadFileFromGoogleDrive,
  getFileIdByName,
  uploadOrUpdateFileInGoogleDrive,
  deleteFileFromGoogleDrive
} from './lib/googleDrive';

export default function App() {
  const [photos, setPhotos] = useState([]);
  const [groups, setGroups] = useState([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [progress, setProgress] = useState('');
  const [errorMessage, setErrorMessage] = useState(null);
  
  const [selectedPhoto, setSelectedPhoto] = useState(null);
  const [fullPhotoUrl, setFullPhotoUrl] = useState('');

  // Google Drive Integration State
  const [isGoogleModalOpen, setIsGoogleModalOpen] = useState(false);
  const [googleUser, setGoogleUser] = useState(getUserProfile());

  useEffect(() => {
    loadData();
    initGoogleAuth(GOOGLE_CLIENT_ID, async (token, profile) => {
      setGoogleUser(profile);
      setErrorMessage(null);
      await syncExistingCloudVault(token);
    }).catch(err => {
      setErrorMessage(err.message || String(err));
    });
  }, []);

  const loadData = async () => {
    try {
      const p = await getPhotos();
      const g = await getVideos();
      
      const validGroupIds = new Set(p.map(item => item.videoId));
      const activeGroups = [];
      for (const group of g) {
        if (validGroupIds.has(group.id)) {
          activeGroups.push(group);
        } else {
          await deleteVideoFromDB(group.id);
        }
      }

      setPhotos(p || []);
      setGroups(activeGroups);
    } catch (e) {
      console.error('loadData error:', e);
      setPhotos([]);
      setGroups([]);
    }
  };

  /**
   * Saves the IndexedDB metadata for a specific container to Google Drive.
   */
  const saveContainerMetadataToDrive = async (groupId) => {
    const token = getAccessToken();
    if (!token || !groupId) return;
    try {
      setProgress(`Saving metadata for container ${groupId}...`);
      const dbJson = await exportContainerMetadata(groupId);
      await uploadOrUpdateFileInGoogleDrive(`metadata_${groupId}.json`, dbJson, 'application/json', token);
    } catch (e) {
      console.error(`Failed to save metadata for ${groupId}:`, e);
      setErrorMessage(e.message || String(e));
    } finally {
      setProgress('');
    }
  };

  /**
   * Reads and restores any existing photo vault containers from Google Drive.
   */
  const syncExistingCloudVault = async (token = getAccessToken(), forceReindex = false) => {
    if (!token) return;
    try {
      setIsProcessing(true);
      setProgress('Syncing with Google Drive Photo Vault...');
      setErrorMessage(null);

      const cloudFiles = await listVaultFilesFromGoogleDrive(token);
      const existingVideos = await getVideos();
      const existingIds = new Set(existingVideos.map(v => v.id));

      if (!forceReindex) {
        const metadataFiles = cloudFiles.filter(f => f.name.startsWith('metadata_') && f.name.endsWith('.json'));
        for (const file of metadataFiles) {
          try {
            setProgress(`Restoring metadata: ${file.name}...`);
            const dbData = await downloadFileFromGoogleDrive(file.id, token);
            if (dbData) {
              const text = new TextDecoder().decode(dbData);
              await importContainerMetadata(text);
            }
          } catch (err) {
            console.warn(`Failed to restore ${file.name}:`, err);
          }
        }
        await loadData();
      }

      let importedCount = 0;
      for (const file of cloudFiles) {
        if (file.name.endsWith('.json')) continue;

        const groupId = file.name.replace(/\.mp4$/i, '');
        const isMp4 = file.name.endsWith('.mp4');
        const existingVideo = existingVideos.find(v => v.id === groupId);

        if (isMp4 && (forceReindex || !existingIds.has(groupId) || (existingVideo && !existingVideo.blob))) {
          setProgress(`Restoring vault container: ${file.name}...`);
          const fileData = await downloadFileFromGoogleDrive(file.id, token);
          if (fileData) {
            if (forceReindex || !existingIds.has(groupId)) {
              const frames = await extractAllFramesFromVideo(fileData, 50);
              if (frames.length > 0) {
                for (let i = 0; i < frames.length; i++) {
                  const frame = frames[i];
                  await addPhoto({
                    filename: `${groupId}_photo_${i + 1}.jpg`,
                    videoId: groupId,
                    frameIndex: i,
                    timestamp: frame.timestamp,
                    size: Math.round(file.size / frames.length) || 1000000,
                    thumbnail: frame.dataUrl,
                    createdAt: Date.now()
                  });
                }
                await updateVideo(groupId, {
                  originalSize: Number(file.size) * 3 || 10000000,
                  videoSize: Number(file.size),
                  frameCount: frames.length,
                  blob: fileData
                });
                importedCount++;
                
                await saveContainerMetadataToDrive(groupId);
              }
            } else {
              // Metadata was imported, just cache the blob
              await updateVideo(groupId, { blob: fileData });
            }
          }
        }
      }

      if (importedCount > 0) {
        await loadData();
      }
      
      setProgress('');
    } catch (e) {
      console.error('Cloud sync error:', e);
      setErrorMessage(e.message || String(e));
    } finally {
      setIsProcessing(false);
    }
  };

  const handleReindex = async () => {
    if (!googleUser) return;
    const confirm = window.confirm('Reindexing will rebuild your local database from the Google Drive containers. This may take some time. Continue?');
    if (!confirm) return;

    await clearDB();
    await loadData();
    await syncExistingCloudVault(getAccessToken(), true);
  };


  const handleGoogleSignIn = () => {
    try {
      setErrorMessage(null);
      requestGoogleSignIn();
    } catch (e) {
      setErrorMessage(e.message || String(e));
    }
  };

  const handleGoogleSignOut = () => {
    signOutGoogle();
    setGoogleUser(null);
    setPhotos([]);
    setGroups([]);
    setErrorMessage(null);
  };

  const handleClear = async () => {
    await clearDB();
    setPhotos([]);
    setGroups([]);
    setSelectedPhoto(null);
    setErrorMessage(null);
  };

  const handleExportAll = async () => {
    for (let i = 0; i < groups.length; i++) {
      const g = groups[i];
      const blob = await getVideoBlob(g.id);
      if (blob) {
        downloadFileDirectly(`vault_container_${i + 1}.mp4`, blob, 'video/mp4');
      }
    }
  };

  const handleDownloadPhoto = async (photo) => {
    if (!photo) return;
    if (photo.blob) {
      downloadFileDirectly(photo.filename, photo.blob, photo.mimeType || 'image/jpeg');
      return;
    }
    try {
      const containerBlob = await getVideoBlob(photo.videoId);
      if (containerBlob) {
        const frameUrl = await extractSingleFrame(containerBlob, photo.timestamp || 0.2);
        if (frameUrl) {
          const res = await fetch(frameUrl);
          const blob = await res.blob();
          downloadFileDirectly(photo.filename, blob, photo.mimeType || 'image/jpeg');
        }
      }
    } catch (e) {
      console.error('Download error:', e);
    }
  };

  const handleInspectPhoto = async (photo) => {
    setSelectedPhoto(photo);
    setFullPhotoUrl(photo.thumbnail || '');
    try {
      const containerBlob = await getVideoBlob(photo.videoId);
      if (containerBlob) {
        const frameUrl = await extractSingleFrame(containerBlob, photo.timestamp || 0.2);
        if (frameUrl) {
          setFullPhotoUrl(frameUrl);
        }
      }
    } catch (e) {
      console.error('Photo inspection error:', e);
    }
  };

  const handleDeletePhoto = async (photoId) => {
    try {
      setIsProcessing(true);
      setProgress('Updating photo storage...');
      setErrorMessage(null);

      const allPhotos = await getPhotos();
      const targetPhoto = allPhotos.find(p => p.id === photoId);
      if (!targetPhoto) return;

      const videoId = targetPhoto.videoId;
      const remainingInGroup = allPhotos.filter(p => p.videoId === videoId && p.id !== photoId);

      await deletePhotoFromDB(photoId);

      if (remainingInGroup.length === 0) {
        await deleteVideoFromDB(videoId);
      } else {
        const containerBlob = await getVideoBlob(videoId);
        if (containerBlob) {
          try {
            const extractedFrames = await extractAllFramesFromVideo(containerBlob, remainingInGroup.length + 1);
            const framesToKeep = extractedFrames.filter(f => f.frameIndex !== targetPhoto.frameIndex);

            if (framesToKeep.length > 0) {
              const reEncoded = await encodeImagesToVideo(framesToKeep.map(f => f.dataUrl));
              const newOriginalSize = remainingInGroup.reduce((sum, p) => sum + p.size, 0);

              await updateVideo(videoId, {
                originalSize: newOriginalSize,
                videoSize: reEncoded.blob.length,
                frameCount: reEncoded.frameCount,
                blob: reEncoded.blob
              });

              if (getAccessToken()) {
                await uploadFileToGoogleDrive(`${videoId}.mp4`, reEncoded.blob, 'video/mp4');
              }

              for (let i = 0; i < remainingInGroup.length; i++) {
                await updatePhoto(remainingInGroup[i].id, {
                  frameIndex: i,
                  timestamp: i * 1.0 + 0.2
                });
              }
            } else {
              await deleteVideoFromDB(videoId);
            }
          } catch (err) {
            console.error('Re-encode error on delete:', err);
            throw err;
          }
        }
      }

      await loadData();
      const stillExists = (await getVideos()).find(v => v.id === videoId);
      if (stillExists) {
        await saveContainerMetadataToDrive(videoId);
      } else if (getAccessToken()) {
        try {
          await deleteFileFromGoogleDrive(`metadata_${videoId}.json`, getAccessToken());
        } catch (e) { console.warn(e); }
      }
      setProgress('');
    } catch (e) {
      console.error('Delete error:', e);
      setErrorMessage(e.message || String(e));
    } finally {
      setIsProcessing(false);
    }
  };

  const handleFiles = async (event) => {
    if (!googleUser) {
      setIsGoogleModalOpen(true);
      return;
    }

    const rawFiles = Array.from(event.target.files);
    if (!rawFiles.length) return;

    setIsProcessing(true);
    setErrorMessage(null);

    try {
      const mp4Files = rawFiles.filter(f => f.name.endsWith('.mp4'));
      const imageFiles = rawFiles.filter(f => {
        const isImg = f.type ? f.type.startsWith('image/') : /\.(jpg|jpeg|png|webp|JPG|PNG|JPEG|heic|HEIC)$/i.test(f.name);
        return isImg;
      });

      // 1. Direct MP4 container import
      for (const mp4File of mp4Files) {
        setProgress(`Importing existing container: ${mp4File.name}...`);
        const buffer = await mp4File.arrayBuffer();
        const blobData = new Uint8Array(buffer);
        const groupId = mp4File.name.replace(/\.mp4$/i, '');
        const frames = await extractAllFramesFromVideo(blobData, 50);

        if (frames.length > 0) {
          for (let i = 0; i < frames.length; i++) {
            await addPhoto({
              filename: `${groupId}_photo_${i + 1}.jpg`,
              videoId: groupId,
              frameIndex: i,
              timestamp: frames[i].timestamp,
              size: Math.round(mp4File.size / frames.length) || 1000000,
              thumbnail: frames[i].dataUrl,
              createdAt: Date.now()
            });
          }

          await updateVideo(groupId, {
            originalSize: mp4File.size * 3,
            videoSize: mp4File.size,
            frameCount: frames.length,
            blob: blobData
          });

          if (getAccessToken()) {
            await uploadFileToGoogleDrive(`${groupId}.mp4`, blobData, 'video/mp4');
            await saveContainerMetadataToDrive(groupId);
          }
        }
      }

      // 2. Image Clustering and HEVC Container Packing
      if (imageFiles.length > 0) {
        const processedBatch = [];
        for (let i = 0; i < imageFiles.length; i++) {
          const file = imageFiles[i];
          setProgress(`Analyzing ${i + 1}/${imageFiles.length}: ${file.name}`);

          const arrayBuffer = await file.arrayBuffer();
          const [contentHash, fingerprint, thumbnail] = await Promise.all([
            computeContentHash(arrayBuffer),
            extractSceneFingerprint(file).catch(() => null),
            generateThumbnail(file, 400)
          ]);

          processedBatch.push({
            file,
            name: file.name,
            size: file.size,
            contentHash,
            fingerprint,
            thumbnail,
            data: new Uint8Array(arrayBuffer)
          });
        }

        setProgress('Matching similar scene photos...');
        const existingPhotos = await getPhotos();
        const sceneClusters = new Map();

        for (const item of processedBatch) {
          let matchedGroupId = null;

          // 1. Exact Duplicate match
          for (const p of existingPhotos) {
            if (p.contentHash && p.contentHash === item.contentHash) {
              matchedGroupId = p.videoId;
              break;
            }
          }

          // 2. Pure Visual Content Scene Match (same room/setting, people moving)
          if (!matchedGroupId && item.fingerprint) {
            for (const p of existingPhotos) {
              if (p.fingerprint && arePhotosInSameScene(item.fingerprint, p.fingerprint)) {
                matchedGroupId = p.videoId;
                break;
              }
            }
          }

          // 3. Batch-internal visual scene match
          if (!matchedGroupId && item.fingerprint) {
            for (const prev of processedBatch) {
              if (prev !== item && prev.videoId && prev.fingerprint) {
                if (arePhotosInSameScene(item.fingerprint, prev.fingerprint)) {
                  matchedGroupId = prev.videoId;
                  break;
                }
              }
            }
          }

          const targetGroupId = matchedGroupId || `group_${Date.now()}_${Math.random().toString(36).substring(7)}`;
          item.videoId = targetGroupId;

          if (!sceneClusters.has(targetGroupId)) {
            sceneClusters.set(targetGroupId, []);
          }
          sceneClusters.get(targetGroupId).push(item);
        }

        let clusterIdx = 0;
        for (const [groupId, newItems] of sceneClusters.entries()) {
          clusterIdx++;
          setProgress(`Packing container ${clusterIdx}/${sceneClusters.size}...`);

          const existingContainerBlob = await getVideoBlob(groupId);
          let allImagesForGroup = [];

          if (existingContainerBlob) {
            const currentPhotosInGroup = (await getPhotos()).filter(p => p.videoId === groupId);
            const extractedFrames = await extractAllFramesFromVideo(existingContainerBlob, currentPhotosInGroup.length);
            allImagesForGroup = [...extractedFrames.map(f => f.dataUrl), ...newItems.map(item => item.data)];
          } else {
            allImagesForGroup = newItems.map(item => item.data);
          }

          // Pack into HEVC hardware-accelerated inter-frame container with frame progress
          const encoded = await encodeImagesToVideo(allImagesForGroup, (cur, total) => {
            setProgress(`Encoding container ${clusterIdx}/${sceneClusters.size} (photo ${cur}/${total})...`);
          });

          if (getAccessToken()) {
            setProgress(`Syncing container ${clusterIdx}/${sceneClusters.size} to Google Drive...`);
            await uploadFileToGoogleDrive(`${groupId}.mp4`, encoded.blob, encoded.mimeType || 'video/mp4');
          }

          const startIndex = existingContainerBlob ? ((await getPhotos()).filter(p => p.videoId === groupId).length) : 0;
          for (let i = 0; i < newItems.length; i++) {
            const item = newItems[i];
            const frameIndex = startIndex + i;
            await addPhoto({
              filename: item.name,
              contentHash: item.contentHash,
              fingerprint: item.fingerprint,
              videoId: groupId,
              frameIndex,
              timestamp: frameIndex * 1.0 + 0.2,
              size: item.size,
              thumbnail: item.thumbnail,
              createdAt: Date.now()
            });
          }

          const allPhotosForGroup = (await getPhotos()).filter(p => p.videoId === groupId);
          const totalOriginal = allPhotosForGroup.reduce((sum, p) => sum + p.size, 0);

          await updateVideo(groupId, {
            originalSize: totalOriginal,
            videoSize: encoded.blob.length,
            frameCount: encoded.frameCount,
            width: encoded.width,
            height: encoded.height,
            blob: encoded.blob
          });
          
          await saveContainerMetadataToDrive(groupId);
        }
      }

      await loadData();
      setProgress('');
    } catch (err) {
      console.error('Processing error:', err);
      setErrorMessage(err.message || String(err));
      setProgress('');
    } finally {
      setIsProcessing(false);
    }
  };

  const totalOriginal = groups.reduce((acc, g) => acc + (g.originalSize || 0), 0);
  const totalCompressed = groups.reduce((acc, g) => acc + (g.videoSize || 0), 0);

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      
      {/* Edge-to-Edge Sticky Header */}
      <Header 
        isProcessing={isProcessing}
        hasItems={photos.length > 0 || groups.length > 0}
        googleUser={googleUser}
        onOpenGoogleModal={() => setIsGoogleModalOpen(true)}
        onClear={handleClear}
        onUpload={handleFiles}
        onUploadFolder={handleFiles}
        onExportAll={handleExportAll}
        onReindex={handleReindex}
      />

      <main className="container" style={{ flex: 1, padding: '40px 32px 80px 32px' }}>
        {/* Prominent Fail-Hard Error Banner */}
        {errorMessage && (
          <div 
            className="card mb-8 animate-fade-in flex items-start gap-4" 
            style={{ 
              backgroundColor: 'rgba(255, 59, 48, 0.08)', 
              border: '1px solid rgba(255, 59, 48, 0.3)', 
              padding: '16px 20px',
              borderRadius: '16px'
            }}
          >
            <AlertCircle size={22} color="#FF3B30" style={{ flexShrink: 0, marginTop: '2px' }} />
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 600, fontSize: '15px', color: '#FF3B30' }}>Operation Failed</div>
              <p style={{ margin: '4px 0 0', fontSize: '13px', lineHeight: 1.5, color: 'var(--text-primary)' }}>
                {errorMessage}
              </p>
            </div>
            <button 
              className="btn btn-secondary btn-icon" 
              onClick={() => setErrorMessage(null)}
            >
              <X size={16} />
            </button>
          </div>
        )}

        {/* Progress Card */}
        {isProcessing && (
          <div className="card mb-8 animate-fade-in flex items-center justify-center gap-4" style={{ backgroundColor: 'var(--accent-color)', color: 'white', border: 'none' }}>
            <div className="spinner"></div>
            <span style={{ fontWeight: 500, letterSpacing: '-0.01em' }}>{progress}</span>
          </div>
        )}

        {/* Google Drive Connection Gate */}
        {!googleUser ? (
          <div className="card flex flex-col items-center justify-center text-center" style={{ padding: '80px 24px', margin: '40px 0' }}>
            <div style={{
              width: '80px',
              height: '80px',
              borderRadius: '24px',
              backgroundColor: 'rgba(0, 122, 255, 0.1)',
              color: 'var(--accent-color)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              marginBottom: '24px'
            }}>
              <Cloud size={40} strokeWidth={1.5} />
            </div>
            <h2 className="text-title" style={{ fontSize: '28px', margin: 0 }}>Connect Google Drive</h2>
            <p className="text-subtitle" style={{ maxWidth: '420px', margin: '12px 0 32px' }}>
              PhotoVault stores and backs up all your photos directly to your Google Drive account with enterprise-grade encryption.
            </p>
            <button 
              className="btn btn-primary"
              style={{ padding: '14px 32px', fontSize: '16px' }}
              onClick={() => setIsGoogleModalOpen(true)}
            >
              Connect to Drive
            </button>
          </div>
        ) : (
          <>
            {/* Stats Summary */}
            {groups.length > 0 && (
              <StorageSummary 
                totalOriginal={totalOriginal}
                totalCompressed={totalCompressed}
                photoCount={photos.length}
              />
            )}

            {/* Photo Gallery Grid */}
            <div>
              <div className="flex justify-between items-center mb-6">
                <h2 className="text-title" style={{ fontSize: '28px', margin: 0 }}>Library</h2>
                <span className="text-subtitle">{photos.length} Items</span>
              </div>

              <PhotoGrid 
                photos={photos}
                onInspect={handleInspectPhoto}
                onDownload={handleDownloadPhoto}
                onDelete={handleDeletePhoto}
              />
            </div>
          </>
        )}
      </main>

      {/* High-Resolution Photo Viewer Modal */}
      <PhotoViewerModal 
        photo={selectedPhoto}
        fullPhotoUrl={fullPhotoUrl}
        onDownload={handleDownloadPhoto}
        onClose={() => setSelectedPhoto(null)}
      />

      {/* Google Drive Connection Modal */}
      <GoogleDriveModal 
        isOpen={isGoogleModalOpen}
        onClose={() => setIsGoogleModalOpen(false)}
        userProfile={googleUser}
        onSignIn={handleGoogleSignIn}
        onSignOut={handleGoogleSignOut}
      />
      
      <style dangerouslySetInnerHTML={{__html: `
        .spinner {
          width: 20px;
          height: 20px;
          border: 2px solid rgba(255,255,255,0.3);
          border-radius: 50%;
          border-top-color: white;
          animation: spin 1s ease-in-out infinite;
        }
        @keyframes spin {
          to { transform: rotate(360deg); }
        }
      `}} />
    </div>
  );
}
