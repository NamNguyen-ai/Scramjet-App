import { createServer } from "node:http";
import { fileURLToPath } from "url";
import { hostname } from "node:os";
import { server as wisp, logging } from "@mercuryworkshop/wisp-js/server";
import Fastify from "fastify";
import fastifyStatic from "@fastify/static";

import { scramjetPath } from "@mercuryworkshop/scramjet/path";
import { libcurlPath } from "@mercuryworkshop/libcurl-transport";
import { baremuxPath } from "@mercuryworkshop/bare-mux/node";

import { endpoints, isEnabled } from "./socksPool.js";
import { RotatingSocksTCPSocket } from "./socksTcpSocket.js";
import { turnEnabled, fetchTurnCreds } from "./turnCreds.js";

const publicPath = fileURLToPath(new URL("../public/", import.meta.url));

// Wisp Configuration: Refer to the documentation at https://www.npmjs.com/package/@mercuryworkshop/wisp-js

logging.set_level(logging.NONE);
Object.assign(wisp.options, {
	allow_udp_streams: false,
	hostname_blacklist: [/example\.com/],
	dns_servers: ["1.1.1.3", "1.0.0.3"],
});

const fastify = Fastify({
	serverFactory: (handler) => {
		return createServer()
			.on("request", (req, res) => {
				res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
				res.setHeader("Cross-Origin-Embedder-Policy", "require-corp");
				handler(req, res);
			})
			.on("upgrade", (req, socket, head) => {
				if (req.url.endsWith("/wisp/")) {
					const opts = isEnabled()
						? { TCPSocket: RotatingSocksTCPSocket }
						: undefined;
					wisp.routeRequest(req, socket, head, opts);
				} else socket.end();
			});
	},
});

fastify.register(fastifyStatic, {
	root: publicPath,
	decorateReply: true,
});

fastify.register(fastifyStatic, {
	root: scramjetPath,
	prefix: "/scram/",
	decorateReply: false,
});

fastify.register(fastifyStatic, {
	root: libcurlPath,
	prefix: "/libcurl/",
	decorateReply: false,
});

fastify.register(fastifyStatic, {
	root: baremuxPath,
	prefix: "/baremux/",
	decorateReply: false,
});

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

fastify.setNotFoundHandler((res, reply) => {
	return reply.code(404).type("text/html").sendFile("404.html");
});

fastify.server.on("listening", () => {
	const address = fastify.server.address();

	if (isEnabled()) {
		console.log(
			`Wireproxy rotation: ${endpoints.length} SOCKS5 endpoints configured`
		);
	} else {
		console.log("Wireproxy rotation: disabled (WIREPROXY_SOCKS unset)");
	}

	// by default we are listening on 0.0.0.0 (every interface)
	// we just need to list a few
	console.log("Listening on:");
	console.log(`\thttp://localhost:${address.port}`);
	console.log(`\thttp://${hostname()}:${address.port}`);
	console.log(
		`\thttp://${
			address.family === "IPv6" ? `[${address.address}]` : address.address
		}:${address.port}`
	);
});

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

function shutdown() {
	console.log("SIGTERM signal received: closing HTTP server");
	fastify.close();
	process.exit(0);
}

let port = parseInt(process.env.PORT || "");

if (isNaN(port)) port = 8080;

fastify.listen({
	port: port,
	host: "0.0.0.0",
});
