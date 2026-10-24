# Historical tasks: realtime and foundation maintenance

Source: .autonomos/TASKS.md. Records retain their original wording and status;
archive placement does not create a completion date or a new current rule.

- [x] **[REALTIME-96]** Define and implement reconnectable project updates for the web client `Priority: 🟠` `Complexity: L`
- [x] **[REALTIME-102]** Establish the authenticated SSE transport from the durable event journal `Priority: 🟠` `Complexity: L`
- [x] **[REALTIME-103]** Integrate the authenticated SSE transport into the production web Query boundary `Priority: 🟠` `Complexity: L`
- [x] **[REALTIME-104]** Replace per-connection journal polling with a process-level wakeup and projection bridge `Priority: 🟠` `Complexity: L`
- [x] **[REALTIME-105]** Establish the post-commit project signal boundary and remove normal realtime SQLite polling `Priority: 🟠` `Complexity: L`
- [x] **[REALTIME-106]** Validate realtime restart, reconnect, zero-subscriber, and burst-load behavior `Priority: 🟠` `Complexity: M`
- [x] **[FOUND-570]** Assess foundation dependency stability before release `Priority: 🟠` `Complexity: M` — ISSUE-189; installed versions, production coupling and primary-source evidence assessed. Owner clarification withdraws the initial freeze proposal: prereleases are acceptable before users/stable release, TypeScript has no reproduced issue, and TanStack DB is not restricted as a development tool. Revised ADR-092 recommends routine Bun maintenance/alignment; no dependency changed. [Evidence](worklogs/2026-10-23-FOUND-570.md).
- [x] **[FOUND-571]** Maintain Bun and retire the completed realtime experiment `Priority: 🟠` `Complexity: M` — Bun 1.4.4 and matching types/engine/image declarations aligned; unused Query/DB comparison experiment, dependencies and translations retired. Autonomos ISSUE-03 registered locally. 1,566 unit/script tests, 140 browser cases, 21 builds and container recovery pass; final locale cleanup preserves every production file byte-for-byte. [Evidence](worklogs/2026-10-23-FOUND-571.md).
