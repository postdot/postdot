# X (Twitter) Package Guidance

This package owns X-specific protocol knowledge: OAuth 2.0 PKCE requests, account profile verification, tweet payload mapping, the documented v2 media upload on `https://api.x.com`, weighted post-text validation, and provider error classification.

- Keep the package independent from Elysia, the database, Better Auth, and Postbot persistence.
- Inject fetchers and timing boundaries in tests; never use a real X account or real external API from the test suite.
- Never log, return, or place access tokens, refresh tokens, client secrets, or authorization codes in provider errors or public metadata.
- Treat a response or exception after a tweet/media effect may have started as ambiguous unless the provider explicitly proves no effect.
- Keep X-specific limits (280 weighted characters, 4 images, 5MB image limit, 1000 character alt text) and payload rules here. Use the simple v2 multipart upload for the current image-only scope; the application adapter owns project credentials, media lifecycle checkpoints, and scheduling semantics. Add chunked upload only when a supported media type requires it.
- The legacy v1.1 `upload.twitter.com` endpoints are deprecated by X and must not be used; the v2 upload reports `expires_after_secs`, which must be carried through the application checkpoint before a remote media identifier is reused.
