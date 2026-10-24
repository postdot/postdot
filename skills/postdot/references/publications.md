# Draft, review, schedule and inspect

Inspect channels and the active profile first. The following JSON is only for a
manual message channel whose declared content matches these fields. It is not a
universal payload for LinkedIn, articles or every other destination.

Create a JSON file `draft.json` with the selected channel ID:

```json
{
  "title": "Release announcement",
  "sourceContent": {
    "body": { "text": "The release is ready.", "format": "plain_text" },
    "media": []
  },
  "publications": [{
    "channelId": "REPLACE_WITH_CHANNEL_ID",
    "deliveryMode": "manual",
    "targetContent": { "body": "The release is ready.", "media": [] }
  }]
}
```

```sh
python3 "$SKILL_DIR/scripts/request.py" POST "/api/projects/$PROJECT_ID/posts" --input draft.json
python3 "$SKILL_DIR/scripts/request.py" GET "/api/projects/$PROJECT_ID/publications?limit=100"
python3 "$SKILL_DIR/scripts/request.py" GET "/api/projects/$PROJECT_ID/publications/$PUBLICATION_ID/editor"
```

Omitting destination `scheduledAt` creates unscheduled drafts. Setting it creates
executable scheduling, not a harmless proposal. Preserve returned IDs and inspect
server state. Lists are paginated: follow `nextCursor` only as needed for the task,
not silently across all project history.

To save a draft, PATCH `/api/projects/{projectId}/publications/{publicationId}/draft`
with its inspected `expectedRevision` and intended `sourceContent`/`targetContent`.
Read the live schema before constructing less common fields. If a conflict occurs,
re-read and compare; do not substitute a newer revision to overwrite user edits.

## Request human review without dispatch

POST `/api/projects/{projectId}/publications/{publicationId}/approval-request`
with `expectedDraftRevision` and `proposedScheduledAt` (Unix milliseconds).
A `publication:manage` key can submit this request. It remains a draft with an
inert proposal: no worker job or executable schedule exists. Report "requested
review", not "scheduled". Human sessions approve/reject through Studio; machine
keys cannot approve. Editing the draft supersedes a pending request. An overdue
proposal does not automatically publish.

## Authorized direct scheduling

A `publication:dispatch` key can POST
`/api/projects/{projectId}/publications/{publicationId}/draft/promote`
with `expectedRevision` and the authorized `scheduledAt` in Unix milliseconds.
Read back the publication and report the server's actual state/time. Resolve the
user's timezone and daylight-saving ambiguity before converting a civil time.
A queued job is not a confirmed publication. Existing queued jobs use the
rescheduling contract, not draft promotion; inspect the live API schema or source
CLI help before using it.

## Unknown, failed or manual outcomes

The source CLI's `publications publish` records completion of a due manual item;
it does not send an automatic provider request. Do not use it as a generic
publish-now operation. `retry` applies only to eligible failed automatic work.
Ambiguous effects require inspection/reconciliation, not unconditional retry.
A lost response to post creation may have created drafts; inspect the list before
creating them again. Report unverified delivery honestly.
