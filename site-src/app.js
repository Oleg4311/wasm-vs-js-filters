// Интерфейс замера. Весь вывод строится через textContent.
import { jsImpl, runBenchmark, wasmImpl } from './js/bench.js';
import { FILTERS } from './js/filters.js';
import { makeImage } from './js/image.js';
import { instantiate, simdSupported } from './js/wasm.js';

const $ = (id) => document.getElementById(id);
const fmt = (v) => (v >= 100 ? v.toFixed(0) : v >= 10 ? v.toFixed(1) : v.toFixed(2)).replace('.', ',');
const SVGNS = 'http://www.w3.org/2000/svg';

const fail = (msg) => {
  $('error').hidden = false;
  $('error').textContent = msg;
};

// ---------- модули ----------
let scalar;
let simd = null;
const hasSimd = simdSupported();
try {
  const load = async (name) => instantiate(await (await fetch(name)).arrayBuffer());
  scalar = await load('filters.wasm');
  if (hasSimd) simd = await load('filters-simd.wasm');
} catch (e) {
  fail('Не удалось загрузить модуль WebAssembly: ' + e.message);
  throw e;
}

$('env').textContent = `${navigator.userAgent.replace(/\s*\(.*?\)\s*/g, ' ').trim().slice(0, 90)} · потоков процессора: ${navigator.hardwareConcurrency ?? '?'} · SIMD в WebAssembly: ${hasSimd ? 'поддерживается' : 'не поддерживается'}`;

// ---------- форма ----------
const sel = $('filter');
sel.append(new Option('Все фильтры', 'all'));
for (const f of FILTERS) sel.append(new Option(f.label, f.id));
$('src').addEventListener('change', () => {
  $('file-box').hidden = $('src').value !== 'file';
});

let uploaded = null; // { rgba, w, h }
$('file').addEventListener('change', async () => {
  const file = $('file').files?.[0];
  uploaded = null;
  if (!file) return;
  try {
    const bmp = await createImageBitmap(file);
    const k = Math.min(1, Math.sqrt(4e6 / (bmp.width * bmp.height)));
    const w = Math.max(1, Math.round(bmp.width * k));
    const h = Math.max(1, Math.round(bmp.height * k));
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(bmp, 0, 0, w, h);
    uploaded = { rgba: ctx.getImageData(0, 0, w, h).data, w, h };
    $('status').textContent = `Файл загружен: ${w}×${h} (${((w * h) / 1e6).toFixed(2).replace('.', ',')} Мп).`;
  } catch {
    fail('Не удалось прочитать изображение. Попробуйте PNG или JPEG.');
  }
});

function pickImage() {
  const v = $('src').value;
  if (v === 'file') {
    if (!uploaded) throw new Error('Сначала выберите файл изображения.');
    return uploaded;
  }
  const mp = Number(v);
  const w = Math.round(Math.sqrt((mp * 1e6 * 4) / 3));
  const h = Math.round((mp * 1e6) / w);
  return { rgba: makeImage(w, h, 5), w, h };
}

// ---------- запуск ----------
let last = null;
$('run').addEventListener('click', async () => {
  $('error').hidden = true;
  let img;
  try {
    img = pickImage();
  } catch (e) {
    fail(e.message);
    return;
  }
  const radius = Math.max(1, Math.min(60, Math.floor(Number($('radius').value) || 8)));
  const runs = Math.max(1, Math.min(31, Math.floor(Number($('runs').value) || 7)));
  const filterIds = sel.value === 'all' ? FILTERS.map((f) => f.id) : [sel.value];
  const { w, h, rgba } = img;
  const impls = [jsImpl(w, h), wasmImpl(scalar, 'wasm', 'WebAssembly', w, h)];
  if (simd) impls.push(wasmImpl(simd, 'wasm-simd', 'WebAssembly SIMD', w, h));

  $('run').disabled = true;
  $('progress').hidden = false;
  $('progress').value = 0;
  $('status').textContent = 'Идёт замер… страница на это время может не отзываться.';
  try {
    const res = await runBenchmark({
      impls,
      filterIds,
      rgba,
      w,
      h,
      radius,
      runs,
      warmup: 4,
      onProgress: (p, fid) => {
        $('progress').value = p;
        $('status').textContent = `Идёт замер: ${FILTERS.find((f) => f.id === fid).label} (${Math.round(p * 100)}%)`;
      },
    });
    last = { res, filterIds, rgba, hasSimd: !!simd };
    render();
    $('status').textContent = `Готово: ${w}×${h} (${((w * h) / 1e6).toFixed(2).replace('.', ',')} Мп), радиус ${radius}, ${runs} замеров после прогрева.`;
  } catch (e) {
    fail('Замер не удался: ' + e.message);
  } finally {
    for (const i of impls) i.free();
    $('progress').hidden = true;
    $('run').disabled = false;
  }
});

document.querySelectorAll('input[name=mode]').forEach((r) => r.addEventListener('change', () => last && render()));

// ---------- отображение ----------
const mode = () => document.querySelector('input[name=mode]:checked').value;
const SERIES = [
  { id: 'js', label: 'JavaScript', color: 'var(--c-js)' },
  { id: 'wasm', label: 'WebAssembly', color: 'var(--c-wasm)' },
  { id: 'wasm-simd', label: 'WebAssembly SIMD', color: 'var(--c-simd)' },
];

function cell(tr, text, cls) {
  const td = document.createElement('td');
  td.textContent = text;
  if (cls) td.className = cls;
  tr.append(td);
  return td;
}

function render() {
  const { res, filterIds, hasSimd: simdOn } = last;
  const m = mode();
  const series = SERIES.filter((s) => s.id !== 'wasm-simd' || simdOn);
  $('results-box').hidden = false;
  $('res-caption').textContent =
    m === 'compute'
      ? 'Медиана времени одного вызова фильтра, данные уже в памяти реализации.'
      : 'Медиана времени от ImageData до ImageData: для WebAssembly включает копирование в память модуля и обратно.';

  const tb = $('res').tBodies[0];
  tb.replaceChildren();
  const bars = [];
  for (const fid of filterIds) {
    const label = FILTERS.find((f) => f.id === fid).label;
    const med = (id) => res.stats.get(`${id}/${fid}`)[m].median;
    const tr = document.createElement('tr');
    tr.dataset.filter = fid;
    const th = document.createElement('th');
    th.scope = 'row';
    th.textContent = label;
    tr.append(th);
    cell(tr, fmt(med('js')), 'num');
    cell(tr, fmt(med('wasm')), 'num');
    cell(tr, simdOn ? fmt(med('wasm-simd')) : 'недоступно', 'num');
    const x = (id) => `×${(med('js') / med(id)).toFixed(2).replace('.', ',')}`;
    cell(tr, x('wasm'), 'num');
    cell(tr, simdOn ? x('wasm-simd') : '—', 'num');
    const same = ['wasm', ...(simdOn ? ['wasm-simd'] : [])].every((id) => res.identical.get(`${id}/${fid}`));
    cell(tr, same ? 'да, побайтно' : 'НЕТ', same ? 'yes' : 'no');
    tb.append(tr);
    for (const s of series) bars.push({ filter: label, series: s, v: med(s.id) });
  }

  const dt = $('detail').tBodies[0];
  dt.replaceChildren();
  for (const fid of filterIds) {
    for (const s of series) {
      const st = res.stats.get(`${s.id}/${fid}`)[m];
      const tr = document.createElement('tr');
      cell(tr, FILTERS.find((f) => f.id === fid).label);
      cell(tr, s.label);
      for (const v of [st.min, st.p25, st.median, st.p75]) cell(tr, fmt(v), 'num');
      dt.append(tr);
    }
  }
  drawChart(bars, series.length);
  drawPictures(filterIds[0]);
}

function el(name, attrs, text) {
  const e = document.createElementNS(SVGNS, name);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  if (text !== undefined) e.textContent = text;
  return e;
}

function drawChart(bars, perGroup) {
  const svg = $('chart');
  svg.querySelectorAll(':scope > :not(title):not(desc)').forEach((n) => n.remove());
  const L = 200;
  const R = 70;
  const W = 760;
  const rowH = 20;
  const gap = 12;
  const groups = bars.length / perGroup;
  const H = 10 + groups * (perGroup * rowH + gap);
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  const max = Math.max(...bars.map((b) => b.v));
  let y = 10;
  for (let g = 0; g < groups; g++) {
    const first = bars[g * perGroup];
    svg.append(el('text', { x: L - 8, y: y + (perGroup * rowH) / 2 + 4, 'text-anchor': 'end', 'font-size': 13, fill: 'currentColor' }, first.filter));
    for (let k = 0; k < perGroup; k++) {
      const b = bars[g * perGroup + k];
      const len = Math.max(2, (b.v / max) * (W - L - R));
      svg.append(el('rect', { x: L, y: y + k * rowH + 2, width: len, height: rowH - 4, rx: 3, fill: b.series.color }));
      svg.append(el('text', { x: L + len + 6, y: y + k * rowH + rowH / 2 + 4, 'font-size': 12, fill: 'currentColor' }, fmt(b.v)));
    }
    y += perGroup * rowH + gap;
  }
}

function drawPictures(fid) {
  const { res, rgba } = last;
  const { w, h } = res;
  const scale = Math.min(1, 640 / w);
  const draw = (canvas, data) => {
    const full = document.createElement('canvas');
    full.width = w;
    full.height = h;
    full.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(data), w, h), 0, 0);
    canvas.width = Math.round(w * scale);
    canvas.height = Math.round(h * scale);
    canvas.getContext('2d').drawImage(full, 0, 0, canvas.width, canvas.height);
  };
  draw($('c-src'), rgba);
  draw($('c-out'), res.outputs.get(`js/${fid}`));
  $('out-cap').textContent = `Результат: ${FILTERS.find((f) => f.id === fid).label}${last.filterIds.length > 1 ? ' (первый из выбранных)' : ''}`;
  $('pics-box').hidden = false;
}
