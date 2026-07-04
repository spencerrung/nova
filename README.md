# nova

**WebAssembly, running wild in your browser** — live at [nova.alucard.dev](https://nova.alucard.dev).

nova is an aesthetics-first showcase of what WebAssembly makes possible: real
simulation workloads — the kind that used to need native apps or a server farm —
running live on whatever device opens the page. No plugins, no installs, no backend
doing the work. Just one small binary and your CPU.

## The demos

Everything moving on the site comes from a single **~30 KB (gzipped)** `.wasm` binary
compiled from Rust:

- 🌌 **Particle galaxy** — up to 120,000 particles under gravity, swirl and cursor
  forces, stepped in Rust every frame and rendered as WebGL2 point sprites straight
  out of wasm linear memory. Zero copies between simulation and GPU upload.
- 🌀 **Fractal explorer** — Mandelbrot, Julia and Burning Ship escape-time fractals
  over 64-bit floats with smooth coloring. Drag to pan, scroll to dive ~10¹³× deep;
  resolution adapts while you move so input never lags, then the full-res image
  settles in behind you.
- 💨 **Fluid dynamics** — a real Navier–Stokes solver (Jos Stam's stable fluids, with
  vorticity confinement for the pretty swirls) on a 192×192 grid, advected, projected
  and rendered every frame. Stir it with your cursor.

Each demo carries a live HUD — fps, simulation milliseconds, element counts — because
the numbers *are* the argument.

## Why WebAssembly is cool

- **Near-native speed.** WASM is an ahead-of-time compilation target with a linear
  memory model: no garbage collector, no dynamic-type overhead, SIMD when the math
  wants it. The fluid solver does a 14-pass pressure solve over 36k cells in ~6 ms.
- **Compiled before it finishes downloading.** Browsers compile WASM while it streams
  over the network — the site measures this live on every visit and shows you the
  real number (typically ~20 ms for fetch + compile + instantiate).
- **Sandboxed by design.** The module can touch nothing but the memory it owns and
  the functions it's handed. Native-class compute with web-class safety.
- **Language-agnostic.** This site is Rust, but C, C++, Go, Zig, C# — dozens of
  languages target the same binary format, and JavaScript calls them all the same way.
- **Ship compute, not infrastructure.** The heavy lifting happens on the visitor's
  device. The server side of this entire site is a stock nginx container serving
  static files from a Raspberry Pi cluster.

## Architecture

```
wasm/  Rust + wasm-bindgen ──wasm-pack──▶ wasm/pkg ──┐
                                                     ├──vite build──▶ dist/ ──▶ nginx
src/   TypeScript, no framework ─────────────────────┘
```

The split is strict: **physics lives in Rust, rendering and input live in
TypeScript.** Rust owns all simulation state in flat `Vec`s and exposes raw pointers;
JS reads them through typed-array views over wasm linear memory — the particle buffer
goes from simulation to `gl.bufferSubData` without a single copy. The page itself is
a tabbed shell of four full-viewport panels; only the visible demo's loop runs.

## Contributing / running locally

Setup, build, container and deployment docs live in
[docs/developer-guide.md](docs/developer-guide.md).

MIT licensed.
