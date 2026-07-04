use wasm_bindgen::prelude::*;

const PROJECT_ITERS: usize = 11; // Gauss-Seidel; visually close to 20, much cheaper
const VEL_DISSIPATION: f32 = 0.999;
const DYE_DISSIPATION: f32 = 0.994;
const MAX_VEL: f32 = 10.0; // domain units/s, blowup guard

/// Jos Stam "Real-Time Fluid Dynamics for Games" stable solver on an n x n
/// interior grid ((n+2)^2 with boundary cells), plus vorticity confinement
/// for lively swirls. Velocities are in domain units (0..1) per second.
#[wasm_bindgen]
pub struct FluidSim {
    n: usize,
    u: Vec<f32>,
    v: Vec<f32>,
    u0: Vec<f32>,
    v0: Vec<f32>,
    dye: [Vec<f32>; 3],
    dye0: [Vec<f32>; 3],
    curl: Vec<f32>,
    rgba: Vec<u8>,
    eps: f32,
}

#[wasm_bindgen]
impl FluidSim {
    #[wasm_bindgen(constructor)]
    pub fn new(n: u32) -> FluidSim {
        let n = n as usize;
        let size = (n + 2) * (n + 2);
        let z = || vec![0.0f32; size];
        FluidSim {
            n,
            u: z(),
            v: z(),
            u0: z(),
            v0: z(),
            dye: [z(), z(), z()],
            dye0: [z(), z(), z()],
            curl: z(),
            rgba: vec![0; n * n * 4],
            eps: 14.0,
        }
    }

    pub fn size(&self) -> u32 {
        self.n as u32
    }

    pub fn set_vorticity(&mut self, eps: f32) {
        self.eps = eps;
    }

    /// x, y in [0,1] (y down, matching canvas coords); dx, dy in domain
    /// units/s; radius in domain units.
    #[allow(clippy::too_many_arguments)]
    pub fn add_impulse(
        &mut self,
        x: f32,
        y: f32,
        dx: f32,
        dy: f32,
        r: f32,
        g: f32,
        b: f32,
        radius: f32,
    ) {
        let n = self.n;
        let w = n + 2;
        let cx = x * n as f32;
        let cy = y * n as f32;
        let rad = (radius * n as f32).max(1.5);
        let r2 = rad * rad;
        let i0 = ((cx - rad).floor().max(1.0)) as usize;
        let i1 = ((cx + rad).ceil().min(n as f32)) as usize;
        let j0 = ((cy - rad).floor().max(1.0)) as usize;
        let j1 = ((cy + rad).ceil().min(n as f32)) as usize;
        for j in j0..=j1 {
            for i in i0..=i1 {
                let ddx = i as f32 - cx;
                let ddy = j as f32 - cy;
                let d2 = ddx * ddx + ddy * ddy;
                if d2 > r2 {
                    continue;
                }
                let wgt = (-d2 / (r2 * 0.5)).exp();
                let idx = i + j * w;
                self.u[idx] += dx * wgt;
                self.v[idx] += dy * wgt;
                self.dye[0][idx] += r * wgt;
                self.dye[1][idx] += g * wgt;
                self.dye[2][idx] += b * wgt;
            }
        }
    }

    pub fn step(&mut self, dt: f32) {
        let n = self.n;

        self.confine_vorticity(dt);
        clamp_field(&mut self.u, MAX_VEL);
        clamp_field(&mut self.v, MAX_VEL);
        project(n, &mut self.u, &mut self.v, &mut self.u0, &mut self.v0);

        std::mem::swap(&mut self.u, &mut self.u0);
        std::mem::swap(&mut self.v, &mut self.v0);
        advect(n, 1, &mut self.u, &self.u0, &self.u0, &self.v0, dt);
        advect(n, 2, &mut self.v, &self.v0, &self.u0, &self.v0, dt);
        project(n, &mut self.u, &mut self.v, &mut self.u0, &mut self.v0);

        for x in self.u.iter_mut() {
            *x *= VEL_DISSIPATION;
        }
        for x in self.v.iter_mut() {
            *x *= VEL_DISSIPATION;
        }

        for k in 0..3 {
            std::mem::swap(&mut self.dye[k], &mut self.dye0[k]);
            advect(n, 0, &mut self.dye[k], &self.dye0[k], &self.u, &self.v, dt);
            for x in self.dye[k].iter_mut() {
                *x *= DYE_DISSIPATION;
            }
        }

        self.write_rgba();
    }

    pub fn dye_ptr(&self) -> *const u8 {
        self.rgba.as_ptr()
    }

    fn confine_vorticity(&mut self, dt: f32) {
        let n = self.n;
        let w = n + 2;
        for j in 1..=n {
            for i in 1..=n {
                let idx = i + j * w;
                self.curl[idx] = 0.5
                    * ((self.v[idx + 1] - self.v[idx - 1]) - (self.u[idx + w] - self.u[idx - w]));
            }
        }
        for j in 2..n {
            for i in 2..n {
                let idx = i + j * w;
                let gx = (self.curl[idx + 1].abs() - self.curl[idx - 1].abs()) * 0.5;
                let gy = (self.curl[idx + w].abs() - self.curl[idx - w].abs()) * 0.5;
                let len = (gx * gx + gy * gy).sqrt() + 1e-5;
                let c = self.curl[idx];
                // F = eps * (N x omega): pushes flow around vortex cores
                self.u[idx] += self.eps * (gy / len) * c * dt;
                self.v[idx] -= self.eps * (gx / len) * c * dt;
            }
        }
    }

    fn write_rgba(&mut self) {
        let n = self.n;
        let w = n + 2;
        for j in 0..n {
            for i in 0..n {
                let src = (i + 1) + (j + 1) * w;
                let dst = (i + j * n) * 4;
                for k in 0..3 {
                    // Filmic-ish soft clip: keeps dense dye from clipping flat
                    let t = 1.0 - (-self.dye[k][src] * 2.4).exp();
                    self.rgba[dst + k] = (t * 255.0) as u8;
                }
                self.rgba[dst + 3] = 255;
            }
        }
    }
}

fn clamp_field(f: &mut [f32], max: f32) {
    for x in f.iter_mut() {
        *x = x.clamp(-max, max);
    }
}

fn set_bnd(n: usize, b: i32, x: &mut [f32]) {
    let w = n + 2;
    for i in 1..=n {
        x[i * w] = if b == 1 { -x[1 + i * w] } else { x[1 + i * w] };
        x[(n + 1) + i * w] = if b == 1 { -x[n + i * w] } else { x[n + i * w] };
        x[i] = if b == 2 { -x[i + w] } else { x[i + w] };
        x[i + (n + 1) * w] = if b == 2 { -x[i + n * w] } else { x[i + n * w] };
    }
    x[0] = 0.5 * (x[1] + x[w]);
    x[n + 1] = 0.5 * (x[n] + x[(n + 1) + w]);
    x[(n + 1) * w] = 0.5 * (x[1 + (n + 1) * w] + x[n * w]);
    x[(n + 1) + (n + 1) * w] = 0.5 * (x[n + (n + 1) * w] + x[(n + 1) + n * w]);
}

/// Semi-Lagrangian advection with bilinear sampling (Stam).
fn advect(n: usize, b: i32, d: &mut [f32], d0: &[f32], u: &[f32], v: &[f32], dt: f32) {
    let w = n + 2;
    let dt0 = dt * n as f32;
    for j in 1..=n {
        for i in 1..=n {
            let idx = i + j * w;
            let x = (i as f32 - dt0 * u[idx]).clamp(0.5, n as f32 + 0.5);
            let y = (j as f32 - dt0 * v[idx]).clamp(0.5, n as f32 + 0.5);
            let i0 = x.floor() as usize;
            let j0 = y.floor() as usize;
            let i1 = i0 + 1;
            let j1 = j0 + 1;
            let s1 = x - i0 as f32;
            let s0 = 1.0 - s1;
            let t1 = y - j0 as f32;
            let t0 = 1.0 - t1;
            d[idx] = s0 * (t0 * d0[i0 + j0 * w] + t1 * d0[i0 + j1 * w])
                + s1 * (t0 * d0[i1 + j0 * w] + t1 * d0[i1 + j1 * w]);
        }
    }
    set_bnd(n, b, d);
}

/// Helmholtz projection onto a divergence-free field. p/div are scratch.
fn project(n: usize, u: &mut [f32], v: &mut [f32], p: &mut [f32], div: &mut [f32]) {
    let w = n + 2;
    let h = 1.0 / n as f32;
    for j in 1..=n {
        for i in 1..=n {
            let idx = i + j * w;
            div[idx] = -0.5 * h * (u[idx + 1] - u[idx - 1] + v[idx + w] - v[idx - w]);
            p[idx] = 0.0;
        }
    }
    set_bnd(n, 0, div);
    set_bnd(n, 0, p);
    for _ in 0..PROJECT_ITERS {
        for j in 1..=n {
            for i in 1..=n {
                let idx = i + j * w;
                p[idx] = (div[idx] + p[idx - 1] + p[idx + 1] + p[idx - w] + p[idx + w]) * 0.25;
            }
        }
        set_bnd(n, 0, p);
    }
    for j in 1..=n {
        for i in 1..=n {
            let idx = i + j * w;
            u[idx] -= 0.5 * (p[idx + 1] - p[idx - 1]) / h;
            v[idx] -= 0.5 * (p[idx + w] - p[idx - w]) / h;
        }
    }
    set_bnd(n, 1, u);
    set_bnd(n, 2, v);
}
