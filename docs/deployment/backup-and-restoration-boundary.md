<!-- cspell:words Litestream -->

# Backup and restoration boundary

Postdot provides application-aware database and media backup/restore primitives.
The administrator owns scheduling, retention, off-machine storage, protection of
backup material and recovery exercises. No built-in periodic backup or continuous
replication is promised.

## What the existing commands cover

The maintenance `backup` command creates a SQLite snapshot. With `--media`, it
creates a directory bundle containing the snapshot, a manifest and the bytes of
retained project media representations and personal avatars. Objects are copied
from the configured media store, including an S3-backed store. This is a portable
set of application data, not a complete deployment image.

The complete backup checks copied object sizes and available stored hashes,
records database/object hashes, fences physical media cleanup, and publishes the
bundle by renaming its temporary directory after completion. Its database state
is the SQLite snapshot, not the time the last object finishes copying. The fence
is leased and refreshed between copies; an arbitrarily slow object transfer is
not covered by a guarantee that the lease cannot expire.

The bundle does not capture environment configuration, the executable, deployment
manifests, externally hosted article images, or provider-side publications.
Persisted encrypted credentials remain encrypted. Preserve the publisher
encryption key and its configured identifier separately and securely; a database
copy cannot recreate a missing key. Retain the other deployment secrets and
configuration needed for the installation as well.

## SQLite storage settings

Keep the database on a local filesystem that supports SQLite locking and shared
memory. Postdot opens file-backed databases in WAL mode with `synchronous=FULL`
and a five-second busy timeout. WAL allows readers to keep their snapshot while
a writer commits; SQLite still permits only one writer at a time. A contended
operation can block the Bun thread during that wait and can still fail.

Use the backup command for a live snapshot. Copying the main database file alone
can omit committed data in its `-wal` file. Preserve the database and its sidecars
after an unexpected stop; do not delete sidecars to make startup succeed.

## Existing restoration behavior

Restore requires the server to be stopped and acquires the runtime quiescence
lock. Complete restore checks the manifest against the database, verifies file
hashes and requires the configured media store identity to match the archive.
It rejects an existing object whose bytes differ, fills missing objects, verifies
them, then replaces SQLite using a temporary file and rename.

Before replacing an existing destination, restore asks SQLite to checkpoint its
old WAL and switch to rollback journal mode. A conflicting connection prevents
replacement. Complete restore performs this transition before opening its media
fence. The next server start enables WAL again. Orphaned WAL or shared-memory
files without a destination database cause restore to refuse the replacement;
inspect and preserve that recovery material before retrying.

This is not a distributed transaction across SQLite and object storage. A failed
restore can leave already copied media objects, while the database replacement
has not occurred. It does not delete unrelated destination objects. Database-only
restore provides no assurance that referenced media still exist. Moving to a
different store identity is not currently an automatic conversion operation.

Treat bundles as sensitive: they include private data and encrypted credential
records. Storage location, access controls and any archive encryption are the
administrator's responsibility.

## Continuous recovery is a separate infrastructure choice

A full snapshot is useful for migration and a standalone recovery point. It does
not imply minute-level recovery. PostgreSQL point-in-time recovery combines a
base backup with a continuous WAL archive. SQLite's ordinary WAL file is recycled;
retaining that live file is not equivalent to continuous recovery. Tools such as
Litestream implement a separate SQLite replication and recovery mechanism.
Postdot does not currently integrate or certify such a deployment.

Database recovery does not restore deleted external objects. Any database-history
strategy needs corresponding media retention or version history if old references
are expected to remain recoverable.

References: [PostgreSQL continuous archiving](https://www.postgresql.org/docs/17/continuous-archiving.html),
[SQLite WAL](https://www.sqlite.org/wal.html),
[Litestream architecture](https://litestream.io/how-it-works/).

## Important limit: restoring history does not undo remote effects

Restore copies job and delivery state verbatim. A pending job in the snapshot
may have been delivered after the snapshot was taken; its restored state cannot
prove that delivery never happened. Existing effect markers protect only facts
present in the snapshot, not facts lost by restoring an earlier database.

## Recovery hold after restoration

Both database-only and complete restore now persist a recovery marker next to
SQLite, before replacing the database. The marker is outside the snapshot and
survives ordinary restarts. A new restore changes its acknowledgement token.
An invalid marker prevents startup instead of silently enabling delivery.

While held, Postdot permits inspection and email/password login but rejects HTTP
mutations with `503 recovery_hold`, except the administrator's explicit resume.
OAuth callbacks and account verification are suspended too. The publication
worker, external email delivery runtime and media cleanup runtime are not started;
startup media cleanup is skipped. SMTP dispatch has an independent recovery guard.
In-app notification projection remains local and can continue. Readiness remains
successful for serving inspection, with `checks.recovery: held` and idle executors;
an actually failed runtime still makes readiness fail.

Administration shows the recovery state and requires an explicit acknowledgement
before resuming delivery and cleanup. Only an authenticated human instance
administrator can use `POST /api/settings/recovery/resume`; API keys cannot resume.
Review the pending publications and the provider-side state first. The hold does
not automatically cancel, reconcile or deduplicate restored work. Pending tasks
can still repeat earlier remote effects if the administrator resumes them.
Application writes, including cancellation, are suspended during this first
recovery implementation; resumption is acknowledgement, not a repair operation.

The marker is `<database path>.recovery.json` on the database volume. It is not a
runtime lock; do not delete it to bypass acknowledgement. Preserve its restricted
permissions and do not expose it through the web server. An unchanged ordinary
installation without a marker starts normally.

### Restores performed outside Postdot

An external SQLite restore cannot be detected reliably from its database content.
Before starting Postdot on an externally restored database, enter the hold through
the maintenance command, with the server stopped:

```sh
bun apps/api/src/index.ts recovery hold --database /absolute/path/postbot.sqlite
bun apps/api/src/index.ts recovery status --database /absolute/path/postbot.sqlite
```

In a production image, pass the same arguments to its normal server entrypoint
using the same database volume. No separate runtime is required. Use the
administration page to resume after inspecting the recovered installation.
If restored accounts are inaccessible, the machine administrator can acknowledge
offline with the server stopped:

```sh
bun apps/api/src/index.ts recovery resume --confirm --database /absolute/path/postbot.sqlite
```

Offline entry and acknowledgement acquire the runtime lock and refuse an active
server. Neither command contacts a provider. The next normal startup after offline
acknowledgement enables delivery and cleanup. Missing deployment keys and stale
provider credentials still need administrator attention.
