# ADR-015 — Use a Small Semantic Source Content Vocabulary

- Status: accepted
- Scope: Reusable authoring content and channel target adaptation
- Provenance: Owner review of DOMAIN-07 on 2026-08-30
- Related specifications: [SPEC-004](../specs/SPEC-004-publication-content-boundary.md)
- Superseded by: none

## Context

Herald needs one source revision to seed publications for several social and adjacent
destinations. Those destinations do not share one complete payload shape: a project
blog may require a headline and Markdown, while a social network may accept plain
text and attachments but require target-specific visibility, reply, poll, or mention
settings.

A source model that mirrors every provider would become a universal social schema.
Conversely, making every authoring mode a separate source profile would introduce
profile selection and cross-profile conversion before Herald has evidence that this
complexity is necessary.

## Decision

Herald uses one small semantic source-content vocabulary for reusable authoring:

- optional body content with explicit `plain_text` or `markdown` format;
- an optional publishable headline;
- an optional BCP 47 language tag;
- ordered project-owned media references with default accessibility text;
- at least body content or one media reference is required.

The publishable headline is distinct from any internal label used to organize a post
inside Herald.

This source content is not a provider payload and is not the schema sent to every
channel. Each `PublicationRevision` stores exact target content validated against its
channel profile. Matching field bindings may seed headline, primary text, language,
and media into a target draft, after which target validation reports missing,
unsupported, or incompatible content.

Herald never silently truncates text, strips Markdown, discards media, or invents a
required target value during adaptation. Target-only concepts such as visibility,
polls, replies, thread structure, provider mentions, and destination-specific tags
remain in the target profile until Herald can define stable shared semantics for
them.

## Alternatives considered

- **Versioned source-profile families:** profiles such as `social-message` and
  `article` could model richer authoring modes, but would require profile selection
  and conversion semantics without current evidence that the small vocabulary is
  insufficient.
- **Universal provider feature schema:** appears uniform but couples source content
  to provider concepts and creates permanent lowest-common-denominator behavior.
- **Opaque source JSON:** maximizes short-term flexibility but cannot provide stable
  editor assistance, adaptation, or API validation.

## Consequences

- One source revision can seed several independently editable target drafts.
- Channel schemas remain free to be more precise or structurally different.
- Source-to-target adaptation is explicit and may require user review.
- New shared source concepts require evidence that their semantics are stable across
  destinations.
- If the vocabulary proves insufficient, a later decision may introduce versioned
  source profiles without changing the target-revision or channel-profile boundary.
