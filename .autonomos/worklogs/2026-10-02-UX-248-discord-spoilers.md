# UX-248 — Discord spoiler reveal

## Approved behavior

Owner approved hidden Discord spoilers with an intrinsic reveal action. Parse
Discord double-pipe syntax through remark-inline-spoiler 2.1.0, a MIT extension
compatible with the existing remark parser. Map spoiler nodes to a local inline
button. Its neutral mask occupies the text footprint; click, Enter or Space
reveals the content. A second activation hides it again. Each spoiler has its
own state and all reveal state resets when the message body changes.

Closed content is invisible and hidden from assistive technology. Localized
reveal/hide names, expanded state and visible keyboard focus identify the action
without disclosing the secret. Nested formatting still renders; escaped markers
and inline/fenced code stay literal. Links remain inert, remote images are not
loaded, and HTML stays escaped. Preview interaction never edits the source.

Files: publication-discord-body.tsx and its renderer tests, translation catalogs,
web manifest/lockfile, and the destination browser journey. Parser reference:
https://github.com/hlysine/remark-inline-spoiler

## Verification

Six renderer tests passed. Focused destination browser journey passed, including
independent spoilers, click and keyboard reveal/hide, accessibility scan,
unchanged source content and reset on source edits. Fresh 390px light capture
inspected. Full repository gate passed: 52 browser journeys, 2 password-reset
journeys and 17 successful build/check tasks. The shared publication preview
chunk increases from 80.49 to 84.59KB gzip; entry JavaScript stays 317.95KB raw.

## Continuation

UX-248 remains in progress for remaining formatting and destination calibration;
link cards remain deferred by the owner. No further approval needed for this
implemented behavior. No AGENT.md changed.
