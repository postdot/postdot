# Scheduled first comments

Implementation: ENGAGEMENT-543/544, 2026-10-21. Scope: native automatic Bluesky
and Mastodon publications. Other providers remain outside this slice.

## Prepare a comment in Studio

Open a draft or scheduled Bluesky or Mastodon publication and expand **First comment**.
Enter plain text, choose **Send after**, and select **Save and enable**.
Preparing the comment does not require a connected account; publishing and
sending it require a valid connection to its provider.

Bluesky comments accept up to 300 graphemes and 3000 UTF-16 code units. Mastodon
uses the existing conservative reply limit of 500 UTF-16 code units; an instance
can impose additional restrictions. Delay presets are immediately after
confirmation, 5 or 30 minutes, 1 hour, 1 day and 7 days.
The stored delay is an integer from 0 to 604800 seconds after Postdot confirms
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
| Ambiguous | The effect may have occurred; Postdot will not resend automatically |
| Cancelled | Unsent work was cancelled |

A failed or uncertain parent leaves the comment waiting. Manually recorded or
reconciled success cannot arm it. A cancelled parent cancels waiting or pending
work. Restarting Postdot preserves the original due time; overdue work is sent
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

Arming checks the Bluesky root record's account against the current project
connection. Mastodon binds the local status identifier and retained permalink
to the original instance, account and connection. Live account verification and
an anonymous read must confirm that account owns the Mastodon parent. Only
public and unlisted parents are supported; the comment retains their visibility.
A numeric account identifier from a different instance cannot authorize a send.
Execution revisions do not retain the original connection identifier, so a
connection recreated for the same account before arming cannot be distinguished
from the prior connection. Once armed, the connection, credential, account,
execution and parent identity are pinned and rechecked before sending. A changed
account or parent fails closed. Live Bluesky context validation supplies strong
references immediately before the send. Mastodon resolves the owned parent
directly, without requiring an incoming descendant or comment snapshot.

The dedicated first-comment routes preserve the eligibility rules of existing
conversation replies. GET requires project read access; save/enable and cancel
require editor access. API-key writes additionally require publication dispatch
capability because enabling authorizes an automatic external effect.

Acceptance includes injected provider responses and isolated Studio scenarios.
[ENGAGEMENT-545](../../.autonomos/worklogs/2026-10-21-ENGAGEMENT-545.md) also
verified a real native Mastodon parent and its first comment on an explicitly
authorized test account. The comment was attempted once, after the configured
30-second delay, and its remote parent/account identity was independently read.
That acceptance does not establish live delivery for other providers or formats.
