# UX Experience Audit & Accessibility Review (SPEC-010)

Status: complete
Completed: 2026-11-03

## Context & Objectives

As directed by the project roadmap (Option C), a comprehensive Studio experience audit was performed against the accepted operational UX standard (SPEC-010). The review assessed layout integrity, wayfinding, navigation cohesion, and automated accessibility (via `@axe-core/playwright`), specifically verifying the new Quick Search command palette (`⌘ K` / `Ctrl K`) and the structured publication composer.

## Experience Audit Execution

- **Test Suites Executed**:
  - `POSTDOT_EXPERIENCE_AUDIT=true bunx playwright test e2e/experience/experience-audit.spec.ts`
    - Evaluated 101 distinct route captures across both `empty-en-dark` and `populated-fr-light` test profiles.
  - `POSTDOT_EXPERIENCE_AUDIT=true bunx playwright test e2e/experience/detail-journeys.spec.ts`
    - Evaluated 4 key user detail flows (English navigation, French navigation, sibling destination traversal, and calendar return context).

- **Rule Family Findings**:
  - **LAY-01 / LAY-02 (Width Class Jobs)**: All route containers adhere to declared jobs (`max-w-7xl` or full-bleed data tables). No rogue utility sizing detected.
  - **LAY-04 (Horizontal Overflow)**: Zero viewport overflow detected across all 101 route snapshots (`scrollWidth <= clientWidth` on `[data-dashboard-scroll]`).
  - **WAY-03 (Wayfinding & Sidebar State)**: Exactly one active sidebar navigation item per route state across all navigation transitions.
  - **JRN & NAV (Detail Journeys)**: Return navigation maintains contextual query parameters (calendar month/filter state preserved when returning from detail cards).
  - **COH (Cross-Language Consistency)**: Parity verified across English and French profiles with proper fallback handling.

## Automated Accessibility Verification

- **Test Suite**: `e2e/accessibility-smoke.spec.ts`
- **Scope Expanded**:
  - Route additions: `overview`, `performance`, `queue`, `media`, `channels`, `tags`, `access`, `invitations`, `publications/new`.
  - Dialog / Modal interaction: Command Palette (`Ctrl+K` / `⌘ K`) opened, analyzed in active DOM state, and closed via `Escape`.
- **Outcome**: 0 Axe accessibility violations detected across all tested surfaces. Dialog roles, focus traps, aria labels, and contrast thresholds pass without warnings.

## Quality & Integration Gates

- `bun run format`: All files conform to oxfmt standards.
- `bun run check:quick`:
  - oxlint: 0 errors, 0 warnings across all 22 workspace packages.
  - cspell: Spell check clean.
  - i18n coverage: 100% across all 4 locales (en, fr, es, de: 2,219 messages each).
  - tsc: Typecheck clean across all packages.
