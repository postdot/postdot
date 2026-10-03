# ADR-076 — Ephemeral draft invalidation over the existing SSE connection

- Status: accepted
- Date: 2026-10-03
- Scope: publication draft discovery across authenticated browser sessions
- Provenance: owner accepted the lightweight SSE recommendation following UX-292 and ISSUE-150
- Related: ADR-027, ADR-048

## Decision

Successful publication draft saves emit a process-local `project.draft-changed` hint after the SQLite transaction returns. This is separate from journal-backed `project.update` facts. Its payload contains only project, post and publication identifiers and whether the source revision changed. It has no SSE id or replay cursor, contains no text/media/credentials and never creates an audit event just to transport an autosave.

The existing authenticated project stream subscribes to these hints, coalesces repeated pending publication changes and rechecks authorization before delivery. The browser groups closely spaced hints and invalidates the affected publication editor; source changes also invalidate open sibling editors for that post. Hidden pages defer these targeted reads. Initial connection, reconnection and visibility return reread active editor state to recover missed hints. No periodic draft polling, broker or second service is added.

SQLite revisions remain authoritative. A hint is only a prompt to reread; it never merges, promotes or executes content. Incoming snapshots preserve dirty local buffers and expose explicit reconciliation. An actual in-flight save settles before its incoming snapshot is reconciled, so a session does not conflict with its own acknowledged save. Shared-source revision participates in snapshot comparison even when the sibling draft revision is unchanged.

## Alternatives and consequences

Fixed five-second browser polling was rejected by the owner. Journaling every autosave would grow durable history for transient work. WebSocket adds bidirectional transport without a current need. Ephemeral SSE is deliberately not replayable: clients must reread on reconnection and visibility return rather than treating missed hints as retained history. This is change discovery, not simultaneous collaborative editing or a three-way merge policy.

The publisher lives in the existing single API process and draft-save route. Other future mutation paths must emit the same post-commit hint or establish equivalent refresh coverage. Heartbeats remain connection liveness, not repeated draft reads.
