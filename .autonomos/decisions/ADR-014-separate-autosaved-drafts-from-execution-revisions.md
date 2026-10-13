# ADR-014 — Separate Auto-Saved Drafts from Execution Revisions

- Status: accepted
- Scope: Web editing, scheduled target content, execution, retry, and reconciliation
- Provenance: Owner review of DOMAIN-07 on 2026-08-29
- Related specifications: [SPEC-004](../specs/SPEC-004-publication-content-boundary.md), [SPEC-005](../specs/SPEC-005-continuous-product-scope.md)
- Superseded by: none

## Context

Postbot must preserve web editing work with zero data loss. A user may edit a
publication shortly before its scheduled time, including while a worker is about to
claim or execute it. Treating the latest auto-saved editor state as the payload to
send would allow an intermediate, invalid, or not-yet-reviewed state to cross the
external-effect boundary.

Retries and ambiguous outcomes also require Postbot to know exactly which content and
media references were used by the original attempt.

## Decision

Postbot separates the mutable auto-saved draft from the target revision selected for
delivery:

- the web editor persists a debounced working draft that survives navigation,
  reloads, and interrupted sessions;
- saving that draft does not by itself replace the target revision selected for a
  scheduled publication;
- an explicit schedule or update operation validates the current draft and promotes
  it to the selected target revision;
- while a publication is scheduled, the previously selected target revision remains
  the one to be delivered until promotion succeeds;
- once an external effect starts, the execution revision and its media references are
  immutable;
- retries and reconciliation use that same execution revision;
- later edits create a new draft or target revision and cannot mutate an in-flight,
  ambiguous, or completed attempt;
- a race with a worker is resolved by the durable claim boundary: an update that
  commits before the claim may be selected, while an update after the claim becomes
  a new draft and does not alter the running execution.

Postbot does not automatically suspend a publication merely because its editor is
open. An explicit pause or reschedule operation may be added when the product needs
that workflow.

## Alternatives considered

- **Bind execution to the latest auto-save:** risks publishing transient or invalid
  content and makes retries non-deterministic.
- **Freeze content when first scheduled and discard later edits:** protects
  execution but loses user work and conflicts with zero-loss editing.
- **Automatically suspend while editing:** protects against races but introduces
  hidden workflow state and can prevent expected scheduled delivery.

## Consequences

- The web editor needs distinct draft and scheduled-target states.
- Scheduling and updating a scheduled publication are explicit domain operations,
  even though draft persistence is automatic.
- The API, CLI, and MCP can use the same promotion and validation operations without
  needing to reproduce browser auto-save behavior.
- The UI must show when a draft differs from the scheduled target and provide an
  explicit action to apply the change.
- The execution boundary remains deterministic for provider retries, manual evidence,
  and ambiguous-outcome reconciliation.
