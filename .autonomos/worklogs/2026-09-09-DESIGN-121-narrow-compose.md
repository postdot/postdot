# DESIGN-121 — Narrow Compose and Queue validation

- Date: 2026-09-09
- Status: validation slice completed; DESIGN-121 remains open
- Base: `21c594f3` (`main`, after PR #163)
- Branch: `feat/design-121-narrow-compose`

## Evidence added

- Added a deterministic browser scenario covering Compose and Queue with two
  deliberately long channel names at 390px and 768px widths.
- The scenario verifies the mobile drawer route transition, keyboard focus from
  the destination tab to the add-destination action, distinct destination tabs,
  scheduling to both channels, and the absence of horizontal overflow.
- The scenario creates isolated account, project, channel, and publication data
  and never uses provider credentials or real provider calls.

## Production correction

- Updated the shared SelectValue primitive with `min-w-0` and visual truncation.
  A long selected channel name had previously forced the Compose content region
  to 533px at a 390px viewport. The full value remains in the control's
  accessible text while the visual label fits its flex container.

## Boundary

This is a focused responsive validation and primitive-hardening slice. It does
not close the broader shell task; tablet visual review and any remaining Queue
or Compose interaction refinements remain follow-up evidence.

## Verification

- `bun run test:e2e -- e2e/design-121-narrow-compose.spec.ts` passed.
- Full repository format, lint, typecheck, unit tests, E2E, and build are run by
  the repository gate before integration.
