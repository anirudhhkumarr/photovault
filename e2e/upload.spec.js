import { test, expect } from '@playwright/test';
import path from 'path';

test.describe('Upload and Deduplication', () => {
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

    // Mock Google Drive search (folder exists, no metadata files yet)
    await page.route('**/drive/v3/files**', async route => {
      const url = route.request().url();
      if (url.includes('google-apps.folder')) {
        await route.fulfill({ json: { files: [{ id: 'mock-folder-id', name: 'PhotoVault' }] } });
      } else if (url.includes('metadata_vault_')) {
        await route.fulfill({ json: { files: [] } }); // No remote vaults
      } else {
        await route.fulfill({ json: { files: [] } });
      }
    });

    // Mock Google Drive multipart uploads (JSON metadata and video container)
    await page.route('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart', async route => {
      await route.fulfill({ json: { id: `mock-file-${Date.now()}` } });
    });
  });

  test('should upload a photo and instantly deduplicate an identical photo', async ({ page }) => {
    await page.goto('/');

    // Ensure we are logged in
    await expect(page.getByText('Test User')).toBeVisible();

    // The hidden file input
    const fileInput = page.locator('input[type="file"]').first();
    
    // 1. Upload the first photo
    await fileInput.setInputFiles('e2e/fixtures/test-photo.jpg');

    // Wait for the photo card to appear and eventually show "SYNCED"
    // The pipeline goes: PENDING -> PACKING -> UPLOADING -> SYNCED
    const photoCard = page.locator('.photo-card').first();
    await expect(photoCard).toBeVisible();
    
    // It should eventually reach synced state (spinner disappears)
    await expect(photoCard.locator('.skeleton-overlay')).not.toBeVisible({ timeout: 15000 });

    // 2. Upload the exact same photo again
    await fileInput.setInputFiles('e2e/fixtures/test-photo.jpg');

    // It should instantly skip and show a toast or just not add a new photo card
    // Since it's a duplicate, the grid should still only have exactly 1 photo card!
    await page.waitForTimeout(1000); // Wait a second to ensure no processing happens
    const photoCards = await page.locator('.photo-card').count();
    expect(photoCards).toBe(1);
  });
});
