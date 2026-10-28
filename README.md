# Postdot

Self-hosted social publishing for people and their agents.

Write a post, adapt it for each destination, and schedule publication from one
workspace. Use Studio in your browser, or work through the CLI and HTTP API.

![Studio: writing a post with destination-specific previews](apps/docs/public/product/compose-light.webp)

## What you can do

- Prepare text, images and video, with separate content and schedules per channel.
- Publish through connected accounts, track manual destinations, or deliver to
  custom HTTP endpoints.
- Organize work across projects with roles, a media library, a calendar and a queue.
- Read collected performance metrics and export them as CSV. Provider coverage
  varies; see [provider capabilities](https://postdot.app/docs/providers/provider-capabilities/).

Postdot runs its API, dashboard, scheduler and publication worker in one service,
with SQLite and local media storage. S3-compatible media storage is optional.

**Alpha software, under active development.** The current container release, `0.1.0-alpha.4`, is available for Linux AMD64 and ARM64.
Upgrade from `0.1.0-alpha.3` and restoration of its pre-update backup are validated on both platforms. Releases up to `0.1.0-alpha.3` were called Postbot; see [moving from the Postbot names](https://postdot.app/docs/installation/#move-from-the-postbot-names).

## Run it yourself

Start with the [Docker Compose installation guide](https://postdot.app/docs/installation/).
It covers the versioned container image, optional source builds, generating secrets, creating the first account and
protecting your data. Check the [provider requirements](https://postdot.app/docs/provider-configuration/)
before connecting an account.

## Agent skills

Install the skills for your agent:

```sh
npx skills add postdot/postdot --skill postdot-self-host --skill postdot --skill postdot-troubleshoot
```

The [skills](skills/) cover self-hosting, API-backed publication workflows and
troubleshooting for `0.1.0-alpha.4`. Manual installation requires copying each
complete skill directory, including its references, assets and scripts.
The optional helpers use Python 3's standard library; no MCP server is required.

## Develop locally

Install [Bun](https://bun.sh) 1.4.4 or newer, then run:

```sh
bun install
cp apps/api/.env.example apps/api/.env
cp apps/web/.env.example apps/web/.env
openssl rand -hex 32
openssl rand -hex 32
openssl rand -hex 32
```

Paste those three independent values into `BETTER_AUTH_SECRET`,
`POSTDOT_MEDIA_PUBLIC_URL_SECRET` and `POSTDOT_PUBLISHER_ENCRYPTION_KEY`, respectively,
in `apps/api/.env`. Keep that file private. Then start the application:

```sh
bun run dev
```

Open Studio at <http://localhost:5173> and create the first account to claim the
instance. The API listens on port 3000 and exposes its interactive reference at
<http://localhost:3000/openapi>.

See the [development reference](https://postdot.app/docs/contributing/) for alternate ports, email,
CLI usage and validation commands.

## Documentation

- [Installation and operation](https://postdot.app/docs/installation/)
- [CLI publication workflows](https://postdot.app/docs/cli-reference/)
- [Security policy](SECURITY.md)
- [User API keys](https://postdot.app/docs/reference/authentication/)
- [Backup and restoration](https://postdot.app/docs/operations/)
- [Releases](https://postdot.app/docs/releases/)

## License

Copyright (c) 2026 Hakim Saoudi. Original code is licensed under
[AGPL-3.0-only](LICENSE). Third-party code and assets keep their own licenses;
see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
