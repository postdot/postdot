# Select a diagnostic path

## Startup or readiness

Use the deployment's actual Compose project/directory and service `postdot`:

```sh
docker compose ps
docker compose logs --since 10m --tail 100 postdot
curl --fail --silent --show-error http://127.0.0.1:3000/health
curl --fail --silent --show-error http://127.0.0.1:3000/ready
```

Adapt origin/port. Logs can contain private data; inspect privately and redact
before showing excerpts. Readiness can succeed while `checks.recovery: held`;
that means inspection is available but delivery/mutations remain suspended.
A healthy process does not prove that HTTPS, email, OAuth or a provider works.

Check the exact image, storage permissions, free space, origin configuration and
bounded startup errors. Do not print `docker inspect` environment sections or
`docker compose config` without `--quiet`. Preserve SQLite WAL/SHM/runtime markers
after a crash. Never delete volumes, sidecars or locks to bypass a startup error.

## Refused access

401 can mean missing/expired authentication. 403 can mean owner role, key action
ceiling or project scope excludes the operation. Confirm instance/project/key
selection without displaying secrets. Administration, built-in publisher OAuth
and human approval require a session; an API key is not a session substitute.
A 404 can also hide an inaccessible resource; do not infer it was deleted.
A 409 draft conflict requires rereading revisions, not overwriting the new version.
503 `recovery_hold` needs human administrator review/resume, not an automatic retry.

## Media

Inspect asset ID/status and the selected channel's active profile. Pending is not
ready; a filename is not an asset ID. Capture error codes and formats/sizes without
copying private media. Confirm server policy before hypothesizing a provider bug.
Do not bypass content inspection, disable URL restrictions or silently transcode
an upload. A missing transfer response does not prove bytes were lost.

## Publication

Inspect the existing destination's editor/lifecycle and available delivery
history in Studio. Distinguish unscheduled draft, inert review proposal, queued
work, manual completion, failure and uncertain remote effect. Check requested
instant/timezone, destination contract and publisher readiness separately.
An active connection or a 2xx scheduling response does not prove delivery.

If a provider may already have accepted the post, preserve IDs/timestamps and
inspect available remote evidence with authorized access. Do not blindly retry.
A later empty/failed read is not proof no remote effect occurred. Separate a
cached analytics read from an active provider refresh, which makes a real call.

## Restored installation

A restored database may predate remote effects. Recovery hold deliberately pauses
work. Only an authorized human instance administrator can acknowledge/resume it.
Do not remove its marker, restore over current traffic or mark ambiguous items
published just to clear the queue. Preserve evidence and ask for the actual
recovery decision when it is outside the user's authorized task.
