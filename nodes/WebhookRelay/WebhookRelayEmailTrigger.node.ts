import type {
	IDataObject,
	ILoadOptionsFunctions,
	INodePropertyOptions,
	INodeType,
	INodeTypeDescription,
	ITriggerFunctions,
	ITriggerResponse,
} from 'n8n-workflow';
import { NodeConnectionTypes } from 'n8n-workflow';

import {
	ensureBucket,
	ensureEmailInput,
	ensureOutput,
	startBucketSubscription,
} from './GenericFunctions';

/** Name used for both our email input and our internal output on the bucket. */
const RESOURCE_NAME = 'n8n-email';
/** Internal (localhost) output destination — never HTTP-forwarded; we consume it over the socket. */
const OUTPUT_DESTINATION = 'http://localhost';

/** Build the email service-connection-input payload from node parameters. */
function buildEmailInput(allowedSenders: string[], dropAttachments: boolean): IDataObject {
	const emailInput: IDataObject = { enabled: true };
	if (allowedSenders.length > 0) emailInput.allowed_senders = allowedSenders;
	if (dropAttachments) emailInput.drop_attachments = true;
	return emailInput;
}

/** Parse the comma-separated Allowed Senders parameter into a normalized list. */
function parseAllowedSenders(raw: string): string[] {
	return raw
		.split(',')
		.map((s) => s.trim().toLowerCase())
		.filter((s) => s !== '');
}

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
					'On activation this node creates an inbound email address and an internal output (destination http://localhost) in Webhook Relay if they do not exist — and reuses them otherwise — then opens an outbound WebSocket scoped to that output. Tune per-output options like throttling on the output in the Webhook Relay dashboard; the node never overwrites them. Deactivating only closes the socket — nothing is deleted. n8n needs no public URL, tunnel or agent.',
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
				// A read-only display of the generated address, not a resource picker,
				// so the "dynamic options" naming/description rules don't apply here.
				// eslint-disable-next-line n8n-nodes-base/node-param-display-name-wrong-for-dynamic-options
				displayName: 'Email Address',
				name: 'emailAddress',
				type: 'options',
				typeOptions: { loadOptionsMethod: 'getEmailAddress' },
				default: '',
				// eslint-disable-next-line n8n-nodes-base/node-param-description-wrong-for-dynamic-options
				description:
					'The inbound email address to send mail to. Open this dropdown (or click the refresh icon) to load it — the address is created if needed. Requires a valid credential and bucket name. Also logged on activation and shown in the Webhook Relay dashboard.',
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

	methods = {
		loadOptions: {
			// Resolve (and display) the inbound email address. Read/create only.
			async getEmailAddress(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
				const bucketName = this.getNodeParameter('bucket', '') as string;
				if (!bucketName) {
					// eslint-disable-next-line n8n-nodes-base/node-param-display-name-miscased
					return [{ name: 'Enter a bucket name to generate the address', value: '' }];
				}
				const allowedSenders = parseAllowedSenders(
					this.getNodeParameter('allowedSenders', '') as string,
				);
				const dropAttachments = this.getNodeParameter('dropAttachments', false) as boolean;

				const { bucket } = await ensureBucket.call(this, bucketName, {
					stream: true,
					syncExisting: false,
				});
				const input = await ensureEmailInput.call(
					this,
					bucket.id as string,
					RESOURCE_NAME,
					buildEmailInput(allowedSenders, dropAttachments),
				);
				const address = (input.email_address as string) ?? '';
				return [
					{ name: address || 'Address created — see the Webhook Relay dashboard', value: address },
				];
			},
		},
	};

	async trigger(this: ITriggerFunctions): Promise<ITriggerResponse> {
		const bucketName = this.getNodeParameter('bucket') as string;
		const allowedSenders = parseAllowedSenders(
			this.getNodeParameter('allowedSenders', '') as string,
		);
		const dropAttachments = this.getNodeParameter('dropAttachments', false) as boolean;

		// 1. Bucket, streaming enabled. Created if missing, reused otherwise —
		//    never deleted.
		const { bucket } = await ensureBucket.call(this, bucketName, { stream: true });

		// 2. Email service-connection input (an inbound address). Find-or-create so
		//    the address stays stable across re-activations.
		const input = await ensureEmailInput.call(
			this,
			bucket.id as string,
			RESOURCE_NAME,
			buildEmailInput(allowedSenders, dropAttachments),
		);

		// 3. Internal output we subscribe to. Inbound email fans out to the
		//    bucket's outputs just like a webhook, so scoping to our own output
		//    isolates us from any other outputs and lets per-output config apply.
		//    Find-or-create and never touched on reuse.
		await ensureOutput.call(this, bucket.id as string, RESOURCE_NAME, OUTPUT_DESTINATION);

		const address = (input.email_address as string) ?? '(shown in the dashboard)';
		this.logger.info(`[Webhook Relay] Send email to: ${address} (bucket "${bucket.name}")`);

		// 4. Receive parsed mail over an outbound WebSocket, scoped to our output.
		//    On deactivation only the socket is closed — nothing is deleted.
		return startBucketSubscription(this, bucket.id as string, RESOURCE_NAME);
	}
}
