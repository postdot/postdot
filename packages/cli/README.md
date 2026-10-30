# Postdot CLI

Operate a remote Postdot instance from your terminal using a scoped API key.

The standalone executable includes Bun and does not require a separate JavaScript
runtime. The JavaScript package also runs with Bun or a compatible Node.js runtime.
This package is under development and has not yet been published to npm.

## Connect to an instance

Create an API key in your instance's Studio. Give it access to the project and
operations you need. Set `POSTDOT_URL` to your instance's origin and supply the key
through `POSTDOT_API_KEY` in your environment.

```sh
postdot projects list
postdot media policy --project PROJECT_ID --json
postdot media upload --project PROJECT_ID --file image.png --content-type image/png
```

Use `postdot --help` or `postdot media upload --help` for command options. A file
upload reserves an asset, transfers its bytes and asks the server to finalize it.
If the transfer fails, retain the asset and intent identifiers from the error and
inspect the server state before retrying.

The current command surface is limited to project discovery and media policy/upload.
Additional publication commands are being migrated before the first public release.
