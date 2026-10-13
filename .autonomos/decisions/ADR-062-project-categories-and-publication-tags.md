# ADR-062 — Define project categories and publication tags

- Status: accepted
- Date: 2026-09-10
- Scope: project classification, publication metadata, filtering, and future taxonomy extensions
- Provenance: TAXONOMY-101; current domain-model, route, UX, localization, and analytics review
- Related specifications: [SPEC-003](../specs/SPEC-003-product-foundation.md), [SPEC-005](../specs/SPEC-005-continuous-product-scope.md), [SPEC-007](../specs/SPEC-007-web-route-state-contracts.md)
- Related decisions: [ADR-008](ADR-008-enforce-project-scoped-domain-state.md), [ADR-028](ADR-028-use-audit-events-as-execution-journal.md), [ADR-042](ADR-042-derive-analytics-from-the-fact-journal.md), [ADR-051](ADR-051-analytics-foundation-and-provider-data-boundary.md), [ADR-057](ADR-057-propose-route-information-architecture.md)
- Dependencies: the exact instance-administrator and membership authority remains the subject of [ACCESS-116](../TASKS.md) and is not redefined here

## Context

Postbot currently has a deliberately small domain boundary:

```text
Project -> Channels
Post -> Publications -> one Channel
```

`Post` is the shared source and `Publication` is the destination-specific
workflow object. The database has no category or tag fields, tables, or routes.
The web client has project-scoped Overview, Calendar, Compose, Queue, Channels,
and Media routes. Its accepted information architecture gives Overview the job
of orientation, Compose the job of source fan-out authoring, Calendar the job of
time scanning, and Queue the job of lifecycle and human-action prioritization.

The product needs lightweight metadata for two different questions:

1. What kind of work is this project among the projects in one Postbot instance?
2. Which destination publications should an operator find, group, or filter in
   the daily queue and calendar workflow?

Those questions must not be answered with one undifferentiated label system.
Project classification is relatively stable and applies to a project as a
whole. Publication tags are operational metadata on individual destination
work items and may differ across the fan-out of one source post.

The existing analytics boundary is intentionally provider-neutral and based on
current publication/job rows plus the durable fact journal. It currently
supports channel, provider, and delivery-mode dimensions, not arbitrary
metadata dimensions. Provider engagement observations are separately owned by
providers. Adding taxonomy labels to provider payloads or treating them as
analytics facts would create new ownership and historical-semantics problems
without an established user need.

The current authenticated project access model is project-scoped and does not
yet expose a complete instance-administrator or membership-role policy. This
record therefore defines taxonomy semantics and permission boundaries without
inventing a new role hierarchy. The missing authority model is an explicit
implementation dependency, not a reason to conflate project and publication
metadata.

## Decision

Postbot will use two separate metadata concepts:

- A project has zero or one optional primary category. A category answers what
  the project is principally for and is useful in cross-project navigation and
  orientation. It is not a workflow state, provider, channel, or publication
  type.
- A publication has zero or more project-scoped tags. A tag is operator-owned
  metadata for finding and grouping destination work. It is not source
  content, a provider hashtag, a channel capability, a delivery mode, or a
  lifecycle state.

The first useful implementation must preserve these meanings and must not add a
general-purpose taxonomy engine, hierarchy, arbitrary object tagging, or
automatic classification system.

### Project categories

- A project may have one `primary category` or no category.
- The one-category rule is semantic, not a quota: a project category is the
  project's primary lane. If operators need several concurrent themes, the
  themes belong on publications as tags, or the work should be split into
  separate projects when it truly has separate channels, schedules, or source
  ownership.
- Categories are instance-scoped definitions so the project list can group
  projects consistently. A project stores a stable category ID; the category's
  display label is metadata, not the identity used for joins or filters.
- Categories are flat and user-facing. There is no parent/child hierarchy,
  color meaning, icon contract, or system-imposed starter taxonomy in the first
  slice.
- Category assignment is project metadata. It does not alter any post,
  publication, channel, job, schedule, notification, provider, or permission
  semantics.
- A category may be active or archived. An archived category cannot be chosen
  for a new project or assigned to a project, but existing projects retain the
  reference until an operator explicitly changes or clears it. Archived
  categories remain available in historical/project-detail views when needed.
- Renaming a category updates its display label in place and retains its stable
  ID. It does not create a new category, rewrite audit facts, or split project
  history. A later implementation may add an audit event for the rename, but
  the category ID remains the grouping key.
- Hard deletion is not part of the first slice. Archive and restore are the
  recoverable lifecycle operations. Deletion, if ever needed for privacy or
  instance cleanup, requires a separate decision covering references and
  backups.

The category definition scope intentionally depends on a future instance
authority boundary. Until that boundary is accepted, implementation must not
silently invent a project-member role that can rename a category used by other
projects. Category assignment and category-definition administration must be
separated in the API even if the first UI exposes them close together.

### Publication tags

- Tags belong to `Publication`, not `Post`. This allows the LinkedIn, Bluesky,
  manual, or other destination versions of one source post to have different
  operational labels.
- Tags are scoped to a project. A publication may only reference tags from the
  same project, preserving the project-isolation rule used by all other domain
  state.
- A publication may have any number of distinct tags, including zero. Postbot
  imposes no business quota on tag count or tags per project. The only required
  constraints are non-blank names, duplicate collapse, project ownership, and
  request/resource safety at the transport boundary.
- Tags are an unordered set. Their order has no meaning and is not part of the
  publication contract. APIs should return them deterministically by normalized
  key and stable ID; UIs may display them alphabetically or by usage as a
  presentation choice.
- Tags are active or archived. An archived tag is excluded from default create
  suggestions and new assignments, but existing publication assignments remain
  intact and filterable when an operator includes archived metadata. Archive,
  restore, and rename are recoverable/identity-preserving operations; hard
  deletion is out of scope.
- Renaming a tag updates the display label for all current and historical
  assignments while retaining the tag ID. This is intentional metadata
  maintenance, not a content revision. If future reporting needs the label as
  it appeared at publication time, it must store an assignment or event
  snapshot; it must not infer history from the current label.
- Tags are internal Postbot metadata. They are not automatically serialized into
  target content, provider requests, external hashtags, media, notifications,
  or provider-owned engagement observations. A provider-specific mapping would
  require a separate accepted decision and explicit user action.
- The first slice does not attach tags to projects, channels, media assets,
  jobs, provider credentials, or audit events as independent taggable objects.
  Source-level labels can be considered later if real workflows show that
  repeating a tag across every fan-out publication is costly.

### Ownership and authority

The taxonomy data itself is owned by Postbot, not by a publisher provider.

- Project category definitions are instance-scoped. Their create, rename,
  archive, and restore authority must use the accepted instance-administration
  boundary when ACCESS-116 is resolved. Project category assignment is a
  project-management operation.
- Publication tag definitions and assignments are project-scoped. Reading tags
  follows project read access. Assigning tags follows publication authoring or
  project write access, so supported humans, agents, and user API keys
  can preserve metadata during normal publication workflows.
- Creating, renaming, archiving, or restoring a project tag is taxonomy
  administration within that project. Until a finer membership-role model is
  accepted, it must reuse the existing project-management authority rather than
  introduce a taxonomy-only role.
- Every mutation must enforce the project/instance scope on the server. Client
  route context and tag IDs are not authorization evidence.
- Definition mutations should be attributable to the acting Postbot actor where
  the existing audit boundary supports it. Tag assignment need not become an
  execution fact and must not expose credentials or provider data.

### Naming and normalization

The stored display label is the operator's text. The stable identity is an ID;
normalization is only for uniqueness, lookup, and deterministic suggestions.

On create or rename, the implementation must:

1. trim leading and trailing Unicode whitespace;
2. normalize Unicode with NFKC;
3. collapse runs of internal whitespace to one space;
4. compute a locale-independent case-insensitive comparison key; and
5. reject a blank result and reject a duplicate key within the relevant scope.

The exact database function used for case folding is an implementation detail,
but it must not vary with the operator's current UI locale. `Release Notes`,
` release   notes `, and `RELEASE NOTES` therefore identify one value in the
same scope. The display label may retain intentional casing from the most
recent edit. Category/tag IDs must be opaque stable IDs, not labels or slugs.

A label safety bound may be introduced at the API/storage edge only to protect
compact controls, logs, and resource usage; it is not a product quota. The
first implementation should document the bound, count Unicode user-visible
characters rather than bytes where practical, and keep later increases safe.
There is no separate limit on the number of categories, tags, or assignments.

### Ordering and filtering semantics

- Project categories have no user-defined order. Category pickers and
  cross-project lists use locale-aware display sorting with stable ID tie-breaks.
- Tags are sets, not ordered labels. Tag chips and suggestion lists use the
  deterministic normalized-key/ID order unless a route deliberately chooses a
  usage-oriented presentation.
- Queue and Calendar may filter publications by tag IDs. The first multi-tag
  behavior is `all selected tags` (logical AND), because it narrows operational
  work safely; selecting one tag is the common case. An explicit any/all toggle,
  saved filters, or boolean expressions are later enhancements, not hidden
  semantics.
- Archived categories/tags are omitted from default pickers and included only
  when the operator requests archived metadata or opens an affected record.
- Filters are URL-addressable on project routes when implemented, so reload,
  deep links, and realtime updates preserve the operator's queue/calendar
  context. Filtering must not mutate publication state.
- V1 tag filtering is equality/filtering by stable tag ID with label suggestions.
  Full-text search over source content, target content, provider results, or
  arbitrary JSON remains outside this decision.

### Analytics and reporting boundary

Taxonomy metadata does not expand the current analytics contract in V1.

- Project category is a project-list/navigation dimension, not a publication
  lifecycle or execution metric.
- Publication tags are not accepted filters or group-by dimensions on the
  provider-neutral operational analytics route. The existing analytics filters
  (channel, provider, delivery mode, and time range) remain unchanged.
- Tag assignment changes are current metadata, not durable publication or
  execution facts. Retrospective tag-based performance reporting would need a
  deliberate cohort rule and assignment/history snapshots; it must not
  retroactively apply today's tags to old publication events.
- Tags do not indicate provider engagement. Likes, impressions, clicks, and
  other provider observations remain in the provider-owned boundary from
  ADR-051 and related decisions.
- If measured product demand later requires tag analytics, the read model must
  remain behind a typed contract and declare whether it reports current
  assignment, assignment-at-publication, or assignment-at-event-time. A
  materialized projection is a performance option, not a new source of truth.

### Localization and accessibility

- `Category`, `Categories`, `Tag`, `Tags`, filter operators, empty states, and
  lifecycle labels are product copy and belong in the existing Paraglide
  catalogs. English and French must preserve the same meaning and action
  hierarchy.
- User-authored category and tag labels are opaque data. Postbot does not
  translate, transliterate, or silently rewrite them per locale.
- Locale-aware collation is presentation-only. It must not change normalized
  uniqueness or scope.
- Truncated labels must expose their full value, and tag chips/controls must
  retain accessible names, keyboard operation, and a clear archived state.
- Taxonomy controls should appear where they serve the route job: category in
  project selection/settings; tags in Compose and publication detail; tag
  filters in Queue and, if useful after evidence, Calendar. Do not add a
  taxonomy panel to every route merely to make the feature discoverable.

### Import, export, and migration

There is no existing taxonomy data to infer, so migration is additive and
lossless:

- Existing projects receive no guessed category. Existing posts and
  publications receive no guessed tags. Postbot must not infer labels from
  project names, source text, channels, providers, or filenames.
- The eventual schema should keep nullable category assignment and empty tag
  assignment as valid states. Introducing the tables/columns must not rewrite
  publications, target revisions, execution revisions, or audit history.
- A future versioned export should include category definitions and state,
  project-category assignments, tag definitions and state, and
  publication-tag assignments. It should omit derived usage counts, UI sort
  state, credentials, provider payloads, and secrets.
- Export records should include stable IDs plus normalized keys and display
  labels. IDs are stable within an instance; import into another instance may
  remap IDs while retaining the logical normalized key. Within one project or
  instance scope, a normalized-key match must be reported and resolved
  deterministically rather than creating invisible duplicates.
- Import must be explicit and schema-versioned. A matching active definition
  may be reused; a matching archived definition must not be silently restored.
  Conflicts, unresolved publication references, and remapped IDs belong in an
  import report. Import must never assign a tag across project scope.
- Renames and archive/restore preserve IDs, so backups and exports do not need
  to rewrite historical publication references. A future hard-delete/migration
  would need a separate retention and reference policy.

## Daily workflow examples

### One source, different destination work

An operator writes the source post `April product update` and fans it out to a
LinkedIn publication and a manual community announcement. The project category
is `Product communications`. The LinkedIn publication receives `release` and
`customer-facing`; the manual publication receives `release` and
`community`. The source remains one `Post`, and each `Publication` can be
found without pretending the labels are provider content.

### Queue prioritization

The Queue is filtered to `customer-facing` AND `needs-review`. It shows only
publications carrying both active tags, while lifecycle state, channel, and
next action remain authoritative. Clearing the filter does not unschedule or
edit any publication.

### Calendar planning

An operator scans the project calendar for `launch-week` publications. The
calendar still groups by the project's local timezone and shows delivery state;
the tag is only a planning filter. A manual destination remains a normal
publication and is not treated as a provider failure.

### Tag maintenance

After the team standardizes `customer-facing` to `external`, an authorized
operator renames the tag. Existing publications keep their tag ID and remain
findable under `external`; no target content, provider request, or historical
execution fact is rewritten. If the team no longer wants new work using the
tag, it archives the tag instead of deleting it; existing assignments remain
visible in record detail and optional archived filters.

## Alternatives considered

### A. One universal label system on every Postbot object

This would make tags appear flexible, but it would blur project identity,
source content, destination work, provider configuration, and execution facts.
It would also invite arbitrary joins, unclear permissions, and accidental
provider/analytics semantics. Rejected.

### B. Several categories per project from the first slice

Multiple categories could model overlapping themes, but they make the primary
project-list question ambiguous and turn category selection into another tag
picker. Publication tags already provide many-to-many operational grouping.
Rejected for the first slice; revisit only with evidence that a primary lane is
insufficient.

### C. Tags on `Post` only

Post-level tags are simple for fan-out authoring, but they cannot distinguish a
public launch announcement from an internal/manual adaptation of the same
source. They also force every destination to share operational metadata.
Rejected for publication tags; source-level tags remain a possible later
concept with a separate name and contract.

### D. Free-form, non-normalized strings with no lifecycle

This has the smallest initial schema, but casing/whitespace duplicates quickly
make filters unreliable, and deleting a label breaks saved links and operator
understanding. Rejected in favor of stable IDs, normalized uniqueness, and
archive/restore.

### E. Put tags into operational analytics immediately

This would require a decision about assignment-time versus current metadata,
increase cardinality, and risk retroactive or misleading reports. Rejected until
there is a measured reporting need and a historical assignment contract.

## Consequences

Positive:

- The first taxonomy slice is small and follows Postbot's existing object
  boundaries: one project classification and publication-level operational
  metadata.
- A source fan-out can retain destination-specific workflow labels without
  changing `Post`/`Publication` semantics.
- Stable IDs, project scoping, and recoverable lifecycle operations support
  filtering, backups, future imports, and future richer taxonomies.
- The current analytics and provider-ownership boundaries remain intact.
- No arbitrary business quota is imposed on tags or definitions.

Costs and risks:

- Shared category definitions need a truthful instance-administration boundary;
  ACCESS-116 must settle the actor/role authority before category management is
  exposed broadly.
- Tag assignment history is intentionally not preserved as an analytics fact in
  the first slice. Future tag analytics cannot claim historical accuracy without
  an additional snapshot/event contract.
- Publication creation and editing need a deliberate place to copy or choose
  destination tags. Automatically copying source metadata is not available
  because source tags are not part of this decision.
- A later many-category or source-tag feature must be additive and must not
  reinterpret the primary category or publication tags.

## Phased implementation proposal

This is the implementation sequence for the accepted policy. TAXONOMY-101
established the policy; TAXONOMY-129 implements the durable/API foundation, and
TAXONOMY-130 is the follow-up for the web integration.

1. **Governance and authority.** Accept this ADR, resolve the category
   definition authority with ACCESS-116, and choose the exact instance-scope
   storage key. Confirm whether project-management permission is sufficient for
   tag-definition mutations.
2. **Durable domain/storage boundary.** Add core vocabulary and validation for
   category references and project-scoped tags; add nullable project category,
   tag definitions, and publication-tag assignments with composite scope
   constraints and archive/restore semantics. Add additive backup/restore
   coverage and attributable metadata mutations where appropriate.
3. **API contract.** Add project category read/assignment, project tag CRUD,
   publication tag assignment, and stable-ID Queue/Calendar filters. Preserve
   project isolation for session, agent, and token callers. Return deterministic
   ordering and explicit archived-state semantics.
4. **Authoring and operations UI.** Add category to project context/settings;
   add tags to Compose/publication detail; add a compact tag filter to Queue;
   consider Calendar filtering only after its time-scanning job remains clear.
   Preserve unsaved Compose state, route URL state, narrow-screen access, and
   English/French catalog coverage.
5. **Migration/export validation.** Verify empty/null behavior on existing data,
   backup/restore round trips, rename/archive/restore, project isolation,
   import conflict reports, and direct route reloads. Do not infer metadata.
6. **Later, evidence-driven extensions.** Consider source-level tags, multiple
   project categories, saved/boolean filters, usage reporting, tag assignment
   history, provider mappings, or taxonomy analytics only as separate decisions
   with concrete workflow evidence.

## Open questions

- Which accepted instance-administration and membership authority owns shared
  category-definition mutations? ACCESS-116 is the intended decision point.
- Should project category assignment be available to project-scoped machine
  actors, or remain human-session-only like project settings, once the authority
  model is complete?
- Does a real workflow require Calendar tag filtering, or is Queue filtering
  sufficient for the first operational slice?
- If source-level labels become necessary, should they be a separate `Post`
  taxonomy or an explicit mechanism that copies selected labels into newly
  created Publications?
- What export/import surface is actually required (JSON backup only, or a
  user-facing portable project format) before its conflict semantics need to be
  implemented?

## Acceptance note

This ADR is an accepted project decision and is normative for the taxonomy
boundary. It does not imply that every implementation phase is complete:
TAXONOMY-129 covers the durable/API foundation, while TAXONOMY-130 covers the
web integration. The temporary human-session boundary for instance category
definitions remains explicit until ACCESS-116 provides the final instance-admin
authority.
