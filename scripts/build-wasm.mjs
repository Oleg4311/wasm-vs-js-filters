// Собирает два варианта модуля: обычный и с SIMD (тот же код, другой набор инструкций) в dist-wasm/.
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync } from 'node:fs';

const sh = process.platform === 'win32';
const base = ['build', '--release', '--target', 'wasm32-unknown-unknown', '--lib'];
mkdirSync('dist-wasm', { recursive: true });

execFileSync('cargo', base, { stdio: 'inherit', shell: sh });
copyFileSync('target/wasm32-unknown-unknown/release/filters.wasm', 'dist-wasm/filters.wasm');

execFileSync('cargo', base, {
  stdio: 'inherit',
  shell: sh,
  env: { ...process.env, RUSTFLAGS: '-C target-feature=+simd128', CARGO_TARGET_DIR: 'target-simd' },
});
copyFileSync('target-simd/wasm32-unknown-unknown/release/filters.wasm', 'dist-wasm/filters-simd.wasm');
console.log('dist-wasm/filters.wasm, dist-wasm/filters-simd.wasm');
