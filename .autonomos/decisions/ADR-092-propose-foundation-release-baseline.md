# ADR-092 — Proposed Foundation Release Baseline

- Status: proposed — awaiting owner review
- Scope: ISSUE-189; Bun, Elysia and its integration family, TypeScript and TanStack DB
- Provenance: FOUND-570 assessment authorized after PROV-569
- Related: ADR-004, ADR-083, ADR-091, RELEASE-303
- Evidence date: 2026-10-23; source revision `78f444456`

## Problem and evidence

A release needs a reproducible, reviewed dependency baseline. A prerelease label,
a recent major version and a development-only experiment have different failure
surfaces. Passing the existing suite establishes compatibility at a revision; it
does not establish upstream support guarantees or future compatibility.

The current production image and CI select Bun 1.4.2. The local executable reports
`bun --version` as 1.4.3, but `bun --revision` identifies
`1.4.3-canary.1+620b50f6a`. The local gate and production image therefore do not use
the same runtime. CI and Docker install with `--frozen-lockfile`, which already
protects resolved JavaScript dependencies during ordinary builds. Docker tags are
versioned but not immutable digest references.

| Foundation | Declared / installed baseline | Actual exposure | Recommended position |
| --- | --- | --- | --- |
| Bun | `bun@1.4.2`; engines `>=1.4.2`; Docker 1.4.2; local canary above | Production HTTP, SQLite, media, process lifecycle, build and tests | Retain Bun; qualify stable 1.4.4 as one aligned baseline before release |
| Elysia family | Elysia `^2.0.0-exp.64` resolves exp.64; Eden 2.0.0-beta.2; static 2.0.0-beta.2; OpenAPI 2.0.0-exp.0 | Production transport, auth macros, schema validation, OpenAPI and inferred browser contracts | Retain the tested tuple temporarily; pin direct compatibility dependencies exactly and explicitly accept its prerelease risk |
| TypeScript | 7.0.2, exact across workspaces | Development checks and tooling; application builds use Bun/Vite/Next | Keep 7.0.2; no downgrade or beta adoption without a demonstrated compatibility need |
| TanStack DB | React DB `^0.5.0` resolves 0.5.0; query collection `^1.3.1` resolves 1.3.1; both resolve DB 0.11.0 | Development-only realtime prototype and tests | Keep isolated; use exact development dependency declarations, retain the production exclusion |

TanStack Query 5.104.0 owns normal project server data; it is not TanStack DB.
The prototype route uses a development-only dynamic import and redirects in
production. The DB adapter is not a second production persistence layer. WEB-557
recorded a production asset audit and browser acceptance for this exclusion;
source inspection at this revision confirms the same import boundary.

## Upstream findings

1. [Elysia 2's migration announcement](https://next.elysiajs.com/blog/elysia-20/)
   describes a rewrite, plugin transition and TypeBox migration. Registry metadata
   currently exposes 1.4.30 as Elysia's `latest`, beta.32 as `next` and rc.0 as `rc`.
   Eden and static have separate release tags; the installed OpenAPI package still
   exposes only an experimental 2.x tag. These are independent compatibility
   surfaces, not a reason to update one package to its newest tag in isolation.
2. [TypeScript 7's release announcement](https://devblogs.microsoft.com/typescript/announcing-typescript-7-0/)
   identifies a published native compiler and distinguishes it from the stable
   programmatic compiler API. The installed package exposes explicitly unstable
   API subpaths. Repository-owned source does not import the compiler API.
   Retaining 7.0.2 is different from adopting a preview compiler. Tools requiring
   the older API can use Microsoft's documented side-by-side TypeScript 6 route;
   that compatibility work would need a reproduced failing tool first.
3. [TanStack DB's own repository](https://github.com/TanStack/db) labels it beta.
   The query adapter's 1.x version does not change the state of the DB engine it
   depends on. Its current production exclusion materially lowers product risk.
4. [Bun 1.4.3 release notes](https://bun.sh/blog/bun-v1.4.3) describe TLS verification
   changes, including certificate-name validation hardening. [Bun 1.4.4](https://bun.sh/blog/bun-v1.4.4),
   released October 22, includes further security fixes affecting runtime and
   package-manager surfaces. Because Postdot performs outbound HTTPS and media
   processing, retaining 1.4.2 indefinitely is not the recommended release policy.
   This is a patch-priority finding, not a demonstration of exploitation here.
5. [Bun's upgrade guidance](https://bun.com/guides/util/upgrade) explicitly separates
   stable and canary channels. The host's canary must not stand in for stable
   runtime qualification.

Registry tags were read directly from npm's primary package metadata during the
assessment. They are a dated observation, not automatic upgrade instructions:
[Elysia](https://registry.npmjs.org/-/package/elysia/dist-tags),
[Eden](https://registry.npmjs.org/-/package/%40elysia%2Feden/dist-tags),
[static](https://registry.npmjs.org/-/package/%40elysia%2Fstatic/dist-tags),
[OpenAPI](https://registry.npmjs.org/-/package/%40elysiajs%2Fopenapi/dist-tags),
[TypeScript](https://registry.npmjs.org/-/package/typescript/dist-tags),
[Bun](https://registry.npmjs.org/-/package/bun/dist-tags).

## Alternatives and trade-offs

**Freeze everything unchanged.** Lowest immediate code churn and existing local
compatibility evidence, but preserves host/CI drift and omits subsequent Bun
security fixes. Not recommended as the release baseline. Exact pins do not replace
ongoing patch review.

**Align Bun and constrain the tested stack.** Recommended. It preserves the current
architecture, reduces accidental dependency movement and addresses the concrete
runtime drift. It still requires explicit acceptance of Elysia's experimental
family and a fresh qualification of the chosen stable Bun patch.

**Move Elysia to RC or stable 1.x now.** Credible if its current transport proves
unmaintainable. Neither is a manifest-only safety fix: route syntax, auth mounting,
TypeBox, plugins, error handling and Eden inference must migrate together. Current
passing evidence does not justify that cost before fixing the runtime baseline.

**Move Bun to Node.js or another runtime.** This is an architecture migration, not
a fallback switch. Native SQLite, image processing, S3, file IO and serving need
replacement adapters plus recovery and footprint validation. ADR-004 does not
promise Node portability. Do not prepare an unused second runtime in this task.

**Remove the TanStack DB experiment.** Reversible and would reduce development
maintenance, but is unnecessary for the current production boundary. Preserve the
existing experiment unless the owner chooses to retire it; do not widen its use.

## Proposed single implementation batch

Subject to owner approval:

1. Qualify stable Bun 1.4.4 without replacing the operator's global executable.
   Align the declared package manager, supported minimum, CI selection and all
   Docker stages with that tested patch. Record full revisions and base-image
   digests for release evidence; review immutable base-image references as part
   of that same packaging change. If the candidate fails, investigate before
   selecting another stable patch; do not silently fall back to a canary.
2. Pin the currently installed Elysia family and its direct schema compatibility
   bridge exactly. Preserve Eden 2.0.0-beta.2, static 2.0.0-beta.2, OpenAPI
   2.0.0-exp.0, TypeBox 1.3.34, exact-mirror 1.2.6 and drizzle-typebox 0.3.3 as the
   starting tuple. Do not upgrade a framework/plugin independently. Retain frozen
   lockfile installs and inspect the resulting resolution diff.
3. Keep TypeScript 7.0.2 and the existing checker, lint and formatting tools.
   Move the two TanStack DB adapter declarations to exact development dependencies
   and preserve their matching DB 0.11.0 resolution. No production data-layer or
   formatter replacement belongs in this batch.
4. Validate the completed batch once as a cross-cutting runtime milestone: static
   and unit gates, typed client contracts, production builds, browser acceptance,
   real automatic loopback effects and production-container recovery. Include
   startup/termination, auth, SSE, SQLite contention/backup/restore, media and
   outbound-network refusal paths. Finish generation/build/container work before
   the isolated browser phase. Keep remote native ARM64 release qualification
   under RELEASE-303; local AMD64 evidence cannot substitute for it.

No version change, global runtime change, image publication or remote CI dispatch
has been performed by this assessment.

## Review and exit paths

- **Bun:** Review stable security fixes before each release. Validate a candidate again
  when serving, TLS, SQLite, media or process regressions are reported. Keep the
  last validated image and a pre-upgrade complete backup. A runtime or schema
  downgrade must not be assumed safe against a database already opened/migrated
  by newer code; rehearse restoration instead.
- **Elysia:** Revisit the temporary pin before the first stable product release,
  when a compatible stable 2.x family exists, when a security fix is needed, or
  when a reproduced auth/schema/bundling defect has no maintainable fix. Prefer a
  coordinated 2.x migration first. If that fails, scope a transport replacement
  behind existing domain/store/provider boundaries, preserve HTTP/OpenAPI
  contracts, and deliberately replace Eden's inferred client boundary. Retaining
  one experimental tuple forever is not the accepted exit strategy.
- **TypeScript:** Revisit on an actual compiler/editor/tooling incompatibility.
  A tool needing the 6.x API can be isolated with the documented compatibility
  package. A whole-workspace compiler downgrade requires checking configuration,
  declaration emission and the Eden compile-time contracts. Do not infer such a
  downgrade is needed merely from the major version number.
- **TanStack DB:** A production adoption proposal must separately compare it with
  the existing Query/SSE model and prove authorization, reconnect, stale state and
  source-of-truth semantics. If the experiment stops being useful, remove its
  route, adapter, tests and dependencies without touching production state.

## Owner decision requested

Approve the recommended aligned baseline and temporary, explicit Elysia risk
position as one batch, or choose a framework migration instead. This proposal is
not an accepted architecture decision until that review. ISSUE-189 remains open
until the positions are accepted; completing the assessment does not approve the
implementation or authorize a release.
