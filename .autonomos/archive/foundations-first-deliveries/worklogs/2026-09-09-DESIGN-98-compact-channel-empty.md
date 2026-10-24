# DESIGN-98 — Compact channel empty state

- Date: 2026-09-09
- Status: completed for the channel-management slice; DESIGN-98 remains in progress
- Scope: reduce the vertical weight of the no-channel state without changing the
  channel creation flow or hiding its recovery path
- Base: `0a59fddb` (`main`, after PR #159)
- Branch: `feat/design-98-compact-channel-empty`

## Changes

- Replaced the centered generic empty card on Channels with the same compact
  status-row grammar already validated for Overview and Queue.
- Kept the title, recovery explanation, accessible live status, and the existing
  prominent `Create channel` action in the page header.
- Removed the route's dependency on the generic `Empty` composition; the row
  now expresses a missing collection as operational status rather than a
  separate dashboard panel.

## Rationale

The independent UX audits identified Channels as a remaining contributor to
stacked, repetitive empty-state cards. This is a deliberately local use of the
compact row: Media, notifications, and picker-specific states retain their own
contracts until their workflows provide evidence for the same treatment.

## Verification

- `bun run check` is required before integration.
- Verify the authenticated Channels route in English and French and confirm
  the create-channel action remains visible and keyboard reachable.
