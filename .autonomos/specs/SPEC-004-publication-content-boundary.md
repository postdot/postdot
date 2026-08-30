# SPEC-004 — Publication Content and Provider Capability Boundary

- Status: draft
- Scope: Source content, channel-specific publications, provider capabilities, and media lifecycle
- Provenance: [ISSUE-007](../ISSUES.md), [ISSUE-003](../ISSUES.md), provider contract review on 2026-08-29
- Research record: [DOMAIN-07 worklog](../worklogs/2026-08-29-DOMAIN-07.md)
- Related specifications: [SPEC-005](SPEC-005-continuous-product-scope.md)
- Related decisions: [ADR-001](../decisions/ADR-001-separate-channel-from-publisher.md), [ADR-002](../decisions/ADR-002-separate-post-from-publication.md), [ADR-005](../decisions/ADR-005-use-sqlite-first-persistence.md), [ADR-008](../decisions/ADR-008-enforce-project-scoped-domain-state.md), [ADR-009](../decisions/ADR-009-fence-external-effects-with-durable-claims.md), [ADR-011](../decisions/ADR-011-select-linkedin-member-text-publisher.md), [ADR-013](../decisions/ADR-013-runtime-defined-custom-channel-contracts.md), [ADR-014](../decisions/ADR-014-separate-autosaved-drafts-from-execution-revisions.md), [ADR-015](../decisions/ADR-015-use-a-small-semantic-source-content-vocabulary.md), [ADR-016](../decisions/ADR-016-use-a-bounded-json-schema-runtime-profile.md)
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

The boundary must make a deliberate decision about media and capabilities instead
of allowing the first provider or first storage backend to become an accidental
contract.

## Owner direction recorded on 2026-08-29

The project owner has directed that:

- Herald is developed continuously; there is no V1 or MVP release boundary that
  justifies temporary content or storage foundations.
- Media must be a durable, extensible part of the publication architecture rather
  than a text-only first implementation with a later retrofit.
- A channel must be able to express relevant destination requirements without
  turning Herald into a universal provider-schema engine.
- Shared publication primitives should cover the common case, while a channel
  publication may carry a precise adaptation when interoperability requires it.
- The web editor should expose destination constraints reactively. API, CLI, and
  MCP requests must use server-side validation and reject invalid content before
  an external effect.
- A publication must persist the content snapshot that it represents.
- Local storage and an S3-compatible backend must share an interchangeable Herald
  storage contract from the first media implementation. Local may be the default
  deployment configuration without being the only designed backend.
- Competitor analysis is research input, not a commitment to feature parity.
- Herald remains a publication manager whose primary destinations are social and
  adjacent publishing platforms. Custom channels extend destination coverage; they
  do not change the product's primary purpose into a generic workflow engine.
- A custom channel may define its complete content schema at runtime. Presets are
  optional accelerators that provide an editable starting profile, not a closed list
  of supported channel shapes.
- Built-in providers and custom channels must use the same persisted target-content
  boundary. Built-in providers may use statically typed schemas in code, while
  custom channels use validated, versioned runtime schemas and declarative request
  mappings.
- A publication explicitly chooses automatic or manual delivery. The presence or
  absence of a working channel connection must not silently change that choice.
- Web editing must preserve an auto-saved draft without promoting an intermediate
  working state to the scheduled target. Scheduling or applying changes is the
  explicit promotion to a target revision; an execution revision becomes immutable
  when an external effect starts.

The exact media kinds, common content vocabulary, runtime channel transport
contract, and schema-change handling remain unresolved in this draft.

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
- [SPEC-001](SPEC-001-v1-scope.md) is a superseded historical scope record. The
  current direction in [SPEC-005](SPEC-005-continuous-product-scope.md) requires
  the first durable media implementation to use an extensible contract. [ISSUE-003](../ISSUES.md)
  remains open for the storage boundary.

## Provider evidence

The following providers are representative evidence, not a commitment to reproduce
their complete feature sets:

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

## Current capability evidence

The official provider contracts reinforce that media support is a composition and
workflow problem, not only a MIME-type allowlist:

- LinkedIn's Posts API currently exposes text, images, videos, documents, articles,
  multi-image posts, and polls, with different availability for organic and
  sponsored posts. Its multi-image contract requires between two and twenty image
  assets, while its image upload contract has its own format and pixel constraints.
- Mastodon accepts media attachments, polls, visibility, language, replies, and
  quote-related options on a status. Media and polls are mutually exclusive, media
  uploads may complete asynchronously, and media accepts accessibility descriptions
  and focal-point metadata.

This is why a capability descriptor needs profiles, composition rules, dependencies,
conflicts, media constraints, asynchronous processing states, and typed settings. It
also confirms that those rules belong with each provider module and must be resolved
for the actual channel/account context.

Sources:

- [LinkedIn Posts API](https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/posts-api)
- [LinkedIn MultiImage API](https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/multiimage-post-api)
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
  especially relevant. Its rendition, connector, and delivery layers require a
  deliberate mapping to Herald's domain rather than wholesale adoption or dismissal.

These findings support typed capability modules, explicit target snapshots, and a
first-class media lifecycle. They do not justify copying an entire competitor stack
without mapping its primitives to Herald's domain. OpenPost's capability resolver,
media delivery model, and recovery evidence must be evaluated as candidate
foundations rather than dismissed solely because they contain more concepts than the
current code.

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

- The common content contract must represent the shared content types currently
  supported by Herald and provide a deliberate extension point for target-specific
  adaptations.
- Media support must be based on an explicitly accepted set of media kinds, formats,
  limits, processing states, and lifecycle states without hard-coding an artificial
  release-sized ceiling.
- Unsupported content must fail validation before an external effect starts, with a
  reason that identifies the missing capability.
- Provider-specific features may be exposed only through an explicit provider
  boundary; they must not add arbitrary unvalidated fields to core domain records.
- The representation must preserve content ordering and any metadata required for
  accessibility or provider adaptation when those concepts enter the supported
  scope.

### Provider capabilities and renditions

- Each provider or channel module must be able to declare or enforce the
  capabilities and limits relevant to its destination.
- Capability descriptors must be typed, deterministic, versioned, and usable by
  both the web editor and the shared server-side validator.
- Built-in provider settings must be a bounded typed set with explicit validation,
  owned by the provider module. A custom channel may instead supply a runtime schema,
  but that schema must be validated, versioned, bounded, and unable to execute code.
- Capability validation must be deterministic and testable without a live provider.
- Provider payloads may contain identifiers, wrappers, or rules that do not belong
  in the common domain model.
- The design must state whether a publication stores a target-specific rendition,
  derives it at execution time, or supports both for different content classes.

### Runtime-defined custom channels

Custom channels are first-class destinations rather than a fallback limited to a
fixed preset list. A channel created from a preset materializes its resolved profile
at creation time, after which the user may edit the profile. Later profile changes
create a new version and may require explicit review or migration of affected
publications. A channel may also define a new runtime schema when no preset is a
good fit.

The runtime-defined profile must contain, at minimum:

- a versioned data schema for the channel's target content;
- capability and constraint metadata for the web editor and shared validator;
- a declarative request mapping for the configured HTTP API;
- authentication and endpoint references without embedding secret values in content;
- media delivery requirements and response identity extraction rules;
- retry, idempotency, and failure-classification behavior where automatic delivery is
  enabled.

The schema describes data; it is not executable code. Request mappings must use a
bounded declarative vocabulary rather than evaluating user-provided scripts. A
future connector protocol may cover APIs that need provider-specific code, multi-step
OAuth, signatures, or complex media processing, but those concerns must remain
outside the runtime schema interpreter.

The design must define what is persisted after a provider transforms or uploads a
local asset, including the relationship between local and remote identifiers.

### Accepted runtime-profile contract

The owner accepted this contract on 2026-08-30. ADR-016 records the normative
decision; the candidate numeric ceilings below remain subject to implementation
measurements and adversarial tests.

A resolved channel profile contains three separate artifacts:

1. `contentSchema`: a structural schema for target content;
2. `fieldBindings`: Herald semantics attached to selected schema locations, such as
   primary text, ordered media references, accessibility text, title, or tags;
3. an optional `transport`: the automatic HTTP delivery contract. A manual channel
   has the first two artifacts and no transport.

Keeping these artifacts separate prevents JSON Schema annotations from becoming an
implicit execution language. It also lets the same content profile support manual
and automatic publications without changing the data that the publication revision
represents.

`contentSchema` uses the JSON Schema 2020-12 dialect. Built-in modules may author the
same contract with TypeBox and retain static TypeScript inference. Custom-channel
content remains `unknown` to TypeScript until its stored schema validates it. TypeBox
1.3 can compile both native JSON Schema and TypeBox-created schemas through the same
validator API, so Herald does not need a second runtime validator for this boundary.

The custom-channel dialect is intentionally a bounded profile of JSON Schema rather
than every possible vocabulary:

- the root value is an object and all object fields are explicit;
- standard scalar, object, array, enum, composition, and conditional validation
  keywords are allowed only after the profile validator recognizes them;
- references are limited to the same profile's `$defs`; remote references,
  `$dynamicRef`, user-controlled `$id`, custom vocabularies, and executable formats
  are rejected;
- `contentEncoding` and `contentMediaType` remain annotations and never cause Herald
  to decode or execute instance data;
- regular-expression keywords are rejected until Herald has a bounded regular-
  expression implementation; JavaScript backtracking expressions are not accepted
  from stored custom profiles;
- schema bytes, nesting depth, node count, properties, composition branches, and
  validated instance bytes have explicit hard limits. Arrays and strings must also
  have finite maxima;
- defaults are editor suggestions only. Validation never mutates a publication by
  inserting defaults or coercing values;
- a schema passes the JSON Schema meta-schema and Herald's stricter policy before it
  is compiled. Compiled validators are cached by immutable profile version and
  content hash rather than rebuilt for each request.

Candidate hard ceilings for the first implementation are a 64 KiB schema, depth 16,
256 schema nodes, 64 properties per object, 16 branches per composition keyword, and
a 1 MiB JSON target document before referenced media bytes. These are resource
ceilings, not destination capabilities: an individual channel normally declares much
smaller limits. The constants need adversarial and representative fixture tests
before this proposal becomes normative.

Structural validation is only the first layer. `fieldBindings` lets the shared
validator resolve project-owned media IDs and other domain references, enforce
ownership, and return stable issue codes. A built-in module may add deterministic
imperative rules for provider constraints that JSON Schema cannot express. All
layers return one normalized issue shape with a JSON Pointer location, code, message,
severity, and source so the web editor, API, CLI, and MCP report the same failure.

Representative profiles demonstrate the intended range:

| Profile | Target content | Bindings | Delivery |
| --- | --- | --- | --- |
| Custom microblog | Required `body` with an edited destination limit and an optional bounded media array | Primary text and ordered media | Manual, or one JSON/multipart HTTP request |
| Project blog | `title`, `body`, optional `slug`, `excerpt`, `tags`, and cover media | Title, long-form text, tags, and cover asset | One configured HTTP request when the blog API accepts it |
| Manual regional network | Destination-specific text and media fields | Primary text and ordered media | No transport; the operator completes and records the publication manually |

A target revision stores its validated content, field-binding/profile version, and
profile hash. It does not store a live pointer whose meaning changes when the channel
profile is edited.

### Candidate profile-evolution behavior

Channel profile versions are immutable after activation. Editing a channel creates a
new profile draft; it does not mutate the active profile in place. Activating the new
version has the following effects:

- new drafts use the new active profile;
- historical and in-flight execution revisions retain their exact old profile
  version and remain readable and retryable;
- existing working drafts are revalidated against the new profile and marked
  `compatible` or `review_required`, with normalized issues for fields that no longer
  fit;
- an already selected scheduled target stays attached to its old profile and remains
  executable. Herald displays that a newer channel profile exists but does not
  silently reinterpret or cancel the schedule;
- applying the new profile to a draft or scheduled publication is an explicit
  migration that creates a new validated target revision;
- removed, renamed, or type-changed fields require an explicit field mapping or user
  edit. Herald never guesses a destructive conversion;
- profile versions referenced by any draft, target, execution, or audit record cannot
  be physically deleted.

This treats a channel-profile update like a small domain migration without forcing a
database migration for each custom destination. Lowering a microblog limit from 500
to 300 characters, for example, immediately helps the editor validate new work while
preserving a scheduled 420-character target under its original profile until the
operator explicitly migrates it.

### Candidate declarative HTTP boundary

The custom HTTP publisher is a bounded one-request adapter, not a general workflow
engine. The channel profile owns the request shape; a project-owned connection owns
the base endpoint and authentication material. Secrets are referenced by connection
binding and can never be interpolated from publication content or stored in the
profile.

The smallest contract that covers the representative cases contains:

- an allowed method (`POST`, `PUT`, or `PATCH`) and a path or URI template resolved
  against the connection's endpoint;
- explicit header, query, JSON, form, or multipart mappings;
- typed value expressions that read content or execution context through JSON
  Pointer, insert literals, build objects or arrays, and map a bounded source array;
- same-request media as controlled public URLs or multipart file parts;
- an optional idempotency value mapped from Herald's immutable execution key;
- success, retryable, rejected, and ambiguous HTTP outcome classifications;
- JSON Pointer extraction of remote identifiers and URLs from a bounded response.

This structural mapping AST is preferred over string templates because it preserves
JSON types and can map media arrays without parsing generated JSON. It is preferred
over JSONata, JMESPath, or user JavaScript because the accepted operations, cost, and
data sources remain explicit. URI templates are limited to path/query construction;
JSON Pointer addresses values within known Herald documents and provider responses.

The boundary deliberately excludes loops not tied to a bounded input array,
arbitrary functions, filesystem or environment access, dynamic code, custom signing,
multi-request protocols, and provider-specific OAuth flows. Those requirements need
a built-in module or a future connector contract. Multi-step media upload therefore
cannot be disguised as a custom schema feature.

The remaining transport security question is deployment-sensitive. A configurable
HTTP destination can legitimately be a private self-hosted blog, but allowing every
private or link-local address by default also creates an SSRF path into the host
network. Herald needs an explicit outbound-network policy for custom connections,
including redirect handling and whether private network ranges require an operator
opt-in.

### Attachments and storage

- The model must define project ownership, allowed media types, byte limits,
  checksums, dimensions or duration where relevant, accessibility metadata,
  upload/processing state, and deletion behavior.
- A publication must be able to refer to an ordered subset or adaptation of a
  project's media without duplicating raw bytes in every publication row.
- Local storage and an S3-compatible implementation must work behind the same
  Herald-owned contract for the single-process self-hosted deployment. Storage
  credentials and provider payloads must not enter the core domain.
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

### A. Common document with attachment references

Keep the common model small: a body plus ordered references to project media and
the minimal accepted accessibility metadata. Provider adapters remain responsible
for all other features.

- Strengths: small schema and bundle impact, easy to validate, and a clear common
  foundation for provider-specific capability checks.
- Risks: rich links, mentions, polls, threads, and accessibility metadata may
  require deliberate additions later.
- Best fit: a product whose current shared content vocabulary is intentionally
  limited while its provider and media boundaries remain extensible.

### B. Structured common document with per-publication target snapshots

Represent supported authoring content as a typed document, then persist a
channel-specific target snapshot or revision for each publication. Adapters compile
the snapshot into provider payloads.

- Strengths: preserves source intent, makes adaptations and validation explicit, and
  supports provider differences without storing raw provider payloads in core.
- Risks: the document vocabulary, revision semantics, and migrations require more
  design before implementation.
- Best fit: Herald's requirement that one source can be adapted to destinations with
  materially different capabilities while preserving a durable target snapshot.

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
- Best fit: none identified for Herald's current constraints.

### Accepted common source vocabulary

The comparison does not support making every provider field common, but it does
support a small semantic source revision that can seed several target publications:

```text
SourceRevision
  body?: { text, format: plain_text | markdown }
  headline?: string
  language?: BCP-47 tag
  media: ordered project-owned media references with default accessibility text
```

At least body text or one media reference is required. `headline` is publishable
authoring content and must remain distinct from any internal label used to organize a
post inside Herald. Tags, visibility, polls, replies, thread structure, provider
mentions, and similar semantics remain target-profile fields until evidence shows
that Herald can define one stable meaning for them across destinations.

This is not the schema sent to every channel. A `PublicationRevision` stores the
validated target content required by its channel profile. Matching `fieldBindings`
can seed headline, primary text, language, and media into a new target draft; the
target validator then reports losses or incompatibilities. A destination may omit a
source concept, add required fields, or use a richer target structure. Herald does
not silently truncate, strip Markdown, discard media, or invent required values.

This shape preserves the central write-once/adapt-many workflow without making
LinkedIn, a project blog, or an unknown custom channel share a fabricated universal
payload. Source edits remain editable authoring work; explicit target promotion still
controls what is scheduled under ADR-014.

The principal alternative is versioned source profiles such as `social-message` and
`article`. That would represent richer authoring modes more precisely, but it also
introduces source-profile selection and cross-profile conversion before Herald has
evidence that the small semantic vocabulary is insufficient. The owner accepted the
fixed semantic source plus exact target revisions on 2026-08-30; ADR-015 records the
decision.

## Capability ownership alternatives

The capability protocol and the ownership of provider knowledge are separate
decisions.

### A. Central provider capability catalog

Keep every provider's capability descriptor in one shared registry or catalog.

- Strengths: one place to inspect all known capabilities and easy cross-provider
  comparison for a client.
- Risks: provider knowledge becomes coupled to shared code, provider additions grow
  a central change surface, and channel-specific evolution becomes harder to own.
- Best fit: a product whose provider set and release process are centrally governed.

### B. Module-owned typed capability descriptors

Each provider or channel module owns its descriptor, settings, validation rules, and
payload mapping. Shared code defines the descriptor protocol, compatibility engine,
and validation result types. The application resolves a descriptor from the module
associated with the channel.

- Strengths: keeps destination knowledge with the adapter, permits precise provider
  behavior, preserves a common editor and validation contract, and avoids a central
  provider catalog.
- Risks: modules need a stable protocol and consistent test expectations; cross-
  provider comparison must be assembled from descriptors at runtime.
- Best fit: Herald's custom-channel direction and continuous provider evolution.

### C. Channel-defined arbitrary schemas

Allow a channel row or user configuration to provide an arbitrary schema and runtime
validation behavior.

- Strengths: maximum apparent configurability without changing the application.
- Risks: weak static guarantees, difficult migrations, unsafe executable behavior,
  inconsistent client assistance, and no stable contract for API, CLI, or MCP.
- Best fit: none for the core Herald domain. A future external connector protocol
  would need an explicit, separately governed contract instead.

The current recommendation is B. It does not make the shared core aware of every
provider, but it gives the shared core enough structure to validate any module that
conforms to the protocol.

## Storage abstraction alternatives

### A. Expose Bun file objects directly

Use `BunFile` and `S3File` throughout application and domain code because their
Blob-oriented APIs are similar.

- Strengths: minimal wrapper code and direct access to Bun capabilities.
- Risks: the domain becomes coupled to Bun and to backend-specific differences such
  as remote metadata, presigning, and object lifecycle semantics.
- Best fit: infrastructure-local code, not the application contract.

### B. Herald-owned `MediaStore` with Bun implementations

Define a narrow storage contract for media operations and implement it with
`Bun.file()` for local objects and `Bun.S3Client` for S3/R2 objects.

- Strengths: both intended backends exist behind one contract, the domain remains
  runtime-independent, contract tests cover behavior rather than implementation,
  and Bun's native performance and dependency footprint are preserved.
- Risks: the contract must explicitly handle differences in metadata, streaming,
  presigned access, failures, and consistency.
- Best fit: Herald's self-hosted local default with an S3/R2 deployment option.

### C. Use FlyDrive as the application storage abstraction

Use FlyDrive's disk and driver model to cover local and remote storage.

- Strengths: a broader abstraction and an existing driver lifecycle can reduce
  adapter code if Herald later needs many runtimes or storage providers.
- Risks: an additional dependency and abstraction layer may duplicate Bun's native
  local/S3 primitives and obscure semantics Herald must test explicitly.
- Best fit: reconsider only if cross-runtime support or a provider matrix creates a
  requirement Bun's native implementations cannot satisfy.

The current recommendation is B. Local versus S3/R2 is a deployment configuration
choice, not a staged architecture in which one backend is postponed until after a
temporary local-only model.

## Proposed target architecture for review

This section is a design proposal, not an accepted implementation contract. It
translates the comparative evidence into Herald boundaries without copying a
competitor's entire schema.

### Provider and channel module boundary

Each built-in provider module owns:

- its provider identity and account-context requirements;
- its serializable capability descriptor;
- its typed provider settings and settings validation;
- its target-content validation and adaptation rules;
- its provider payload mapping and response interpretation;
- its media upload, processing, and remote-media delivery rules.

A custom channel owns the equivalent versioned runtime profile and declarative
transport mapping. It may omit an executable publisher when it is used only for
manual delivery, but it still uses the same target-content schema and validation
protocol when structured data is configured.

Shared code owns the capability protocol, common constraint types, validation issue
shape, compatibility evaluation, and the common publication lifecycle. The runtime
may keep a registry that resolves a channel's module, but that registry is a
composition mechanism, not a central catalog containing every provider's rules.

A module may need imperative validation for rules that cannot be described
declaratively. It must still return structured issues that can be consumed by the
web editor and the non-UI clients. A declarative descriptor supplies editor metadata;
the server-side module validator remains authoritative.

### Content and target snapshot boundary

The intended relationship is:

```text
Shared draft or source content (optional for a single target)
  -> Publication for one Channel
       -> PublicationRevision containing the exact target snapshot
            -> ordered media references and target settings
```

Here, source content means reusable authoring content, not a file or a document
format imposed on every provider. It is useful when one draft feeds several
destinations; a single-target publication may work directly with its target content.
A publication revision expresses the target adaptation that is actually schedulable
and publishable. A provider payload is compiled from that revision at execution time
and is not the source of truth.

The current one-publication-per-channel model can represent the target boundary that
OpenPost calls a rendition. It should therefore gain explicit revision and target
snapshot semantics before Herald introduces a separate `Rendition` aggregate. If a
future requirement allows one publication to fan out to several independently
adapted accounts or output profiles, that requirement can justify a separate target
aggregate without invalidating the content and media contracts below.

The durable revision should contain:

- a schema version and deterministic content hash;
- the validated common or target document;
- the resolved module kind and capability revision;
- target-specific settings in a module-owned versioned envelope;
- ordered media references and publication-level metadata overrides;
- author, timestamps, and an immutable execution reference once an external effect
  begins.

The persistence representation may use versioned JSON for the typed document while
normalizing media references and ownership relations. JSON is a serialization of a
validated domain value, not an arbitrary provider payload or an unvalidated escape
hatch.

### Auto-save and target revision promotion

The web editor must distinguish an auto-saved draft working state from the target
revision selected for scheduling. Each edit may be persisted after a short debounce
and must survive navigation, reload, or an interrupted session, but an intermediate
auto-save must not silently replace a scheduled target.

The explicit scheduling or update operation validates the current draft and promotes
it to the publication's selected target revision. If a scheduled publication is
edited, the previously selected revision remains the one to be delivered until that
promotion succeeds. An edit that races with a worker either completes before the
worker claims the old revision or remains a new draft; it cannot mutate a running
execution. No automatic suspension is required, although an explicit pause or
reschedule operation may be added to the workflow.

Once the external-effect boundary begins, the execution revision and its media
references are immutable. Later edits create a new draft or target revision and do
not change the payload used by the in-flight, ambiguous, or completed attempt.

### Media asset and delivery boundary

Herald should distinguish four things:

1. `MediaAsset`: the project-owned logical asset and its original object metadata.
2. `MediaVariant`: a derived object such as a thumbnail, preview, or provider-ready
   representation, linked to its source asset and transformation parameters.
3. `PublicationRevisionMedia`: the ordered snapshot relation, including role,
   accessibility text, focal/crop metadata, and the selected asset or variant.
4. `ProviderMediaDelivery`: the provider-specific upload state and remote identifier
   for one publication revision media item.

This prevents provider media IDs from contaminating the reusable asset model and
preserves enough state to retry or reconcile a post after a media upload succeeded.
It also allows providers with different media requirements to select or request
different variants without duplicating original bytes.

Media assets should have an explicit lifecycle covering upload intent, object
availability, metadata analysis, processing, ready, failed, deletion, and retention.
The first implementation need not implement every transformation, but the state
model must not assume that all media is immediately ready or that one original
object is sufficient for every provider.

### Candidate durable media contract

The first durable media model should recognize `image`, `video`, `audio`, and
`document` families. Animation is metadata on an image rather than a separate storage
kind. This does not claim that every channel accepts every family: each channel
profile declares exact MIME, count, byte, dimension, duration, composition, and
accessibility constraints for each bound media field.

The core schema should not encode one permanent global MIME enum. A media-inspection
registry recognizes safe formats and can grow without a database migration, while a
channel profile stores the exact MIME allowlist that applies to its version. The
client-declared MIME type and filename extension are hints only; Herald verifies the
stored bytes before an asset becomes ready. Active or executable formats are not
served inline merely because their extension resembles media.

The original object is preserved. Derived objects are explicit `MediaVariant`
records with their own storage key, MIME type, checksum, byte size, dimensions or
duration, processor identity, processor version, and transformation parameters.
Herald does not overwrite an original during conversion. A provider can use the
original when compatible or select a validated variant. Heavy processors such as a
video transcoder are not silently added to the base runtime image; a required
transformation must have an explicit processor capability and observable failure.

The proposed asset lifecycle is:

```text
reserved -> stored -> inspecting -> ready
    |          |           |
    +----------+-----------+-> failed
ready | failed -> deletion_requested -> deleted
```

An expired reservation and an unreferenced stored object are reconciliation cases,
not valid ready assets. A referenced asset cannot be physically deleted. Retention
and recovery policy decides when an unreferenced deletion request becomes a storage
delete; that policy applies equally to local and S3/R2 objects.

Runtime target content may contain media IDs at profile-bound JSON locations. On
promotion, Herald extracts those references into `PublicationRevisionMedia` rows in
the same database transaction, preserving JSON Pointer location, order, role, and
accessibility overrides. The target JSON and extracted relational index must agree;
load and backup tests treat disagreement as data corruption rather than choosing one
silently. This relational index supplies project ownership and deletion protection
that arbitrary JSON cannot enforce with foreign keys.

Provider upload state remains separate. `ProviderMediaDelivery` records which exact
revision media item and variant was sent, the remote identifiers returned, and the
attempt state. A successful remote upload followed by a failed final publication can
therefore be retried or reconciled without pretending that the remote ID belongs to
the reusable `MediaAsset`.

### Storage boundary and consistency

The first media implementation should define a Herald-owned `MediaStore` contract
and provide both intended backends:

- `LocalMediaStore` backed by `Bun.file()` and `Bun.write()`;
- `S3MediaStore` backed by `Bun.S3Client` and its `S3File` references for AWS S3,
  Cloudflare R2, and other S3-compatible services.

The contract should cover the actual lifecycle rather than only a `save(path)`
helper: create or reserve an object key, write or stream an upload, inspect metadata,
open a read stream, delete or quarantine an object, and create controlled read or
upload URLs when the backend supports them. The application must not expose Bun
file objects, provider SDK objects, credentials, or untrusted paths.

Because SQLite and object storage do not share a transaction, media creation should
use an explicit upload-intent/finalization flow:

1. reserve a project-owned media record and storage key;
2. write the object through `MediaStore`;
3. verify size, content type, checksum, and available metadata;
4. finalize the asset and attach it to a publication revision in a database
   transaction;
5. reconcile expired intents and quarantine unreferenced objects.

The same lifecycle must work for local and S3/R2 storage. Direct browser uploads may
be added for S3/R2, but they must end through the same finalization and validation
path as server-mediated uploads.

## Decisions recorded from the project owner

The project owner has accepted the following direction:

1. Custom channels may define a complete runtime schema. Presets are editable
   accelerators and are not the limit of the model.
2. Built-in and custom channels share a generic persisted target-content boundary;
   built-ins use code-owned schemas while custom channels use validated runtime
   schemas and bounded declarative mappings.
3. Publications explicitly choose manual or automatic delivery, independently from
   whether a connection currently works.
4. Web auto-save must protect the latest draft without implicitly replacing the
   scheduled target. Explicit scheduling/update promotes a validated target revision,
   and execution revisions are immutable after an external effect starts.
5. Local and S3/R2 media storage share the first Herald-owned `MediaStore` contract.
6. Reusable source revisions use a small semantic vocabulary: optional plain-text or
   Markdown body, optional publishable headline, optional language, and ordered media
   references. Exact channel content remains in target revisions.
7. Runtime-defined custom channel content uses a bounded JSON Schema 2020-12 profile,
   TypeBox compilation, separate Herald field bindings, and normalized validation
   issues.

## Decisions still requiring project-owner acceptance

1. Define the first bounded declarative HTTP mapping vocabulary, including endpoint,
   authentication references, media delivery, response identity, idempotency, and
   error classification. This determines where a custom channel needs a connector.
2. Define the outbound-network policy for custom HTTP connections, including public
   versus private destinations, operator opt-in, DNS resolution, and redirects.
3. Accept or revise the durable media proposal: media families, extensible format
   registry, original/variant boundary, lifecycle, relational reference index, and
   provider-delivery state.
4. Accept or revise the proposed channel-profile evolution behavior: immutable old
   profiles, revalidated working drafts, unchanged scheduled targets, and explicit
   migration to a new target revision.

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
- the accepted media kinds, limits, project ownership, and storage lifecycle;
- local and S3/R2 media stores that satisfy the same contract, with metadata and
  backup coverage plus provider-appropriate integration tests;
- executable domain and database invariants for project ownership, publication
  identity, content validity, and lifecycle transitions.

## Out of scope until accepted

- Changing the current database schema or migrations.
- Adding a media storage implementation or a second provider.
- Running a live provider smoke test as evidence for the model.
- Accepting ADR-011 or closing PUB-09 based only on the current text adapter.

## Consequence of leaving this draft unresolved

The current text-only adapter can continue to serve as a protocol spike, but it must
not be treated as the durable publication contract. The first durable implementation
must establish the common content, destination capability, publication snapshot, and
interchangeable media-store boundaries together. It may implement only the currently
selected provider behaviors, but it must not encode a temporary local-only or
single-format model that makes the known next storage or media capability a rewrite.
