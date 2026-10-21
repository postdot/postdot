# Mastodon Package Guidance

This package owns Mastodon-specific protocol knowledge: instance origins, OAuth
application registration, account verification, status payloads, media upload
responses, and provider error classification.

- Keep the package independent from Elysia, the database, Better Auth, and Postdot
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
- Status IDs are local to an instance. Resolve reply targets on the original
  publishing instance, verify the connected account owns the source status, and
  check public ancestry before dispatch. Preserve unlisted visibility rather than
  promoting a reply to public visibility.

- Preserve the immutable `status-v1` image and `status-v2` video profiles and
  execution registrations. New channels use `status-v3`, which adds optional
  polls. Video remains one MP4, exclusive of images, with required accessibility
  text. Check instance MIME, byte and pixel limits before upload.
- Polls exclude media attachments. Validate option text as graphemes and check
  the connected instance's advertised poll limits before sending. Missing limits
  do not establish support; missing poll acknowledgement after dispatch is ambiguous.
- Stream video multipart bodies; do not materialize an entire video Blob. A 206
  media read means processing, not failure or readiness. The API adapter persists
  the remote identifier and defers its job; it must never upload that video again.
