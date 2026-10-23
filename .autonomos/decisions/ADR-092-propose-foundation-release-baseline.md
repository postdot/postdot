# ADR-092 — Revised Foundation Maintenance Proposal

- Status: proposed — initial freeze recommendation withdrawn after owner clarification
- Scope: ISSUE-189; dependency maintenance before the first stable product release
- Provenance: FOUND-570 assessment and owner clarification on 2026-10-23
- Related: ADR-004, ADR-083, ADR-091, RELEASE-303
- Evidence date: 2026-10-23; inventory source revision `78f444456`

## Owner direction

Before the product has users or its own stable release, using prerelease
foundations is acceptable. Their labels alone do not justify freezing versions,
downgrading tools or replacing the architecture. A hold needs a concrete
compatibility or regression reason and a condition for reviewing it again.

Review Bun's stable updates approximately every one to two weeks and apply them
with appropriate validation. Expected upstream improvements justify active
maintenance, not an indefinite baseline hold. No unattended upgrade or persistent
scheduler has been requested.

## Corrections to the initial proposal

**Elysia:** An exact manifest version selects one version until a deliberate
update. That is distinct from an indefinite freeze. The initial proposal was too
conservative in recommending holding the current integration family without a
reproduced defect. Keep ordinary lockfile reproducibility and follow compatible
Elysia 2 prereleases. Check Eden, plugins and schemas when updating; they need
compatible releases, not identical version numbers. No additional exact pinning
or wait for a stable Elysia release is proposed solely because of its label.

**TypeScript:** The assessment found no project problem requiring a compiler
change. Naming 7.0.2 as a special retention decision added no actionable value.
Treat it as ordinary toolchain maintenance. Investigate actual compiler, editor
or tooling incompatibilities when they occur; no special freeze or downgrade is
proposed.

**TanStack DB:** This is a product data library, not a development utility. Its
current repository use is a development-only realtime prototype; ordinary
production features use TanStack Query and SSE. That describes the existing
implementation, not a rule that DB must remain outside production. Its possible
adoption should be judged by product and data-flow needs. Beta status alone is
not a reason to forbid it. Neither promotion of the prototype nor relocation of
its dependency declarations is authorized by this clarification.

**Bun:** The concrete maintenance finding remains: the recorded host revision was
`1.4.3-canary.1+620b50f6a`, while CI and Docker selected 1.4.2. Align the validated
runtime used for development checks, CI and production packaging when upgrading.
Do not replace the operator's global executable implicitly.

## Evidence retained from the assessment

- Docker and CI use frozen lockfile installs. A lockfile records the tested
  dependency graph; it does not prevent deliberate updates.
- The inspected Elysia family comprised exp.64, Eden beta.2, static beta.2,
  OpenAPI exp.0 and their schema bridge. Those are dated inventory facts, not
  required future versions. The [Elysia 2 migration announcement](https://next.elysiajs.com/blog/elysia-20/)
  explains the coordinated framework/plugin transition.
- [TypeScript 7's release announcement](https://devblogs.microsoft.com/typescript/announcing-typescript-7-0/)
  and installed metadata distinguish the published compiler from its programmatic
  API surface. No repository-owned compiler-API import was found.
- The current prototype route is conditionally imported in development and
  redirects in production. WEB-557 records its prior asset/browser verification.
  [TanStack DB's repository](https://github.com/TanStack/db) describes the library;
  its beta label is not a deployment restriction.
- [Bun 1.4.3](https://bun.sh/blog/bun-v1.4.3) and
  [Bun 1.4.4](https://bun.sh/blog/bun-v1.4.4) include runtime/security fixes.
  [Bun's upgrade guidance](https://bun.com/guides/util/upgrade) distinguishes
  stable and canary channels. Review the latest stable candidate at implementation
  time rather than treating this dated inventory as a permanent target.

## Recommended next implementation

Perform one Bun maintenance and alignment batch: review the current stable
release, test it without changing the global executable, align declared/runtime
versions and packaging, and validate the completed change. Preserve existing
checker/formatter choices and avoid bundling a framework or client data-layer
migration into that runtime patch.

Continue Elysia prerelease maintenance as normal dependency work, checking actual
compatibility and recording any necessary hold. Revisit the broader stability
policy when preparing the first stable release or onboarding external users.

No dependency, runtime installation, application code, prototype visibility,
image publication or remote CI dispatch changed during this assessment or its
clarification. The initial four-part approval request is withdrawn; this revision
does not require an extra risk-acceptance ceremony for the already accepted use
of prereleases.
