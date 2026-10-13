# DESIGN-121 — Compact sidebar surface and hitbox correction

- Date: 2026-09-10
- Status: implementation complete on `fix/design-121-collapsed-shell-hitbox`
- Scope: owner-reported compact sidebar visual and interaction defect
- Related task: DESIGN-121
- Related issues: ISSUE-064, ISSUE-065

## Owner feedback addressed

The previous shell pass removed the expanded sidebar padding but preserved the
inset padding in compact mode. Postbot therefore rendered a transparent strip
around the compact surface, while menu buttons occupied only the middle of the
rail. Invisible collapsed group labels also retained pointer hitboxes and
intercepted the lower portion of the last item in each group, notably Queue and
Access.

## Changes

- Let Postbot's compact sidebar surface fill its complete 66px rail.
- Remove pointer interception from group labels when their labels are hidden in
  icon mode.
- Extend browser coverage to assert the compact surface has no inset, the page
  does not start after a visible gap, and Queue/Access remain hoverable across
  their useful hitbox.

## Boundary

This is a shell geometry and navigation hitbox correction. It preserves the
desktop rail width, collapse behavior, mobile drawer, routes, and content.
