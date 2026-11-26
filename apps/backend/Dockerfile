# Multi-stage Dockerfile for Umbrel Bitcoin Node app
#
# * dev: `docker compose up` builds the **dev** stage only
# hot-reloading backend container (the UI dev server lives in its own
# apps/ui/Dockerfile; both share a hoisted node_modules volume in the compose file).
#
# * production: `docker build ...` produces a single self-contained image containing:
#  – compiled backend
#  – bundled React UI (Vite output → dist/public)
#  – compiled shared libs (libs/settings, libs/shared-types)
#  – Bitcoin Roots binaries

###########################################
###########################################
# Bitcoin Roots
###########################################
# Downloads and verifies the Bitcoin Roots release binaries for the target
# architecture. Checksums are the SHA-512 digests published in the release's
# signed SHA512SUMS manifest.
# https://github.com/LuganoPlanB/bitcoin-roots
FROM --platform=$BUILDPLATFORM debian:bookworm-slim AS bitcoind_30_3_roots_1
ARG TARGETARCH
ARG ROOTS_VERSION=30.3-roots.1
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates curl \
 && rm -rf /var/lib/apt/lists/*
RUN set -eux; \
    case "${TARGETARCH}" in \
      amd64) roots_arch='x86_64';  roots_sha512='9aa635a2aa680dcb5d1f872ec95b208cf6825dab14b86f1b721fbfebe1116ac4dd3405fadc33b5b5deac7eb6b1063a3b10c85de59bbd496664034034f88adddf' ;; \
      arm64) roots_arch='aarch64'; roots_sha512='fa84500586028c625968e7de9c9a3533016ae8295c50af4bc28e26464d0161fda31bf4fd6f13e23c2072d9107a5b6410ad7d378cb5c32004cab58602fab9f201' ;; \
      *) echo "Unsupported TARGETARCH: ${TARGETARCH}" >&2; exit 1 ;; \
    esac; \
    curl --proto '=https' --tlsv1.2 -fsSL -o /tmp/bitcoin-roots.tar.gz "https://github.com/LuganoPlanB/bitcoin-roots/releases/download/v${ROOTS_VERSION}/bitcoin-roots-linux-${roots_arch}.tar.gz"; \
    echo "${roots_sha512}  /tmp/bitcoin-roots.tar.gz" | sha512sum -c -; \
    tar -xzf /tmp/bitcoin-roots.tar.gz -C /tmp; \
    install -Dm0755 "/tmp/bitcoin-roots-${ROOTS_VERSION}/bin/bitcoind" /bin/bitcoind; \
    install -Dm0755 "/tmp/bitcoin-roots-${ROOTS_VERSION}/bin/bitcoin-cli" /bin/bitcoin-cli; \
    install -Dm0755 "/tmp/bitcoin-roots-${ROOTS_VERSION}/bin/bitcoin" /bin/bitcoin; \
    install -Dm0755 "/tmp/bitcoin-roots-${ROOTS_VERSION}/libexec/bitcoin-node" /usr/bin/bitcoin-node; \
    rm -rf /tmp/bitcoin-roots.tar.gz "/tmp/bitcoin-roots-${ROOTS_VERSION}"

##########################################################
# Dependencies layer — install every workspace deps
# Functions as a shared cache for dev & app-builder stages
##########################################################
# Roots release binaries require GLIBC >= 2.38 and GLIBCXX >= 3.4.32.
# Pin Trixie explicitly: the unqualified Node slim image uses older libraries.
FROM node:24.19.0-trixie-slim@sha256:ab3eebe934147fee049b5eb83c570f68c849a13c930bdfa482de99fcdfa3b3de AS deps
WORKDIR /repo

# Copy only dependency manifests to keep this layer cache-friendly
COPY package*.json ./
COPY apps/backend/package*.json apps/backend/
COPY apps/ui/package*.json apps/ui/

RUN npm ci --workspaces --include-workspace-root --install-strategy=hoisted --ignore-scripts

# Add npm binaries to PATH so subsequent stages can invoke tsc / vite / etc.
ENV PATH="/repo/node_modules/.bin:$PATH"

####################################################
# DEV-ONLY build stage: Backend hot-reload image
# - Not referenced by later COPY --from=… steps,
#   so it’s skipped during a plain `docker build`.
# - `docker compose up` targets it via `target: dev`
#   in the docker-compose.yml file.
####################################################
FROM deps AS dev
WORKDIR /repo/apps/backend

VOLUME /data

# Bitcoin Roots binaries:
# - bitcoind: normal monolithic daemon
# - bitcoin-cli: RPC client used by the backend and manual container execs
# - bitcoin + bitcoin-node: multiprocess IPC mode
RUN mkdir -p /opt/bitcoind/v30.3-roots.1
COPY --from=bitcoind_30_3_roots_1 /bin/bitcoind         /opt/bitcoind/v30.3-roots.1/bitcoind
COPY --from=bitcoind_30_3_roots_1 /bin/bitcoin-cli      /opt/bitcoind/v30.3-roots.1/bitcoin-cli
COPY --from=bitcoind_30_3_roots_1 /bin/bitcoin          /opt/bitcoind/v30.3-roots.1/bitcoin
COPY --from=bitcoind_30_3_roots_1 /usr/bin/bitcoin-node /opt/bitcoind/v30.3-roots.1/bitcoin-node

# Give 1000:1000 write permissions to /opt/bitcoind itself so we can flip
# the current-version symlink while the container runs as 1000:1000.
RUN chown 1000:1000 /opt/bitcoind

# Symbolic links for default Bitcoin Roots binaries
# By default we point to the latest version of Bitcoin Roots
RUN ln -sfn /opt/bitcoind/v30.3-roots.1 /opt/bitcoind/current
RUN ln -sfn /opt/bitcoind/current/bitcoind     /usr/local/bin/bitcoind
RUN ln -sfn /opt/bitcoind/current/bitcoin-cli  /usr/local/bin/bitcoin-cli
RUN ln -sfn /opt/bitcoind/current/bitcoin      /usr/local/bin/bitcoin
RUN ln -sfn /opt/bitcoind/current/bitcoin-node /usr/local/bin/bitcoin-node

# Fail the build immediately if a bundled binary cannot load its shared libraries.
RUN bitcoind --version && bitcoin-cli --version && bitcoin -m node --version

# Symlink for datadir so bitcoin-cli auto-finds the RPC cookie
# Allows exec'ing bitcoin-cli inside the container without specifying credentials
RUN ln -sfn /data/bitcoin /root/.bitcoin
RUN mkdir -p /home/node \
 && ln -sfn /data/bitcoin /home/node/.bitcoin \
 && chown -h 1000:1000 /home/node/.bitcoin

CMD ["npm","run","dev"]

#################################################
# app-builder stage
#################################################
FROM deps AS app-builder
WORKDIR /repo
COPY . .

# build shared libraries (libs/*/dist)
# build backend (ts → js) (apps/backend/dist)
# compact GeoIP tables (~98 MB -> ~30 MB) for on-disk binary search
# bundle UI (vite build) + pre-compress (.br / .gz) static assets (apps/ui/dist)
RUN tsc -b libs/shared-types libs/settings apps/backend \
 && node scripts/compact-geoip.mjs apps/backend/dist/geoip \
 && npm run --workspace apps/ui build \
 && node scripts/precompress-ui.mjs apps/ui/dist

########################################
# runtime stage — final production image
########################################
FROM node:24.19.0-trixie-slim@sha256:ab3eebe934147fee049b5eb83c570f68c849a13c930bdfa482de99fcdfa3b3de AS runtime
ARG TARGETARCH
WORKDIR /app

# Install production dependencies only, then prune unused toolchains, GeoIP raw tables
# (replaced by compacted dist/geoip/*.bin), and non-target ZeroMQ prebuilds.
# Note: import-map lives in package.json, so is also needed so Node can resolve "#settings/#types"
COPY package*.json ./
COPY apps/backend/package*.json apps/backend/
RUN set -eux; \
    npm ci --omit=dev --install-strategy=hoisted --ignore-scripts; \
    case "${TARGETARCH}" in \
      amd64) zmq_arch='x64' ;; \
      arm64) zmq_arch='arm64' ;; \
      *) echo "Unsupported TARGETARCH: ${TARGETARCH}" >&2; exit 1 ;; \
    esac; \
    rm -rf /root/.npm /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack \
      /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack /usr/local/bin/yarn /usr/local/bin/yarnpkg /opt/yarn* \
      /usr/share/doc /usr/share/man \
      /app/node_modules/geoip-lite \
      /app/node_modules/zeromq/build/darwin /app/node_modules/zeromq/build/win32 \
      /app/node_modules/zeromq/src; \
    find /app/node_modules/zeromq/build/linux -mindepth 1 -maxdepth 1 ! -name "${zmq_arch}" -exec rm -rf {} +; \
    find "/app/node_modules/zeromq/build/linux/${zmq_arch}/node" -mindepth 1 -maxdepth 1 ! -name 'glibc-127-Release' -exec rm -rf {} +; \
    find /app/node_modules -type f \( -name '*.md' -o -name '*.map' -o -name '*.d.ts' \) -delete; \
    node -e "import('zeromq').then(() => console.log('zeromq prebuild ok'))"

# Backend JS bundle (includes compacted dist/geoip/*.bin)
COPY --from=app-builder /repo/apps/backend/dist ./dist

# Pre-bundled & pre-compressed React UI → backend serves this from /public/*
COPY --from=app-builder /repo/apps/ui/dist ./dist/public

# Compiled shared libs (referenced at runtime via import-map)
COPY --from=app-builder /repo/libs/settings/dist ./libs/settings/dist
COPY --from=app-builder /repo/libs/shared-types/dist ./libs/shared-types/dist

# Bitcoin Roots binaries:
# - bitcoind: normal monolithic daemon
# - bitcoin-cli: RPC client used by the backend and manual container execs
# - bitcoin + bitcoin-node: multiprocess IPC mode
COPY --from=bitcoind_30_3_roots_1 /bin/bitcoind         /opt/bitcoind/v30.3-roots.1/bitcoind
COPY --from=bitcoind_30_3_roots_1 /bin/bitcoin-cli      /opt/bitcoind/v30.3-roots.1/bitcoin-cli
COPY --from=bitcoind_30_3_roots_1 /bin/bitcoin          /opt/bitcoind/v30.3-roots.1/bitcoin
COPY --from=bitcoind_30_3_roots_1 /usr/bin/bitcoin-node /opt/bitcoind/v30.3-roots.1/bitcoin-node

# Flip-ready symlink layout + binary sanity check + datadir symlinks in a single layer
RUN chown 1000:1000 /opt/bitcoind \
 && ln -sfn /opt/bitcoind/v30.3-roots.1 /opt/bitcoind/current \
 && ln -sfn /opt/bitcoind/current/bitcoind     /usr/local/bin/bitcoind \
 && ln -sfn /opt/bitcoind/current/bitcoin-cli  /usr/local/bin/bitcoin-cli \
 && ln -sfn /opt/bitcoind/current/bitcoin      /usr/local/bin/bitcoin \
 && ln -sfn /opt/bitcoind/current/bitcoin-node /usr/local/bin/bitcoin-node \
 && bitcoind --version && bitcoin-cli --version && bitcoin -m node --version \
 && ln -sfn /data/bitcoin /root/.bitcoin \
 && mkdir -p /home/node \
 && ln -sfn /data/bitcoin /home/node/.bitcoin \
 && chown -h 1000:1000 /home/node/.bitcoin

ENV NODE_ENV=production
ENV NODE_OPTIONS="--max-old-space-size=192"

# Data dirs inside /data
ENV BITCOIN_DIR=/data/bitcoin
ENV APP_STATE_DIR=/data/app

# 3000 = HTTP API, 8332 = RPC, 8333 = P2P
EXPOSE 3000 8332 8333
# app and bitcoind data
VOLUME /data

USER node

CMD ["node", "dist/server.js"]
