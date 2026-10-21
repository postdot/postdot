# Scheduled first comments

Implementation: ENGAGEMENT-543, 2026-10-21. Scope: native automatic Bluesky
publications. Mastodon and other providers remain outside this first slice.

## Prepare a comment in Studio

Open a draft or scheduled Bluesky publication and expand **First comment**.
Enter plain text, choose **Send after**, and select **Save and enable**.
Preparing the comment does not require a connected account; publishing and
sending it require a valid Bluesky connection.

The comment accepts up to 300 graphemes and 3000 UTF-16 code units. Delay presets
are immediately after confirmation, 5 or 30 minutes, 1 hour, 1 day and 7 days.
The stored delay is an integer from 0 to 604800 seconds after Postbot confirms
native publication success. Zero means eligible after confirmation, without a
guarantee of immediate delivery.

Editors can change or cancel a waiting, pending or suspended comment before the
worker claims it. A concurrent change produces a conflict that preserves local
text and delay. Review the current saved version before loading it or explicitly
saving your edits against that version. Project members can read the saved
configuration and independent outcome.

## Timing and outcomes

| State | Meaning |
| --- | --- |
| Waiting | Prepared, but the parent has no confirmed native success |
| Pending | Bound to a confirmed parent receipt and account; waiting for its due time |
| Running | Claimed for delivery; editing and cancellation are unavailable |
| Suspended | The enabling editor lost editor access; another editor must review and explicitly enable it |
| Sent | The comment received a confirmed result and its own remote identity |
| Failed | Preparation or delivery failed independently of the parent |
| Ambiguous | The effect may have occurred; Postbot will not resend automatically |
| Cancelled | Unsent work was cancelled |

A failed or uncertain parent leaves the comment waiting. Manually recorded or
reconciled success cannot arm it. A cancelled parent cancels waiting or pending
work. Restarting Postbot preserves the original due time; overdue work is sent
after the parent, account and current editor authorization are revalidated.
Restoring a suspended editor's access alone does not resume the comment.

A prepared comment belongs to one Publication. It creates no Post or calendar
Publication and does not require an incoming-comment snapshot. Its failure
never changes parent success. Terminal outcomes have no retry or resend action.
New configuration after parent publication, media, quizzes, comment chains and
recurring comments are outside this slice.

## Delivery boundaries

The [preparation store](../../packages/db/src/publication-first-comment-store.ts)
retains one configuration per publication, its revision, relative delay, native
execution receipt and stable send identity. The existing
[singleton worker](../../apps/api/src/modules/workflow/worker.ts) schedules it
through the [durable effect fence](../../.autonomos/decisions/ADR-009-fence-external-effects-with-durable-claims.md).
Interrupted work before the effect boundary can recover; uncertainty after that
boundary remains ambiguous.

Arming checks the root record's account against the current project connection.
Execution revisions do not retain the original connection identifier, so a
connection recreated for the same account before arming cannot be distinguished
from the prior connection. Once armed, the connection, credential, account,
execution and parent identity are pinned and rechecked before sending. A changed
account or parent fails closed. Live Bluesky context validation supplies strong
references immediately before the send.

The dedicated first-comment routes preserve the eligibility rules of existing
conversation replies. GET requires project read access; save/enable and cancel
require editor access. API-key writes additionally require publication dispatch
capability because enabling authorizes an automatic external effect.

Acceptance uses injected provider responses and isolated Studio scenarios.
No real-provider delivery is claimed for this feature.
