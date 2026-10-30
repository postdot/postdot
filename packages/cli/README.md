# Postdot CLI

Operate a remote Postdot instance from your terminal using a scoped API key.
This package is under development and has not yet been published to npm.

The installed `postdot` command uses Node.js. Bun can run the same JavaScript;
select Bun explicitly with `bunx --bun` when the npm package becomes available.
Standalone executables that embed Bun remain an optional distribution path.

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

## Inspect commands and uploads

Use `postdot --help` or `postdot media upload --help` for command options. A file
upload reserves an asset, transfers its bytes and asks the server to finalize it.
If the transfer fails, retain the asset and intent identifiers from the error and
inspect the server state before retrying.

The current command surface covers profiles, API-key login/status/logout, project
discovery and media policy/upload. Publication commands are being migrated before
the first public release.
