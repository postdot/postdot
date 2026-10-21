# Scheduled first comments

Status: proposal, 2026-10-21. Task: ENGAGEMENT-542; issue: ISSUE-171.
This page proposes a first delivery slice. It does not describe a shipped
feature or approve changes to publication or reply lifecycles.

## Operator outcome

Prepare one text comment for a destination publication, choose a delay after
Postbot confirms that publication, and explicitly enable the comment. Postbot
sends it as a direct reply beneath the owned item. The operator can read its
independent outcome and remote link beside the publication.

The first slice should prove one useful sequence: the parent succeeds, the
delay becomes due, and one comment receives a confirmed or explicit uncertain
outcome. A failed or uncertain parent must never trigger a comment.

Proposed delay controls: immediately after confirmation, 5 or 30 minutes,
1 hour, 1 day or 7 days. Store a nonnegative relative duration, bounded to
7 days; a restart must not reset the chosen delay. These are proposed product
bounds, not upstream API limits.

## Recommended boundary

Start with native Bluesky publications delivered by Postbot. Keep the existing
conversation replies unchanged. Add Mastodon after the same dependent-delivery
contract works; Mastodon's current context resolver intentionally requires an
incoming descendant, so a direct reply to the owned root needs a distinct
validated preparation path.

One comment belongs to one publication, not its shared source post. Sending to
two destinations requires two explicit configurations. The first slice covers
plain text only, with no images, chains of follow-up comments, recurring work,
external-post discovery or automatically generated content. It creates no
additional Post or calendar Publication. A generic incoming-comment snapshot is
not a prerequisite for replying directly to the owned parent.

An editor explicitly enables the prepared comment; project members can read its
configuration and outcome. Parent approval rules remain in force. Enabling the
comment is separate consent for its automatic send, with actor attribution and
a visible immutable record of the content actually sent. This proposal does not
silently expand parent approval to cover comment text.

## Proposed timing and lifecycle

| Situation | Proposed behavior |
| --- | --- |
| Parent is still a draft or scheduled | Keep a prepared comment attached to the publication; no provider call and no runnable comment job |
| Parent fails or has an uncertain result | Continue waiting; never infer a remote parent from a scheduled time or an attempted request |
| Native parent success is durably recorded | Bind the comment to that exact receipt, execution and account, and compute its due time from local confirmation plus the configured delay |
| An operator manually records or reconciles parent success | Do not automatically arm this first slice; require a confirmed native execution receipt |
| Parent is retried before succeeding | Start the delay only from the eventual confirmed success, not the original schedule |
| Comment waits for its parent or due time | Allow an editor to revise or cancel it; serialize changes against worker claims so an edit cannot race into a different send |
| Worker claims the due comment | Freeze its text, receipt, account and send identity; controls show that editing/cancellation is no longer available |
| Process dies before the effect boundary | Recover the same request safely, preserving its send identity |
| Provider result is confirmed | Record comment success and its own remote identity without changing parent success |
| Result is uncertain after the effect boundary | Retain an explicit ambiguous outcome; never resend automatically |
| Provider or local validation proves no effect | Show an independent failure; defer a general retry interface from this first slice |
| Service resumes with an overdue comment | Proposed default: send the due comment after revalidation; confirm this catch-up policy with the owner |

The stored parent `publishedAt` is Postbot's completion timestamp, not proof of
the provider's original creation time. Say “after confirmed publication” in
controls. A zero delay means eligible after confirmation, not simultaneous or
guaranteed instant delivery. Reuse the existing next-event scheduler; do not
delegate scheduling to an upstream API or add a permanent polling service.

Before sending, verify current project authorization, the exact retained parent,
the original connected account, and the current provider context. A deleted
remote parent or replaced connection must fail closed; do not silently attach
the comment to another account or receipt. The project's connection remains
project-owned. Whether author departure disables this prepared automation must
be chosen explicitly rather than inherited accidentally from immediate replies.
The recommended first policy suspends unsent work when the enabling actor loses
editor access; another current editor can review and enable it again. Continuing
it as project-owned automation is a credible alternative, but changes the
authorization contract and needs explicit acceptance.

This first slice excludes manual outcomes, custom HTTP channels, retrospectively
adding a comment to an already published item, and replay after a confirmed or
ambiguous comment. These are proposed boundaries, not provider limitations.

## Existing mechanisms and required changes

- [Workflow completion](../../packages/db/src/workflow-store.ts) durably records
  the parent receipt and local completion time. Arming dependent work must survive
  a crash between parent success and comment preparation, using a transaction or
  recoverable scan of persisted eligible records.
- The [reply store](../../packages/db/src/publication-reply-store.ts) and
  [external-effect fence](../../.autonomos/decisions/ADR-009-fence-external-effects-with-durable-claims.md)
  already provide claims and explicit uncertain outcomes. The current reply store
  has immediate work, not an independently editable due-time dependency.
- The [reply service](../../apps/api/src/modules/projects/publication-replies-service.ts)
  requires an already published source and a retrieved incoming comment. Preserve
  that public endpoint's checks. A first-comment intent needs its own validated
  preparation rather than a bypass flag on arbitrary replies.
- The [Bluesky reply resolver](../../packages/bluesky/src/reply.ts) can resolve a
  direct reply with equal root and parent references; retain live strong-reference
  validation and the persisted record key. The
  [Mastodon resolver](../../packages/mastodon/src/reply.ts) rejects that case today.
- The [singleton worker](../../apps/api/src/modules/workflow/worker.ts) already
  considers publication and reply events. Extend its existing durable scheduling
  boundary; avoid a second worker or an in-memory timer as the source of truth.

These reusable pieces do not yet choose whether prepared first-comment
configuration extends reply storage or uses a dedicated publication-owned
record. Decide that from the dependency and cancellation semantics, not from
the amount of existing reply code.

The recommended shape is a separate publication-owned preparation record,
executed through the existing claim/fence machinery. It represents a comment
before a remote parent exists without changing the eligibility of immediate
conversation replies. Reusing the reply table is the alternative, but requires
distinct intent, nullable pre-delivery identity, a due-time query and equivalent
edit/cancel fences. A shared table would not remove those requirements.

## Evidence and decisions before implementation

Mastodon documents direct replies through
[`in_reply_to_id`](https://docs.joinmastodon.org/methods/statuses/#create).
The official [Bluesky post lexicon](https://github.com/bluesky-social/atproto/blob/main/lexicons/app/bsky/feed/post.json)
defines replies through root and parent strong references. These contracts
establish protocol feasibility, not current account access or live acceptance.
No provider account or external effect was used for this proposal.

Confirm the first provider, overdue catch-up policy and automation authorization
when the editor who enabled it leaves the project. Then settle bounded delay
controls and the storage ownership before implementation. Verify the accepted
sequence with synthetic parent failure/ambiguity, restart and edit/cancel races,
identity changes, lost acknowledgement and one focused Studio journey. No broad
provider expansion or unrelated test hardening belongs to this first slice.
