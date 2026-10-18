# Facebook Pages protocol

- Own Graph protocol and response classification only. OAuth application setup, project credential encryption, inspected media, durable effects and Studio belong to their existing application boundaries.
- Use injected fetchers and synthetic identities. No live Meta discovery, token validation or publishing without explicit test authorization.
- Pin the Graph version and origin. Do not follow provider paging URLs or HTTP redirects; rebuild pagination using validated opaque cursors and the fixed endpoint.
- Tokens belong only in authorization headers. Never return raw provider errors or caught exceptions. Discovery returns Page tokens for server-side connection setup only; never serialize those results to a browser or logs.
- A photo ID is not its published post ID. A successful write without the required post identity remains ambiguous; never replay a write internally.
- Blob inputs must come from inspected project-owned storage. Initial support is JPEG/PNG only, at a conservative 10,000,000-byte ceiling. Link plus photo is deliberately rejected rather than silently dropping either.

- `selectPage` checks current granted scopes and the chosen Page's publishing task. It does not prove token provenance: call it only after the installation-bound OAuth callback validates state, app configuration, project and actor. Never turn arbitrary client-supplied tokens into a connection through this helper.
- The exported content profile is not registered for creation or execution yet. Preserve that boundary until connection compatibility and the native text-capability contract are established; an unset text ceiling is not a claim of unlimited Facebook text.
