> **Bitcoin Roots.** This repository builds the Umbrel Bitcoin Node app powered by [Bitcoin Roots](https://plan-b.foundation/bitcoin-roots) ([LuganoPlanB/bitcoin-roots](https://github.com/LuganoPlanB/bitcoin-roots)). It tracks [`getumbrel/umbrel-bitcoin`](https://github.com/getumbrel/umbrel-bitcoin), bundles verified Roots release binaries, and includes an Umbrel package with persistent Tor services. The release workflow publishes images to `ghcr.io/<repository-owner>/umbrel-bitcoin-roots`.

<p align="center">
  <a href="https://apps.umbrel.com/app/bitcoin">
    <img src="https://github.com/user-attachments/assets/b9ff1e96-f899-41e3-8295-3247b88f6f79" alt="Logo">
  </a>
  <h1 align="center">Bitcoin Node</h1>
  <p align="center">
    Run a Bitcoin node on your umbrelOS personal server. An app by the Plan-B Foundation. Powered by Bitcoin Roots.
    <br />
    <a href="https://umbrel.com"><strong>umbrel.com »</strong></a>
    <br />
    <br />
    <a href="https://twitter.com/umbrel">
      <img src="https://img.shields.io/twitter/follow/umbrel?style=social" />
    </a>
    <a href="https://t.me/getumbrel">
      <img src="https://img.shields.io/badge/community-chat-%235351FB">
    </a>
    <a href="https://reddit.com/r/getumbrel">
      <img src="https://img.shields.io/reddit/subreddit-subscribers/getumbrel?style=social">
    </a>
    <a href="https://community.getumbrel.com">
      <img src="https://img.shields.io/badge/community-forum-%235351FB">
    </a>
  </p>
</p>

## Getting started

The package draft is in [`umbrel/bitcoin-roots`](umbrel/bitcoin-roots). It is not yet verified on umbrelOS or submitted to the official store by this change.

### Build and test

Use Node 24 (see `.nvmrc`) and Docker with Compose v2:

```sh
npm ci --workspaces --include-workspace-root
npm test
npm run typecheck:backend
docker build -f apps/backend/Dockerfile -t umbrel-bitcoin-roots:prod .
npm run test:integration
```

`npm test` builds the backend and UI, stages the backend with the same import-map layout as the production image, and runs Node regression tests. The integration test runs the actual Umbrel compose package with isolated temporary data on regtest. It checks RPC startup, Tor SOCKS and authenticated control connections, proxy settings, onion discovery, and persistence across Tor restarts. It requires a working Docker daemon and free use of Docker subnet `10.21.0.0/16`; run it on an isolated machine, not a live Umbrel. It does not require public Tor bootstrap or download a blockchain, and does not prove public onion reachability.

The inherited `npm run typecheck` currently fails on existing UI alias/type errors. CI checks backend/shared-library types and builds the UI with Vite; full UI typechecking remains separate work.

For development, create `data` writable by UID 1000, then run `docker compose up --build`. To try the production image locally, run `docker compose -f docker-compose.prod.yml up`; its UI is at `http://127.0.0.1:3000`. Both local stacks use regtest and development credentials. The Umbrel package uses mainnet and per-install derived credentials.

### Tor

Tor runs as a separate, unprivileged service. Roots receives its SOCKS endpoint via `TOR_HOST`/`TOR_SOCKS_PORT`, and its authenticated control endpoint via `TOR_CONTROL_PORT`/`TOR_CONTROL_PASSWORD`. Neither Tor port is published to the host. The app waits for the local control listener before starting; Tor network bootstrap can take longer.

Tor state and P2P/RPC hidden-service keys persist under `data/tor`. The connection panel reads hostname files on each request, so it discovers first-boot addresses without restarting the app. Existing deployments using `P2P_HIDDEN_SERVICE` and `RPC_HIDDEN_SERVICE` still work.

Outgoing onion peers are enabled by default alongside clearnet and I2P. To route clearnet peers through Tor as well, enable **Make All Outgoing Connections to Clearnet Peers Over Tor** in Settings. Incoming Tor in Settings enables Roots' automatic onion advertisement through Tor control. The package also supplies persistent P2P and authenticated RPC onion endpoints for direct connections. Protect/back up `data/tor` along with the application data to retain those identities.

### GitHub CI and distribution

- Pull requests and branch pushes run regression tests and native AMD64/ARM64 image builds with container smoke tests, without publishing.
- Pushing a `v*` tag or manually dispatching **Publish tested images** runs the same checks before publishing architecture tags and a combined GHCR manifest. Only the manifest job writes the combined tag, avoiding a race between architecture builds. Its job summary contains the image digest.
- Before store submission, make the GHCR package public and replace the draft app image in `umbrel/bitcoin-roots/docker-compose.yml` with the release tag **and multi-architecture manifest digest**. No digest is invented in the draft.
- Copy the `bitcoin-roots` directory into a fork of [Umbrel's app repository](https://github.com/getumbrel/umbrel-apps), follow its current packaging/testing instructions, and test install, restart, update, storage movement, UI access and public Tor reachability on umbrelOS. Verify the proposed UI port `2111`, P2P/RPC ports `10333`/`10332`, and static addresses `10.21.120.8–10` against the store before submission. Add the real submitter and submission URL to the manifest when available.

The package declares `implements: bitcoin` and exports the canonical `APP_BITCOIN_*` variables so dependent apps (Core Lightning, LND, Electrs, Bassin, etc.) can connect to Bitcoin Roots as their Bitcoin node provider. It publishes non-colliding host ports (`10333` P2P, `10332` RPC, `2111` UI) so it can be installed side-by-side with Bitcoin Core (`8333`/`8332`/`2100`) or Bitcoin Knots (`9333`/`9332`/`2105`) to migrate existing chain data (`blocks/`, `chainstate/`, `indexes/`) before uninstalling the previous node.

---

[![License](https://img.shields.io/github/license/getumbrel/umbrel-bitcoin?color=%235351FB)](https://github.com/getumbrel/umbrel-bitcoin/blob/master/LICENSE.md)

[umbrel.com](https://umbrel.com)
