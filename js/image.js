// Детерминированные тестовые изображения: градиенты, круги, полосы и шум, чтобы у фильтров были и плавные области, и резкие границы.

export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Картинка w×h RGBA (Uint8ClampedArray). */
export function makeImage(w, h, seed = 1) {
  const rnd = mulberry32(seed);
  const data = new Uint8ClampedArray(w * h * 4);
  const circles = Array.from({ length: 12 }, () => ({
    x: rnd() * w,
    y: rnd() * h,
    r: (0.04 + rnd() * 0.18) * Math.max(w, h),
    c: [rnd() * 255, rnd() * 255, rnd() * 255],
  }));
  const stripe = 8 + Math.floor(rnd() * 24);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const o = (y * w + x) * 4;
      let r = (x / w) * 200 + 30;
      let g = (y / h) * 200 + 30;
      let b = 255 - ((x + y) / (w + h)) * 200;
      for (const k of circles) {
        const dx = x - k.x;
        const dy = y - k.y;
        if (dx * dx + dy * dy < k.r * k.r) {
          r = k.c[0];
          g = k.c[1];
          b = k.c[2];
        }
      }
      if (Math.floor((x + y * 2) / stripe) % 7 === 0) {
        r *= 0.6;
        g *= 0.6;
        b *= 0.6;
      }
      const n = (rnd() - 0.5) * 24;
      data[o] = r + n;
      data[o + 1] = g + n;
      data[o + 2] = b + n;
      data[o + 3] = 255;
    }
  }
  return data;
}

/** Случайные байты вместо картинки, включая случайную прозрачность: самый злой вход для сверки. */
export function randomBytes(w, h, seed) {
  const rnd = mulberry32(seed);
  const data = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < data.length; i++) data[i] = Math.floor(rnd() * 256);
  return data;
}
