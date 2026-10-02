# UX-276 — Reusable emoji authoring

## Scope and direction

Owner accepted the emoji-first recommendation, followed by destination-aware
formatting tools. Full editor engines remain a later decision. Evaluate Tiptap
and Editor.js against different destination formats and configurations before
any replacement; do not confuse rich editing with universal output support.
Keep source/destination payloads independent of the editing UI.

## Implementation

Use Frimousse 0.4.0 rather than building a picker, search engine or emoji grid.
Its picker is loaded lazily on opening. Serve the English/French Emojibase
17.0.0 datasets locally through a Vite asset plugin in development and production,
including the upstream MIT license. This avoids runtime CDN dependence and keeps
the initial JavaScript bundle free of emoji datasets.

PublicationTextEditor isolates Unicode insertion from payload ownership. Apply
it to new shared/destination copy and existing source/primary target text fields.
Selection is remembered before opening; the popup closes before native insertion
and returns focus to the textarea. Native insertText preserves browser undo where
supported; fall back to the existing controlled-value callback otherwise. Length
limits disable emojis that cannot fit rather than splitting a Unicode sequence.
Skin-tone selection and localized search use upstream primitives.

The accessibility scan found zero-based row/column ARIA indices in Frimousse
0.4.0. Correct these to one-based values through its supported component slots;
keep internal navigation indices unchanged. Do not suppress the scan.

## Verification

Browser journey covers selected-text replacement, cursor insertion, native undo,
keyboard selection, separate destination customization, mobile popup placement,
localized local datasets, Escape/focus return and an accessibility scan.
Initial test used the wrong search role; use the actual searchbox semantics.
Focus restoration initially conflicted with native insertion; closing before
inserting fixes the regression. Full repository gate passed: 53 browser journeys, 2 password-reset journeys
and 17 successful build/check tasks. Fresh desktop and mobile captures inspected.
Production static serving of the compiled English/French dataset endpoints
verified in-process with HTTP 200 and valid JSON. The lazy picker chunk is
27.44KB raw / 9.56KB gzip. Entry JavaScript grows from 317.95KB / 102.44KB gzip
to 346.42KB / 111.45KB gzip. Dataset files total approximately 1.59MB raw and
are emitted separately from JavaScript.

## Sources and continuation

- https://github.com/liveblocks/frimousse
- https://github.com/milesj/emojibase
- https://tiptap.dev/docs/editor/markdown

UX-277 tracks contextual formatting. UX-278 records configurable editor/GIF
assessment without choosing an engine or external media provider. GIF support
requires a separate media/delivery review; current built-in media declarations
accept JPEG/PNG. No accepted editor replacement or domain contract changed.
