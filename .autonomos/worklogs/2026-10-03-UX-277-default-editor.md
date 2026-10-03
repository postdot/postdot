# UX-277 — Default editor and contextual links

## Scope and owner direction

The owner approved generalizing Tiptap after the compose and existing-publication
pilots. Social posts keep ordered attachments; articles may place images in the
body. The latter does not authorize changing private-media access or retention.

## Changes

- Install the requested upstream Tiptap skill locally using the skills CLI.
  Remove the unrelated create-pr skill also offered by that installation.
  Treat upstream guidance as technical advice, not product or spending authority.
- Use the configured editor by default on new and existing publication routes,
  including production. Keep a development-only legacy query for migration
  verification; old tiptap query links remain compatible. The development lab
  remains unavailable in production.
- Preserve raw text/Markdown and asset references as the API and recovery
  boundary. Keep native controls for non-body target fields and unsupported
  Markdown in source mode.
- Add an article-only link control with selection capture before popup focus,
  HTTP/HTTPS/mailto validation, replacement/removal and editor focus restoration.
  Keep application icons from Solar and popup behavior from Base UI.
- Update visible-document browser assertions for contenteditable controls.
  Retain exact API payload and native-editor recovery checks rather than replacing
  transport fidelity checks with visual text normalization.

## Validation

A focused link journey verifies selected-text linking, unsafe address rejection,
Markdown output, undo, removal, focus restoration and destination-specific tools.
The first broad browser run exposed native textarea-only assertions and one
missing accessible popup name. Adapt assertions to the visible editor, retain
backend fidelity checks, replace direct textarea selection with keyboard
selection, and name both contextual popups. Six repaired workflow journeys and
six tool journeys pass. Popup accessibility checks also exposed insufficient
contrast in the dark-theme link error; use the existing foreground text and
associate the error with its input. The focused link/accessibility journey passes.
The final `bun run check` passed: 59 main browser journeys, two password-reset
journeys and all 17 build tasks, alongside formatting, lint, spelling, types
and unit checks. Log: `/tmp/herald-editor-default-complete-check.log`.

## Article images and animated media

Tiptap Image displays images and FileHandler supplies paste/drop hooks; neither
owns uploads, storage authorization, validation or media retention. The existing
Herald upload pipeline remains authoritative. The current Unicode emoji picker
already inserts text with undo support and does not need replacement simply because an
upstream emoji node exists.

DEV.to article body images need URLs that remain accessible after publication.
ADR-022 deliberately supplies expiring signed URLs for private media. A durable
public-image policy is an owner decision still pending. Do not implement permanent
public access, embed base64, or persist temporary URLs in article Markdown as a
shortcut. After approval, design durable asset references, delivery resolution,
preview access and usage retention together. GIF delivery and external catalog
selection remain tracked separately under UX-279.

## Next steps

Default-editor regression is complete; integrate and push this pass.
Proceed with article image insertion after its publication-access policy is
approved. Physical touch and IME validation remain explicitly outstanding.
No AGENT.md update: this pass implements existing direction and records its
specific rollout evidence; it does not establish a new operating rule.

## GIF readiness findings

The current media upload policy accepts PNG, JPEG and WebP, but does not inspect
GIF. The data model records animation metadata, and the WebP inspector detects
animation; that is not evidence of end-to-end animated publishing support. All
five built-in publisher profiles currently advertise JPEG/PNG, and their
contracts/adapters enforce that restriction. A GIF search widget would therefore
expose results the publication pipeline cannot deliver reliably.

Sequence the GIF work as media inspection and limits, destination-specific
upload/delivery acceptance, then optional search/catalog UI. Prefer local-library
selection first if animated delivery is adopted. An external search integration
has separate availability, attribution, privacy and commercial obligations.
[GIPHY's official API documentation](https://developers.giphy.com/docs/api/)
requires an API key and attribution and describes production access review and
pricing. No account, API key or service subscription was created.

[Tiptap's release notes](https://tiptap.dev/blog/release-notes/were-open-sourcing-more-of-tiptap)
confirm that Emoji and FileHandler moved to MIT-licensed open-source packages.
These are editor primitives, not a GIF catalog or a publishing capability.

## Selection and focus stabilization

The broad run still exposed an inconsistent link fixture after native Home and
rapid selection keys immediately following undo: the visible selection sometimes
contained extra characters before the popup opened. The link fixture now sets an
exact DOM selection, the contenteditable counterpart of textarea selection setup,
and asserts the selected text before opening the popup. It retains keyboard
activation, Enter submission, undo and focus assertions; no assertion is skipped.
Production capture reads the visible DOM range before popup focus and synchronizes
it through public ProseMirror selection APIs. Formatting buttons preserve mouse
focus. Popup closing owns focus restoration once, instead of competing delayed
editor focus calls. Ten consecutive link journeys pass. Eight editor, recovery, media and emoji
regression journeys also pass after focus stabilization. The final repository
gate passed before integration.
