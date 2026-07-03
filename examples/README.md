# Example workflows

Import these into n8n (**Workflows → ⋯ → Import from File**), then open the
trigger node and select/create your **Webhook Relay** credential before
activating.

| File | What it shows |
| --- | --- |
| [`webhook-durable-throttled.json`](webhook-durable-throttled.json) | HTTP webhook with **token auth**, a `200 {"ok":true}` response, **durable delivery** (long retry) and **throttling** (10/min), feeding an Edit Fields node. |
| [`email-to-workflow.json`](email-to-workflow.json) | Inbound **email** trigger restricted to a sender, with durable delivery, extracting from/subject/text. |

On activation each trigger provisions its bucket, input and output in Webhook
Relay and logs the public URL / email address to use. See
[../docs/testing-with-n8n.md](../docs/testing-with-n8n.md) for the full
walkthrough.
