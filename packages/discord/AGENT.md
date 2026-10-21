# Discord Package Guidance

This package owns Discord-specific protocol knowledge: Bot token authentication,
channel snowflakes, message payloads, attachment uploads, and provider error
classification.

- Keep the package independent from Elysia, the database, Better Auth, and Postdot
  persistence.
- Inject fetchers and timing boundaries in tests; never use a real Discord
  application, Bot token, guild, or channel from the test suite.
- Never log, return, or place Bot tokens in provider errors or public metadata.
- Treat a response or exception after a message effect may have started as
  ambiguous unless Discord explicitly proves no effect.
- Keep Discord-specific limits and payload rules here. The application adapter owns
  project credentials, connection endpoints, media lifecycle checkpoints, and
  scheduling semantics.

- Preserve image-only `message-v1` and its execution registration. New channels use
  `message-v2` for one inspected MP4, exclusive of images, with a description and
  the portable 10 MiB attachment ceiling. Publication remains a Bot message with
  multipart files; do not add webhook credentials for video support.
- Discord uploads the attachment with the message. An unknown result must not
  trigger a blind replay; a 413 is a definitive payload rejection, not a processing
  delay. General user upload limits are not proof of Bot API entitlement.
