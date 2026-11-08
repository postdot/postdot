# UX-281 — Unified editor actions and emoji surfaces

## Owner direction

Place attachment actions with the other editor actions at the top. Distinguish
stored attachments from external article images by their glyphs. Use shared UI
tooltips without duplicate browser titles. Remove the enclosing writing-area
focus ring. Make emoji loading stable and search consistent with shared inputs.

## Changes

- Add a toolbar mount point to configured and native editors. Move the existing
  attachment trigger into that point through a React portal; retain one picker,
  upload controller and media selection across editing scopes. Keep thumbnails
  below the body. Sources without an expanded text field retain their attachment
  action rather than losing the media-only workflow.
- Use Solar Paperclip for attachments and Gallery for external article images,
  selected from the local Solar catalog. Keep accessible action labels.
- Compose shared tooltip triggers with formatting, link, image and emoji actions.
  Remove native action titles from channel selection. Add shared hints to channel
  removal, media removal/reordering and resetting destination copy.
- Remove writing-area focus rings, preserving the caret and visible keyboard
  focus on actionable controls. Standard popup fields retain standard focus styles.
- Export the shared input class contract for a headless library input that cannot
  render our Input component. Frimousse search retains its search and keyboard
  behavior while using the same field surface, sizing and focus styling, plus a
  Solar magnifier. Do not duplicate a custom primary ring from selected channels.
- Reserve the final emoji panel dimensions for both lazy-module loading and
  dataset loading. Use restrained skeletons, with reduced-motion support and a
  screen-reader loading status. Preload the module on intent. Skin-tone control
  has a translated accessible label and shared tooltip.

The owner-accepted cross-cutting action-hint and authoring-focus rules are recorded
in DESIGN.md. No AGENT.md change: the existing shared-primitive rules already
apply; this is a design direction rather than a new operating procedure.

## Verification

Nine existing targeted browser journeys pass for composer recovery, destination
isolation, Unicode emojis, source fallback, links and external article images.
A new delayed-data journey verifies fixed loading geometry, shared search styling,
UI tooltips without native titles, keyboard dismissal, accessibility and writing
focus without a box shadow. This journey also passes. The tooltip fixture targets
the shared popup data slot because the installed Base UI tooltip renders a div,
not an explicit tooltip role.

Responsive screenshots were inspected at 390 pixels for loading and loaded emoji
states; existing editor journeys also capture 820 and 1280 pixels. The final
`bun run check` passed: formatting, lint, spelling, type checks, unit tests,
61 main browser journeys, two password-reset scenarios and all 17 build tasks.
Log: `/tmp/postbot-editor-actions-check.log`.

## Follow-up

Keep the accepted rule for future icon-only actions. Do not treat tooltip text as
primary information on touch devices. Physical touch/IME validation remains under
UX-277; no browser emulation is claimed as physical-device evidence.
