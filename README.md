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
# Replace BETTER_AUTH_SECRET and HERALD_PUBLISHER_ENCRYPTION_KEY with random values.
bun run dev
```

The API publishes interactive documentation at <http://localhost:3000/openapi>
and its machine-readable specification at <http://localhost:3000/openapi/json>.
The API validates its required runtime configuration at startup.

`BETTER_AUTH_URL` is the canonical origin of the API and `HERALD_WEB_ORIGIN` is
the origin of the browser application. During development they use different
ports because the API listens on `3000` and the Vite development server listens
on `5173`. A production deployment that serves both from one origin can use the
same origin for both values.

Request logging is readable by default in development. Set `LOG_LEVEL=silent` to
disable it, or set `NODE_ENV=production` to make the default log level silent.

For the first local database setup, apply the committed Drizzle migrations:

```sh
cd packages/db
bun run db:migrate
```

Migration `0007` deliberately stops when a pre-CRED-18 database still contains
publisher connections linked to the former authentication-account model. Back up
the database and complete an explicit reconnect or cleanup procedure before
retrying the migration; Herald never guesses how to transfer or discard those
credentials.

Run the complete local merge gate before opening a pull request:

```sh
bun run check
```

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

The provider currently targets text-only member posts through the versioned
[LinkedIn Posts API](https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/posts-api).
Better Auth is used only for Herald email/password sessions. Publisher OAuth
credentials are project-owned and encrypted at rest using the required
`HERALD_PUBLISHER_ENCRYPTION_KEY`; they must not be copied into the environment
file or passed to the dashboard, CLI, or provider adapter by an operator.

Generate the current text and LCOV coverage reports with `bun run test:coverage`.
Coverage is reported for visibility; critical-path behavior, not a global percentage,
is the merge requirement.

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
running container with `curl http://localhost:3000/health` and open
`http://localhost:3000/` for the dashboard. This packaging path is the current
OPS-10 deployment baseline.
The example reuses the local environment file for convenience; deployment setups
should provide an equivalent secret-managed environment file and must not commit it.

Create a consistent backup from a running container by mounting the application data
volume and a separate host backup directory:

```sh
docker run --rm \
  --mount type=volume,source=herald-data,target=/data \
  --mount type=bind,source="$PWD/backups",target=/backups \
  herald:local backup --output /backups/herald.sqlite
```

Stop the application before restoring. The command validates the backup and replaces
the database atomically; start the application again afterward:

```sh
docker run --rm \
  --mount type=volume,source=herald-data,target=/data \
  --mount type=bind,source="$PWD/backups",target=/backups \
  herald:local restore --input /backups/herald.sqlite
```

The current workspace contains:

- `apps/api`: Elysia API process;
- `apps/web`: React 19 + TanStack Router Vite SPA with Tailwind CSS, shadcn/ui Base UI, and Solar Icons;
- `packages/core`: reserved for the framework-independent domain model.
- `packages/db`: Drizzle ORM schema, Bun SQLite client, and migrations;
- `packages/auth`: Better Auth configuration and adapter boundary.
- `packages/oauth`: OAuth authorization-code and PKCE protocol mechanics;
- `packages/linkedin`: LinkedIn OAuth profile and publication adapter.
