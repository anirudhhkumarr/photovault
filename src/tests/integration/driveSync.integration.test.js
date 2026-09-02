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
    it('gracefully handles addPhoto failures and continues creating skeletons for other files', async () => {
      vi.mocked(searchFiles).mockResolvedValueOnce({ files: [{ id: 'folder1' }] });
      vi.mocked(searchFiles).mockResolvedValueOnce({ files: [
        { id: 'meta1', name: 'metadata_vault_1690000000_1_abc.json' },
        { id: 'meta2', name: 'metadata_vault_1690000000_2_def.json' }
      ] });
      
      const addPhotoMock = vi.fn()
        .mockRejectedValueOnce(new Error('DB Error')) // Fails for the 1st skeleton of meta1
        .mockResolvedValue(); // Succeeds for the 2 skeletons of meta2
        
      const count = await driveSync.syncFromDrive(addPhotoMock);
      
      // Even though the first skeleton failed to save, it should continue and save the next 2.
      expect(count).toBe(2);
      expect(addPhotoMock).toHaveBeenCalledTimes(3);
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
