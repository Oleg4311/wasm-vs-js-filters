// Замер в настоящем браузере (Chromium из Playwright) на собранной странице:
//   node scripts/bench-browser.mjs [мегапикселей=2] [повторов=11] [радиус=8] [--out файл.md]
// Страницу нужно собрать заранее (npm run site). Результат — таблица в Markdown с версией браузера и параметрами.
import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { chromium } from '@playwright/test';

const args = process.argv.slice(2);
const outIdx = args.indexOf('--out');
const out = outIdx >= 0 ? args.splice(outIdx, 2)[1] : null;
const mp = args[0] ?? '2';
const runs = args[1] ?? '11';
const radius = args[2] ?? '8';

const server = spawn(process.execPath, ['scripts/serve.mjs'], { stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 800));
let md = '';
try {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.goto('http://127.0.0.1:4184/');
  await page.locator('#env').waitFor();
  await page.locator('#src').selectOption(mp);
  await page.locator('#filter').selectOption('all');
  await page.locator('#radius').fill(radius);
  await page.locator('#runs').fill(runs);
  await page.locator('#run').click();
  await page.locator('#status', { hasText: 'Готово' }).waitFor({ timeout: 600_000 });
  const env = await page.locator('#env').innerText();
  const status = await page.locator('#status').innerText();
  const table = async (mode) => {
    await page.getByLabel(mode === 'compute' ? 'Только вычисление' : 'С копированием').check();
    return page.locator('#res tbody tr').evaluateAll((rows) => rows.map((r) => [...r.children].map((c) => c.textContent.trim())));
  };
  md += `Браузер: Chromium ${browser.version()}, ${env}\n\n${status}\n\n`;
  for (const [mode, title] of [['compute', 'Только вычисление'], ['pipeline', 'С копированием (ImageData → реализация → ImageData)']]) {
    md += `### ${title}\n\n| Фильтр | JavaScript, мс | WebAssembly, мс | WASM SIMD, мс | WASM быстрее JS | SIMD быстрее JS | Совпало |\n|---|---:|---:|---:|---:|---:|---|\n`;
    for (const r of await table(mode)) md += `| ${r.join(' | ')} |\n`;
    md += '\n';
  }
  await browser.close();
} finally {
  server.kill();
}
if (out) writeFileSync(out, md);
console.log(md);
