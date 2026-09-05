# AGENT: packages/bluesky

- Stack: official AT Protocol TypeScript SDKs with Bun Web Crypto
- Conventions: keep Bluesky and AT Protocol protocol truth in this package; expose
  provider-owned profiles, OAuth session serialization, and publication primitives
  to the application layer
- Constraints: do not import Herald database or Better Auth; do not use the Node
  OAuth wrapper; never log OAuth tokens, DPoP keys, or serialized provider sessions
