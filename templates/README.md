# Workflow templates (for n8n.io)

Showcase workflows for submission to the [n8n template
library](https://n8n.io/workflows/). All are self-contained, documented with
sticky notes, and validated live in n8n 2.28. The webhook and base-email
templates use only **core n8n nodes** for the "do something" step (an **HTTP
Request** you point anywhere), so they activate with no extra credentials beyond
the Webhook Relay one; the Slack and Discord variants use those nodes instead.

| File | What it shows |
| --- | --- |
| [`webhook-receive-and-route.json`](webhook-receive-and-route.json) | Receive a webhook over the outbound socket → **normalize** → **Switch** routes by event type → **HTTP Request** forwards each type (unmatched events are dropped). |
| [`inbound-email-to-workflow.json`](inbound-email-to-workflow.json) | Receive inbound **email** → **parse** the fields → **IF** verifies DKIM (anti-spoofing) → **HTTP Request** forwards verified mail; unverified is flagged. |
| [`inbound-email-to-slack.json`](inbound-email-to-slack.json) | Receive inbound **email** → **parse** → **Post to Slack** — new mail lands as a tidy message in a Slack channel. |
| [`inbound-email-to-discord.json`](inbound-email-to-discord.json) | Receive inbound **email** → **parse** → **Post to Discord** (via a channel webhook). |

Both demonstrate the core value proposition: receiving webhooks / email in
**self-hosted n8n with no public IP, tunnel, or agent**, because n8n opens an
outbound WebSocket to Webhook Relay rather than listening for inbound traffic.

## Try them locally

Import into n8n (**Workflows → ⋯ → Import from File**), then:

1. Open the trigger node and select/create your **Webhook Relay API** credential.
2. Open the trigger's **Public URL** / **Email Address** field to load the
   endpoint, and point the **HTTP Request** node(s) at your own destination
   (a Slack/Discord incoming webhook, or any API).
3. **Activate** the workflow.

## Submitting to n8n.io

The public library is at <https://n8n.io/workflows/>; submissions go through the
[n8n Creator hub](https://n8n.io/creators/).

1. Import the JSON into your n8n, connect a real credential, and confirm it runs.
2. Select everything on the canvas and **copy** (or export as JSON).
3. In the Creator hub, paste it into the **Template Code** box, add a title +
   description, tick the guidelines checkbox, and submit. Feedback arrives by
   email in a few hours/days.

The templates already follow n8n's submission guidelines: a top-left overview
sticky (who it's for / what it does / how it works / setup), section sticky
notes grouping each stage, and descriptively named nodes.

> **Note:** these use the `n8n-nodes-webhookrelay` community node as the trigger,
> so they're aimed at self-hosted users (who can install community nodes). Once
> the package is a **verified** community node, templates using it reach a wider
> audience.
