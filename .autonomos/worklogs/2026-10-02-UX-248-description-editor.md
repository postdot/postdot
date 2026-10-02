# UX-248 — Attachment descriptions in the viewer

## Changes

The compact composer now exposes the attachment's accessibility description in
its existing image viewer. Keep thumbnails unchanged; avoid more competing hit
areas, badges, or persistent fields beneath each thumbnail. A two-row field is
available only for selected attachments in editable compact composition. It uses
the existing selection update contract, not library metadata mutation. The viewer
image receives the edited description too. Existing input-aware keyboard handling
keeps navigation shortcuts out of text entry.

Opening an attachment from compact composition now follows attachment order and
includes only selected attachments. Opening media from the library still follows
the library collection. Previously both paths used library order.

Detail previews fetch missing destination assets in editable as well as locked
states, covering media present only in a channel adaptation and outside the
currently loaded library page.

## Verification

Focused isolated browser journey passed. At 1280 and 390 pixels, edit the first
image description, type an arrow key without navigating, move to the next image,
return with the description preserved, close the viewer, and verify the post's
image alternative. Inspect settled desktop/mobile captures; initial captures were
inside the image transition and were replaced. Verify destination-only asset
lookup with a restricted library response and a source document that omits it.

Full repository gate passed: 51 browser journeys, 2 password-reset journeys
and 17 successful build/check tasks.

## Continuation

UX-248 remains in progress for destination formatting and visual calibration.
Link cards remain deferred. No AGENT.md or accepted design contract changed.
