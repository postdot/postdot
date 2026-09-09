# DESIGN-121 — Responsive shell validation

- Date: 2026-09-09
- Status: validation slice completed; DESIGN-121 remains open
- Base: `de929ecc` (`main`, after PR #161)
- Branch: `feat/design-121-responsive-shell`

## Evidence added

- Added a deterministic browser scenario covering the authenticated shell at
  desktop width, reduced sidebar mode, and a 390px mobile viewport.
- The scenario verifies that reduced navigation keeps accessible route names,
  that the mobile drawer exposes the same Work navigation, and that Calendar
  and Compose remain reachable without horizontal overflow.
- The test creates isolated account/project data and never uses provider
  credentials or real provider calls.

## Boundary

This is a contract-validation slice. It does not claim that the responsive
composition is finished; narrow Queue, Compose controls, long channel labels,
focus order, and visual review at tablet width remain follow-up evidence for
the broader shell task.

## Verification

- `bunx playwright test e2e/design-121-shell.spec.ts` passed.
- `bun run check` passed: format, lint, typecheck, unit tests, E2E, and build.
- No production fix was required for this slice.
