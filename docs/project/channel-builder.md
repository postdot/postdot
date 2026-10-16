# Structured channel authoring

- Status: draft interaction and implementation proposal
- Task: PRODUCT-478; issue: ISSUE-167
- Basis: owner-approved first expansion lot; existing channel profile contract
- Scope: custom channel creation, profile evolution and publication adoption

## Operator job

Describe what a destination accepts without writing a schema, then inspect the
editor those choices produce. Keep channel identity, content rules and delivery
configuration distinct. This replaces authoring surfaces; it does not replace
the profile revision domain or invent a new publisher framework.

## Proposed composition

Use one content form with a live editor preview on wide screens; on narrow screens
the preview follows the form. Avoid a mandatory wizard for every small edit.
Name and destination identity lead. Content groups follow; delivery settings are
separate. Preview is local and cannot send a publication or an HTTP request.

| Group | Controls | Behavior to verify |
| --- | --- | --- |
| Message | Required/optional text; plain text or Markdown; explicit maximum | Required status and accepted source formats are independent |
| Title | Disabled, optional or required; maximum | Disabling is not equivalent to saving an empty required string |
| Attachments | Image, video, audio, document; permitted types; count | No attachments and attachments with constraints are distinct |
| Media limits | Per-file size, total size, dimensions, duration, mixed families, alternative text | Display bytes/MB, pixels and seconds explicitly; validate conversions |
| Additional constraints | Recognized relations and existing length rules | Never flatten weighted length or graphemes into a generic character limit |

Do not display raw JSON paths, hashes or schema keywords as the primary language.
Translate validation failures into field labels and actionable explanations.
Preserve technical identifiers where needed for diagnosis, behind details.
The runtime requires bounded limits: an empty maximum must not silently mean
unlimited, zero or the current template's very large fallback. Recommend defaults
only after checking the existing validator and representative destination needs.

The preview shows the actual schema-driven publication fields, required markers,
media choices and validation. It is an editor preview, not a fabricated social
network rendering. Changing a rule updates this preview without mutating saved
publications. Preview example content is transient and clearly distinguished
from saved data.

## Delivery configuration

Manual tracking requires no endpoint. Existing Postbot webhook and mapped HTTP
execution keep their current contracts, secret storage and egress restrictions.
Content changes must preserve delivery configuration byte-for-byte unless the
operator explicitly edits it. Provider-owned built-in limits remain read-only;
copying a built-in profile is not permission to bypass its publisher constraints.

A complete HTTP mapping builder is a separate bounded implementation slice. Do
not retain a normal JSON textarea as the substitute for designing it. Do not
disable an existing HTTP channel merely because content editing is delivered
first.

## Save, review and activate

1. Creation uses the existing creation API and validation. Do not introduce an
   additional activation lifecycle where the current API does not have one.
2. Existing channels retain draft save, impact preview and explicit activation.
   Editing after assessment invalidates that assessment, as today.
3. Review changes using rows such as “Title: optional → required” and
   “Images: 4 → 2”, grouped by content and delivery. Show affected publications
   with actionable incompatibilities and current validation results.
4. Activation must not silently rewrite existing target revisions. Publication
   adoption/recovery retains the existing explicit transition and concurrency
   checks; show labeled old/new values and repair fields instead of objects.
5. After activation, distinguish a successful write from a failed refresh. Do not
   invite a second activation because the follow-up request failed.

## Rich existing profiles: risk-first spike

The domain permits nested schemas, relations, custom field paths and richer rules
than the initial form. A naive decode/edit/encode cycle would destroy data. Before
UI implementation, build an isolated projection prototype against manual, webhook,
built-in-derived and deliberately richer custom fixtures.

Recommended approach: project recognized fields and apply targeted edits to the
original definition, retaining every unowned field. A rule is editable only if
the projection can prove its semantic mapping. Explain preserved unsupported
rules in readable summaries; never imply the form describes the whole contract
when it does not. If a change conflicts with a preserved rule, block that change
with the specific reason rather than dropping the rule.

Alternative: restrict this builder to a canonical supported profile shape and
leave richer profiles inspectable through a separate structured workflow. This
is simpler to prove but leaves more existing channels without normal editing.
A destructive conversion to a canonical profile is not an acceptable default.
The spike must establish whether lossless targeted editing is sound before the
project accepts an approach. No new authoring document or database migration is
selected by this proposal.

## Implementation lots and acceptance

1. **Projection and preservation spike.** Prove no-op round trips, isolated edits,
   unsupported-rule detection and conflicting-rule rejection. Check schema and
   capability constraints together, not only field bindings. Report any ambiguity
   before selecting a persistent model.
2. **Content creation and editing.** Shared typed controls, real editor preview,
   localized labels, keyboard operation, empty/error/saving states. Preserve
   manual/webhook transport settings. No publication or network effect in preview.
3. **Impact and adoption.** Human-readable comparisons, explicit activation and
   repair controls, stale-assessment/revision-conflict handling. No raw objects as
   normal content. Keep publication content and its internal tags separate.
4. **HTTP configuration.** Structured transport/mapping authoring using the same
   security contract. Finish this before calling normal Studio JSON removal done.

Meaningful tests cover a required title, media disabled, a mixed-media conflict,
size conversion, weighted-length preservation, unrelated unknown-rule preservation,
a stale impact assessment and adoption of incompatible content. Browser evidence
should cover a populated custom channel, first creation, a failed validation and
a narrow viewport. Existing automatic publisher behavior is a regression boundary.

## Related tag discoverability finding

Static inspection found tag selection in New publication and publication editing,
and filtering in Queue. Each call site hides the whole control when its supplied
tag collection is empty. The shared picker cannot create tags. Studio's API
wrapper lists tags and replaces assignments but exposes no tag creation wrapper;
no creation or archive/rename form was found in Studio. This is not a live-browser
acceptance claim.

Complete the free-tag lifecycle through an explicit project-scoped management
entry and an obvious first-tag path from the picker. Preserve existing uniqueness,
archive/restore and permission rules. Do not add campaign fields, dates or a new
object to solve this access problem. See ISSUE-173.

## Preservation spike result — CHANNEL-479

The isolated prototype lives in
`apps/web/src/lib/experiments/channel-builder-projection.ts`; nothing in Studio
imports it. Nine deterministic tests use the real manual/webhook templates,
X-derived content through the existing preset conversion, and richer valid
custom fixtures. Validation uses the existing core compiler.

The prototype can patch a direct message/title binding's required status and raw
maximum while preserving the original profile. It updates both the schema maximum
and its matching capability maximum. Media rules, execution, accepted formats,
grapheme/weighted counters and unrelated field restrictions remain unchanged.
Making a field optional permits omission; it does not permit an empty string.

The result supports targeted editing for a bounded subset, not arbitrary JSON
Schema editing. Valid root combinators, affected-field relations, field enums and
different schema/capability maxima require explicit handling; the prototype
refuses edits rather than guessing precedence. An unchanged rich definition can
be retained without reconstruction. Built-in execution remains outside editable
content even if a profile's origin is custom. Draft revision metadata is not
recomputed locally.

Two fixture failures caught during development reinforced the need to use real
contracts: custom schemas forbid regex patterns, and custom copies of trusted
built-ins need bounded asset identifiers. The tests now use a permitted enum and
the existing preset preparation instead of bypassing policy.

Next implementation should extract a production adapter that identifies each field as
editable or read-only and explains why, before connecting controls. Media edits, field
disabling, HTTP authoring, impact/adoption UI and persisted revision integration
are not proved by this text-rule spike and remain in the implementation lots.
Do not advertise complete profile support based on these tests.

## Implemented content surface — CHANNEL-480

Studio creation and draft editing now use the shared content form and local
TargetFieldControl preview. Supported direct fields expose required status, raw
length and text formats; simple media bindings expose families, item count and
global per-file MB limits. Unsupported rules remain unchanged and read-only,
with a reason. The browser adapter does not import the core schema compiler;
server validation, draft revisions, impact and activation remain authoritative.

Local browser verification covered creation, reopened values, draft save, impact,
assessment invalidation, explicit activation and mobile layout. HTTP mapping,
arbitrary field removal and full impact/adoption presentation remain unfinished.
The experimental spike remains isolated; runtime controls use the independently
tested production adapter. No persistence model or new lifecycle was introduced.
