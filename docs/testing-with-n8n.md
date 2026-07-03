# Using the Webhook Relay nodes in n8n

This walkthrough shows how to receive webhooks and inbound email in n8n through
[Webhook Relay](https://webhookrelay.com) — **without a public IP, without port
forwarding, and without exposing n8n to the internet**.

There are two trigger nodes:

| Node | Use it to… |
| --- | --- |
| **Webhook Relay Trigger** | Receive HTTP webhooks from any provider (Stripe, GitHub, Shopify, …) |
| **Webhook Relay Email Trigger** | Trigger a workflow from inbound **email** |

## How it works

Webhook Relay is the only public surface — n8n never is:

1. Your provider sends webhooks to a stable, public Webhook Relay **input URL**.
   Webhook Relay authenticates the caller (optional) and returns your configured
   **response** immediately.
2. On activation, the node **opens an outbound WebSocket** from n8n to Webhook
   Relay and subscribes to your bucket. Each event is pushed down that socket and
   emitted into your workflow.

```
Provider ──HTTP──► Webhook Relay input ──► bucket
                   (auth + response)         │
                        n8n ──outbound WebSocket──┘
```

Because n8n **connects out** and never listens for inbound requests, it can run
on `localhost` or behind a firewall/NAT with no public IP, no open ports, no
tunnel and no relay agent.

## 1. Install the nodes

**From npm (recommended):** in n8n go to **Settings → Community Nodes →
Install** and enter `n8n-nodes-webhookrelay`.

**For local development:** see [`skills/n8n-local-testing`](../skills/n8n-local-testing/SKILL.md)
for a Docker setup that loads the built nodes.

Both trigger nodes then appear in the node picker:

![Both Webhook Relay trigger nodes in the n8n node picker](images/01-node-list.png)

## 2. Add the Webhook Relay credential

Add a **Webhook Relay Trigger** node, then next to **Credential** choose *Set up
credential*. Paste an **API key** (`sk-…`) from
[my.webhookrelay.com/tokens](https://my.webhookrelay.com/tokens) and **Save**
(the *Test* button verifies it against the API). A classic token key/secret pair
is also supported.

![Webhook Relay credential setup with API key and base URL](images/05-credential.png)

## 3. Configure the trigger

![Webhook Relay Trigger parameters](images/02-trigger-config.png)

| Setting | What it does |
| --- | --- |
| **Bucket** | Webhook Relay bucket to use (created automatically). |
| **Endpoint Authentication** | `None`, `Basic Auth`, or `Token` — callers must authenticate to your public URL. |
| **Response Status Code / Body** | The response Webhook Relay returns to the sender immediately. |

Save and **Activate** the workflow. The node provisions the bucket and input,
opens the WebSocket, and logs the public URL (also shown in the Webhook Relay
dashboard):

```
[Webhook Relay] Send webhooks to: https://my.webhookrelay.com/v1/webhooks/<id> (bucket "n8n")
```

Send a request to that URL and the workflow runs — the event arrives over the
WebSocket n8n opened.

## 4. Triggering from email

The **Webhook Relay Email Trigger** works the same way but mints an inbound
**email address** instead of an HTTP endpoint. Mail sent to it is parsed and
delivered over the socket; restrict senders with **Allowed Senders**.

![Webhook Relay Email Trigger parameters](images/04-email-config.png)

On activation the address is logged and shown in the dashboard:

```
[Webhook Relay] Send email to: <id>@<your-inbound-domain> (bucket "n8n-email")
```

## Payload shape

Each execution item contains the received event:

```json
{
  "meta": { "bucket_name": "n8n", "input_id": "…" },
  "headers": { "content-type": ["application/json"], "user-agent": ["Stripe/1.0"] },
  "query": { "foo": "bar" },
  "body": { "id": "evt_123", "type": "payment_intent.succeeded" },
  "method": "POST"
}
```

`body` is parsed to an object when the payload is JSON, otherwise it is the raw
string. For the email trigger, `body` holds the parsed message (from, subject,
text, html, attachments).
