# Herald

Herald is a lightweight, self-hosted orchestrator for multichannel publications.
It is intended to keep automated and manual destinations in one source of truth.

Current target-state specifications live in [`.autonomos/specs/`](.autonomos/specs/),
with technical rationale in
[`.autonomos/decisions/`](.autonomos/decisions/).

## Development

Requirements: Bun 1.4 or newer.

```sh
bun install
cp apps/api/.env.example apps/api/.env
cp apps/web/.env.example apps/web/.env
# Replace BETTER_AUTH_SECRET, HERALD_MEDIA_PUBLIC_URL_SECRET, and
# HERALD_PUBLISHER_ENCRYPTION_KEY with random values.
bun run dev
```

The API publishes interactive documentation at <http://localhost:3000/openapi>
and its machine-readable specification at <http://localhost:3000/openapi/json>.
The API validates its required runtime configuration at startup.

`GET /health` is the public liveness check: a successful response means that the
HTTP process can answer requests. `GET /ready` is the public readiness check: it
probes SQLite and reports the publication scheduler and media-maintenance
runtime states. It returns `503` while any required runtime is not configured,
stopped, recovering, or failed. The container healthcheck uses `/health`;
deployment routing and monitoring can use `/ready` when durable-work readiness
is required.

`BETTER_AUTH_URL` is the canonical origin of the API and `HERALD_WEB_ORIGIN` is
the origin of the browser application. During development they use different
ports because the API listens on `3000` and the Vite development server listens
on `5173`. A production deployment that serves both from one origin can use the
same origin for both values.

For local Bluesky loopback OAuth, use the same `127.0.0.1` literal in both
origins and open the dashboard at `http://127.0.0.1:5173`; the default
`localhost` values remain suitable for development when Bluesky is not being
connected. See the provider deployment guide below for the reason and the
public HTTPS alternative.

The Vite development proxy targets `http://localhost:3000` by default. If that
port is already used by another local application, set the same alternate API
origin in both ignored local files before starting the two processes:

```dotenv
# apps/api/.env
PORT=3001
BETTER_AUTH_URL=http://localhost:3001

# apps/web/.env
HERALD_API_ORIGIN=http://localhost:3001
```

Provider-specific deployment requirements, including the no-tunnel Bluesky
loopback OAuth mode and the public HTTPS mode, are documented in
[`docs/deployment/provider-requirements.md`](docs/deployment/provider-requirements.md).

Request logging is readable by default in development. Set `LOG_LEVEL=silent` to
disable it, or set `NODE_ENV=production` to make the default log level silent.

Email delivery is optional. Leave the SMTP variables unset for local/manual-link
operation. To deliver project invitations, signup verification, and password-reset
messages through a relay, add the following to the ignored `apps/api/.env` file and
restart the API:

```dotenv
HERALD_EMAIL_SMTP_HOST=smtp.example.com
HERALD_EMAIL_SMTP_PORT=587
HERALD_EMAIL_SMTP_SECURE=false
HERALD_EMAIL_SMTP_USERNAME=your-smtp-user
HERALD_EMAIL_SMTP_PASSWORD=your-smtp-password
HERALD_EMAIL_FROM=Herald <no-reply@example.com>
```

The username and password must be supplied together; an unauthenticated local
relay may omit both. Set
`HERALD_REQUIRE_EMAIL_VERIFICATION_ON_INVITATION=true` only when the configured
relay is reachable and verified-account delivery is part of the deployment policy.
Mail submission is best-effort, so operators should monitor the API’s
`[herald-email]` errors and should not treat a successful invitation request as
proof of inbox delivery. See
[`ADR-066`](.autonomos/decisions/ADR-066-smtp-auth-email-delivery.md) for the
transport and reliability boundary.

For local email development, the repository includes a disposable Mailpit relay.
Start it from the repository root, then point the API at its host SMTP port:

```sh
docker compose -f docker-compose.dev.yml up -d mailpit
```

The defaults are the conventional Mailpit ports (`1025` for SMTP and `8025` for
the inbox). If another local service already uses one of them, override the host
ports without changing the container ports:

```sh
HERALD_MAILPIT_SMTP_PORT=11025 HERALD_MAILPIT_UI_PORT=18025 \
  docker compose -f docker-compose.dev.yml up -d mailpit
```

```dotenv
HERALD_EMAIL_SMTP_HOST=127.0.0.1
HERALD_EMAIL_SMTP_PORT=1025
HERALD_EMAIL_SMTP_SECURE=false
HERALD_EMAIL_FROM=Herald <no-reply@herald.local>
```

Inspect captured messages at <http://127.0.0.1:8025> (or the overridden UI port).
Stop the relay when it is no longer needed with
`docker compose -f docker-compose.dev.yml down`. The email templates live in
[`packages/email`](packages/email) and can be previewed with:

```sh
bun run --cwd packages/email dev
```

The preview server uses port `3001`; it is independent from the API and Vite
development servers.

The API applies the committed Drizzle migrations at startup. For a local,
unreleased database whose migration history no longer matches the repository,
stop the API and move that ignored database file aside before restarting. Herald
will create a fresh database; do not use this procedure for a database containing
data that must be preserved.

Run the complete local merge gate before opening a pull request:

```sh
bun run check
```

The merge gate includes the browser integration suite. Install the Playwright
Chromium binary once on a development machine before running it:

```sh
npx --no-install playwright install chromium
```

`bun run test:e2e` starts isolated Bun API and Vite processes with a temporary
SQLite database and local media directory. The suite creates only disposable
local data, never calls a real publisher, and removes its application data when
it finishes. The Playwright runner requires Node.js 20 or newer; Herald's
application processes continue to run on Bun.

The HTTP CLI uses the same API as the dashboard. Sign in once, then export the
session cookie printed by the command:

```sh
bun run herald auth login --email operator@example.com --password 'your-password' --json
export HERALD_SESSION_COOKIE='...'
bun run herald projects list --json
bun run herald publications due --project <project-id> --json
```

Use `bun run herald --help` for the available project, channel, publication, and
audit commands. Set `HERALD_URL` or pass `--base-url` when the API is not local.

Project access keys are created and revoked through a project owner's human session.
New projects use Better Auth's organization-owned API Key plugin: keys expire after
180 days by default, and the full secret is printed only by the create command. Copy
it into a secret manager before leaving the command output:

```sh
bun run herald access-tokens create --project <project-id> --name release-agent
bun run herald access-tokens list --project <project-id> --json
bun run herald access-tokens revoke --project <project-id> --token-id <token-id>
```

Use a project key for ordinary machine operations through `HERALD_PROJECT_TOKEN` or
`--token`. Project keys cannot create projects, manage keys, or start interactive
publisher OAuth flows. The key lifecycle is provided by Better Auth and Herald keeps
only the project binding and actor attribution needed by its domain routes.

```sh
export HERALD_PROJECT_TOKEN='paste-the-token-once'
bun run herald projects list --json
bun run herald publications due --project <project-id> --json
```

### Opt-in LinkedIn smoke test

The LinkedIn publisher smoke test creates a real public member post. It is never
part of `bun run check` and must only be run with an operator-owned test account.

1. Create or configure a LinkedIn application with **Sign In with LinkedIn using
   OpenID Connect** and **Share on LinkedIn**. The latter grants the
   `w_member_social` permission required to publish for a member. See the
   [LinkedIn access requirements](https://learn.microsoft.com/en-us/linkedin/shared/authentication/getting-access)
   and [LinkedIn authorization flow](https://learn.microsoft.com/en-us/linkedin/shared/authentication/authorization-code-flow).
2. Set the exact callback URL in the LinkedIn application to
   `http://localhost:3000/api/oauth/linkedin/callback` for the default local
   setup. If `BETTER_AUTH_URL` is changed, use
   `<BETTER_AUTH_URL>/api/oauth/linkedin/callback` instead.
3. Add the credentials to the ignored local file `apps/api/.env` and restart the
   API:

   ```dotenv
   LINKEDIN_CLIENT_ID=your-client-id
   LINKEDIN_CLIENT_SECRET=your-client-secret
   ```

4. Open the dashboard, sign in with the local Herald email/password account,
   create a project and channel, then use **Publisher connections → Connect
   LinkedIn**. Approve the requested access. The callback creates a
   project-owned publisher connection for the LinkedIn member returned by the
   provider.
5. Create a uniquely identifiable text publication for that channel and schedule
   it a few minutes in the future. The in-process worker will create and execute
   the durable job at the scheduled time.
6. Verify the result through the project audit command:

   ```sh
   bun run herald audit list --project <project-id> --json
   ```

   A successful provider call records the provider post identifier in the
   publication outcome and audit trail. If the provider outcome is uncertain, do
   not publish a second copy; inspect LinkedIn first and use the explicit
   `publications reconcile` command to resolve the existing publication.

The provider currently targets text and single-image member posts through the
versioned [LinkedIn Posts API](https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/posts-api),
using the [LinkedIn Images API](https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/images-api)
for verified JPEG and PNG uploads. The opt-in smoke-test procedure above remains
text-only until a disposable image test is explicitly approved.
Better Auth owns human identity and sessions, global administration, project
organizations/memberships, invitations, and new project API keys. Publisher access
and refresh tokens remain project-owned and encrypted at rest using the required
`HERALD_PUBLISHER_ENCRYPTION_KEY`; token material must not be copied into the
environment file or passed to the dashboard, CLI, or provider adapter by an
operator. The encryption key itself is deployment configuration and must be
provided to the API through a separately managed secret.

Generate the current text and LCOV coverage reports for the Bun unit and integration
suites with `bun run test:coverage`. Browser integration remains a separate
Playwright run through `bun run test:e2e`. Coverage is reported for visibility;
critical-path behavior, not a global percentage, is the merge requirement.

## Production deployment and recovery

On Linux x64, record the comparable M0 build and runtime footprint with:

```sh
bun run measure:footprint
```

The command performs a production build, measures the API artifact and the initial
JavaScript needed by `/`, then starts five isolated API processes with temporary
SQLite databases. It reports median cold-start time and resident memory after a
one-second warm-up. The generated databases are removed after the run.

Build the current single-process production container from the monorepo root:

```sh
docker build -t herald:local .
docker run --rm --init \
  --publish 3000:3000 \
  --mount type=volume,source=herald-data,target=/data \
  --env-file apps/api/.env \
  --env NODE_ENV=production \
  --env DB_FILE_NAME=/data/herald.sqlite \
  --env HERALD_MIGRATIONS_DIR=/app/migrations \
  --env HERALD_WEB_ASSETS_DIR=/app/public \
  --env BETTER_AUTH_URL=http://localhost:3000 \
  --env HERALD_WEB_ORIGIN=http://localhost:3000 \
  --env LOG_LEVEL=silent \
  --env LOG_PRETTY=false \
herald:local
```

The image contains the bundled API, the Bun runtime, the built dashboard, and the
committed Drizzle migrations. The SQLite database lives in `/data`. Check the
running container with `curl http://localhost:3000/health` and
`curl http://localhost:3000/ready`, then open
`http://localhost:3000/` for the dashboard. This packaging path is the current
OPS-10 deployment baseline.
The example reuses the local environment file for convenience; deployment setups
should provide an equivalent secret-managed environment file and must not commit it.

Create a complete application backup from a running container by mounting the
application data volume and a separate host backup directory. The bundle contains
the database and verified media bytes:

```sh
docker run --rm \
  --mount type=volume,source=herald-data,target=/data \
  --mount type=bind,source="$PWD/backups",target=/backups \
  herald:local backup --media --output /backups/herald.bundle
```

Stop the application before restoring. The command validates the database, manifest,
and every media object before replacing the database; start the application again
afterward:

```sh
docker run --rm \
  --mount type=volume,source=herald-data,target=/data \
  --mount type=bind,source="$PWD/backups",target=/backups \
  herald:local restore --media --input /backups/herald.bundle
```

The commands without `--media` remain available for database-only recovery, but do
not include stored media objects.

### Publisher encryption key recovery

A complete Herald recovery consists of the application bundle and the separately
managed publisher encryption key. The `--media` bundle intentionally does not
contain `HERALD_PUBLISHER_ENCRYPTION_KEY`; it contains encrypted publisher
credential envelopes that cannot be used without the deployment key.

Before creating a backup:

1. Preserve the exact `HERALD_PUBLISHER_ENCRYPTION_KEY` in a secret manager or
   offline escrow with access and retention controls separate from the backup
   directory.
2. Record `HERALD_PUBLISHER_ENCRYPTION_KEY_ID` with the backup metadata, but never
   record the key value in the bundle, source control, logs, or command arguments.
3. Protect the application bundle as sensitive data: it contains the database,
   media, and encrypted credential material even though it does not contain the
   decryption key.

To recover publisher credentials:

1. Stop Herald and restore the database and media bundle.
2. Configure the same key and matching `HERALD_PUBLISHER_ENCRYPTION_KEY_ID` in
   the deployment environment before starting the application.
3. Start Herald and verify `/health` and `/ready`.
4. Use the dashboard to confirm that the expected project connections are still
   present. These endpoints and the connection list validate runtime and metadata;
   they do not prove that a publisher secret can be decrypted.
5. If credential recovery must be proven, perform one intentionally approved
   provider operation against a controlled destination and verify its provider
   acknowledgement and Herald audit outcome. Do not use a live destination solely
   as a restore probe; if the outcome is uncertain, reconcile it before retrying.

Do not generate a replacement key during restore: a new key cannot decrypt existing
publisher credentials. If the original key is permanently lost, the credentials
are unrecoverable and each affected publisher must be reconnected deliberately.

The current workspace contains:

- `apps/api`: Elysia API process;
- `apps/web`: React 19 + TanStack Router Vite SPA with Tailwind CSS, shadcn/ui Base UI, and Solar Icons;
- `packages/ui`: shared Base UI primitives, Herald design tokens, and Tailwind integration;
- `packages/auth`: Better Auth configuration and adapter boundary;
- `packages/client`: typed client helpers shared by the CLI and dashboard;
- `packages/core`: framework-independent domain and workflow contracts;
- `packages/custom-http`: bounded webhook and mapped HTTP delivery for custom channels;
- `packages/db`: Drizzle ORM schema, Bun SQLite client, and migrations;
- `packages/email`: React Email transactional templates and HTML/text renderers;
- `packages/linkedin`: LinkedIn OAuth profile and publication adapter;
- `packages/media`: local and S3-compatible media storage contracts and adapters;
- `packages/oauth`: OAuth authorization-code and PKCE protocol mechanics;
