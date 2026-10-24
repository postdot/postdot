# DESIGN-98 — Compact publication empty states

- Date: 2026-09-09
- Status: completed for the Overview/Queue slice; DESIGN-98 remains in progress
- Base: `cabbee86` (`main`, after PR #158)
- Branch: `feat/design-98-compact-empty-states`

## Changes

- Replaced the repeated large empty card used by Overview and Queue with a
  compact status row containing the same route-specific title and description.
- Preserved the existing page-level `New publication` action rather than
  duplicating it inside every empty state.
- Kept the empty state available to assistive technology through a polite live
  status and retained the icon/title/description relationship.
- Reused existing localized messages; no additional translation surface was
  introduced.

## Verification

- Web format, lint, typecheck, i18n coverage, and tests passed locally.
- Browser verification should compare the compact row on both Overview and
  Queue against the populated publication list, not just the empty screenshot.

## Remaining DESIGN-98 work

- Revisit any other empty state only when its workflow evidence justifies a
  distinct pattern; do not globalize the compact row blindly.
