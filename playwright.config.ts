import { defineConfig } from '@playwright/test';

const port = 4173;

export default defineConfig({
  testDir: 'e2e',
  fullyParallel: false,
  workers: 1,
  use: { baseURL: `http://localhost:${port}` },
  webServer: {
    command: 'node e2e/server.ts',
    env: { PORT: String(port) },
    url: `http://localhost:${port}/health`,
    reuseExistingServer: false,
  },
});
