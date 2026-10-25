# Persistent operation and recovery

The bundled Compose service is named `postbot`. The application is Postdot;
existing environment variables and maintenance commands retain `POSTBOT_*` and
`postbot.js`. Preserve the Compose project name and deployment directory: changing
them can select a different named volume. The volume stores `/data/postbot.sqlite`
and `/data/media`. `docker compose down --volumes` deletes data.

## Backup

Use a unique output name for each backup; the following is an example, not a
periodic job or permission to overwrite an existing backup:

```sh
docker compose exec postbot mkdir -p /data/backups
docker compose exec postbot bun /app/postbot.js backup --media --output /data/backups/pre-update.bundle
umask 077
mkdir -p backups
docker compose cp postbot:/data/backups/pre-update.bundle ./backups/
```

Move the copied bundle to the chosen independent storage and protect its access.
The bundle contains private data and encrypted credential records. It does not
contain deployment secrets or configuration. Preserve those separately, especially
`POSTBOT_PUBLISHER_ENCRYPTION_KEY` and its identifier. A database copy cannot
reconstruct a missing key. Copying the live SQLite main file alone is not a backup.

## Restore only when requested

Restore replaces data and requires quiescence. Stop the application, preserve
pre-restore material and use a compatible image/configuration. Do not restore over
live traffic as an investigative shortcut. The example assumes the intended bundle
is already at the named path and the user authorized this restore:

```sh
docker compose stop postbot
docker compose run --rm --no-deps postbot restore --media --input /data/backups/pre-update.bundle
docker compose up -d --no-build --wait
```

Restore enables recovery hold. Login and reads work; mutations and delivery are
held. `/ready` can succeed with `checks.recovery: held`. An authorized human
administrator must inspect recovered state and explicitly resume in Administration.
A backup may predate real provider effects: restoring it does not undo remote
posts and must not automatically trigger repeat delivery. Do not delete the hold
marker or retry ambiguous posts to make the system appear healthy.

## Replacement and upgrades

Upgrade from `0.1.0-alpha.1` to `0.1.0-alpha.2` and restoration of its pre-update
backup were validated on native AMD64 and ARM64 with an isolated project, draft
and local media. Read the target release's evidence before each upgrade; a
restart alone does not prove migration or rollback safety. Back up data and
configuration, retain deployment secrets and the previous image, and confirm
compatibility. Image rollback alone does not reverse migrations. Version tags
are immutable; use a new version for corrected executables.
