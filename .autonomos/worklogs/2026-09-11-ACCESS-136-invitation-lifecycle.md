# ACCESS-136 — Invitation lifecycle

- Status: complete
- Date: 2026-09-11
- Scope: Better Auth project invitations and project access UI
- Decision: [ADR-065](../decisions/ADR-065-invitation-delivery-and-verification-profile.md)

## Outcome

The Better Auth Organization configuration now cancels a previous pending
invitation when the same address is invited again. Herald adds an owner-only
`POST /api/projects/:projectId/invitations/:invitationId/resend` action that
cancels all pending invitations for the address before creating a new one. The
returned invitation therefore has a fresh ID and invalidates the previous copied
link, including when the previous record has expired.

The project access UI exposes “Resend” beside each pending invitation, marks
expired invitations, refreshes the invitation list after rotation, and presents
the new copyable link. No invitation email is claimed or sent in the local
application because no mail provider has been selected.

`createAuth` now accepts an optional, typed invitation delivery callback and URL
factory. A deployment can provide its own transport without coupling the auth
package to a vendor. The verification gate is explicitly configurable through
`HERALD_REQUIRE_EMAIL_VERIFICATION_ON_INVITATION` and stays disabled by default.

## Verification

- Better Auth invitation-hook test passes with normalized delivery data and URL.
- API tests cover resend rotation, old-link invalidation, and the one-pending
  invariant for the target address.
- Browser test covers creating, resending, replacing the link, and accepting the
  new invitation.
- Full repository checks remain the release gate before merge.

## Deferred

ACCESS-137 remains for selecting a concrete invitation/account-verification mail
transport. Account administration, ownership transfer, and multiple owners remain
separate product decisions.
