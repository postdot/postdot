# AUDIT-189 — Issue ledger closeout

- Status: complete
- Date: 2026-09-24
- Base: `origin/main` at `62b64bb7`
- Related issues: ISSUE-105 through ISSUE-124

## What was done

Rechecked the audit ledger against the merged source, implementation worklogs,
tests, architecture decisions, and the owner's recorded product direction. The
older 2026-09-22 worklog remains unchanged as historical evidence; this closeout
supersedes its in-progress status and stale blocker summary.

- Resolved stale status on ISSUE-086; WEB-162 and its calendar evidence already
  satisfy the accepted behavior.
- Resolved ISSUE-103 and completed MEDIA-181: local device, browser webcam, and
  configured URL import are implemented through the shared verified intake.
  Cloud OAuth providers, Companion, and Unsplash are deferred, not permanently
  rejected.
- Reconciled ISSUE-104 and MEDIA-182 with the actual bounded library, upload,
  usage, reference, and deferred-purge implementation. The only remaining
  owner choice is whether deletion can be undone during the grace period.
- Completed the worker audit in ISSUE-116 / WORKFLOW-201. ADR-003 remains the
  current single-process/worker boundary; OPS-150 and OPS-151 provide shutdown,
  restart, fairness, lease, retry, and ambiguous-outcome evidence. Metrics are
  tracked separately.
- Recorded the owner's explicit deferral of real external notification
  providers in ISSUE-114 / NOTIFY-199. Ntfy, Telegram, and other adapters are
  not being added now, but are not permanently excluded; the recording
  transport still verifies the boundary without network access.
- Captured the approved self-hosted Prometheus-client direction in ISSUE-122
  and moved OPS-207 to actionable backlog. No hosted monitoring service is
  required; runtime instrumentation has not yet been implemented.
- Kept publisher-key rotation (ISSUE-111 / SECURITY-197) and durable SMTP
  retry semantics (ISSUE-115 / NOTIFY-200) blocked on explicit policy choices.
- Confirmed the remaining audit findings: ISSUE-112, 113, 117, 118, 120, 121,
  123, and 124 are resolved; ISSUE-119 remains accepted for later component
  seams. Existing worktree and history classifications under ISSUE-105–110
  remain recorded.

## Decisions still needed

1. Media deletion: add an Undo transition during the grace period, or keep the
   current one-way deferred deletion. Recommendation: add Undo so the grace
   period provides an actual recovery path.
2. Publisher encryption: retain one deployment-owned key and require publisher
   reconnection after key loss/change, or implement a versioned keyring with
   re-encryption and rollback. Recommendation: keep the simpler single-key
   self-hosted contract until rotation is a concrete need.
3. Transactional email: retain optional asynchronous best-effort SMTP with
   logged failures, or add durable retries and dead-letter reconciliation.
   Recommendation: retain the current low-complexity contract until a
   deployment requires guaranteed delivery.

META-62 remains blocked by the Codex app-managed worktree control limitation; it
does not block Herald work. OPS-207 is now actionable backlog, not a blocker.

## Files changed

- `.autonomos/ISSUES.md`
- `.autonomos/TASKS.md`
- `.autonomos/worklogs/2026-09-24-AUDIT-189-closeout.md`

## Validation

Recorded after the ledger edits:

- `bun run autonomos status`
- `bun run check:quick`
- `git diff --check`

No application code changed, so browser and production-build checks were not
needed for this ledger-only closeout.

## Next steps

The next implementation-ready task is OPS-207. The three owner choices above
can be decided independently; none blocks unrelated development work.
