import { defineConfig } from '@playwright/test';

// scripts/run-e2e.mts starts the servers of the run on ports that the system assigns and passes their addresses in
// HYPER_E2E_SSR and HYPER_E2E_CSR (tests/e2e/origins.ts); every case keeps the default timeout of Playwright.
export default defineConfig({
  testDir: '.',
  fullyParallel: false,
  workers: 1,
});
