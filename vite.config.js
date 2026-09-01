import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    browser: {
      enabled: false,
      name: 'chromium',
      provider: 'playwright',
      // Disable screenshot failures as per spec
      screenshotFailures: false,
    }
  }
})
