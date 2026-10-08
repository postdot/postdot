# Mastodon Package Guidance

This package owns Mastodon-specific protocol knowledge: instance origins, OAuth
application registration, account verification, status payloads, media upload
responses, and provider error classification.

- Keep the package independent from Elysia, the database, Better Auth, and Herald
  persistence.
- Inject fetchers and timing boundaries in tests; never use a real Mastodon instance
  from the test suite.
- Never log, return, or place access tokens, refresh tokens, client secrets, or
  authorization codes in provider errors or public metadata.
- Treat a response or exception after a status/media effect may have started as
  ambiguous unless the provider explicitly proves no effect.
- Keep instance-specific limits and payload rules here. The application adapter owns
  project credentials, connection endpoints, media lifecycle checkpoints, and
  scheduling semantics.

- Preserve the immutable image-only `status-v1` profile and execution registration.
  New channels use `status-v2`: one MP4 video, exclusive of images, with required
  accessibility text. Check instance MIME, byte and pixel limits before upload.
- Stream video multipart bodies; do not materialize an entire video Blob. A 206
  media read means processing, not failure or readiness. The API adapter persists
  the remote identifier and defers its job; it must never upload that video again.
