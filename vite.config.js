import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig({
  base: './',
  plugins: [react()],
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/tests/testHelpers.js'],
    browser: {
      enabled: true,
      name: 'chromium',
      provider: 'playwright',
      // Disable screenshot failures as per spec
      screenshotFailures: false,
    }
  }
})
