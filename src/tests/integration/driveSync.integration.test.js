import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as driveSync from '../../lib/driveSync';
import { searchFiles, createFolder, uploadMultipart, downloadFile } from '../../lib/apiClient';
import { isAuthenticated, getAccessToken } from '../../lib/auth';

vi.mock('../../lib/apiClient');
vi.mock('../../lib/auth');

describe('QA Edge Cases: Google Drive Sync', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(isAuthenticated).mockReturnValue(true);
    vi.mocked(getAccessToken).mockReturnValue('mock-token');
  });

  describe('uploadContainer Edge Cases', () => {
    it('throws a specific error when metadata JSON upload fails (Partial Sync / 500 Error)', async () => {
      // Mock folder exists
      vi.mocked(searchFiles).mockResolvedValue({ files: [{ id: 'folder1' }] });
      
      // Mock video upload succeeds
      vi.mocked(uploadMultipart).mockResolvedValueOnce({ id: 'video123' });
      
      // Mock metadata upload fails (500 Error / Timeout)
      vi.mocked(uploadMultipart).mockRejectedValueOnce(new Error('Network Timeout'));
      
      const payload = {
        groupId: 'testGroup',
        blob: new Blob(['']),
        manifest: {},
        fullPhotos: [{ id: 'photo1' }]
      };
      
      await expect(driveSync.uploadContainer(payload)).rejects.toThrow(/Critical failure/);
    });

    it('recreates folder gracefully if trashed mid-session', async () => {
      // First call simulates trashed folder (returns empty)
      vi.mocked(searchFiles).mockResolvedValueOnce({ files: [] });
      // createFolder succeeds
      vi.mocked(createFolder).mockResolvedValueOnce({ id: 'newFolderId' });
      // Video upload
      vi.mocked(uploadMultipart).mockResolvedValue({ id: 'vid' });
      
      const payload = {
        groupId: 'testGroup2',
        blob: new Blob(['']),
        manifest: {},
        fullPhotos: []
      };
      
      await driveSync.uploadContainer(payload);
      
      expect(vi.mocked(createFolder)).toHaveBeenCalledWith('Photo Vault');
      expect(vi.mocked(uploadMultipart)).toHaveBeenCalledTimes(2);
    });
  });

  describe('syncFromDrive Edge Cases', () => {
    it('gracefully handles corrupted JSON metadata and continues syncing other files', async () => {
      vi.mocked(searchFiles).mockResolvedValueOnce({ files: [{ id: 'folder1' }] });
      vi.mocked(searchFiles).mockResolvedValueOnce({ files: [
        { id: 'meta1', name: 'metadata_vault_1.json' },
        { id: 'meta2', name: 'metadata_vault_2.json' }
      ] });
      
      // Download 1 fails (Invalid JSON)
      vi.mocked(downloadFile).mockRejectedValueOnce(new Error('Invalid JSON'));
      
      // Download 2 succeeds
      vi.mocked(downloadFile).mockResolvedValueOnce([{ id: 'valid_photo' }]);
      
      const addPhotoMock = vi.fn();
      const count = await driveSync.syncFromDrive(addPhotoMock);
      
      // Even though meta1 failed, meta2 should succeed, resulting in 1 synced photo
      expect(count).toBe(1);
      expect(addPhotoMock).toHaveBeenCalledWith({ id: 'valid_photo' });
    });
  });

  describe('downloadContainer Edge Cases', () => {
    it('throws explicit error if container is deleted remotely', async () => {
      vi.mocked(searchFiles).mockResolvedValueOnce({ files: [{ id: 'folder1' }] });
      vi.mocked(searchFiles).mockResolvedValueOnce({ files: [] }); // Video not found
      
      await expect(driveSync.downloadContainer('deleted_vid')).rejects.toThrow(/Video container not found/);
    });
  });
});
