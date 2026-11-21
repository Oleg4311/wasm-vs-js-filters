// Сборка страницы: два модуля WebAssembly, общие JS-модули, version.json с коммитом запуска.
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';

execFileSync(process.execPath, ['scripts/build-wasm.mjs'], { stdio: 'inherit' });

rmSync('site', { recursive: true, force: true });
mkdirSync('site/js', { recursive: true });
for (const f of ['filters.wasm', 'filters-simd.wasm']) copyFileSync(`dist-wasm/${f}`, `site/${f}`);
for (const f of readdirSync('js')) copyFileSync(`js/${f}`, `site/js/${f}`);
copyFileSync('site-src/index.html', 'site/index.html');
copyFileSync('site-src/app.js', 'site/app.js');

let commit = process.env.GITHUB_SHA;
if (!commit) {
  try {
    commit = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    commit = undefined;
  }
}
const version = /^version\s*=\s*"([^"]+)"/m.exec(readFileSync('Cargo.toml', 'utf8'))?.[1];
if (commit) writeFileSync('site/version.json', JSON.stringify({ commit, version, builtAt: new Date().toISOString() }, null, 2) + '\n');
console.log('site/ готов');
