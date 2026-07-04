import type { Nova } from '../lib/wasm';
import { rgbaView } from '../lib/memory';
import { Hud } from '../lib/hud';
import { runWhenVisible } from '../lib/lifecycle';

const MAX_W = 960;
const MAX_H = 540;
const IDLE_DELAY_MS = 120;
const JULIA_C = { re: -0.784, im: 0.153 };
// Home view per mode: Mandelbrot, Julia, Burning Ship (im pre-mirrored in Rust)
const HOMES = [
  { re: -0.7, im: 0.0 },
  { re: 0.0, im: 0.0 },
  { re: -0.5, im: 0.65 },
];
const MIN_SCALE = 1e-13; // ~ where f64 runs out of mantissa

export function setupFractal(nova: Nova, section: HTMLElement): void {
  const frame = section.querySelector<HTMLElement>('.demo-frame')!;
  const canvas = frame.querySelector<HTMLCanvasElement>('canvas')!;
  const ctx = canvas.getContext('2d')!;

  const w = MAX_W;
  const h = MAX_H;
  canvas.width = w;
  canvas.height = h;

  const preview = document.createElement('canvas');
  preview.width = w / 2;
  preview.height = h / 2;
  const previewCtx = preview.getContext('2d')!;

  const renderer = new nova.FractalRenderer(w, h);
  const homeScale = Math.max(3.0 / w, 2.6 / h);

  let centerRe = HOMES[0].re;
  let centerIm = HOMES[0].im;
  let scale = homeScale;
  let mode = 0;

  let lastInteraction = -Infinity;
  let settleY = 0; // next full-res row to render; >= h means settled
  let settleMs = 0;
  let lastRenderMs = 0;
  let previewScale = 0.5; // adapts to keep deep zooms responsive

  const hud = new Hud(frame, ['fps', 'sim', 'zoom', 'iter']);

  const maxIter = () =>
    Math.min(1500, Math.round(96 + 48 * Math.max(0, Math.log10(homeScale / scale))));

  const invalidate = () => {
    lastInteraction = performance.now();
    settleY = 0;
    settleMs = 0;
    frame.classList.toggle('at-limit', scale <= MIN_SCALE);
  };

  // --- input: drag to pan, wheel to zoom about the cursor ---
  let dragging = false;
  let lastX = 0;
  let lastY = 0;

  canvas.addEventListener('pointerdown', (e) => {
    dragging = true;
    lastX = e.clientX;
    lastY = e.clientY;
    canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    const rect = canvas.getBoundingClientRect();
    const perCssPx = scale * (w / rect.width); // complex units per CSS pixel
    centerRe -= (e.clientX - lastX) * perCssPx;
    centerIm += (e.clientY - lastY) * perCssPx;
    lastX = e.clientX;
    lastY = e.clientY;
    invalidate();
  });
  canvas.addEventListener('pointerup', () => (dragging = false));
  canvas.addEventListener('pointercancel', () => (dragging = false));

  canvas.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault();
      const rect = canvas.getBoundingClientRect();
      const px = ((e.clientX - rect.left) / rect.width) * w;
      const py = ((e.clientY - rect.top) / rect.height) * h;
      const factor = Math.exp(e.deltaY * 0.0015);
      const newScale = Math.min(Math.max(scale * factor, MIN_SCALE), homeScale * 2);
      const f = newScale / scale;
      centerRe += (px - w / 2) * scale * (1 - f);
      centerIm -= (py - h / 2) * scale * (1 - f);
      scale = newScale;
      invalidate();
    },
    { passive: false },
  );

  // --- controls: segmented fractal picker + reset ---
  const modeBtns = [...section.querySelectorAll<HTMLButtonElement>('[data-fractal-mode]')];
  for (const btn of modeBtns) {
    btn.addEventListener('click', () => {
      mode = Number(btn.dataset.fractalMode);
      for (const b of modeBtns) b.classList.toggle('active', b === btn);
      resetView();
    });
  }
  section.querySelector<HTMLButtonElement>('[data-fractal-reset]')?.addEventListener('click', resetView);

  function resetView() {
    const home = HOMES[mode] ?? HOMES[0];
    centerRe = home.re;
    centerIm = home.im;
    scale = homeScale;
    invalidate();
  }

  // Copies only the rendered rows out of wasm memory (ImageData requires a
  // buffer it owns; some engines reject views over wasm linear memory).
  const put = (target: CanvasRenderingContext2D, tw: number, y0: number, y1: number) => {
    const rows = rgbaView(renderer.buffer_ptr() + y0 * tw * 4, (y1 - y0) * tw * 4);
    target.putImageData(new ImageData(new Uint8ClampedArray(rows), tw, y1 - y0), 0, y0);
  };

  runWhenVisible(frame, (dt) => {
    const interacting = dragging || performance.now() - lastInteraction < IDLE_DELAY_MS;
    const iter = maxIter();

    if (interacting) {
      // Low-res preview each frame keeps input latency bounded; resolution
      // adapts to the measured render cost so deep zooms stay fluid
      const pw = Math.max(120, Math.round((w * previewScale) / 2) * 2);
      const ph = Math.max(68, Math.round((h * pw) / w / 2) * 2);
      if (preview.width !== pw || preview.height !== ph) {
        preview.width = pw;
        preview.height = ph;
      }
      const t0 = performance.now();
      renderer.render(pw, ph, 0, ph, centerRe, centerIm, scale * (w / pw), Math.min(iter, 500), mode, JULIA_C.re, JULIA_C.im);
      const ms = performance.now() - t0;
      lastRenderMs = ms;
      if (ms > 16 && previewScale > 0.18) previewScale *= 0.85;
      else if (ms < 6 && previewScale < 0.5) previewScale *= 1.12;
      put(previewCtx, pw, 0, ph);
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(preview, 0, 0, w, h);
      settleY = 0;
      settleMs = 0;
    } else if (settleY < h) {
      // Full-res settle, time-budgeted: render rows until ~10ms is spent,
      // continue next frame — the page never janks, however deep the zoom
      const t0 = performance.now();
      while (settleY < h && performance.now() - t0 < 10) {
        const y1 = Math.min(h, settleY + 24);
        renderer.render(w, h, settleY, y1, centerRe, centerIm, scale, iter, mode, JULIA_C.re, JULIA_C.im);
        put(ctx, w, settleY, y1);
        settleY = y1;
      }
      settleMs += performance.now() - t0;
      if (settleY >= h) lastRenderMs = settleMs;
    }

    hud.frame(dt, lastRenderMs);
    hud.set('zoom', `${(homeScale / scale).toExponential(1)}×`);
    hud.set('iter', String(iter));
  });

  invalidate();
}
