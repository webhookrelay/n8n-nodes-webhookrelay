# n8n-nodes-webhookrelay

**Receive webhooks and inbound email in self-hosted n8n — no public IP, no port
forwarding, no router changes, and n8n never exposed to the internet.**

n8n community nodes for [Webhook Relay](https://webhookrelay.com). Webhook Relay
gives your provider a stable, public URL (or email address), verifies and answers
the sender for you, then forwards each event into n8n — so your instance can stay
on `localhost` or behind a firewall/NAT. Layer on **durable delivery** (retries
for up to 30 days with exponential backoff), **throttling**, **endpoint
authentication** and **custom responses**.

Because the connection into your network is **outbound-only**, your internal n8n
endpoint stays hidden and protected from direct internet exposure — the same
mechanism Webhook Relay uses to deliver webhooks to CI servers and internal
services [behind a firewall or NAT](https://webhookrelay.com/features/webhook-to-internal-server/).

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

n8n loads the package from `~/.n8n/custom` (mounted from `dist/`). Rebuild and
`docker compose restart` to reload changes.

### Keeping n8n private (recommended for real use)

The public surface is always Webhook Relay's input URL — never n8n. How events
reach n8n decides whether n8n is exposed:

- **Quick test:** the compose file starts n8n with `--tunnel`, which gives n8n a
  temporary public URL. Fine for a 60-second smoke test, but n8n's own docs mark
  tunnels as **development-only**.
- **Private / production:** run the outbound-only
  [Webhook Relay agent](https://webhookrelay.com/docs/) next to n8n and keep n8n
  on `localhost` (no tunnel, no exposed port). The agent connects
  **out** from your network and delivers each webhook to n8n locally, so n8n is
  never reachable from the internet — no public IP, no inbound ports.

## Compatibility

- n8n `>= 1.x` (verified on 2.x)
- Node.js `>= 18.10`

## Resources

- [Webhook Relay docs](https://webhookrelay.com/docs/)
- [Webhook Relay API reference](https://webhookrelay.com/docs/api/)
- [n8n community nodes](https://docs.n8n.io/integrations/community-nodes/)

## License

[MIT](LICENSE)
