# DESIGN-98 follow-up — Shared publication defaults

- Date: 2026-09-09
- Status: implementation ready for review; the broader UX/IA sprint remains open
- Branch: `feat/design-98-global-composer-defaults`
- Scope: make the common delivery configuration explicit in the composer while
  keeping per-channel exceptions available.

## Changes

- Added one shared delivery mode and schedule control for all selected channels.
- New destination tabs inherit those defaults instead of receiving independent
  timestamps and modes.
- Changing a default updates only destinations that still use the defaults;
  destinations explicitly customized for a channel remain untouched.
- Added progressive disclosure for delivery overrides: a target shows a compact
  "uses defaults" state until the operator asks to customize it.
- Added an explicit action to return a customized target to the shared defaults.
- Kept the existing publication API and target revision contract unchanged;
  defaults are resolved into the existing per-publication inputs at submit time.
- Extended the browser scenario to verify inheritance and per-target schedule
  customization.

## Verification

- `bun run --cwd apps/web typecheck` — passed with English/French coverage at
  766/766 messages.
- `bun run test:e2e -- e2e/publication-media.spec.ts` — passed.
- `git diff --check` — passed.

## Remaining scope

This pass does not change persisted draft semantics or provider delivery
contracts. Provider-specific scheduling constraints, saved project defaults,
and the broader route-by-route UX/IA validation remain separate work.
