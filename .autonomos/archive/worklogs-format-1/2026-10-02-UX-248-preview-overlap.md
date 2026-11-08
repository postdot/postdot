# UX-248 — Tall preview and delivery overlap

## Finding and correction

Owner supplied a DEV.to four-image screenshot in which the tall preview overlaps
delivery settings. Vertical article images were intentional, but the shared
composer's sticky preview could move across later grid rows. Remove sticky
positioning and keep preview height bounded to the desktop viewport, with local
vertical scrolling. Mobile remains in the normal page flow after settings/actions.

The preview scroll region has an accessible name, keyboard focus and a visible
focus outline. Images preserve their order and article proportions. No delivery,
validation or publication semantics changed. This is a shared composer correction,
so detail and new-publication surfaces use the same behavior.

## Verification

Add a durable browser regression using four numbered image fixtures and a DEV.to
channel. At 1280px assert that the preview ends before delivery settings both
before and after page scrolling; verify actual preview overflow and keyboard End
scrolling. At 390px verify no page overflow. The focused journey passed and its
fresh desktop screenshot was inspected: settings/actions are fully unobstructed.
The first full gate caught duplicate named regions from the scroll wrapper and
the nested preview. Use a named group for the wrapper, preserving its keyboard
access, and rerun the complete gate: 51 browser journeys, two password recovery
journeys, all package checks and 17 build tasks passed.

## Continuation

Resume remaining preview accessibility and platform calibration after this fix.
UX-248 stays in progress. No AGENT.md rule changed.
