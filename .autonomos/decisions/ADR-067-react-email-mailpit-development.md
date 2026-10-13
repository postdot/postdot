# ADR-067 — Own transactional email templates in React Email and use Mailpit locally

- Status: accepted
- Date: 2026-09-11
- Scope: transactional email templates, local SMTP development, and API email integration
- Provenance: ACCESS-138, ACCESS-137, ADR-066, and the development-only deployment profile

## Context

Postbot now has an optional SMTP boundary, but its invitation, verification, and
password-reset bodies were still assembled inside the API transport module. That
made template design, HTML/text parity, and visual review depend on an API
implementation detail. Local development also had no inbox-like relay for
checking the complete submission path without using a real mailbox.

## Decision

The monorepo owns transactional messages in the private `@postbot/email` package.
Each template is a React Email component with a default export for the local
preview server. Those preview entrypoints wrap the strict, typed components with
safe, non-production fixture data so the preview server can render them without
runtime props. The package exposes typed renderers that return the recipient,
subject, HTML body, and plain-text alternative. User-provided values are passed
through JSX so React Email performs the escaping; deployment origins and
credentials remain outside the package.

The shared layout reuses the owner-supplied `PostbotLogo` from `@postbot/ui` and
adapts the accepted Graphite/Ash/Cobalt visual system to email-safe inline
styles. It declares the accepted Recursive Variable family through
`@react-email/font`, with a pinned public webfont URL as progressive enhancement
and Arial/Helvetica fallbacks for clients that do not load webfonts. The email
surface stays close to the application: an Ash canvas, a near-flat raised
surface with a six-pixel radius and the shared restrained surface shadow, a
small cobalt mark lockup, and a flat Cobalt action. There is no decorative dark
banner, oversized shadow, or rounded notice card; the identity comes from the
same typography, mark, spacing, and color roles without adding instructional
copy to each message.

The runtime uses the focused `@react-email/*` component and render packages so
the API does not bundle the React Email preview application. The `react-email`
CLI and `@react-email/ui` are development dependencies used only by the package's
preview command on port `3001`.

Local SMTP development uses the repository-level `docker-compose.dev.yml` with
the official `axllent/mailpit:v1.27` image. Mailpit listens on loopback port
`1025` for SMTP and `8025` for its web inbox. The compose file is not referenced
by the production Dockerfile or runtime; deployments continue to select their
own SMTP relay through environment configuration. Host ports can be overridden
with `POSTBOT_MAILPIT_SMTP_PORT` and `POSTBOT_MAILPIT_UI_PORT` when another local
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
- The package currently uses English copy and a small Postbot visual system.
  Localization, branded assets, durable delivery attempts, and inbox/retry
  policy remain separate decisions.
- Operators must start Mailpit and configure the API's ignored `.env` file to
  exercise SMTP locally; the manual-link profile still works when SMTP is unset.

## Verification

`@postbot/email` unit tests render all three messages and assert HTML escaping,
action URLs, subjects, and plain-text alternatives, including the three
no-props preview entrypoints and the shared logo/font identity markers. The
package build is importable, and its preview server starts on port `3001` with
all three routes rendering successfully. The API delivery tests
assert that the transport consumes those renderers without blocking Better Auth
flows. `docker compose config`, an alternate-port Mailpit startup/health/cleanup
cycle, and a real local SMTP capture through Mailpit were verified without using
an external mailbox. The repository merge gate also passes.
