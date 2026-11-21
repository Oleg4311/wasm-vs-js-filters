// Фильтры на JavaScript: те же алгоритмы, шаг в шаг, что и в src/lib.rs. Результат обязан совпадать побайтно.
// Код написан так, как его написал бы внимательный разработчик: типизированные массивы, без выделений в циклах,
// без замыканий в горячем месте. Цель — честное сравнение, а не соломенное чучело.

/** Яркость: (77 R + 150 G + 29 B + 128) >> 8. */
function luma(r, g, b) {
  return (77 * r + 150 * g + 29 * b + 128) >> 8;
}

export function grayscale(src, dst, _tmp, w, h) {
  const n = w * h * 4;
  for (let i = 0; i < n; i += 4) {
    const y = luma(src[i], src[i + 1], src[i + 2]);
    dst[i] = y;
    dst[i + 1] = y;
    dst[i + 2] = y;
    dst[i + 3] = src[i + 3];
  }
}

const lutCache = new Map();
function divLut(r) {
  let t = lutCache.get(r);
  if (!t) {
    const n = 2 * r + 1;
    t = new Uint8Array(255 * n + 1);
    for (let s = 0; s < t.length; s++) t[s] = ((s + r) / n) | 0;
    lutCache.set(r, t);
  }
  return t;
}

function blurH(src, dst, w, h, r) {
  const lut = divLut(r);
  const stride = w * 4;
  const last = w - 1;
  for (let y = 0; y < h; y++) {
    const base = y * stride;
    let s0 = 0;
    let s1 = 0;
    let s2 = 0;
    let s3 = 0;
    for (let k = -r; k <= r; k++) {
      const xi = k < 0 ? 0 : k > last ? last : k;
      const o = base + xi * 4;
      s0 += src[o];
      s1 += src[o + 1];
      s2 += src[o + 2];
      s3 += src[o + 3];
    }
    for (let x = 0; x < w; x++) {
      const o = base + x * 4;
      dst[o] = lut[s0];
      dst[o + 1] = lut[s1];
      dst[o + 2] = lut[s2];
      dst[o + 3] = lut[s3];
      const add = x + r + 1 > last ? last : x + r + 1;
      const sub = x - r < 0 ? 0 : x - r;
      const a = base + add * 4;
      const b = base + sub * 4;
      s0 += src[a] - src[b];
      s1 += src[a + 1] - src[b + 1];
      s2 += src[a + 2] - src[b + 2];
      s3 += src[a + 3] - src[b + 3];
    }
  }
}

function blurV(src, dst, w, h, r) {
  const lut = divLut(r);
  const stride = w * 4;
  const last = h - 1;
  const acc = new Int32Array(stride);
  for (let k = -r; k <= r; k++) {
    const yi = k < 0 ? 0 : k > last ? last : k;
    const o = yi * stride;
    for (let i = 0; i < stride; i++) acc[i] += src[o + i];
  }
  for (let y = 0; y < h; y++) {
    const o = y * stride;
    for (let i = 0; i < stride; i++) dst[o + i] = lut[acc[i]];
    const a = (y + r + 1 > last ? last : y + r + 1) * stride;
    const b = (y - r < 0 ? 0 : y - r) * stride;
    for (let i = 0; i < stride; i++) acc[i] += src[a + i] - src[b + i];
  }
}

export function boxBlur(src, dst, tmp, w, h, r) {
  if (w === 0 || h === 0) return;
  blurH(src, tmp, w, h, r);
  blurV(tmp, dst, w, h, r);
}

export function gaussian(src, dst, tmp, w, h, r) {
  if (w === 0 || h === 0) return;
  blurH(src, tmp, w, h, r);
  blurV(tmp, dst, w, h, r);
  blurH(dst, tmp, w, h, r);
  blurV(tmp, dst, w, h, r);
  blurH(dst, tmp, w, h, r);
  blurV(tmp, dst, w, h, r);
}

export function sobel(src, dst, tmp, w, h) {
  if (w === 0 || h === 0) return;
  const plane = tmp; // первые w*h байт
  const total = w * h;
  for (let i = 0, p = 0; i < total; i++, p += 4) plane[i] = luma(src[p], src[p + 1], src[p + 2]);
  for (let y = 0; y < h; y++) {
    const ym = (y === 0 ? 0 : y - 1) * w;
    const yc = y * w;
    const yp = (y + 1 > h - 1 ? h - 1 : y + 1) * w;
    for (let x = 0; x < w; x++) {
      const xm = x === 0 ? 0 : x - 1;
      const xp = x + 1 > w - 1 ? w - 1 : x + 1;
      const gx = plane[ym + xp] + 2 * plane[yc + xp] + plane[yp + xp] - (plane[ym + xm] + 2 * plane[yc + xm] + plane[yp + xm]);
      const gy = plane[yp + xm] + 2 * plane[yp + x] + plane[yp + xp] - (plane[ym + xm] + 2 * plane[ym + x] + plane[ym + xp]);
      const mag = Math.abs(gx) + Math.abs(gy);
      const m = mag > 255 ? 255 : mag;
      const o = (yc + x) * 4;
      dst[o] = m;
      dst[o + 1] = m;
      dst[o + 2] = m;
      dst[o + 3] = src[o + 3];
    }
  }
}

function clamp255(v) {
  return v < 0 ? 0 : v > 255 ? 255 : v;
}

function sharpenEdge(src, dst, up, cur, dn, x, w) {
  const xl = (x === 0 ? 0 : x - 1) * 4;
  const xr = (x + 1 > w - 1 ? w - 1 : x + 1) * 4;
  const xc = x * 4;
  for (let c = 0; c < 3; c++) {
    dst[cur + xc + c] = clamp255(5 * src[cur + xc + c] - src[cur + xl + c] - src[cur + xr + c] - src[up + xc + c] - src[dn + xc + c]);
  }
  dst[cur + xc + 3] = src[cur + xc + 3];
}

export function sharpen(src, dst, _tmp, w, h) {
  if (w === 0 || h === 0) return;
  const stride = w * 4;
  for (let y = 0; y < h; y++) {
    const up = (y === 0 ? 0 : y - 1) * stride;
    const cur = y * stride;
    const dn = (y + 1 > h - 1 ? h - 1 : y + 1) * stride;
    sharpenEdge(src, dst, up, cur, dn, 0, w);
    sharpenEdge(src, dst, up, cur, dn, w - 1, w);
    if (w > 2) {
      for (let i = 4; i < stride - 4; i++) {
        dst[cur + i] = clamp255(5 * src[cur + i] - src[cur + i - 4] - src[cur + i + 4] - src[up + i] - src[dn + i]);
      }
      for (let x = 1; x < w - 1; x++) dst[cur + x * 4 + 3] = src[cur + x * 4 + 3];
    }
  }
}

/**
 * Список фильтров. `js` — реализация на JS, `wasm` — имя экспорта в модуле, `radius` — нужен ли радиус.
 * Порядок аргументов WebAssembly: (src, dst, tmp, w, h[, r]); у grayscale и sharpen tmp нет.
 */
export const FILTERS = [
  { id: 'grayscale', label: 'Оттенки серого', js: grayscale, wasm: 'f_grayscale', tmp: false, radius: false },
  { id: 'box', label: 'Размытие окном', js: boxBlur, wasm: 'f_box_blur', tmp: true, radius: true },
  { id: 'gaussian', label: 'Размытие по Гауссу (3 прохода)', js: gaussian, wasm: 'f_gaussian', tmp: true, radius: true },
  { id: 'sobel', label: 'Границы (Собель)', js: sobel, wasm: 'f_sobel', tmp: true, radius: false },
  { id: 'sharpen', label: 'Резкость', js: sharpen, wasm: 'f_sharpen', tmp: false, radius: false },
];
