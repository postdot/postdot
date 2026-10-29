# Postdot n8n node

- This is a Node.js/CommonJS client package in the isolated `integrations/` npm workspace. Follow its parent release guidance; keep it outside the root Bun application workspaces and the publishing server's dependency graph.
- Use the official n8n node toolchain and declarative REST routing. Postdot remains responsible for permissions, source adaptation, validation and durable publication state.
- Create Draft must remain unscheduled. Do not infer provider delivery or content compatibility from HTTP success, and do not add automatic write retries without a server idempotency contract.
- Credentials belong in n8n's encrypted credential store. Examples and archives contain no real keys, instance addresses or resource IDs.
- Validate routing changes in a real isolated n8n instance against isolated Postdot data, including refusals and uncertain writes. Type checks alone cannot prove n8n expression or output behavior.
- Preserve the repository's AGPL license. Package publication and a different licensing or n8n verification commitment require an explicit owner decision.
- The official node CLI builds CommonJS output; `scripts/copy-metadata.cjs` copies authored metadata beside it. The archive includes compiled files, the user README, example workflow and AGPL license.
- The linter has two deliberate metadata exceptions: preserve AGPL-3.0-only rather than adopting the starter's MIT license, and use the public Postdot author name/URL without a personal email. Strict Cloud verification is disabled; local lint success is not Cloud verification.
