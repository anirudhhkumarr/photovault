import { test, expect } from '@playwright/test';

test.describe('Sync and Lazy Loading', () => {
  test.beforeEach(async ({ page }) => {
    page.on('console', msg => console.log('PAGE LOG:', msg.text()));
    page.on('requestfailed', request => console.log('REQ FAILED:', request.url(), request.failure().errorText));
    // Inject auth token
    await page.addInitScript(() => {
      localStorage.setItem('photovault_auth', JSON.stringify({
        accessToken: 'fake-token',
        profile: { name: 'Test User', picture: '' },
        expiresAt: Date.now() + 3600000
      }));
    });

    // Mock Google Drive search
    await page.route('**/drive/v3/files**', async route => {
      const url = route.request().url();
      // Handle the metadata file download
      if (url.includes('alt=media')) {
        return await route.fulfill({
          json: [{
            id: 'fakehash123',
            filename: 'synced-photo.jpg',
            mimeType: 'image/jpeg',
            originalSize: 12345,
            width: 800,
            height: 600,
            thumbnailDataUrl: 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP', // Fake base64
            videoId: 'vault_1690000000000_1_abcdefgh',
            frameIndex: 0,
            timestamp: 0.5,
            createdAt: 1690000000000
          }]
        });
      }

      if (url.includes('google-apps.folder')) {
        await route.fulfill({ json: { files: [{ id: 'mock-folder-id', name: 'PhotoVault' }] } });
      } else if (url.includes('metadata_vault_')) {
        // Return a mock metadata file for a vault containing 1 photo
        await route.fulfill({ 
          json: { 
            files: [{ 
              id: 'mock-metadata-id', 
              name: 'metadata_vault_1690000000000_1_abcdefgh.json' 
            }] 
          } 
        });
      } else {
        await route.fulfill({ json: { files: [] } });
      }
    });


  });

  test('should load skeletons from Drive and lazy load the real photos on intersection', async ({ page }) => {
    await page.goto('/');

    // Wait for the skeleton overlay to appear (auto-sync on mount)
    const photoCard = page.locator('.photo-card').first();
    await expect(photoCard).toBeVisible();

    // Since the IntersectionObserver will trigger immediately on load,
    // it will fetch the metadata JSON and replace the skeleton with the real photo.
    // Verify the real photo name is visible in the overlay
    await expect(photoCard.getByText('synced-photo.jpg')).toBeVisible({ timeout: 10000 });
  });
});
