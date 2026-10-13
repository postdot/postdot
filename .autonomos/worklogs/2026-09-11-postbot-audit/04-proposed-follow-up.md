# Proposed follow-up for future sessions

This document proposes an order of work; it accepts no new architecture and creates no task. Horizons describe maturity stages, not a schedule promise. [SPEC-005](./.autonomos/specs/SPEC-005-continuous-product-scope.md) remains the continuous-development frame; a V1 does not need to be invented to restore order.

## Near term — restore already-promised guarantees

| Order | Proposed session | Why now | Exit criterion |
| --- | --- | --- | --- |
| 1 | Authorize every mutation, H-01 | Read-only access is already offered to users | Owner/editor/viewer/project-key matrix covers every route family; denials leave no writes or effects |
| 2 | Revoke long-lived connections, H-02 | Removed access must stop observing a project | Open stream closes or reauthorizes within a defined delay after removal, ban, and expiration |
| 3 | Make Queue/calendar exhaustive, H-03 | The central function becomes misleading at 101 publications | Stable pagination and interval-based calendar reads; multi-page, filter, and historical-state tests |
| 4 | Catch up notifications and event contract, H-04/H-05 | The journal must feed the views it promises | Catch-up completes without a new commit; tag changes are visible between two clients |
| 5 | Fix cleanup and inventory the gate, H-06/H-07 | Small changes protect future sessions | Migrations survive clean; CLI and script tests are mandatory in check |

Verification should accompany every correction rather than being postponed to the fifth session. Small independent H-06/H-07 fixes can be handled earlier when useful. For H-01, start with a reproduction that must fail before generalizing the boundary; this avoids fixing only the two demonstrated routes.

At this stage, defer new providers and new analytics surfaces. This is not a judgment against their value; immediate return comes from making existing capabilities reliable.

## Medium term — prove durable use and reduce change cost

1. **Shutdown and recovery.** Test SIGTERM during a slow simulated provider effect, during projection, and during a media operation. Verify draining, final records, and lock ownership. Define behavior after a forced stop.
2. **Retained database.** Decide when data stops being disposable. From that point, test every migration against a populated prior state; verify media restore and decryption in an isolated local environment. Keep requirements for real S3 separate.
3. **Integration matrix.** Cross role × operation × publication state × delivery mode, then add essential transitions: access removal, revision conflict, restart, network loss, ignored event, and disconnected recipient. Seek risk coverage rather than an arbitrary test count.
4. **Web reads and invalidation.** After the paginated contract, split reads by useful resource and measure refreshes. Require usable partial states when a secondary resource fails. Keep shared UI primitives and localization.
5. **Operational experience.** Show scheduler lag, ambiguous jobs, connections needing renewal, last successful projection, and backup state clearly. Metrics should support decisions; do not display a green light for untreated lag.
6. **Current documentation.** A short page should describe actually usable capabilities, deployment constraints, and provider evidence. ADRs keep rationale; worklogs keep history. Decide the status of the shipped real-time prototype.

Expected outcome: one real controlled scenario can be executed, interrupted, resumed, and explained from product tools; role, history, and recovery guarantees remain true on an old shared project.

## Long term — expand on evidence

**Providers.** Deepen support for used providers: expiration and rotation, scope changes, media, ambiguous responses, limits, and API compatibility. Keep common conformance, but do not confuse mock success with provider validation. Public trials remain deliberately authorized actions in their sessions.

**Analytics.** Preserve separation between Postbot behavior and external engagement. Require explicit provenance, freshness, and historical coverage. Build another projection only when cost or latency measurements justify it, reusing existing contracts instead of duplicating them.

**Capacity and architecture.** Measure database sizes, query time, maximum publication lag, memory, and contention at representative volumes. Consider project fairness or bounded concurrency before distributed infrastructure. SQLite remains defensible while measurements meet retained objectives.

**Maintenance.** Every new function should name its domain owner, access policy, change event, recovery strategy, backup/migration impact, and proof of behavior. This small integration contract is more useful than another generic abstraction layer.

## Not recommended by current evidence

- Rewriting Postbot or replacing the stack to standardize style.
- Redis, Temporal, microservices, or multiple workers without prior measurement.
- A universal repository/plugin layer that hides existing transactions.
- More ADRs or tests without a precise behavior to protect.
- A single global coverage percentage as a sufficient reliability criterion.

The proposed direction is to **consolidate existing contracts, prove data and access lifetime, then expand the product**. Fundamental concepts deserve preservation; integration evidence must catch up with the feature surface.
