# DEV.to Package Guidance

This package owns DEV.to and Forem API protocol knowledge: API-key
authentication, the authenticated-user response, article payloads, provider
limits, and external outcome classification.

- Keep the package independent from Elysia, the database, Better Auth, Postdot
  persistence, and the web application.
- Inject fetchers and timing boundaries in tests; never use a real DEV.to API key
  or make a real provider request from the test suite.
- Never log, return, or place DEV.to API keys in provider errors or public
  metadata.
- Treat a response or exception after an article creation request may have been
  accepted as ambiguous unless DEV.to explicitly proves that no article was
  created.
- Keep the DEV.to article contract precise here. The application adapter owns
  project credentials, signed media delivery, scheduling, and durable workflow
  semantics.
