//! Фильтры изображений RGBA8 на целочисленной арифметике. Те же алгоритмы, шаг в шаг, написаны на JavaScript
//! (`js/filters.js`): результат должен совпадать побайтно, это проверяют тесты.
//!
//! Интерфейс для WebAssembly — простые C-функции без `wasm-bindgen`: JS выделяет память через `alloc`,
//! кладёт туда пиксели, вызывает фильтр и читает результат из линейной памяти.

/// Яркость в целых числах: (77 R + 150 G + 29 B + 128) >> 8. Коэффициенты в сумме дают 256, поэтому белый остаётся 255.
#[inline(always)]
pub fn luma(r: u32, g: u32, b: u32) -> u32 {
    (77 * r + 150 * g + 29 * b + 128) >> 8
}

/// Целая часть (sum + r) / n, где n = 2r + 1, через таблицу на 255·n + 1 значений: одно обращение к памяти вместо деления.
/// Пробовали деление в f32 (оно векторизуется под SIMD): в замерах таблица оказалась быстрее и со SIMD, и без.
struct Divider {
    lut: Vec<u8>,
}

impl Divider {
    fn new(r: usize) -> Self {
        let n = 2 * r + 1;
        Divider {
            lut: (0..=255 * n).map(|s| ((s + r) / n) as u8).collect(),
        }
    }

    #[inline(always)]
    fn apply(&self, sum: u32) -> u8 {
        self.lut[sum as usize]
    }
}

/// Оттенки серого. Прозрачность сохраняется.
pub fn grayscale(src: &[u8], dst: &mut [u8]) {
    for (s, d) in src.chunks_exact(4).zip(dst.chunks_exact_mut(4)) {
        let y = luma(s[0] as u32, s[1] as u32, s[2] as u32) as u8;
        d[0] = y;
        d[1] = y;
        d[2] = y;
        d[3] = s[3];
    }
}

/// Горизонтальный проход размытия окном 2r+1 с повторением крайних пикселей.
fn blur_h(src: &[u8], dst: &mut [u8], w: usize, h: usize, r: usize) {
    let div = Divider::new(r);
    let stride = w * 4;
    for y in 0..h {
        let row = &src[y * stride..(y + 1) * stride];
        let out = &mut dst[y * stride..(y + 1) * stride];
        let mut sum = [0u32; 4];
        for k in -(r as isize)..=(r as isize) {
            let xi = k.clamp(0, w as isize - 1) as usize;
            for c in 0..4 {
                sum[c] += row[xi * 4 + c] as u32;
            }
        }
        for x in 0..w {
            for c in 0..4 {
                out[x * 4 + c] = div.apply(sum[c]);
            }
            let add = (x + r + 1).min(w - 1);
            let sub = x.saturating_sub(r);
            for c in 0..4 {
                sum[c] = sum[c] + row[add * 4 + c] as u32 - row[sub * 4 + c] as u32;
            }
        }
    }
}

/// Вертикальный проход: скользящие суммы по столбцам, внутренние циклы идут по строке подряд (хорошо ложатся на SIMD).
fn blur_v(src: &[u8], dst: &mut [u8], w: usize, h: usize, r: usize) {
    let div = Divider::new(r);
    let stride = w * 4;
    let mut acc = vec![0u32; stride];
    for k in -(r as isize)..=(r as isize) {
        let yi = k.clamp(0, h as isize - 1) as usize;
        let row = &src[yi * stride..(yi + 1) * stride];
        for (a, &p) in acc.iter_mut().zip(row) {
            *a += p as u32;
        }
    }
    for y in 0..h {
        let out = &mut dst[y * stride..(y + 1) * stride];
        for (o, &a) in out.iter_mut().zip(acc.iter()) {
            *o = div.apply(a);
        }
        let add = (y + r + 1).min(h - 1);
        let sub = y.saturating_sub(r);
        let ra = &src[add * stride..(add + 1) * stride];
        let rs = &src[sub * stride..(sub + 1) * stride];
        for ((a, &p), &q) in acc.iter_mut().zip(ra).zip(rs) {
            *a = *a + p as u32 - q as u32;
        }
    }
}

/// Размытие прямоугольным окном (два прохода). `tmp` — буфер того же размера, что `src`.
pub fn box_blur(src: &[u8], dst: &mut [u8], tmp: &mut [u8], w: usize, h: usize, r: usize) {
    if w == 0 || h == 0 {
        return;
    }
    blur_h(src, tmp, w, h, r);
    blur_v(tmp, dst, w, h, r);
}

/// Приближение размытия по Гауссу: три размытия окном подряд.
pub fn gaussian(src: &[u8], dst: &mut [u8], tmp: &mut [u8], w: usize, h: usize, r: usize) {
    if w == 0 || h == 0 {
        return;
    }
    blur_h(src, tmp, w, h, r);
    blur_v(tmp, dst, w, h, r);
    blur_h(dst, tmp, w, h, r);
    blur_v(tmp, dst, w, h, r);
    blur_h(dst, tmp, w, h, r);
    blur_v(tmp, dst, w, h, r);
}

/// Границы по Собелю по яркости: min(255, |gx| + |gy|), результат серый. `luma_plane` — w·h байт.
pub fn sobel(src: &[u8], dst: &mut [u8], luma_plane: &mut [u8], w: usize, h: usize) {
    if w == 0 || h == 0 {
        return;
    }
    for (p, s) in luma_plane.iter_mut().zip(src.chunks_exact(4)) {
        *p = luma(s[0] as u32, s[1] as u32, s[2] as u32) as u8;
    }
    for y in 0..h {
        let ym = &luma_plane[y.saturating_sub(1) * w..][..w];
        let yc = &luma_plane[y * w..][..w];
        let yp = &luma_plane[(y + 1).min(h - 1) * w..][..w];
        for x in 0..w {
            let xm = x.saturating_sub(1);
            let xp = (x + 1).min(w - 1);
            let gx = (ym[xp] as i32 + 2 * yc[xp] as i32 + yp[xp] as i32)
                - (ym[xm] as i32 + 2 * yc[xm] as i32 + yp[xm] as i32);
            let gy = (yp[xm] as i32 + 2 * yp[x] as i32 + yp[xp] as i32)
                - (ym[xm] as i32 + 2 * ym[x] as i32 + ym[xp] as i32);
            let m = (gx.abs() + gy.abs()).min(255) as u8;
            let o = (y * w + x) * 4;
            dst[o] = m;
            dst[o + 1] = m;
            dst[o + 2] = m;
            dst[o + 3] = src[o + 3];
        }
    }
}

/// Резкость: ядро 3×3 [0 -1 0; -1 5 -1; 0 -1 0] по каналам RGB, прозрачность копируется.
pub fn sharpen(src: &[u8], dst: &mut [u8], w: usize, h: usize) {
    if w == 0 || h == 0 {
        return;
    }
    let stride = w * 4;
    for y in 0..h {
        let up = &src[y.saturating_sub(1) * stride..][..stride];
        let cur = &src[y * stride..][..stride];
        let dn = &src[(y + 1).min(h - 1) * stride..][..stride];
        let out = &mut dst[y * stride..][..stride];
        // крайние пиксели: повторение границы
        for x in [0, w - 1] {
            let xl = x.saturating_sub(1) * 4;
            let xr = (x + 1).min(w - 1) * 4;
            let xc = x * 4;
            for c in 0..3 {
                let v = 5 * cur[xc + c] as i32
                    - cur[xl + c] as i32
                    - cur[xr + c] as i32
                    - up[xc + c] as i32
                    - dn[xc + c] as i32;
                out[xc + c] = v.clamp(0, 255) as u8;
            }
            out[xc + 3] = cur[xc + 3];
        }
        // середина строки подряд, чтобы цикл векторизовался; альфа-канал перезаписывается следом
        if w > 2 {
            for i in 4..stride - 4 {
                let v = 5 * cur[i] as i32
                    - cur[i - 4] as i32
                    - cur[i + 4] as i32
                    - up[i] as i32
                    - dn[i] as i32;
                out[i] = v.clamp(0, 255) as u8;
            }
            for x in 1..w - 1 {
                out[x * 4 + 3] = cur[x * 4 + 3];
            }
        }
    }
}

// ---------- C-интерфейс для WebAssembly ----------

/// Выделяет буфер для обмена с JS.
#[no_mangle]
pub extern "C" fn alloc(len: usize) -> *mut u8 {
    let mut v = Vec::<u8>::with_capacity(len.max(1));
    let p = v.as_mut_ptr();
    std::mem::forget(v);
    p
}

/// Освобождает буфер, выделенный `alloc`.
///
/// # Safety
/// `ptr` и `len` должны совпадать с выданными `alloc`; освобождать дважды нельзя.
#[no_mangle]
pub unsafe extern "C" fn dealloc(ptr: *mut u8, len: usize) {
    drop(Vec::from_raw_parts(ptr, 0, len.max(1)));
}

unsafe fn px<'a>(p: *const u8, w: usize, h: usize) -> &'a [u8] {
    std::slice::from_raw_parts(p, w * h * 4)
}
unsafe fn px_mut<'a>(p: *mut u8, w: usize, h: usize) -> &'a mut [u8] {
    std::slice::from_raw_parts_mut(p, w * h * 4)
}

/// # Safety
/// `src` и `dst` — отдельные буферы по `w*h*4` байт, выданные `alloc`.
#[no_mangle]
pub unsafe extern "C" fn f_grayscale(src: *const u8, dst: *mut u8, w: usize, h: usize) {
    grayscale(px(src, w, h), px_mut(dst, w, h));
}

/// # Safety
/// `src`, `dst`, `tmp` — три разных буфера по `w*h*4` байт.
#[no_mangle]
pub unsafe extern "C" fn f_box_blur(
    src: *const u8,
    dst: *mut u8,
    tmp: *mut u8,
    w: usize,
    h: usize,
    r: usize,
) {
    box_blur(px(src, w, h), px_mut(dst, w, h), px_mut(tmp, w, h), w, h, r);
}

/// # Safety
/// `src`, `dst`, `tmp` — три разных буфера по `w*h*4` байт.
#[no_mangle]
pub unsafe extern "C" fn f_gaussian(
    src: *const u8,
    dst: *mut u8,
    tmp: *mut u8,
    w: usize,
    h: usize,
    r: usize,
) {
    gaussian(px(src, w, h), px_mut(dst, w, h), px_mut(tmp, w, h), w, h, r);
}

/// # Safety
/// `src`, `dst` — буферы по `w*h*4` байт, `luma_plane` — отдельный буфер `w*h` байт.
#[no_mangle]
pub unsafe extern "C" fn f_sobel(
    src: *const u8,
    dst: *mut u8,
    luma_plane: *mut u8,
    w: usize,
    h: usize,
) {
    sobel(
        px(src, w, h),
        px_mut(dst, w, h),
        std::slice::from_raw_parts_mut(luma_plane, w * h),
        w,
        h,
    );
}

/// # Safety
/// `src` и `dst` — отдельные буферы по `w*h*4` байт.
#[no_mangle]
pub unsafe extern "C" fn f_sharpen(src: *const u8, dst: *mut u8, w: usize, h: usize) {
    sharpen(px(src, w, h), px_mut(dst, w, h), w, h);
}

#[cfg(test)]
mod tests {
    use super::*;

    fn img(w: usize, h: usize, f: impl Fn(usize, usize) -> [u8; 4]) -> Vec<u8> {
        let mut v = Vec::with_capacity(w * h * 4);
        for y in 0..h {
            for x in 0..w {
                v.extend_from_slice(&f(x, y));
            }
        }
        v
    }

    #[test]
    fn grayscale_known_values() {
        let src = [
            255, 0, 0, 10, 0, 255, 0, 20, 0, 0, 255, 30, 255, 255, 255, 40,
        ];
        let mut dst = [0u8; 16];
        grayscale(&src, &mut dst);
        assert_eq!(
            dst,
            [77, 77, 77, 10, 149, 149, 149, 20, 29, 29, 29, 30, 255, 255, 255, 40]
        );
    }

    #[test]
    fn grayscale_is_idempotent() {
        let src = img(7, 5, |x, y| {
            [(x * 37) as u8, (y * 91) as u8, (x * y * 13) as u8, 255]
        });
        let mut a = vec![0; src.len()];
        let mut b = vec![0; src.len()];
        grayscale(&src, &mut a);
        grayscale(&a, &mut b);
        assert_eq!(a, b);
    }

    #[test]
    fn box_blur_single_pixel_row() {
        // строка из 5 пикселей, яркий в середине; окно 3, края повторяются: (сумма + 1) / 3
        let src = img(5, 1, |x, _| {
            if x == 2 {
                [255, 255, 255, 255]
            } else {
                [0, 0, 0, 255]
            }
        });
        let mut dst = vec![0; src.len()];
        let mut tmp = vec![0; src.len()];
        box_blur(&src, &mut dst, &mut tmp, 5, 1, 1);
        let reds: Vec<u8> = dst.chunks(4).map(|p| p[0]).collect();
        assert_eq!(reds, [0, 85, 85, 85, 0]);
        assert!(
            dst.chunks(4).all(|p| p[3] == 255),
            "прозрачность однородной области не меняется"
        );
    }

    #[test]
    fn blurs_keep_constant_image_for_any_radius() {
        let src = img(9, 6, |_, _| [200, 100, 50, 255]);
        for r in [0, 1, 2, 7, 40] {
            let mut dst = vec![0; src.len()];
            let mut tmp = vec![0; src.len()];
            box_blur(&src, &mut dst, &mut tmp, 9, 6, r);
            assert_eq!(dst, src, "box r={r}");
            gaussian(&src, &mut dst, &mut tmp, 9, 6, r);
            assert_eq!(dst, src, "gaussian r={r}");
        }
    }

    #[test]
    fn sobel_flat_is_zero_and_step_is_strong() {
        let flat = img(6, 6, |_, _| [90, 90, 90, 255]);
        let mut dst = vec![1; flat.len()];
        let mut lp = vec![0; 36];
        sobel(&flat, &mut dst, &mut lp, 6, 6);
        assert!(dst.chunks(4).all(|p| p[0] == 0 && p[3] == 255));

        let step = img(6, 6, |x, _| {
            if x < 3 {
                [0, 0, 0, 255]
            } else {
                [255, 255, 255, 255]
            }
        });
        sobel(&step, &mut dst, &mut lp, 6, 6);
        // на границе 2|3 градиент 4*255 -> 255; вдали от неё 0
        assert_eq!(dst[(2 * 6 + 2) * 4], 255);
        assert_eq!(dst[(2 * 6 + 3) * 4], 255);
        assert_eq!(dst[(2 * 6) * 4], 0);
        assert_eq!(dst[(2 * 6 + 5) * 4], 0);
    }

    #[test]
    fn sharpen_flat_unchanged_and_clamps() {
        let flat = img(5, 5, |_, _| [120, 60, 30, 200]);
        let mut dst = vec![0; flat.len()];
        sharpen(&flat, &mut dst, 5, 5);
        assert_eq!(dst, flat);

        // яркая точка на тёмном: центр 5*255 - 0 -> 255 (зажато), соседи 0 - 255 -> 0 (зажато)
        let dot = img(3, 3, |x, y| {
            if x == 1 && y == 1 {
                [255, 255, 255, 255]
            } else {
                [0, 0, 0, 255]
            }
        });
        let mut out = vec![0; dot.len()];
        sharpen(&dot, &mut out, 3, 3);
        assert_eq!(out[(3 + 1) * 4], 255);
        assert_eq!(out[4], 0);
    }

    #[test]
    fn tiny_and_degenerate_sizes_do_not_panic() {
        for (w, h) in [(1, 1), (1, 9), (9, 1), (2, 2), (3, 1), (1, 3)] {
            let src = img(w, h, |x, y| [(x * 40) as u8, (y * 40) as u8, 7, 255]);
            let mut dst = vec![0; src.len()];
            let mut tmp = vec![0; src.len()];
            let mut lp = vec![0; w * h];
            grayscale(&src, &mut dst);
            for r in [0, 1, 5, 300] {
                box_blur(&src, &mut dst, &mut tmp, w, h, r);
                gaussian(&src, &mut dst, &mut tmp, w, h, r);
            }
            sobel(&src, &mut dst, &mut lp, w, h);
            sharpen(&src, &mut dst, w, h);
        }
        // пустое изображение
        box_blur(&[], &mut [], &mut [], 0, 0, 3);
    }

    #[test]
    fn divider_matches_integer_division_for_every_possible_sum() {
        // все радиусы и все возможные суммы окна (до 255 * n)
        for r in 0..=255 {
            let d = Divider::new(r);
            let n = (2 * r + 1) as u32;
            for sum in 0..=255 * n {
                assert_eq!(d.apply(sum) as u32, (sum + r as u32) / n, "r={r} sum={sum}");
            }
        }
    }
}
