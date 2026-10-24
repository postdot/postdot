# DESIGN-121 — Remove the expanded sidebar gutter

- Date: 2026-09-10
- Status: implementation complete on `fix/design-121-sidebar-gutter`
- Scope: owner-requested shell geometry correction
- Related task: DESIGN-121
- Related issues: ISSUE-064, ISSUE-065

## Owner feedback addressed

After the calendar-first shell was merged, the expanded desktop sidebar still
showed an empty vertical strip at its right edge. This was the inset primitive's
desktop padding, which remained after the sidebar's own surface had been
flattened onto the shared canvas.

## Changes

- Remove the desktop inset padding from Postbot's expanded sidebar container.
- Preserve the compact rail padding so icon buttons retain their intended
  eight-pixel inset and full-width hit area.
- Add browser coverage for the expanded container's zero padding while keeping
  the existing compact geometry checks.

## Boundary

This is a shell-only geometry correction. It does not alter the sidebar width,
collapse behavior, mobile drawer, navigation routes, page surface, or content.
