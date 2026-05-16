// Parses WIREPROXY_SOCKS env var (comma-separated host:port tokens) into a
// pool of SOCKS5 endpoints, and exposes a round-robin picker. If the env var
// is empty/unset, rotation is disabled and callers should fall back to the
// default wisp-js outbound behavior.

function parseEndpoints(raw) {
	if (!raw) return [];
	return raw
		.split(",")
		.map((s) => s.trim())
		.filter(Boolean)
		.map((token) => {
			const idx = token.lastIndexOf(":");
			if (idx === -1) {
				throw new Error(
					`WIREPROXY_SOCKS entry "${token}" is missing a port (expected host:port)`
				);
			}
			const host = token.slice(0, idx);
			const port = parseInt(token.slice(idx + 1), 10);
			if (!host || isNaN(port)) {
				throw new Error(
					`WIREPROXY_SOCKS entry "${token}" is not a valid host:port`
				);
			}
			return { host, port };
		});
}

export const endpoints = parseEndpoints(process.env.WIREPROXY_SOCKS);

let counter = 0;

export function isEnabled() {
	return endpoints.length > 0;
}

export function pickSocksEndpoint() {
	if (endpoints.length === 0) {
		throw new Error("SOCKS pool is empty; call isEnabled() before picking");
	}
	const ep = endpoints[counter % endpoints.length];
	counter++;
	return ep;
}
