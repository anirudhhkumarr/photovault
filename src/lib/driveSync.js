/**
 * Photo Vault Business Logic Layer
 * Orchestrates Google Drive API calls specific to the Photo Vault app.
 */

import { searchFiles, createFolder, uploadMultipart, downloadFile, updateMultipart, deleteFile } from './apiClient';

class Mutex {
  constructor() {
    this.queue = [];
    this.locked = false;
  }
  
  lock() {
    return new Promise(resolve => {
      if (!this.locked) {
        this.locked = true;
        resolve();
      } else {
        this.queue.push(resolve);
      }
    });
  }
  
  unlock() {
    if (this.queue.length > 0) {
      const resolve = this.queue.shift();
      resolve();
    } else {
      this.locked = false;
    }
  }
}

const folderMutex = new Mutex();

/**
 * Ensures the "Photo Vault" folder exists and returns its ID.
 * Thread-safe against concurrent calls using a Mutex.
 */
async function getVaultFolderId() {
  await folderMutex.lock();
  try {
    const query = "name = 'Photo Vault' and mimeType = 'application/vnd.google-apps.folder' and trashed = false";
    const data = await searchFiles(query);
    
    if (data.files && data.files.length > 0) {
      return data.files[0].id;
    }
    
    const newFolder = await createFolder('Photo Vault');
    return newFolder.id;
  } finally {
    folderMutex.unlock();
  }
}

/**
 * Uploads a video container and its corresponding JSON metadata to Drive.
 */
export async function uploadContainer(payload) {
  const { groupId, blob, fullPhotos } = payload;
  const folderId = await getVaultFolderId();
  
  // 1. Upload Video
  const videoMetadata = {
    name: `${groupId}.${blob.type.includes('mp4') ? 'mp4' : 'webm'}`,
    parents: [folderId]
  };
  
  const videoResp = await uploadMultipart(videoMetadata, blob);
  
  // 2. Upload Metadata JSON for easy state recovery
  const metadataBlob = new Blob([JSON.stringify(fullPhotos || [])], { type: 'application/json' });
  const jsonMetadata = {
    name: `metadata_${groupId}.json`,
    parents: [folderId]
  };
  
  try {
    await uploadMultipart(jsonMetadata, metadataBlob);
  } catch (err) {
    console.error("Failed to upload metadata JSON, recovery might be compromised for this container", err);
    // Hard-fail principle: we should probably fail the whole task if metadata fails.
    throw new Error(`Critical failure: Video uploaded but metadata failed. ${err.message}`);
  }

  return videoResp;
}

/**
 * Deletes a photo by rewriting the metadata file. If it's the last photo, deletes the video container entirely.
 */
export async function deleteContainerItem(photo) {
  const folderId = await getVaultFolderId();
  
  if (!photo.videoId || !photo.hash) {
    throw new Error("Cannot delete photo: missing videoId or hash");
  }
  
  // 1. Find the metadata file
  const metaQuery = `'${folderId}' in parents and name = 'metadata_${photo.videoId}.json' and trashed = false`;
  const metaData = await searchFiles(metaQuery, 'files(id, name)');
  
  if (!metaData.files || metaData.files.length === 0) {
    console.warn(`Metadata file for ${photo.videoId} not found during deletion.`);
    return;
  }
  
  const metaFile = metaData.files[0];
  
  // 2. Download and filter metadata
  let photos = [];
  try {
    photos = await downloadFile(metaFile.id, 'json');
  } catch (err) {
    throw new Error(`Failed to download metadata for deletion: ${err.message}`);
  }
  
  console.error(`[driveSync-DEBUG] deleting photo ${photo.id}. Found ${photos.length} photos in metadata.`);
  if (photos.length > 0) {
      console.error(`[driveSync-DEBUG] first photo id in metadata: ${photos[0].id}, type: ${typeof photos[0].id}, photo.id type: ${typeof photo.id}`);
  }
  
  const initialCount = photos.length;
  photos = photos.filter(p => p.id !== photo.id);
  console.error(`[driveSync-DEBUG] after filter, ${photos.length} photos remain.`);
  
  if (photos.length === initialCount) {
    console.warn("[driveSync-DEBUG] Photo id not found in metadata, might already be deleted.");
    return;
  }
  
  // 3. If empty, delete BOTH metadata and video from Google Drive!
  if (photos.length === 0) {
    // Delete both metadata and video
    console.error(`[driveSync-DEBUG] deleting metadata file ${metaFile.id}`);
    await deleteFile(metaFile.id);
    
    // Find the video file ID
    console.error(`[driveSync-DEBUG] finding video file ${photo.videoId}.webm`);
    const videoQuery = `'${folderId}' in parents and name = '${photo.videoId}.webm' and trashed = false`;
    const videoData = await searchFiles(videoQuery, 'files(id, name)');
  
    if (videoData.files && videoData.files.length > 0) {
      console.error(`[driveSync-DEBUG] deleting video file ${videoData.files[0].id}`);
      await deleteFile(videoData.files[0].id);
    } else {
      console.warn(`[driveSync-DEBUG] video file ${photo.videoId}.webm not found for deletion`);
    }
    return;
  }
  
  // 4. Otherwise, update the metadata file in-place
  console.error(`[driveSync-DEBUG] rewriting metadata with ${photos.length} photos`);
  const metadataBlob = new Blob([JSON.stringify(photos)], { type: 'application/json' });
  const jsonMetadata = {
    name: metaFile.name
  };
  
  return updateMultipart(metaFile.id, jsonMetadata, metadataBlob);
}

export async function syncFromDrive(addPhoto, deletePhoto, getAllPhotos) {
  const folderId = await getVaultFolderId();
  
  const query = `'${folderId}' in parents and name contains 'metadata_vault_' and trashed = false`;
  const data = await searchFiles(query, 'files(id, name)');
  
  let restoredCount = 0;
  const remoteVaults = new Set();
  const newSkeletons = [];
  
  const localPhotos = getAllPhotos ? await getAllPhotos() : [];
  const existingVaults = new Set(localPhotos.map(p => p.videoId));
  
  for (const file of data.files) {
    // Expected format: metadata_vault_{timestamp}_{count}_{id}.json
    const match = file.name.match(/^metadata_vault_(\d+)_(\d+)_([a-zA-Z0-9_-]+)\.json$/);
    if (!match) continue; // Skip old format per user request
    
    const timestamp = parseInt(match[1], 10);
    const count = parseInt(match[2], 10);
    const idPrefix = match[3];
    const vaultId = `vault_${timestamp}_${count}_${idPrefix}`;
    
    remoteVaults.add(vaultId);
    
    // If we don't have this vault locally (not even skeletons), create them!
    if (!existingVaults.has(vaultId) && addPhoto) {
      for (let i = 0; i < count; i++) {
        const skeleton = {
          id: `skel_${vaultId}_${i}`,
          hash: `skel_${vaultId}_${i}`,
          videoId: vaultId,
          isSkeleton: true,
          syncStatus: 'pending',
          createdAt: timestamp + i,
          metaFileId: file.id
        };
        try {
          await addPhoto(skeleton);
          restoredCount++;
        } catch (e) { }
      }
    }
  }
  
  // Handle deletions: if a local synced photo belongs to a vault that no longer exists remotely, delete it
  if (deletePhoto) {
    for (const lp of localPhotos) {
      // We only delete if it's synced (or a skeleton of a deleted vault) and the vault is gone
      // (if it's pending upload, we keep it)
      if (lp.videoId && lp.videoId.startsWith('vault_') && !remoteVaults.has(lp.videoId)) {
         if (lp.syncStatus === 'synced' || lp.isSkeleton) {
           await deletePhoto(lp.id);
         }
      }
    }
  }
  
  return restoredCount;
}

export async function fetchVaultMetadata(fileId) {
  return downloadFile(fileId, 'json');
}

/**
 * Downloads a video container blob by its containerId.
 */
export async function downloadContainer(containerId) {
  const folderId = await getVaultFolderId();
  const query = `'${folderId}' in parents and name contains '${containerId}' and mimeType contains 'video/' and trashed = false`;
  
  const data = await searchFiles(query, 'files(id, name, mimeType)');
  if (!data.files || data.files.length === 0) {
    throw new Error("Video container not found");
  }
  
  const file = data.files[0];
  const rawBlob = await downloadFile(file.id, 'blob');
  const blob = new Blob([rawBlob], { type: file.mimeType });
  
  return { blob, mimeType: file.mimeType };
}
