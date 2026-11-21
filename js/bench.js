// Замеры: одна и та же работа на разных реализациях, прогрев, медиана, сверка результатов побайтно.
import { FILTERS } from './filters.js';

export function summarize(times) {
  const t = [...times].sort((a, b) => a - b);
  const at = (q) => t[Math.min(t.length - 1, Math.floor(q * (t.length - 1) + 0.5))];
  return { runs: t.length, min: t[0], p25: at(0.25), median: at(0.5), p75: at(0.75), max: t[t.length - 1] };
}

export function sameBytes(a, b) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

const byId = (id) => FILTERS.find((f) => f.id === id);

/**
 * Реализация на JS: работает прямо с памятью ImageData без копирования. Представление Uint8Array поверх того же ArrayBuffer
 * (ImageData.data — Uint8ClampedArray; смешение двух типов массивов в одной функции ухудшает оптимизацию V8).
 */
export function jsImpl(w, h) {
  const len = w * h * 4;
  const src = new Uint8Array(len);
  const dst = new Uint8Array(len);
  const tmp = new Uint8Array(len);
  const view = (a) => new Uint8Array(a.buffer, a.byteOffset, a.length);
  return {
    id: 'js',
    label: 'JavaScript',
    /** Данные кладутся в «родную» память реализации. */
    load(rgba) {
      src.set(rgba);
    },
    /** Только работа: данные уже на месте. */
    compute(filterId, r) {
      byId(filterId).js(src, dst, tmp, w, h, r);
    },
    result(out) {
      out.set(dst);
    },
    /** Как в приложении: из массива ImageData в массив ImageData. У JS данные уже в нужных массивах, копирования нет. */
    pipeline(filterId, r, input, output) {
      byId(filterId).js(view(input), view(output), tmp, w, h, r);
    },
    free() {},
  };
}

/** Реализация на WebAssembly: данные приходится копировать в память модуля и обратно. */
export function wasmImpl(wf, id, label, w, h) {
  const job = wf.job(w, h);
  return {
    id,
    label,
    load(rgba) {
      wf.write(job, rgba);
    },
    compute(filterId, r) {
      wf.run(job, filterId, r);
    },
    result(out) {
      wf.read(job, out);
    },
    pipeline(filterId, r, input, output) {
      wf.write(job, input);
      wf.run(job, filterId, r);
      wf.read(job, output);
    },
    free() {
      job.free();
    },
  };
}

const tick = () => new Promise((r) => setTimeout(r, 0));

/**
 * Прогоняет все реализации на всех фильтрах. Для каждой пары: прогрев, затем `runs` замеров
 * (compute: только работа; pipeline: с копированием, как в приложении).
 * Реализации чередуются внутри каждого повтора и сдвигаются по кругу, чтобы фоновая нагрузка
 * и нагрев процессора били по всем поровну.
 */
export async function runBenchmark({ impls, filterIds, rgba, w, h, radius, runs, warmup, onProgress }) {
  const stats = new Map(); // `${impl}/${filter}` -> { compute, pipeline }
  const outputs = new Map();
  const input = new Uint8ClampedArray(rgba);
  const sink = new Uint8ClampedArray(rgba.length);
  for (const i of impls) i.load(rgba);
  let done = 0;
  const total = filterIds.length * (warmup + runs);
  for (const fid of filterIds) {
    const rec = new Map(impls.map((i) => [i.id, { compute: [], pipeline: [] }]));
    for (let k = 0; k < warmup + runs; k++) {
      for (let j = 0; j < impls.length; j++) {
        const impl = impls[(j + k) % impls.length];
        const a = performance.now();
        impl.compute(fid, radius);
        const b = performance.now();
        impl.pipeline(fid, radius, input, sink);
        const c = performance.now();
        if (k >= warmup) {
          const r = rec.get(impl.id);
          r.compute.push(b - a);
          r.pipeline.push(c - b);
        }
      }
      done++;
      onProgress?.(done / total, fid);
      await tick();
    }
    for (const impl of impls) {
      const o = new Uint8ClampedArray(rgba.length);
      impl.compute(fid, radius);
      impl.result(o);
      outputs.set(`${impl.id}/${fid}`, o);
      const r = rec.get(impl.id);
      stats.set(`${impl.id}/${fid}`, { compute: summarize(r.compute), pipeline: summarize(r.pipeline) });
    }
  }
  const identical = new Map();
  for (const fid of filterIds) {
    const base = outputs.get(`js/${fid}`);
    for (const impl of impls) identical.set(`${impl.id}/${fid}`, sameBytes(base, outputs.get(`${impl.id}/${fid}`)));
  }
  return { stats, outputs, identical, w, h, radius, runs, warmup };
}
