"use strict";
/**
 * @type {HTMLFormElement}
 */
const form = document.getElementById("sj-form");
/**
 * @type {HTMLInputElement}
 */
const address = document.getElementById("sj-address");
/**
 * @type {HTMLInputElement}
 */
const searchEngine = document.getElementById("sj-search-engine");
/**
 * @type {HTMLParagraphElement}
 */
const error = document.getElementById("sj-error");
/**
 * @type {HTMLPreElement}
 */
const errorCode = document.getElementById("sj-error-code");

const { ScramjetController } = $scramjetLoadController();

const wispUrl =
	(location.protocol === "https:" ? "wss" : "ws") +
	"://" +
	location.host +
	"/wisp/";

const scramjet = new ScramjetController({
	wisp: wispUrl,
	files: {
		wasm: "/scram/scramjet.wasm.wasm",
		all: "/scram/scramjet.all.js",
		sync: "/scram/scramjet.sync.js",
	},
	// Per-origin rewrite overrides. Keys are regex patterns matched against the
	// full URL href; values are Partial<ScramjetFlags>. We loosen rewriting on
	// YouTube + googlevideo + Google's BotGuard endpoints so the player's
	// attestation JS runs in a less-mangled environment. PoToken/BotGuard probe
	// the live JS environment to mint a valid token; aggressive rewriting tends
	// to make those probes diverge from a real browser and the token is
	// rejected. This is a best-effort softening, not a guaranteed fix.
	siteFlags: {
		"youtube\\.com": {
			strictRewrites: false,
			destructureRewrites: false,
			scramitize: false,
		},
		"googlevideo\\.com": {
			strictRewrites: false,
			destructureRewrites: false,
			scramitize: false,
		},
		"ytimg\\.com": {
			strictRewrites: false,
		},
	},
});

scramjet.init();

const connection = new BareMux.BareMuxConnection("/baremux/worker.js");

form.addEventListener("submit", async (event) => {
	event.preventDefault();

	try {
		await registerSW();
	} catch (err) {
		error.textContent = "Failed to register service worker.";
		errorCode.textContent = err.toString();
		throw err;
	}

	const url = search(address.value, searchEngine.value);

	if ((await connection.getTransport()) !== "/libcurl/index.mjs") {
		await connection.setTransport("/libcurl/index.mjs", [
			{ websocket: wispUrl },
		]);
	}
	const frame = scramjet.createFrame();
	frame.frame.id = "sj-frame";
	document.body.appendChild(frame.frame);
	frame.go(url);
});
