/**
 * Authentication and Google Identity Services Layer
 * Handles script loading, OAuth token retrieval, and user profile state.
 */

const CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID || '548261245531-cr6ib16n7vcqjqjcktl4mq7mbe09hvq9.apps.googleusercontent.com';
const SCOPES = 'https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/userinfo.profile https://www.googleapis.com/auth/userinfo.email';

let accessToken = null;
let gisInitialized = false;
let tokenClient = null;
let googleProfile = null;

export async function loadGis() {
  if (gisInitialized) return;

  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://accounts.google.com/gsi/client';
    script.async = true;
    script.defer = true;
    
    script.onload = () => {
      tokenClient = window.google.accounts.oauth2.initTokenClient({
        client_id: CLIENT_ID,
        scope: SCOPES,
        callback: '' // Will be defined during request
      });
      gisInitialized = true;
      resolve();
    };
    
    script.onerror = () => reject(new Error('Failed to load Google Identity Services script'));
    document.body.appendChild(script);
  });
}

export function initAuth() {
  const stored = sessionStorage.getItem('photovault_auth');
  if (stored) {
    try {
      const data = JSON.parse(stored);
      if (data.expiresAt > Date.now()) {
        accessToken = data.accessToken;
        googleProfile = data.profile;
        return true;
      } else {
        sessionStorage.removeItem('photovault_auth');
      }
    } catch (e) {
      console.error('Failed to parse auth data', e);
    }
  }
  return false;
}

export async function connectDrive() {
  await loadGis();
  
  return new Promise((resolve, reject) => {
    tokenClient.callback = async (resp) => {
      if (resp.error) {
        return reject(new Error(`OAuth Error: ${resp.error}`));
      }
      
      accessToken = resp.access_token;
      
      try {
        const profileResp = await fetch('https://www.googleapis.com/oauth2/v1/userinfo?alt=json', {
          headers: { Authorization: `Bearer ${accessToken}` }
        });
        
        if (!profileResp.ok) throw new Error("Failed to fetch profile");
        
        googleProfile = await profileResp.json();
        
        const expiresIn = resp.expires_in || 3600;
        const expiresAt = Date.now() + (expiresIn * 1000);
        sessionStorage.setItem('photovault_auth', JSON.stringify({
          accessToken,
          profile: googleProfile,
          expiresAt
        }));
        
        resolve({ token: accessToken, profile: googleProfile });
      } catch (err) {
        console.error("Failed to fetch user profile", err);
        reject(err);
      }
    };
    
    tokenClient.requestAccessToken({ prompt: 'consent' });
  });
}

export function getProfile() {
  return googleProfile;
}

export function getAccessToken() {
  return accessToken;
}

export function isAuthenticated() {
  return !!accessToken;
}

export function disconnectDrive() {
  accessToken = null;
  googleProfile = null;
  sessionStorage.removeItem('photovault_auth');
}
