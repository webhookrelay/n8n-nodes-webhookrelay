# Example workflows

Import these into n8n (**Workflows → ⋯ → Import from File**), then open the
trigger node and select/create your **Webhook Relay** credential before
activating.

| File | What it shows |
| --- | --- |
| [`webhook-to-workflow.json`](webhook-to-workflow.json) | HTTP webhook with **token auth** and a `200 {"ok":true}` response, feeding an Edit Fields node. |
| [`email-to-workflow.json`](email-to-workflow.json) | Inbound **email** trigger restricted to a sender, extracting from/subject/text. |

On activation each trigger provisions its bucket and input in Webhook Relay,
opens an outbound WebSocket, and logs the public URL / email address to use. See
[../docs/testing-with-n8n.md](../docs/testing-with-n8n.md) for the full
walkthrough.
