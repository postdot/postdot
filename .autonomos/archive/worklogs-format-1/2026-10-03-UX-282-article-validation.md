# UX-282 — Article recovery and field validation

## Changes

Article title already belonged to the composer and source/destination contracts.
Reuse it rather than creating a second editor model. Replace its misleading
optional hint when DEV.to is selected. A title-only composition now qualifies for
local recovery, server autosave and persisted recovery reads. Whitespace-only
empty drafts remain rejected.

Destination server issues are associated with the most specific field pointer,
including array descendants without confusing neighboring field names. Known
required/minimum/maximum text errors give localized correction instructions.
Text inputs and configured/native body editors expose invalid/described-by
relationships. Other field kinds retain nearby error text. Technical issue paths
and codes remain under a closed Validation details disclosure. Unmapped issues
retain a visible summary; no validation issue is dropped.

Incomplete publication drafts remain permitted; authoritative server validation
and publication apply/schedule guards are unchanged. No schema, migration or
public content representation was introduced.

## Files

Composer/recovery helpers and DB composer store; destination editor, field
controls and customization section; English/French messages; pointer and recovery
unit tests; composer browser integration tests.

## Evidence

The title-only browser test initially exposed the server-side rejection as well
as the local omission. Both were fixed. Focused journeys then passed, including
correcting an invalid DEV.to title and removing the field error after save.

Full `bun run check` exited 0: formatting, spelling/lint, types, all unit tests,
62 main browser scenarios, two password-reset scenarios and 17 build tasks.
Log: `/tmp/postbot-article-validation-check.log`. Inspected 1280-wide validation
capture and 390-wide existing-editor capture; Axe checks included both widths.

Shared API/web services were found stopped during the review and restarted in
managed sessions without watch. Both returned HTTP 200. No runtime lock removal
was needed. Development watch restart remains a separate OPS-271 concern.

## Continuation

Live review found media max-items errors still need precise correction copy, and
review-required drafts need a visible cue in Queue. Continue under UX-285. Catalog
research is separate under UX-279/UX-284. No new AGENT.md or design rule: this pass
applies existing recovery and operational feedback boundaries.
