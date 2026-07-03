import type {
	IDataObject,
	INodeType,
	INodeTypeDescription,
	ITriggerFunctions,
	ITriggerResponse,
} from 'n8n-workflow';
import { NodeConnectionTypes } from 'n8n-workflow';

import { ensureBucket, startBucketSubscription, webhookRelayApiRequest } from './GenericFunctions';

export class WebhookRelayEmailTrigger implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Webhook Relay Email Trigger',
		name: 'webhookRelayEmailTrigger',
		icon: 'file:webhookRelay.svg',
		group: ['trigger'],
		version: 1,
		subtitle: '=bucket: {{$parameter["bucket"]}}',
		description:
			'Receive inbound email as a workflow trigger through Webhook Relay over an outbound WebSocket — no public IP, tunnel or agent',
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
		properties: [
			{
				displayName:
					'On activation this node creates an inbound email address in Webhook Relay and opens an outbound WebSocket to receive parsed mail. n8n needs no public URL, tunnel or agent. The address is logged and shown in the Webhook Relay dashboard.',
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
		],
	};

	async trigger(this: ITriggerFunctions): Promise<ITriggerResponse> {
		const bucketName = this.getNodeParameter('bucket') as string;
		const allowedSendersRaw = this.getNodeParameter('allowedSenders', '') as string;
		const dropAttachments = this.getNodeParameter('dropAttachments', false) as boolean;

		const allowedSenders = allowedSendersRaw
			.split(',')
			.map((s) => s.trim().toLowerCase())
			.filter((s) => s !== '');

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

		const address = (input.email_address as string) ?? '(shown in the dashboard)';
		this.logger.info(`[Webhook Relay] Send email to: ${address} (bucket "${bucket.name}")`);

		// 3. Receive parsed mail over an outbound WebSocket; clean up on deactivation.
		const cleanup = async () => {
			try {
				await webhookRelayApiRequest.call(
					this,
					'DELETE',
					`/v1/buckets/${bucket.id}/service-connection-inputs/${input.id}`,
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
