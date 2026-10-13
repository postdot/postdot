# UX-280 — External article images

## Accepted scope

The owner approved direct external image URL insertion for articles. Preserve the
single-process deployment and private media storage. Public image hosting by
Postbot remains an optional future capability with its own explicit activation,
access and retention contract; this change does not implement it or supersede
ADR-022.

The existing media URL importer downloads bytes into Postbot's storage and does
not retain the source URL. Filtering that library cannot provide external article
references. Keep its behavior for social attachments, separately from article
image insertion. Do not infer source addresses for previously imported assets.

## Implementation

Use the pinned open-source Tiptap Image extension for the article configuration.
Add a compact image URL and alternative-text popup. Selecting an existing image
allows replacement without creating duplicates. Preserve selection, undo and
focus through the editor's public commands and selection bookmarks. Start a new
history group for each image insertion or replacement: undoing a quick address
change restores the previous image rather than deleting the whole insertion.

Persist ordinary Markdown, not editor JSON or private asset URLs. Escape
alternative text and quoted titles, and delimit image addresses to preserve
parentheses and query parameters through conversion. Unsupported source syntax
remains in source mode without being silently dropped. In particular, image tokens
embedded in paragraph text remain raw because this editor uses block images;
loading them as invalid paragraph children could otherwise lose adjacent text.

Render compact images in the editor and article preview, with preserved aspect
ratio, no internal image scrolling, and no referrer header. Loading an external
image contacts its host from the browser; no backend proxy, import, new storage
service or public-media route is added. Reject embedded bytes, credentials,
relative addresses, obvious private hosts and the browser's current origin.
These guards do not certify public reachability or permanence.

Files: configured editor, article image control, article preview, Markdown
configuration, URL guard, translations, dependency manifest/lock and focused
unit/browser coverage. Social and Discord editors do not expose the action;
existing media attachment and cover handling are preserved.

## Verification

Seven focused unit checks passed, including escaped Markdown round trips and
invalid address rejection. Seven focused browser journeys passed, including API persistence, legacy
compatibility, recovery, image replacement, undo, accessibility and responsive
captures. The full `bun run check` passed: formatting, lint, spelling, type checks,
unit tests, 60 main browser journeys, two password-reset scenarios and all 17
build tasks. Log: `/tmp/postbot-external-article-images-check.log`.

## Follow-up

Public hosting remains deferred. If adopted, explicit publication-only exposure,
retention, deletion consequences and address migration must be designed together.
A library of reusable external references is also deferred rather than adding a
second media category prematurely. No AGENT.md update: existing domain and
security rules cover the accepted scope.
