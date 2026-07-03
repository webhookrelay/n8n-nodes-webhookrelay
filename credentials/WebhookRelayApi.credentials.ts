import type {
	IAuthenticateGeneric,
	ICredentialTestRequest,
	ICredentialType,
	INodeProperties,
} from 'n8n-workflow';

export class WebhookRelayApi implements ICredentialType {
	name = 'webhookRelayApi';

	displayName = 'Webhook Relay API';

	documentationUrl = 'https://webhookrelay.com/docs/api/';

	properties: INodeProperties[] = [
		{
			displayName: 'Authentication',
			name: 'authType',
			type: 'options',
			options: [
				{
					name: 'API Key',
					value: 'apiKey',
					description: 'A single account API key (starts with "sk-")',
				},
				{
					name: 'Access Token (Key & Secret)',
					value: 'token',
					description: 'A classic access token pair',
				},
			],
			default: 'apiKey',
		},
		{
			displayName: 'API Key',
			name: 'apiKey',
			type: 'string',
			typeOptions: { password: true },
			default: '',
			required: true,
			displayOptions: { show: { authType: ['apiKey'] } },
			description: 'Account API key. Create one at https://my.webhookrelay.com/tokens',
		},
		{
			displayName: 'Token Key',
			name: 'tokenKey',
			type: 'string',
			typeOptions: { password: true },
			default: '',
			required: true,
			displayOptions: { show: { authType: ['token'] } },
		},
		{
			displayName: 'Token Secret',
			name: 'tokenSecret',
			type: 'string',
			typeOptions: { password: true },
			default: '',
			required: true,
			displayOptions: { show: { authType: ['token'] } },
		},
		{
			displayName: 'Base URL',
			name: 'baseUrl',
			type: 'string',
			default: 'https://my.webhookrelay.com',
			description: 'Override only for self-hosted / dedicated Webhook Relay deployments',
		},
	];

	// Applied automatically to every request made with this credential.
	authenticate: IAuthenticateGeneric = {
		type: 'generic',
		properties: {
			headers: {
				Authorization:
					'={{ $credentials.authType === "apiKey" ? "Bearer " + $credentials.apiKey : "Basic " + Buffer.from($credentials.tokenKey + ":" + $credentials.tokenSecret).toString("base64") }}',
			},
		},
	};

	// "Test" button in the credential UI: a cheap authenticated GET.
	test: ICredentialTestRequest = {
		request: {
			baseURL: '={{$credentials.baseUrl}}',
			url: '/v1/buckets',
			method: 'GET',
		},
	};
}
