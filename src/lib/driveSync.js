/**
 * Cross-Browser Storage & Folder Sync (Supports Safari, Chrome, Edge, iOS)
 * 
 * - Chrome/Edge: Native File System Access API (showDirectoryPicker)
 * - Safari/iOS: Origin Private File System (OPFS) + Web Share / Direct Downloads
 */

let directoryHandle = null;
let opfsRoot = null;

// Initialize OPFS (Supported natively in Safari 15.2+, Chrome, Edge, Firefox)
async function getOPFS() {
  if (!opfsRoot && typeof navigator !== 'undefined' && navigator.storage?.getDirectory) {
    try {
      opfsRoot = await navigator.storage.getDirectory();
    } catch (e) {
      console.warn('OPFS initialization failed:', e);
    }
  }
  return opfsRoot;
}

export function isFileSystemAccessSupported() {
  return typeof window !== 'undefined' && 'showDirectoryPicker' in window;
}

/**
 * Prompts user to select a storage folder (or initializes private sandbox on Safari).
 */
export async function pickStorageFolder() {
  if (isFileSystemAccessSupported()) {
    try {
      directoryHandle = await window.showDirectoryPicker({
        mode: 'readwrite',
        startIn: 'documents'
      });
      return directoryHandle.name;
    } catch (e) {
      if (e.name === 'AbortError') return null;
      console.warn('Directory picker fallback:', e);
    }
  }

  // Safari / iOS Fallback: Use OPFS Private Vault
  const opfs = await getOPFS();
  if (opfs) {
    return 'Private Safari Storage';
  }

  return 'Local Device Vault';
}

export function getConnectedFolderName() {
  return directoryHandle ? directoryHandle.name : null;
}

/**
 * Saves a compressed container file across all browsers.
 */
export async function saveFileToStorageFolder(filename, data) {
  // 1. If Chrome/Edge directory handle is connected
  if (directoryHandle) {
    try {
      const fileHandle = await directoryHandle.getFileHandle(filename, { create: true });
      const writable = await fileHandle.createWritable();
      await writable.write(data);
      await writable.close();
      return true;
    } catch (e) {
      console.warn('Direct directory write failed:', e);
    }
  }

  // 2. Safari / iOS OPFS storage
  const opfs = await getOPFS();
  if (opfs) {
    try {
      const fileHandle = await opfs.getFileHandle(filename, { create: true });
      const accessHandle = await fileHandle.createWritable ? await fileHandle.createWritable() : null;
      if (accessHandle) {
        await accessHandle.write(data);
        await accessHandle.close();
        return true;
      }
    } catch (e) {
      console.warn('OPFS write failed:', e);
    }
  }

  return false;
}

/**
 * Universal downloader / exporter for Safari and all browsers.
 */
export function downloadFileDirectly(filename, data, mimeType = 'video/mp4') {
  const blob = data instanceof Blob ? data : new Blob([data], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
