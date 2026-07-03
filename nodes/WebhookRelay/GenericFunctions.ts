import type {
	IDataObject,
	IExecuteFunctions,
	IHookFunctions,
	IHttpRequestMethods,
	IHttpRequestOptions,
	ILoadOptionsFunctions,
	IWebhookFunctions,
	JsonObject,
} from 'n8n-workflow';
import { NodeApiError } from 'n8n-workflow';

type RelayContext =
	| IHookFunctions
	| IWebhookFunctions
	| ILoadOptionsFunctions
	| IExecuteFunctions;

/**
 * Make an authenticated request to the Webhook Relay API using the
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
 * up on deactivation only if we made it).
 */
export async function ensureBucket(
	this: IHookFunctions,
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

/** Build an output `durability` object (durable delivery). */
export function buildDurability(enabled: boolean, schedule?: string): IDataObject | undefined {
	if (!enabled) return undefined;
	const durability: IDataObject = { enabled: true };
	if (schedule) durability.schedule = schedule;
	return durability;
}

/** Build an output `throttle` object. */
export function buildThrottle(
	enabled: boolean,
	mode: string,
	rate: number,
	interval: string,
	maxConcurrent: number,
): IDataObject | undefined {
	if (!enabled) return undefined;
	const throttle: IDataObject = { enabled: true, mode };
	if (mode === 'rate') {
		throttle.rate = rate;
		throttle.interval = interval;
	} else if (mode === 'concurrency') {
		throttle.max_concurrent = maxConcurrent;
	}
	return throttle;
}

/** The public URL a provider sends webhooks to for a given input. */
export function inputEndpointUrl(baseUrl: string, inputId: string): string {
	return `${baseUrl.replace(/\/+$/, '')}/v1/webhooks/${inputId}`;
}
