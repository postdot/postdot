# DESIGN-121 — Calendar-first project overview and flat shell follow-up

- Date: 2026-09-09
- Status: implementation complete on `fix/design-overview-calendar-sidebar`
- Scope: owner-requested navigation, shell-surface, and compact-sidebar follow-up
- Related tasks: DESIGN-121, WEB-122
- Related issues: ISSUE-063, ISSUE-064, ISSUE-065

## Owner feedback addressed

The project overview was still a redundant metrics-and-recent-publications page
next to the calendar. The owner clarified that Herald's primary project job is
planning publications, so the calendar should be the first project view. The
owner also clarified that the sidebar and fixed header belong to the same base
canvas; only the active page should read as a raised surface. Finally, compact
navigation had an incomplete hover and click target for Queue and Access.

## Changes

- Made `/dashboard/projects/:projectId/overview` render the publication
  calendar and its existing schedule summary as the canonical project home.
- Kept `/dashboard/projects/:projectId/calendar` as a redirect to the canonical
  overview route for old bookmarks and external links.
- Removed the duplicate Calendar item from project navigation.
- Flattened the sidebar onto the canvas by removing its own background, border,
  and shadow treatment, including the inset primitive's inner surface.
- Expanded compact sidebar buttons to the full usable rail width and centered
  their icons, including footer actions, so hover and click behavior is stable
  across Queue, Access, settings, and sign-out.
- Preserved the raised page surface, sticky header behavior, mobile agenda, and
  the existing calendar overflow treatment (`+N` after the first three cards).

## Verification

- Targeted Playwright coverage for shell, instance scope, media flow, empty and
  populated overview states, and outcome states — passed.
- Typecheck and localization coverage — passed before this follow-up's test-only
  corrections.
- Full repository validation is required before integration.

## Boundary

This slice changes route composition, shared shell presentation, and navigation
hit areas only. It does not change publication data, scheduling semantics,
provider behavior, API contracts, or the calendar's responsive agenda model.
