# Project Issues

## [ISSUE-001] Validate the complete production distribution path

- Type: proposal
- Status: resolved
- Evidence: Herald is intended to run as one self-hosted process, but the current
  repository has not yet proven the complete path from production build to a
  runnable application image with the dashboard, API, database migrations, health
  checks, backup, restore, and resource measurements.
- Impact: Missing a broken packaging or serving boundary late would make the
  single-process deployment promise expensive to repair.
- Desired outcome: A reproducible production distribution artifact and an end-to-end
  validation procedure that exercise the supported runtime chain within the accepted
  footprint budgets.
- Tasks: OPS-10 (completed)
- Resolution: The repository now builds a single-process Bun runtime image with the
  API bundle, dashboard, migrations, healthcheck, and persistent SQLite volume. The
  documented backup and restore commands and the Linux amd64 footprint measurements
  were exercised against the real image.
- Decision: [ADR-010](decisions/ADR-010-use-bun-runtime-image-for-v1-packaging.md)

## [ISSUE-003] Define the media attachment boundary and storage lifecycle

- Type: proposal
- Status: accepted
- Evidence: The owner direction requires a durable media foundation rather than a
  release-limited media cut. Local self-hosting and a Bun-native S3-compatible
  backend affect metadata, cleanup, backup, security, and publisher contracts. The
  [DOMAIN-07 worklog](worklogs/2026-08-29-DOMAIN-07.md) records the comparative study
  and the accepted model for media families, original assets, derived variants,
  publication-revision references, provider delivery, and storage lifecycle.
- Impact: Deferring the ownership and lifecycle model too long could force a costly
  rewrite. Designing every conceivable storage backend would violate the
  SQLite-first, evidence-driven scope posture, but local and S3-compatible storage
  are already part of the intended boundary.
- Desired outcome: An explicit decision about the media model, file metadata,
  retention, backup, access control, and one interchangeable storage contract with
  local and S3-compatible implementations.
- Tasks: DOMAIN-07 (completed), MEDIA-22, MEDIA-23, MEDIA-24
- Decision: [ADR-019](decisions/ADR-019-separate-media-assets-representations-and-deliveries.md)

## [ISSUE-004] Establish a reusable Herald design-system package

- Type: proposal
- Status: resolved
- Evidence: The dashboard already uses Tailwind CSS, shadcn/ui with Base UI, and
  Solar Icons React, while a future website and documentation surface should reuse
  the same visual language.
- Impact: Allowing application-local components and tokens to grow independently
  would make later extraction expensive and could produce inconsistent product
  surfaces.
- Desired outcome: A focused shared package for approved design tokens, Base UI-based
  components, project-specific variants, icon conventions, and Tailwind integration,
  with a clear ownership boundary and no Radix UI dependency.
- Tasks: DESIGN-29 (completed)
- Resolution: The private `@herald/ui` workspace package now owns shared Tailwind
  tokens, base styles, the Base UI Button primitive, and the class-composition
  utility. The web app consumes the package through public subpaths and keeps a
  thin local Tailwind entrypoint with explicit application and package source
  roots. [ADR-023](decisions/ADR-023-establish-shared-ui-package.md) records the
  ownership boundary.
- Decision: [ADR-023](decisions/ADR-023-establish-shared-ui-package.md)

## [ISSUE-005] Define a motion policy before adding an animation runtime

- Type: proposal
- Status: resolved
- Evidence: No motion policy exists yet, and GSAP is a possible solution for future
  interactions but would add runtime weight and another abstraction to the web
  surface.
- Impact: Adding animation infrastructure before a concrete interaction need could
  increase bundle size and visual inconsistency without improving the core workflow.
- Desired outcome: A small motion policy covering accessibility, interaction classes,
  performance budget, and the evidence required before introducing GSAP or another
  animation dependency.
- Tasks: DESIGN-30 (completed)
- Resolution: Herald now follows a native-first motion policy recorded in
  [ADR-024](decisions/ADR-024-adopt-a-native-first-motion-policy.md). The shared
  stylesheet honors reduced-motion preferences, existing transitions target
  bounded properties, and no animation runtime was added without a concrete
  interaction requirement.
- Decision: [ADR-024](decisions/ADR-024-adopt-a-native-first-motion-policy.md)

## [ISSUE-006] Separate publisher credentials from application authentication

- Type: problem
- Status: accepted
- Evidence: The current LinkedIn connection flow stores publisher OAuth credentials
  in Better Auth accounts, references those user-owned accounts directly from
  project-owned publisher connections, resolves worker tokens through Better Auth,
  and changes global account-linking policy to support the publisher use case.
- Impact: Application identity and publisher credential lifecycles have different
  ownership, deletion, transfer, revocation, and background-execution semantics.
  Keeping them coupled could make user or organization changes affect publication
  infrastructure and could force non-OAuth credentials into an identity model.
- Desired outcome: Better Auth provides email/password authentication into Herald,
  while Herald owns project-scoped publisher credentials and delegates only
  well-defined OAuth protocol mechanics to an evidence-backed dependency.
- Tasks: CRED-15, CRED-16, CRED-17, CRED-18, PUB-09 (blocked)
- Decision: [ADR-012](decisions/ADR-012-own-publisher-credentials-and-use-oauth4webapi.md)

## [ISSUE-007] Define the publication content and provider capability boundary

- Type: problem
- Status: accepted
- Evidence at opening: The `Post` and `Publication` records persisted plain text
  only, while the first publisher contract accepted a LinkedIn-specific text input.
  There was no domain representation for attachments, rich content, mentions,
  links, provider constraints, or a provider-specific publication rendition. The
  existing media question in ISSUE-003 covered storage lifecycle but not the
  publication content contract that would consume stored media. ADR-013 and
  ADR-014 accepted runtime-defined custom channel contracts and the
  draft-versus-execution revision boundary; SPEC-004 then defined source content,
  runtime schemas, HTTP mapping, profile evolution, and media behavior.
- Resolution evidence: SPEC-004 is now the accepted publication-content boundary.
  The implementation has established reusable media assets, immutable
  representations, exact publication-revision references, provider media
  deliveries, and provider-owned capability contracts. PUB-10 adds the first
  durable LinkedIn image-delivery slice without moving provider identifiers into
  reusable assets.
- Impact: Continuing with a provider integration before defining this boundary could
  make the first provider's payload shape leak into the core domain, force later
  rewrites for channels with different capabilities, and leave manual channels
  unable to represent content that cannot be automated. It is also unclear which
  content must be shared from a source post and which content may be adapted per
  publication.
- Desired outcome: An accepted durable boundary that defines the source post content,
  channel-specific publication content, provider capability validation, attachment
  references, publication snapshots and revisions, and the separation between
  common domain data and provider-specific payloads. The boundary must identify
  what is intentionally deferred and provide executable invariants for the chosen
  model without requiring every future social network to be designed in advance.
- Tasks: DOMAIN-07 (completed), DOMAIN-20, DOMAIN-21, MEDIA-24, CHANNEL-25, CHANNEL-26, EDITOR-27, PUB-10
- Specification: [SPEC-004](specs/SPEC-004-publication-content-boundary.md)
- Decisions: [ADR-013](decisions/ADR-013-runtime-defined-custom-channel-contracts.md), [ADR-014](decisions/ADR-014-separate-autosaved-drafts-from-execution-revisions.md), [ADR-015](decisions/ADR-015-use-a-small-semantic-source-content-vocabulary.md), [ADR-016](decisions/ADR-016-use-a-bounded-json-schema-runtime-profile.md), [ADR-017](decisions/ADR-017-use-versioned-webhooks-and-mapped-http-for-custom-channels.md), [ADR-018](decisions/ADR-018-restrict-custom-channel-network-egress.md), [ADR-019](decisions/ADR-019-separate-media-assets-representations-and-deliveries.md), [ADR-020](decisions/ADR-020-version-and-assess-channel-profile-changes.md), [ADR-021](decisions/ADR-021-channel-owns-profile-contract.md), [ADR-026](decisions/ADR-026-linkedin-single-image-delivery.md)

## [ISSUE-008] Make local API and web startup reproducible

- Type: problem
- Status: resolved
- Evidence: A local database created from an earlier migration history contains
  tables and migration records that do not match the five migrations currently
  committed. Starting the API then fails with a low-level `table account already
  exists` error. At the same time, the Vite development proxy always targets port
  `3000`, which is already used by another local project, so the Herald dashboard
  sends API requests to the wrong server when Herald's API is unavailable.
- Impact: A new contributor or operator cannot tell whether startup failed because
  of stale development data, a port collision, or a dashboard request failure.
  The resulting generic browser error obscures the actual integration boundary.
- Desired outcome: Document and exercise a clean local startup path, make the web
  development API target configurable without changing production same-origin
  behavior, and provide actionable migration failure context without weakening
  migration safety.
- Tasks: OPS-11 (completed)
- Resolution: The Vite development API target is now validated and configurable
  through `HERALD_API_ORIGIN`, while browser requests remain same-origin. The API
  keeps the default `3000` port, and alternate local ports are documented for both
  processes. Migration conflicts involving an existing schema object now fail
  closed with actionable context; no idempotent SQL or automatic reset was added.
