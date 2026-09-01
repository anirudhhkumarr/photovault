import React, { useState, useEffect, useRef } from 'react';
import { Header } from './components/Header';
import { StorageSummary } from './components/StorageSummary';
import { PhotoGrid } from './components/PhotoGrid';
import { PhotoViewerModal } from './components/PhotoViewerModal';
import { GoogleDriveModal } from './components/GoogleDriveModal';
import { VaultQueue } from './lib/queue/VaultQueue';
import { Cloud, AlertCircle, X } from 'lucide-react';

import { 
  getPhotos, getPagedPhotos, getPhotosCount, addPhoto, updatePhoto, deletePhotoFromDB, 
  getVideos, updateVideo, deleteVideoFromDB, 
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
  const [totalPhotosCount, setTotalPhotosCount] = useState(0);
  const [cloudContainers, setCloudContainers] = useState([]);
  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [isLoadingData, setIsLoadingData] = useState(false);
  const PAGE_SIZE = 50;
  const loadMoreRef = useRef(null);

  const [uploadingFiles, setUploadingFiles] = useState([]);
  const [groups, setGroups] = useState([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [progress, setProgress] = useState('');
  const [progressStats, setProgressStats] = useState(null);
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

  const loadData = async (resetPage = false, containersOverride = null) => {
    try {
      setIsLoadingData(true);
      const currentPage = resetPage ? 0 : page;
      const activeCloudContainers = containersOverride || cloudContainers;
      console.log(`[PhotoVault] 📚 Loading photo library data (page: ${currentPage}, reset: ${resetPage}, cloudContainers: ${activeCloudContainers.length})`);
      
      if (activeCloudContainers && activeCloudContainers.length > 0) {
        // VIRTUALIZED JIT LOADING
        const targetStart = currentPage * PAGE_SIZE;
        const targetEnd = targetStart + PAGE_SIZE;
        
        const containersToFetch = activeCloudContainers.filter(c => 
          !c.loaded && 
          !(c.endIndex <= targetStart || c.startIndex >= targetEnd)
        );
        
        const token = getAccessToken();
        let updatedContainers = activeCloudContainers.map(c => ({ ...c }));
        if (containersToFetch.length > 0 && token) {
          console.log(`[PhotoVault] ☁️ JIT loading ${containersToFetch.length} container metadata files from Google Drive for viewport range [${targetStart}-${targetEnd}]`);
          
          for (const c of containersToFetch) {
            setProgress(`Fetching metadata for ${c.groupId}...`);
            let fileIdToFetch = c.fileId;
            if (!fileIdToFetch) {
               fileIdToFetch = await getFileIdByName(`metadata_${c.groupId}_${c.count}.json`, token) ||
                               await getFileIdByName(`metadata_${c.groupId}.json`, token);
            }
            if (fileIdToFetch) {
              const dbData = await downloadFileFromGoogleDrive(fileIdToFetch, token);
              if (dbData) {
                const text = new TextDecoder().decode(dbData);
                await importContainerMetadata(text);
                console.log(`[PhotoVault] 📥 Loaded container metadata for ${c.groupId} (${c.count} items)`);
                
                // Mark loaded
                const idx = updatedContainers.findIndex(x => x.groupId === c.groupId);
                if (idx !== -1) updatedContainers[idx].loaded = true;
              }
            }
          }
          setCloudContainers(updatedContainers);
          setProgress('');
        }
        
        // Populate the `photos` array accurately based on offsets
        const allDbPhotos = await getPhotos();
        const effectiveTotal = updatedContainers.reduce((acc, c) => Math.max(acc, c.endIndex || 0), 0) || allDbPhotos.length;
        const newPhotos = resetPage ? new Array(effectiveTotal).fill(null) : [...photos];
        
        // Map photos by groupId
        const photosByGroup = {};
        for (const p of allDbPhotos) {
           if (!photosByGroup[p.videoId]) photosByGroup[p.videoId] = [];
           photosByGroup[p.videoId].push(p);
        }
        
        for (const c of updatedContainers) {
           if (c.loaded && photosByGroup[c.groupId]) {
             // sort by frameIndex so they map 1:1 to their offset
             const groupPhotos = photosByGroup[c.groupId].sort((a,b) => a.frameIndex - b.frameIndex);
             for (let i = 0; i < groupPhotos.length; i++) {
                if (c.startIndex + i < newPhotos.length) {
                   newPhotos[c.startIndex + i] = groupPhotos[i];
                }
             }
           }
        }
        
        setPhotos(newPhotos);
        setTotalPhotosCount(effectiveTotal);
        setHasMore((currentPage * PAGE_SIZE) + PAGE_SIZE < effectiveTotal);
        console.log(`[PhotoVault] 🖼️ PhotoGrid populated with ${newPhotos.filter(Boolean).length}/${effectiveTotal} loaded photos`);
      } else {
        // Fallback for local-only un-synced data
        const count = await getPhotosCount();
        const p = await getPagedPhotos(currentPage * PAGE_SIZE, PAGE_SIZE);
        setTotalPhotosCount(count);
        setHasMore((currentPage * PAGE_SIZE) + p.length < count);

        if (resetPage) {
          setPhotos(p || []);
          setPage(0);
        } else {
          setPhotos(prev => {
            const existingIds = new Set(prev.map(i => i && i.id));
            const newItems = p.filter(i => !existingIds.has(i.id));
            return [...prev, ...newItems];
          });
        }
        console.log(`[PhotoVault] 🖼️ Loaded ${p.length} photos from local IndexedDB (total: ${count})`);
      }

      const g = await getVideos();
      const validGroupIds = new Set((await getPhotos()).map(item => item.videoId));
      const activeGroups = [];
      for (const group of g) {
        if (validGroupIds.has(group.id)) {
          activeGroups.push(group);
        } else {
          await deleteVideoFromDB(group.id);
        }
      }
      setGroups(activeGroups);
      console.log(`[PhotoVault] 📦 Active video containers: ${activeGroups.length}`);
    } catch (e) {
      console.error('[PhotoVault] ❌ loadData error:', e);
    } finally {
      setIsLoadingData(false);
    }
  };

  // Intersection Observer for Infinite Scroll
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && hasMore && !isLoadingData) {
          setPage(prev => prev + 1);
        }
      },
      { rootMargin: '400px' } // Load a few pages ahead
    );
    
    if (loadMoreRef.current) {
      observer.observe(loadMoreRef.current);
    }
    
    return () => observer.disconnect();
  }, [hasMore, isLoadingData]);

  // When page state changes, append next page (unless page is 0, which means reset)
  useEffect(() => {
    if (page > 0) {
      loadData();
    }
  }, [page]);

  /**
   * Saves the IndexedDB metadata for a specific container to Google Drive.
   */
  const saveContainerMetadataToDrive = async (groupId) => {
    const token = getAccessToken();
    if (!token || !groupId) return;
    try {
      setProgress(`Saving metadata for container ${groupId}...`);
      const dbJson = await exportContainerMetadata(groupId);
      const parsed = JSON.parse(dbJson);
      const count = parsed.photos ? parsed.photos.length : 0;
      await uploadOrUpdateFileInGoogleDrive(`metadata_${groupId}_${count}.json`, dbJson, 'application/json', token);
      
      setCloudContainers(prev => {
         const newContainer = { groupId, count, loaded: true, fileId: null };
         // Append new ones at front
         const newList = [newContainer, ...prev];
         let offset = 0;
         for (const c of newList) {
           c.startIndex = offset;
           c.endIndex = offset + c.count;
           offset += c.count;
         }
         setTotalPhotosCount(offset);
         return newList;
      });
      
      setPhotos(prev => {
         return [...new Array(count).fill(null), ...prev];
      });
      
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
        console.log(`[PhotoVault] ☁️ Found ${metadataFiles.length} metadata files in Google Drive`);
        
        let containers = [];
        
        for (const file of metadataFiles) {
          // Support both metadata_<groupId>_<count>.json and metadata_<groupId>.json
          const match = file.name.match(/^metadata_(.+?)(?:_(\d+))?\.json$/);
          
          if (match) {
            const groupId = match[1];
            const count = match[2] ? parseInt(match[2], 10) : 1;
            
            containers.push({
              groupId,
              count,
              fileId: file.id,
              loaded: false
            });
          }
        }
        
        containers.sort((a, b) => b.groupId.localeCompare(a.groupId));
        
        let offset = 0;
        for (const c of containers) {
          c.startIndex = offset;
          c.endIndex = offset + c.count;
          offset += c.count;
        }
        
        console.log(`[PhotoVault] 📦 Discovered ${containers.length} cloud containers (${offset} total items)`);
        setCloudContainers(containers);
        setTotalPhotosCount(offset);
        setPhotos(new Array(offset).fill(null));
        setPage(0);

        // Immediately trigger JIT loading for page 0 with discovered containers
        await loadData(true, containers);
      }

      let importedCount = 0;
      for (const file of cloudFiles) {
        if (file.name.endsWith('.json')) continue;

        const groupId = file.name.replace(/\.mp4$/i, '');
        const isMp4 = file.name.endsWith('.mp4');

        // Only download the heavy MP4 container if we are forcefully rebuilding the DB
        // or if it's completely missing from DB metadata.
        if (isMp4 && (forceReindex || !existingIds.has(groupId))) {
          setProgress(`Restoring vault container metadata: ${file.name}...`);
          
          if (forceReindex) {
            const fileData = await downloadFileFromGoogleDrive(file.id, token);
            if (fileData) {
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
            }
          } else {
             // We don't have the metadata in DB (which shouldn't happen if the JSON was imported),
             // but if it does, we just record that it exists without downloading the huge blob yet.
             await updateVideo(groupId, {
               originalSize: Number(file.size) * 3 || 10000000,
               videoSize: Number(file.size),
               blob: null
             });
          }
        }
      }

      if (importedCount > 0) {
        await loadData(true);
      }
      
      setProgress('');
    } catch (e) {
      console.error('[PhotoVault] ❌ Cloud sync error:', e);
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

  const getOrFetchVideoBlob = async (videoId) => {
    let blob = await getVideoBlob(videoId);
    if (!blob) {
      const token = getAccessToken();
      if (token) {
        setProgress(`Fetching high-res original from cloud...`);
        try {
          const fileId = await getFileIdByName(`${videoId}.mp4`, token);
          if (fileId) {
            blob = await downloadFileFromGoogleDrive(fileId, token);
            if (blob) {
              await updateVideo(videoId, { blob });
            }
          }
        } catch (e) {
          console.error('Failed to fetch blob from cloud:', e);
          setErrorMessage(e.message || String(e));
          throw e;
        } finally {
          setProgress('');
        }
      }
    }
    return blob;
  };

  const handleDownloadPhoto = async (photo) => {
    if (!photo) return;
    console.log(`[PhotoVault] ⬇️ Downloading photo original: ${photo.filename} (videoId: ${photo.videoId}, frameIndex: ${photo.frameIndex})`);

    const ext = photo.filename?.split('.').pop()?.toLowerCase();
    const targetMime = ext === 'png' ? 'image/png' : 'image/jpeg';

    if (photo.blob) {
      downloadFileDirectly(photo.filename, photo.blob, targetMime);
      return;
    }
    try {
      const containerBlob = await getOrFetchVideoBlob(photo.videoId);
      if (containerBlob) {
        const frameUrl = await extractSingleFrame(containerBlob, photo.timestamp || 0.5, targetMime);
        if (frameUrl) {
          const res = await fetch(frameUrl);
          const blob = await res.blob();
          downloadFileDirectly(photo.filename, blob, targetMime);
          console.log(`[PhotoVault] ✅ Download complete for ${photo.filename} (${targetMime})`);
        }
      }
    } catch (e) {
      console.error('[PhotoVault] ❌ Download error:', e);
      setErrorMessage(e.message || String(e));
      throw e;
    }
  };

  const handleInspectPhoto = async (photo) => {
    console.log(`[PhotoVault] 🔍 Inspecting photo: ${photo.filename} (videoId: ${photo.videoId}, timestamp: ${photo.timestamp}s)`);
    setSelectedPhoto(photo);
    setFullPhotoUrl(photo.thumbnail || '');
    try {
      const containerBlob = await getOrFetchVideoBlob(photo.videoId);
      if (containerBlob) {
        const frameUrl = await extractSingleFrame(containerBlob, photo.timestamp || 0.5);
        if (frameUrl) {
          setFullPhotoUrl(frameUrl);
          console.log(`[PhotoVault] 🖼️ High-res frame loaded for inspection: ${photo.filename}`);
        }
      }
    } catch (e) {
      console.error('[PhotoVault] ❌ Photo inspection error:', e);
      setErrorMessage(e.message || String(e));
      throw e;
    }
  };

  const handleDeletePhoto = async (photoId) => {
    console.log(`[PhotoVault] 🗑️ Deleting photo: ${photoId}`);
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
                  timestamp: i * 1.0 + 0.5
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
        await deleteFileFromGoogleDrive(`metadata_${videoId}.json`, getAccessToken());
      }
      setProgress('');
    } catch (e) {
      console.error('Delete error:', e);
      setErrorMessage(e.message || String(e));
      throw e;
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

    console.log(`[PhotoVault] 📤 User selected ${rawFiles.length} file(s) for upload`);
    setIsProcessing(true);
    setProgressStats(null);
    setErrorMessage(null);

    try {
      const mp4Files = rawFiles.filter(f => f.name.endsWith('.mp4'));
      const imageFiles = rawFiles.filter(f => {
        const isImg = f.type ? f.type.startsWith('image/') : /\.(jpg|jpeg|png|webp|JPG|PNG|JPEG|heic|HEIC)$/i.test(f.name);
        return isImg;
      });

      console.log(`[PhotoVault] 📊 Processing ${imageFiles.length} images and ${mp4Files.length} MP4 containers`);

      // 1. Direct MP4 container import
      for (const mp4File of mp4Files) {
        setProgress(`Importing existing container: ${mp4File.name}...`);
        console.log(`[PhotoVault] 📥 Importing existing MP4 container: ${mp4File.name}`);
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

      // 2. Image Clustering and HEVC Container Packing via Event-Driven Queue
      if (imageFiles.length > 0) {
        console.log(`[PhotoVault] ⚡ Initializing VaultQueue for ${imageFiles.length} photos`);
        const vaultQueue = new VaultQueue();

        vaultQueue.on('container:uploaded', ({ itemIds }) => {
          // Incrementally remove uploaded items from processing skeleton state
          if (itemIds && itemIds.length > 0) {
            setUploadingFiles(prev => prev.filter(f => !itemIds.includes(f.id)));
          }
          // Incrementally refresh the top of the photo grid
          loadData(true);
        });

        vaultQueue.on('photo:analyzed', (item) => {
          if (item.tempId && item.thumbnail) {
            setUploadingFiles(prev => prev.map(f => f.id === item.tempId ? { ...f, thumbnail: item.thumbnail } : f));
          }
        });

        vaultQueue.on('progress', ({ name, stats }) => {
          if (name) setProgress(name);
          if (stats) setProgressStats(stats);
        });

        vaultQueue.on('error', (err) => {
          console.error('[PhotoVault] ❌ VaultQueue error:', err);
          setErrorMessage(err.message || String(err));
        });

        // Enqueue files into event-driven task queue and display immediate uploading skeletons
        const descriptors = await vaultQueue.enqueueFiles(imageFiles);
        setUploadingFiles(prev => [...prev, ...descriptors]);

        // Await completion of all reactive tasks (analysis, encoding, and uploads)
        await vaultQueue.waitUntilComplete();
        console.log('[PhotoVault] 🎉 VaultQueue batch complete!');
      }

      await loadData(true); // Final catch-all refresh
      setProgress('');
    } catch (err) {
      console.error('[PhotoVault] ❌ Processing error:', err);
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
          <div className="card mb-8 animate-fade-in flex flex-col gap-4" style={{ backgroundColor: 'var(--card-bg)', border: '1px solid var(--border-color)' }}>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="spinner" style={{ width: '20px', height: '20px', borderWidth: '2px', borderTopColor: 'var(--accent-color)' }}></div>
                <span style={{ fontWeight: 600, color: 'var(--text-primary)', letterSpacing: '-0.01em' }}>Processing Uploads</span>
              </div>
              {progressStats && (
                <div className="flex items-center gap-3" style={{ fontSize: '12px' }}>
                  <span className="badge" style={{ padding: '4px 8px', borderRadius: '12px', background: 'rgba(0,122,255,0.1)', color: 'var(--accent-color)', fontWeight: 600 }}>
                    🔍 Analyzing: {progressStats.analyzing?.active || 0} active ({progressStats.analyzing?.queued || 0} queued)
                  </span>
                  <span className="badge" style={{ padding: '4px 8px', borderRadius: '12px', background: 'rgba(255,149,0,0.1)', color: '#FF9500', fontWeight: 600 }}>
                    ⚡ Encoding: {progressStats.encoding?.active || 0} active ({progressStats.encoding?.queued || 0} queued)
                  </span>
                  <span className="badge" style={{ padding: '4px 8px', borderRadius: '12px', background: 'rgba(52,199,89,0.1)', color: 'var(--success-color)', fontWeight: 600 }}>
                    ☁️ Uploading: {progressStats.uploading?.active || 0} active ({progressStats.uploading?.queued || 0} queued)
                  </span>
                </div>
              )}
            </div>
            
            {progressStats ? (
              <div style={{ width: '100%' }}>
                <div style={{ width: '100%', height: '6px', backgroundColor: 'var(--bg-color)', borderRadius: '3px', overflow: 'hidden' }}>
                  <div style={{ width: `${progressStats.percent}%`, height: '100%', backgroundColor: 'var(--accent-color)', transition: 'width 0.3s ease' }}></div>
                </div>
                <div className="flex justify-between items-center mt-2">
                  <span className="text-subtitle" style={{ fontSize: '13px' }}>{progressStats.completed} of {progressStats.total} items completed</span>
                  <span className="text-subtitle" style={{ fontSize: '13px' }}>{progressStats.percent}%</span>
                </div>
                <div className="text-subtitle mt-2" style={{ fontSize: '13px', textAlign: 'center', opacity: 0.85 }}>{progress}</div>
              </div>
            ) : (
              <span className="text-subtitle" style={{ fontSize: '14px' }}>{progress}</span>
            )}
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
              <span className="text-subtitle">{totalPhotosCount + uploadingFiles.length} Items</span>
            </div>

            <PhotoGrid 
              photos={[...uploadingFiles, ...photos]}
              onInspect={handleInspectPhoto}
              onDownload={handleDownloadPhoto}
              onDelete={handleDeletePhoto}
              isLoadingData={isLoadingData}
            />

            <div ref={loadMoreRef} style={{ height: '20px', width: '100%' }} />
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
