# UX-278 — Configurable editor proof

## Accepted scope

The owner approved the Tiptap evaluation recommendation: a bounded experiment
with plain-text, Discord and article configurations before a general migration.
Do not change the publishing payload contract or introduce a paid platform.
Animated media remains separate from this editor experiment.

## Implementation

- Add `/editor-lab`, available only in Vite development, with a lazy-loaded React
  component. Production redirects this route to the existing entry point.
- Pin MIT Tiptap 3.31.4 packages and Marked 17.0.6. Keep the existing production
  publication editor unchanged while this proof is evaluated.
- Use a restricted StarterKit schema for plain text, a Discord subset including
  custom underline/spoiler marks, and an article subset with headings, lists,
  quotations, links and code. No image nodes: media remain a separate concern.
- Serialize plain text or Markdown strings, never engine JSON into publication
  payloads. Preserve the original string until a real edit happens. Maintain
  independent mounted editor sessions and undo histories when changing tabs.
- Reuse the existing emoji picker and local data. Emoji insertion participates
  in the engine's undo history and returns focus to the editor.
- Provide source editing. Unsupported imported images, HTML, tables, rules and
  out-of-scope structures stay in source mode rather than being silently stripped.
- Save/restore explicit test snapshots under a dedicated browser-local key;
  the experiment never accesses real drafts, credentials or publications.

## Findings

The basic composition and serialization model is viable. Discord underline uses
`__`, while article Markdown treats `__` as bold; spoiler delimiters are also
Discord-specific. Use isolated Marked instances: registering custom tokenizers
on the global singleton would leak rules between configurations. The manager's
injection declaration expects the callable singleton, although its implementation
uses instance methods; a narrow documented type adaptation bridges that mismatch.

TanStack Router's lazyRouteComponent raised a React 19.3 conditional-use error
in the initial browser run. Use React.lazy for this experimental route instead;
retain lazy loading without changing global router behavior.

Replacing all text in an already formatted contenteditable retains the current
block/marks. Browser fixtures explicitly import plain source before checking a
new formatting action, rather than assuming native replacement clears formatting.

## Boundaries and next step

This is an engine proof, not a finished production editor or a provider capability
contract. Markdown support is beta; the tested subset does not establish arbitrary
Markdown fidelity. The unsupported-syntax guard is conservative, not a complete
Markdown validator. Real composition autosave/recovery, media attachments, provider
length feedback and asynchronous content resets require integration tests in the
next pass. Physical mobile keyboards and IME composition remain unverified.

Continue UX-277 with a development opt-in integration in the existing composer,
then cover recovery, source/target overrides, attachments and editor updates without
resetting focus or undo. Do not replace every editor on the strength of this lab.

## Development services

Verified no API/Vite process or database holder remained after the machine restart.
Removed the exact stale runtime marker and started the API without watch on 3002
and Vite on 5173. API readiness and web entry point return HTTP 200. No automatic
stale-lock reclamation was introduced; OPS-271 remains separate.

## Validation

Full `bun run check` passed: formatting, lint/spelling, types/localization,
unit/script tests, 56 browser journeys, two password-reset journeys and 17 build
tasks. Log: `/tmp/postbot-ux278-check.log`. Focused evidence: five codec tests and three
browser journeys passed, including independent sessions, unchanged-string snapshot
restore, constrained paste/keyboard behavior, protected source syntax, rich editing,
emoji undo and Axe at 1280, 820 and 390 pixels in both themes. Screenshots are in
the isolated browser test outputs. No real data was modified.

The experimental editor chunk is loaded separately (approximately 146 kB gzip);
the main entry remains approximately 112 kB gzip. Editor migration and GIF
assessment remain open, so UX-278 stays in progress. No new AGENT.md rule was
promoted from this bounded prototype.
