# DESIGN-120 — Make the shared UI foundation operational

- Date: 2026-09-09
- Status: completed
- Base: `df0a0d17` (`main`, after PR #164)
- Branch: `chore/design-120-foundation-guidance`
- Related issue: ISSUE-065
- Related decision: ADR-057
- Related specification: SPEC-006

## Changes

- Added an implementation checklist to the accepted `DESIGN.md` contract for
  shared primitive accessibility, long-label geometry, locale/theme support,
  and progressive disclosure.
- Added the same operational guardrails to the `@postbot/ui` agent guidance and
  package README so future agents see them at the component boundary.
- Kept product meaning and explanatory copy in consuming pages rather than
  making shared primitives carry tutorial text.

## Boundary

This closes the foundation-guidance task, not the broader visual and IA work.
It does not freeze the palette or logo, replace Base UI, redesign a route, or
claim that every existing page has already been migrated to the rules. ISSUE-065
and the remaining UX/IA tasks continue to track that implementation work.

## Verification

- The repository gate is required before integration.
- No API, schema, runtime, or dependency changes were made.
