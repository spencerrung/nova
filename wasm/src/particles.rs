use crate::util::XorShift;
use wasm_bindgen::prelude::*;

const MOUSE_FORCE: f32 = 2.5e7; // px/s^2 at 1px, falls off with distance^2
const MOUSE_SOFTENING: f32 = 400.0; // (20px)^2, avoids singularity at cursor
const MAX_ACCEL: f32 = 4000.0; // px/s^2
const CENTER_FORCE: f32 = 1.2e7;
const CENTER_SOFTENING: f32 = 2500.0;
const SWIRL_ACCEL: f32 = 55.0; // px/s^2 tangential push, keeps the idle galaxy turning
const DAMPING_PER_FRAME: f32 = 0.988; // at 60fps
const MAX_SPEED: f32 = 1200.0; // px/s

/// Particle state lives in one interleaved Vec<f32> (x, y, vx, vy) so JS can
/// view it directly over wasm linear memory and upload it to WebGL in one call.
#[wasm_bindgen]
pub struct ParticleSim {
    data: Vec<f32>,
    max_count: u32,
    count: u32,
    width: f32,
    height: f32,
}

#[wasm_bindgen]
impl ParticleSim {
    #[wasm_bindgen(constructor)]
    pub fn new(max_count: u32, width: f32, height: f32, seed: u32) -> ParticleSim {
        let mut rng = XorShift::new(seed);
        let mut data = Vec::with_capacity((max_count as usize) * 4);
        let cx = width * 0.5;
        let cy = height * 0.5;
        let max_r = width.max(height) * 0.5;
        for _ in 0..max_count {
            // Spawn in a disc with orbital velocity so the galaxy is alive from frame 0
            let r = rng.next_f32().sqrt() * max_r;
            let a = rng.next_f32() * std::f32::consts::TAU;
            let x = cx + a.cos() * r;
            let y = cy + a.sin() * r;
            let orbital = (CENTER_FORCE / (r * r + CENTER_SOFTENING)).sqrt() * r.sqrt();
            let speed = orbital.min(MAX_SPEED) * (0.6 + rng.next_f32() * 0.5);
            data.push(x);
            data.push(y);
            data.push(-a.sin() * speed);
            data.push(a.cos() * speed);
        }
        ParticleSim {
            data,
            max_count,
            count: max_count,
            width,
            height,
        }
    }

    pub fn set_count(&mut self, count: u32) {
        self.count = count.min(self.max_count);
    }

    pub fn count(&self) -> u32 {
        self.count
    }

    pub fn resize(&mut self, width: f32, height: f32) {
        let sx = width / self.width;
        let sy = height / self.height;
        for i in 0..self.max_count as usize {
            self.data[i * 4] *= sx;
            self.data[i * 4 + 1] *= sy;
        }
        self.width = width;
        self.height = height;
    }

    /// dt in seconds (clamp in JS to <= 1/30). strength > 0 attracts toward the
    /// pointer, < 0 repels, 0 means no pointer — the idle galaxy keeps swirling.
    pub fn step(&mut self, dt: f32, mouse_x: f32, mouse_y: f32, strength: f32) {
        let cx = self.width * 0.5;
        let cy = self.height * 0.5;
        let damp = DAMPING_PER_FRAME.powf(dt * 60.0);
        let mouse_on = strength != 0.0;

        for i in 0..self.count as usize {
            let idx = i * 4;
            let x = self.data[idx];
            let y = self.data[idx + 1];
            let mut vx = self.data[idx + 2];
            let mut vy = self.data[idx + 3];

            // Central gravity + tangential swirl -> slow galaxy rotation when idle
            let dxc = cx - x;
            let dyc = cy - y;
            let dc2 = dxc * dxc + dyc * dyc + CENTER_SOFTENING;
            let inv_dc = 1.0 / dc2.sqrt();
            let g = (CENTER_FORCE / dc2).min(MAX_ACCEL);
            vx += (dxc * inv_dc * g - dyc * inv_dc * SWIRL_ACCEL) * dt;
            vy += (dyc * inv_dc * g + dxc * inv_dc * SWIRL_ACCEL) * dt;

            if mouse_on {
                let dx = mouse_x - x;
                let dy = mouse_y - y;
                let d2 = dx * dx + dy * dy + MOUSE_SOFTENING;
                let inv_d = 1.0 / d2.sqrt();
                let f = (strength * MOUSE_FORCE / d2).clamp(-MAX_ACCEL, MAX_ACCEL);
                vx += dx * inv_d * f * dt;
                vy += dy * inv_d * f * dt;
            }

            vx *= damp;
            vy *= damp;

            let sp2 = vx * vx + vy * vy;
            if sp2 > MAX_SPEED * MAX_SPEED {
                let s = MAX_SPEED / sp2.sqrt();
                vx *= s;
                vy *= s;
            }

            let mut nx = x + vx * dt;
            let mut ny = y + vy * dt;

            // Soft wrap keeps the field continuous under additive blending
            if nx < -10.0 {
                nx += self.width + 20.0;
            } else if nx > self.width + 10.0 {
                nx -= self.width + 20.0;
            }
            if ny < -10.0 {
                ny += self.height + 20.0;
            } else if ny > self.height + 10.0 {
                ny -= self.height + 20.0;
            }

            self.data[idx] = nx;
            self.data[idx + 1] = ny;
            self.data[idx + 2] = vx;
            self.data[idx + 3] = vy;
        }
    }

    pub fn data_ptr(&self) -> *const f32 {
        self.data.as_ptr()
    }
}
