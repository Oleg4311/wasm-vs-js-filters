// Обёртка над модулем WebAssembly без wasm-bindgen: alloc/dealloc и фильтры f_* работают с линейной памятью.
import { FILTERS } from './filters.js';

// Минимальный модуль с инструкцией SIMD (v128): validate() говорит, поддерживает ли движок SIMD.
const SIMD_PROBE = new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123, 3, 2, 1, 0, 10, 10, 1, 8, 0, 65, 0, 253, 15, 253, 98, 11]);

export function simdSupported() {
  try {
    return WebAssembly.validate(SIMD_PROBE);
  } catch {
    return false;
  }
}

export async function instantiate(bytes) {
  const { instance } = await WebAssembly.instantiate(bytes, {});
  return new WasmFilters(instance.exports);
}

export class WasmFilters {
  constructor(exports) {
    this.ex = exports;
  }

  /** Представление памяти берётся заново при каждом обращении: после alloc память могла вырасти. */
  bytes(ptr, len) {
    return new Uint8Array(this.ex.memory.buffer, ptr, len);
  }

  /** Три буфера под изображение w×h: исходный, результат, рабочий. */
  job(w, h) {
    const len = w * h * 4;
    const ex = this.ex;
    const job = {
      w,
      h,
      len,
      src: ex.alloc(len),
      dst: ex.alloc(len),
      tmp: ex.alloc(len),
      free: () => {
        ex.dealloc(job.src, len);
        ex.dealloc(job.dst, len);
        ex.dealloc(job.tmp, len);
      },
    };
    return job;
  }

  write(job, rgba) {
    this.bytes(job.src, job.len).set(rgba);
  }

  read(job, out) {
    out.set(this.bytes(job.dst, job.len));
  }

  /** Вызывает фильтр: данные уже в памяти модуля. */
  run(job, filterId, radius) {
    const f = FILTERS.find((x) => x.id === filterId);
    if (!f) throw new Error('неизвестный фильтр ' + filterId);
    const fn = this.ex[f.wasm];
    if (f.radius) fn(job.src, job.dst, job.tmp, job.w, job.h, radius);
    else if (f.tmp) fn(job.src, job.dst, job.tmp, job.w, job.h);
    else fn(job.src, job.dst, job.w, job.h);
  }
}
