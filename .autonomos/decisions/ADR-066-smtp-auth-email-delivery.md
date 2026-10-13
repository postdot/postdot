# ADR-066 — Use optional SMTP for Better Auth email delivery

- Status: accepted
- Date: 2026-09-11
- Scope: project invitations, account verification, password reset delivery, and login continuity
- Provenance: ACCESS-137, ISSUE-062, ADR-061, ADR-063, and the Better Auth email-delivery contract

## Decision

Postbot uses SMTP as its deployment-level email transport. Nodemailer owns the
protocol adapter in the API process, while Better Auth remains responsible for
token generation, expiry, verification, password-reset, and Organization
invitation records. Postbot does not couple the access model to a vendor-specific
mail API.

Delivery is optional. The transport is enabled only when the deployment supplies
`POSTBOT_EMAIL_SMTP_HOST` and `POSTBOT_EMAIL_FROM`, with port `587` by default,
`POSTBOT_EMAIL_SMTP_SECURE` for TLS mode, and an optional username/password pair.
Credentials are environment configuration only; no mail secret is stored in the
repository or database. When SMTP is unset, the existing copyable invitation-link
workflow remains the truthful local/manual-link profile.

The configured callbacks cover three Better Auth events:

- Organization invitations use a Postbot URL containing the invitation ID and the
  associated project ID, so the recipient can sign in or create the invited account
  and still return to the correct project access screen.
- Email/password signup sends an account-verification message when SMTP is enabled.
- Password-reset requests use the same deployment transport and a dedicated template.

`POSTBOT_REQUIRE_EMAIL_VERIFICATION_ON_INVITATION` remains opt-in and cannot be
enabled without a configured transport. This keeps the local profile usable while
making a shared deployment’s verified-email requirement an explicit choice.

## Delivery behavior

The callback starts the mail send without holding the authentication request open.
Failures are reported through the API logger with the message kind and transport
error, without logging the email payload, token, or message body. This follows the
authentication provider’s recommendation to avoid adding delivery latency and
observable timing differences to account flows.

There is deliberately no durable email outbox, retry queue, bounce processing, or
provider webhook in this slice. A future hosted/shared deployment that needs
delivery guarantees must add those as a separate reliability decision rather than
silently pretending SMTP submission is durable.

Templates are small React Email components in the `@postbot/email` package and
use English as the current server-side base language. The API maps Better Auth
callbacks to rendered HTML/text messages and remains responsible for Nodemailer
transport configuration. Localization and branded template management remain
follow-ups once the deployment profiles and product language policy are settled.

## Consequences

- Local development requires no external service and keeps manual links available.
- Self-hosted operators can use a local relay, a hosted SMTP relay, or an
  authenticated provider without changing the access domain.
- Operators must configure a reachable relay and monitor its delivery failures;
  successful request handling alone does not prove inbox delivery.
- Invitation resend rotation remains the authority for invalidating an old link.
- Project ownership/transfer, multiple owners, account administration, deletion,
  and a complete recovery UI are not expanded by this transport decision.

## Verification

Focused tests inject a fake transport and assert recipients, subjects, escaped
HTML, invitation project context, account-verification and password-reset hooks,
disabled no-mail behavior, and non-blocking failure reporting. Configuration tests
cover optional SMTP, incomplete credentials, and the verified-invitation guard.
Template tests live in `@postbot/email`; local SMTP delivery is exercised through
the Mailpit compose profile rather than a real external mailbox.
