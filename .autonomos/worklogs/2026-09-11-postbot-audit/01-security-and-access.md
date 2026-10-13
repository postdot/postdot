# Security and access

Reference: `main@60bbb319`. The two defects below were reproduced with fictional accounts, an in-memory SQLite database, and `app.handle`, without a shared server or external provider.

## H-01 — P1 — The viewer role does not prevent every write

**Expected contract.** [ADR-061](./.autonomos/decisions/ADR-061-human-account-and-instance-access-policy.md:83) defines a viewer as a read-only project member. The same contract permits operational writes for an editor and reserves access management for the owner.

**Observed behavior.** After creating a non-administrator user and adding that user as a project viewer:

- `PATCH /api/projects/:id` to change the timezone returns 403, as expected;
- `POST /api/projects/:id/channels` returns 201 and actually creates a channel;
- `POST /api/projects/:id/posts` returns 201 and creates a draft publication.

The account has the project `viewer` role. Fixture-specific administrator privileges were removed before the reproduction.

**Cause.** [Route composition](./apps/api/src/modules/projects/index.ts:94) calls `canAccessProject` without a minimum role. [The access store](./packages/db/src/access-store.ts:904) therefore accepts `viewer`. [Channel creation](./apps/api/src/modules/projects/channel-routes.ts:66) delegates directly to the store. [The store](./packages/db/src/manual-store/project-channel-store.ts:338) checks for a project and actor, but not the role. [Actor loading](./packages/db/src/manual-store.ts:260) supports attribution and is not current write authorization.

**Impact.** A read-only invited user can change project content. The protection on the member-management page or timezone route does not protect the other routes. Other mutations using this model require a systematic review; this audit did not execute every mutation or publish to an external service as a viewer.

**Recommended follow-up.** Define an authorization boundary for every action: reader, editor, owner, instance administrator, and project key. Keep the actor as audit identity. Do not treat historical actor existence as a current permission. The exact control location remains an implementation decision; replacing Better Auth is not required.

**Acceptance.** At minimum, test reading, content creation/editing, promotion, manual publication, provider connect/disconnect, media, tags, channel profiles, and access management for each principal. Also test denial after downgrade and removal. A rejected request must leave no write and no external effect.

## H-02 — P1 — A project SSE connection survives access revocation

**Reproduction.** A viewer opens `/api/projects/:id/events`. The owner removes that member. A new channel read returns 404, proving that current membership was revoked. The owner then creates a channel; the reader on the old connection still receives a `channel.created` event.

**Cause.** [The SSE route](./apps/api/src/modules/projects/realtime-routes.ts:156) checks access when opening. [The stream loop](./apps/api/src/modules/projects/realtime-routes.ts:336) checks request cancellation and then rereads the project journal; it has no way to revalidate the session or membership. Revocation does not automatically abort the connection's `Request.signal`.

**Precise impact.** The stream contains identifiers, event types, subjects, and timestamps. Its `payload` is empty: the reproduction demonstrates metadata and activity leakage, not post text or token leakage. The connection can remain open after the permission that authorized it disappears.

The user stream recalculates visible projects during reads, which is a real additional protection. That is not proof of closure after session expiration or revocation. Those cases require separate tests.

**Recommended follow-up.** Couple long-lived connections to principal validity, with closure or bounded revalidation after removal, ban, expiration, and sign-out. Define the acceptable revocation delay. Do not send new private facts after that delay; reconnecting must repeat all checks.

## Protections to preserve

- Better Auth owns human identities and Organization membership; Postbot keeps its instance rules and domain attribution.
- [Project keys](./apps/api/src/modules/projects/index.ts:59) are checked and bound to an organization and project. The macro rejects the wrong project; key-management routes require a human owner.
- [Reserved Better Auth mutations](./packages/auth/src/index.ts:66) are blocked on the public HTTP mount so the affected operations go through Postbot routes. This list requires a compatibility check whenever plugins evolve.
- Provider secrets are separate from Postbot login accounts and encrypted at rest; the connection belongs to the project.
- [HTTP egress](./packages/custom-http/src/egress.ts:76) classifies resolved addresses, applies the private-address policy, and rejects infrastructure metadata. [The transport](./packages/custom-http/src/node-requester.ts:40) uses the selected address. This is a concrete boundary, stronger than string-only URL validation.
- Schema and media contracts are bounded; they do not permit persisted script execution.

These protections do not compensate for H-01 and H-02, but they justify targeted boundary fixes rather than rebuilding all security.

## Uncertified areas

This audit does not conclude that there are no vulnerabilities, vulnerable dependencies, or authentication flaws. Email verification, administration, invitation, and plugin journeys expose a substantial surface. A later review should use a permission and lifecycle matrix with precise dependency versions.

The [official Better Auth session documentation](https://better-auth.com/docs/concepts/session-management) was used to distinguish session validity, expiration, and revocation. H-01 and H-02 are based on Postbot and local reproductions, not on an assumption about a Better Auth defect.
