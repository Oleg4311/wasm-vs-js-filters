// Главная проверка: JS, WebAssembly (скаляр) и WebAssembly (SIMD) дают побайтно один и тот же результат.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { before, test } from 'node:test';
import { sameBytes } from '../js/bench.js';
import { FILTERS } from '../js/filters.js';
import { makeImage, mulberry32, randomBytes } from '../js/image.js';
import { instantiate, simdSupported } from '../js/wasm.js';

let scalar;
let simd;
before(async () => {
  scalar = await instantiate(readFileSync('dist-wasm/filters.wasm'));
  assert.ok(simdSupported(), 'эта версия Node должна поддерживать SIMD');
  simd = await instantiate(readFileSync('dist-wasm/filters-simd.wasm'));
});

function runJs(f, rgba, w, h, r) {
  const src = new Uint8Array(rgba);
  const dst = new Uint8Array(rgba.length);
  const tmp = new Uint8Array(rgba.length);
  f.js(src, dst, tmp, w, h, r);
  return dst;
}

function runWasm(wf, f, rgba, w, h, r) {
  const job = wf.job(w, h);
  try {
    wf.write(job, rgba);
    wf.run(job, f.id, r);
    const out = new Uint8Array(rgba.length);
    wf.read(job, out);
    return out;
  } finally {
    job.free();
  }
}

function check(rgba, w, h, r, label) {
  for (const f of FILTERS) {
    const js = runJs(f, rgba, w, h, r);
    assert.ok(sameBytes(js, runWasm(scalar, f, rgba, w, h, r)), `${f.id}: JS ≠ WASM, ${label}`);
    assert.ok(sameBytes(js, runWasm(simd, f, rgba, w, h, r)), `${f.id}: JS ≠ WASM SIMD, ${label}`);
  }
}

test('случайные байты (с произвольной прозрачностью), размеры от 1×1 до 40×40, радиусы от 0 до 100', () => {
  const rnd = mulberry32(7);
  const radii = [0, 1, 2, 3, 5, 13, 31, 100];
  for (let i = 0; i < 160; i++) {
    const w = 1 + Math.floor(rnd() * 40);
    const h = 1 + Math.floor(rnd() * 40);
    const r = radii[Math.floor(rnd() * radii.length)];
    check(randomBytes(w, h, 1000 + i), w, h, r, `${w}×${h}, r=${r}, seed=${1000 + i}`);
  }
});

test('вырожденные размеры: 1×N, N×1, 2×2', () => {
  for (const [w, h] of [[1, 1], [1, 17], [17, 1], [2, 2], [3, 1], [1, 3], [2, 31], [31, 2]]) {
    for (const r of [0, 1, 4, 50]) check(randomBytes(w, h, w * 100 + h + r), w, h, r, `${w}×${h}, r=${r}`);
  }
});

test('картинка с градиентами и резкими границами 333×217, радиус 7 и 25', () => {
  const img = makeImage(333, 217, 42);
  check(img, 333, 217, 7, '333×217 r=7');
  check(img, 333, 217, 25, '333×217 r=25');
});

test('края: все пиксели чёрные и все белые, максимальные суммы не переполняются', () => {
  for (const v of [0, 255]) {
    const img = new Uint8ClampedArray(64 * 48 * 4).fill(v);
    check(img, 64, 48, 255, `однотонная ${v}, r=255`);
  }
});

test('известные значения (те же числа, что в тестах Rust)', () => {
  const gray = FILTERS.find((f) => f.id === 'grayscale');
  const px = new Uint8ClampedArray([255, 0, 0, 10, 0, 255, 0, 20, 0, 0, 255, 30, 255, 255, 255, 40]);
  assert.deepEqual([...runJs(gray, px, 4, 1, 0)], [77, 77, 77, 10, 149, 149, 149, 20, 29, 29, 29, 30, 255, 255, 255, 40]);
  assert.deepEqual([...runWasm(scalar, gray, px, 4, 1, 0)], [77, 77, 77, 10, 149, 149, 149, 20, 29, 29, 29, 30, 255, 255, 255, 40]);

  const box = FILTERS.find((f) => f.id === 'box');
  const row = new Uint8ClampedArray(20);
  for (let x = 0; x < 5; x++) row.set(x === 2 ? [255, 255, 255, 255] : [0, 0, 0, 255], x * 4);
  const reds = (a) => [...a].filter((_, i) => i % 4 === 0);
  assert.deepEqual(reds(runJs(box, row, 5, 1, 1)), [0, 85, 85, 85, 0]);
  assert.deepEqual(reds(runWasm(simd, box, row, 5, 1, 1)), [0, 85, 85, 85, 0]);
});

test('память не утекает: тысяча заданий подряд не увеличивает память модуля', () => {
  const img = makeImage(64, 64, 3);
  const f = FILTERS.find((x) => x.id === 'gaussian');
  runWasm(scalar, f, img, 64, 64, 3); // прогрев
  const before = scalar.ex.memory.buffer.byteLength;
  for (let i = 0; i < 1000; i++) runWasm(scalar, f, img, 64, 64, 3);
  assert.equal(scalar.ex.memory.buffer.byteLength, before);
});

test('сборка со SIMD действительно другая и не больше обычной более чем вдвое', () => {
  const a = readFileSync('dist-wasm/filters.wasm');
  const b = readFileSync('dist-wasm/filters-simd.wasm');
  assert.notDeepEqual(a, b);
  assert.ok(b.length < a.length * 2);
});
