# UX-248 — Compact article media

## Owner correction

Owner rejected internal preview scrolling and oversized vertical DEV.to images.
Prioritize the authoring workspace over full article simulation. Multiple DEV.to
images now use two columns with 112px image cells; a single image is bounded to
176px while preserving its proportions. Keep source order and all media visible.
Remove the preview's internal desktop scroll area and its extra keyboard stop.
Keep the non-sticky grid positioning that prevents overlap with delivery settings.

This supersedes the vertical DEV.to media choice and internal scrolling recorded
in the previous media/overlap passes. Manual/custom media presentation remains as
before. This is a compact visual simulation, not a claim that DEV.to publishes
attached images as a gallery. No delivery or content contract changed.

## Verification

Update the durable four-image regression: desktop gallery height at most 240px,
preview below 500px, no internal overflow and no delivery overlap after page
scrolling. Preserve narrow page-overflow validation. Focused journey passed;
inspected the fresh 1280px capture with editor, compact four-image preview,
delivery and final actions visible together. Full repository gate passed: 51 browser
journeys, 2 password-reset journeys and 17 successful build/check tasks.

## Continuation

Resume preview accessibility after the correction. UX-248 remains in progress.
No AGENT.md rule changed.
