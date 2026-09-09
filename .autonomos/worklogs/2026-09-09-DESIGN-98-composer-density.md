# DESIGN-98 follow-up — Reduce composer copy density

- Date: 2026-09-09
- Status: implementation ready for review; the broader UX/IA sprint remains open
- Branch: `fix/audit-ux-followups`
- Scope: simplify the publication composer without removing source, destination,
  media, delivery, scheduling, connection, or accessibility capabilities.

## Changes

- Reworked the source area into one focused editor surface with only the title,
  content, and media controls needed to compose a publication.
- Integrated media selection into the editor instead of presenting it as a
  separate instructional card. The standalone media library keeps its fuller
  management surface.
- Removed repeated tutorial paragraphs and low-value helper copy from source,
  destination, and delivery sections while retaining labels and actionable
  recovery states.
- Replaced awkward media terminology with concise product language such as
  `Médias`, `Ajouter un média`, and `Planifier` in English and French.
- Updated browser coverage for the intentional compact media layout and exact
  accessible field labels.

## Verification

- `bun run check` — passed format, lint, workspace typechecks, i18n coverage
  (751/751 in English and French), unit tests, 4 Playwright scenarios, and
  production builds.
- `git diff --check` — passed.
- Authenticated browser inspection — verified the composer in French in light
  and dark themes; source editing, media controls, destination connection
  state, delivery mode, scheduling, and add-destination actions remain visible.

## Remaining scope

This is a focused composer-density pass and does not close `DESIGN-98` or the
larger UX audit. Progressive disclosure across the remaining routes, populated
multi-channel and failure states, narrow-mobile behavior, and broader visual
identity work still require dedicated review.
