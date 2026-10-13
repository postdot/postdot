# ADR-004 — Use Bun and TypeScript

- Status: accepted
- Scope: Application runtime and implementation language
- Provenance: V1 runtime review
- Related specs: [SPEC-003](../specs/SPEC-003-product-foundation.md)
- Superseded by: none

## Context

Postbot values a small operational footprint, strong development velocity, and a
shared language across the API, domain packages, tooling, and web application. Go
and Rust can produce smaller native services, but would reduce reuse and delivery
speed for the current team.

## Decision

Use TypeScript on Bun for the application runtime and monorepo packages. Prefer Bun
native capabilities when they remove a runtime dependency without weakening
correctness or maintainability.

## Alternatives considered

- Go: excellent memory usage and single-binary deployment, but lower development
  velocity and less code sharing with the React application for this team.
- Rust: strong performance and control, but substantially higher implementation
  cost for the initial product experiment.
- A conventional Node.js runtime: mature, but Bun better matches the desired native
  SQLite, test, bundling, and single-process toolchain.

## Consequences

- Development and product surfaces share TypeScript types and tooling.
- Runtime footprint may remain higher than a comparable Go service and must be
  measured continuously.
- Bun-specific behavior requires official documentation and integration tests.
- Runtime portability to Node.js is not promised.
