import { test, expect } from '@playwright/test';

test.describe('Multi-device Sync Flow', () => {
  let mockDriveState = {
    files: [], 
  };

  test.beforeEach(() => {
    mockDriveState.files = [];
  });

  const setupMockGoogleAPI = async (page) => {
    // 0. Mock internal app pipeline that uses hardware APIs
    await page.addInitScript(() => {
      window.__E2E_MOCKS__ = {
        phash: {
          analyzeVisualFeatures: async (f) => ({
            dHash: '1010', hsvHist: [], spatialBlocks: [], thumbnailDataUrl: 'data:image/jpeg;base64,mock'
          }),
          isSameScene: () => true
        },
        image: {
          createImageBitmap: async (f) => ({ width: 100, height: 100, close: () => {} })
        },
        encoder: {
          encodeContainer: async (cluster, onProgress) => {
             onProgress('Mock encoding...');
             return { 
               blob: new window.Blob(['fake-video']), 
               mimeType: 'video/mp4', 
               manifest: { c: 'MP4', p: cluster.map(c => ({ h: c.id })) } 
             };
          },
          extractFrame: async () => 'data:image/jpeg;base64,mockedframe'
        }
      };
    });

    // 1. Mock GIS Script Injection
    await page.route('https://accounts.google.com/gsi/client', async route => {
      await route.fulfill({
        status: 200,
        contentType: 'application/javascript',
        body: `
          window.google = {
            accounts: {
              oauth2: {
                initTokenClient: (config) => {
                  return {
                    callback: config.callback,
                    requestAccessToken: function() {
                      setTimeout(() => {
                        if (this.callback) this.callback({ access_token: 'mock-token' });
                        else if (config.callback) config.callback({ access_token: 'mock-token' });
                      }, 50);
                    }
                  }
                }
              }
            }
          };
        `
      });
    });

    // 2. Mock User Profile
    await page.route('https://www.googleapis.com/oauth2/v1/userinfo*', async route => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ id: '123', name: 'Test User', picture: '' })
      });
    });

    // 3. Mock Google Drive Upload (multipart)
    await page.route('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart*', async route => {
      if (route.request().method() === 'POST') {
        console.log('Upload request received');
        const postData = route.request().postData();
        
        const jsonMatch = postData.match(/\{[\s\S]*?\}/);
        let metadata = { name: 'mock-file', mimeType: 'video/mp4' };
        if (jsonMatch) {
            try {
                metadata = JSON.parse(jsonMatch[0]);
            } catch (e) {}
        }
        console.log('Uploaded file:', metadata.name);
        
        const fileId = 'file_' + Date.now() + Math.random().toString(36).substring(7);
        const newFile = {
            id: fileId,
            name: metadata.name,
            mimeType: metadata.mimeType,
            parents: metadata.parents || ['appDataFolder'],
            content: postData, 
            _metadata: metadata
        };
        
        if (metadata.name.endsWith('.json')) {
           const parts = postData.split('Content-Type: application/json');
           if (parts.length > 2) {
               const contentPart = parts[2].split('--')[0].trim();
               newFile.rawContent = contentPart;
           }
        }

        mockDriveState.files.push(newFile);

        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ id: fileId, name: metadata.name, mimeType: metadata.mimeType })
        });
      } else {
        await route.continue();
      }
    });

    // 4. Mock Drive search queries
    await page.route('https://www.googleapis.com/drive/v3/files?q=*', async route => {
      const url = new URL(route.request().url());
      const q = url.searchParams.get('q');
      console.log('Query received:', q);
      
      let resultFiles = mockDriveState.files;
      if (q.includes("name = 'Photo Vault'")) {
          const folder = mockDriveState.files.find(f => f.mimeType === 'application/vnd.google-apps.folder');
          resultFiles = folder ? [folder] : [];
      } else if (q.includes("mimeType='application/vnd.google-apps.folder'")) {
          resultFiles = mockDriveState.files.filter(f => f.mimeType === 'application/vnd.google-apps.folder');
      } else {
          // Normal file query in a folder
          resultFiles = mockDriveState.files.filter(f => f.mimeType !== 'application/vnd.google-apps.folder');
          if (q.includes("name contains 'metadata_vault_'") || q.includes("name contains 'tombstone_'")) {
              resultFiles = resultFiles.filter(f => f.name.includes('metadata_vault_') || f.name.includes('tombstone_'));
          }
      }
      
      console.log('Query result count:', resultFiles.length);

      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ files: resultFiles })
      });
    });
    
    // Create folder mock
    await page.route('https://www.googleapis.com/drive/v3/files', async route => {
        if (route.request().method() === 'POST') {
             const body = JSON.parse(route.request().postData());
             if (body.mimeType === 'application/vnd.google-apps.folder') {
                 const newFolder = {
                     id: 'folder_' + Date.now(),
                     name: body.name,
                     mimeType: body.mimeType,
                 };
                 mockDriveState.files.push(newFolder);
                 await route.fulfill({ json: newFolder });
             } else {
                 await route.continue();
             }
        } else {
            await route.continue();
        }
    });

    // 5. Mock file download
    await page.route('https://www.googleapis.com/drive/v3/files/*?alt=media', async route => {
      const url = route.request().url();
      const match = url.match(/files\/([^\?]+)/);
      const fileId = match ? match[1] : null;
      
      const file = mockDriveState.files.find(f => f.id === fileId);
      console.log('Fetching media for:', fileId, file ? file.name : 'Not found');
      if (file && file.name.endsWith('.json')) {
          console.log('Returning JSON content:', file.rawContent);
          await route.fulfill({
              status: 200,
              contentType: 'application/json',
              body: file.rawContent || '[]'
          });
      } else if (file && (file.mimeType === 'video/mp4' || file.mimeType === 'video/webm')) {
          await route.fulfill({
              status: 200,
              contentType: file.mimeType,
              body: Buffer.from('')
          });
      } else {
          await route.fulfill({ status: 404, body: 'Not found' });
      }
    });
  };

  test('Upload from Device A syncs to Device B', async ({ browser }) => {
    const contextA = await browser.newContext();
    const pageA = await contextA.newPage();
    pageA.on('console', msg => console.log('Device A:', msg.text()));
    pageA.on('pageerror', err => console.log('Device A Uncaught Error:', err.message));
    await setupMockGoogleAPI(pageA);

    await pageA.goto('/');

    // 1. Device A: Connect and Upload
    await pageA.click('button:has-text("Connect Drive")');
    await expect(pageA.locator('text=Test User')).toBeVisible();
    
    // Upload a photo
    const [fileChooser] = await Promise.all([
      pageA.waitForEvent('filechooser'),
      pageA.click('button:has-text("Select Files")')
    ]);
    
    await fileChooser.setFiles('e2e/fixtures/test-photo.jpg');
    
    // Wait for upload to complete and card to appear
    await expect(pageA.locator('.photo-card')).toHaveCount(1, { timeout: 15000 });

    // 2. Device B: Connect and Sync
    const contextB = await browser.newContext();
    const pageB = await contextB.newPage();
    pageB.on('console', msg => console.log('Device B:', msg.text()));
    pageB.on('pageerror', err => console.log('Device B Uncaught Error:', err.message));
    await setupMockGoogleAPI(pageB);

    await pageB.goto('/');
    
    await pageB.click('button:has-text("Connect Drive")');
    await expect(pageB.locator('text=Test User')).toBeVisible();

    // It should sync and display the same photo
    await expect(pageB.locator('.photo-card')).toHaveCount(1, { timeout: 10000 });
  });

  test('Session persists across page reloads and can sign out', async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    await setupMockGoogleAPI(page);

    await page.goto('/');

    // Connect
    await page.click('button:has-text("Connect Drive")');
    await expect(page.locator('text=Test User')).toBeVisible();

    // Reload the page
    await page.reload();

    // Verify user is still logged in without clicking connect
    await expect(page.locator('text=Test User')).toBeVisible({ timeout: 5000 });
    
    // Sign Out
    await page.click('button[title="Sign Out"]');
    await expect(page.locator('button:has-text("Connect Drive")')).toBeVisible();
    
    // Reload again, should stay logged out
    await page.reload();
    await expect(page.locator('button:has-text("Connect Drive")')).toBeVisible();
  });

  test('Background Polling and Deletion Sync', async ({ browser }) => {
    const contextA = await browser.newContext();
    const pageA = await contextA.newPage();
    
    // Speed up background polling for tests
    await pageA.addInitScript(() => { window.__E2E_SYNC_INTERVAL__ = 2000; });
    await setupMockGoogleAPI(pageA);
    await pageA.goto('/');
    
    await pageA.click('button:has-text("Connect Drive")');
    
    const [fileChooser] = await Promise.all([
      pageA.waitForEvent('filechooser'),
      pageA.click('button:has-text("Select Files")')
    ]);
    await fileChooser.setFiles('e2e/fixtures/test-photo.jpg');
    await expect(pageA.locator('.photo-card')).toHaveCount(1, { timeout: 15000 });

    const contextB = await browser.newContext();
    const pageB = await contextB.newPage();
    await pageB.addInitScript(() => { window.__E2E_SYNC_INTERVAL__ = 2000; });
    await setupMockGoogleAPI(pageB);
    await pageB.goto('/');
    
    await pageB.click('button:has-text("Connect Drive")');
    await expect(pageB.locator('.photo-card')).toHaveCount(1, { timeout: 10000 });

    // Device A deletes the photo
    await pageA.click('.photo-card');
    pageA.on('dialog', dialog => dialog.accept()); // Accept confirm alert
    await pageA.click('button[title="Delete Photo"]');
    
    // Photo should be removed from Device A UI
    await expect(pageA.locator('.photo-card')).toHaveCount(0);
    
    // Device B should automatically delete the photo via background polling without reload!
    await expect(pageB.locator('.photo-card')).toHaveCount(0, { timeout: 15000 });
  });
});
