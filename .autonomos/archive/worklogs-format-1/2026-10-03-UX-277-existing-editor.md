# UX-277 — Existing publication editor integration

## Scope and authorization

Continue the owner-approved configurable editor integration after UX-278.
Keep the development opt-in while validating existing publication editing;
production defaults remain unchanged.

## Changes

- Accept `editor=tiptap` on the existing publication route in development only.
- Reuse the same lazy configured component for the source body and the built-in
  Discord/DEV.to primary target text. Other custom fields retain their existing
  controls; the advanced provider JSON editor is unchanged.
- Source format determines plain/article configuration independently of the
  selected destination. Existing source revisions, target adaptations, conflict
  handling, recovery, media and publication lifecycle remain authoritative.
- Add strikethrough and inline code controls to rich configurations, make heading
  and list selection reactive, remove the redundant source toggle for plain copy,
  and move the focus ring inside the editor so its host cannot clip it.
- Declare ProseMirror's whitespace contract explicitly for line breaks and cursor
  behavior in the existing publication host.
- Preserve primary field maximum lengths using serialized string size, including
  Markdown delimiters. Initial/external content is never trimmed; over-limit
  imported content can be reduced. The generic character-count extension counts
  visible text, which is insufficient for these serialized provider constraints.
  Reference: [Tiptap CharacterCount](https://tiptap.dev/docs/editor/extensions/functionality/character-count).

## Evidence

The extended integration journey creates a draft with media, edits its common
source and article target independently, verifies backend values and media,
reloads, then reads the same values through the native editor. It also tests
Discord's 2,000-character boundary in visual mode, including formatting markers.
The first focused run failed because the test counted the target's Source button
as a source-body control and assumed customization always starts collapsed.
The fixture now scopes the assertion and respects validation-driven disclosure.
Changing the common source also correctly leaves the other destination draft on
its original revision; the test explicitly rebases Discord before editing it.
Five focused journeys passed, with responsive accessibility checks at 1280,
820 and 390 pixels. Visual review led to a compact editor height in the existing
publication host, without changing the new-composition workspace.

Full `bun run check` passed: 58 main browser journeys, two password-reset
journeys, all format/lint/type/unit checks and 17 successful build tasks. Logs: `/tmp/postbot-277-browser.log`,
`/tmp/postbot-277-check.log`.

## Remaining work

UX-277 remains in progress: additional contextual tools, selection-preserving
link entry, physical touch/IME checks, broader Markdown round trips and the
production rollout decision still precede generalizing the engine.
No AGENT.md update: implementation-specific synchronization and limits belong
in code and this worklog, not a new repository-wide operating rule.

## Further visual evidence

The existing publication screenshots still expose technical validation paths and
schema codes (for example `/title` and `schema.minLength`) rather than pointing
clearly to the field the operator needs to correct. This is an existing feedback
problem observed with an article missing its title, not an editor serialization
failure. Keep the detailed payload behind technical disclosure and consider
field-oriented feedback in a subsequent publication UX pass.
