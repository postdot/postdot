# SPEC-004 — Publication Content and Provider Capability Boundary

- Status: draft
- Scope: Source content, channel-specific publications, provider capabilities, and media lifecycle
- Provenance: [ISSUE-007](../ISSUES.md), [ISSUE-003](../ISSUES.md), provider contract review on 2026-08-29
- Research record: [DOMAIN-07 worklog](../worklogs/2026-08-29-DOMAIN-07.md)
- Related specifications: [SPEC-001](SPEC-001-v1-scope.md)
- Related decisions: [ADR-001](../decisions/ADR-001-separate-channel-from-publisher.md), [ADR-002](../decisions/ADR-002-separate-post-from-publication.md), [ADR-005](../decisions/ADR-005-use-sqlite-first-persistence.md), [ADR-008](../decisions/ADR-008-enforce-project-scoped-domain-state.md), [ADR-009](../decisions/ADR-009-fence-external-effects-with-durable-claims.md), [ADR-011](../decisions/ADR-011-select-linkedin-member-text-publisher.md)
- Superseded by: none

> This is an exploration draft. It records the problem, evidence, requirements,
> alternatives, and unresolved choices. It does not authorize a schema or provider
> implementation until the project owner accepts a target direction.

## Intent

Define a durable boundary between Herald's source content, a channel-specific
publication, provider capabilities, and provider API payloads. The boundary must
support the existing distinction between `Post`, `Publication`, `Channel`, and
optional `Publisher` without allowing the first provider's request format to become
the domain model.

The boundary must also make a deliberate V1 decision about media instead of
silently allowing the absence of media concepts to become an accidental contract.

## Owner direction recorded on 2026-08-29

The project owner has directed that:

- V1 must include a bounded media capability rather than remaining text-only.
- A channel must be able to express relevant destination requirements without
  turning Herald into a universal provider-schema engine.
- Shared publication primitives should cover the common case, while a channel
  publication may carry a precise adaptation when interoperability requires it.
- The web editor should expose destination constraints reactively. API, CLI, and
  MCP requests must use server-side validation and reject invalid content before
  an external effect.
- A publication must persist the content snapshot that it represents.
- Local storage and an S3-compatible backend should remain viable options while
  the single-process, self-hosted footprint remains a primary constraint.
- Competitor analysis is research input, not a commitment to feature parity.

The exact V1 media kinds, common content vocabulary, snapshot revision boundary,
capability contract, and storage rollout remain unresolved in this draft.

## Observed current state

- `Post` stores a title and one non-empty text string.
- `Publication` stores one text string, a post reference, a channel reference,
  scheduling and lifecycle state, attribution, and one external identifier and URL.
- `Channel` stores a project and a name. `Publisher` stores a channel and a string
  kind.
- The current provider contract accepts a LinkedIn member identifier and a text
  commentary string. Its adapter maps those values directly to the LinkedIn Posts
  API payload.
- No domain, persistence, API, or storage contract represents an attachment, a
  media upload, a rich-text mark, a mention, a link preview, a poll, or a provider
  capability declaration.
- [SPEC-001](SPEC-001-v1-scope.md) currently describes the first workflow as
  text-first and places basic media attachments after the core V1 scenarios. The
  owner direction recorded above supersedes that part of the draft scope in
  principle, but the exact bounded media cut must be accepted before SPEC-001 is
  amended. [ISSUE-003](../ISSUES.md) remains open for the storage boundary.

## Provider evidence

The following providers are representative evidence, not a commitment to implement
them in V1:

| Destination | Publication shape | Media behavior | Additional constraints |
| --- | --- | --- | --- |
| Manual custom channel | Operator-provided destination action | Outside Herald's automated provider API | The content must remain inspectable and actionable without a provider adapter |
| LinkedIn member post | JSON with commentary, visibility, distribution, lifecycle, and optional nested content | Media is uploaded first and referenced by a provider media URN | The author is a provider URN; the API is versioned; media and other content types have provider-specific schemas |
| Mastodon status | Form fields such as status, media IDs, poll, visibility, language, and scheduling | Media is uploaded separately and attached through provider IDs | Media and polls are mutually constrained; the provider supports an idempotency key with a bounded retention period |

These differences show that the common domain cannot be a provider payload union
disguised as a generic object. The common boundary must express only concepts that
are meaningful to Herald, while adapters retain provider-specific request mapping,
capability checks, and response interpretation.

Sources:

- [LinkedIn Posts API schema](https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/post-api-schema)
- [LinkedIn Images API](https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/images-api)
- [Mastodon statuses API](https://docs.joinmastodon.org/methods/statuses/)
- [Mastodon media API](https://docs.joinmastodon.org/methods/media/)

## Comparative study

The 2026-08-29 study inspected Postiz, Mixpost, and OpenPost in disposable clones.
It did not install dependencies or copy competitor code into Herald. The complete
evidence record is [DOMAIN-07](../worklogs/2026-08-29-DOMAIN-07.md).

The useful patterns are:

- Postiz validates provider-specific settings and media rules before scheduling,
  but its inspected post model couples a post to one integration and stores
  provider settings as a payload alongside the post.
- Mixpost has account-specific content versions and reactive editor limits. Its
  JSON content and broad filesystem/conversion layer are convenient, but leave
  more invariants implicit than the contract Herald is seeking.
- OpenPost separates source content, target renditions, media assets, provider
  media delivery, and durable delivery attempts. Its typed capability resolver is
  especially relevant, while its rendition, connector, and delivery layers are
  more than Herald needs before a concrete V1 use case requires them.

These findings support a small typed capability boundary and explicit target
snapshots. They do not justify importing a separate rendition aggregate, a generic
connector protocol, or a complete media-processing subsystem into Herald V1.

## Requirements to resolve

### Source and publication semantics

- A source post must remain distinct from each channel publication.
- A publication must be independently schedulable, executable, auditable, and
  reconcilable.
- Creating a publication must establish which source content and channel-specific
  adaptation it represents. Later edits must not silently change a scheduled or
  published payload.
- The model must distinguish authoring content from the provider request generated
  at execution time.
- A manual channel must not require a publisher-specific content schema merely to
  record or complete a publication.

### Common content boundary

- The common content contract must represent the V1 content types explicitly
  supported by Herald.
- V1 media support must be bounded to an explicitly accepted set of media kinds,
  formats, limits, and lifecycle states.
- Unsupported content must fail validation before an external effect starts, with a
  reason that identifies the missing capability.
- Provider-specific features may be exposed only through an explicit provider
  boundary; they must not add arbitrary unvalidated fields to core domain records.
- The representation must preserve content ordering and any metadata required for
  accessibility or provider adaptation when those concepts enter the supported
  scope.

### Provider capabilities and renditions

- A publisher adapter must be able to declare or enforce the capabilities and
  limits relevant to its supported content.
- Capability descriptors must be typed, deterministic, versioned, and usable by
  both the web editor and the shared server-side validator.
- Provider-specific settings must be a bounded typed set with explicit validation,
  not an arbitrary schema supplied by a channel row.
- Capability validation must be deterministic and testable without a live provider.
- Provider payloads may contain identifiers, wrappers, or rules that do not belong
  in the common domain model.
- The design must state whether a publication stores a target-specific rendition,
  derives it at execution time, or supports both for different content classes.
- The design must define what is persisted after a provider transforms or uploads a
  local asset, including the relationship between local and remote identifiers.

### Attachments and storage

- If media enters V1, the model must define project ownership, allowed media types,
  byte limits, checksums, dimensions or duration where relevant, accessibility
  metadata, upload/processing state, and deletion behavior.
- A publication must be able to refer to an ordered subset or adaptation of a
  project's media without duplicating raw bytes in every publication row.
- Local storage must work for the single-process self-hosted deployment. A future
  S3-compatible implementation must be possible without placing provider payloads
  or storage credentials in the core domain.
- The storage seam must not leak Bun file objects, provider SDK objects, or storage
  credentials into the domain contract.
- Backup and restore must cover metadata and local media consistently when local
  media is supported.
- Unreferenced, failed, and provider-uploaded temporary objects need explicit
  retention and cleanup rules.

### Lifecycle and results

- Publication lifecycle state must remain separate from job execution state.
- A provider response must be represented without assuming every provider returns a
  stable URL, a single identifier, or a synchronous result.
- Ambiguous outcomes must remain reconcilable even when a provider has multiple
  remote objects or a media upload succeeded before the final post request failed.
- Revisions, retries, and reconciliation must not cause Herald to lose the exact
  content or attachment references used for an attempted external effect.

## Candidate boundaries

These are alternatives for review, not selected decisions.

### A. Bounded common document with attachment references

Keep the common model small: a body plus ordered references to project media and
the minimal accepted accessibility metadata. Provider adapters remain responsible
for all other features.

- Strengths: small schema and bundle impact, easy to validate, and directly
  compatible with the owner's bounded V1 media direction.
- Risks: rich links, mentions, polls, threads, and accessibility metadata may be
  require deliberate additions later.
- Best fit: a deliberately narrow V1 where only text and basic media are needed.

### B. Structured common document with per-publication target snapshots

Represent supported authoring content as a typed document, then persist a
channel-specific target snapshot or revision for each publication. Adapters compile
the snapshot into provider payloads.

- Strengths: preserves source intent, makes adaptations and validation explicit, and
  supports provider differences without storing raw provider payloads in core.
- Risks: the document vocabulary, revision semantics, and migrations require more
  design before implementation.
- Best fit: a product expected to grow beyond one text-only provider while keeping a
  bounded common vocabulary.

### C. Provider payloads stored as opaque JSON

Let each publication store a provider-specific payload or options object and let the
adapter interpret it.

- Strengths: quick to add provider-specific features and close to external APIs.
- Risks: weak domain validation, provider leakage, difficult migrations, poor manual
  channel semantics, and opaque API contracts.
- Best fit: isolated adapter-owned metadata, not the primary Herald content model.

### D. Universal social-network schema

Model every anticipated feature—threads, polls, carousels, articles, documents,
mentions, moderation controls, targeting, and analytics—in one cross-provider
schema.

- Strengths: superficially uniform API contracts.
- Risks: high permanent complexity, lowest-common-denominator behavior, and
  premature decisions about providers that may never be supported.
- Best fit: none identified for the current V1 constraints.

## Decisions requiring project-owner acceptance

1. Confirm the V1 media cut: still images only, or another concrete media kind as
   well? If still images only, confirm the initial formats and limits.
2. Confirm the common content vocabulary: body and ordered image references only,
   or title, links, mentions, and other metadata in the first contract?
3. Confirm that a publication stores an explicit target snapshot and that source
   edits never silently mutate it. Decide whether draft revisions are mutable until
   scheduling and whether the first attempted revision becomes immutable.
4. Confirm that publisher capabilities are typed, versioned constraints with a
   bounded set of typed settings, rather than an arbitrary channel-defined schema.
5. Confirm local storage as the default and S3/R2 as an alternative behind a small
   Herald-owned interface, with no FlyDrive dependency in V1 unless a concrete need
   appears.

## Draft acceptance criteria

This specification can become normative only after it contains an accepted answer to
the decisions above and demonstrates:

- at least one text-only manual publication;
- at least one automatic provider with a provider-specific payload;
- a content-capability rejection before the external-effect boundary;
- a web-editor capability response that exposes the same constraints used by the
  server validator;
- a publication retry that uses the same persisted target content and media
  references;
- an ambiguous result that preserves enough local information for reconciliation;
- the accepted V1 media kinds, limits, project ownership, and storage lifecycle;
- local media storage with metadata/backup coverage and an optional S3/R2 contract
  test when that backend is enabled;
- executable domain and database invariants for project ownership, publication
  identity, content validity, and lifecycle transitions.

## Out of scope until accepted

- Changing the current database schema or migrations.
- Adding a media storage implementation or a second provider.
- Running a live provider smoke test as evidence for the model.
- Accepting ADR-011 or closing PUB-09 based only on the current text adapter.

## Consequence of leaving this draft unresolved

The current text-only adapter can continue to serve as a bounded protocol spike, but
it must not be treated as the durable publication contract. Any implementation that
adds the V1 media or capability boundary before this draft is resolved risks making
an accidental first-provider shape part of the core domain. Once the exact media cut
is accepted, SPEC-001 must be amended before implementation changes the V1 scope.
