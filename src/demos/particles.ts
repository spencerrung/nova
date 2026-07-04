import type { Nova } from '../lib/wasm';
import { f32View } from '../lib/memory';
import { Hud } from '../lib/hud';
import { runWhenVisible } from '../lib/lifecycle';

const MAX_PARTICLES = 120_000;
const DEFAULT_PARTICLES = 50_000;
const FALLBACK_PARTICLES = 8_000;
const DPR_CAP = 1.5;

const VS = `#version 300 es
layout(location=0) in vec4 a_data; // x, y, vx, vy
uniform vec2 u_resolution;
out float v_t;
void main() {
  vec2 clip = (a_data.xy / u_resolution) * 2.0 - 1.0;
  gl_Position = vec4(clip.x, -clip.y, 0.0, 1.0);
  v_t = clamp(length(a_data.zw) / 900.0, 0.0, 1.0);
  gl_PointSize = 2.0;
}`;

const FS = `#version 300 es
precision mediump float;
in float v_t;
out vec4 outColor;
void main() {
  vec3 slow = vec3(0.486, 0.361, 1.0);  // #7c5cff
  vec3 fast = vec3(0.220, 0.898, 1.0);  // #38e5ff
  vec3 col = mix(slow, fast, v_t) * (0.16 + 0.55 * v_t);
  outColor = vec4(col, 1.0);
}`;

interface GlRenderer {
  draw(view: Float32Array, count: number, w: number, h: number): void;
}

function createGlRenderer(canvas: HTMLCanvasElement): GlRenderer | null {
  const gl = canvas.getContext('webgl2', {
    alpha: false,
    antialias: false,
    depth: false,
    stencil: false,
    powerPreference: 'high-performance',
  });
  if (!gl) return null;

  const compile = (type: number, src: string) => {
    const s = gl.createShader(type)!;
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
      throw new Error(gl.getShaderInfoLog(s) ?? 'shader compile failed');
    }
    return s;
  };

  const prog = gl.createProgram()!;
  gl.attachShader(prog, compile(gl.VERTEX_SHADER, VS));
  gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, FS));
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
    throw new Error(gl.getProgramInfoLog(prog) ?? 'program link failed');
  }
  gl.useProgram(prog);
  const uResolution = gl.getUniformLocation(prog, 'u_resolution');

  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);
  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, MAX_PARTICLES * 4 * 4, gl.STREAM_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 4, gl.FLOAT, false, 0, 0);

  gl.enable(gl.BLEND);
  gl.blendFunc(gl.ONE, gl.ONE); // additive glow on the dark background
  gl.clearColor(0.031, 0.031, 0.051, 1.0); // #08080d

  return {
    draw(view, count, w, h) {
      gl.viewport(0, 0, w, h);
      gl.uniform2f(uResolution, w, h);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, view.subarray(0, count * 4));
      gl.drawArrays(gl.POINTS, 0, count);
    },
  };
}

/** Canvas2d fallback for hardened browsers without WebGL: fewer, bigger dots. */
function create2dRenderer(canvas: HTMLCanvasElement): GlRenderer {
  const ctx = canvas.getContext('2d')!;
  return {
    draw(view, count, w, h) {
      ctx.fillStyle = '#08080d';
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = 'rgba(124, 128, 255, 0.8)';
      for (let i = 0; i < count; i++) {
        ctx.fillRect(view[i * 4], view[i * 4 + 1], 2, 2);
      }
    },
  };
}

export function setupParticles(nova: Nova, section: HTMLElement): void {
  const canvas = section.querySelector<HTMLCanvasElement>('canvas')!;

  const makeRenderer = (): { r: GlRenderer; gl: boolean } => {
    try {
      const r = createGlRenderer(canvas);
      if (r) return { r, gl: true };
    } catch {
      /* fall through to canvas2d */
    }
    return { r: create2dRenderer(canvas), gl: false };
  };
  let { r: renderer, gl: usingGl } = makeRenderer();

  canvas.addEventListener('webglcontextlost', (e) => e.preventDefault());
  canvas.addEventListener('webglcontextrestored', () => {
    try {
      renderer = createGlRenderer(canvas) ?? renderer;
    } catch {
      /* keep previous renderer; worst case the canvas stays frozen */
    }
  });

  const maxCount = usingGl ? MAX_PARTICLES : FALLBACK_PARTICLES;
  const dpr = Math.min(devicePixelRatio || 1, DPR_CAP);
  let w = Math.max(1, Math.round(section.clientWidth * dpr));
  let h = Math.max(1, Math.round(section.clientHeight * dpr));
  canvas.width = w;
  canvas.height = h;

  const sim = new nova.ParticleSim(maxCount, w, h, 0x9e3779b9);
  sim.set_count(usingGl ? DEFAULT_PARTICLES : FALLBACK_PARTICLES);

  new ResizeObserver(() => {
    const nw = Math.max(1, Math.round(section.clientWidth * dpr));
    const nh = Math.max(1, Math.round(section.clientHeight * dpr));
    if (nw === w && nh === h) return;
    w = nw;
    h = nh;
    canvas.width = w;
    canvas.height = h;
    sim.resize(w, h);
  }).observe(section);

  // Pointer state, in sim (canvas backing-store) coordinates
  let mx = 0;
  let my = 0;
  let strength = 0;
  let pointerDown = false;
  const updatePointer = (e: PointerEvent) => {
    const rect = canvas.getBoundingClientRect();
    mx = ((e.clientX - rect.left) / rect.width) * w;
    my = ((e.clientY - rect.top) / rect.height) * h;
    strength = pointerDown ? -1.0 : 0.55; // hover attracts, press repels
  };
  section.addEventListener('pointermove', updatePointer);
  section.addEventListener('pointerdown', (e) => {
    pointerDown = true;
    updatePointer(e);
  });
  section.addEventListener('pointerup', (e) => {
    pointerDown = false;
    updatePointer(e);
  });
  section.addEventListener('pointerleave', () => {
    strength = 0;
    pointerDown = false;
  });

  const hud = new Hud(section, ['fps', 'sim', 'particles', 'engine']);
  hud.set('engine', usingGl ? 'wasm + webgl2' : 'wasm + canvas2d');
  hud.set('particles', sim.count().toLocaleString());

  const slider = document.createElement('input');
  slider.type = 'range';
  slider.className = 'hud-slider';
  slider.min = '5000';
  slider.max = String(maxCount);
  slider.step = '5000';
  slider.value = String(sim.count());
  slider.setAttribute('aria-label', 'particle count');
  slider.addEventListener('input', () => {
    sim.set_count(Number(slider.value));
    hud.set('particles', sim.count().toLocaleString());
  });
  hud.el.append(slider);

  runWhenVisible(section, (dt) => {
    const t0 = performance.now();
    sim.step(dt, mx, my, strength);
    const simMs = performance.now() - t0;
    renderer.draw(f32View(sim.data_ptr(), maxCount * 4), sim.count(), w, h);
    hud.frame(dt, simMs);
  });
}
