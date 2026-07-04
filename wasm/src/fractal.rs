use wasm_bindgen::prelude::*;

const ESCAPE_R2: f64 = 65536.0; // radius 256, needed for smooth coloring
const LN_2: f64 = std::f64::consts::LN_2;

// Cyclic gradient through the site palette: deep-space indigo -> violet ->
// brand violet (#7c5cff) -> brand cyan (#38e5ff) -> pale gold -> back
const STOPS: [(f64, [f64; 3]); 6] = [
    (0.00, [0.02, 0.03, 0.12]),
    (0.22, [0.24, 0.16, 0.55]),
    (0.45, [0.486, 0.361, 1.0]),
    (0.68, [0.22, 0.898, 1.0]),
    (0.87, [0.95, 0.88, 0.63]),
    (1.00, [0.02, 0.03, 0.12]),
];

#[inline]
fn palette(t: f64) -> [u8; 3] {
    let t = t.fract();
    let mut i = 0;
    while STOPS[i + 1].0 < t {
        i += 1;
    }
    let (t0, c0) = STOPS[i];
    let (t1, c1) = STOPS[i + 1];
    let f = (t - t0) / (t1 - t0);
    let mut out = [0u8; 3];
    for k in 0..3 {
        out[k] = ((c0[k] + (c1[k] - c0[k]) * f).clamp(0.0, 1.0) * 255.0) as u8;
    }
    out
}

#[wasm_bindgen]
pub struct FractalRenderer {
    buf: Vec<u8>,
    max_w: u32,
    max_h: u32,
}

#[wasm_bindgen]
impl FractalRenderer {
    #[wasm_bindgen(constructor)]
    pub fn new(max_width: u32, max_height: u32) -> FractalRenderer {
        FractalRenderer {
            buf: vec![0; (max_width * max_height * 4) as usize],
            max_w: max_width,
            max_h: max_height,
        }
    }

    /// Renders rows [row_start, row_end) of a width x height frame into the
    /// RGBA buffer. scale = complex units per pixel.
    /// mode: 0 Mandelbrot, 1 Julia, 2 Burning Ship.
    #[allow(clippy::too_many_arguments)]
    pub fn render(
        &mut self,
        width: u32,
        height: u32,
        row_start: u32,
        row_end: u32,
        center_re: f64,
        center_im: f64,
        scale: f64,
        max_iter: u32,
        mode: u8,
        julia_re: f64,
        julia_im: f64,
    ) {
        let w = width.min(self.max_w) as usize;
        let h = height.min(self.max_h) as usize;
        let row_end = (row_end as usize).min(h);
        let half_w = w as f64 * 0.5;
        let half_h = h as f64 * 0.5;

        for py in (row_start as usize)..row_end {
            let im0 = center_im + (half_h - py as f64) * scale;
            for px in 0..w {
                let re0 = center_re + (px as f64 - half_w) * scale;

                let (cre, cim, mut zre, mut zim) = match mode {
                    0 => (re0, im0, 0.0, 0.0),
                    1 => (julia_re, julia_im, re0, im0),
                    // Burning Ship, im mirrored so the ship sails mast-up
                    _ => (re0, -im0, 0.0, 0.0),
                };

                let off = (py * w + px) * 4;

                // Cardioid / period-2 bulb check: skips the huge interior fast
                if mode == 0 {
                    let xq = cre - 0.25;
                    let q = xq * xq + cim * cim;
                    if q * (q + xq) <= 0.25 * cim * cim
                        || (cre + 1.0) * (cre + 1.0) + cim * cim <= 0.0625
                    {
                        self.buf[off..off + 4].copy_from_slice(&[0, 0, 0, 255]);
                        continue;
                    }
                }

                let mut zre2 = zre * zre;
                let mut zim2 = zim * zim;
                let mut n = 0u32;
                while zre2 + zim2 <= ESCAPE_R2 && n < max_iter {
                    zim = if mode == 2 {
                        // Burning Ship: z -> (|Re z| + i|Im z|)^2 + c
                        2.0 * (zre * zim).abs() + cim
                    } else {
                        2.0 * zre * zim + cim
                    };
                    zre = zre2 - zim2 + cre;
                    zre2 = zre * zre;
                    zim2 = zim * zim;
                    n += 1;
                }

                if n >= max_iter {
                    self.buf[off..off + 4].copy_from_slice(&[0, 0, 0, 255]);
                } else {
                    // Smooth iteration count: nu = n + 1 - log2(ln|z|)
                    let log_zn = (zre2 + zim2).ln() * 0.5;
                    let nu = n as f64 + 1.0 - (log_zn / LN_2).ln() / LN_2;
                    // sqrt compresses the fast bands near the set edge
                    let [r, g, b] = palette(nu.max(0.0).sqrt() * 0.11);
                    self.buf[off..off + 4].copy_from_slice(&[r, g, b, 255]);
                }
            }
        }
    }

    pub fn buffer_ptr(&self) -> *const u8 {
        self.buf.as_ptr()
    }
}
