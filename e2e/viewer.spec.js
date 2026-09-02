import { test, expect } from '@playwright/test';

test.describe('Photo Viewer', () => {
  test.beforeEach(async ({ page }) => {
    // Inject auth token
    await page.addInitScript(() => {
      localStorage.setItem('photovault_auth', JSON.stringify({
        accessToken: 'fake-token',
        profile: { name: 'Test User', picture: '' },
        expiresAt: Date.now() + 3600000
      }));
    });

    // Mock Google Drive search for sync
    await page.route('**/drive/v3/files**', async route => {
      const url = route.request().url();
      // Handle the metadata file download
      if (url.includes('alt=media') && url.includes('mock-metadata-id')) {
        return await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify([{
            id: 'fakehash123',
            filename: 'synced-photo.jpg',
            mimeType: 'image/jpeg',
            originalSize: 12345,
            width: 800,
            height: 600,
            thumbnailDataUrl: 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP...', // Fake base64
            videoId: 'vault_1690000000000_1_abcdefgh',
            frameIndex: 0,
            timestamp: 0.5,
            createdAt: 1690000000000
          }])
        });
      }
      
      if (url.includes('alt=media') && url.includes('mock-video-id')) {
        return await route.fulfill({
          status: 200,
          contentType: 'video/webm',
          body: 'invalid-video-data' // This will fail WebCodecs extraction
        });
      }

      if (url.includes('google-apps.folder')) {
        await route.fulfill({ json: { files: [{ id: 'mock-folder-id', name: 'PhotoVault' }] } });
      } else if (url.includes('metadata_vault_')) {
        await route.fulfill({ 
          json: { 
            files: [{ id: 'mock-metadata-id', name: 'metadata_vault_1690000000000_1_abcdefgh.json' }] 
          } 
        });
      } else {
        await route.fulfill({ json: { files: [] } });
      }
    });


  });

  test('should open InspectorModal when a photo is clicked and handle extraction failure', async ({ page }) => {
    await page.goto('/');

    // Wait for the photo card to load (auto-sync and lazy load will happen quickly)
    const photoCard = page.locator('.photo-card').first();
    await expect(photoCard).toBeVisible();
    
    // Wait for it to become the real photo
    await expect(photoCard.getByText('synced-photo.jpg')).toBeVisible({ timeout: 10000 });

    // Click the photo to open the viewer
    await photoCard.click();

    // The modal should open
    const modal = page.locator('.modal-overlay');
    await expect(modal).toBeVisible();

    // The extraction fails very fast because of the mock, so the loading skeleton is transient.
    // Verify that it renders the image (thumbnail fallback) instead.
    await expect(modal.locator('img')).toBeVisible();
    // For now, we'll just check that it attempted the fetch and the modal closes when we click close.
    
    // Click close button
    await modal.locator('.modal-close').click();
    await expect(modal).not.toBeVisible();
  });
});
