# Install Postdot with Docker Compose

Postdot runs its API, dashboard, publication worker and scheduler in one Bun
container. SQLite and local media share one persistent volume. Postdot is alpha software under active development. This guide uses a
source checkout for its Compose/configuration files and the public
`ghcr.io/postdot/postdot:0.1.0-alpha.1` image, accepted on Linux AMD64 and ARM64.
There is no previous public release, so no prior-release upgrade path is validated.

## First installation

Before starting, have these available:

- Docker Engine with Compose v2.20 or newer.
- Git and a Postdot source checkout.
- OpenSSL to generate the deployment secrets.

Run the commands below from the root of that checkout.

### 1. Configure the instance

```sh
cp compose.env.example .env
chmod 600 .env
openssl rand -hex 32
openssl rand -hex 32
openssl rand -hex 32
```

Paste the three generated values into the empty `BETTER_AUTH_SECRET`,
`POSTBOT_MEDIA_PUBLIC_URL_SECRET` and `POSTBOT_PUBLISHER_ENCRYPTION_KEY` entries,
respectively. Use independent values and retain this file securely. Losing the
publisher key makes stored connection credentials unusable; replacing it is not
an ordinary configuration update.

The defaults serve <http://127.0.0.1:3000>. If this port is occupied, change
`POSTBOT_HTTP_PORT` and the ports in **both** origin variables. Keep `.env` out of
Git and never publish the output of `docker compose config`, which includes secrets.

### 2. Pull, start and check readiness

```sh
printf '\nPOSTBOT_IMAGE=ghcr.io/postdot/postdot:0.1.0-alpha.1\n' >> .env
docker compose config --quiet
docker compose pull
docker compose up -d --no-build --wait
curl --fail http://127.0.0.1:3000/ready
```

The readiness request must succeed before you continue. If startup fails, inspect
`docker compose logs --tail 100 postbot` before changing the configuration.

For reproducible content, replace the tag in `POSTBOT_IMAGE` with
`ghcr.io/postdot/postdot@sha256:690778f5d1af8f4a363406b989e17da8672fc764c6e62f9cca8e1a09c483638e`.
See the [release record](alpha-candidate.md) for its matching source and limits.

To build locally instead, leave `POSTBOT_IMAGE` unset, run `docker compose build`,
then `docker compose up -d --wait`. The default remains `postbot:local`.

### 3. Create the administrator account

Open the dashboard and create the first account. It becomes the installation
administrator; public signup then closes. Create your project and first channel.
A manual channel lets you prepare and schedule content without configuring a
provider account. Invite additional users through the application.

### Public HTTPS deployment

For a public deployment, keep the container bound to loopback and place an HTTPS
reverse proxy on the host in front of it. Set `BETTER_AUTH_URL` and
`POSTBOT_WEB_ORIGIN` to the same public HTTPS origin before starting. A proxy running
in another container needs an appropriate private network configuration instead
of this host-loopback example. Complete initial account setup before exposing the
installation. Provider OAuth and media delivery have additional reachability
requirements: see [provider requirements](provider-requirements.md).

## Persistent data and ordinary operation

Compose owns a `postbot-data` volume under its project name. `/data/postbot.sqlite`
contains application state; `/data/media` contains originals, previews and avatars.
Keep the Compose project name stable so a later invocation uses the same volume.
The image contains committed migrations, which apply automatically at startup.

### Check and control the container

```sh
docker compose ps
docker compose logs --tail 100 postbot
docker compose restart postbot
docker compose stop postbot
docker compose up -d --wait
```

`/health` checks HTTP liveness; `/ready` checks durable-work readiness. After a
restore, readiness can succeed while recovery hold deliberately suspends delivery.
Read the administration recovery state before assuming work has resumed.

### Protect the volume and runtime lock

`docker compose down` keeps the data volume. **`docker compose down --volumes`
deletes it.** Do not use the latter to troubleshoot or update an installation.
Graceful stop has 30 seconds to drain. If a forced termination leaves a runtime
lock, verify that no process uses the database before removing only its exact
`.runtime.lock` marker; never remove a live process's lock.

## Optional email and S3

### Email delivery

SMTP is optional. Without it, automatic verification/password-reset email and
email publication alerts are unavailable. Configure the commented SMTP group in
`.env` when using a relay, then recreate the container:

```sh
docker compose up -d --force-recreate --wait
```

Port 587 normally uses `POSTBOT_EMAIL_SMTP_SECURE=false` with STARTTLS; implicit
TLS on port 465 uses `true`. Username/password must be supplied together. Use the
relay's actual settings and test delivery. There is no bundled production mail server.

### S3-compatible media storage

Local media is the default. S3-compatible storage uses `POSTBOT_MEDIA_STORE=s3`,
`POSTBOT_MEDIA_S3_BUCKET`, access-key and secret-key variables, plus a region or
endpoint. The complete list is in `apps/api/.env.example`. Keep the store ID stable
and pass the same configuration to maintenance commands. Switching the setting
alone does not migrate existing media. No S3 service is required for first use.

## Backup and restoration

Backup scheduling, off-host storage and retention belong to the administrator.
Postdot offers a consistent portable bundle containing SQLite and stored media.
Preserve deployment secrets separately; they are not included in the bundle.

### Create and copy a backup

Create a uniquely named backup while Postdot is running, then copy it outside the
application volume:

```sh
docker compose exec postbot mkdir -p /data/backups
docker compose exec postbot bun /app/postbot.js backup --media --output /data/backups/pre-update.bundle
umask 077
mkdir -p backups
docker compose cp postbot:/data/backups/pre-update.bundle ./backups/
```

`compose exec` runs the explicit Bun command; `compose run` below uses the
normal image entrypoint.

Protect the host backup directory and move the copied bundle to independent
storage. A backup left only in `/data` does not protect against loss of that volume.
Use a new output name for each backup. Inspect a representative restore periodically;
a successful backup alone does not prove your recovery procedure.

### Restore and review before resuming

Stop the application before restoring. The commands below use the bundle still
available under `/data/backups`:

```sh
docker compose stop postbot
docker compose run --rm --no-deps postbot restore --media --input /data/backups/pre-update.bundle
docker compose up -d --wait
```

`compose run` applies the normal image entrypoint. Restoration enables **recovery
hold**: sign in, inspect recovered publications and provider-side effects, then
explicitly resume through Administration. Restoring local history cannot undo
remote publications and may otherwise repeat work performed after the snapshot.
For off-host bundles and externally restored databases, follow the
[backup and restoration boundary](backup-and-restoration-boundary.md).

## Update and rollback

### Prepare and apply an update

The first alpha has no prior-release upgrade evidence. Before adopting a future
release, read its migration notes and validation record, back up data/secrets and
retain the previous image. Never replace an immutable version tag.

For a source-built installation, record the source commit before building an update:

```sh
git rev-parse HEAD
docker image tag postbot:local postbot:before-update
# Update the source checkout to the intended commit, then:
docker compose build
docker compose up -d --wait
curl --fail http://127.0.0.1:3000/ready
```

### If you need to roll back

A failed update is not a reason to delete the volume. Returning to an older image
alone may fail after database migrations; schema downgrade is not supported.
Rollback requires a compatible image **and** its pre-update data/configuration,
with restoration and recovery hold as above. No safe upgrade between public
releases is claimed by this guide. The first alpha image has native acceptance
on Linux AMD64 and ARM64.
