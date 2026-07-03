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
	buildDurability,
	buildThrottle,
	ensureBucket,
	webhookRelayApiRequest,
} from './GenericFunctions';

export class WebhookRelayEmailTrigger implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Webhook Relay Email Trigger',
		name: 'webhookRelayEmailTrigger',
		icon: 'file:webhookRelay.svg',
		group: ['trigger'],
		version: 1,
		subtitle: '=bucket: {{$parameter["bucket"]}}',
		description:
			'Receive inbound email as a workflow trigger through Webhook Relay. Mail sent to the generated address is parsed and delivered here.',
		defaults: {
			name: 'Webhook Relay Email Trigger',
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
				httpMethod: 'POST',
				responseMode: 'onReceived',
				path: 'webhookrelay-email',
			},
		],
		properties: [
			{
				displayName:
					'On activation this node creates an inbound email address in Webhook Relay and forwards parsed mail to this workflow. The address is logged and shown in the Webhook Relay dashboard.',
				name: 'notice',
				type: 'notice',
				default: '',
			},
			{
				displayName: 'Bucket',
				name: 'bucket',
				type: 'string',
				default: 'n8n-email',
				required: true,
				description:
					'Webhook Relay bucket (by name). Created automatically if it does not exist.',
			},
			{
				displayName: 'Allowed Senders',
				name: 'allowedSenders',
				type: 'string',
				default: '',
				placeholder: 'alerts@example.com, ops@example.com',
				description:
					'Comma-separated list of From addresses to accept. Leave empty to accept mail from any sender.',
			},
			{
				displayName: 'Drop Attachments',
				name: 'dropAttachments',
				type: 'boolean',
				default: false,
				description: 'Whether to skip parsing and storing attachments',
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
			},
			{
				displayName: 'Throttle',
				name: 'throttleEnabled',
				type: 'boolean',
				default: false,
				description: 'Whether to limit how fast emails are delivered to this workflow',
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
			},
		],
	};

	webhookMethods = {
		default: {
			async checkExists(this: IHookFunctions): Promise<boolean> {
				const webhookData = this.getWorkflowStaticData('node');
				return Boolean(webhookData.outputId && webhookData.inputId);
			},

			async create(this: IHookFunctions): Promise<boolean> {
				const webhookUrl = this.getNodeWebhookUrl('default') as string;
				const bucketName = this.getNodeParameter('bucket') as string;
				const allowedSendersRaw = this.getNodeParameter('allowedSenders', '') as string;
				const dropAttachments = this.getNodeParameter('dropAttachments', false) as boolean;

				const allowedSenders = allowedSendersRaw
					.split(',')
					.map((s) => s.trim().toLowerCase())
					.filter((s) => s !== '');

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

				// 1. Bucket, streaming enabled.
				const { bucket, created } = await ensureBucket.call(this, bucketName, { stream: true });

				// 2. Email service-connection input (mints an inbound address).
				const emailInput: IDataObject = { enabled: true };
				if (allowedSenders.length > 0) emailInput.allowed_senders = allowedSenders;
				if (dropAttachments) emailInput.drop_attachments = true;
				const input = (await webhookRelayApiRequest.call(
					this,
					'POST',
					`/v1/buckets/${bucket.id}/service-connection-inputs`,
					{
						name: 'n8n-email',
						service_connection_input_type: 'email',
						email_input: emailInput,
					},
				)) as IDataObject;

				// 3. Output that forwards parsed mail to this workflow.
				const outputBody: IDataObject = { name: 'n8n', destination: webhookUrl };
				if (durability) outputBody.durability = durability;
				if (throttle) outputBody.throttle = throttle;
				const output = (await webhookRelayApiRequest.call(
					this,
					'POST',
					`/v1/buckets/${bucket.id}/outputs`,
					outputBody,
				)) as IDataObject;

				const address = (input.email_address as string) ?? '(shown in the dashboard)';
				this.logger.info(
					`[Webhook Relay] Send email to: ${address} (bucket "${bucket.name}")`,
				);

				const webhookData = this.getWorkflowStaticData('node');
				webhookData.bucketId = bucket.id;
				webhookData.bucketCreated = created;
				webhookData.inputId = input.id;
				webhookData.outputId = output.id;
				webhookData.emailAddress = address;
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
							`/v1/buckets/${bucketId}/service-connection-inputs/${inputId}`,
						);
					}
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
				delete webhookData.emailAddress;
				return true;
			},
		},
	};

	async webhook(this: IWebhookFunctions): Promise<IWebhookResponseData> {
		const body = this.getBodyData();
		const headers = this.getHeaderData();

		return {
			workflowData: [
				this.helpers.returnJsonArray({
					headers,
					body,
				}),
			],
		};
	}
}
