# ACCESS-134 — Project member administration UI

- Status: complete
- Date: 2026-09-11
- Scope: project members, invitations, and the project access dashboard
- Related issue: [ISSUE-062](../ISSUES.md#issue-062-define-herald-human-account-instance-administration-and-invitation-policy)
- Related decisions: [ADR-061](../decisions/ADR-061-human-account-and-instance-access-policy.md), [ADR-064](../decisions/ADR-064-clean-development-access-baseline.md)

## Outcome

Herald now exposes collaborative project access without creating a second
membership or invitation authority. Better Auth Organization remains the source
of truth; the Herald API projects its members and invitations into a deliberately
small project-scoped contract, and the dashboard provides the human workflow.

The project access page now supports:

- listing active project members with their role and avatar;
- inviting an existing or future account as `editor` or `viewer`;
- copying an invitation link when email delivery is not configured;
- accepting a project invitation from the authenticated account;
- changing a member between editor and viewer;
- removing a non-owner member;
- keeping automation API-key management visible only to project owners.

The owner boundary is explicit. A project member can read the member list but
cannot administer it. Owner memberships cannot be changed or removed through
this first UI/API slice; ownership transfer is a separate policy decision.
Invitation and membership mutations are exposed through guarded Herald routes,
while direct public Better Auth organization-admin mutations remain blocked.

## Verification

- `bun run check` passed: format, lint, root and package typechecks, unit/API
  tests, 15 browser tests, and production builds.
- The focused API contract covers project isolation, invitation creation and
  cancellation, invitation acceptance, role changes, member removal, and
  owner protection.
- The browser scenario covers the owner and member views, copyable invitation
  acceptance, role change, and removal.
- English and French message coverage remain at 100%.

## Follow-up

Email delivery, invitation resend/expiry management, ownership transfer, and
broader account administration remain separate product decisions. No provider
side effect or production data was used for this slice.
