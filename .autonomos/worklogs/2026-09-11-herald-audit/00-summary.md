# Herald — critical foundation audit

Date: 11 September 2026. Final reference: `main`, commit `60bbb319` (`merge: consolidate local work into main`). Diagnostic report only; no fix, normative decision, or backlog change was made.

## Verdict

**Herald has solid technical foundations, but integration consistency does not yet make every contract reliable.** The recommendation is to keep the architecture and spend the next sessions consolidating it before adding another functional expansion.

The Post / Publication model, Channel / Publisher separation, immutable revisions, transactional journal, and explicit recognition of ambiguous external outcomes address real product problems. The monolith with SQLite fits the intended deployment. Nothing in this audit justifies a rewrite, an immediate PostgreSQL migration, an external workflow engine, or microservices.

However, recent features do not always extend the existing guarantees. Roles are defined without being enforced everywhere; real-time protects connection opening but not connection lifetime; the calendar and Queue consume a truncated list; a durable projection can stop catching up while still reporting itself as active. These are product defects, not mere style preferences.

## Report index

1. [Security and access](01-security-and-access.md) — roles, revocation, and existing protections.
2. [Reliability, data, and operations](02-reliability-data-and-operations.md) — lists, notifications, cleanup, and process shutdown.
3. [Architecture, client, and quality](03-architecture-client-and-quality.md) — consistency, maintenance cost, and control blind spots.
4. [Proposed follow-up](04-proposed-follow-up.md) — recommended order and exit criteria for future sessions.
5. [Method and evidence](05-verification-and-evidence.md) — executed checks, reproductions, limits, and rejected hypotheses.

## Priority findings

| ID | Priority | Finding | Evidence |
| --- | --- | --- | --- |
| H-01 | P1 | A viewer can create a channel and a post despite having read-only access | In-memory API reproduction: HTTP 201 for both operations |
| H-02 | P1 | A removed member continues receiving project events on an already-open SSE stream | New request rejected with 404, later event received on the old stream |
| H-03 | P1 | The publication list is limited to 100 without usable pagination | 101 stored rows, 100 returned, no cursor in the response |
| H-04 | P2 | Notification catch-up stops after ten batches and can remain incomplete | Runtime requesting twelve batches: ten executed, state `started` |
| H-05 | P2 | Taxonomy events are excluded from SSE delivery | Real `publication.tags_replaced` event transformed to `null` |
| H-06 | P2 | The `clean` command deletes migrations tracked by Git | `@herald/db` script: `rimraf dist .turbo drizzle` |
| H-07 | P2 | Script and CLI tests are not part of `bun run check` | Turbo graph contains workspaces only; eight additional tests run separately |

P1 means the issue should be fixed before relying on the affected function in shared or supported use. P2 identifies a real defect with a narrower trigger or impact. No P0 was demonstrated. Preserving a database while displaying it incompletely is not the same as losing its data.

## Balanced assessment

| Area | Assessment |
| --- | --- |
| Domain model and durable publication | Good foundation; preserve the distinctions and invariants |
| Project isolation | Access controls exist; this audit does not demonstrate general cross-project traversal |
| Roles and revocation | Incomplete guarantee and reproduced defects |
| Media and secrets | Useful boundaries and substantial tests; not exhaustive certification |
| Web client | Real, tested surface, but dependent on an incomplete list contract and incomplete invalidation signals |
| Operations | Backup and restore are thoughtfully designed; restart and shutdown guarantees need work |
| Quality | Real checks pass; behavior matrix is still incomplete |

On the final state: `bun run check` succeeds, including **16 browser tests**. A separate forced run confirms **566 workspace tests passed without cache**. The **8 script tests** also pass when run explicitly. These results are a positive baseline, but they do not disprove the reproduced defects.

## Interpretation of agent-produced work

AI origin is not evidence of poor quality. The observable signs are those of slice-by-slice development: several parallel contracts, copied event tables, tests that follow added journeys, and old assumptions retained in functions now used more broadly.

Concrete examples: the move to collaboration did not replace the historical “an actor exists” check with a role check everywhere; adding tags did not extend the SSE event list; a bounded list became the calendar source. The next effort should focus on these joins and their negative scenarios, rather than on feature count or mechanical file splitting.

## Limits

This was a code and contract audit with isolated local tests. No real provider call, secret or user-data inspection, destructive test on an existing installation, full load test, real S3 validation, or new Docker build/restore campaign was performed. Visual findings are limited to browser-test evidence and client structure; this is not a new complete visual audit.
