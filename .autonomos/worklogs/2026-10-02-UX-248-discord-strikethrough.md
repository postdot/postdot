# UX-248 — Discord strikethrough

## Changes

Render double-tilde strikethrough through maintained micromark and mdast
extensions in the existing ReactMarkdown pipeline. Single tildes stay literal.
Keep the existing underline transform, code handling, escaped markers and inert
links. No additional preview controls or remote resources are introduced.

Add explicit web dependencies `micromark-extension-gfm-strikethrough` 2.1.0 and
`mdast-util-gfm-strikethrough` 2.0.1. Use the narrow syntax extension rather than
enabling unrelated GFM tables, task lists and automatic links in Discord.

References:

- [Discord formatting](https://support.discord.com/hc/en-us/articles/210298617-Markdown-Text-101-Chat-Formatting-Bold-Italic-Underline)
- [Micromark extension](https://github.com/micromark/micromark-extension-gfm-strikethrough)
- [Syntax-tree extension](https://github.com/syntax-tree/mdast-util-gfm-strikethrough)

## Verification

Five renderer tests passed, including nested emphasis/underline, literal single
tildes, escaped markers, inline/fenced code, and the existing unsafe-resource
checks. Focused destination browser journey passed. Fresh 390px dark/light
captures inspected, with the rich example also checked at 1280px. Browser checks
assert the semantic deletion element and actual line-through styling.

The first gate stopped at the plugin context type: Unified's base data interface
does not declare the extension registry. Use a compatible processor context and
a locally typed registry; renderer behavior is unchanged. Full repository gate
passed on rerun: 51 browser journeys, 2 password-reset journeys and 17 successful
build/check tasks. The shared publication preview/target chunk increases from
79.70 to 80.49KB gzip (+0.79KB). Entry JavaScript remains 317.95KB uncompressed;
its gzip size changes from 102.44 to 102.45KB with generated chunk references.

## Owner question and continuation

Asked whether Discord spoilers should be hidden with an intrinsic reveal action
or remain visible during authoring. Both preserve draft data but the former
introduces interaction into currently passive preview content. Keep this choice
explicit before implementing spoiler behavior. Other remaining formatting and
visual calibration stay in UX-248; link cards remain deferred.

UX-248 remains in progress. No AGENT.md or accepted design contract changed.
