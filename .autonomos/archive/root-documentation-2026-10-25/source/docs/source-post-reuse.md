# Add destinations to an existing post

In a publication detail page, editors can use **Add destination** to create a new
destination draft for the same source post. The dialogue identifies the current
saved source revision. Choose a channel and delivery mode; the action never
schedules or sends the new draft. Manual-only channels do not offer automatic
execution. If the channel is already used by the post, confirm the additional
draft explicitly.

The new draft opens for adaptation, review and scheduling through the normal
editor. Missing destination requirements remain visible as review-required;
source reuse does not imply that the destination content is valid for dispatch.
Existing publications, their adaptations and execution snapshots stay unchanged.
Unsaved local edits are not the source of this action: it uses the saved post.

## API contract

- `GET /api/projects/:projectId/posts/:postId` returns `{ post }` with the current
  source and `sourceRevision`.
- `POST /api/projects/:projectId/posts/:postId/destinations` accepts:

```json
{
  "expectedSourceRevision": 1,
  "confirmExistingChannels": false,
  "publications": [{ "channelId": "channel-id", "deliveryMode": "manual" }]
}
```

The 201 response contains the existing post and newly created publications only.
Up to 100 destinations can be added atomically. Scheduling and target content are
not accepted as part of this operation. Each draft adapts the saved source using
its channel's active profile.

A changed source revision is a write conflict. A repeated channel requires
`confirmExistingChannels: true`, including repetitions within the same request.
This confirmation is enforced against the current database state, not just an
older browser list. Invalid channels or rejected requests leave no partial additions.

Reads require `project:read`; additions require `publication:manage` for limited
API keys, plus current project edit access. No dispatch permission is needed to
create these unscheduled drafts. Provider credentials are not inputs.

Historical source selection and automatic propagation to existing destinations
are outside this operation. Source updates and explicit rebase retain their
existing semantics.
