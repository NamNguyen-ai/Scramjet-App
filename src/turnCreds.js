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
