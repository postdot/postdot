# AGENT: packages/custom-http

- **Purpose:** Execute the bounded declarative HTTP transport for automatic custom
  channels and expose the shared operator-controlled outbound network boundary
  used by per-instance provider clients.
- **Boundary:** Interpret only the versioned Herald webhook, the approved
  structural mapping AST, and its dedicated secret path binding. This package
  must not evaluate scripts, access the database, read process environment, or
  know Better Auth.
- **Network:** Resolve and classify every destination at execution time, pin the
  validated address for the request, disable redirects, and enforce operator-owned
  private-destination policy. `createNetworkControlledFetcher` may be injected into
  code-owned providers; it must not contain provider-specific protocol logic.
- **Secrets:** Receive one connection-owned secret for the duration of delivery;
  never put it in envelopes, mapped content, errors, or logs.
- **Media:** Consume media through a narrow callback supplied by the application.
  Do not depend on database ownership or expose storage locators to receivers.
