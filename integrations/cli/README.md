# Postdot CLI

Operate a remote Postdot instance from your terminal using a scoped API key.
This is an alpha release for publication workflows.

## Install

The installed `postdot` command requires Node.js 24 or later:

```sh
npm install --global @postdot/cli
postdot --help
```

With Bun, run the same package explicitly through Bun:

```sh
bunx --bun --package @postdot/cli postdot --help
```

## Connect to an instance

Create an API key in your instance's Studio. Give it read access to the project
and permission to perform the operations you need. Add a server profile and an
optional default project:

```sh
postdot config add work --url https://postdot.example.com --project PROJECT_ID
postdot auth login
postdot auth status
postdot projects list
postdot media policy --json
postdot media upload --file image.png --content-type image/png
```

The first profile becomes active. `auth login` asks for the key without displaying
it, checks it against the server and saves it locally. It also accepts
`--token-stdin` for a key supplied by a secret manager. Keys are stored in a separate,
unencrypted file with user-only permissions. Persistent key storage is currently
implemented for POSIX systems; on Windows, use `POSTDOT_API_KEY` until credential
storage has been qualified there.

## Use multiple instances

```sh
postdot config add staging --url https://staging.example.com
postdot config use staging
postdot auth login
postdot config set-project PROJECT_ID
postdot config list
postdot --profile work projects list
```

`config set-project` without an identifier clears the selected profile's default
project. `config remove NAME` removes that profile and its locally saved key.
`auth logout` removes only the selected profile's local key; revoke the server key
in Studio if needed. An exported `POSTDOT_API_KEY` remains active after logout.

Command flags override environment variables, which override profile defaults.
For remote commands, `--base-url` and `POSTDOT_URL` select a server for one invocation. A different server
origin does not inherit the active profile's saved key or project. Use a separate
profile or supply explicit environment credentials for that server.

## Run in automation

Set `POSTDOT_URL`, `POSTDOT_API_KEY` and, optionally, `POSTDOT_PROJECT` in your job's
environment. Environment credentials need no login and are not written to disk.
Pass `--json` for a JSON result on stdout. Failed commands write a JSON error to
stderr and return a nonzero exit code.

Use `POSTDOT_PROFILE` or `--profile` to select a saved profile. Configuration lives
in the platform's user configuration directory. `POSTDOT_CONFIG_DIR` or
`--config-dir` selects an absolute configuration directory for an isolated job.

## Create a draft

Choose an existing manual channel in Studio, then inspect its content contract:

```sh
postdot channels list
postdot channels profile --channel CHANNEL_ID --json
```

Save this as `post.json`, replacing `CHANNEL_ID` with that manual channel's identifier:

```json
{
    "sourceContent": {
        "body": { "format": "plain_text", "text": "The release is ready." },
        "media": []
    },
    "publications": [{ "channelId": "CHANNEL_ID", "deliveryMode": "manual" }]
}
```

```sh
postdot posts create --input post.json --json
postdot publications list --json
postdot publications show --publication PUBLICATION_ID --json
```

Creation returns the post and its publication identifiers. It creates a draft when
no scheduled time is supplied. Use `--input -` to read the same JSON from stdin.
File and stdin input must contain one UTF-8 JSON object, at most 1 MiB.

For an automated destination, inspect its profile and connection readiness with
`channels profile` and `publishers list`; use the content fields and delivery mode
supported by that destination.

## Edit and schedule a publication

`publications show` returns the current `editor.draft.revision`. To edit that draft,
put its expected revision and new destination content in `draft.json`:

```json
{
    "expectedRevision": 1,
    "targetContent": { "body": "Updated release announcement.", "media": [] }
}
```

Replace `1` with the revision you inspected, then save:

```sh
postdot publications save --publication PUBLICATION_ID --input draft.json --json
```

Saving returns the new revision. Use that revision to promote and schedule the draft:

```sh
postdot publications promote --publication PUBLICATION_ID --expected-revision DRAFT_REVISION --at EPOCH_MS
postdot publications schedule --publications PUBLICATION_ID --at EPOCH_MS
postdot publications cancel --publications PUBLICATION_ID
```

`EPOCH_MS` is the scheduled Unix time in milliseconds. `schedule` and `cancel`
accept comma-separated publication identifiers. A stale draft is refused; inspect
it before choosing what to save. `move --input` requires the current source, draft,
destination and scheduling revisions from `show`.

For manual work, `publications due` lists publications awaiting completion.
`publications publish --publication ID` records that you published the content
manually; it does not send the content to a provider.

## Inspect failures and explicit exceptions

The CLI preserves the server's error code and message. JSON errors include HTTP
status under `error.details.status`, with structured server context under
`error.details.server`. A cadence conflict includes its warnings and confirmation
there. Review them before explicitly resubmitting: use `--cadence-confirmation` for
promote/schedule/retry, or `cadenceConfirmation` in the input for create/move.

`publications cadence` inspects dispatch timing and its interval confirmation.
`override-cadence --confirmation VALUE` requests one explicit interval exception;
provider limits still apply.

A transport failure can leave an accepted write without an acknowledgement. The CLI
does not replay it. Inspect the publication before deciding whether to retry.
`publications retry` requests a retry for an eligible failed automatic publication.
For uncertain delivery, verify the outcome before using `publications reconcile`
with `--resolution published --external-id ID` or
`--resolution failed --error-message TEXT`.

## Work with media

```sh
postdot media policy --json
postdot media upload --file image.png --content-type image/png --json
postdot media list --json
postdot media show --asset ASSET_ID --json
postdot media import-url --url https://images.example.com/image.png --json
```

Upload reserves an asset, transfers its bytes and asks the server to finalize it.
If a transfer fails, the error retains the asset and intent identifiers.
`media finalize --intent INTENT_ID` explicitly finalizes a known intent.
URL imports can remain pending; inspect the asset rather than assuming it is ready.
Publication and media lists return one page and a continuation cursor; pass that
cursor with `--cursor` for the next page.

## Permissions and command help

Use a key with `project:read` for discovery and inspection,
`publication:manage` to prepare drafts, `publication:dispatch` for scheduling and
completion, and `media:manage` for uploads/imports. Existing project roles and
server rules also apply.

Run `postdot --help` or `postdot publications promote --help` for command-specific
options. Project/channel setup, sharing configuration, account administration and
audit remain in Studio for this first CLI alpha.
