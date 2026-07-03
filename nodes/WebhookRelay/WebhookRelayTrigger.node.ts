import type {
	ILoadOptionsFunctions,
	INodePropertyOptions,
	INodeType,
	INodeTypeDescription,
	ITriggerFunctions,
	ITriggerResponse,
} from 'n8n-workflow';
import { NodeConnectionTypes } from 'n8n-workflow';

import {
	buildAuth,
	ensureBucket,
	ensureInput,
	inputEndpointUrl,
	startBucketSubscription,
} from './GenericFunctions';

export class WebhookRelayTrigger implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Webhook Relay Trigger',
		name: 'webhookRelayTrigger',
		icon: 'file:webhookRelay.svg',
		group: ['trigger'],
		version: 1,
		subtitle: '=bucket: {{$parameter["bucket"]}}',
		description:
			'Receive webhooks through Webhook Relay over an outbound WebSocket — no public IP, tunnel or agent, and n8n is never exposed',
		defaults: {
			name: 'Webhook Relay Trigger',
		},
		inputs: [],
		outputs: [NodeConnectionTypes.Main],
		credentials: [
			{
				name: 'webhookRelayApi',
				required: true,
			},
		],
		properties: [
			{
				displayName:
					'On activation this node creates the Webhook Relay bucket and input if they do not exist (and reuses them otherwise), then opens an outbound WebSocket to receive events. Deactivating only closes the socket — nothing is deleted. n8n needs no public URL, tunnel or agent; the input URL is logged and shown in the dashboard.',
				name: 'notice',
				type: 'notice',
				default: '',
			},
			{
				displayName: 'Bucket',
				name: 'bucket',
				type: 'string',
				default: 'n8n',
				required: true,
				description:
					'Webhook Relay bucket (by name). Created automatically if it does not exist.',
			},
			{
				// A read-only display of the generated URL, not a resource picker, so
				// the "dynamic options" naming/description rules don't apply here.
				// eslint-disable-next-line n8n-nodes-base/node-param-display-name-wrong-for-dynamic-options
				displayName: 'Public URL',
				name: 'publicUrl',
				type: 'options',
				typeOptions: { loadOptionsMethod: 'getWebhookUrl' },
				default: '',
				// eslint-disable-next-line n8n-nodes-base/node-param-description-wrong-for-dynamic-options
				description:
					'The public URL to give your webhook provider. Open this dropdown (or click the refresh icon) to load it — the bucket and input are created if needed. Requires a valid credential and bucket name. Also logged on activation and shown in the Webhook Relay dashboard.',
			},
			// --- Endpoint authentication (bucket-level) --------------------------
			{
				displayName: 'Endpoint Authentication',
				name: 'authentication',
				type: 'options',
				options: [
					{ name: 'None', value: 'none' },
					{ name: 'Basic Auth', value: 'basic' },
					{ name: 'Token (Header)', value: 'token' },
				],
				default: 'none',
				description:
					'Require callers to authenticate to the public input endpoint. Applied to the bucket.',
			},
			{
				displayName: 'Username',
				name: 'username',
				type: 'string',
				default: '',
				displayOptions: { show: { authentication: ['basic'] } },
			},
			{
				displayName: 'Password',
				name: 'password',
				type: 'string',
				typeOptions: { password: true },
				default: '',
				displayOptions: { show: { authentication: ['basic'] } },
			},
			{
				displayName: 'Token',
				name: 'token',
				type: 'string',
				typeOptions: { password: true },
				default: '',
				displayOptions: { show: { authentication: ['token'] } },
				description: 'Callers must send this token in the Authorization header',
			},
			// --- Response returned to the sender (input) -------------------------
			{
				displayName: 'Response Status Code',
				name: 'responseStatusCode',
				type: 'number',
				default: 200,
				description: 'Status code Webhook Relay returns to the sender immediately',
			},
			{
				displayName: 'Response Body',
				name: 'responseBody',
				type: 'string',
				default: '',
				description:
					'Static body Webhook Relay returns to the sender. Any text, JSON or XML (max 250KB).',
			},
		],
	};

	methods = {
		loadOptions: {
			// Resolve (and display) the public URL to give the provider. Read/create
			// only — never re-syncs an existing bucket's auth, so opening the panel
			// can't clobber configuration.
			async getWebhookUrl(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
				const bucketName = this.getNodeParameter('bucket', '') as string;
				if (!bucketName) {
					// eslint-disable-next-line n8n-nodes-base/node-param-display-name-miscased
					return [{ name: 'Enter a bucket name to generate the URL', value: '' }];
				}

				const authentication = this.getNodeParameter('authentication', 'none') as string;
				const auth = buildAuth(
					authentication,
					this.getNodeParameter('username', '') as string,
					this.getNodeParameter('password', '') as string,
					this.getNodeParameter('token', '') as string,
				);
				const responseStatusCode = this.getNodeParameter('responseStatusCode', 200) as number;
				const responseBody = this.getNodeParameter('responseBody', '') as string;

				const { bucket } = await ensureBucket.call(this, bucketName, {
					auth,
					stream: true,
					syncExisting: false,
				});
				const input = await ensureInput.call(this, bucket.id as string, 'n8n', {
					statusCode: responseStatusCode,
					body: responseBody,
				});

				const credentials = await this.getCredentials('webhookRelayApi');
				const baseUrl = (credentials.baseUrl as string) || 'https://my.webhookrelay.com';
				const url = inputEndpointUrl(baseUrl, input.id as string);
				return [{ name: url, value: url }];
			},
		},
	};

	async trigger(this: ITriggerFunctions): Promise<ITriggerResponse> {
		const bucketName = this.getNodeParameter('bucket') as string;
		const authentication = this.getNodeParameter('authentication') as string;
		const auth = buildAuth(
			authentication,
			this.getNodeParameter('username', '') as string,
			this.getNodeParameter('password', '') as string,
			this.getNodeParameter('token', '') as string,
		);
		const responseStatusCode = this.getNodeParameter('responseStatusCode', 200) as number;
		const responseBody = this.getNodeParameter('responseBody', '') as string;

		// 1. Bucket (with auth), streaming enabled. Created if missing, reused if
		//    it already exists — never deleted.
		const { bucket } = await ensureBucket.call(this, bucketName, {
			auth,
			stream: true,
		});

		// 2. Public input endpoint with the sender-facing response. Find-or-create
		//    so the URL stays stable across re-activations.
		const input = await ensureInput.call(this, bucket.id as string, 'n8n', {
			statusCode: responseStatusCode,
			body: responseBody,
		});

		const credentials = await this.getCredentials('webhookRelayApi');
		const baseUrl = (credentials.baseUrl as string) || 'https://my.webhookrelay.com';
		const publicUrl = inputEndpointUrl(baseUrl, input.id as string);
		this.logger.info(
			`[Webhook Relay] Send webhooks to: ${publicUrl} (bucket "${bucket.name}")`,
		);

		// 3. Receive over an outbound WebSocket. On deactivation only the socket is
		//    closed — the bucket and input are left in place.
		return startBucketSubscription(this, bucket.id as string);
	}
}
