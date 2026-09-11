# ADR-064 — Use a clean development access baseline

- Status: accepted
- Date: 2026-09-11
- Scope: development database history, project access persistence, and access compatibility code
- Provenance: user direction on disposable private development data; ISSUE-067; ACCESS-133; ACCESS-135
- Related decisions: [ADR-030](ADR-030-project-scoped-machine-access.md), [ADR-061](ADR-061-human-account-and-instance-access-policy.md)
- Supersedes: [ADR-063](ADR-063-adopt-better-auth-access-plugins.md) where it retains project-access compatibility data or a retirement window

## Context

Herald is a private application that has not been used by the owner or by any
external operator. The repository contains no development database file or
deployed data that needs to survive an access-model change. The previous Better
Auth adoption therefore carried project-membership, mixed invitation, bearer-token,
and retirement-marker paths for a deployment scenario that does not exist.

That compatibility surface obscures the intended authority and keeps authorization
branches alive without a real migration requirement. It also makes the Drizzle
history describe discarded development models instead of the current product.

## Decision

Herald adopts a clean-slate development boundary:

- The Drizzle directory contains one generated baseline for the current schema.
  Future schema changes may add ordinary migrations from that baseline; the
  baseline is not an excuse to weaken migration checks or silently reset a database.
- A local database whose schema conflicts with the committed history has no
  supported automatic upgrade path in this development phase. The migration runner
  fails closed with an actionable message. An operator may stop Herald and move a
  disposable local database aside explicitly; a database containing data that must
  be preserved requires a new, separately accepted production migration plan.
- Better Auth Admin owns global user administration, Organization owns project
  membership and invitations, and the API Key plugin owns organization-backed
  project keys and their expiry. Herald routes retain the project binding and
  actor-attribution checks around those standard primitives.
- Herald retains only access state with independent domain meaning: instance
  bootstrap and membership, a dedicated instance-invitation table, and human or
  machine actor projections used by the domain and audit history.
- The obsolete project-membership table, mixed project/instance invitation table,
  Herald project bearer-token table, retirement marker, compatibility store, and
  runtime fallbacks are not part of the current schema or runtime.

## Consequences

The code and schema now express one project-access model instead of a current model
plus a hypothetical historical one. Fresh development databases are smaller and
deterministic, and tests cannot accidentally pass by exercising retired access
paths. Existing local test data is intentionally disposable and must be recreated
when the baseline changes. If Herald later has a real deployed database, production
upgrade and rollback semantics will be designed from observed data in a new
decision rather than inferred from this private development baseline.

## Verification

- The generated migration directory contains exactly one SQL baseline and its
  matching snapshot.
- A fresh database contains the current Better Auth and Herald tables, seeds a
  claimable instance, and contains none of the removed access tables or marker.
- Reapplying the baseline is idempotent, preserves foreign-key enforcement, and
  records one Drizzle migration.
- Focused authentication, access, API-key, invitation, and project tests pass
  without constructing a retired Herald project token or membership.
- The full repository quality gate remains required before integration.
