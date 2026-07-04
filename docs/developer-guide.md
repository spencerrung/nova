# Developer Guide

Step-by-step setup for hacking on nova locally. The stack is:

- **Rust** (stable) with the `wasm32-unknown-unknown` target — the simulation engine
- **wasm-pack** — compiles the Rust crate and generates the JS/TS bindings in `wasm/pkg/`
- **Node.js 22+** with npm — Vite dev server, TypeScript, bundling
- **Docker** (optional) — only needed to test the production nginx container

## 1. Install prerequisites

### Linux

Install Rust via rustup (preferred over distro packages so `rustup target add` works):

```sh
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
source "$HOME/.cargo/env"
```

On Arch-based distros (including CachyOS) rustup is also packaged:

```sh
sudo pacman -S rustup && rustup default stable
```

Add the WASM target and wasm-pack:

```sh
rustup target add wasm32-unknown-unknown
cargo install wasm-pack        # or: sudo pacman -S wasm-pack / apt install wasm-pack
```

Node 22+ from your package manager (`sudo pacman -S nodejs npm`,
`sudo apt install nodejs npm` on Ubuntu 24.04+) or via [fnm](https://github.com/Schniz/fnm)
if the distro version is older than 22:

```sh
fnm install 22 && fnm use 22
```

### macOS

With [Homebrew](https://brew.sh):

```sh
brew install rustup node
rustup-init -y                 # accept defaults (stable toolchain)
source "$HOME/.cargo/env"
rustup target add wasm32-unknown-unknown
cargo install wasm-pack        # or: brew install wasm-pack
```

Docker Desktop (optional, for container testing): `brew install --cask docker`.

### Verify the toolchain

```sh
rustc --version                          # >= 1.75
rustup target list --installed | grep wasm32-unknown-unknown
wasm-pack --version
node --version                           # >= 22
```

## 2. Clone and install

```sh
git clone git@github.com:spencerrung/nova.git
cd nova
npm install
```

`npm install` only pulls Vite, TypeScript, and the self-hosted font packages — there
is no framework and no wasm plugin.

## 3. Run the dev server

```sh
npm run dev
```

This runs `wasm-pack build wasm --target web --release` first (output lands in
`wasm/pkg/`, which is gitignored), then starts Vite at <http://localhost:5173>.

**After editing Rust code** you must rebuild the wasm — Vite does not watch the crate.
Either restart `npm run dev`, or in a second terminal:

```sh
npm run build:wasm             # Vite hot-reloads when wasm/pkg/ changes
```

TypeScript/CSS/HTML edits hot-reload as usual.

## 4. Production build

```sh
npm run build                  # wasm-pack → tsc --noEmit → vite build → dist/
npm run preview                # serves dist/ at http://localhost:4173
```

The type check (`tsc --noEmit`) runs in `npm run build` but not in the Docker image
build, so run it before pushing.

## 5. Test the production container (optional)

```sh
docker build -t nova:local .
docker run --rm -p 8080:80 nova:local
```

Checks worth doing at <http://localhost:8080> — these are the two classic
"works in dev, dead in prod" failures:

```sh
# .wasm must be served as application/wasm (streaming compilation hard-fails otherwise)
curl -sI "http://localhost:8080/assets/$(basename $(ls dist/assets/*.wasm))" | grep -i content-type

# CSP must contain 'wasm-unsafe-eval' (Chromium blocks instantiation otherwise)
curl -sI http://localhost:8080/ | grep -i content-security-policy
```

Then load the page and confirm the browser console is clean.

## 6. Deployment

Pushes to `main` trigger `.github/workflows/docker.yml`: buildx builds
`linux/amd64,linux/arm64` and pushes `docker.io/spencerrung/nova:latest` +
`sha-<sha>` (requires `DOCKERHUB_USERNAME` / `DOCKERHUB_TOKEN` repo secrets).

The homelab Flux cluster deploys it from `homelab-infra/homelab-k8s/apps/nova/`
(2 nginx replicas, Traefik ingress, cert-manager TLS via the `letsencrypt-prod`
ClusterIssuer). The app is registered in `apps/overlays/homelab/kustomization.yaml`;
Flux reconciles that overlay every 10 minutes.

There is no Flux image automation — the deployment pins `:latest`, so after the
first deploy, roll new images with:

```sh
kubectl rollout restart deployment/nova -n nova
```

DNS: `nova.alucard.dev` is a manual Cloudflare record pointing at the cluster
ingress. First-deploy order matters: the image must exist on Docker Hub (CI has run
once) before Flux applies the manifests, otherwise the pods sit in ImagePullBackOff
until it does.

## 7. Project layout

```
wasm/                Rust crate (one .wasm binary, three modules)
  src/particles.rs     particle sim — interleaved x,y,vx,vy in one Vec<f32>
  src/fractal.rs       Mandelbrot/Julia escape-time → RGBA buffer
  src/fluid.rs         Stam stable-fluids solver → RGBA dye buffer
  .cargo/config.toml   enables +simd128 for all wasm builds
src/
  main.ts              wasm init + demo bootstrap + live boot stats
  lib/wasm.ts          init() wrapper, exposes wasm memory + boot timings
  lib/memory.ts        typed-array views over wasm linear memory
  lib/lifecycle.ts     IntersectionObserver/visibility gating, reduced-motion
  lib/hud.ts           per-demo fps / sim-ms overlay
  demos/               one TS file per demo (rendering + input only — no physics)
index.html             all page copy lives here
```

The JS/WASM boundary convention: Rust owns all state in `Vec`s and exposes
`*_ptr()` + length accessors; TS creates fresh typed-array views per frame
(`src/lib/memory.ts`) — views are cheap and immune to detachment when wasm
memory grows. Keep physics in Rust and rendering/input in TS.

## Troubleshooting

- **`error: no prebuilt wasm-bindgen binaries` / wasm-pack download failures** —
  `cargo install wasm-bindgen-cli` and re-run; wasm-pack picks up the installed binary.
- **Blank demos + console MIME error in `npm run preview`** — you're serving a stale
  `dist/`; re-run `npm run build`.
- **`Float32Array` views throwing after a while** — something is caching a view across
  frames; always go through `f32View()`/`rgbaView()` per frame.
- **Slow `npm run build:wasm`** — the release profile uses `lto = true` +
  `codegen-units = 1`; a clean build takes ~15s, incremental ~5s. That's expected.
- **Docker multi-arch build suddenly takes 20+ minutes in CI** — someone removed
  `--platform=$BUILDPLATFORM` from the build stages in the Dockerfile, putting the
  cargo build under QEMU. Put it back.
