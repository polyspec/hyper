import { defineConfig } from '@playwright/test';

export const ports = { ssr: 8090, edge: 8091, api: 8093 };

export default defineConfig({
  testDir: 'tests/e2e',
  fullyParallel: false,
  workers: 1,
  webServer: {
    command: `node scripts/serve-demo.mjs --db examples/board/var/e2e.db --ssr ${ports.ssr} --edge ${ports.edge} --api ${ports.api}`,
    url: `http://127.0.0.1:${ports.edge}/compare`,
    reuseExistingServer: false,
  },
});
