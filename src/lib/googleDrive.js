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
let accessToken = null;
let gisInitialized = false;
let tokenClient = null;
let googleProfile = null;

const CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID;
const SCOPES = 'https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/userinfo.profile https://www.googleapis.com/auth/userinfo.email';

export function loadGis() {
  return new Promise((resolve, reject) => {
    if (gisInitialized) return resolve();
    const script = document.createElement('script');
    script.src = 'https://accounts.google.com/gsi/client';
    script.async = true;
    script.defer = true;
    script.onload = () => {
      tokenClient = google.accounts.oauth2.initTokenClient({
        client_id: CLIENT_ID,
        scope: SCOPES,
        callback: '' // Defined on demand
      });
      gisInitialized = true;
      resolve();
    };
    script.onerror = () => reject(new Error('Failed to load GIS script'));
    document.body.appendChild(script);
  });
}

export async function connectDrive() {
  await loadGis();
  return new Promise((resolve, reject) => {
    tokenClient.callback = async (resp) => {
      if (resp.error !== undefined) {
        reject(resp);
      }
      accessToken = resp.access_token;
      
      // Get user profile
      try {
        const profileResp = await fetch('https://www.googleapis.com/oauth2/v1/userinfo?alt=json', {
          headers: { Authorization: `Bearer ${accessToken}` }
        });
        googleProfile = await profileResp.json();
      } catch (err) {
        console.error("Failed to fetch user profile", err);
      }
      
      resolve({ token: accessToken, profile: googleProfile });
    };
    tokenClient.requestAccessToken({ prompt: 'consent' });
  });
}

export function getProfile() {
  return googleProfile;
}

async function getVaultFolderId() {
  await folderMutex.lock();
  try {
    const q = encodeURIComponent("name = 'Photo Vault' and mimeType = 'application/vnd.google-apps.folder' and trashed = false");
    let resp = await fetch(`https://www.googleapis.com/drive/v3/files?q=${q}&spaces=drive`, {
      headers: { Authorization: `Bearer ${accessToken}` }
    });
    if (!resp.ok) throw new Error("Failed to query folder");
    let data = await resp.json();
    
    if (data.files && data.files.length > 0) {
      return data.files[0].id;
    }
    
    // Create folder
    const createResp = await fetch('https://www.googleapis.com/drive/v3/files', {
      method: 'POST',
      headers: { 
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        name: 'Photo Vault',
        mimeType: 'application/vnd.google-apps.folder'
      })
    });
    if (!createResp.ok) throw new Error("Failed to create folder");
    data = await createResp.json();
    return data.id;
  } finally {
    folderMutex.unlock();
  }
}

export async function uploadContainer(payload) {
  if (!accessToken) throw new Error("Not authenticated");
  
  const { groupId, blob, manifest } = payload;
  const folderId = await getVaultFolderId();
  
  const metadata = {
    name: `container_${groupId}.${blob.type.includes('mp4') ? 'mp4' : 'webm'}`,
    parents: [folderId],
    appProperties: {
      manifest: JSON.stringify(manifest)
    }
  };

  const boundary = '-------314159265358979323846';
  const delimiter = `\r\n--${boundary}\r\n`;
  const closeDelim = `\r\n--${boundary}--`;

  const metaPart = `Content-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}`;
  const mediaPart = `Content-Type: ${blob.type}\r\n\r\n`;

  // We need to construct a multipart ArrayBuffer or Blob
  const blobParts = [
    new Blob([delimiter + metaPart + delimiter + mediaPart]),
    blob,
    new Blob([closeDelim])
  ];
  
  const multipartBlob = new Blob(blobParts, { type: `multipart/related; boundary=${boundary}` });

  const resp = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': `multipart/related; boundary=${boundary}`,
      'Content-Length': multipartBlob.size.toString()
    },
    body: multipartBlob
  });

  if (!resp.ok) {
    const errText = await resp.text();
    throw new Error(`Upload failed: ${resp.status} ${errText}`);
  }
  
  return await resp.json();
}
