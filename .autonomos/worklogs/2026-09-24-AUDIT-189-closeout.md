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
  usage, reference, and deferred-purge implementation. Deleting an unused asset
  hides it immediately and purges its file after 24 hours by default (configurable),
  unless references or a backup fence prevent cleanup. There is no UI restore
  action; whether to add one is the only product choice still open in this audit.
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
- Confirmed the current publisher encryption contract in accepted ADR-012:
  one deployment-owned key, backed up separately; replacing or losing it makes
  existing publisher credentials unreadable, requiring account reconnection.
  Closed SECURITY-197 as a policy verification; automated rotation is future
  work only if a concrete deployment needs it (ISSUE-111 remains accepted).
- Confirmed accepted ADR-066 already settles current email behavior: optional
  asynchronous SMTP, logged failures, and no retry guarantee. Closed NOTIFY-200
  as a policy verification; durable retries are future work only if a deployment
  needs guaranteed delivery (ISSUE-115 remains accepted).
- Confirmed the remaining audit findings: ISSUE-112, 113, 117, 118, 120, 121,
  123, and 124 are resolved; ISSUE-119 remains accepted for later component
  seams. Existing worktree and history classifications under ISSUE-105–110
  remain recorded.

## Decisions still needed

1. Media deletion: should Postbot provide an “Undo deletion” action
   during the default 24-hour retention interval? Today, deleting an unused
   image removes it from the library immediately. Its file stays on disk/storage
   for 24 hours by default, then Postbot removes it automatically unless a
   reference or backup prevents cleanup. There is currently no way in the UI to
   bring it back. Recommendation: add the restore action so this interval can
   recover an accidental deletion.

META-62 remains blocked by the Codex app-managed worktree control limitation; it
does not block Postbot work. OPS-207 is now actionable backlog, not a blocker.

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

The next implementation-ready task is OPS-207. The media restore choice does not
block unrelated development work.
