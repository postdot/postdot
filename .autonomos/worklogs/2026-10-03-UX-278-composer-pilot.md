# UX-278 — Configurable editor compose pilot

## Authorized scope

Continue the accepted Tiptap experiment in the real composition flow. Preserve
source text, per-channel adaptations, media references and existing recovery
contracts. Keep the default production editor until the migration is deliberately
completed; external GIF providers remain outside this work.

## Implementation

- Extract ConfiguredPublicationEditor so the lab and compose pilot exercise the
  same controlled component rather than diverging implementations.
- Enable the new composer through `?editor=tiptap` only in Vite development.
  The normal route and production build retain the native text editor.
- Use plain text for the common scope and unknown/custom destinations; enable
  the bounded Discord and DEV.to configurations only for those profiles.
- Lazily load the engine and mount destination sessions on first visit. Keep
  visited sessions mounted, keyed by project, scope and editor configuration,
  to preserve per-scope selection and undo while changing tabs.
- Bind updates to a fixed scope identifier. A background editor cannot write
  into whichever tab happens to be active later.
- Synchronize external restore/reset/shared-content changes without publishing
  them as edits. Acknowledged controlled echoes do not re-import the document,
  preserving the cursor and undo during typing and autosave.
- Preserve disabled and invalid states, weighted X feedback and description
  associations. Formatting buttons explicitly use button intent inside the form.
- Retain native source editing for unsupported imports, including emoji insertion
  and validation attributes. Bare Discord URLs no longer force source mode;
  masked-link syntax remains outside the bounded configuration.
- Keep attachments outside the engine. No engine JSON, new source format or
  database migration enters the authoring or publishing contracts.

## Evidence

Two real API/browser journeys cover typing without cursor reset, independent
source/target scopes, undo after tab changes, Discord formatting, media upload,
server composition autosave, modal recovery, reset to common content, DEV.to
headings, X weighted limits, emojis, and persistent publication draft creation.
The publication editor API confirms the saved article draft contains Markdown
and the same media references as the source. A legacy native-editor draft keeps
its spaces, Unicode, literal delimiters and trailing newlines when restored into
the pilot and returned to the native editor.

The three lab journeys still pass after extracting the shared component; source
mode emoji insertion also preserves unsupported Markdown/HTML exactly. Axe and
screenshots cover the compose pilot at 1280, 820 and 390 pixels, while the lab
covers both themes at those widths. Tests use isolated accounts, projects, API
and storage; no real provider delivery or real user publication is triggered.

Initial fixture failures came from ambiguous Import buttons in the empty media
library, distinct Add/select channel actions, and reading target content from the
publication summary rather than its editor API. The final tests use the real
API contract and retain the complete scenarios rather than weakening assertions.

## Validation

Five targeted browser journeys passed. Full `bun run check` passed: 58 main
browser journeys, two password-reset journeys, all checks and 17 build tasks.
Evidence log: `/tmp/herald-editor-pilot-check.log`. Focused log:
`/tmp/herald-editor-integrated-browser.log`.

## Remaining work

The bounded editor integration proof is complete; the repository gate passed.
UX-277 owns production tool coverage, source-mode ergonomics, and expanding the
migration to existing publication editing. Physical touch/IME testing and broader
Markdown fidelity remain explicit checks before generalizing the editor.
GIF selection/delivery assessment is tracked separately under UX-279; no provider,
license or external data-service choice is implied by this editor proof.

No AGENT.md rule is added: component-specific synchronization behavior is recorded
in implementation comments and this evidence, while the existing source/domain
contracts remain authoritative.

## Provisional visual findings for UX-277

The compose screenshots show a focus ring clipped at the host's horizontal edges;
evaluate an inset focus treatment when polishing the production editor. The plain
configuration's Source toggle also needs a necessity review because both modes
represent plain text. These are recorded findings, not new accepted design rules.
