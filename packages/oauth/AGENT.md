# AGENT: packages/oauth

- **Purpose:** Provide focused OAuth protocol mechanics for publisher-channel connections.
- **Boundaries:** Keep provider metadata and deviations in provider adapters, persistence in `@postbot/db`, and HTTP/Elysia routing in `apps/api`.
- **Security:** Use authorization code with PKCE S256, high-entropy state, exact callback matching, and standards-library response validation. Never log or persist raw authorization codes, state values, PKCE verifiers, or tokens through this package.
- **Constraints:** Do not use this package for authentication into Postbot and do not add a generic provider configuration language.
