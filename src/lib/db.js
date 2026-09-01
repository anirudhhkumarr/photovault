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
