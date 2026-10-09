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

Requests have a 30-second transport deadline by default; `--timeout-ms` sets a different positive per-request deadline (useful for larger uploads). The CLI never automatically retries
writes. A transport failure has code `transport_error`; the write may already
have succeeded on the server. Inspect state before submitting it again. This
first tranche does not add idempotency keys or promise exactly-once submission.

## Import and inspect media

```sh
bun run herald media policy --project "$PROJECT_ID" --json
bun run herald media upload --project "$PROJECT_ID" --file image.png --alt "Release dashboard" --json
bun run herald media import-url --project "$PROJECT_ID" --url "https://YOUR_HOST/image.png" --json
bun run herald media show --project "$PROJECT_ID" --asset "$ASSET_ID" --json
bun run herald media list --project "$PROJECT_ID" --json
bun run herald media finalize --project "$PROJECT_ID" --intent "$INTENT_ID" --json
```

File upload checks the current server policy, reserves an asset, streams the raw
file bytes, and asks the server to inspect/finalize them. `--content-type` overrides
the filename-derived hint when necessary; it never bypasses inspection or converts
the file. The upload size limit comes from Herald, not the 1 MiB JSON-input limit.
Use `--timeout-ms 120000` when a transfer needs a longer deadline.

URL import uses Herald's existing server importer: it downloads and stores a copy,
not a permanent external reference. URL/network restrictions, supported formats,
and image/video inspection remain server-owned. MP4 files must satisfy Herald's
existing ready-to-publish video policy; no conversion is added.

Exit 0 acknowledges a successful API operation, not necessarily a ready asset.
Check `status`: `ready` includes `media.asset.id` and representations; `pending`
includes the reservation and intent ID. `failed` exits 1 with
`media_inspection_failed`. To attach a ready asset, use its ID in source media and
the destination's declared media field, for example `[{"assetId":"..."}]` for a
manual message channel. Do not attach pending or failed assets.

The CLI does not poll. Inspect with `media show`, or explicitly finalize a known
intent again when appropriate. A transfer failure after reservation includes
`error.media.assetId` and `error.media.intentId` in JSON stderr. Use them to inspect
state before retrying; an unknown result is not proof that the bytes were lost.
No automatic repeat or deletion is performed. A URL request whose response was
lost may not expose an asset ID; inspect the library before importing it again.
`media list` exposes the server cursor rather than silently downloading all pages.

## Discover a destination contract

Before constructing a destination payload, inspect its channel profile:

```sh
bun scripts/herald.ts channels list --project <project-id> --json
bun scripts/herald.ts channels profile --project <project-id> --channel <channel-id> --json
```

The response is the existing API contract: `channel`, `active`, and nullable
`draft`. Read the definition under `active.profile` for schema, declared bindings,
text capabilities, and media requirements. The active version is distinct from an
profile draft awaiting activation. Keep the version reference when preparing a payload;
server validation and promotion remain authoritative if the channel changes.

Both output modes display the full profile response, rather than guessing field
names or flattening away constraints. This command neither activates a profile nor
connects a publisher. A valid content contract does not establish provider
connection readiness or guarantee publication success.
