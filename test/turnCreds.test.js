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
