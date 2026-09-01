import { openDB } from 'idb';

const DB_NAME = 'PhotoVaultDB';
const DB_VERSION = 2;

export async function initDB() {
  return openDB(DB_NAME, DB_VERSION, {
    upgrade(db, oldVersion, newVersion, transaction) {
      if (oldVersion < 1) {
        // v1 init
      }
      
      if (oldVersion < 2) {
        if (!db.objectStoreNames.contains('photos')) {
          const photosStore = db.createObjectStore('photos', { keyPath: 'id', autoIncrement: true });
          photosStore.createIndex('contentHash', 'hash', { unique: false });
          photosStore.createIndex('videoId', 'videoId', { unique: false });
          photosStore.createIndex('createdAt', 'createdAt', { unique: false });
        }
        
        if (!db.objectStoreNames.contains('videos')) {
          db.createObjectStore('videos', { keyPath: 'id' });
        }
        
        if (!db.objectStoreNames.contains('sync_meta')) {
          db.createObjectStore('sync_meta', { keyPath: 'key' });
        }
      }
    },
  });
}

// Helper methods for sync_meta
export async function getSyncMeta(key) {
  const db = await initDB();
  const result = await db.get('sync_meta', key);
  return result?.value;
}

export async function setSyncMeta(key, value) {
  const db = await initDB();
  await db.put('sync_meta', { key, value });
}

export async function addPhoto(photo) {
  const db = await initDB();
  return db.put('photos', photo);
}

export async function getAllPhotos() {
  const db = await initDB();
  return db.getAll('photos');
}

export async function deletePhoto(id) {
  const db = await initDB();
  return db.delete('photos', id);
}

export async function clearDB() {
  const db = await initDB();
  await db.clear('photos');
  await db.clear('videos');
  await db.clear('sync_meta');
}

export async function addVideo(video) {
  const db = await initDB();
  return db.put('videos', video);
}

export async function getAllVideos() {
  const db = await initDB();
  return db.getAll('videos');
}

export async function getFileHash(file) {
  const buffer = await file.arrayBuffer();
  const hashBuffer = await crypto.subtle.digest('SHA-256', buffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

export async function exportContainerMetadata(videoId) {
  const db = await initDB();
  const tx = db.transaction('photos', 'readonly');
  const index = tx.store.index('videoId');
  const photos = await index.getAll(videoId);
  return JSON.stringify(photos, null, 2);
}
