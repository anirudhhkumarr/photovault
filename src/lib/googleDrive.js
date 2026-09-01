/**
 * Google Drive API v3 & Google Identity Services Client
 * 
 * Provides direct OAuth2 authentication and cloud file synchronization
 * with the user's Google Drive.
 */

const DRIVE_API_URL = 'https://www.googleapis.com/drive/v3';
const DRIVE_UPLOAD_URL = 'https://www.googleapis.com/upload/drive/v3/files';
const SCOPE = 'https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/userinfo.profile https://www.googleapis.com/auth/userinfo.email';

let tokenClient = null;
let accessToken = null;
let userProfile = null;
let vaultFolderId = null;

/**
 * Loads the Google Identity Services (GIS) script dynamically.
 */
export async function loadGsiScript() {
  return new Promise((resolve, reject) => {
    if (typeof window !== 'undefined' && window.google?.accounts?.oauth2) {
      return resolve(window.google);
    }
    const script = document.createElement('script');
    script.src = 'https://accounts.google.com/gsi/client';
    script.async = true;
    script.defer = true;
    script.onload = () => resolve(window.google);
    script.onerror = (err) => reject(err);
    document.head.appendChild(script);
  });
}

export const GOOGLE_CLIENT_ID = '548261245531-cr6ib16n7vcqjqjcktl4mq7mbe09hvq9.apps.googleusercontent.com';

export async function initGoogleAuth(clientId = GOOGLE_CLIENT_ID, onTokenReceived) {
  try {
    await loadGsiScript();
    if (!window.google?.accounts?.oauth2) return false;

    tokenClient = window.google.accounts.oauth2.initTokenClient({
      client_id: clientId || GOOGLE_CLIENT_ID,
      scope: SCOPE,
      callback: async (response) => {
        if (response.error !== undefined) {
          console.error('Google Auth Error:', response);
          throw new Error(`Google Auth failed: ${response.error_description || response.error}`);
        }
        accessToken = response.access_token;
        localStorage.setItem('gdrive_access_token', accessToken);
        
        const profile = await fetchUserInfo(accessToken);
        
        if (onTokenReceived) {
          onTokenReceived(accessToken, profile);
        }
      },
    });

    // Restore existing session across hard page refreshes
    const savedToken = getAccessToken();
    const savedProfile = getUserProfile();
    if (savedToken && onTokenReceived) {
      onTokenReceived(savedToken, savedProfile);
      // Verify token in background
      fetchUserInfo(savedToken).then(freshProfile => {
        if (freshProfile && onTokenReceived) {
          onTokenReceived(savedToken, freshProfile);
        }
      }).catch(err => {
        console.warn('Session verification failed on reload:', err);
      });
    }

    return true;
  } catch (e) {
    console.error('Failed to init Google Auth:', e);
    throw e;
  }
}

/**
 * Initiates the Google Sign-In popup flow.
 */
export function requestGoogleSignIn() {
  if (!tokenClient) {
    throw new Error('Google OAuth client is not initialized. Please configure your Google Client ID.');
  }
  tokenClient.requestAccessToken({ prompt: 'consent' });
}

export function signOutGoogle() {
  if (accessToken && window.google?.accounts?.oauth2) {
    window.google.accounts.oauth2.revoke(accessToken, () => {});
  }
  accessToken = null;
  userProfile = null;
  vaultFolderId = null;
  localStorage.removeItem('gdrive_access_token');
  localStorage.removeItem('gdrive_user_profile');
}

export function getAccessToken() {
  if (!accessToken) {
    accessToken = localStorage.getItem('gdrive_access_token');
  }
  return accessToken;
}

export function getUserProfile() {
  if (!userProfile) {
    const saved = localStorage.getItem('gdrive_user_profile');
    if (saved) {
      try {
        userProfile = JSON.parse(saved);
      } catch {
        userProfile = null;
      }
    }
  }
  return userProfile;
}

/**
 * Helper to extract detailed Google API error descriptions.
 */
async function parseGoogleError(res) {
  try {
    const data = await res.json();
    if (data.error) {
      let msg = data.error.message || `Status ${res.status}`;
      if (data.error.errors && data.error.errors.length > 0) {
        msg += ` (${data.error.errors[0].reason})`;
      }
      return msg;
    }
  } catch {
    // Ignore JSON parse failure
  }
  return `HTTP ${res.status}: ${res.statusText}`;
}

/**
 * Fetches basic Google user profile via Drive API.
 */
async function fetchUserInfo(token) {
  if (!token) return null;

  // 1. Try Google Drive about endpoint
  const driveRes = await fetch(`${DRIVE_API_URL}/about?fields=user`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  
  if (driveRes.ok) {
    const data = await driveRes.json();
    if (data.user) {
      userProfile = {
        name: data.user.displayName,
        email: data.user.emailAddress,
        picture: data.user.photoLink
      };
      localStorage.setItem('gdrive_user_profile', JSON.stringify(userProfile));
      return userProfile;
    }
  }

  if (driveRes.status === 401) {
    localStorage.removeItem('gdrive_access_token');
    accessToken = null;
    throw new Error('Google Drive session expired (401). Please sign in again.');
  }

  if (driveRes.status === 403) {
    const err = await parseGoogleError(driveRes);
    throw new Error(`Google Drive API Permission Denied (403): ${err}. Ensure Google Drive API is enabled in your Google Cloud Console.`);
  }

  // 2. Fallback to oauth2 userinfo endpoint
  const res = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
    headers: { Authorization: `Bearer ${token}` }
  });
  if (res.ok) {
    userProfile = await res.json();
    localStorage.setItem('gdrive_user_profile', JSON.stringify(userProfile));
    return userProfile;
  }

  const err = await parseGoogleError(res);
  throw new Error(`Failed to load Google user profile: ${err}`);
}

let vaultFolderPromise = null;

/**
 * Finds or creates the "Photo Vault" folder in Google Drive with mutex locking.
 */
export async function getOrCreateVaultFolder(token = getAccessToken()) {
  if (vaultFolderId) return vaultFolderId;
  if (!token) throw new Error('Not signed in to Google Drive. Please connect your account.');

  if (vaultFolderPromise) {
    return vaultFolderPromise;
  }

  vaultFolderPromise = (async () => {
    try {
      const q = "(name = 'Photo Vault' or name = 'Photo Vault (Compressed)') and mimeType = 'application/vnd.google-apps.folder' and trashed = false";
      const searchRes = await fetch(`${DRIVE_API_URL}/files?q=${encodeURIComponent(q)}&fields=files(id,name,createdTime)&orderBy=createdTime desc`, {
        headers: { Authorization: `Bearer ${token}` }
      });

      if (!searchRes.ok) {
        const err = await parseGoogleError(searchRes);
        throw new Error(`Google Drive search folder failed: ${err}`);
      }

      const searchData = await searchRes.json();

      if (searchData.files && searchData.files.length > 0) {
        vaultFolderId = searchData.files[0].id;
        console.log(`[GoogleDrive] 📁 Using existing Photo Vault folder (id: ${vaultFolderId})`);
        return vaultFolderId;
      }

      console.log('[GoogleDrive] 📁 Creating new Photo Vault folder in Google Drive...');
      const createRes = await fetch(`${DRIVE_API_URL}/files`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          name: 'Photo Vault',
          mimeType: 'application/vnd.google-apps.folder'
        })
      });

      if (!createRes.ok) {
        const err = await parseGoogleError(createRes);
        throw new Error(`Google Drive create folder failed: ${err}`);
      }

      const createData = await createRes.json();
      vaultFolderId = createData.id;
      console.log(`[GoogleDrive] 📁 Created Photo Vault folder (id: ${vaultFolderId})`);
      return vaultFolderId;
    } finally {
      vaultFolderPromise = null;
    }
  })();

  return vaultFolderPromise;
}

/**
 * Uploads a compressed container file directly to Google Drive using RFC 2387 multipart/related.
 */
export async function uploadFileToGoogleDrive(filename, data, mimeType = 'video/mp4', token = getAccessToken()) {
  if (!token) throw new Error('Not signed in to Google Drive.');

  const folderId = await getOrCreateVaultFolder(token);

  const metadata = {
    name: filename,
    mimeType,
    ...(folderId ? { parents: [folderId] } : {})
  };

  const blob = data instanceof Blob ? data : new Blob([data], { type: mimeType });

  const boundary = '-------314159265358979323846';
  const delimiter = `\r\n--${boundary}\r\n`;
  const close_delim = `\r\n--${boundary}--`;

  const multipartRequestBody = new Blob([
    delimiter,
    'Content-Type: application/json; charset=UTF-8\r\n\r\n',
    JSON.stringify(metadata),
    delimiter,
    `Content-Type: ${mimeType}\r\n\r\n`,
    blob,
    close_delim
  ]);

  console.log(`[GoogleDrive] ☁️ Uploading ${filename} (${(blob.size / 1024 / 1024).toFixed(2)}MB)...`);

  const res = await fetch(`${DRIVE_UPLOAD_URL}?uploadType=multipart&fields=id,name,webViewLink`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': `multipart/related; boundary=${boundary}`
    },
    body: multipartRequestBody
  });

  if (!res.ok) {
    const err = await parseGoogleError(res);
    console.error(`[GoogleDrive] ❌ Upload failed for ${filename}:`, err);
    throw new Error(`Google Drive upload failed for ${filename}: ${err}`);
  }

  const result = await res.json();
  console.log(`[GoogleDrive] ✅ Successfully uploaded ${filename} to Google Drive (id: ${result.id})`);
  return result;
}

/**
 * Lists all compressed containers saved in the Google Drive Photo Vault folder.
 */
export async function listVaultFilesFromGoogleDrive(token = getAccessToken()) {
  if (!token) return [];

  const folderId = await getOrCreateVaultFolder(token);
  if (!folderId) return [];

  const q = `'${folderId}' in parents and trashed = false`;
  const res = await fetch(`${DRIVE_API_URL}/files?q=${encodeURIComponent(q)}&fields=files(id,name,size,createdTime,webViewLink)`, {
    headers: { Authorization: `Bearer ${token}` }
  });

  if (!res.ok) {
    const err = await parseGoogleError(res);
    throw new Error(`Failed to list Google Drive files: ${err}`);
  }

  const data = await res.json();
  return data.files || [];
}

/**
 * Downloads a specific binary file from Google Drive.
 */
export async function downloadFileFromGoogleDrive(fileId, token = getAccessToken()) {
  if (!token || !fileId) return null;

  const res = await fetch(`${DRIVE_API_URL}/files/${fileId}?alt=media`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  
  if (!res.ok) {
    const err = await parseGoogleError(res);
    throw new Error(`Failed to download file from Google Drive: ${err}`);
  }

  const arrayBuffer = await res.arrayBuffer();
  return new Uint8Array(arrayBuffer);
}

/**
 * Gets a file's ID by name in the Photo Vault folder.
 */
export async function getFileIdByName(filename, token = getAccessToken()) {
  if (!token) return null;
  const folderId = await getOrCreateVaultFolder(token);
  if (!folderId) return null;

  const q = `'${folderId}' in parents and name = '${filename}' and trashed = false`;
  const res = await fetch(`${DRIVE_API_URL}/files?q=${encodeURIComponent(q)}&fields=files(id)`, {
    headers: { Authorization: `Bearer ${token}` }
  });

  if (!res.ok) return null;
  const data = await res.json();
  if (data.files && data.files.length > 0) {
    return data.files[0].id;
  }
  return null;
}

/**
 * Uploads a file, or updates it if it already exists in the Photo Vault.
 */
export async function uploadOrUpdateFileInGoogleDrive(filename, data, mimeType = 'application/json', token = getAccessToken()) {
  if (!token) throw new Error('Not signed in to Google Drive.');

  const existingFileId = await getFileIdByName(filename, token);
  const blob = data instanceof Blob ? data : new Blob([data], { type: mimeType });

  if (existingFileId) {
    console.log(`[GoogleDrive] 🔄 Updating ${filename} (id: ${existingFileId})...`);
    // Update existing file via PATCH
    const res = await fetch(`${DRIVE_UPLOAD_URL}/${existingFileId}?uploadType=media`, {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': mimeType
      },
      body: blob
    });

    if (!res.ok) {
      const err = await parseGoogleError(res);
      throw new Error(`Google Drive update failed for ${filename}: ${err}`);
    }
    const result = await res.json();
    console.log(`[GoogleDrive] ✅ Updated ${filename}`);
    return result;
  } else {
    return await uploadFileToGoogleDrive(filename, data, mimeType, token);
  }
}

/**
 * Deletes a file by name from the Photo Vault folder in Google Drive.
 */
export async function deleteFileFromGoogleDrive(filename, token = getAccessToken()) {
  if (!token) throw new Error('Not signed in to Google Drive.');
  
  const fileId = await getFileIdByName(filename, token);
  if (!fileId) return; // File doesn't exist, nothing to delete

  const res = await fetch(`${DRIVE_API_URL}/files/${fileId}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` }
  });

  if (!res.ok) {
    const err = await parseGoogleError(res);
    throw new Error(`Google Drive delete failed for ${filename}: ${err}`);
  }
}
