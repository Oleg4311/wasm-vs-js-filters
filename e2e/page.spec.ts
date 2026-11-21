import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

async function quickRun(page: Page, opts: { size?: string; filter?: string } = {}) {
  await page.locator('#src').selectOption(opts.size ?? '0.25');
  await page.locator('#filter').selectOption(opts.filter ?? 'all');
  await page.locator('#runs').fill('3');
  await page.locator('#run').click();
  await expect(page.locator('#status')).toContainText('Готово', { timeout: 120_000 });
}

test.beforeEach(async ({ page }) => {
  await page.goto('./');
  await expect(page.locator('#env')).toContainText('SIMD'); // модули загружены
});

test('все пять фильтров: результаты JS и WebAssembly совпали побайтно, показаны время и ускорение', async ({ page }) => {
  await quickRun(page);
  const rows = page.locator('#res tbody tr');
  await expect(rows).toHaveCount(5);
  for (let i = 0; i < 5; i++) {
    await expect(rows.nth(i).locator('td').last()).toHaveText('да, побайтно');
    await expect(rows.nth(i).locator('td').nth(0)).toHaveText(/^\d/); // время JS
    await expect(rows.nth(i).locator('td').nth(3)).toHaveText(/^×\d/); // ускорение
  }
  await expect(rows.first().locator('th')).toHaveText('Оттенки серого');
  await expect(page.locator('#detail tbody tr')).toHaveCount(15); // 5 фильтров × 3 реализации
});

test('переключение режима «с копированием» меняет подпись и перерисовывает таблицу', async ({ page }) => {
  await quickRun(page, { filter: 'sharpen' });
  await expect(page.locator('#res-caption')).toContainText('данные уже в памяти');
  await page.getByLabel('С копированием').check();
  await expect(page.locator('#res-caption')).toContainText('включает копирование');
  await expect(page.locator('#res tbody tr')).toHaveCount(1);
});

test('один фильтр: три столбика на графике и картинка результата', async ({ page }) => {
  await quickRun(page, { filter: 'sobel' });
  await expect(page.locator('#chart rect')).toHaveCount(3);
  await expect(page.locator('#out-cap')).toContainText('Границы (Собель)');
  const w = await page.locator('#c-out').evaluate((c: HTMLCanvasElement) => c.width);
  expect(w).toBeGreaterThan(100);
  // у результата Собеля должны быть и тёмные, и светлые пиксели: картинка не пустая
  const spread = await page.locator('#c-out').evaluate((c: HTMLCanvasElement) => {
    const d = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data;
    let lo = 255;
    let hi = 0;
    for (let i = 0; i < d.length; i += 4) {
      lo = Math.min(lo, d[i]);
      hi = Math.max(hi, d[i]);
    }
    return hi - lo;
  });
  expect(spread).toBeGreaterThan(50);
});

test('своё изображение: загрузка файла, замер, совпадение результатов', async ({ page }) => {
  await page.locator('#src').selectOption('file');
  await page.locator('#run').click();
  await expect(page.locator('#error')).toContainText('выберите файл');
  // PNG 2×2 рисуется самой страницей, чтобы не зависеть от захардкоженных байтов
  const b64 = await page.evaluate(() => {
    const c = document.createElement('canvas');
    c.width = 2;
    c.height = 2;
    const x = c.getContext('2d')!;
    x.fillStyle = 'red';
    x.fillRect(0, 0, 1, 1);
    x.fillStyle = 'blue';
    x.fillRect(1, 1, 1, 1);
    return c.toDataURL('image/png').split(',')[1];
  });
  await page.locator('#file').setInputFiles({ name: 'tiny.png', mimeType: 'image/png', buffer: Buffer.from(b64, 'base64') });
  await expect(page.locator('#status')).toContainText('2×2');
  await page.locator('#filter').selectOption('box');
  await page.locator('#runs').fill('3');
  await page.locator('#run').click();
  await expect(page.locator('#status')).toContainText('Готово');
  await expect(page.locator('#res tbody tr td').last()).toHaveText('да, побайтно');
});

test('кнопка блокируется на время замера и возвращается после', async ({ page }) => {
  await page.locator('#src').selectOption('1');
  await page.locator('#runs').fill('5');
  await page.locator('#run').click();
  await expect(page.locator('#run')).toBeDisabled();
  await expect(page.locator('#status')).toContainText('Готово', { timeout: 180_000 });
  await expect(page.locator('#run')).toBeEnabled();
});

test('доступность (axe): светлая и тёмная тема, с результатами', async ({ page }) => {
  await quickRun(page, { filter: 'gaussian' });
  for (const scheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    const r = await new AxeBuilder({ page }).analyze();
    expect(r.violations.map((v) => `${v.id}: ${v.nodes[0]?.html}`), scheme).toEqual([]);
  }
});

test('на узком экране нет горизонтальной прокрутки страницы', async ({ page }) => {
  await quickRun(page);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});
