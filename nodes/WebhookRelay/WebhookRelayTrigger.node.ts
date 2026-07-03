import type {
	IDataObject,
	IHookFunctions,
	INodeType,
	INodeTypeDescription,
	IWebhookFunctions,
	IWebhookResponseData,
} from 'n8n-workflow';
import { NodeConnectionTypes } from 'n8n-workflow';

import {
	buildAuth,
	buildDurability,
	buildThrottle,
	ensureBucket,
	inputEndpointUrl,
	webhookRelayApiRequest,
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
			'Receive webhooks through Webhook Relay with durable delivery, throttling, authentication and a custom response',
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
		webhooks: [
			{
				name: 'default',
				httpMethod: '={{$parameter["httpMethod"]}}',
				responseMode: 'onReceived',
				path: 'webhookrelay',
			},
		],
		properties: [
			{
				displayName:
					'On activation this node creates a Webhook Relay bucket, a public input endpoint and an output that forwards to this workflow. The public URL you give to your provider is logged and shown in the Webhook Relay dashboard.',
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
				displayName: 'HTTP Method',
				name: 'httpMethod',
				type: 'options',
				options: [
					{ name: 'DELETE', value: 'DELETE' },
					{ name: 'GET', value: 'GET' },
					{ name: 'HEAD', value: 'HEAD' },
					{ name: 'PATCH', value: 'PATCH' },
					{ name: 'POST', value: 'POST' },
					{ name: 'PUT', value: 'PUT' },
				],
				default: 'POST',
				description: 'The HTTP method your provider uses to send webhooks',
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
			// --- Delivery reliability (output) -----------------------------------
			{
				displayName: 'Durable Delivery',
				name: 'durableDelivery',
				type: 'boolean',
				default: false,
				description:
					'Whether to persist and retry delivery to this workflow over a long window if it is temporarily unavailable',
			},
			{
				displayName: 'Retry Schedule',
				name: 'durabilitySchedule',
				type: 'options',
				options: [
					{ name: 'Seconds', value: 'seconds', description: 'Fast retries over ~25 minutes total' },
					{ name: 'Medium', value: 'medium', description: 'Retries spread over ~16 hours total' },
					{ name: 'Long', value: 'long', description: 'Retries spread over ~30 days total' },
				],
				default: 'long',
				displayOptions: { show: { durableDelivery: [true] } },
				description: 'Backoff preset used for durable retries',
			},
			{
				displayName: 'Throttle',
				name: 'throttleEnabled',
				type: 'boolean',
				default: false,
				description: 'Whether to limit how fast webhooks are delivered to this workflow',
			},
			{
				displayName: 'Throttle Mode',
				name: 'throttleMode',
				type: 'options',
				options: [
					{ name: 'Rate', value: 'rate', description: 'Cap events delivered per interval' },
					{ name: 'Concurrency', value: 'concurrency', description: 'Cap the number of in-flight deliveries' },
				],
				default: 'rate',
				displayOptions: { show: { throttleEnabled: [true] } },
			},
			{
				displayName: 'Rate',
				name: 'throttleRate',
				type: 'number',
				default: 10,
				displayOptions: { show: { throttleEnabled: [true], throttleMode: ['rate'] } },
				description: 'Maximum number of webhooks delivered per interval',
			},
			{
				displayName: 'Interval',
				name: 'throttleInterval',
				type: 'options',
				options: [
					{ name: 'Second', value: 'second' },
					{ name: 'Minute', value: 'minute' },
					{ name: 'Hour', value: 'hour' },
				],
				default: 'minute',
				displayOptions: { show: { throttleEnabled: [true], throttleMode: ['rate'] } },
			},
			{
				displayName: 'Max Concurrent',
				name: 'throttleMaxConcurrent',
				type: 'number',
				default: 1,
				displayOptions: { show: { throttleEnabled: [true], throttleMode: ['concurrency'] } },
				description: 'Maximum number of in-flight deliveries (1 = serial)',
			},
		],
	};

	webhookMethods = {
		default: {
			async checkExists(this: IHookFunctions): Promise<boolean> {
				const webhookData = this.getWorkflowStaticData('node');
				if (!webhookData.outputId || !webhookData.bucketId) {
					return false;
				}
				try {
					const bucket = (await webhookRelayApiRequest.call(
						this,
						'GET',
						`/v1/buckets/${webhookData.bucketId}`,
					)) as IDataObject;
					const outputs = (bucket.outputs as IDataObject[]) ?? [];
					return outputs.some((o) => o.id === webhookData.outputId);
				} catch (error) {
					return false;
				}
			},

			async create(this: IHookFunctions): Promise<boolean> {
				const webhookUrl = this.getNodeWebhookUrl('default') as string;
				const bucketName = this.getNodeParameter('bucket') as string;
				const httpMethod = this.getNodeParameter('httpMethod') as string;

				const authentication = this.getNodeParameter('authentication') as string;
				const auth = buildAuth(
					authentication,
					this.getNodeParameter('username', '') as string,
					this.getNodeParameter('password', '') as string,
					this.getNodeParameter('token', '') as string,
				);

				const responseStatusCode = this.getNodeParameter('responseStatusCode', 200) as number;
				const responseBody = this.getNodeParameter('responseBody', '') as string;

				const durability = buildDurability(
					this.getNodeParameter('durableDelivery', false) as boolean,
					this.getNodeParameter('durabilitySchedule', 'long') as string,
				);
				const throttle = buildThrottle(
					this.getNodeParameter('throttleEnabled', false) as boolean,
					this.getNodeParameter('throttleMode', 'rate') as string,
					this.getNodeParameter('throttleRate', 10) as number,
					this.getNodeParameter('throttleInterval', 'minute') as string,
					this.getNodeParameter('throttleMaxConcurrent', 1) as number,
				);

				// 1. Bucket (with auth), streaming enabled.
				const { bucket, created } = await ensureBucket.call(this, bucketName, {
					auth,
					stream: true,
				});

				// 2. Public input endpoint with the sender-facing response.
				const inputBody: IDataObject = {
					name: 'n8n',
					status_code: responseStatusCode,
				};
				if (responseBody !== '') inputBody.body = responseBody;
				const input = (await webhookRelayApiRequest.call(
					this,
					'POST',
					`/v1/buckets/${bucket.id}/inputs`,
					inputBody,
				)) as IDataObject;

				// 3. Output that forwards to this workflow (durable + throttled).
				const outputBody: IDataObject = {
					name: 'n8n',
					destination: webhookUrl,
				};
				if (durability) outputBody.durability = durability;
				if (throttle) outputBody.throttle = throttle;
				const output = (await webhookRelayApiRequest.call(
					this,
					'POST',
					`/v1/buckets/${bucket.id}/outputs`,
					outputBody,
				)) as IDataObject;

				const credentials = await this.getCredentials('webhookRelayApi');
				const baseUrl = (credentials.baseUrl as string) || 'https://my.webhookrelay.com';
				const publicUrl = inputEndpointUrl(baseUrl, input.id as string);

				this.logger.info(
					`[Webhook Relay] Send ${httpMethod} webhooks to: ${publicUrl} (bucket "${bucket.name}")`,
				);

				const webhookData = this.getWorkflowStaticData('node');
				webhookData.bucketId = bucket.id;
				webhookData.bucketCreated = created;
				webhookData.inputId = input.id;
				webhookData.outputId = output.id;
				webhookData.publicUrl = publicUrl;
				return true;
			},

			async delete(this: IHookFunctions): Promise<boolean> {
				const webhookData = this.getWorkflowStaticData('node');
				const { bucketId, inputId, outputId, bucketCreated } = webhookData as {
					bucketId?: string;
					inputId?: string;
					outputId?: string;
					bucketCreated?: boolean;
				};

				try {
					if (bucketId && outputId) {
						await webhookRelayApiRequest.call(
							this,
							'DELETE',
							`/v1/buckets/${bucketId}/outputs/${outputId}`,
						);
					}
					if (bucketId && inputId) {
						await webhookRelayApiRequest.call(
							this,
							'DELETE',
							`/v1/buckets/${bucketId}/inputs/${inputId}`,
						);
					}
					// Only remove the bucket if this node created it.
					if (bucketId && bucketCreated) {
						await webhookRelayApiRequest.call(
							this,
							'DELETE',
							`/v1/buckets/${bucketId}`,
							{},
							{ force: 'true' },
						);
					}
				} catch (error) {
					return false;
				}

				delete webhookData.bucketId;
				delete webhookData.bucketCreated;
				delete webhookData.inputId;
				delete webhookData.outputId;
				delete webhookData.publicUrl;
				return true;
			},
		},
	};

	async webhook(this: IWebhookFunctions): Promise<IWebhookResponseData> {
		const req = this.getRequestObject();
		const body = this.getBodyData();
		const headers = this.getHeaderData();
		const query = this.getQueryData();

		return {
			workflowData: [
				this.helpers.returnJsonArray({
					headers,
					params: req.params,
					query,
					body,
				}),
			],
		};
	}
}
