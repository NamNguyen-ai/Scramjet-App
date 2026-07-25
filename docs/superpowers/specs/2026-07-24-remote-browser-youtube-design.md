# Design Spec: Real youtube.com via Remote Browser (Neko)

- **Date:** 2026-07-24
- **Status:** Design approved (section-by-section). Awaiting full-spec review before implementation.
- **Author:** Scramjet-App maintainer + Claude
- **Supersedes:** the Piped-based YouTube approach (forbidden) and the interception-fix approach (proven impossible)

---

## 1. Problem & Goal

**Goal:** Play the *real* youtube.com — the actual site, real video, real audio — on a locked-down
device that blocks youtube.com and blocks sockets/UDP (cannot run Tailscale/WireGuard). Only HTTPS
egress works from the device.

**Hard constraints (standing):**
- **No Piped** and no Piped-adjacent custom frontends. The real site only.
- **No paid services / SaaS, ever.** Free + self-hostable only. (Cloudflare Calls free-tier TURN is
  acceptable — it is free, not a paid SaaS subscription.)
- Fastest possible streaming, **lowest latency possible** — optimize aggressively, accept quality tradeoffs
  for latency (explicit user directive). See §6 Layer 4 for the tuning yardstick.

**Why interception is off the table (settled by prior deep research — 101 agents, 21 confirmed / 4
refuted):** YouTube's BotGuard is an obfuscated register-based JS VM performing runtime-integrity
attestation. It mints a Proof-of-Origin Token (poToken). Rewriting/instrumenting its JS (which every
interception proxy — Scramjet, UV, service-worker rewriters — does) trips chronometric anti-debug
(`performance.now()` vs `Date.now()` deltas) and corrupts the decryption seed, so the poToken it mints
is invalid. Since Aug 2024, no valid poToken → HTTP 403 on streams; 2026 is rolling out poToken
enforcement for playback (StreamProtectionStatus 3). A residential IP does **not** help — attestation is
client-side, not IP-derived. Token-porting bypass was specifically refuted.

**Conclusion:** the only path that plays real youtube.com is a **real browser** whose JS is untouched.
We stream that browser's pixels + audio to the device. This is the Neko remote-browser architecture.

---

## 2. Architecture & Topology

Three independent planes, each on a different network path. The path separation is the core of the
design — it is what makes this work from a no-inbound Codespace and a UDP-blocked device.

```
┌─────────────┐   1. SIGNALING (WSS, control)
│   Locked    │──────────────────────────────► *.app.github.dev  (GitHub HTTP/WS tunnel)
│   device    │                                        │
│  (browser)  │   2. MEDIA (WebRTC / DTLS-SRTP over TCP/443)     ▼
│             │◄───────────────► Cloudflare TURN ◄──── Neko container (Codespace)
└─────────────┘                   (free tier)          │  headful Chromium + GStreamer
                                                        │
                                        3. YT EGRESS    ▼
                                   Neko Chromium ──► Pi Zero (WG residential exit) ──► youtube.com
```

- **Plane 1 — Signaling (WSS):** WebSocket over the GitHub forwarded URL. The *only* traffic that
  traverses the GH tunnel. WS traverses it fine.
- **Plane 2 — Media (WebRTC):** Both device and Neko dial **outbound** to Cloudflare TURN on 443/TCP.
  Neither needs an inbound port — the reason this works from a Codespace (no inbound) and a UDP-blocked
  device (443-TCP relay).
- **Plane 3 — YT egress:** Chromium's SOCKS proxy points at the Pi's residential exit, so YouTube sees a
  residential IP (fewer bot-check prompts). Attestation is already satisfied — it is a real browser.

**Why this beats interception:** nothing rewrites YouTube's JS. BotGuard runs in pristine real Chromium
and mints a valid poToken. The device only ever receives pixels + audio and sends input.

---

## 3. Components

Six components. Four exist already; two are new.

### New

**A. Neko container** (`m1k1o/neko`, headful Chromium image)
- Runs in the Codespace as a new service in the existing `docker-compose.yml` stack.
- Responsibilities: render real youtube.com, capture screen+audio, encode to WebRTC, accept input,
  expose a signaling WS.
- Config surface (env): resolution/FPS, video codec (VP9 vs VP8/H264 tradeoff), max bitrate, **custom
  ICE servers** (→ Cloudflare TURN), Chromium launch flags (incl. `--proxy-server` → Pi exit),
  screensaver/screen-lock disabled.
- **VERIFY-AT-BUILD:** exact ICE-server env var name + JSON shape changed between Neko v2 and v3. Confirm
  against the pinned image's docs; do not guess.

**B. Cloudflare TURN credential broker** (small route / startup step)
- Cloudflare Calls issues **short-lived** TURN credentials (valid ~hours), not static ones. Something must
  fetch them and feed both peers.
- Home: a small Fastify route in the existing `src/index.js` — `GET /turn-creds` — that calls Cloudflare's
  API with the app's Turn Token ID/secret (from `.env`) and returns an ICE-server array. Device fetches it;
  Neko gets it via its own config path.
- **VERIFY-AT-BUILD:** Cloudflare's exact API path/response shape for TURN credential generation.

### Existing — reused as-is
**C. Fastify server (`src/index.js`)** — gains the `/turn-creds` route and serves the Neko client view.
COOP/COEP factory, `/wisp/` proxy, static mounts unchanged.

**D. Pi Zero WG residential exit** — reused from the wireproxy egress layer. Chromium `--proxy-server`
points at a SOCKS endpoint routing out through the Pi. Gated by Probe 3 (bandwidth).

### Existing — modified
**E. Client UI (`public/index.js` + `search.js` + `index.html`)** — `search()` already parses the omnibox.
Add: detect `youtube.com` host → swap the Scramjet iframe for the Neko view (pointed at the signaling WS)
instead of `controller.createFrame()`. Everything non-YouTube stays on the Scramjet path. Toolbar stays;
Back/Home returns to the Scramjet iframe.

**F. `docker-compose.yml` + `start.sh`** — add the `neko` service (on `scramjet-egress` net so it can reach
the Pi SOCKS exit). `start.sh` gains env plumbing for `NEKO_*`, `CF_TURN_TOKEN_ID` / `CF_TURN_API_TOKEN`,
and `PUBLIC_URL` (the GH forwarded base), following the existing `WIREPROXY_SOCKS`→`.env` pattern.

### Security note (conscious accept, not oversight)
Component B puts the Cloudflare Turn secret in `.env`, and `/turn-creds` is unauthenticated unless gated.
Combined with the "no Neko auth / URL obscurity" decision, anyone who finds the Codespace URL can mint TURN
creds and reach the logged-in browser. **Compensating control (REQUIRED): set the GitHub forwarded port
visibility to "Private"** (GitHub-auth-gated) in the Ports panel.

---

## 4. Data & Control Flow

### Phase 1 — Session bring-up
```
1. User types "youtube.com" in omnibox
2. search.js detects YT host → openNekoView() instead of createFrame()
3. Browser GET /turn-creds → Fastify calls Cloudflare API → returns ICE array (short-lived TURN user/cred)
4. Browser opens signaling WS → *.app.github.dev tunnel → Neko in Codespace
5. Neko + browser exchange SDP offer/answer + ICE candidates over that WS
   (both sides' candidates are Cloudflare TURN-relay candidates, 443/TCP)
6. DTLS-SRTP handshake through Cloudflare TURN → media channel established
```
Independently, at container start (before any user):
```
0a. Neko boots headful Chromium with --proxy-server=<Pi SOCKS exit>
0b. Neko gets its ICE config (Cloudflare TURN creds) via its own env/config
```

### Phase 2 — Steady state
```
MEDIA (down):  Neko GStreamer encodes screen+audio ─VP9/Opus─► Cloudflare TURN ─► browser <video>
INPUT (up):    browser mouse/keyboard/scroll ─► signaling WS ─► Neko ─► Chromium
YT TRAFFIC:    Chromium ⇄ Pi Zero residential exit ⇄ youtube.com (HTTPS, real poToken)
```
Three independent streams, three paths. The device never touches YouTube directly.

### Control input & UI rules
- Neko handles input capture/injection (mouse, keyboard, scroll, clipboard) over its data channel/WS —
  reused, not built.
- Toolbar mapping:
  - **Back / Home** → tear down Neko view, restore Scramjet iframe.
  - **Reload** → send Chromium a page reload **via Neko input**, NOT a browser reload of the app page
    (which would kill the WebRTC session). Explicit UI rule.
- Single-viewer assumption. Neko supports multi-user/host-control; we don't need it and won't disable it in
  a way that breaks single-use.

### Credential lifecycle
Cloudflare TURN creds are short-lived → the browser MUST be able to re-fetch `/turn-creds` on ICE restart,
so long sessions outlive a single credential. Required behavior, not fire-and-forget.

---

## 5. Error Handling & De-Risking Probes

### Gating probes — run BEFORE full build (a failure changes the architecture)
Run cheaply, in order:

**Probe 1 — Device can open TCP/443 to arbitrary hosts (Cloudflare TURN).**
- Risk: device may allow 443 only to an allowlist, not arbitrary IPs.
- Test: from the device browser, load a tiny WebRTC test page forcing `iceTransportPolicy: "relay"` against
  Cloudflare TURN creds; log whether a relay candidate connects.
- If it fails: media plane is dead on that device → design not viable on that device (or reconsider Probe 2).

**Probe 2 — Confirm the GH tunnel truly can't carry WebRTC media.**
- Risk: we assume `*.app.github.dev` is HTTP/WS-only. High confidence, unverified.
- Test: attempt WebRTC using only the GH-forwarded origin (no external TURN); observe ICE failure.
- If it surprisingly works: Cloudflare TURN becomes optional → simpler, no third-party relay.

**Probe 3 — Pi Zero can handle video-egress bandwidth.**
- Risk: Pi Zero is weak; 1080p egress through its WG/SOCKS exit may saturate CPU/uplink.
- Test: route one Chromium session's YouTube traffic through the Pi exit; watch Pi CPU + throughput at 1080p.
- If it fails: cap egress resolution, or move egress off the Pi (accept datacenter IP + occasional bot-check),
  or use a different exit.

### Runtime error handling (steady state)

| Failure | Detection | Response |
|---|---|---|
| TURN creds expired mid-session | ICE state → `disconnected`/`failed` | Re-fetch `/turn-creds`, trigger ICE restart (§4 credential lifecycle) |
| Neko container down / not ready | Signaling WS fails to open | UI "remote browser starting…" + retry with backoff; never silently hang |
| Pi exit down | Chromium can't load youtube.com (proxy error) | Surface Chromium's error page; UI "retry"; optional fallback to direct egress with a warning |
| Cloudflare TURN unreachable | No relay candidate within ICE timeout | Explicit "media relay unreachable" error, not a blank screen |
| Google bot-check / login wall | Visible in streamed pixels (nothing to intercept) | User handles it directly via input injection — expected, fine |
| Multiple viewers, same URL | Neko session already active | Single-user assumption: share view (Neko default) or reject 2nd — implementation picks one |

**Design principle:** every failure resolves to a **visible message or a retry**, never a blank iframe.
Detection is at the **transport** layer (ICE/WS/proxy state), never the content layer — we can't inspect
YouTube's DOM (pixels only).

---

## 6. Testing Strategy

Layered so a failure localizes fast. This is inherently **manual/interactive** testing — real browser, real
Google servers, real device network policy. There is no meaningful unit-test harness for "does YouTube play."
Recorded as a **manual checklist**, not CI.

### Layer 0 — Gating probes (§5)
Pass/fail gates, run first. Documented as re-runnable steps for when the field environment changes.

### Layer 1 — Component smoke tests (isolation)
- **Neko up:** container starts, Chromium renders, Neko web UI reachable locally in the Codespace (pre-tunnel);
  loads example.com (not YouTube yet).
- **`/turn-creds`:** `curl` → well-formed ICE array with non-empty short-lived creds; a 2nd call returns fresh
  creds (lifecycle works).
- **Pi exit:** `curl --proxy <pi-socks>` from the Codespace → returns the Pi's residential IP.

### Layer 2 — Pairwise integration
- **Neko + Pi:** launch Neko with `--proxy-server=<pi>`, load whatismyip inside → residential IP in pixels.
- **Device + TURN + Neko (media):** device plays a non-YouTube HTML5 test video end-to-end. Baseline latency + FPS.
- **Signaling over GH tunnel:** device reaches Neko WS via `*.app.github.dev`; SDP/ICE exchange completes.

### Layer 3 — End-to-end acceptance (success criterion)
On the locked-down device: type `youtube.com` → Neko view opens → **a real video plays with audio, A/V in
sync**, and YouTube shows **no persistent poToken/403 error** (real-browser attestation works).
Sub-checks:
- Smart-redirect: `youtube.com` → Neko; `example.com` → Scramjet iframe (no proxy regression).
- Toolbar: Reload reloads *Chromium* not the session; Back/Home restores the Scramjet iframe.
- Long-session: play >1h → TURN cred re-fetch / ICE-restart fires without dropping the stream.

### Layer 4 — Manual quality / UX pass (human-judged)
Latency feel on seek/pause, sharpness at chosen bitrate, input responsiveness, audio drift over time. This is
the "fastest streaming + minimal latency" acceptance — judged by the user, tuned via Neko codec/bitrate/FPS env.

**Latency target: lowest possible** (user directive — optimize aggressively, no fixed ceiling). Concretely,
tune toward glass-to-glass < ~150ms where the network allows, and prefer settings that reduce latency even at
some quality cost:
- Prefer hardware/low-latency encode paths; VP8 or H264 baseline may beat VP9 on encode latency — measure both.
- Favor lower buffering / lower GOP over max sharpness when they trade against latency.
- Keep the media path on the shortest viable relay hop (Cloudflare TURN edge nearest both peers).
- Egress hop (Pi) adds latency to *video load*, not to the *stream* — keep that distinction when tuning.
Record the measured glass-to-glass latency from Layer 2 baseline and again at Layer 3 as the tuning yardstick.

### Explicitly NOT tested
- YouTube internal behavior / DOM — intentionally opaque (pixels only).
- BotGuard/poToken mechanics — untouched; real browser handles it. If Layer 3 plays video, attestation passed.

---

## 7. Open Verify-At-Build Items (do not guess — confirm against current docs)
1. Neko ICE-server env var name + JSON shape (v2 vs v3 differ).
2. Cloudflare Calls TURN credential API path + response shape.
3. Neko image tag to pin (headful Chromium variant).

## 8. Locked Decisions (context for implementers)
- Architecture: adopt/integrate Neko (m1k1o/neko), don't build from scratch.
- Deploy target: GitHub Codespace (primary).
- Stream stack: WebRTC over TURN/443.
- Media relay: Cloudflare TURN (Cloudflare Calls free tier).
- YT egress: Neko Chromium → Pi Zero residential exit → youtube.com.
- UI: smart redirect from the existing omnibox/search.js.
- Auth: no Neko auth; compensating control = GitHub forwarded port set to **Private**.
- All work lands directly on `main` (single-branch repo).

## 9. Out of Scope
- Automating "YouTube plays" in CI (not possible; manual checklist instead).
- Non-YouTube sites (stay on the existing Scramjet interception path).
- Multi-user / collaborative viewing.
- poToken/BotGuard reverse-engineering (deliberately avoided by using a real browser).
