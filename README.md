# n8n-nodes-webhookrelay

n8n community nodes for [Webhook Relay](https://webhookrelay.com) — receive
webhooks and inbound email in n8n with **durable delivery**, **throttling**,
**endpoint authentication** and **custom responses**.

[Webhook Relay](https://webhookrelay.com) sits in front of your workflow as a
managed front door: it answers the sender immediately with your configured
response, then delivers each event to n8n out of band — persisting and retrying
for days if your workflow is briefly down, and throttling bursts so it isn't
overwhelmed.

## Nodes

| Node | Description |
| --- | --- |
| **Webhook Relay Trigger** | Receive HTTP webhooks (Stripe, GitHub, Shopify, …) with durable delivery, throttling, auth and a custom response. |
| **Webhook Relay Email Trigger** | Trigger a workflow from inbound **email** sent to a generated address. |

![Both Webhook Relay trigger nodes in the n8n node picker](docs/images/01-node-list.png)

## Installation

In n8n: **Settings → Community Nodes → Install** and enter:

```
n8n-nodes-webhookrelay
```

Or install manually in a self-hosted instance:

```bash
npm install n8n-nodes-webhookrelay
```

## Credentials

Create an **API key** (`sk-…`) at
[my.webhookrelay.com/tokens](https://my.webhookrelay.com/tokens) and add it as a
**Webhook Relay API** credential (a classic token key/secret pair also works).

## Usage

Add a **Webhook Relay Trigger**, pick a bucket, set the endpoint authentication
and response, toggle **Durable Delivery** and **Throttle** as needed, then
activate the workflow. Webhook Relay provisions the endpoint and the public URL
is logged and shown in the dashboard.

![Trigger with durable delivery and throttling enabled](docs/images/03-trigger-config-full.png)

See the full walkthrough with screenshots in
**[docs/testing-with-n8n.md](docs/testing-with-n8n.md)**.

## Local development

```bash
npm install
npm run build          # tsc + copy icons → dist/
```

Then load the built nodes into a local n8n with the Docker setup in
[`docker/`](docker/docker-compose.yml) (see the
[`n8n-local-testing` skill](skills/n8n-local-testing/SKILL.md)):

```bash
cd docker && docker compose up
# open http://localhost:5678
```

n8n loads the package from `~/.n8n/custom` (mounted from `dist/`) and runs with
`--tunnel` so Webhook Relay's cloud can forward real events to your machine.
Rebuild and `docker compose restart` to reload changes.

## Compatibility

- n8n `>= 1.x` (verified on 2.x)
- Node.js `>= 18.10`

## Resources

- [Webhook Relay docs](https://webhookrelay.com/docs/)
- [Webhook Relay API reference](https://webhookrelay.com/docs/api/)
- [n8n community nodes](https://docs.n8n.io/integrations/community-nodes/)

## License

[MIT](LICENSE)
