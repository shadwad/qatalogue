# Multi-stage container image for Qatalogue:
#   --target pipeline   Python 3.12 + Node 22 + make + locked deps for `make all`, `make test`, `make dev`
#   --target runtime    (default) Lean non-root Node 22 image serving the built production site (`dist/server.cjs`)

FROM node:22-bookworm-slim AS node

# ---------------------------------------------------------------------------
# 1. Pipeline & development toolchain (bind-mount your clone at /app)
# ---------------------------------------------------------------------------
FROM python:3.12-slim-bookworm AS pipeline
COPY --from=node /usr/local/bin/node /usr/local/bin/node
COPY --from=node /usr/local/lib/node_modules /usr/local/lib/node_modules
RUN ln -s ../lib/node_modules/npm/bin/npm-cli.js /usr/local/bin/npm \
 && ln -s ../lib/node_modules/npm/bin/npx-cli.js /usr/local/bin/npx

# make runs the Makefile; g++ is a fallback for packages without a prebuilt binary on this architecture.
RUN apt-get update \
 && apt-get install -y --no-install-recommends make g++ ca-certificates \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Python packages at locked versions in the .venv the Makefile expects.
COPY pipeline/requirements.lock pipeline/requirements.lock
RUN python -m venv .venv && .venv/bin/pip install --no-cache-dir -r pipeline/requirements.lock

# Node packages at locked versions (skip onnxruntime-node's optional CUDA download; embeddings run on CPU).
COPY package.json package-lock.json .npmrc ./
RUN ONNXRUNTIME_NODE_INSTALL_CUDA=skip npm ci --no-audit --no-fund

EXPOSE 3000 24678
CMD ["make", "help"]

# ---------------------------------------------------------------------------
# 2. Production Node dependencies (cached across code-only rebuilds)
# ---------------------------------------------------------------------------
FROM node:22-bookworm-slim AS prod-deps
RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 make g++ ca-certificates \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package.json package-lock.json .npmrc ./
# Install only production server dependencies and strip browser-only / foreign-platform binaries.
RUN ONNXRUNTIME_NODE_INSTALL_CUDA=skip npm ci --omit=dev --no-audit --no-fund \
 && node -e '\
     const fs = require("fs"); \
     const rm = p => fs.rmSync(p, { recursive: true, force: true }); \
     rm("node_modules/onnxruntime-web"); \
     rm("node_modules/onnxruntime-node/bin/napi-v3/darwin"); \
     rm("node_modules/onnxruntime-node/bin/napi-v3/win32"); \
     const ortLinux = "node_modules/onnxruntime-node/bin/napi-v3/linux"; \
     if (fs.existsSync(ortLinux)) { \
       for (const arch of fs.readdirSync(ortLinux)) if (arch !== process.arch) rm(`${ortLinux}/${arch}`); \
     } \
     rm("node_modules/@huggingface/transformers/dist/ort-wasm-simd-threaded.jsep.wasm"); \
     rm("node_modules/@huggingface/transformers/dist/ort-wasm-simd-threaded.jsep.mjs"); \
     rm("node_modules/better-sqlite3/deps"); \
     const prebuilds = "node_modules/better-sqlite3/prebuilds"; \
     if (fs.existsSync(prebuilds)) { \
       for (const file of fs.readdirSync(prebuilds)) if (file !== `linux-${process.arch}.node`) rm(`${prebuilds}/${file}`); \
     } \
     const imgDir = "node_modules/@img"; \
     if (fs.existsSync(imgDir)) { \
       for (const pkg of fs.readdirSync(imgDir)) if (pkg.includes("linuxmusl")) rm(`${imgDir}/${pkg}`); \
     }'

# ---------------------------------------------------------------------------
# 3. Frontend + server bundle builder
# ---------------------------------------------------------------------------
FROM node:22-bookworm-slim AS builder
RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 make g++ ca-certificates \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package.json package-lock.json .npmrc ./
RUN ONNXRUNTIME_NODE_INSTALL_CUDA=skip npm ci --no-audit --no-fund

COPY index.html tsconfig.json vite.config.ts site.config.jso[n] ./
COPY src ./src
COPY shared ./shared
COPY server ./server
COPY public ./public
COPY pipeline/config/scope.json pipeline/config/embedding.json ./pipeline/config/

ARG SITE_URL=""
RUN SITE_URL="$SITE_URL" npm run build

# ---------------------------------------------------------------------------
# 4. Lean non-root production runtime (default target)
# ---------------------------------------------------------------------------
FROM node:22-bookworm-slim AS runtime
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000

COPY --from=prod-deps --chown=node:node /app/node_modules ./node_modules
COPY --from=builder --chown=node:node /app/package.json ./
COPY --from=builder --chown=node:node /app/dist ./dist
COPY --from=builder --chown=node:node /app/pipeline/config/embedding.json ./pipeline/config/embedding.json
COPY --from=builder --chown=node:node /app/public ./public

RUN mkdir -p /app/data/models && chown -R node:node /app/data

USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:' + (process.env.PORT || 3000) + '/api/meta').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"]
CMD ["node", "dist/server.cjs"]
