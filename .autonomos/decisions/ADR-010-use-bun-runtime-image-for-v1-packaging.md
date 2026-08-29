# ADR-010 — Use a Bun Runtime Image for V1 Packaging

- Status: proposed
- Scope: V1 production container and single-process distribution
- Related decisions: [ADR-003](ADR-003-use-a-single-process-singleton.md), [ADR-004](ADR-004-use-bun-and-typescript.md), [ADR-005](ADR-005-use-sqlite-first-persistence.md)
- Related issue: [ISSUE-001](../ISSUES.md#issue-001-validate-the-complete-production-distribution-path)
- Related task: [OPS-10](../TASKS.md)

## Context

Herald must be distributable as one process with its API, dashboard assets, SQLite
migrations, and persistent data volume. Bun can produce a compiled executable, but
the current Elysia 2 OpenAPI integration resolves TypeBox's `typebox/type` module
dynamically while compiling a route. A real compiled-binary smoke test fails on
`GET /health` with a missing module error, even when the module is referenced by the
application entrypoint.

The regular Bun-targeted JavaScript bundle serves the same routes successfully and
keeps the API artifact small. The remaining difference is the runtime image rather
than an additional application process or service.

## Decision

The V1 container uses a multi-stage build with:

- a Bun build stage that installs the workspace, builds the API and dashboard, and
  copies the API bundle, dashboard assets, and committed Drizzle migrations;
- an `oven/bun:1.4.0-slim` runtime image running one bundled JavaScript entrypoint;
- a non-root `bun` user, `/data` as the SQLite volume, and a container healthcheck
  against `/health`.

Migration and web asset directories remain configurable so the same application
entrypoint works in the workspace, the bundle, and the container.

## Alternatives considered

- Compiled Bun executable with a distroless runtime: smaller runtime surface, but
  rejected for the current beta because the real OpenAPI route smoke test fails.
- Separate API and web containers: violates the supported V1 singleton deployment
  and adds process and deployment overhead.
- Copying workspace `node_modules` into the image: increases size and couples the
  runtime to the monorepo layout; the bundle avoids that dependency tree.

## Consequences

- The image includes the Bun runtime until the OpenAPI compilation incompatibility is
  resolved and revalidated against the full route surface.
- The container remains one process with one persistent data volume and no external
  database or queue dependency.
- A future Bun/OpenAPI release may justify a focused compiled-binary experiment; it
  must pass the same startup, health, OpenAPI, static asset, and migration checks
  before changing this decision.
