# ADR-020 — Version and Assess Channel Profile Changes

- Status: accepted
- Scope: Built-in and runtime-defined channel profile evolution
- Provenance: Owner review of DOMAIN-07 on 2026-08-30
- Related specifications: [SPEC-004](../specs/SPEC-004-publication-content-boundary.md)
- Superseded by: none

## Context

A channel profile defines target content, validation constraints, field bindings,
media requirements, and possibly an automatic execution contract. Editing an active
profile in place would change the meaning of drafts, scheduled targets, retries, and
historical records. Automatically migrating every record can discard incompatible
data, while allowing every old target to execute can ignore a newly known provider,
transport, or security constraint.

General JSON Schema compatibility is also not a sufficient decision mechanism. The
important question is whether Herald's actual persisted content and execution
contract remain valid and supported.

## Decision

Every activated channel profile version is immutable. Editing creates a new profile
draft. A preset is copied into that draft as a starting point and has no live
authority over the resulting channel.

Before activation, Herald evaluates the proposed profile against actual affected
working drafts and pending targets. The preview reports:

- content that passes or fails structural and module validation;
- removed, renamed, or type-changed fields without modifying them;
- missing or incompatible media representations;
- changes to transport, authentication bindings, or built-in module revisions;
- the records that will require review.

Activation makes the new version the default for new work. Existing state follows
these rules:

- historical and in-flight execution revisions preserve their profile, content,
  representation references, and hashes;
- working drafts preserve all data and are revalidated as `compatible` or
  `review_required` with normalized issues;
- a pending target preserves its selected immutable revision;
- a pending target may continue automatically when its actual content remains
  compatible and its execution contract is unchanged and supported;
- a target that fails current constraints, lacks required media, or references a
  changed execution contract becomes `review_required` before the external-effect
  boundary and cannot be claimed by the scheduler;
- migration is explicit and creates a new validated target revision. Herald never
  guesses a destructive field conversion.

Profile immutability and execution support are separate. A stored declarative custom
profile may remain executable after supersession. A built-in module may stop
executing an old contract when its code or provider API no longer supports it. A
security correction may disable execution immediately without deleting history.

A user may deliberately re-approve an old target only when its referenced contract
is still supported. Project configuration cannot override a security-disabled
contract. Profile versions referenced by any retained draft, target, execution, or
audit record cannot be physically deleted.

## Alternatives considered

- **Mutate the active profile in place:** smallest schema, but changes persisted
  meaning and destroys reproducible retries and history.
- **Always execute scheduled targets under their old profile:** preserves snapshots,
  but ignores incompatibilities Herald already knows before an external effect.
- **Automatically migrate every compatible-looking target:** reduces review, but can
  silently change transport semantics and cannot safely infer destructive schema
  conversions.
- **Immutable versions with actual-instance assessment and explicit migration:**
  preserves data, blocks known-invalid effects, and limits review to impacted work.
  This is the selected alternative.

## Consequences

- Profile activation needs a deterministic impact preview and normalized validation
  results.
- Draft and scheduled-target review state is distinct from immutable revision data.
- The scheduler must enforce profile execution support before claiming work.
- Provider modules must declare which execution-contract revisions they still
  support.
- A limit reduction from 500 to 300 characters can leave an actual 280-character
  target executable while placing an actual 420-character target into review.
- Historical records remain interpretable even when their execution contract can no
  longer run.
