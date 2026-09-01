/**
 * Photo Vault Business Logic Layer
 * Orchestrates Google Drive API calls specific to the Photo Vault app.
 */

import { searchFiles, createFolder, uploadMultipart, downloadFile } from './apiClient';

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
 * Uploads a tombstone file to indicate a photo has been deleted.
 */
export async function deleteContainerItem(hash) {
  const folderId = await getVaultFolderId();
  
  const tombstoneBlob = new Blob([JSON.stringify({ deleted: true, hash })], { type: 'application/json' });
  const tombstoneMetadata = {
    name: `tombstone_${hash}.json`,
    parents: [folderId]
  };
  
  return uploadMultipart(tombstoneMetadata, tombstoneBlob);
}

/**
 * Recovers all photos from Google Drive metadata files.
 */
export async function syncFromDrive(addPhoto, deletePhoto) {
  const folderId = await getVaultFolderId();
  
  const query = `'${folderId}' in parents and (name contains 'metadata_vault_' or name contains 'tombstone_') and trashed = false`;
  const data = await searchFiles(query, 'files(id, name)');
  
  let restoredCount = 0;
  
  // First, gather all tombstones
  const tombstones = new Set();
  
  for (const file of data.files) {
    if (file.name.startsWith('tombstone_')) {
      try {
        const tombstoneData = await downloadFile(file.id, 'json');
        if (tombstoneData.hash) {
          tombstones.add(tombstoneData.hash);
          if (deletePhoto) await deletePhoto(tombstoneData.hash);
        }
      } catch (err) {
        console.error(`Failed to sync tombstone file ${file.name}:`, err);
      }
    }
  }

  // Then process metadata, skipping tombstoned hashes
  for (const file of data.files) {
    if (file.name.startsWith('metadata_vault_')) {
      try {
        const photos = await downloadFile(file.id, 'json');
        for (const p of photos) {
          if (tombstones.has(p.hash)) continue;
          
          try {
            await addPhoto(p);
            restoredCount++;
          } catch (e) {
            // ignore duplicate keys if already inserted
          }
        }
      } catch (err) {
        console.error(`Failed to sync metadata file ${file.name}:`, err);
      }
    }
  }
  
  return restoredCount;
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
  const blob = await downloadFile(file.id, 'blob');
  
  return { blob, mimeType: file.mimeType };
}
