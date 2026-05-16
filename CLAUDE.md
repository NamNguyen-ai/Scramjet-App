# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Scramjet-App is a demo implementation of [Scramjet](https://github.com/MercuryWorkshop/scramjet), an interception-based web proxy by Mercury Workshop. It proxies web traffic through service workers and WASM, supporting multiple transports (BareMux, libcurl, Wisp/WebSocket).

## Commands

- **Full stack (docker, with egress menu):** `./start.sh` (interactive) or `./start.sh {jp|us|nl|rotate|none}`
- **Bare server (no docker):** `pnpm start` (or `node src/index.js`)
- **Lint:** `pnpm lint` (ESLint on `./src/`)
- **Lint fix:** `pnpm lint:fix`
- **Format:** `pnpm format` (Prettier)
- **Install dependencies:** `pnpm install`

Port defaults to 8080, configurable via `PORT` env var. Only 8080 is published from the docker stack; the wireproxy sidecars' SOCKS5 port (25344) stays on the internal `scramjet-egress` docker network.

## Architecture

**Server (`src/index.js`):** Fastify server with a custom HTTP server factory that sets COOP/COEP headers. Serves static files and runs a Wisp WebSocket proxy server on `/wisp/`. Static routes mount proxy libraries at `/scram/`, `/libcurl/`, and `/baremux/`.

**Client (`public/`):** Landing page where user enters a URL or search query. On submit:
1. `search.js` parses input (URL detection vs search engine fallback)
2. `index.js` registers the service worker and initializes `ScramjetController` with WASM module paths
3. `BareMux` connection is configured with libcurl WebSocket transport pointing to the Wisp server
4. An iframe is created via `controller.createFrame()` to load the proxied target URL

**Service Worker (`public/sw.js`):** Intercepts fetch events and routes them through Scramjet's proxy logic or falls back to native fetch.

**Request flow:** User input → Service Worker intercept → Scramjet WASM encoding → Transport layer (libcurl/BareMux/Wisp) → Fastify server → Wisp forwards to target → Response rendered in iframe.

## Code Style

- Tabs for indentation
- Double quotes for strings
- Semicolons required
- Trailing commas (ES5 style)

## Key Dependencies

- `@mercuryworkshop/scramjet` — core proxy library (loaded from GitHub releases, built via pnpm postinstall)
- `@mercuryworkshop/bare-mux` — transport multiplexer
- `@mercuryworkshop/libcurl-transport` — encrypted HTTP transport
- `@mercuryworkshop/wisp-js` — WebSocket proxy server
- `fastify` + `@fastify/static` — HTTP server and static file serving

## Docker

Alpine-based Node 18 image. Requires python3/make/g++ at build time for native modules. Exposes port 8080.

## Egress IP Rotation

Optional wireproxy-based rotation layer. When `WIREPROXY_SOCKS` (comma-separated `host:port` list) is set, `src/index.js` injects a custom `TCPSocket` class into `wisp.routeRequest`. Each outbound connection dials through the next SOCKS5 endpoint in the pool (round-robin), so egress IPs rotate per connection.

- `src/socksPool.js` — parses env, round-robin picker
- `src/socksTcpSocket.js` — `RotatingSocksTCPSocket` implementing wisp-js's TCPSocket interface via the `socks` npm package
- `docker-compose.yml` — runs N wireproxy sidecars, each with a WG peer config from `wg-configs/` (services share a `x-wireproxy-base` YAML anchor; each only overrides the volume mount and container name)
- `wg-configs/` — user-supplied `.conf` files, one per peer (gitignored except `example.conf`)
- `start.sh` — launcher that writes `WIREPROXY_SOCKS` into `.env` based on menu choice or CLI arg, then `docker compose up --build`
