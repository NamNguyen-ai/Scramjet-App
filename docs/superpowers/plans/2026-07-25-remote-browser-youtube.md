# Real youtube.com via Neko Remote Browser — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Play the real youtube.com (site + video + audio) on a locked-down device by streaming a real Chromium's pixels/audio over WebRTC, instead of intercepting YouTube's JS.

**Architecture:** A Neko (`m1k1o/neko`) headful-Chromium container runs in the GitHub Codespace. The device's browser reaches Neko's web client over the GitHub HTTP/WS tunnel for signaling; WebRTC media relays through Cloudflare TURN on 443/TCP (both peers dial outbound). Chromium's egress goes through the existing Pi Zero residential SOCKS exit. The existing Scramjet omnibox smart-redirects youtube.com to the Neko view; everything else stays on the Scramjet iframe.

**Tech Stack:** Node 18 + Fastify (existing server), Node built-in test runner (`node --test`), Docker Compose, Neko v3 (`ghcr.io/m1k1o/neko/chromium`), Cloudflare Calls TURN, WireGuard/wireproxy (existing).

## Global Constraints

- **No Piped / no alternative frontends.** Real youtube.com only.
- **No paid services/SaaS.** Free + self-hostable only. Cloudflare Calls free-tier TURN is permitted (free, not a subscription).
- **Latency: lowest possible.** Optimize aggressively; accept quality tradeoffs for latency.
- **Code style:** tabs for indentation, double quotes, semicolons required, ES5 trailing commas. (Matches existing `src/` and `public/`.)
- **No new production npm dependencies** unless unavoidable. Server-side TURN fetch uses Node 18 global `fetch`. Tests use built-in `node:test` / `node:assert` (no devDep needed).
- **Neko auth:** none in-app; compensating control is GitHub forwarded-port visibility = **Private**. This MUST be documented in `start.sh` output and README.
- **All work lands on `main`** (single-branch repo). Commit frequently.
- **Verified external facts (do not re-guess):**
  - Neko v3 ICE env vars: `NEKO_WEBRTC_ICESERVERS_FRONTEND` and `NEKO_WEBRTC_ICESERVERS_BACKEND`, each a JSON-encoded array of `{urls, username?, credential?}`. `NEKO_WEBRTC_ICELITE` **must be `0`** when using ICE servers.
  - Cloudflare TURN: `POST https://rtc.live.cloudflare.com/v1/turn/keys/$TURN_KEY_ID/credentials/generate-ice-servers`, header `Authorization: Bearer $TURN_KEY_API_TOKEN`, body `{"ttl": <seconds>}`, response `201` `{ "iceServers": [ {urls:[...]}, {urls:[...], username, credential} ] }`. It advertises `turns:turn.cloudflare.com:443?transport=tcp` (the 443/TCP relay the device needs). Port-53 URLs are browser-blocked and must be filtered out.
  - Neko Chromium image: `ghcr.io/m1k1o/neko/chromium:latest`. Chromium proxy flag passed via `NEKO_DESKTOP_CHROMIUM_FLAGS` / launch args; egress SOCKS = existing wireproxy service on the `scramjet-egress` network.

---

## File Structure

**New files:**
- `src/turnCreds.js` — pure module: mint + normalize Cloudflare TURN ICE servers. Server-side, testable.
- `test/turnCreds.test.js` — `node --test` unit tests for the above.
- `public/ytdetect.js` — pure browser+node helper: `isYouTubeUrl(str)`. Testable.
- `test/ytdetect.test.js` — `node --test` unit tests for the above.
- `scripts/mint-turn-creds.sh` — CLI that calls Cloudflare, filters port-53, emits the two JSON arrays for `.env`.

**Modified files:**
- `src/index.js` — register `GET /turn-creds` route (uses `src/turnCreds.js`).
- `public/index.html` — load `ytdetect.js`; add a `#sj-neko` iframe container.
- `public/index.js` — smart-redirect: youtube.com → Neko view; toolbar Back/Home restores Scramjet.
- `docker-compose.yml` — add `neko` service on the `scramjet-egress` network.
- `start.sh` — mint TURN creds, plumb `NEKO_*` + `CF_TURN_*` + `PUBLIC_URL` into `.env`, print the Private-port reminder.
- `package.json` — add `"test": "node --test"` script.
- `README.md` (or create a short `docs/youtube-neko.md`) — operator setup + the Private-port security requirement.

---

## Task 0: Gating de-risk probes (RUN FIRST — a failure changes the design)

These are pass/fail gates from the spec §5. No production code. If any fails, STOP and revisit the design with the user before continuing. Record results in `docs/superpowers/plans/probe-results.md`.

**Files:**
- Create: `docs/superpowers/plans/probe-results.md` (results log)

- [ ] **Step 1: Probe 1 — device can reach Cloudflare TURN on 443/TCP**

On the locked-down device's browser, open `https://icetest.info/` (or `https://webrtc.github.io/samples/src/content/peerconnection/trickle-ice/`), enter a Cloudflare TURN server URL `turns:turn.cloudflare.com:443?transport=tcp` with a freshly minted username/credential (mint via `scripts/mint-turn-creds.sh` after Task 5, or manually via the Cloudflare curl in Global Constraints), set `iceTransportPolicy` to `relay`, and gather candidates.
Expected PASS: a `relay` candidate appears and state reaches `completed`/`connected`.

- [ ] **Step 2: Probe 2 — confirm GH tunnel cannot carry WebRTC media**

From the device, attempt a WebRTC connection whose only ICE server is the GH-forwarded origin (no external TURN).
Expected: ICE fails (confirms external TURN is required). If it unexpectedly connects, note it — Cloudflare TURN may become optional.

- [ ] **Step 3: Probe 3 — Pi Zero egress bandwidth**

From inside the Codespace: `curl -x socks5h://<pi-socks-host>:<port> -o /dev/null -w "%{speed_download}\n" https://speed.cloudflare.com/__down?bytes=104857600` while watching Pi CPU (`ssh pi 'top -bn1 | head'`).
Expected PASS: sustained throughput ≥ ~6 Mbps (1080p headroom) and Pi CPU not pinned at 100%. If it fails: cap egress resolution or move egress off the Pi.

- [ ] **Step 4: Record results and commit**

```bash
git add docs/superpowers/plans/probe-results.md
git commit -m "docs: record Neko/YouTube de-risk probe results"
```

**GATE:** Do not proceed to Task 1 unless Probe 1 and Probe 3 PASS (Probe 2 is informational).

---

## Task 1: TURN credential module (`src/turnCreds.js`)

**Files:**
- Create: `src/turnCreds.js`
- Test: `test/turnCreds.test.js`
- Modify: `package.json` (add test script)

**Interfaces:**
- Consumes: Node 18 global `fetch` (injectable for tests).
- Produces:
  - `turnEnabled(env = process.env): boolean` — true iff `CF_TURN_TOKEN_ID` and `CF_TURN_API_TOKEN` are set.
  - `filterPort53(iceServers: Array): Array` — returns a deep-copied list with any `urls` entry containing `:53?` or ending `:53` removed; drops servers whose `urls` become empty.
  - `async fetchTurnCreds({ tokenId, apiToken, ttl = 86400, fetchImpl = fetch }): Promise<{ iceServers: Array }>` — POSTs to Cloudflare, throws `Error` on non-2xx, returns `{ iceServers }` with port-53 filtered.

- [ ] **Step 1: Add the test script to package.json**

In `package.json`, add to `"scripts"` (after the `"start"` line):

```json
		"test": "node --test",
```

- [ ] **Step 2: Write the failing tests**

Create `test/turnCreds.test.js`:

```js
"use strict";
import { test } from "node:test";
import assert from "node:assert/strict";
import { turnEnabled, filterPort53, fetchTurnCreds } from "../src/turnCreds.js";

const CF_SAMPLE = {
	iceServers: [
		{ urls: ["stun:stun.cloudflare.com:3478", "stun:stun.cloudflare.com:53"] },
		{
			urls: [
				"turn:turn.cloudflare.com:3478?transport=udp",
				"turn:turn.cloudflare.com:53?transport=udp",
				"turn:turn.cloudflare.com:3478?transport=tcp",
				"turn:turn.cloudflare.com:80?transport=tcp",
				"turns:turn.cloudflare.com:5349?transport=tcp",
				"turns:turn.cloudflare.com:443?transport=tcp",
			],
			username: "u",
			credential: "c",
		},
	],
};

test("turnEnabled true only when both env vars present", () => {
	assert.equal(turnEnabled({ CF_TURN_TOKEN_ID: "a", CF_TURN_API_TOKEN: "b" }), true);
	assert.equal(turnEnabled({ CF_TURN_TOKEN_ID: "a" }), false);
	assert.equal(turnEnabled({}), false);
});

test("filterPort53 removes only :53 urls and preserves 443", () => {
	const out = filterPort53(CF_SAMPLE.iceServers);
	const allUrls = out.flatMap((s) => s.urls);
	assert.ok(allUrls.every((u) => !u.includes(":53")));
	assert.ok(allUrls.includes("turns:turn.cloudflare.com:443?transport=tcp"));
	// original not mutated
	assert.ok(CF_SAMPLE.iceServers[0].urls.includes("stun:stun.cloudflare.com:53"));
});

test("fetchTurnCreds posts to the right endpoint and returns filtered iceServers", async () => {
	let seenUrl, seenInit;
	const fakeFetch = async (url, init) => {
		seenUrl = url;
		seenInit = init;
		return { ok: true, status: 201, json: async () => CF_SAMPLE };
	};
	const res = await fetchTurnCreds({
		tokenId: "KEYID",
		apiToken: "TOKEN",
		ttl: 3600,
		fetchImpl: fakeFetch,
	});
	assert.equal(
		seenUrl,
		"https://rtc.live.cloudflare.com/v1/turn/keys/KEYID/credentials/generate-ice-servers"
	);
	assert.equal(seenInit.method, "POST");
	assert.equal(seenInit.headers.Authorization, "Bearer TOKEN");
	assert.equal(JSON.parse(seenInit.body).ttl, 3600);
	assert.ok(res.iceServers.flatMap((s) => s.urls).every((u) => !u.includes(":53")));
});

test("fetchTurnCreds throws on non-ok response", async () => {
	const fakeFetch = async () => ({ ok: false, status: 403, json: async () => ({}) });
	await assert.rejects(
		() => fetchTurnCreds({ tokenId: "x", apiToken: "y", fetchImpl: fakeFetch }),
		/403/
	);
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `node --test test/turnCreds.test.js`
Expected: FAIL — `Cannot find module '../src/turnCreds.js'`.

- [ ] **Step 4: Write the minimal implementation**

Create `src/turnCreds.js`:

```js
"use strict";

// Cloudflare Calls TURN credential minting. The long-term Turn Token
// (id + api token) stays server-side; we exchange it for short-lived
// ICE credentials the browser/Neko can use.

const CF_BASE = "https://rtc.live.cloudflare.com/v1/turn/keys";

export function turnEnabled(env = process.env) {
	return Boolean(env.CF_TURN_TOKEN_ID && env.CF_TURN_API_TOKEN);
}

// Browsers block the alternate :53 TURN/STUN port, so strip those URLs.
// Returns a fresh copy; never mutates the input.
export function filterPort53(iceServers) {
	const out = [];
	for (const server of iceServers) {
		const urls = (Array.isArray(server.urls) ? server.urls : [server.urls]).filter(
			(u) => !u.includes(":53")
		);
		if (urls.length === 0) continue;
		out.push({ ...server, urls });
	}
	return out;
}

export async function fetchTurnCreds({
	tokenId,
	apiToken,
	ttl = 86400,
	fetchImpl = fetch,
}) {
	const res = await fetchImpl(
		`${CF_BASE}/${tokenId}/credentials/generate-ice-servers`,
		{
			method: "POST",
			headers: {
				Authorization: `Bearer ${apiToken}`,
				"Content-Type": "application/json",
			},
			body: JSON.stringify({ ttl }),
		}
	);
	if (!res.ok) {
		throw new Error(`Cloudflare TURN request failed: ${res.status}`);
	}
	const data = await res.json();
	return { iceServers: filterPort53(data.iceServers || []) };
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `node --test test/turnCreds.test.js`
Expected: PASS — 4 tests passing.

- [ ] **Step 6: Lint and commit**

```bash
pnpm lint
git add src/turnCreds.js test/turnCreds.test.js package.json
git commit -m "feat: add Cloudflare TURN credential module with tests"
```

---

## Task 2: `/turn-creds` route in the Fastify server

**Files:**
- Modify: `src/index.js` (imports near line 12; new route after the static registrations, ~line 66)

**Interfaces:**
- Consumes: `turnEnabled`, `fetchTurnCreds` from `src/turnCreds.js`.
- Produces: `GET /turn-creds` → `200 {iceServers:[...]}` when enabled; `503 {error}` when env unset; `502 {error}` on upstream failure.

- [ ] **Step 1: Add the import**

In `src/index.js`, after line 13 (`import { RotatingSocksTCPSocket } ...`), add:

```js
import { turnEnabled, fetchTurnCreds } from "./turnCreds.js";
```

- [ ] **Step 2: Register the route**

In `src/index.js`, after the `baremuxPath` static registration block (currently ending at line 66, before `setNotFoundHandler` at line 68), insert:

```js
// Short-lived Cloudflare TURN credentials for the device-side WebRTC client.
// The long-term Turn Token stays in env; this only ever returns ephemeral creds.
fastify.get("/turn-creds", async (request, reply) => {
	if (!turnEnabled()) {
		return reply.code(503).send({ error: "TURN not configured" });
	}
	try {
		const ttl = parseInt(process.env.CF_TURN_TTL || "", 10) || 86400;
		const creds = await fetchTurnCreds({
			tokenId: process.env.CF_TURN_TOKEN_ID,
			apiToken: process.env.CF_TURN_API_TOKEN,
			ttl,
		});
		return reply.send(creds);
	} catch (err) {
		request.log.error(err);
		return reply.code(502).send({ error: "Failed to mint TURN credentials" });
	}
});
```

- [ ] **Step 3: Smoke test — disabled path**

Run (no CF env set):

```bash
node src/index.js & sleep 2
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:8080/turn-creds
kill %1
```

Expected: `503`.

- [ ] **Step 4: Smoke test — enabled path (requires real Cloudflare Turn Token)**

Run:

```bash
CF_TURN_TOKEN_ID=<real-id> CF_TURN_API_TOKEN=<real-token> node src/index.js & sleep 2
curl -s http://localhost:8080/turn-creds | head -c 400; echo
kill %1
```

Expected: JSON with an `iceServers` array containing a `turns:turn.cloudflare.com:443?transport=tcp` URL and no `:53` URLs.

- [ ] **Step 5: Lint and commit**

```bash
pnpm lint
git add src/index.js
git commit -m "feat: serve short-lived Cloudflare TURN creds at /turn-creds"
```

---

## Task 3: YouTube URL detection helper (`public/ytdetect.js`)

**Files:**
- Create: `public/ytdetect.js`
- Test: `test/ytdetect.test.js`

**Interfaces:**
- Produces: `isYouTubeUrl(str: string): boolean` — true for `youtube.com`, any `*.youtube.com` (www, m, music), and `youtu.be`; false otherwise or on unparseable input. Exposed as a browser global AND as an ESM export (dual-mode) so it is unit-testable under `node --test`.

- [ ] **Step 1: Write the failing tests**

Create `test/ytdetect.test.js`:

```js
"use strict";
import { test } from "node:test";
import assert from "node:assert/strict";
import { isYouTubeUrl } from "../public/ytdetect.js";

test("matches youtube hosts", () => {
	assert.equal(isYouTubeUrl("https://youtube.com"), true);
	assert.equal(isYouTubeUrl("https://www.youtube.com/watch?v=abc"), true);
	assert.equal(isYouTubeUrl("https://m.youtube.com/"), true);
	assert.equal(isYouTubeUrl("https://music.youtube.com/"), true);
	assert.equal(isYouTubeUrl("https://youtu.be/abc"), true);
});

test("rejects non-youtube and lookalike hosts", () => {
	assert.equal(isYouTubeUrl("https://example.com"), false);
	assert.equal(isYouTubeUrl("https://notyoutube.com"), false);
	assert.equal(isYouTubeUrl("https://youtube.com.evil.com"), false);
	assert.equal(isYouTubeUrl("not a url"), false);
	assert.equal(isYouTubeUrl(""), false);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test test/ytdetect.test.js`
Expected: FAIL — `Cannot find module '../public/ytdetect.js'`.

- [ ] **Step 3: Write the minimal implementation**

Create `public/ytdetect.js`:

```js
"use strict";

// Returns true when the given string is a YouTube URL (youtube.com,
// its subdomains, or youtu.be). Used to decide whether the omnibox should
// open the Neko remote-browser view instead of the Scramjet iframe.
function isYouTubeUrl(str) {
	let u;
	try {
		u = new URL(str);
	} catch (err) {
		return false;
	}
	const host = u.hostname.toLowerCase();
	return (
		host === "youtube.com" ||
		host.endsWith(".youtube.com") ||
		host === "youtu.be"
	);
}

// Dual-mode: ESM export for node --test, global for the browser <script>.
export { isYouTubeUrl };
if (typeof window !== "undefined") {
	window.isYouTubeUrl = isYouTubeUrl;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test test/ytdetect.test.js`
Expected: PASS — 2 tests passing.

- [ ] **Step 5: Commit**

```bash
git add public/ytdetect.js test/ytdetect.test.js
git commit -m "feat: add isYouTubeUrl detection helper with tests"
```

**Note on browser loading:** `ytdetect.js` uses `export`, so the browser `<script>` that loads it (Task 4) MUST use `type="module"`, OR we rely on the `window.isYouTubeUrl` global assignment. Task 4 loads it as a classic script and consumes `window.isYouTubeUrl`; the `export` line is harmless to the classic-script global assignment only if the file is parsed as a module. To keep it a classic script for the browser while still ESM-importable in tests, Task 4 loads it via `<script type="module">` and `index.js` reads `window.isYouTubeUrl`. (Module scripts still run the `window.` assignment.)

---

## Task 4: Neko view smart-redirect in the client

**Files:**
- Modify: `public/index.html` (script loads ~line 13-19; body ~after line 57)
- Modify: `public/index.js` (globals ~line 23-31; submit handler line 76-108; home handler line 131-137)

**Interfaces:**
- Consumes: `window.isYouTubeUrl` (Task 3); `NEKO_PUBLIC_URL` from a global injected by `index.html`.
- Produces: `openNekoView()` / `closeNekoView()` behavior; a `#sj-neko` iframe element.

- [ ] **Step 1: Load ytdetect + declare the Neko URL in index.html**

In `public/index.html`, change the script block (lines 13-19) to add `ytdetect.js` as a module and a small config global. Replace:

```html
		<script src="/scram/scramjet.all.js"></script>
		<script src="/baremux/index.js"></script>
		
		<link rel="stylesheet" href="index.css" />
		<script src="register-sw.js" defer></script>
		<script src="search.js" defer></script>
		<script src="index.js" defer></script>
```

with:

```html
		<script src="/scram/scramjet.all.js"></script>
		<script src="/baremux/index.js"></script>
		
		<link rel="stylesheet" href="index.css" />
		<script>
			// Base URL of the Neko remote browser. Same-origin default assumes a
			// reverse-proxy path; overridden at deploy time by injecting a value.
			window.NEKO_PUBLIC_URL = window.NEKO_PUBLIC_URL || "/neko/";
		</script>
		<script type="module" src="ytdetect.js"></script>
		<script src="register-sw.js" defer></script>
		<script src="search.js" defer></script>
		<script src="index.js" defer></script>
```

- [ ] **Step 2: Add the Neko iframe container to index.html**

In `public/index.html`, immediately after the toolbar `</div>` (line 57) and before `<footer>` (line 58), insert:

```html
		<!-- Remote-browser (Neko) view; shown only for YouTube. -->
		<iframe
			id="sj-neko"
			title="Remote browser"
			allow="autoplay; fullscreen; clipboard-read; clipboard-write"
			hidden
		></iframe>
```

- [ ] **Step 3: Add Neko open/close helpers in index.js**

In `public/index.js`, after the `let activeFrame = null;` line (line 31), add:

```js
const nekoFrame = document.getElementById("sj-neko");

function openNekoView() {
	// Tear down any Scramjet frame so only one view is active.
	if (activeFrame) {
		activeFrame.frame.remove();
		activeFrame = null;
	}
	nekoFrame.src = window.NEKO_PUBLIC_URL;
	nekoFrame.hidden = false;
	toolbar.hidden = false;
	omnibox.value = "https://youtube.com";
}

function closeNekoView() {
	nekoFrame.hidden = true;
	nekoFrame.removeAttribute("src");
}
```

- [ ] **Step 4: Branch the submit handler to the Neko view for YouTube**

In `public/index.js`, in the `form` submit handler, replace the block from `const url = search(...)` (line 87) through the `activeFrame.go(url);` (line 107) with:

```js
	const url = search(address.value, searchEngine.value);

	if (window.isYouTubeUrl && window.isYouTubeUrl(url)) {
		openNekoView();
		return;
	}

	if ((await connection.getTransport()) !== "/libcurl/index.mjs") {
		await connection.setTransport("/libcurl/index.mjs", [
			{ websocket: wispUrl },
		]);
	}
	if (!activeFrame) {
		activeFrame = scramjet.createFrame();
		activeFrame.frame.id = "sj-frame";
		document.body.appendChild(activeFrame.frame);
		// Scramjet emits "urlchange" on the frame whenever the proxied page
		// navigates (clicks, history.pushState, full loads). Mirror it into
		// the omnibox so the address bar tracks the visible page.
		activeFrame.addEventListener?.("urlchange", (e) => {
			if (omnibox && typeof e?.url === "string") omnibox.value = e.url;
		});
		toolbar.hidden = false;
	}
	closeNekoView();
	omnibox.value = url;
	activeFrame.go(url);
```

- [ ] **Step 5: Make the omnibox submit also honor the YouTube branch**

In `public/index.js`, replace the `omniboxForm` submit handler (lines 122-129) with a version that is NOT gated on `activeFrame` (so it works while the Neko view is showing):

```js
omniboxForm.addEventListener("submit", (event) => {
	event.preventDefault();
	const url = search(omnibox.value, searchEngine.value);

	if (window.isYouTubeUrl && window.isYouTubeUrl(url)) {
		openNekoView();
		return;
	}

	if (!activeFrame) return;
	closeNekoView();
	omnibox.value = url;
	activeFrame.go(url);
});
```

- [ ] **Step 6: Make Home/Back close the Neko view**

In `public/index.js`, replace the `homeBtn` click handler (lines 131-137) with:

```js
homeBtn.addEventListener("click", () => {
	closeNekoView();
	if (activeFrame) {
		activeFrame.frame.remove();
		activeFrame = null;
	}
	toolbar.hidden = true;
	omnibox.value = "";
});
```

- [ ] **Step 7: Manual smoke test (served locally)**

Run:

```bash
node src/index.js & sleep 2
```

Open `http://localhost:8080`, type `example.com` → confirms the Scramjet iframe still loads (no regression). Type `youtube.com` → confirms the `#sj-neko` iframe becomes visible pointing at `NEKO_PUBLIC_URL` (it will 404 until Task 5 wires Neko — that's expected here; you're verifying the *branch*, not playback). Then:

```bash
kill %1
```

Expected: youtube.com shows the Neko iframe container; example.com shows the Scramjet frame; Home clears both.

- [ ] **Step 8: Lint and commit**

```bash
pnpm lint
git add public/index.html public/index.js
git commit -m "feat: smart-redirect youtube.com to the Neko remote-browser view"
```

---

## Task 5: Neko service, TURN minting, and env plumbing

**Files:**
- Create: `scripts/mint-turn-creds.sh`
- Modify: `docker-compose.yml` (add `neko` service)
- Modify: `start.sh` (mint creds + write env + Private-port reminder)

**Interfaces:**
- Consumes: `CF_TURN_TOKEN_ID`, `CF_TURN_API_TOKEN` (operator-supplied env); existing `WIREPROXY_SOCKS`.
- Produces: `.env` entries `NEKO_WEBRTC_ICESERVERS_FRONTEND`, `NEKO_WEBRTC_ICESERVERS_BACKEND`; a running `neko` service reachable at `:8081`.

- [ ] **Step 1: Write the TURN minting script**

Create `scripts/mint-turn-creds.sh`:

```sh
#!/bin/sh
# Mint short-lived Cloudflare TURN ICE servers and print a single JSON array
# (port-53 URLs removed). Requires curl + jq and the env vars below.
#
# Usage: CF_TURN_TOKEN_ID=... CF_TURN_API_TOKEN=... [CF_TURN_TTL=86400] \
#          scripts/mint-turn-creds.sh
set -e

: "${CF_TURN_TOKEN_ID:?set CF_TURN_TOKEN_ID}"
: "${CF_TURN_API_TOKEN:?set CF_TURN_API_TOKEN}"
ttl="${CF_TURN_TTL:-86400}"

curl -s \
	"https://rtc.live.cloudflare.com/v1/turn/keys/${CF_TURN_TOKEN_ID}/credentials/generate-ice-servers" \
	--header "Authorization: Bearer ${CF_TURN_API_TOKEN}" \
	--header "Content-Type: application/json" \
	--data "{\"ttl\": ${ttl}}" \
| jq -c '[.iceServers[] | .urls |= map(select(contains(":53") | not)) | select(.urls | length > 0)]'
```

- [ ] **Step 2: Verify the minting script (requires real token)**

Run:

```bash
chmod +x scripts/mint-turn-creds.sh
CF_TURN_TOKEN_ID=<real-id> CF_TURN_API_TOKEN=<real-token> ./scripts/mint-turn-creds.sh
```

Expected: a single-line JSON array; contains `turns:turn.cloudflare.com:443?transport=tcp`; contains no `:53` substring.

- [ ] **Step 3: Add the Neko service to docker-compose.yml**

In `docker-compose.yml`, add under `services:` (after the `scramjet` service, before `wireproxy1`):

```yaml
  neko:
    image: ghcr.io/m1k1o/neko/chromium:latest
    container_name: neko
    restart: unless-stopped
    shm_size: "2gb"
    cap_add:
      - SYS_ADMIN
    ports:
      - "8081:8080"
    environment:
      NEKO_DESKTOP_SCREEN: "1920x1080@30"
      # No in-app auth; access is gated by GitHub forwarded-port = Private.
      NEKO_MEMBER_PROVIDER: "multiuser"
      NEKO_MEMBER_MULTIUSER_USER_PASSWORD: ${NEKO_USER_PASSWORD:-neko}
      NEKO_MEMBER_MULTIUSER_ADMIN_PASSWORD: ${NEKO_ADMIN_PASSWORD:-admin}
      # ICE servers = Cloudflare TURN (minted by start.sh). ICELITE MUST be 0
      # when supplying ICE servers.
      NEKO_WEBRTC_ICELITE: "0"
      NEKO_WEBRTC_ICESERVERS_FRONTEND: ${NEKO_WEBRTC_ICESERVERS_FRONTEND:-[]}
      NEKO_WEBRTC_ICESERVERS_BACKEND: ${NEKO_WEBRTC_ICESERVERS_BACKEND:-[]}
      NEKO_WEBRTC_TCPMUX: "59000"
      # Route Chromium egress through the existing residential SOCKS exit.
      NEKO_DESKTOP_CHROMIUM_FLAGS: >-
        --proxy-server=socks5://${NEKO_EGRESS_SOCKS:-wireproxy1:25344}
    depends_on:
      - wireproxy1
    networks:
      - egress
```

- [ ] **Step 4: Plumb minting + env into start.sh**

In `start.sh`, replace the tail (lines 37-42, from `echo "WIREPROXY_SOCKS=..."` to `docker compose up --build`) with:

```sh
{
	echo "WIREPROXY_SOCKS=$socks"

	# Neko egress: first SOCKS endpoint in the pool (or host if none).
	first_socks="${socks%%,*}"
	if [ -n "$first_socks" ]; then
		echo "NEKO_EGRESS_SOCKS=$first_socks"
	fi

	# Mint Cloudflare TURN ICE servers if a Turn Token is configured.
	if [ -n "$CF_TURN_TOKEN_ID" ] && [ -n "$CF_TURN_API_TOKEN" ]; then
		ice="$(CF_TURN_TOKEN_ID="$CF_TURN_TOKEN_ID" \
			CF_TURN_API_TOKEN="$CF_TURN_API_TOKEN" \
			CF_TURN_TTL="${CF_TURN_TTL:-86400}" \
			./scripts/mint-turn-creds.sh)"
		echo "NEKO_WEBRTC_ICESERVERS_FRONTEND=$ice"
		echo "NEKO_WEBRTC_ICESERVERS_BACKEND=$ice"
		echo "==> Minted Cloudflare TURN credentials for Neko" >&2
	else
		echo "==> WARNING: CF_TURN_TOKEN_ID/CF_TURN_API_TOKEN unset;" >&2
		echo "    Neko WebRTC will have no TURN relay and won't reach the device." >&2
	fi
} > .env

echo "==> Egress: ${socks:-host IP (no VPN)}"
echo "==> Scramjet on http://localhost:8080  |  Neko on http://localhost:8081"
echo "==> SECURITY: In the GitHub Ports panel, set BOTH 8080 and 8081 to"
echo "    'Private' visibility. The remote browser has no login."

docker compose down
docker compose up --build
```

- [ ] **Step 5: Config validation (no real tokens needed)**

Run:

```bash
docker compose config >/dev/null && echo "compose OK"
sh -n start.sh && echo "start.sh syntax OK"
sh -n scripts/mint-turn-creds.sh && echo "mint script syntax OK"
```

Expected: all three print OK.

- [ ] **Step 6: Commit**

```bash
git add scripts/mint-turn-creds.sh docker-compose.yml start.sh
git commit -m "feat: add Neko service, TURN minting, and env plumbing"
```

---

## Task 6: End-to-end acceptance + operator docs

**Files:**
- Create: `docs/youtube-neko.md`
- Modify: `CLAUDE.md` (add a short "YouTube via Neko" subsection under Architecture)

**Interfaces:** none (integration + docs).

- [ ] **Step 1: Write the operator doc**

Create `docs/youtube-neko.md`:

```markdown
# YouTube via Neko (remote browser)

Real youtube.com plays in a headful Chromium (Neko) in the Codespace and is
streamed to the device over WebRTC. Interception cannot play YouTube
(BotGuard/poToken); see the design spec in `docs/superpowers/specs/`.

## One-time setup
1. Create a **Cloudflare Calls TURN key** (dashboard) → note the Turn Token ID
   and API token. Free tier is fine.
2. Export them before launching:
   ```sh
   export CF_TURN_TOKEN_ID=...
   export CF_TURN_API_TOKEN=...
   ```

## Run
```sh
./start.sh rotate      # or jp|us|nl|none
```
- Scramjet: http://localhost:8080
- Neko:     http://localhost:8081

## SECURITY (required)
Neko has no real login. In the GitHub **Ports** panel set **8080 and 8081 to
"Private"** so only your GitHub-authenticated session can reach them.

## Use
Open the Scramjet page, type `youtube.com` → the Neko view opens and plays the
real site. Any other URL stays on the Scramjet proxy.

## Known limitations
- TURN credentials are minted at launch with a 24h TTL. Sessions longer than
  the TTL need a relaunch (`./start.sh ...`) to re-mint. See design spec §4.
- Egress bandwidth depends on the Pi Zero exit (design spec Probe 3).
```

- [ ] **Step 2: Add a pointer in CLAUDE.md**

In `CLAUDE.md`, under `## Architecture`, add a short subsection after the "Request flow" line:

```markdown

**YouTube (`docs/youtube-neko.md`):** youtube.com cannot be intercepted (BotGuard/poToken). The omnibox smart-redirects youtube.com to a Neko headful-Chromium container (`docker-compose.yml` `neko` service) streamed over WebRTC via Cloudflare TURN; egress goes through the wireproxy SOCKS exit. Requires `CF_TURN_*` env; forwarded ports must be set to Private.
```

- [ ] **Step 3: Full E2E acceptance run (manual — the real success test)**

With `CF_TURN_TOKEN_ID`/`CF_TURN_API_TOKEN` exported and ports set to Private:

```bash
./start.sh rotate
```

From the **locked-down device**, open the Codespace-forwarded 8080 URL and:
1. Type `example.com` → Scramjet iframe loads (no regression). ✅
2. Type `youtube.com` → Neko view opens; **a real video plays with audio, A/V in sync**; no persistent 403/poToken error. ✅
3. Reload button reloads Chromium (not the app page); Home returns to the Scramjet landing. ✅
4. Note glass-to-glass latency; tune Neko codec/bitrate/FPS toward lowest latency (spec §6 Layer 4).

- [ ] **Step 4: Run the whole test suite**

Run: `pnpm test`
Expected: all `turnCreds` and `ytdetect` tests PASS.

- [ ] **Step 5: Commit**

```bash
git add docs/youtube-neko.md CLAUDE.md
git commit -m "docs: operator guide for YouTube via Neko"
```

- [ ] **Step 6: Push**

```bash
git push origin main
```

---

## Self-Review

**Spec coverage:**
- §1 Problem/Goal → Task 4 (smart-redirect), Task 5 (Neko). ✅
- §2 Topology (3 planes) → Task 5 (Neko+TURN+egress), Task 2 (`/turn-creds`). ✅
- §3 Components A–F → A Neko (T5), B TURN broker (T1/T2/T5), C Fastify route (T2), D Pi egress (T5 proxy flag), E client UI (T4), F compose+start.sh (T5). ✅
- §3 Security (Private port) → T5 Step 4, T6 doc. ✅
- §4 Data/control flow, Reload=Chromium-reload, cred lifecycle → T4 (Home/Back/omnibox), T6 known-limitations (TTL). ✅
- §5 Error handling + 3 probes → Task 0 (probes); route 503/502 (T2); minting warning (T5 Step 4). ✅
- §6 Testing layers → Task 0 (L0), T1/T3 unit (L1 creds), T2/T5 smoke (L1), T6 E2E (L3), latency tuning (L4). ✅

**Placeholder scan:** No TBD/TODO; every code step shows complete code; commands have expected output. ✅

**Type consistency:** `turnEnabled`/`fetchTurnCreds`/`filterPort53` names match between T1 definition and T2 usage. `isYouTubeUrl` matches between T3 and T4 (`window.isYouTubeUrl`). `openNekoView`/`closeNekoView` defined and used within T4. Env var names (`NEKO_WEBRTC_ICESERVERS_FRONTEND/BACKEND`, `CF_TURN_TOKEN_ID/API_TOKEN`) consistent across T2/T5/T6. ✅

**Known residual risks (flagged, not gaps):**
- Neko reads ICE env at container start; TTL 24h covers a session, but ICE restart mid-session past TTL isn't auto-refreshed (documented limitation, T6).
- `NEKO_DESKTOP_CHROMIUM_FLAGS` var name is the v3 convention; if the pinned image differs, adjust to the image's documented Chromium-flags env at T5 Step 5 (config validation will still pass; verify in the E2E run).
