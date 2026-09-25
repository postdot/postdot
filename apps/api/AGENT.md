# AGENT: apps/api

- **Stack:** Bun, Elysia 2 beta, Better Auth, Drizzle ORM, TypeScript
- **Conventions:** Keep transport concerns in feature modules under `src/modules`; delegate business operations to `packages/core` and persistence to `@herald/db`.
- **Composition:** `src/app.ts` is a composition root. Authentication, error handling, health, and feature routes are separate plugins/modules. Preserve Elysia's chained inference when adding routes.
- **Contracts:** Use native Elysia `typebox` schemas for route contracts. The current Drizzle release requires a small `drizzle-typebox` compatibility bridge in the project models until Drizzle's native TypeBox integration is available.
- **Tooling:** Keep OpenAPI enabled at `/openapi` and `/openapi/json`. `@herald/client` consumes the typed Elysia application with Eden Treaty for domain routes.
- **Runtime:** Elysia JIT is the default execution mode. Keep Better Auth's base URL, secret, and trusted web origin explicit through validated environment configuration. Graceful shutdown must await the worker and media-maintenance drain before closing SQLite or releasing the runtime quiescence lock.
- **Configuration:** Declare API environment variables in `src/config.ts` through the TypeBox-backed helpers in `src/environment.ts`, and consume the resulting `HeraldConfig` object instead of reading environment variables throughout the application.
- **Logging:** Keep request logging in `src/plugins/logger.ts` and use Elysia 2 lifecycle names. Production defaults to the `error` threshold: unexpected server failures are logged, while successful-request records stay below the threshold. Do not log raw exception messages or request secrets. Do not add an Elysia 1 logger plugin without proving compatibility with the current Elysia version.
- **Production serving:** The production entrypoint serves the built SPA through the Elysia 2-compatible `@elysia/static` plugin and keeps migration and asset directories configurable for compiled or containerized deployments. Development continues to use the separate Vite server.
- **Recovery:** Keep SQLite backup and restore logic in `@herald/db`; expose maintenance commands through the production bundle, and require the server to be stopped before restoration.
- **Media transport:** Keep upload and download routes under `src/modules/media`; finalization remains server-authoritative, and raw media downloads use a native `Response` with explicit OpenAPI documentation rather than response JSON validation.
