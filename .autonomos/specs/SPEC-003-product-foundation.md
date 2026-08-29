# SPEC-003 — Herald Product Foundation

- Status: accepted
- Scope: Product identity, domain boundaries, client surfaces, and operating guardrails
- Provenance: V1 product review on 2026-08-28
- Current direction: [SPEC-005](SPEC-005-continuous-product-scope.md)
- Related decisions: [ADR-001](../decisions/ADR-001-separate-channel-from-publisher.md), [ADR-002](../decisions/ADR-002-separate-post-from-publication.md), [ADR-003](../decisions/ADR-003-use-a-single-process-singleton.md), [ADR-004](../decisions/ADR-004-use-bun-and-typescript.md), [ADR-005](../decisions/ADR-005-use-sqlite-first-persistence.md), [ADR-006](../decisions/ADR-006-use-a-next-event-durable-scheduler.md), [ADR-007](../decisions/ADR-007-use-a-react-spa-dashboard.md)
- Superseded by: none

## Intent

Herald is a lightweight, self-hosted multichannel publication orchestrator. It keeps
automatic and manual destinations in one source of truth and can be controlled by
humans, scripts, and external agents without becoming a content-generation suite.

The central product hypothesis is that a destination must exist independently of
Herald's ability to publish there automatically.

## Product requirements

- Support multiple projects from the first useful product workflow.
- Represent every real publication destination as a channel, including unsupported
  platforms, internal systems, blogs, and destinations that remain manual.
- Make automation optional through a publisher associated with a channel.
- Keep a source post distinct from each channel-specific publication.
- Treat manual publication as a normal workflow, not a degraded fallback.
- Keep publication state, failure, attribution, and external results inspectable.
- Support trusted humans, scripts, CI, and external agents through product-owned
  credentials and auditable actions.
- Remain simple to install, operate, back up, restore, and understand.

## Domain boundaries

The core relations are:

```text
Project
  -> Channels

Channel
  -> zero or one Publisher

Post
  -> Publications

Publication
  -> one Channel
```

The domain must preserve distinct responsibilities for `Project`, `Channel`,
`Publisher`, `Post`, `Publication`, `Job`, and `Actor`. Approval and publication
state are independent dimensions rather than combined status strings.

## Product surfaces

- The REST API is a first-class interface shared by the dashboard, CLI, agents, and
  external automations.
- The CLI is discoverable, scriptable, and capable of structured JSON output.
- The dashboard is a client of the same business concepts, not a second business
  implementation.
- Additional client surfaces must reuse the existing API and must not introduce a
  second domain model.
- Embedded generative AI is outside Herald; external agents remain first-class
  clients.

## Deployment requirements

- One instance, one process, and one worker are the supported initial deployment.
- The process contains the API, static dashboard, scheduler, and worker.
- Essential state is durable and reconstructible after restart.
- SQLite is the default application database.
- No external queue or search service is required.

## Acceptance criteria

- One project can contain both an automatically published channel and a manual
  custom channel.
- Both channel types participate in the same post, publication, scheduling, and
  audit model.
- The real workflow no longer requires a parallel JSON, spreadsheet, or secondary
  tracker.
- The application can be operated and recovered within the current quality and
  footprint constraints.

## Out of scope

- A complete social-media content suite, editor, CRM, inbox, or analytics platform.
- Embedded content generation or direct distribution of social-network credentials
  to external agents.
- Multi-tenant billing, complex organizations, agency tenancy, plans, quotas, or
  horizontal scaling.
- A plugin marketplace or universal data-driven publisher runtime.
- Desktop and mobile applications in the current product scope.
- Full multi-database support.
