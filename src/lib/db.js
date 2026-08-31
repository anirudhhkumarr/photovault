import { openDB } from 'idb';

const DB_NAME = 'photo-vault-db';
const DB_VERSION = 3;

export async function initDB() {
  return openDB(DB_NAME, DB_VERSION, {
    upgrade(db) {
      if (!db.objectStoreNames.contains('photos')) {
        const photoStore = db.createObjectStore('photos', { keyPath: 'id', autoIncrement: true });
        photoStore.createIndex('contentHash', 'contentHash', { unique: false });
        photoStore.createIndex('videoId', 'videoId', { unique: false });
      }
      if (!db.objectStoreNames.contains('videos')) {
        db.createObjectStore('videos', { keyPath: 'id' });
      }
    },
  });
}

export async function getPhotos() {
  const db = await initDB();
  return db.getAll('photos');
}

export async function getPhotoById(id) {
  const db = await initDB();
  return db.get('photos', id);
}

export async function addPhoto(data) {
  const db = await initDB();
  return db.add('photos', data);
}

export async function updatePhoto(id, data) {
  const db = await initDB();
  const existing = await db.get('photos', id);
  if (existing) {
    await db.put('photos', { ...existing, ...data });
  }
}

export async function deletePhotoFromDB(id) {
  const db = await initDB();
  return db.delete('photos', id);
}

export async function getVideos() {
  const db = await initDB();
  return db.getAll('videos');
}

export async function getVideoById(id) {
  const db = await initDB();
  return db.get('videos', id);
}

export async function addVideo(id, videoData) {
  const db = await initDB();
  await db.put('videos', { id, ...videoData });
}

export async function updateVideo(id, data) {
  const db = await initDB();
  const existing = await db.get('videos', id);
  if (existing) {
    await db.put('videos', { ...existing, ...data });
  } else {
    await db.put('videos', { id, ...data });
  }
}

export async function deleteVideoFromDB(id) {
  const db = await initDB();
  return db.delete('videos', id);
}

export async function getVideoBlob(id) {
  const db = await initDB();
  const video = await db.get('videos', id);
  return video ? video.blob : null;
}

export async function clearDB() {
  try {
    const db = await initDB();
    await db.clear('photos');
    await db.clear('videos');
  } catch (e) {
    console.error('clearDB store clear error:', e);
  }

  try {
    const keysToRemove = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && (key.startsWith('gdrive_') || key.startsWith('photovault_'))) {
        keysToRemove.push(key);
      }
    }
    keysToRemove.forEach(k => localStorage.removeItem(k));
  } catch (e) {
    // Ignore
  }
}

export async function exportContainerMetadata(videoId) {
  const allPhotos = await getPhotos();
  const photos = allPhotos.filter(p => p.videoId === videoId);
  const rawVideo = await getVideoById(videoId);
  
  const videos = [];
  if (rawVideo) {
    const { blob, ...rest } = rawVideo;
    videos.push(rest);
  }

  return JSON.stringify({ photos, videos });
}

export async function importContainerMetadata(jsonString) {
  try {
    const { photos, videos } = JSON.parse(jsonString);
    const db = await initDB();
    
    // Upsert instead of clearing
    if (photos && photos.length > 0) {
      const tx = db.transaction('photos', 'readwrite');
      for (const p of photos) {
        await tx.store.put(p);
      }
      await tx.done;
    }

    if (videos && videos.length > 0) {
      const tx = db.transaction('videos', 'readwrite');
      for (const v of videos) {
        await tx.store.put(v);
      }
      await tx.done;
    }
    return true;
  } catch (err) {
    console.error('Failed to import container DB from JSON:', err);
    return false;
  }
}
