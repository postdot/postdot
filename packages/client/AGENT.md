# AGENT: packages/client

- Stack: TypeScript, Eden Treaty, Bun
- Conventions: Keep this package transport-focused; derive its API type from `@postbot/api` and expose small client factories for the web app and CLI.
- Constraint: Do not duplicate request or response contracts here; the Elysia application is the source of truth.
