import { defineConfig, devices } from '@playwright/test';

// BASE_URL задаётся для проверки опубликованной версии, иначе тесты идут на локальной сборке.
const live = process.env.BASE_URL;

export default defineConfig({
  testDir: 'e2e',
  fullyParallel: true,
  reporter: [['list']],
  use: { baseURL: live ?? 'http://127.0.0.1:4184/' },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
    { name: 'mobile', use: { ...devices['Pixel 7'] } },
  ],
  webServer: live
    ? undefined
    : {
        command: 'npm run site && npm run serve',
        url: 'http://127.0.0.1:4184/',
        reuseExistingServer: !process.env.CI,
        timeout: 60_000,
      },
});
