# ADR-094 — Operator-controlled project and workspace lifecycle

- Status: accepted — implemented
- Scope: GitHub #10; projects, workspaces, their data and external work
- Supersedes: ADR-074's workspace-archive role restriction; workspace owners and administrators may retire their own workspace

## Decision

Offer archive, restore and permanent deletion with an impact preview. Project
owners and workspace owners/administrators may retire projects. Workspace
owners/administrators may retire their workspace. Instance administration alone
still grants no routine content access. User-owned API keys inherit live project
roles, project scope and explicit action ceilings; no blanket machine prohibition.

Archive hides a resource from ordinary selection and prevents new content writes
or effects, retaining content, history, media, connections and grants. Restore
is explicit and never requeues cancelled publications or effects. Workspace
archive may include its projects after the operator reviews the combined impact;
restoring a workspace does not silently restore its projects.

Retirement offers explicit cancellation of scheduled work in the same operation
and invalidates pending OAuth attempts. It prevents new effect admission while
already-owned effects finish. Unresolved external outcomes are explained, not a
permanent prohibition on removal. Permanent deletion requires the resource name
and explicit acknowledgement of uncertain outcomes when present. Published
remote content is not deleted by removing local data.

Permanent deletion removes owned local content/history/credentials and queues
storage deletion durably. A minimal receipt outside the project's cascading
journal records the resource, actor, action, time and impact counts. Object
cleanup is idempotent/retryable, observes backup fences, and does not pretend
SQLite and object storage form one transaction. A configured storage mismatch
must not discard a pending deletion. A stopped process can resume cleanup.

A default workspace must have an explicitly selected, manageable active
replacement before retirement. The lifecycle operation handles pointer changes;
there is no permanent prohibition on removing a default workspace.

Concurrent requests must not admit new work after retirement starts. Data is not
physically removed while an owned effect or internal write is active. Changes
use revision checks and transactions. UI and API report waiting/cleanup progress
rather than claiming immediate physical deletion.

## Verification

Cover authorized and denied roles/key scopes; stale impact and revisions;
queued-work cancellation; effect admission/finalization races; OAuth callbacks;
media upload/preview/backup races; deletion retry/restart; archived reads and
write refusal; default replacement; workspace aggregation; restoration without
rescheduling; SQLite migration and backup/restore; EN/FR UI and CLI contracts.

Implementation and validation: [LIFE-588](../worklogs/2026-10-26-LIFE-588.md).
