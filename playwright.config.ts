import { defineConfig, devices } from '@playwright/test';

const APP = 5174;
const PEER = 9123;

export default defineConfig({
  testDir: 'test/e2e',
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: `http://127.0.0.1:${APP}`,
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
  ],
  webServer: [
    { command: `npx vite --port ${APP} --strictPort --host 127.0.0.1`, port: APP, reuseExistingServer: false },
    { command: `node test/e2e/peer-server.mjs`, port: PEER, env: { PEER_PORT: String(PEER) }, reuseExistingServer: false },
  ],
});
