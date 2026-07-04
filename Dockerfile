# Stages 1-2 are pinned to $BUILDPLATFORM: the wasm/JS/CSS artifacts they
# produce are architecture-independent, so buildx runs them ONCE natively
# instead of per-platform under QEMU (a cargo build under QEMU takes 20-40min).
# Only the final nginx stage is built per target platform.

# ---- Stage 1: Rust -> WASM ----
FROM --platform=$BUILDPLATFORM rust:1-slim AS wasm-builder
RUN apt-get update \
    && apt-get install -y --no-install-recommends curl ca-certificates \
    && rm -rf /var/lib/apt/lists/* \
    && curl -sSf https://rustwasm.github.io/wasm-pack/installer/init.sh | sh \
    && rustup target add wasm32-unknown-unknown
WORKDIR /app
COPY wasm/ ./wasm/
RUN wasm-pack build wasm --target web --release

# ---- Stage 2: Vite build ----
FROM --platform=$BUILDPLATFORM node:22-alpine AS web-builder
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts && npm rebuild esbuild
COPY . .
COPY --from=wasm-builder /app/wasm/pkg ./wasm/pkg
RUN npx vite build

# ---- Stage 3: nginx (multi-arch) ----
FROM nginx:alpine
COPY --from=web-builder /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD wget --quiet --tries=1 --spider http://localhost/ || exit 1
CMD ["nginx", "-g", "daemon off;"]
