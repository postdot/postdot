# DESIGN-98 follow-up — Recompose destinations and media

- Date: 2026-09-09
- Status: implementation ready for review; the broader UX/IA sprint remains open
- Branch: `fix/audit-ux-followups`
- Scope: reduce the structural friction identified in the publication composer
  while preserving the existing publication contract and provider boundaries.

## Changes

- Prevented selecting the same channel more than once for one publication, both
  in the destination controls and at the final submission boundary.
- Replaced the repeated destination cards with an active destination tab row.
  Only the selected destination form is visible at a time, while each target
  still retains its own delivery mode and schedule.
- Added progressive disclosure for target-specific copy: targets use source
  content by default and expose an override editor only when requested.
- Added a compact visual media strip to the composer with explicit remove and
  reorder controls. Filenames, dimensions, and accessibility editing remain in
  the media library instead of occupying the primary composition surface.
- Added a media-library dialog to the composer. It reuses project media and
  offers device import from the same entry point, including when the library is
  empty.
- Kept the media library as the management surface for accessibility text and
  verification details; no provider or persistence contract was changed.
- Updated English/French copy and browser coverage for the new interaction
  model.

## Verification

- `bun run check` — passed format, lint, workspace typechecks, i18n coverage
  (760/760 in English and French), unit tests, 4 Playwright scenarios, and
  production builds.
- `bun run test:e2e -- e2e/publication-media.spec.ts` — passed.
- `git diff --check` — passed.
- Authenticated browser inspection — verified the French composer with an
  existing media asset, the wide media-library dialog, visual attachment
  preview, removal, destination tabs, source fallback, and the disabled
  add-destination state once all active channels are selected.

## Remaining scope

This is a focused structural composer pass and does not close `DESIGN-98` or
the larger UX/IA sprint. Provider-specific previews and formatting, richer
global defaults with explicit per-target overrides, populated multi-channel and
failure states, narrow-mobile review, and broader visual identity work remain
separate follow-ups.
