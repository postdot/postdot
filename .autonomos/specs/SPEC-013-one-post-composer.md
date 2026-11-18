# SPEC-013 One composer to create and edit a post

Status: accepted (owner direction, 2026-11-16). Owner: Studio. Tasks: UX-680 (inventory),
UX-681 (composition API), UX-682 (shared composer), UX-683 (edit mode and route unification).

## Problem

A post is written in one place and edited in three. `/publications/new` has a composer with an
"All channels" tab, one tab per channel, one editor, a live preview and per-channel schedule
chips. Editing goes through `/publications/$publicationId`, which is bound to one channel: the
post text sits in a separate card, the channel's own text hides in an "Adapt for" disclosure,
and changing the post can leave other channels behind. `/posts/$postId` is a third surface
(post text editor, destination list, stale-version review). The owner called the editing
experience miserable; the structure, not the copy, is at fault.

## Decision

Creating and editing a post use the same composer. Editing is the composer opened on an
existing post.

### Routes

- `/publications/new` creates a post (unchanged URL).
- `/posts/$postId` is the post editor. It opens on the "All channels" tab.
- `/publications/$publicationId` keeps working for every existing link (queue, calendar,
  notifications, search, emails): it renders the post editor with that channel's tab active.
  `?channel=` style deep links are not needed; the publication id selects the tab.
- The old post page and the publication page's own layout are retired once the editor covers
  everything they did (see the UX-680 inventory).

### Composer anatomy (both modes)

- Channel row: "All channels", then one chip per channel with its mark, name and state. A chip
  opens the channel's delivery settings (manual or automatic, date and time), as today on the
  new post page. Adding a channel works as today. Removing one: in create mode it drops the
  target; in edit mode it deletes a draft publication or, for a scheduled one, goes through the
  existing cancel confirmation.
- A title field when a selected channel uses one, then one editor with the media toolbar, then
  the live preview of the active channel.
- "All channels" edits the post text. A channel tab shows that channel's text. While a channel
  follows the post, its tab shows the post text with a quiet "Same as all channels" line; typing
  in it gives the channel its own text, marked on its chip, with the existing reset action
  ("Use the text for all channels").
- Channel-only fields (language, thread, poll, provider options, alternative text) live in a
  "Content options" disclosure under the editor on that channel's tab. There is no separate
  "Adapt for" card.
- On a channel tab in edit mode, that publication's lifecycle stays visible under the composer:
  state and actions (mark published, cancel, move, retry), cadence status, outcome, comments,
  first comment and activity. They move; none of them is dropped.
- A locked channel (publishing, published, cancelled, thread started) shows its tab read-only,
  with the content as the channel showed it. Post text edits never touch it.

### Following the post

A channel follows the post when its version equals the post projected onto it
(`channelVersionFollowsSource`, `applySourceContentToTarget`). Editing on "All channels" updates
every editable channel that follows the post, in the same save. A channel with its own text is
left alone. The stale-version notice and review dialog (UX-675, UX-678) remain only for changes
made elsewhere (another tab, the API, MCP, the CLI).

### Saving in edit mode

- Changes autosave as pending, as today ("Changes pending"); what will be published does not
  change until the person saves.
- One primary action, "Save", applies the post text and every changed channel version, so what
  will be published equals what is shown. "Discard changes" restores the applied versions with
  an undo toast. Per-channel failures are reported on the channel's chip and tab, never as one
  opaque error.
- Create mode keeps its actions ("Save as draft", "Schedule"/"Publish").

### Composition API (UX-681)

`PUT /api/projects/:projectId/posts/:postId/composition` saves the post text and several
channel versions in one transaction:

- Body: `expectedSourceRevision`, optional `sourceContent`, and `publications[]` of
  `{ publicationId, expectedRevision, targetContent?, deliveryMode?, scheduledAt? }`.
- Every listed draft is written against the new source revision. Unlisted sibling drafts keep
  today's behavior (current when unaffected, behind otherwise).
- Any revision mismatch rejects the whole request with `write_conflict` and the list of
  conflicting publication ids. Nothing is partially written.
- Applying (promotion) stays the existing per-publication operation, called after a successful
  composition save, with per-channel results. Atomic promotion is out of scope.
- Same access rules as the existing draft and post routes; generated API reference, client
  types and MCP parity follow the repository's conventions for new routes.

## Non-goals

No new content model, no change to delivery, cadence, approval or provider contracts. No
change to how a post is created on the server.

## Acceptance

- Opening a post from the queue, calendar or a notification lands in the composer with the
  right tab, and the page reads like the new post page.
- Typing on "All channels" updates the preview of every following channel; a channel with its
  own text says so on its chip and tab.
- Every capability listed in the UX-680 inventory is reachable in the editor or explicitly
  retired with the owner's agreement.
- Existing browser journeys are migrated, not weakened.
