# SPEC-004 — Publication Content and Provider Capability Boundary

- Status: draft
- Scope: Source content, channel-specific publications, provider capabilities, and media lifecycle
- Provenance: [ISSUE-007](../ISSUES.md), [ISSUE-003](../ISSUES.md), provider contract review on 2026-08-29
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
- [SPEC-001](SPEC-001-v1-scope.md) makes the first workflow text-first and places
  basic media attachments after the core V1 scenarios unless the selected publisher
  requires them. [ISSUE-003](../ISSUES.md) remains open for the storage boundary.

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

### A. Text and attachment references only

Keep the common model small: text plus ordered references to project media, with
provider adapters responsible for all other features.

- Strengths: small schema and bundle impact, easy to validate, compatible with the
  current text-first workflow.
- Risks: rich links, mentions, polls, threads, and accessibility metadata may be
  forced into provider-specific escape hatches later.
- Best fit: a deliberately narrow V1 where only text and basic media are needed.

### B. Structured common content document with per-publication renditions

Represent supported authoring content as a typed document, then persist a
channel-specific rendition or revision for each publication. Adapters compile the
rendition into provider payloads.

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

1. Is V1 intentionally text-only, or must it include a bounded media capability?
2. If media is included, which media kinds and limits are required for the first
   validated workflow?
3. Should a publication persist a target-specific content snapshot at creation, or
   compile from source content at execution time? If both are allowed, which content
   is authoritative for retries and reconciliation?
4. Which common content concepts are in scope: plain text, links, mentions, alt text,
   visibility, language, polls, threads, or other features?
5. Which provider-specific options are allowed, and where are they validated and
   persisted without creating a generic provider configuration language?
6. Does local media storage belong in V1, or should the product explicitly reject
   attachments until a concrete provider and workflow require them?
7. What edit, revision, deletion, and retention semantics apply after a publication
   is scheduled, attempted, published, or made ambiguous?

## Draft acceptance criteria

This specification can become normative only after it contains an accepted answer to
the decisions above and demonstrates:

- at least one text-only manual publication;
- at least one automatic provider with a provider-specific payload;
- a content-capability rejection before the external-effect boundary;
- a publication retry that uses the same persisted content snapshot;
- an ambiguous result that preserves enough local information for reconciliation;
- a clear attachment decision, even if that decision is to defer storage entirely;
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
adds media, rich content, or another provider before this draft is resolved risks
making an accidental first-provider shape part of the core domain.
