/**
 * Generic Google Drive API Client
 * Wraps fetch calls with authentication and standardizes multipart uploads.
 */

import { getAccessToken, isAuthenticated } from './auth';

const DRIVE_API_URL = 'https://www.googleapis.com/drive/v3/files';
const DRIVE_UPLOAD_URL = 'https://www.googleapis.com/upload/drive/v3/files';

function getHeaders(extraHeaders = {}) {
  if (!isAuthenticated()) {
    throw new Error("Not authenticated with Google Drive");
  }
  return {
    Authorization: `Bearer ${getAccessToken()}`,
    ...extraHeaders
  };
}

export async function createFolder(name) {
  const resp = await fetch(DRIVE_API_URL, {
    method: 'POST',
    headers: getHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({
      name,
      mimeType: 'application/vnd.google-apps.folder'
    })
  });
  
  if (!resp.ok) {
    const errorMsg = await resp.text();
    throw new Error(`Failed to create folder: ${resp.status} ${errorMsg}`);
  }
  
  return await resp.json();
}

export async function searchFiles(query, fields = 'files(id, name, mimeType)') {
  const url = `${DRIVE_API_URL}?q=${encodeURIComponent(query)}&fields=${encodeURIComponent(fields)}&spaces=drive`;
  
  const resp = await fetch(url, {
    headers: getHeaders()
  });
  
  if (!resp.ok) {
    const errorMsg = await resp.text();
    throw new Error(`Search query failed: ${resp.status} ${errorMsg}`);
  }
  
  return await resp.json();
}

export async function downloadFile(fileId, responseType = 'json') {
  const resp = await fetch(`${DRIVE_API_URL}/${fileId}?alt=media`, {
    headers: getHeaders()
  });
  
  if (!resp.ok) {
    const errorMsg = await resp.text();
    throw new Error(`Failed to download file: ${resp.status} ${errorMsg}`);
  }
  
  if (responseType === 'blob') {
    return await resp.blob();
  }
  return await resp.json();
}

export async function deleteFile(fileId) {
  const resp = await fetch(`${DRIVE_API_URL}/${fileId}`, {
    method: 'DELETE',
    headers: getHeaders()
  });
  
  if (!resp.ok) {
    const errorMsg = await resp.text();
    throw new Error(`Failed to delete file: ${resp.status} ${errorMsg}`);
  }
}

/**
 * Perform a multipart upload to Google Drive
 * @param {Object} metadata The JSON metadata for the file (name, parents, etc)
 * @param {Blob} mediaBlob The binary content
 * @returns {Promise<Object>} The uploaded file's metadata
 */
export async function uploadMultipart(metadata, mediaBlob) {
  const boundary = '-------314159265358979323846';
  const delimiter = `\r\n--${boundary}\r\n`;
  const closeDelim = `\r\n--${boundary}--`;

  const metaPart = `Content-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}`;
  const mediaPart = `Content-Type: ${mediaBlob.type}\r\n\r\n`;

  const blobParts = [
    new Blob([delimiter + metaPart + delimiter + mediaPart]),
    mediaBlob,
    new Blob([closeDelim])
  ];
  
  const multipartBlob = new Blob(blobParts, { type: `multipart/related; boundary=${boundary}` });

  const resp = await fetch(`${DRIVE_UPLOAD_URL}?uploadType=multipart`, {
    method: 'POST',
    headers: getHeaders({
      'Content-Type': `multipart/related; boundary=${boundary}`,
      'Content-Length': multipartBlob.size.toString()
    }),
    body: multipartBlob
  });

  if (!resp.ok) {
    const errorMsg = await resp.text();
    throw new Error(`Multipart upload failed: ${resp.status} ${errorMsg}`);
  }
  
  return await resp.json();
}

/**
 * Perform a multipart update to an existing Google Drive file
 * @param {string} fileId The Drive file ID to update
 * @param {Object} metadata The JSON metadata for the file (name, etc)
 * @param {Blob} mediaBlob The binary content
 * @returns {Promise<Object>} The updated file's metadata
 */
export async function updateMultipart(fileId, metadata, mediaBlob) {
  const boundary = '-------314159265358979323846';
  const delimiter = `\r\n--${boundary}\r\n`;
  const closeDelim = `\r\n--${boundary}--`;

  const metaPart = `Content-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}`;
  const mediaPart = `Content-Type: ${mediaBlob.type}\r\n\r\n`;

  const blobParts = [
    new Blob([delimiter + metaPart + delimiter + mediaPart]),
    mediaBlob,
    new Blob([closeDelim])
  ];
  
  const multipartBlob = new Blob(blobParts, { type: `multipart/related; boundary=${boundary}` });

  const resp = await fetch(`${DRIVE_UPLOAD_URL}/${fileId}?uploadType=multipart`, {
    method: 'PATCH',
    headers: getHeaders({
      'Content-Type': `multipart/related; boundary=${boundary}`,
      'Content-Length': multipartBlob.size.toString()
    }),
    body: multipartBlob
  });

  if (!resp.ok) {
    const errorMsg = await resp.text();
    throw new Error(`Multipart update failed: ${resp.status} ${errorMsg}`);
  }
  
  return await resp.json();
}
