# ISSUE-021 — Bluesky OAuth and automatic publication validation

- Status: completed validation; recurring practice remains open
- Date: 2026-09-11
- Scope: real Bluesky loopback OAuth, project-owned credential recovery, and
  automatic publication delivery
- Related issue: [ISSUE-021](../ISSUES.md#issue-021-validate-the-central-publication-loop-through-real-use)
- Related issue: [ISSUE-061](../ISSUES.md#issue-061-make-bluesky-oauth-deployment-profiles-explicit)
- Related decision: [ADR-036](../decisions/ADR-036-evaluate-atproto-authorization-profile.md)

## Run

The disposable local Herald runtime was started with a fresh SQLite database and
media directory. A real Bluesky account authorized the local loopback client
through the provider's authorization screen. The requested grant was:

- `atproto`
- `repo:app.bsky.feed.post?action=create`
- `blob:image/*`

The connected Bluesky destination was restored in the test project and an
automatic text publication was scheduled shortly in the future. The worker
published it successfully; the Herald queue reported `Published`, the durable
job reported `succeeded`, and Bluesky exposed the resulting post at:

<https://bsky.app/profile/did:plc:vy2bicc4yrwuy7kbrzlezyjp/post/3mvafvjquos2p>

The test publication and project are disposable development data. The external
post was an explicitly approved smoke-test side effect.

## Defects found and corrected

1. The initial grant used `atproto` alone. That scope authenticates the account
   but does not authorize creation of `app.bsky.feed.post` records, so the PDS
   correctly returned a permanent permission failure. The provider contract and
   both client-metadata profiles now request the least-privileged granular post
   and image-blob scopes instead of the broad transitional scope.
2. A fresh OAuth callback for an external account whose old credential was
   revoked hit the project/provider/account uniqueness constraint and was not
   persisted. The callback now reactivates that existing audit row atomically,
   replaces its encrypted token/session material, and records the fresh grant's
   scopes.
3. Rescheduling through the publication editor did not wake the sleeping
   scheduler. Successful draft promotion now signals the scheduler so a new
   run time is honored immediately.

## Verification

- `bun run check` passed: format, lint, root and package typechecks, 14 browser
  tests, unit/API tests, and production builds.
- `GET /health` returned `{"status":"ok"}`.
- `GET /ready` returned a ready database, scheduler, media-maintenance, and
  notification runtime.
- The fresh credential remained active with the three expected scopes, and the
  published publication retained its provider id and URL in SQLite.

## Follow-up

Repeat real-provider validation only as an operator-approved disposable smoke
test. Keep provider permission requirements documented per provider; do not turn
this Bluesky grant into a global DNS/HTTPS or OAuth requirement for Herald.
