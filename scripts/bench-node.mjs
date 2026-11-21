// Замер в Node.js (движок V8, как в Chrome): node scripts/bench-node.mjs [мегапикселей] [радиус] [повторов]
import { readFileSync } from 'node:fs';
import { jsImpl, runBenchmark, wasmImpl } from '../js/bench.js';
import { FILTERS } from '../js/filters.js';
import { makeImage } from '../js/image.js';
import { instantiate } from '../js/wasm.js';

const mp = Number(process.argv[2] ?? 2);
const radius = Number(process.argv[3] ?? 8);
const runs = Number(process.argv[4] ?? 9);
const w = Math.round(Math.sqrt((mp * 1e6 * 4) / 3));
const h = Math.round((mp * 1e6) / w);

const scalar = await instantiate(readFileSync('dist-wasm/filters.wasm'));
const simd = await instantiate(readFileSync('dist-wasm/filters-simd.wasm'));
const impls = [jsImpl(w, h), wasmImpl(scalar, 'wasm', 'WebAssembly', w, h), wasmImpl(simd, 'wasm-simd', 'WebAssembly SIMD', w, h)];
const res = await runBenchmark({
  impls,
  filterIds: FILTERS.map((f) => f.id),
  rgba: makeImage(w, h, 5),
  w,
  h,
  radius,
  runs,
  warmup: 3,
});

console.log(`Node ${process.version}, ${w}×${h} (${((w * h) / 1e6).toFixed(2)} Мп), радиус ${radius}, ${runs} замеров, медиана, мс`);
console.log('фильтр'.padEnd(34), 'JS'.padStart(8), 'WASM'.padStart(8), 'SIMD'.padStart(8), '| с копированием: JS / WASM / SIMD | совпало');
for (const f of FILTERS) {
  const m = (id, mode) => res.stats.get(`${id}/${f.id}`)[mode].median;
  const ok = ['wasm', 'wasm-simd'].every((id) => res.identical.get(`${id}/${f.id}`));
  console.log(
    f.label.padEnd(34),
    m('js', 'compute').toFixed(1).padStart(8),
    m('wasm', 'compute').toFixed(1).padStart(8),
    m('wasm-simd', 'compute').toFixed(1).padStart(8),
    '|',
    [m('js', 'pipeline'), m('wasm', 'pipeline'), m('wasm-simd', 'pipeline')].map((v) => v.toFixed(1).padStart(7)).join(' '),
    '|',
    ok ? 'да' : 'НЕТ',
  );
}
