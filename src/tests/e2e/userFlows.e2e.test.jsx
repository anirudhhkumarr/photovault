import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import App from '../../App';
import { initDB, clearDB } from '../../lib/db';
import { renderWithCleanup } from '../testHelpers';

const mockAuth = vi.hoisted(() => ({
  connectDrive: vi.fn(),
  getProfile: vi.fn(),
  getAccessToken: vi.fn(),
  isAuthenticated: vi.fn()
}));

const mockDriveSync = vi.hoisted(() => ({
  uploadContainer: vi.fn(),
  syncFromDrive: vi.fn(),
  downloadContainer: vi.fn()
}));

vi.mock('../../lib/auth', () => mockAuth);
vi.mock('../../lib/driveSync', () => mockDriveSync);

describe('User Flows E2E', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    await initDB();
    
    // Default mock implementations
    mockAuth.connectDrive.mockResolvedValue({ token: '123', profile: { name: 'Test User' } });
    mockAuth.getProfile.mockReturnValue({ name: 'Test User', picture: '' });
    mockAuth.getAccessToken.mockReturnValue(null);
    mockAuth.isAuthenticated.mockReturnValue(false);

    mockDriveSync.uploadContainer.mockResolvedValue({ id: 'uploaded123' });
    mockDriveSync.syncFromDrive.mockResolvedValue(0);
    mockDriveSync.downloadContainer.mockResolvedValue({ blob: new Blob(['fake-video']), mimeType: 'video/mp4' });
    
    cleanup();
  });

  afterEach(() => {
    cleanup();
  });

  describe('Empty States & Unauthenticated UI', () => {
    it('renders Drag & Drop placeholder when no photos exist', () => {
      renderWithCleanup(<App />);
      expect(screen.getByText(/Drag & Drop Photos Here/i)).toBeInTheDocument();
    });
  });

  describe('Authentication & Error Handling', () => {
    it('handles and dismisses error banner smoothly', async () => {
      // Temporarily override auth mock behavior for this test
      mockAuth.connectDrive.mockRejectedValueOnce(new Error('Network disconnected'));
      
      renderWithCleanup(<App />);
      
      const connectBtn = screen.getByText(/Connect Drive/i);
      fireEvent.click(connectBtn);
      
      await waitFor(() => {
        expect(screen.getByText(/Network disconnected/i)).toBeInTheDocument();
      });
      
      const closeBtn = screen.getByTestId('close-error');
      fireEvent.click(closeBtn);
      
      await waitFor(() => {
        expect(screen.queryByText(/Network disconnected/i)).not.toBeInTheDocument();
      });
    });
  });

  describe('Photo Vault Pipeline', () => {
    it('runs the full upload, wipe, and sync lifecycle', async () => {
      // 1. Initial Render (Logged in on Device A)
      mockAuth.isAuthenticated.mockReturnValue(true);
      mockDriveSync.syncFromDrive.mockResolvedValueOnce(0);
      
      renderWithCleanup(<App />);
      
      // 2. Drop a file
      const file = new File(['hello'], 'test.jpg', { type: 'image/jpeg' });
      const dropzone = screen.getByText(/Drag & Drop Photos Here/i).closest('.glass');
      
      const dropEvent = new Event('drop', { bubbles: true });
      dropEvent.dataTransfer = { files: [file] };
      fireEvent(dropzone, dropEvent);
      
      // Wait for the UI to display the photo grid
      await waitFor(() => {
        // Look for the image source instead of just text since testing-library struggles with complex React nodes
        const imgs = document.querySelectorAll('img[src="data:image/jpeg;base64,mock"]');
        expect(imgs.length).toBeGreaterThan(0);
      }, { timeout: 3000 });

      // Verify mockDriveSync.uploadContainer was called in the background pipeline
      await waitFor(() => {
        expect(mockDriveSync.uploadContainer).toHaveBeenCalled();
      }, { timeout: 4000 });

      // 3. Simulate App Reset (Wipe local state for Device B)
      cleanup();
      await clearDB();

      // 4. Connect on New Device & Sync (Device B)
      mockAuth.isAuthenticated.mockReturnValue(false); // Start logged out on new device
      
      renderWithCleanup(<App />);
      
      mockDriveSync.syncFromDrive.mockImplementationOnce(async (addPhoto) => {
        await addPhoto({
          id: 'fakehash123',
          originalName: 'synced_test.jpg',
          type: 'image/jpeg',
          size: 500,
          createdAt: Date.now(),
          containerId: 'vault_fakehash123_0',
          containerOffset: 0,
          containerSize: 100,
          phash: { dHash: '1010' }
        });
        return 1;
      });

      mockAuth.connectDrive.mockResolvedValueOnce({ token: '123', profile: { name: 'Test User' } });
      mockAuth.isAuthenticated.mockReturnValue(true);
      
      const connectBtn2 = screen.getByText(/Connect Drive/i);
      fireEvent.click(connectBtn2);
      
      await waitFor(() => {
        const cards = document.querySelectorAll('.photo-card');
        expect(cards.length).toBeGreaterThan(0);
      }, { timeout: 3000 });
      
      // 5. Download Original Media
      // Mock container download
      mockDriveSync.downloadContainer.mockResolvedValueOnce({ blob: new Blob(['fake-video']), mimeType: 'video/mp4' });
      
      const cards = document.querySelectorAll('.photo-card');
      fireEvent.click(cards[0]); // Open inspector modal
      
      await waitFor(() => {
        expect(screen.getByText(/Download Original/i)).toBeInTheDocument();
      });
      
      const downloadBtn = screen.getByText(/Download Original/i);
      fireEvent.click(downloadBtn);
      
      await waitFor(() => {
        expect(mockDriveSync.downloadContainer).toHaveBeenCalledWith('vault_fakehash123_0');
      });
    });
  });
});
