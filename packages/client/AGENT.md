# AGENT: packages/client

- Stack: TypeScript, Eden Treaty, Bun
- Conventions: Keep this package transport-focused; derive its API type from `@postdot/api` and expose small client factories for the web app and CLI.
- Constraint: Do not duplicate request or response contracts here; the Elysia application is the source of truth.
- Explicit native session cookies use `cookie`, `credentials: 'omit'` and `redirect: 'error'`; ordinary clients retain their existing defaults. `token` is a user API key, not a human session token. The caller owns secure cookie storage, server/account scoping and lifecycle; the client factory is not a cookie jar or a qualified mobile SDK.
