# ACCESS-137 — SMTP invitation and account email delivery

- Status: complete
- Date: 2026-09-11
- Scope: Better Auth invitation, signup verification, password-reset delivery, and login continuity
- Decision: [ADR-066](../../../decisions/ADR-066-smtp-auth-email-delivery.md)

## Outcome

Postbot now has an optional SMTP adapter backed by Nodemailer. The API creates it
only when SMTP configuration is present and injects typed Better Auth callbacks for
Organization invitations, account verification, and password reset. The templates
provide both text and escaped HTML bodies and use the configured `POSTBOT_EMAIL_FROM`
sender.

Invitation links include the Better Auth invitation ID and the project associated
with its Organization. If a recipient is logged out, the dashboard preserves that
safe invitation context through `/login`; after sign-in or invited-account signup,
the recipient returns to the access screen instead of being dropped at the default
dashboard.

The existing link-only workflow is unchanged when SMTP is absent. Enabling
`POSTBOT_REQUIRE_EMAIL_VERIFICATION_ON_INVITATION` without a configured transport is
rejected at startup. Mail submission is best-effort and non-blocking; transport
failures are logged by message kind, and no durable outbox or retry policy is
claimed.

## Verification

- `bun test packages/auth/src/index.test.ts apps/api/src/config.test.ts packages/db/src/access-store.test.ts apps/api/src/modules/email/delivery.test.ts`
- API and web TypeScript checks pass.
- Repository lint passes with no warnings or errors.

## Deferred

Inbox delivery monitoring, durable retries/outbox, provider webhooks, localized
server-side templates, forgot-password/verification UI, ownership transfer, and
broader account administration remain separate decisions.
