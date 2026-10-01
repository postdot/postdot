# UX-250 — Distinguish the editable source surface

Status: Scoped pass complete; UX-250 remains in progress

Resumed the planned lifecycle review after the dark shell correction. Reviewed
manual-due and failed LinkedIn detail captures at 820 pixels in French/dark,
using isolated simulated outcomes. Actions and failure recovery stay explicit;
no provider operation was triggered. The dominant editing area used a 35 percent
inset blend, nearly merging with the surrounding page. Apply the existing raised
content role, shared with new-publication authoring, to the editable source.
This changes one surface class without changing editing, recovery, media,
lifecycle actions, target customization or technical disclosures.

File: publication-editor-source-section.tsx. Existing mixed-state journeys cover
manual and failed detail rendering, both themes/locales, keyboard navigation and
page overflow. Full root check passed with 44 main browser journeys, 2 password-reset journeys, unit checks, formatting, lint/spelling, types and production builds (/tmp/herald-ux264-full.log). Reviewed the updated French/dark 820-pixel manual-detail capture: the editable source now separates visibly from the page, with secondary controls still quiet. UX-250 remains open
for connected-destination and further lifecycle review; this scoped correction
must not claim those remaining states complete.
