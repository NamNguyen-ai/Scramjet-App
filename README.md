<p align="center"><img src="https://raw.githubusercontent.com/MercuryWorkshop/scramjet/main/assets/scramjet.png" height="200"></p>

<h1 align="center">Scramjet Demo</h1>

The demo implementation of <a href="https://github.com/MercuryWorkshop/scramjet">Scramjet</a>, an interception-based web proxy by Mercury Workshop, with an optional WireGuard SOCKS5 sidecar pool for per-connection egress IP rotation.

## Quick start

```sh
./start.sh            # interactive menu
./start.sh rotate     # non-interactive: jp | us | nl | rotate | none
```

That brings up the docker-compose stack and serves Scramjet at <http://localhost:8080>.

If you just want the bare server (no docker, no rotation):

```sh
pnpm install
pnpm start            # listens on $PORT (default 8080)
```

## Ports

The stack only publishes **one port to the host**:

| Port    | Where           | Purpose                                                          |
| ------- | --------------- | ---------------------------------------------------------------- |
| `8080`  | host + container | Scramjet HTTP server (browser hits this)                         |
| `25344` | container only   | wireproxy SOCKS5 listener, reached over the internal docker net  |

The three wireproxy sidecars each listen on `25344` *inside* their own container — addressed as `wireproxy1:25344`, `wireproxy2:25344`, `wireproxy3:25344` from the Scramjet container. They are **not** published to the host, so it doesn't matter that they share a port number.

Override the Scramjet port with `PORT=...` (in `.env` or the environment).

## Sibling stacks

YouTube is not proxyable through Scramjet (Google's anti-bot stack defeats interception). For YouTube, run [Piped](https://github.com/TeamPiped/Piped) separately:

```sh
cd /workspaces/youtube-stack && ./scripts/up.sh
```

## Egress IP rotation

When `WIREPROXY_SOCKS` is set (a comma-separated `host:port` list), Scramjet routes outbound TCP through the pool, round-robin per connection. `./start.sh` writes that variable into `.env` for you based on the menu choice.

To add or change peers:

1. Drop a new `peerN.conf` into [`wg-configs/`](./wg-configs/README.md) (use `example.conf` as a template).
2. Add a matching `wireproxyN` service in [`docker-compose.yml`](./docker-compose.yml) (it's a one-line YAML anchor reuse).
3. Add `wireproxyN:25344` to the `WIREPROXY_SOCKS` value in `.env` (or extend `start.sh`'s menu).

If `WIREPROXY_SOCKS` is empty/unset, rotation is disabled and Scramjet egresses from the host IP. Implementation lives in `src/socksPool.js` and `src/socksTcpSocket.js`.

## Repo layout

```
src/                Fastify server, wisp routing, SOCKS pool, rotating TCPSocket
public/             Landing page, service worker, scramjet client glue
wireproxy/          Vendored wireproxy Go source, built into the sidecar image
wg-configs/         User-supplied WireGuard peer configs (gitignored except example.conf)
docker-compose.yml  Scramjet + 3x wireproxy sidecar stack
Dockerfile          Scramjet image (node:18-alpine + pnpm)
start.sh            Launcher with egress menu
.env.example        Template for the .env that start.sh writes
```

## Scripts

| Command            | What it does                                  |
| ------------------ | --------------------------------------------- |
| `./start.sh`       | Interactive: pick egress, rebuild, run stack  |
| `pnpm start`       | Run the bare Node server (no docker)          |
| `pnpm lint`        | ESLint on `./src/`                            |
| `pnpm lint:fix`    | ESLint with `--fix`                           |
| `pnpm format`      | Prettier write across the repo                |

## Supported sites

Scramjet handles most of the major web — Google, Twitter/X, Instagram, Spotify, Discord, Reddit, GeForce NOW — with CAPTCHA support. Heavy traffic from a single IP will trip anti-bot defenses; rotate egress IPs (see above) when that becomes a problem. YouTube specifically is **not** supported through Scramjet; use Piped.

## Transports

The client uses [libcurl-transport](https://github.com/MercuryWorkshop/libcurl-transport) for encrypted proxied fetches. [epoxy-transport](https://github.com/MercuryWorkshop/epoxy-transport) is a drop-in alternative.

The server runs [wisp-js](https://www.npmjs.com/package/@mercuryworkshop/wisp-js) for the WebSocket transport. For production-grade throughput, [wisp-server-python](https://github.com/MercuryWorkshop/wisp-server-python) is recommended upstream. See [bare-mux](https://github.com/MercuryWorkshop/bare-mux) for the multiplexer.

## Links

- Scramjet upstream: <https://github.com/MercuryWorkshop/scramjet>
- browser.js (where Scramjet now receives non-censorship updates): <https://github.com/HeyPuter/browser.js>
- Self-hosting guides: [nvm](https://github.com/nvm-sh/nvm), [nginx](https://docs.titaniumnetwork.org/guides/nginx/), [VPS](https://docs.titaniumnetwork.org/guides/vps-hosting/), [DNS](https://docs.titaniumnetwork.org/guides/dns-setup/)
