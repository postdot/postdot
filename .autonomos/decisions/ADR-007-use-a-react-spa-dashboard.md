# ADR-007 — Use a React SPA Dashboard

- Status: accepted
- Scope: Dashboard framework and application shape
- Provenance: V1 client-surface review
- Related specs: [SPEC-001](../specs/SPEC-001-v1-scope.md), [SPEC-003](../specs/SPEC-003-product-foundation.md)
- Superseded by: none

## Context

The dashboard is an authenticated application and does not require SEO or server
rendering. Postbot expects to reuse mature ecosystem components as the product grows,
and the production server must remain the Elysia process rather than adding another
server runtime.

## Decision

Use React 19 with TanStack Router and Vite as a client-side SPA. Build static assets
and serve them from Elysia in production. Use TanStack Router as the type-safe
navigation and route-data boundary.

## Alternatives considered

- SolidJS: attractive runtime characteristics, but a smaller ecosystem and fewer
  ready-made equivalents for likely dashboard needs.
- Next.js or TanStack Start: provide server rendering and full-stack conventions the
  dashboard does not need while introducing another server architecture.
- A server-rendered Elysia UI: would reduce client framework weight but sacrifice the
  mature React dashboard ecosystem and current development model.

## Consequences

- The web application can use the mature React component ecosystem.
- Initial JavaScript size must remain under the project's footprint gate.
- Business logic remains outside React components and route handlers.
- Static production assets can live in the single Postbot deployment process.
