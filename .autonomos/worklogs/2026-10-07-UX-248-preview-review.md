# UX-248 — Preview Calibration Review (Diagnostic, No Implementation)

- Base: `c7beed91a` (recorded via `git rev-parse HEAD | tee .git/herald-mission-base`).
- Status: diagnostic complete; no product change.
- Current decisions distinguished from abandoned ones: compact two-column
  galleries (112 px cells, single image bounded, normal page flow, no internal
  scrolling) apply to DEV.to articles and manual/custom channels, superseding
  the earlier vertical uncropped mode and internal scroll regions. Link cards
  stay deferred by the owner. Bluesky/Mastodon keep their platform-specific
  mosaics; X/LinkedIn share the generic grid.
- Retained proofs mapped: destination truthfulness journey (five platforms,
  sample identity, no-button actions, 1280/390 overflow, axe, discord/devto
  themes, rich Discord formatting, spoilers), manual/article four-image
  compact journeys, overlap regression, Discord renderer tests, article
  component tests, outcome-states six-combination matrix. Bluesky multi-image
  has code plus disposable captures only; Mastodon multi-image likewise.

## References consulted (2026-10-07)

- X: standard post 280 characters, up to 4 media items —
  https://help.x.com/en/using-x/how-to-post (official Help Center).
- Bluesky: 300 characters/graphemes per post, up to 4 images —
  multiple third-party 2026 specification summaries;
  mosaic ratios follow the Bluesky embed implementation per the earlier worklog (not
  re-fetched here; Herald code verified against the worklog's stated ratios).
- Mastodon: 500-character default, 4 attachments, gallery ratios per
  `media_gallery.jsx`/`components.scss` (earlier worklog; code verified
  against its stated 3:2 global, spanning, gap rules).
- Discord: 2,000-character message limit and Markdown formatting guide —
  https://support.discord.com/hc/en-us/articles/210298617-Markdown-Text-101-Chat-Formatting-Bold-Italic-Underline.
- DEV.to: article Markdown/HTML/Liquid capabilities —
  https://dev.to/p/editor_guide (per earlier worklog).
- Herald's own contracts match: X weighted 280 + 4 images, Bluesky 300
  graphemes + 4, Mastodon 500 + 4, Discord 2000 + 10, DEV.to title/body
  limits. What each source establishes versus interpretation is separated
  below; no pixel-exact reproduction is claimed anywhere.

## Review probe (temporary, removed after measurement)

One disposable spec drove all five built-in channels with a distinctive
381-character body (over X-280 and Bluesky-300, under Mastodon-500 and
Discord-2000), a DEV.to title plus Markdown (headings, bold, underline,
strikethrough, lists, spoilers), four uploaded images, and narrow-width
captures per platform. Green `1/1` in `13.6 s`. Two probe-only fixes
(pre-selected first channel; rich-text assertions) touched no product code.
No provider was contacted; no `apps/web` file changed during runs.

## Per-platform rundown

- X: conform on verified criteria. Full 381-char text rendered without
  truncation, with explicit `381 / 280 weighted characters` capability
  feedback (content truth: limits enforced at validation, preview honest).
  Four images in the generic 2-column grid, illustrative identity, static
  actions, narrow readable. Visual approximation only: the generic 4:3 crop
  grid is shared with LinkedIn rather than X-specific collage treatment.
- Bluesky: conform on verified criteria. Full text, four images in the
  2-column 3:2-cell grid matching the referenced embed ratios (code and
  layout classes verified), narrow readable. Proof debt only: no durable
  multi-image capture exists (see correction 1).
- Mastodon: conform on verified criteria. Full text, federated sample
  handle, four images in the 3:2 global grid with rows and 2 px-equivalent
  gap matching the referenced gallery rules, star action row, narrow
  readable. Same proof-debt note as Bluesky, with the earlier disposable
  review as evidence.
- Discord: conform on verified criteria. Markdown emphasis (bold, underline,
  strikethrough), lists, code literalness, and spoiler reveal all render;
  full long text; compact four-image grid; narrow readable. Explicitly
  untreated remainder (subtext, mentions, custom emoji, multiline quotes,
  embeds) is deferred scope, not a new finding.
- DEV.to: conform on verified criteria. Title heading plus full Markdown
  body (headings, lists, quotes, code per component tests), compact gallery,
  narrow readable. No invented tags, reading time, cover, or embeds, per the
  editor-guide reference.

## Corrections (priority order, none implemented)

1. Retain a durable Bluesky three-image mosaic regression (new useful
   coverage: the spanning first-cell layout has zero durable assertions
   today). Acceptance: three uploads in order; first cell spans two rows in
   a 2:1 container; three cells total in source order; no page overflow at
   1280 and 390 px; source text byte-identical afterwards. This is proof
   debt for already-correct code, not a demonstrated content defect.
2. (Secondary, owner direction needed before any work) Decide whether X
   multi-image deserves platform-specific collage treatment or keeps the
   shared generic grid. Purely decorative difference today; no content error
   demonstrated.
3. No third correction is justified. Remaining Discord syntax, link cards,
   and any pixel-fidelity sign-off stay explicit owner reserves (deferred,
   not open implementation work).

Decorative minors (glyph styles, exact gaps, engagement counts) stay
secondary per instruction and are not listed as corrections.

## Limits

- Media order asserted via layout classes and counts on identical-byte
  fixtures, plus code reading (`media.map` preserves upload order); distinct
  visual assets were not compared pixel by pixel.
- Embed/gallery sources were not re-fetched; ratios were verified
  against the worklogs' stated rules and Herald's implementation.
- Official limit sources are third-party summaries except X Help,
  Discord support, and the DEV.to editor guide; Herald's contracts are the
  operative boundary regardless.
- No provider publishing was performed; transmission fidelity (facets,
  markdown-to-post conversion) is outside preview calibration.

## Validation economy (ADR-077)

Documentation-only delivery. The probe was diagnostic evidence, not a gate;
no platform × theme × width matrix was replayed. Static gates apply.
`validated/full` is not moved; this commit is locally validated only.
