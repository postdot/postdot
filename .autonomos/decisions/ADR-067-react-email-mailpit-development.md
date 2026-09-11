# ADR-067 — Own transactional email templates in React Email and use Mailpit locally

- Status: accepted
- Date: 2026-09-11
- Scope: transactional email templates, local SMTP development, and API email integration
- Provenance: ACCESS-138, ACCESS-137, ADR-066, and the development-only deployment profile

## Context

Herald now has an optional SMTP boundary, but its invitation, verification, and
password-reset bodies were still assembled inside the API transport module. That
made template design, HTML/text parity, and visual review depend on an API
implementation detail. Local development also had no inbox-like relay for
checking the complete submission path without using a real mailbox.

## Decision

The monorepo owns transactional messages in the private `@herald/email` package.
Each template is a React Email component with a default export for the local
preview server. The package exposes typed renderers that return the recipient,
subject, HTML body, and plain-text alternative. User-provided values are passed
through JSX so React Email performs the escaping; deployment origins and
credentials remain outside the package.

The runtime uses the focused `@react-email/*` component and render packages so
the API does not bundle the React Email preview application. The `react-email`
CLI and `@react-email/ui` are development dependencies used only by the package's
preview command on port `3001`.

Local SMTP development uses the repository-level `docker-compose.dev.yml` with
the official `axllent/mailpit:v1.27` image. Mailpit listens on loopback port
`1025` for SMTP and `8025` for its web inbox. The compose file is not referenced
by the production Dockerfile or runtime; deployments continue to select their
own SMTP relay through environment configuration. Host ports can be overridden
with `HERALD_MAILPIT_SMTP_PORT` and `HERALD_MAILPIT_UI_PORT` when another local
service already uses the defaults.

The API keeps ownership of delivery policy, Nodemailer configuration, logging,
and the current best-effort/non-blocking behavior. The email package has no
database, queue, retry, or provider-specific state.

## Alternatives considered

- Keep templates in `apps/api`: rejected because visual email composition and
  transport orchestration would remain coupled, making review and future
  localization harder.
- Use the unified `react-email` runtime entry point: rejected for the API path
  because it also pulls the preview tooling into the application bundle. The
  focused component/render packages provide the same template contract while
  keeping the preview CLI development-only.
- Test with a real external mailbox: rejected for local development because it
  introduces credentials, network dependence, and accidental recipient risk.

## Consequences

- Email markup has one reusable, previewable source of truth and an explicit
  plain-text alternative.
- Mailpit makes invitation and account-flow checks observable without external
  coordination; captured messages are disposable local development data.
- The package currently uses English copy and a small Herald visual system.
  Localization, branded assets, durable delivery attempts, and inbox/retry
  policy remain separate decisions.
- Operators must start Mailpit and configure the API's ignored `.env` file to
  exercise SMTP locally; the manual-link profile still works when SMTP is unset.

## Verification

`@herald/email` unit tests render all three messages and assert HTML escaping,
action URLs, subjects, and plain-text alternatives. The package build is
importable, and its preview server starts on port `3001`. The API delivery tests
assert that the transport consumes those renderers without blocking Better Auth
flows. `docker compose config`, an alternate-port Mailpit startup/health/cleanup
cycle, and a real local SMTP capture through Mailpit were verified without using
an external mailbox. The repository merge gate also passes.
