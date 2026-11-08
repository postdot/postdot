# UX-250 — Existing publication editor parity review

## Read-only review

Inspected a populated review-required draft through the shared browser. No text,
media, scheduling, preferences or publication data was changed. The temporary
review tab was closed. Existing lifecycle regression journeys also pass in the
OPS-271 full gate: scheduled actions, failed/ambiguous outcomes, notification
navigation and recovery remain covered.

## Finding

The existing-publication editor still places shared attachment insertion below
the source media block while the destination editor has its own contextual text
toolbar. This predates the accepted new-publication unified-action composition.
The distinction between shared media and destination text is meaningful, but the
controls appear fragmented and require scanning separate blocks. A media-only
source exposes an Add text action; do not remove that useful distinction merely
to force an always-visible empty text editor.

## Follow-up acceptance

UX-288 continues UX-250: align shared content/media authoring controls with the
validated composer toolbar and preserve compact media-only content. Clearly
retain source versus destination ownership without redundant explanation.
Keep media order/description, independent adaptations, autosave, local recovery,
server revisions and apply-to-target validation unchanged. Review populated
media-only and text-plus-media drafts at desktop/mobile widths, both themes,
keyboard and emulated touch before integration. Do not silently copy destination
text into shared source or merge their editor histories.

This finding is an implementation follow-up, not a request for another owner
visual approval. It does not close the wider UX-250 lifecycle review. No AGENT.md
change: accepted composition principles already cover this surface.
