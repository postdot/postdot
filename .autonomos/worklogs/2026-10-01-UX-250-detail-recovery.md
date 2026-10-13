# UX-250 — Preserve pending detail recovery

Status: Scoped pass complete; UX-250 remains in progress

The detail editor offered an older local copy while allowing edits. Its recovery effect wrote current edits into the same storage entry, so the offered copy could be overwritten before the operator chose what to keep. Apply the already accepted explicit recovery-decision pattern without introducing a second storage history or changing revision ownership.

When detail recovery is offered, a modal names the local copy, explains the restore/keep-saved choice, and shows a short excerpt. The underlying detail stays inert and the recovery-writing effect returns until the decision resolves. Restore/discard keep their existing generation guards and handlers; modal dismissal cannot bypass the choice. Any save error remains visible inside the modal. Copies eligible for the existing automatic same-revision recovery behavior keep that behavior; this pass protects copies currently offered for explicit review.

Removed the now-duplicated recovery banner from PublicationEditorStatus. Ordinary editor notices remain unchanged. No provider, API, publication lifecycle or recovery storage format changes.

Files: publication-editor.tsx, publication-editor-status.tsx, English/French catalogs and publication-detail-actions.spec.ts. The existing journey seeds an older local copy against a newer simulated server draft, verifies unchanged storage while the modal is pending, Escape blocking, mobile restoration, and a separate discard outcome preserving the saved source. Uses isolated fixtures only.

Full validation passed with exit zero using Node 24; evidence: /tmp/postbot-detail-recovery-final-check.log. Development services remain active; live-browser policy refusal was not bypassed. No AGENT.md update is needed: the accepted explicit decision and data-preservation rules cover this implementation.

Remaining: UX-250 still covers additional connected destination and lifecycle visual states. Keep any future multiple-copy/history design explicit rather than silently expanding this narrow recovery mechanism.

Final verification: the focused detail journey passed (18.9 seconds including startup), then all 44 primary browser journeys passed (7.6 minutes), 2 additional recovery checks passed (9.4 seconds), and production builds succeeded. Formatting, lint, spelling, types and unit tests passed. Repeated quick gates on final source after the final reload timing adjustment.

The initial discard fixture was injected while the restored copy was active and normal recovery writing could overwrite the test seed before reload. Injected the separate older-copy fixture at navigation initialization instead; both outcomes now pass without weakening assertions. Autosave also returns while a recovery decision is pending. Reload offers the recovery choice only after the server response arrives, so choosing the saved version cannot cancel a still-pending load and retain the wrong content. Inspected local-recovery-mobile.png: excerpt, two actions and modal focus are legible at 390 pixels. Development API/web remain running.
