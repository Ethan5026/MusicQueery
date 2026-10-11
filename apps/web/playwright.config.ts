// Playwright WebKit smoke tests (D-15) against the production build served by `vite preview`.
// The viewport is an iPhone 17 Home Screen app minus its safe areas (402 × 874 pt − 62 top − 34 bottom).
import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: 'e2e',
  testMatch: '**/*.e2e.ts',
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: 'http://127.0.0.1:4173',
    serviceWorkers: 'allow',
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'webkit-iphone17',
      use: { ...devices['iPhone 17'], viewport: { width: 402, height: 778 }, browserName: 'webkit' },
    },
  ],
  webServer: {
    command: 'pnpm build && pnpm exec vite preview --host 127.0.0.1 --port 4173 --strictPort',
    url: 'http://127.0.0.1:4173',
    reuseExistingServer: true,
    timeout: 120_000,
  },
})
