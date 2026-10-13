# AGENT: packages/bluesky

- Stack: official AT Protocol TypeScript SDKs with Bun Web Crypto
- Conventions: keep Bluesky and AT Protocol protocol truth in this package; expose
  provider-owned profiles, OAuth session serialization, and publication primitives
  to the application layer
- Constraints: do not import Postbot database or Better Auth; do not use the Node
  OAuth wrapper; never log OAuth tokens, DPoP keys, or serialized provider sessions
- Preserve the issuing loopback OAuth client ID when restoring sessions: its scope
  is part of its identity. Requested scopes are not proof of granted permissions.
- Video processing job IDs are durable, immutable delivery checkpoints. Resolve
  them again on retries; do not upload again after a confirmed checkpoint.
