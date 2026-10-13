# UX-248 — Preview Calibration Review (Diagnostic, No Implementation)

- Base: `c7beed91a` (recorded via `git rev-parse HEAD | tee .git/postbot-mission-base`).
- Status: diagnostic complete; no product change.
- Current decisions distinguished from abandoned ones: compact two-column
  galleries (112 px cells, single image bounded, normal page flow, no internal
  scrolling) apply to DEV.to articles and manual/custom channels, superseding
  the earlier vertical uncropped mode and internal scroll regions. Link cards
  stay deferred by the owner. Bluesky/Mastodon keep their platform-specific
  mosaics; X/LinkedIn share the generic grid.
- Retained proofs mapped: destination truthfulness journey (five platforms,
  sample identity, no-button actions, 1280/390 overflow, axe, discord/devto
  themes, rich Discord formatting, spoilers, plus the Bluesky three-image
  mosaic and Bluesky/X/Mastodon theme observations added by this reprise),
  manual/article four-image compact journeys, overlap regression, Discord
  renderer tests, article component tests, outcome-states six-combination
  matrix. Mastodon multi-image keeps code plus the earlier disposable
  captures; only the Bluesky spanning case is durably covered.

## References verified (consulted 2026-10-07)

- Bluesky publication constraints (not layout): `app.bsky.feed.post`
  lexicon — text `maxLength: 3000` plus `maxGraphemes: 300` —
  https://github.com/bluesky-social/atproto/blob/41a561e80a6c906e9a6ec8e29f8ea970ce9fe2e9/lexicons/app/bsky/feed/post.json
  (latest touching commit `41a561e`, 2026-06-03);
  `app.bsky.embed.images` — at most 4 images, blobs up to 2 MB —
  https://raw.githubusercontent.com/bluesky-social/atproto/main/lexicons/app/bsky/embed/images.json.
  A lexicon constrains what can be published; it proves no visual
  arrangement.
- Bluesky mosaic convention (not constraint): `ImageGrid` in the Bluesky
  embed component (`embed.tsx`) —
  https://github.com/bluesky-social/social-app/blob/1a0db34dc9761b17fb1e55f0efedaeef07a184f8/bskyembed/src/components/embed.tsx
  (latest touching commit `1a0db34`, 2026-10-02): two images side by side in
  a 2:1 container; three with the first spanning the left column and the
  other two stacked right; four in a two-column 3:2 grid (more shown with an
  overflow badge, which Postbot never needs because validation caps at four).
- Mastodon publication surface (not universal limits):
  `POST /api/v1/statuses` accepts `status` text plus `media_ids[]` —
  https://docs.joinmastodon.org/methods/statuses/ — with no fixed length in
  the endpoint itself. Character and attachment counts are
  instance-configurable; Postbot's `MASTODON_DEFAULT_MAX_CHARACTERS = 500`
  correctly models the default, not a universal instance limit.
- Mastodon gallery convention (not constraint): `Item`/`MediaGallery` in
  `app/javascript/mastodon/components/media_gallery.jsx` —
  https://github.com/mastodon/mastodon/blob/0ed49ddccd1cd09fba2673d5f96e780d2b0b87ed/app/javascript/mastodon/components/media_gallery.jsx
  (latest touching commit `0ed49dd`, 2026-10-01): attachments rendered in
  array order, 3:2 global aspect, spanning first item for three, equal cells
  for four, small gap; focal points, placeholder blur, and sensitive handling are
  outside Postbot's calibrated scope.
- X: standard post 280 characters, up to 4 media items —
  https://help.x.com/en/using-x/how-to-post (official Help Center).
- Discord message limit (2,000) and Markdown formatting guide —
  https://support.discord.com/hc/en-us/articles/210298617-Markdown-Text-101-Chat-Formatting-Bold-Italic-Underline.
- DEV.to article capabilities — https://dev.to/p/editor_guide (via the
  earlier worklog; not re-fetched here).
- Postbot's own contracts match the constraint sources above (X weighted
  280 + 4 images, Bluesky 300 graphemes + 4, Mastodon default 500 + 4,
  Discord 2000 + 10, DEV.to title/body limits). No pixel-exact reproduction
  is claimed anywhere.

## Review probes (one disposable, one retained)

A disposable spec first drove all five built-in channels with a distinctive
381-character body (over X-280 and Bluesky-300, under the Mastodon default 500 and
Discord-2000), a DEV.to title plus Markdown (headings, bold, underline,
strikethrough, lists, spoilers), four uploaded images, and narrow-width
captures per platform (inspected for all five). It was removed after
measurement; the per-platform observations above come from it. The Bluesky
three-image mosaic, theme surface differences, and geometry assertions were
then moved into the existing destination-truthfulness scenario as retained
proof (see below). No provider was contacted; no `apps/web` file changed
during any browser run. The disposable run went green `1/1` in `13.6 s`
after two probe-only fixes (pre-selected first channel; rich-text
assertions); no product code was touched for either.

## Per-platform rundown (observed results only)

Observed on the tested examples: a distinctive 381-character body (over
X-280 and Bluesky-300, under Mastodon-500 and Discord-2000), a DEV.to title
plus Markdown (headings, bold, underline, strikethrough, lists, spoilers),
four uploaded images, and narrow-width captures per platform (inspected for
X, Bluesky, Mastodon, DEV.to, and Discord).

- X: rendered content and readability confirmed on the tested example. Full
  381-char text shown without truncation, with explicit `381 / 280 weighted
  characters` capability feedback (limits enforced at validation, preview
  honest). Four images in the generic 2-column grid; illustrative identity;
  static actions; narrow readable.
- Bluesky: rendered content and readability confirmed on the tested example.
  Full text shown. Four images in a 2-column 3:2-cell grid; proportions
  compared against the historical Bluesky embed reference above (not against a
  fresh side-by-side capture). Three-image spanning layout now durably
  covered (see retained proof below); narrow readable.
- Mastodon: rendered content and readability confirmed on the tested example.
  Full text, federated sample handle, four images in a 3:2 grid with rows
  and tight gap; proportions compared against the historical gallery
  reference above. Star action row; narrow readable. Multi-image order
  beyond the Bluesky case remains read from code (`media.map` preserves
  upload order), not visually demonstrated.
- Discord: rendered content and readability confirmed on the tested example.
  Markdown emphasis (bold, underline, strikethrough), lists, code
  literalness, and spoiler reveal all render; full long text; compact
  four-image grid; narrow readable.
- DEV.to: rendered content and readability confirmed on the tested example.
  Title heading plus full Markdown body, compact gallery, narrow readable.
  No invented tags, reading time, cover, or embeds, per the editor-guide
  reference.
- Themes: discord/devto surface differences already durably proven by the
  retained journey. Bluesky/X/Mastodon light/dark computed backgrounds now
  asserted different, which proves only that themed surfaces adapt — not, by
  itself, satisfactory contrast. Readability evidence is separate:
  Bluesky light/dark captures inspected, the retained journey's axe scan
  runs on every width pass, and all five narrow captures were inspected.

## Retained proof added (no product change)

The existing destination-truthfulness scenario in
`e2e/web-124-outcome-states.spec.ts` now ends with a Bluesky three-image
mosaic block: three distinguishable canvas assets (red/green/blue with
digits), geometry re-measured inside the 1280/390 loop after each resize
(first cell taller than 1.7× the second, left column before right column,
second and third stacked and x-aligned, container ratio within 1.8–2.2 of
2:1, no page overflow per width with screenshots), source-text preservation,
and light/dark surface-difference assertions for Bluesky, X, and Mastodon.
Earlier interrupted attempts withdrew canvas and asset-source order assertions
following intermittent swaps. The resumed pass restores the canvas proof while
waiting for each uploaded image to appear and finish loading before adding the
next. DOM color order is checked at both widths alongside fresh geometry.
This proves sequential, completed additions; it does not settle simultaneous
upload ordering. A temporary test-only mutation removing the first cell's row
span fails the height assertion (72.8 versus required greater than 123.8 px).
The mutation is removed and no product file changes.

## Corrections (priority order)

1. Done as retained proof above: durable Bluesky three-image mosaic
   regression (loaded image order, geometry at both widths, counts, overflow,
   themes, text). Earlier withdrawn assertions are superseded by the resumed
   sequential-addition proof (see below).
   No further action on the mosaic.
2. (Secondary, owner direction needed before any work) Decide whether X
   multi-image deserves platform-specific collage treatment or keeps the
   shared generic grid. Purely decorative difference on the tested example;
   no content error demonstrated. Not started here per instruction.
3. No third product correction is justified. Link cards stay explicitly
   owner-deferred (deferral recorded across the Discord passes); that decided
   reserve is distinct from the remaining Discord syntax (subtext, mentions,
   custom emoji, multiline quotes, embeds), for which no deferral decision
   was found — it remains an undecided question, not a scheduled
   reservation. Pixel-fidelity sign-off stays an owner reserve.

## Proposed follow-ups (not started)

A. Composer media selection ordering (from the withdrawn assertion):
   sequential single-file uploads occasionally rendered the first two
   attachments swapped (observed 3 times in 11 identical-code runs via two
   independent readback methods; green otherwise). Undetermined whether the
   Uppy-completion append path races or the readback methods raced image decoding.
   Bounded diagnostic: instrument selection-append order versus finalize
   order, then either fix or restore a deterministic order assertion. This
   matters because published carousels follow selection order.
B. Discord parity across editor, preview, and payload (prioritizing
   misleading divergences, reusing renderer tests, the destination
   scenario, and the official formatting reference).

Decorative minors (glyph styles, exact gaps, engagement counts) stay
secondary per instruction and are not listed as corrections.

## Limits

- Rendered color order is now asserted for three completed sequential additions
  at both widths. Simultaneous additions and other platforms remain unverified.
- Official limit sources are first-party for X Help, Discord support, the
  Bluesky lexicons, the Mastodon API docs, and the app/gallery code files
  above; the DEV.to editor guide is via the earlier worklog. Postbot's
  contracts are the operative boundary regardless.
- No provider publishing was performed; transmission fidelity (facets,
  markdown-to-post conversion) is outside preview calibration.

## Resumed validation and handoff

The owner requested completion after the other agent became unavailable.
Base: `6feafe533`, plus inherited changes to the spec, task board and this report.
The retained spec restores order checks, waits for loaded images, and measures
geometry at both 1280 and 390 px. No product behavior or runtime file changes.
Duplicate UX-334 task registration removed.

The selector retains exactly `e2e/web-124-outcome-states.spec.ts` for the three
explicit mission paths. This is executable test work, not documentation-only.
The focused scenario passed in 20.1 seconds (24.3 with harness), followed by a
red test-only row-span mutation proving the geometry check is sensitive.
Final selected file: 6/6 passed in 2.4 minutes, including the final mosaic
scenario in 18.2 seconds. Static checks passed; all 17 package unit tasks
passed from valid cache, plus 56 script tests (388 assertions) in 1.73 seconds.
The relevant web build and its 17 dependency tasks passed from valid cache.
Documentation spelling and diff checks passed after finalization.
No full matrix replay and no movement of `validated/full`.

The requested test/record finishing pass is complete. UX-248 stays open as the
umbrella calibration task, with its remaining limits made explicit rather than
claiming global platform fidelity.
Pixel fidelity, provider transmission and simultaneous attachment ordering are
not claimed. Link cards remain owner-deferred; X collage remains a decorative
approximation; remaining Discord syntax is an undecided question.

Next recommendation: UX-335, diagnose concurrent media additions, separating file-add
order, completion order, selected order and submitted order. The earlier
intermittent result is a signal to investigate, not an established product bug.
UX-334 Discord parity remains a separate proposed diagnostic. No changes to
AGENT.md or DESIGN.md: this evidence is specific to the fixture and preview.
