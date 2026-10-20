# Product expansion planning

- Status: implementation order accepted by the owner on 2026-10-16; detailed designs remain proposals.
- Date: 2026-10-16
- Scope: new providers, usable custom channels, engagement and publishing formats.
- Task: PRODUCT-477. Related intake: ISSUE-165 through ISSUE-170, ISSUE-162.

Current implementation coverage: [provider capability reference](provider-capabilities.md)
(2026-10-20). The starting point below records the original 2026-10-16 planning
baseline; later tasks have delivered Telegram, Facebook, Instagram, Mastodon
polls, stored conversations and broader performance coverage. Instagram live
acceptance remains deferred.

## Starting point (2026-10-16)

The owner wants to prioritize product completeness after the public-site work.
The goal includes mainstream networks, comments, useful provider information,
analytics, native formats, hashtags and internal organization. Raw JSON must not
be the normal Studio authoring experience. Additional languages come later with
measured client cost. This is not approval for every proposed implementation.

| Area | Repository evidence | Remaining work |
| --- | --- | --- |
| Publishing networks | Bluesky, Discord, LinkedIn, Mastodon, X, DEV.to adapters; manual and custom HTTP destinations | Telegram, Facebook and other mainstream networks |
| Performance | Bluesky observations and DEV.to lifetime totals; Studio performance page | Broader collectors, explicit per-provider metric coverage and freshness |
| Comments | Some analytics count replies/comments | A count is not a conversation reader, reply workflow or moderation tool |
| Internal tags | Project-owned publication tags, assignments and queue filters; ADR-062 | Complete Studio tag creation/discovery; tags carry user-defined meaning |
| Native formats | Current provider profiles describe supported target payloads | Polls, questions, threads and other native formats need explicit per-provider discovery |
| Custom channels | Schema, field bindings, content capabilities and profile lifecycle already exist | Creation/evolution still exposes profile JSON; impact/adoption screens also display raw objects |
| Languages | EN/FR through Paraglide; generated message module imports both locale modules | Choose two locales and measure their real delivered cost |

Evidence: docs/capability-evidence.md; packages/core/src/channel-profile.ts;
packages/core/src/taxonomy.ts; packages/bluesky/src/analytics.ts;
packages/devto/src/publisher.ts; apps/web/src/components/channel-creation-dialog.tsx;
channel-profile-editor-dialog.tsx; publication-profile-adoption.tsx;
apps/web/src/paraglide/messages/_index.js; apps/web/vite.config.ts.
No live-provider acceptance was performed for this review.

## Accepted sequence

1. **Structured channel authoring and JSON removal.** First agree the content
   builder's supported model, then replace creation/editing and impact comparison
   in one coherent workflow. Preserve existing profile revisions and contracts.
2. **Telegram publishing.** Start with a bot connection and a bounded text/media
   publishing workflow, using the existing project ownership and durable delivery.
   Investigate polls alongside this slice, but do not make every Telegram feature
   a prerequisite for its first integration. Telegram is a proposed first network,
   not a claim about market priority.
3. **Facebook and Instagram access discovery.** Establish the account types,
   permissions, review/development setup and feasible publication formats before
   committing to implementation dates. Prepare this independently of Telegram;
   external access approval should not idle unrelated work.
4. **Provider enrichment, engagement and native formats.** Maintain one evidence
   sheet per provider, then deliver useful vertical slices. Begin with stored
   account/publication identity and links, supported performance observations,
   then comment reading/replies where available. Do not interpret “maximum data”
   as unbounded collection of every accessible API field.
5. **Internal organization and languages.** Complete the existing free-tag workflow. A campaign name is one possible
   tag value, not a request for a campaign object.
   Add two locales after selecting them, with a before/after bundle and interaction
   check. Do not assume Spanish, Portuguese or another pair is already selected.

Existing provider publishing must keep working throughout this sequence.
Detailed builder proposal: [structured channel authoring](channel-builder.md).

## Custom channel builder proposal

### Content capabilities

Use normal controls for a required/optional title, body requirements, accepted text
format, length limits, permitted media families, count, size and dimensions.
Show units explicitly: provider-weighted length, graphemes and plain string length
are different constraints in the existing model. Avoid a single universal
“characters” field that changes meaning by destination.

Separate the optional execution setup: manual tracking, a Postbot webhook contract
or mapped HTTP delivery. Endpoint mapping, authentication and secret handling do
not belong beside title and media checkboxes. This separation must not remove the
existing restricted egress, signing or encrypted credential boundaries.

### Fit the existing system

Proposed flow: choose a starting template, configure supported content fields,
preview the resulting editor, save a draft profile, inspect concrete publication
impact, then activate explicitly. Reuse schema-driven target fields and current
profile validation. Built-in limits remain provider-owned; do not imply an operator
can bypass them by changing a checkbox.

Compile structured author input into the current runtime profile contract. Do not
replace the profile domain or make the UI and JSON two competing sources of truth.
Existing profiles can contain richer rules than a first builder supports. Detect
that case and preserve the whole profile: no lossy round trip, silent field drop
or fabricated “equivalent” form. Decide the unsupported-rule workflow before
implementation. An API/file import/export boundary is a candidate; raw JSON in a
normal Studio textarea is not the proposed escape hatch.

Replace visible raw payload comparisons with field labels, values, constraints
and specific validation messages, including profile adoption/recovery. A builder
only on the creation dialog would leave the main usability problem unresolved.

## Provider evidence required per slice

For each platform, record publishing identity, supported account types, supported
formats, media restrictions, edit/delete/reply support, read access, returned IDs
and permalinks, analytics definitions, permissions and external access barriers.
Distinguish unsupported, unverified, unavailable to this account and temporarily
failed. Do not show missing counters as zero or imply all providers have the same
comment or analytics capabilities.

Use stored read models for browsing. Select explicit refresh, scheduled collection
or incoming events according to the actual provider workflow; a new provider does
not automatically justify permanent polling, new services or a generic event bus.
Replies and moderation are separate external effects, with permissions, audit,
retry/ambiguity handling and identity distinct from reading comments. Counting
comments is not evidence that replying through an API is available.

Native content belongs to a destination's profile. A poll should have question,
options and supported settings in a form, not a JSON textarea or an unvalidated
blob shared across all networks. “Ask a question” as ordinary text is different
from a provider-native question or poll object.

Keep provider hashtags/mentions separate from internal publication tags. Plain
text containing #topic is not proof of provider-native facet/entity handling.

## Language-cost checkpoint

Paraglide currently generates static EN/FR imports in messages/_index.js; Vite
splits application routes but does not establish locale-only loading here. More
locales can increase the code for messages actually retained by bundling. There
is no basis for promising zero cost or multiplying the whole app size by locale
count. The emoji asset plugin also enumerates EN/FR explicitly.

Measure the production entry/route chunks (raw and compressed), requests for
inactive locales and emoji data, first render, language switch, formatting,
persistence and translation completeness. Compare the same pages/data before and
after. Change loading strategy only if measurements justify it. See ISSUE-162.

## External sources checked

- [Telegram Bot API](https://core.telegram.org/bots/api): HTTP bot methods include
  text, media groups and polls. Exact limits/settings must be rechecked when the
  provider slice is designed. No transport or framework was selected here.
- [Meta Pages API](https://developers.facebook.com/documentation/pages-api/overview)
  and [Instagram publishing](https://developers.facebook.com/docs/instagram-platform/content-publishing/):
  automated access failed, including HTTP 429 on related official pages. This
  pass does not claim a verified current Meta permission matrix. Resolve it from
  official documentation and an actual developer setup before committing scope.

No competitor comparison was refreshed. The previous comparison is historical
evidence, not proof of current feature parity or competitor limitations.

## Owner clarification: organization and engagement

Internal tags have user-defined meaning. Do not introduce a campaign entity as
part of this expansion. The existing model attaches tags to destination
publications; shared-post and tag reports must retain that distinction.

Required analytics discovery covers destination results, all destinations of one
source post and tag-selected publications. Define compatible metrics, coverage,
freshness and denominators before aggregation. Do not sum audience reach into
unique people, sum follower counts across repeated posts or average rates without
their denominators. Overlapping tags must not duplicate a publication within one
report. Historical versus current tag attribution remains an explicit design
question.

Scheduled comments under our own published item are a separate publishing
capability from reading and replying to external comments. Neither requires an
embedded AI author. Each needs its own provider limits, permissions and delivery
evidence. See ISSUE-171 and ISSUE-172.

### Competitor evidence checked on 2026-10-16

- [Postiz first-comment and analytics walkthrough](https://postiz.com/blog/grow-social-media-presence-fast-postiz-playbook-2026)
  describes delayed first comments, per-post statistics and separately tracked
  short-link clicks. This establishes a useful workflow to investigate; it is
  not a verified matrix for every provider or edition.
- [Mixpost features](https://mixpost.app/features) advertises first comments,
  performance comparisons and audience insights. Its
  [agent examples](https://mixpost.app/agents) use tags to organize campaigns,
  supporting free tags as a credible approach. Marketing does not establish
  exact per-provider fields or prove the absence of a campaign object.
- [OpenPost analytics guide](https://docs.openpo.st/guides/analytics) separates
  account and content metrics, including eligible externally published content.
  Its [coverage reference](https://docs.openpo.st/usage/analytics) publishes
  provider-specific metrics and access limitations. Postbot currently has
  narrower collectors (Bluesky and DEV.to); provider coverage, shared-post
  reports and tag reports need separate acceptance evidence.

These are competitor-authored claims and documentation, not live account tests.
They justify further discovery, not copying every feature or promising parity.
