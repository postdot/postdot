# ADR-065 — Rotate project invitations and keep delivery deployment-neutral

- Status: accepted
- Date: 2026-09-11
- Scope: Better Auth Organization invitations, project access UX, optional mail delivery, and invitation verification
- Provenance: ACCESS-116, ACCESS-134, ACCESS-136, ADR-061, and ADR-063

## Decision

Better Auth Organization remains the sole authority for project invitations. Herald
uses its seven-day invitation expiry and enables
`cancelPendingInvitationsOnReInvite` so a new invitation replaces an older pending
invitation for the same address.

The explicit project “Resend” action rotates the invitation ID: Herald cancels every
pending invitation for that address, including an expired pending record, and creates
a fresh invitation. This makes a previously copied link unusable and repairs any
duplicate pending records that may exist in a disposable development database. The
normal invite form follows the same one-active policy through the Better Auth plugin
configuration.

Mail delivery is an optional deployment capability. `createAuth` exposes a typed,
transport-neutral invitation callback and a URL factory, but the repository does not
select or bundle an SMTP/API provider. When no callback is configured, Herald keeps
the copyable invitation-link workflow and makes no claim that an email was sent.

The Better Auth verified-email gate is configurable through
`HERALD_REQUIRE_EMAIL_VERIFICATION_ON_INVITATION` and defaults to `false` for the
local/manual-link profile. A deployment may enable it only after it has a working
account-verification flow and mail transport. This decision does not add password
recovery, account administration, ownership transfer, or multiple project owners;
each remains a separate follow-up decision.

## Consequences

- Owners can recover from an expired or lost invitation without manually deleting
  stale records.
- A resend is a real credential rotation rather than an expiry extension; clients
  must replace any previously copied link with the new one.
- Better Auth owns invitation persistence and sends through the deployment callback,
  while Herald owns the project-scoped route, link shape, and concise UI.
- Local development remains fully usable without external mail, and production
  deployments have an explicit verification switch instead of an implicit security
  assumption.

## Follow-up

ACCESS-137 completed the concrete transport and template slice through
[ADR-066](ADR-066-smtp-auth-email-delivery.md): SMTP is optional, local/manual-link
operation remains valid, and Better Auth account verification and password-reset
callbacks are wired alongside invitation delivery. Durable outbox/retry behavior,
ownership transfer, and multi-owner semantics are intentionally not coupled to that
work.
