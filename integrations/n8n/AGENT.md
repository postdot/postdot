# Postdot n8n node

- This is a standalone Node.js/CommonJS client package with its own npm lockfile. Keep it outside the Bun application workspaces and the publishing server's dependency graph.
- Use the official n8n node toolchain and declarative REST routing. Postdot remains responsible for permissions, source adaptation, validation and durable publication state.
- Create Draft must remain unscheduled. Do not infer provider delivery or content compatibility from HTTP success, and do not add automatic write retries without a server idempotency contract.
- Credentials belong in n8n's encrypted credential store. Examples and archives contain no real keys, instance addresses or resource IDs.
- Validate routing changes in a real isolated n8n instance against isolated Postdot data, including refusals and uncertain writes. Type checks alone cannot prove n8n expression or output behavior.
- Preserve the repository's AGPL license. Package publication and a different licensing or n8n verification commitment require an explicit owner decision.
