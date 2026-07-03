import type {
	IDataObject,
	INodeType,
	INodeTypeDescription,
	ITriggerFunctions,
	ITriggerResponse,
} from 'n8n-workflow';
import { NodeConnectionTypes } from 'n8n-workflow';

import {
	buildAuth,
	ensureBucket,
	inputEndpointUrl,
	startBucketSubscription,
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
					'On activation this node creates a Webhook Relay bucket and a public input, then opens an outbound WebSocket to receive events. n8n needs no public URL, tunnel or agent. The input URL is logged and shown in the Webhook Relay dashboard.',
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

		// 1. Bucket (with auth), streaming enabled.
		const { bucket, created } = await ensureBucket.call(this, bucketName, {
			auth,
			stream: true,
		});

		// 2. Public input endpoint with the sender-facing response.
		const inputBody: IDataObject = { name: 'n8n', status_code: responseStatusCode };
		if (responseBody !== '') inputBody.body = responseBody;
		const input = (await webhookRelayApiRequest.call(
			this,
			'POST',
			`/v1/buckets/${bucket.id}/inputs`,
			inputBody,
		)) as IDataObject;

		const credentials = await this.getCredentials('webhookRelayApi');
		const baseUrl = (credentials.baseUrl as string) || 'https://my.webhookrelay.com';
		const publicUrl = inputEndpointUrl(baseUrl, input.id as string);
		this.logger.info(
			`[Webhook Relay] Send webhooks to: ${publicUrl} (bucket "${bucket.name}")`,
		);

		// 3. Receive over an outbound WebSocket; tear the input (and bucket, if we
		//    created it) down on deactivation.
		const cleanup = async () => {
			try {
				await webhookRelayApiRequest.call(
					this,
					'DELETE',
					`/v1/buckets/${bucket.id}/inputs/${input.id}`,
				);
				if (created) {
					await webhookRelayApiRequest.call(
						this,
						'DELETE',
						`/v1/buckets/${bucket.id}`,
						{},
						{ force: 'true' },
					);
				}
			} catch {
				// best-effort cleanup
			}
		};

		return startBucketSubscription(this, bucket.id as string, cleanup);
	}
}
