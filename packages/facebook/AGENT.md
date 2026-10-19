# Facebook Pages protocol

- Own Graph protocol and response classification only. OAuth application setup, project credential encryption, inspected media, durable effects and Studio belong to their existing application boundaries.
- Use injected fetchers and synthetic identities. No live Meta discovery, token validation or publishing without explicit test authorization.
- Pin the Graph version and origin. Do not follow provider paging URLs or HTTP redirects; rebuild pagination using validated opaque cursors and the fixed endpoint.
- Graph resource tokens belong only in authorization headers. The documented confidential OAuth token exchange is a narrow exception: its fixed Meta endpoint receives secret/code/token query parameters; never log those URLs or attach them as error causes. Never return raw provider errors or caught exceptions. Discovery returns Page tokens for server-side connection setup only; never serialize those results to a browser or logs.
- A photo ID is not its published post ID. A successful write without the required post identity remains ambiguous; never replay a write internally.
- Blob inputs must come from inspected project-owned storage. Initial support is JPEG/PNG only, at a conservative 10,000,000-byte ceiling. Link plus photo is deliberately rejected rather than silently dropping either.

- `selectPage` checks current granted scopes and the chosen Page's publishing task. It does not prove token provenance: call it only after the installation-bound OAuth callback validates state, app configuration, project and actor. Never turn arbitrary client-supplied tokens into a connection through this helper.
- The native profile explicitly sets text `maxLength: null`: the provider maximum is unknown, not unlimited. Do not substitute an unverified numeric ceiling. Creation, native validation and worker execution are registered; live Meta acceptance still requires an explicitly authorized provider test.

- Behind a TLS proxy, reconstruct callback parameters using the installation-configured public callback URL and the incoming query. Do not use the internal HTTP origin or trust forwarded headers to choose the OAuth identity. Provider validation still requires the exact configured HTTPS callback.

- Final OAuth exchange metadata may omit expiration: represent it as unknown, never infinite or guessed, and never reuse the first exchange lifetime. Present malformed expiration remains a failure. Unknown lifetime is permitted only within the encrypted, expiring Page-selection attempt and existing permission checks; it does not change durable Page credential lifetime. See [ADR-087](../../.autonomos/decisions/ADR-087-unknown-facebook-pending-token-expiration.md).
