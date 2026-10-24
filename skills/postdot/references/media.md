# Media and destination contracts

The server owns media limits, inspection and readiness. Query its policy at
GET `/api/projects/{projectId}/media/upload-policy` and inspect assets at
GET `/api/projects/{projectId}/media/{assetId}`. Confirm the exact contract in the
running `/openapi/json` before reserving or streaming bytes; the bundled JSON
helper does not implement a binary upload client.

For the first alpha, use Studio's upload workflow when no matching source CLI is
available. If the source CLI is already set up, these supported commands cover
the complete transfer flow:

```sh
bun run postdot media policy --project "$PROJECT_ID" --json
bun run postdot media upload --project "$PROJECT_ID" --file image.png --alt "Release dashboard" --json
bun run postdot media show --project "$PROJECT_ID" --asset "$ASSET_ID" --json
```

`media upload` checks policy, reserves an asset, streams bytes and finalizes it.
Successful HTTP/CLI completion can still return a pending asset. Attach only a
`ready` asset using its returned `assetId` and the profile's declared media field,
for example `[{"assetId":"..."}]` on a compatible manual message channel.
Pending/failed assets, local paths and raw URLs are not substitutes.

URL import stores a copy subject to server network restrictions; it does not
create a permanent external reference. MP4 inspection does not transcode video.
After a lost response, inspect the library/known asset and intent IDs rather than
uploading again or deleting the reservation. Use a bounded larger transfer timeout
when warranted; do not bypass inspection or raise server limits as a workaround.
