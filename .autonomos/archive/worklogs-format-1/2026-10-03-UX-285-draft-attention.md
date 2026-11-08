# UX-285 — Visible draft attention and media limits

## Finding and changes

Live Queue review found a review-required draft in the Needs attention filter,
with only its ordinary Draft lifecycle label shown. Render the existing draft
review state alongside lifecycle status, using a quiet attention-colored label
without another dot, box or description. Compatible drafts gain no extra text.
Filtering, priority, permissions and destination navigation are unchanged.

Map authoritative schema min/max-items errors to exact localized item limits.
Use catalog plural forms for singular and plural values. Keep other issue codes
available in validation diagnostics. This does not change permitted media formats,
counts, server validation or incomplete-draft saving.

## Files

`dashboard-publication-parts.tsx`, `publication-target-editor.tsx`, English/French
catalogs and the populated Queue browser journey.

## Evidence

Focused Queue journey passed: review-required and compatible drafts remain
visually distinct at 1280 and 390 pixels; Needs attention still selects only the
same review-required draft. Inspected the 390-pixel capture. A missing JSX
conditional branch was corrected before the successful isolated browser run.
Full `bun run check` passed: 63 main browser journeys, two password-reset
journeys and all 17 build tasks. Full log: `/tmp/postbot-attention-check.log`.

## Continuation

External GIF catalog choices remain separate from these UI corrections under
UX-284. No provider integration or contact was made. Existing application design
and feedback rules suffice; AGENT.md remains unchanged.
