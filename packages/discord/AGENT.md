# Discord Package Guidance

This package owns Discord-specific protocol knowledge: Bot token authentication,
channel snowflakes, message payloads, attachment uploads, and provider error
classification.

- Keep the package independent from Elysia, the database, Better Auth, and Herald
  persistence.
- Inject fetchers and timing boundaries in tests; never use a real Discord
  application, Bot token, guild, or channel from the test suite.
- Never log, return, or place Bot tokens in provider errors or public metadata.
- Treat a response or exception after a message effect may have started as
  ambiguous unless Discord explicitly proves no effect.
- Keep Discord-specific limits and payload rules here. The application adapter owns
  project credentials, connection endpoints, media lifecycle checkpoints, and
  scheduling semantics.
