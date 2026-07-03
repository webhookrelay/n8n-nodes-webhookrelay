/**
 * Minimal, dependency-free Webhook Relay WebSocket client.
 *
 * Uses the runtime's built-in global `WebSocket` (Node.js >= 22, which n8n's
 * official images ship). Handles the authenticate -> subscribe handshake,
 * replies to the server's pings, sends its own keepalive pings, and reconnects
 * on drop until closed. A fatal `unauthorized` status stops reconnection.
 *
 * Keepalive: the server pings every ~21s and we pong, but we ALSO send a
 * client-side `{action:"ping"}` every 15s. The server ignores it, but it keeps
 * the connection warm through intermediary proxies/load balancers that would
 * otherwise idle it out. Reconnect is immediate on the first drop (the server
 * tears the whole subscription down on any single write error, so fast recovery
 * matters), then backs off if the server stays unreachable.
 *
 * Kept intentionally free of runtime dependencies so the package stays
 * zero-dependency (eligible for n8n community-node verification).
 */

/** Client keepalive ping interval (ms). Server pings every ~21s independently. */
const PING_INTERVAL_MS = 15000;
/** Cap on the reconnect backoff (ms) when the server stays unreachable. */
const MAX_RECONNECT_DELAY_MS = 15000;

/** Minimal WebSocket surface (matches the global `WebSocket` and `ws`). */
interface WebSocketLike {
	send(data: string): void;
	close(code?: number, reason?: string): void;
	onopen: ((event: unknown) => void) | null;
	onmessage: ((event: { data: unknown }) => void) | null;
	onerror: ((event: unknown) => void) | null;
	onclose: ((event: { code?: number; reason?: string }) => void) | null;
}
interface WebSocketCtor {
	new (url: string): WebSocketLike;
}

/** A webhook delivered over the WebSocket in real time. */
export interface WebhookRelayEvent {
	meta: Record<string, unknown>;
	headers: Record<string, unknown>;
	/** URL query string, e.g. "foo=bar". */
	query: string;
	/** Raw request body as a string. */
	body: string;
	method: string;
}

export interface SocketAuth {
	key: string;
	secret: string;
}

export interface SocketOptions {
	/** REST base URL, e.g. https://my.webhookrelay.com — the socket URL is derived from it. */
	baseUrl: string;
	auth: SocketAuth;
	/** Bucket IDs or account-unique names to subscribe to. */
	buckets: string[];
	onWebhook: (event: WebhookRelayEvent) => void;
	onError?: (err: Error) => void;
}

function resolveWebSocketCtor(): WebSocketCtor {
	const ctor = (globalThis as { WebSocket?: unknown }).WebSocket;
	if (typeof ctor !== 'function') {
		throw new Error(
			'No global WebSocket available. Run n8n on Node.js >= 22 (its official images already do).',
		);
	}
	return ctor as unknown as WebSocketCtor;
}

/** Derive the `wss://…/v1/socket` URL from the REST base URL. */
function socketUrlFromBase(baseUrl: string): string {
	return baseUrl.replace(/\/+$/, '').replace(/^http/, 'ws') + '/v1/socket';
}

function toError(value: unknown): Error {
	return value instanceof Error
		? value
		: new Error(typeof value === 'string' ? value : 'WebSocket error');
}

/**
 * A live WebSocket subscription to one or more Webhook Relay buckets. Call
 * {@link start} to connect and {@link close} to disconnect permanently.
 */
export class WebhookRelaySocket {
	private ws: WebSocketLike | null = null;
	private closed = false;
	private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
	private pingTimer: ReturnType<typeof setInterval> | null = null;
	private reconnectAttempts = 0;

	constructor(private readonly opts: SocketOptions) {}

	start(): void {
		this.connect();
	}

	close(): void {
		this.closed = true;
		if (this.reconnectTimer) {
			clearTimeout(this.reconnectTimer);
			this.reconnectTimer = null;
		}
		this.teardown(1000, 'client closed');
	}

	private connect(): void {
		if (this.closed) return;

		let ws: WebSocketLike;
		try {
			const Ctor = resolveWebSocketCtor();
			ws = new Ctor(socketUrlFromBase(this.opts.baseUrl));
		} catch (err) {
			this.opts.onError?.(toError(err));
			return; // cannot construct a socket — a config problem, don't retry
		}
		this.ws = ws;

		ws.onopen = () =>
			this.send({ action: 'auth', key: this.opts.auth.key, secret: this.opts.auth.secret });
		ws.onmessage = (event) => this.handle(event.data);
		ws.onerror = (event) =>
			this.opts.onError?.(toError((event as { message?: unknown })?.message ?? 'WebSocket error'));
		ws.onclose = () => {
			this.stopPing();
			this.ws = null;
			if (!this.closed) this.scheduleReconnect();
		};
	}

	private handle(data: unknown): void {
		let msg: Record<string, unknown>;
		try {
			msg = JSON.parse(typeof data === 'string' ? data : String(data));
		} catch {
			return; // ignore non-JSON frames
		}

		if (msg.type === 'webhook') {
			const meta = (msg.meta ?? {}) as Record<string, unknown>;
			// The wire field is the misspelled `bucked_id`; expose a corrected alias.
			if (meta.bucket_id === undefined && meta.bucked_id !== undefined) {
				meta.bucket_id = meta.bucked_id;
			}
			this.opts.onWebhook({
				meta,
				headers: (msg.headers ?? {}) as Record<string, unknown>,
				query: (msg.query as string) ?? '',
				body: (msg.body as string) ?? '',
				method: (msg.method as string) ?? '',
			});
			return;
		}

		if (msg.type === 'status') {
			switch (msg.status) {
				case 'authenticated':
					// Healthy connection re-established — reset backoff and (re)start
					// our keepalive. Client pings are only valid once authenticated.
					this.reconnectAttempts = 0;
					this.send({ action: 'subscribe', buckets: this.opts.buckets });
					this.startPing();
					break;
				case 'ping':
					this.send({ action: 'pong' });
					break;
				case 'unauthorized':
					this.closed = true; // fatal — bad credentials won't fix on reconnect
					this.opts.onError?.(
						new Error(`WebSocket authentication failed: ${(msg.message as string) ?? 'unauthorized'}`),
					);
					this.teardown(4001, 'unauthorized');
					break;
			}
		}
	}

	private scheduleReconnect(): void {
		if (this.closed || this.reconnectTimer) return;
		const attempt = this.reconnectAttempts++;
		// Reconnect immediately on the first drop after a healthy connection; if
		// reconnects keep failing (server unreachable), back off exponentially up
		// to a cap. The counter is reset to 0 the moment we re-authenticate.
		const delay =
			attempt === 0 ? 0 : Math.min(1000 * 2 ** (attempt - 1), MAX_RECONNECT_DELAY_MS);
		this.reconnectTimer = setTimeout(() => {
			this.reconnectTimer = null;
			this.connect();
		}, delay);
	}

	private startPing(): void {
		this.stopPing();
		this.pingTimer = setInterval(() => {
			this.send({ action: 'ping' });
		}, PING_INTERVAL_MS);
	}

	private stopPing(): void {
		if (this.pingTimer) {
			clearInterval(this.pingTimer);
			this.pingTimer = null;
		}
	}

	private send(payload: unknown): void {
		try {
			this.ws?.send(JSON.stringify(payload));
		} catch (err) {
			this.opts.onError?.(toError(err));
		}
	}

	private teardown(code: number, reason: string): void {
		this.stopPing();
		const ws = this.ws;
		this.ws = null;
		if (!ws) return;
		ws.onopen = ws.onmessage = ws.onerror = ws.onclose = null;
		try {
			ws.close(code, reason);
		} catch {
			// ignore
		}
	}
}
