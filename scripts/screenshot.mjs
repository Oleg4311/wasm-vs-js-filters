// Скриншот страницы с результатами для README: node scripts/screenshot.mjs (страница собрана: npm run site)
import { spawn } from 'node:child_process';
import { chromium } from '@playwright/test';

const server = spawn(process.execPath, ['scripts/serve.mjs'], { stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 800));
try {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1000, height: 900 }, deviceScaleFactor: 1 });
  await page.goto('http://127.0.0.1:4184/');
  await page.locator('#env').waitFor();
  await page.locator('#src').selectOption('1');
  await page.locator('#runs').fill('7');
  await page.locator('#run').click();
  await page.locator('#status', { hasText: 'Готово' }).waitFor({ timeout: 300_000 });
  await page.locator('#results-box').scrollIntoViewIfNeeded();
  await page.locator('main').screenshot({ path: 'docs/screenshot.png', clip: undefined });
  await browser.close();
} finally {
  server.kill();
}
