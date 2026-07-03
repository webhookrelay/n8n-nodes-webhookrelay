---
name: n8n-local-testing
description: Spin up a local n8n in Docker to develop and test the Webhook Relay community nodes (n8n-nodes-webhookrelay). Use when you want to load the built nodes into a real n8n, configure the Webhook Relay credential, add the Webhook Relay Trigger / Email Trigger to a workflow, and receive real webhooks or email end-to-end. Triggers: "test the n8n nodes", "run n8n locally", "load n8n-nodes-webhookrelay", "n8n docker setup for webhookrelay".
metadata:
  type: reference
---

# Testing the Webhook Relay n8n nodes locally

A ready-to-run Docker setup that loads the built community nodes into a local
n8n. The nodes receive events over an **outbound WebSocket** that n8n opens
itself, so n8n needs no public URL — no tunnel, no port forwarding, no relay
agent. Only the editor (port 5678) is published, to localhost.

## Prerequisites

- Docker + Docker Compose
- A Webhook Relay account and an **API key** (`sk-…`) from
  https://my.webhookrelay.com/tokens
- Node.js ≥ 18 (to build the nodes)

## Steps

1. **Build the nodes** (compiles TypeScript → `dist/`, copies icons):

   ```bash
   npm install
   npm run build
   ```

2. **Start n8n** (mounts `dist/` and the runtime deps into n8n's
   custom-extensions folder — no `--tunnel`):

   ```bash
   cd docker
   docker compose up
   ```

   Open http://localhost:5678. On first run n8n asks you to create a local
   owner account (this is a throwaway test instance).

3. **Add the credential**: in any workflow, add a **Webhook Relay Trigger**
   node → *Credential → Set up credential* → paste your API key → **Save**.
   The credential's *Test* button hits `GET /v1/buckets` to verify it.

4. **Add a trigger**: pick **Webhook Relay Trigger** (HTTP webhooks) or
   **Webhook Relay Email Trigger** (inbound email). Optionally set endpoint
   auth and the response, then **Save** and **Activate** the workflow.

5. **Get the public URL / address**: on activation the node provisions a
   bucket + input in Webhook Relay, opens the WebSocket, and logs the
   URL/address:

   ```bash
   docker compose logs -f | grep "Webhook Relay"
   # [Webhook Relay] Send webhooks to: https://my.webhookrelay.com/v1/webhooks/<id>
   ```

   The same URL/address is visible in the Webhook Relay dashboard. Send a
   request (or an email) to it and watch the workflow execute.

## How loading works

- The nodes have two runtime dependencies (`@webhookrelay/sdk` + `ws`), so the
  compose file mounts `node_modules` alongside `package.json`, `index.js` and
  `dist/`. `n8n-workflow` resolves to n8n's own copy.
- n8n's `CustomDirectoryLoader` globs `**/*.node.js` and `**/*.credentials.js`
  under `~/.n8n/custom`, which is where the compose file mounts the package.
- After changing node code, rebuild (`npm run build`) and restart the
  container (`docker compose restart`) to reload.

## Reset

```bash
cd docker
docker compose down -v   # -v also wipes the n8n database/volume
```

## Alternative: install from npm

Once `n8n-nodes-webhookrelay` is published, you can skip the mount and instead
install it through the n8n UI: **Settings → Community Nodes → Install →
`n8n-nodes-webhookrelay`**.
