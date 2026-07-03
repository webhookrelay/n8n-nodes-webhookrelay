import type {
	IDataObject,
	IExecuteFunctions,
	IHookFunctions,
	IHttpRequestMethods,
	IHttpRequestOptions,
	ILoadOptionsFunctions,
	ITriggerFunctions,
	ITriggerResponse,
	IWebhookFunctions,
	JsonObject,
} from 'n8n-workflow';
import { NodeApiError } from 'n8n-workflow';

import { WebhookRelaySocket, type SocketAuth, type WebhookRelayEvent } from './socket';

type RelayContext =
	| IHookFunctions
	| IWebhookFunctions
	| ILoadOptionsFunctions
	| ITriggerFunctions
	| IExecuteFunctions;

/**
 * The constant "key" the WebSocket server expects when authenticating with a
 * single account API key (the classic access token uses a real key/secret pair).
 */
const API_KEY_SOCKET_KEY = 'whr';

/**
 * Make an authenticated request to the Webhook Relay REST API using the
 * `webhookRelayApi` credential. Returns the parsed JSON response.
 */
export async function webhookRelayApiRequest(
	this: RelayContext,
	method: IHttpRequestMethods,
	resource: string,
	body: IDataObject = {},
	qs: IDataObject = {},
): Promise<any> {
	const credentials = await this.getCredentials('webhookRelayApi');
	const baseUrl = ((credentials.baseUrl as string) || 'https://my.webhookrelay.com').replace(
		/\/+$/,
		'',
	);

	const options: IHttpRequestOptions = {
		method,
		url: `${baseUrl}${resource}`,
		qs,
		body,
		json: true,
	};

	if (Object.keys(qs).length === 0) delete options.qs;
	if (Object.keys(body).length === 0) delete options.body;

	try {
		return await this.helpers.httpRequestWithAuthentication.call(
			this,
			'webhookRelayApi',
			options,
		);
	} catch (error) {
		throw new NodeApiError(this.getNode(), error as JsonObject);
	}
}

/**
 * Find a bucket by account-unique name, or create it. Returns the bucket.
 * `created` reports whether it was created by this call (so we can clean it
 * up on deactivation only if we made it). Buckets are created with streaming
 * enabled so events can be received over the WebSocket.
 */
export async function ensureBucket(
	this: RelayContext,
	name: string,
	options: { auth?: IDataObject; stream?: boolean } = {},
): Promise<{ bucket: IDataObject; created: boolean }> {
	const buckets = (await webhookRelayApiRequest.call(this, 'GET', '/v1/buckets')) as IDataObject[];
	const existing = buckets.find((b) => b.name === name || b.id === name);
	if (existing) {
		// Keep bucket-level auth in sync with the node config.
		if (options.auth) {
			await webhookRelayApiRequest.call(this, 'PUT', `/v1/buckets/${existing.id}`, {
				name: existing.name,
				auth: options.auth,
			});
		}
		return { bucket: existing, created: false };
	}

	const body: IDataObject = { name };
	if (options.auth) body.auth = options.auth;
	if (options.stream !== undefined) body.stream = options.stream;
	const bucket = (await webhookRelayApiRequest.call(
		this,
		'POST',
		'/v1/buckets',
		body,
	)) as IDataObject;
	return { bucket, created: true };
}

/** Build a Webhook Relay bucket `auth` object from node parameters. */
export function buildAuth(
	authType: string,
	username?: string,
	password?: string,
	token?: string,
): IDataObject | undefined {
	if (authType === 'basic') {
		return { type: 'basic', username: username ?? '', password: password ?? '' };
	}
	if (authType === 'token') {
		return { type: 'token', token: token ?? '' };
	}
	return { type: 'none' };
}

/** The public URL a provider sends webhooks to for a given input. */
export function inputEndpointUrl(baseUrl: string, inputId: string): string {
	return `${baseUrl.replace(/\/+$/, '')}/v1/webhooks/${inputId}`;
}

/** Map the `webhookRelayApi` credential to the WebSocket auth key/secret. */
export function socketAuthFromCredentials(credentials: IDataObject): SocketAuth {
	if (credentials.authType === 'token') {
		return {
			key: credentials.tokenKey as string,
			secret: credentials.tokenSecret as string,
		};
	}
	return { key: API_KEY_SOCKET_KEY, secret: credentials.apiKey as string };
}

/** Shape a streamed Webhook Relay event into an n8n item. */
export function formatWebhookEvent(event: WebhookRelayEvent): IDataObject {
	let body: unknown = event.body;
	if (typeof event.body === 'string' && event.body.length > 0) {
		try {
			body = JSON.parse(event.body);
		} catch {
			body = event.body; // not JSON — keep the raw string
		}
	}

	const query: IDataObject = {};
	if (event.query) {
		for (const pair of event.query.split('&')) {
			if (pair === '') continue;
			const eq = pair.indexOf('=');
			const key = decodeURIComponent(eq >= 0 ? pair.slice(0, eq) : pair);
			query[key] = eq >= 0 ? decodeURIComponent(pair.slice(eq + 1)) : '';
		}
	}

	return {
		meta: event.meta as IDataObject,
		headers: event.headers as IDataObject,
		query,
		body: body as IDataObject,
		method: event.method,
	};
}

/**
 * Open an outbound WebSocket subscription to a bucket and wire it into the
 * n8n trigger lifecycle. n8n opens the connection itself — no tunnel and no
 * relay agent — so the instance is never exposed to the internet.
 *
 * `onClose` runs on deactivation (after the socket is closed) to tear down any
 * resources the node provisioned.
 */
export async function startBucketSubscription(
	ctx: ITriggerFunctions,
	bucketId: string,
	onClose: () => Promise<void>,
): Promise<ITriggerResponse> {
	const credentials = await ctx.getCredentials('webhookRelayApi');
	const baseUrl = (credentials.baseUrl as string) || 'https://my.webhookrelay.com';
	const auth = socketAuthFromCredentials(credentials);

	let socket: WebhookRelaySocket | undefined;
	const start = (onFirst?: () => void) => {
		socket = new WebhookRelaySocket({
			baseUrl,
			auth,
			buckets: [bucketId],
			onWebhook: (event) => {
				ctx.emit([ctx.helpers.returnJsonArray([formatWebhookEvent(event)])]);
				onFirst?.();
			},
			onError: (err) => ctx.logger.error(`[Webhook Relay] socket error: ${err.message}`),
		});
		socket.start();
	};

	// In activated workflows, start streaming immediately. In manual ("listen
	// for test event") mode, n8n calls manualTriggerFunction instead.
	if (ctx.getMode() === 'trigger') start();

	return {
		closeFunction: async () => {
			socket?.close();
			await onClose();
		},
		manualTriggerFunction: async () => {
			await new Promise<void>((resolve) => start(resolve));
		},
	};
}
