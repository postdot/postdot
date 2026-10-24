# Runtime, recovery and observability history

Settled runtime isolation, migration/gate protection, graceful shutdown, worker
fairness and renewable effects, deployment/recovery acceptance, metrics/logging,
SQLite durability and build-context hygiene.

- [Tasks](TASKS.md): 32 completed scoped implementation/evaluation records.
- [Issues](ISSUES.md): 18 resolved records, retaining original status wording.
- [Retired current-claim provenance](current-claim-provenance.md): original ISSUE-114 classification.
- Worklogs retain original file names; old literal paths map by unchanged name.
- OPS-193, NOTIFY-199/200, WORKFLOW-201 and OPS-208 use shared
  [AUDIT-189](../../worklogs/2026-09-22-AUDIT-189.md), its
  [closeout](../../worklogs/2026-09-24-AUDIT-189-closeout.md), related resolved
  issue text and later implementation evidence. Those broader audits stay current.
- Earlier serial-fairness conclusions in OPS-151/WORKFLOW-201 describe their
  original scope. Current accepted ADR-090 governs two internal slots, one effect
  per project, renewal and cooperative deadlines in one process/logical worker.
- OPS-371 evaluated automatic backups; that proposal was withdrawn. OPS-376 and
  the current backup/restoration guide preserve administrator-owned scheduling,
  retention and recovery review. OPS-377 implements recovery hold, not provider
  reconciliation or a guarantee against repeated remote effects after rollback.
- ISSUE-127 remains accepted: the flock experiment proves only feasibility on
  its tested Linux host. ADR-068 remains proposed; no kernel lock was adopted.
- ISSUE-114/115 retain external-notification and transactional-email limits.
  NOTIFY-354's later personal SMTP alerts do not turn authentication mail into
  durable delivery or imply Ntfy/Telegram transport support. Its evidence stays current.
- ISSUE-175 remains open: earlier shutdown/hangup fixes do not establish the cause
  of the separately observed later retained-process incident.
- Historical ISSUE-122 describes the first metrics endpoint; ISSUE-125 and OPS-212
  add opt-in bearer protection. Current metrics are disabled by default.
- ISSUE-176 remains current with its broader TELEGRAM-499 build-context evidence;
  BUILD-556 implementation evidence is moved here without closing other work.
- Current accepted ADR-089 covers WAL/FULL/5-second contention and safe destination
  WAL retirement. Backup guides and scoped API/database guidance remain current.

Moved by META-576 on 2026-10-24. Historical text, IDs and recorded evidence remain
intact apart from Markdown path repairs. No missing completion date was inferred.
No production, runtime, backup, restore or provider action was repeated here.
