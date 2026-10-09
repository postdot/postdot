# Publication workflows for scripts and agents

The Bun CLI uses the existing `@herald/client` Eden Treaty factory. Request types
come from the Elysia application; no separate REST schema or generated SDK is
maintained. Eden Fetch offers a different typed calling style, and OpenAPI remains
available to external consumers. Neither requires a second transport in this CLI.
See [Eden Treaty](https://elysiajs.com/eden/treaty/overview),
[Eden Fetch](https://elysiajs.com/eden/fetch), and
[OpenAPI](https://elysiajs.com/patterns/openapi).

Use `HERALD_URL` and `HERALD_API_KEY` for machine authentication. Connections and
provider credentials stay in Herald. Existing project roles and API-key action
ceilings apply; scheduling requires the corresponding dispatch permission.

## Create a source and its destinations

```json
{
    "title": "Release announcement",
    "sourceContent": {
        "body": { "text": "The release is ready.", "format": "plain_text" },
        "media": []
    },
    "publications": [
        {
            "channelId": "YOUR_CHANNEL_ID",
            "deliveryMode": "manual",
            "targetContent": { "body": "The release is ready.", "media": [] }
        }
    ]
}
```

```sh
bun run herald posts create --project "$PROJECT_ID" --input post.json --json
```

`--input -` reads stdin. Inputs are bounded to 1 MiB and must contain a JSON object.
Elysia performs authoritative schema and domain validation. Destination content
must match the channel profile, which can be inspected with `channels list` or the
existing API. The example is for a manual message channel, not a universal payload
for every platform. `scheduledAt`, when supplied per destination, is an epoch
millisecond timestamp; omission creates an unscheduled publication.

## Inspect and schedule

```sh
bun run herald publications list --project "$PROJECT_ID" --json
bun run herald publications show --project "$PROJECT_ID" --publication "$PUBLICATION_ID" --json
bun run herald publications promote --project "$PROJECT_ID" --publication "$PUBLICATION_ID" --expected-revision 1 --at "$EPOCH_MS" --json
bun run herald publications schedule --project "$PROJECT_ID" --publications "$PUBLICATION_ID" --at "$LATER_EPOCH_MS" --json
bun run herald publications cancel --project "$PROJECT_ID" --publications "$PUBLICATION_ID" --json
```

`list` returns one page of at most 100 publications plus `nextCursor`; pass
`--cursor` for another page. It never silently loops over the entire project.
`show` returns the editor state including source, draft, target, and lifecycle.
`promote` requires the inspected draft revision and creates the execution target.
`schedule` changes queued publications; it does not substitute for draft promotion.
`cancel` and `schedule` accept comma-separated publication IDs under the existing
server batch limit. `publications save --input draft.json` forwards the draft PATCH
contract, including `expectedRevision`, optional `sourceContent`, and optional
`targetContent`. A stale revision is refused rather than overwritten.

`publications retry --publication <id>` requests the existing retry of a failed
automatic publication. It cannot retry arbitrary states. The existing
`publications publish` command still marks a due **manual** publication as
published; it does not mean automatic dispatch. Existing reconciliation commands
remain available for ambiguous outcomes.

## Output and failures

With `--json`, success writes the API JSON to stdout. Failure writes one
`{"error":{"code":"...","message":"...","status":409}}` object to stderr;
`status` is present only when an HTTP response was received. Exit 0 is success,
1 is an API/transport/command failure, and 2 is invalid local input. Human mode
uses concise confirmations; inspection commands display formatted JSON.

Requests have a 30-second transport deadline. The CLI never automatically retries
writes. A transport failure has code `transport_error`; the write may already
have succeeded on the server. Inspect state before submitting it again. This
first tranche does not add idempotency keys or promise exactly-once submission.

This text-first workflow does not import new media. Existing media contracts and
attachments are not disabled; a subsequent CLI tranche will expose file and URL
import through the existing storage API.
