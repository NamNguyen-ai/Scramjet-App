// RotatingSocksTCPSocket implements the wisp-js TCPSocket interface but dials
// outbound connections through one of the SOCKS5 endpoints in the wireproxy
// pool. Each connect() picks the next endpoint (round-robin), so egress IPs
// rotate per outbound TCP connection. Hostname is passed to SOCKS5 unresolved
// so DNS rides the WireGuard tunnel.

import { SocksClient } from "socks";

import { pickSocksEndpoint } from "./socksPool.js";

// Minimal async FIFO queue matching the shape of the one wisp-js uses
// internally (put/get/close/size/max_size). Inlined because wisp-js doesn't
// export src/websocket.mjs via its package "exports" map.
class AsyncQueue {
	constructor(max_size) {
		this.max_size = max_size;
		this.queue = [];
		this.put_callbacks = [];
		this.get_callbacks = [];
	}

	put_now(data) {
		this.queue.push(data);
		this.get_callbacks.shift()?.();
	}

	async put(data) {
		if (this.size <= this.max_size) {
			this.put_now(data);
			return;
		}
		await new Promise((resolve) => {
			this.put_callbacks.push(resolve);
		});
		this.put_now(data);
	}

	get_now() {
		this.put_callbacks.shift()?.();
		return this.queue.shift();
	}

	async get() {
		if (this.size > 0) return this.get_now();
		await new Promise((resolve) => {
			this.get_callbacks.push(resolve);
		});
		return this.get_now();
	}

	close() {
		this.queue = [];
		let cb;
		while ((cb = this.get_callbacks.shift())) cb();
		while ((cb = this.put_callbacks.shift())) cb();
	}

	get size() {
		return this.queue.length;
	}
}

export class RotatingSocksTCPSocket {
	constructor(hostname, port) {
		this.hostname = hostname;
		this.port = port;
		this.recv_buffer_size = 128;

		this.socket = null;
		this.paused = false;
		this.connected = false;
		this.data_queue = new AsyncQueue(this.recv_buffer_size);
	}

	async connect() {
		const proxy = pickSocksEndpoint();
		const { socket } = await SocksClient.createConnection({
			proxy: {
				host: proxy.host,
				port: proxy.port,
				type: 5,
			},
			command: "connect",
			destination: {
				host: this.hostname,
				port: this.port,
			},
		});

		this.socket = socket;
		this.connected = true;

		socket.setNoDelay(true);
		socket.on("data", (data) => {
			this.data_queue.put(data);
		});
		socket.on("close", () => {
			this.data_queue.close();
			this.socket = null;
		});
		socket.on("error", () => {
			this.data_queue.close();
		});
		socket.on("end", () => {
			if (!this.socket) return;
			this.socket.destroy();
			this.socket = null;
		});
	}

	async recv() {
		return await this.data_queue.get();
	}

	async send(data) {
		// Match wisp-js NodeTCPSocket: only resolve once Node has accepted the
		// chunk into the kernel buffer. Returning early lets wisp close the
		// stream before bytes have actually been flushed, which on a cold WG
		// tunnel surfaces as a truncated request and hyper IncompleteMessage.
		await new Promise((resolve) => {
			this.socket.write(data, resolve);
		});
	}

	async close() {
		if (!this.socket) return;
		this.socket.end();
		this.socket = null;
	}

	pause() {
		if (!this.socket) return;
		if (this.data_queue.size >= this.data_queue.max_size) {
			this.socket.pause();
			this.paused = true;
		}
	}

	resume() {
		if (!this.socket) return;
		if (this.paused) {
			this.socket.resume();
			this.paused = false;
		}
	}
}
