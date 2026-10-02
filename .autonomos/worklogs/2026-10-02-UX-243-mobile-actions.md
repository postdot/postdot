# UX-243 — Mobile authoring action reachability

Status: bounded mobile-composition pass; broader UX-243 remains in progress.

## Finding and correction

PublicationComposer placed the draft preview between editing and delivery controls
at stacked widths. Media or long copy increased the distance from the editor to
scheduling and final actions, even though those controls belong to editing.

The shared composer now renders editor, delivery settings, final actions and
preview in that document order. At desktop widths the preview occupies the
adjacent grid column on the editor row; delivery and final actions retain their
full-width rows. At mobile/tablet widths the preview follows the controls, so
preview height cannot push them farther from the editor. The preview is retained
without a new label, tab, overlay or floating toolbar. A single control tree keeps the mobile keyboard path in editing, delivery and
final-action order without duplicate controls.

Both new-publication and existing-publication workflows use this composition.
No scheduling default, lifecycle transition, recovery, media or permission rule
changes. This is a reversible layout correction within the existing route jobs,
not a new global design contract.

## Verification

The native media journey checks populated authoring with an actual uploaded image
at 1440, 820 and 390 pixels: no page overflow; settings follow editing and preview
follows actions at stacked widths; desktop editor/preview align on one row.
Existing native media, lifecycle, recovery, keyboard and accessibility journeys
remain intact. Full `bun run check` passed: format, lint/spelling, types/localization, unit
checks, 48 main browser scenarios, two password-reset scenarios and all 17 build
tasks. Log: `/tmp/herald-ux243-mobile-check.log`. Reviewed the isolated mobile
failed-detail capture alongside the populated image-layout assertions. The live
web process stopped during validation and was restarted; both services are active.

## Next work

Retain the larger UX-243 task as active for remaining responsive review rather
than claiming all mobile/tablet surfaces complete. Review virtual-keyboard and
long-document use in a dedicated mobile environment before introducing sticky
or fixed controls. No AGENT.md update is needed: existing responsive composition
and browser-test rules already cover this change.
