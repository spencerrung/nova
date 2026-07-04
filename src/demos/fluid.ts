import type { Nova } from '../lib/wasm';
import { rgbaView } from '../lib/memory';
import { Hud } from '../lib/hud';
import { runWhenVisible } from '../lib/lifecycle';

const GRID = 192;
const GRID_FALLBACK = 128;
const SLOW_MS = 12;
const SLOW_FRAMES = 60; // downscale after 1s of slow steps
const VEL_GAIN = 40; // pointer delta (domain units) -> injected velocity
const MAX_IMPULSE = 6;
const SPLAT_RADIUS = 0.028;
const DYE_INTENSITY = 0.65;

function hueToRgb(h: number): [number, number, number] {
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    return 0.65 - 0.55 * Math.max(-1, Math.min(k - 3, 9 - k, 1));
  };
  return [f(0), f(8), f(4)];
}

export function setupFluid(nova: Nova, section: HTMLElement): void {
  const frame = section.querySelector<HTMLElement>('.demo-frame')!;
  const canvas = frame.querySelector<HTMLCanvasElement>('canvas')!;
  const ctx = canvas.getContext('2d')!;
  canvas.width = 1280;
  canvas.height = 720;

  let sim = new nova.FluidSim(GRID);
  let n = GRID;
  const off = document.createElement('canvas');
  const offCtx = off.getContext('2d')!;
  const applyGrid = () => {
    off.width = n;
    off.height = n;
  };
  applyGrid();

  const hud = new Hud(frame, ['fps', 'sim', 'grid']);
  hud.set('grid', `${n}×${n}`);

  let time = 0;
  let hue = 210;
  let hasInteracted = false;
  let slowStreak = 0;

  // --- pointer stirring ---
  let lastX = -1;
  let lastY = -1;
  const stir = (e: PointerEvent) => {
    const rect = canvas.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width;
    const y = (e.clientY - rect.top) / rect.height;
    if (x < 0 || x > 1 || y < 0 || y > 1) return;
    if (lastX >= 0) {
      const dx = x - lastX;
      const dy = y - lastY;
      const speed = Math.hypot(dx, dy);
      if (speed > 0) {
        hasInteracted = true;
        frame.classList.add('interacted');
        hue = (hue + speed * 600) % 360;
        const [r, g, b] = hueToRgb(hue);
        const clamp = (v: number) => Math.max(-MAX_IMPULSE, Math.min(MAX_IMPULSE, v));
        sim.add_impulse(
          x,
          y,
          clamp(dx * VEL_GAIN),
          clamp(dy * VEL_GAIN),
          r * DYE_INTENSITY,
          g * DYE_INTENSITY,
          b * DYE_INTENSITY,
          SPLAT_RADIUS,
        );
      }
    }
    lastX = x;
    lastY = y;
  };
  canvas.addEventListener('pointermove', stir);
  canvas.addEventListener('pointerdown', stir);
  canvas.addEventListener('pointerleave', () => {
    lastX = -1;
    lastY = -1;
  });

  // Two slow orbiting emitters keep the pool alive until the first touch
  const idleEmit = (dt: number) => {
    time += dt;
    for (let k = 0; k < 2; k++) {
      const a = time * 0.55 + k * Math.PI;
      const x = 0.5 + 0.27 * Math.cos(a);
      const y = 0.5 + 0.27 * Math.sin(a * 0.9);
      const [r, g, b] = hueToRgb((210 + time * 14 + k * 90) % 360);
      sim.add_impulse(
        x,
        y,
        -Math.sin(a) * 1.6,
        Math.cos(a) * 1.4,
        r * 0.3,
        g * 0.3,
        b * 0.3,
        0.05,
      );
    }
  };

  runWhenVisible(frame, (dt) => {
    if (!hasInteracted) idleEmit(dt);

    const t0 = performance.now();
    sim.step(Math.min(dt, 1 / 30));
    const simMs = performance.now() - t0;

    // Auto-downscale for low-end devices
    if (simMs > SLOW_MS && n > GRID_FALLBACK) {
      if (++slowStreak >= SLOW_FRAMES) {
        sim.free();
        sim = new nova.FluidSim(GRID_FALLBACK);
        n = GRID_FALLBACK;
        applyGrid();
        hud.set('grid', `${n}×${n}`);
      }
    } else {
      slowStreak = 0;
    }

    const bytes = rgbaView(sim.dye_ptr(), n * n * 4);
    offCtx.putImageData(new ImageData(new Uint8ClampedArray(bytes), n, n), 0, 0);
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(off, 0, 0, canvas.width, canvas.height);

    hud.frame(dt, simMs);
  });
}
