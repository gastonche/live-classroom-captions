// End-to-end checks against the production build (service worker, manifest, offline).
// Run after `npm run build`.
import { defineConfig, devices } from '@playwright/test';

const APP = 4174;

export default defineConfig({
  testDir: 'test/prod',
  timeout: 60_000,
  workers: 1,
  reporter: [['list']],
  use: { baseURL: `http://127.0.0.1:${APP}` },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: { command: `npx vite preview --port ${APP} --strictPort --host 127.0.0.1`, port: APP, reuseExistingServer: false },
});
