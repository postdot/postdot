<!-- cspell:words Litestream -->

# Backup and restoration boundary

Herald provides application-aware database and media backup/restore primitives.
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

## Existing restoration behavior

Restore requires the server to be stopped and acquires the runtime quiescence
lock. Complete restore checks the manifest against the database, verifies file
hashes and requires the configured media store identity to match the archive.
It rejects an existing object whose bytes differ, fills missing objects, verifies
them, then replaces SQLite using a temporary file and rename.

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
Herald does not currently integrate or certify such a deployment.

Database recovery does not restore deleted external objects. Any database-history
strategy needs corresponding media retention or version history if old references
are expected to remain recoverable.

References: [PostgreSQL continuous archiving](https://www.postgresql.org/docs/17/continuous-archiving.html),
[SQLite WAL](https://www.sqlite.org/wal.html),
[Litestream architecture](https://litestream.io/how-it-works/).

## Important limit: restoring history does not undo remote effects

The current restore copies job and delivery state verbatim. Ordinary server
startup starts the publication worker, email delivery and media maintenance.
There is no restore-specific hold in these paths. A pending job in the snapshot
may have been delivered after the snapshot was taken; its restored state cannot
prove that delivery never happened. Existing effect markers protect only facts
present in the snapshot, not facts lost by restoring an earlier database.

Do not assume an ordinary restart after rollback is free from repeated external
effects. Checking archive integrity proves neither provider reconciliation nor
safe automatic delivery. Provider credentials may also have changed since the
snapshot. A restore procedure needs an explicit strategy for these conditions.

## Proposed next boundary — not implemented

A restore-specific durable recovery hold should prevent provider publication and
external email delivery after database replacement, while allowing inspection.
An administrator would review uncertain outstanding work before explicitly
resuming. A normal restart without a restore should retain its current behavior.
The hold must cover API-triggered effects as well as background executors; merely
not starting one worker is insufficient. Startup cleanup must be considered before
inspection of restored media. External database restores require a documented
way to enter recovery mode too.

The exact review/resume policy remains a product decision. This proposal is not
a claim that recovery mode or provider reconciliation already exists.
