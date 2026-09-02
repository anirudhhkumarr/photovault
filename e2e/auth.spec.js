import { test, expect } from '@playwright/test';

test.describe('Authentication', () => {
  test.beforeEach(async ({ page }) => {
    // Mock the Google Identity Services script
    await page.route('https://accounts.google.com/gsi/client', async route => {
      await route.fulfill({
        status: 200,
        contentType: 'application/javascript',
        body: `
          window.google = {
            accounts: {
              oauth2: {
                initTokenClient: (config) => {
                  const client = {
                    callback: config.callback,
                    requestAccessToken: () => {
                      setTimeout(() => client.callback({ access_token: 'fake-token', expires_in: 3600 }), 50);
                    }
                  };
                  return client;
                }
              }
            }
          };
        `
      });
    });

    // Mock the user profile fetch
    await page.route('https://www.googleapis.com/oauth2/v1/userinfo*', async route => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          id: '123456789',
          name: 'Test User',
          email: 'test@example.com',
          picture: 'https://example.com/avatar.jpg'
        })
      });
    });
  });

  test('should login and save token to localStorage', async ({ page }) => {
    await page.goto('/');

    // Wait for the landing page
    const connectBtn = page.getByRole('button', { name: /connect google drive/i });
    await expect(connectBtn).toBeVisible();

    // Click Connect
    await connectBtn.click();

    // Verify header updates to show user profile
    await expect(page.getByText('Test User')).toBeVisible();

    // Verify localStorage has the token
    const authData = await page.evaluate(() => localStorage.getItem('photovault_auth'));
    expect(authData).toContain('fake-token');
    expect(authData).toContain('Test User');
  });

  test('should restore session from localStorage', async ({ page }) => {
    // Inject fake token before loading
    await page.addInitScript(() => {
      localStorage.setItem('photovault_auth', JSON.stringify({
        accessToken: 'pre-existing-token',
        profile: { name: 'Restored User', picture: '' },
        expiresAt: Date.now() + 3600000
      }));
    });

    await page.goto('/');

    // Verify it automatically logs in
    await expect(page.getByText('Restored User')).toBeVisible();
    await expect(page.getByRole('button', { name: /connect google drive/i })).not.toBeVisible();
  });

  test('should disconnect and clear localStorage', async ({ page }) => {
    // Inject fake token before loading
    await page.addInitScript(() => {
      localStorage.setItem('photovault_auth', JSON.stringify({
        accessToken: 'pre-existing-token',
        profile: { name: 'Restored User', picture: '' },
        expiresAt: Date.now() + 3600000
      }));
    });

    await page.goto('/');
    
    // Click disconnect button
    const disconnectBtn = page.getByTitle('Sign Out');
    await disconnectBtn.click();

    // Should show landing page
    await expect(page.getByRole('button', { name: /connect google drive/i })).toBeVisible();

    // Verify localStorage is cleared
    const authData = await page.evaluate(() => localStorage.getItem('photovault_auth'));
    expect(authData).toBeNull();
  });
});
