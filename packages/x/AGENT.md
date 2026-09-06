# X (Twitter) Package Guidance

This package owns X-specific protocol knowledge: OAuth 2.0 PKCE requests, account profile verification, tweet payload mapping, media upload multipart handling, alt-text metadata attachment, and provider error classification.

- Keep the package independent from Elysia, the database, Better Auth, and Herald persistence.
- Inject fetchers and timing boundaries in tests; never use a real X account or real external API from the test suite.
- Never log, return, or place access tokens, refresh tokens, client secrets, or authorization codes in provider errors or public metadata.
- Treat a response or exception after a tweet/media effect may have started as ambiguous unless the provider explicitly proves no effect.
- Keep X-specific limits (280 characters, 4 images, 5MB image limit, 1000 character alt text) and payload rules here. The application adapter owns project credentials, media lifecycle checkpoints, and scheduling semantics.
