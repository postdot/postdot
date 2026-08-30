# ADR-019 — Separate Media Assets, Representations, and Deliveries

- Status: accepted
- Scope: Project media, storage, publication snapshots, and provider delivery
- Provenance: Owner review of DOMAIN-07 on 2026-08-30
- Related specifications: [SPEC-004](../specs/SPEC-004-publication-content-boundary.md)
- Superseded by: none

## Context

Herald needs durable media support across built-in and runtime-defined channels.
Media can be reused by several publications, transformed for a destination, uploaded
to a provider before the final publication effect, stored locally or in an
S3-compatible service, and retained for exact retry or reconciliation. Treating an
attachment as one path or URL on a publication would conflate all of these lifecycles
and make local-to-S3 migration or provider-specific variants a rewrite.

SQLite and object storage do not share a transaction. Client-provided filenames,
extensions, MIME types, and checksums are also not sufficient evidence that stored
bytes are safe or compatible with a destination. The model therefore needs explicit
partial states, byte verification, immutable execution references, and orphan
reconciliation.

## Decision

Herald separates four media concepts:

1. `MediaAsset` is the reusable, project-owned logical asset. It owns lifecycle and
   user-facing metadata such as the original filename and default accessibility text.
2. `MediaRepresentation` is one immutable stored byte representation of an asset.
   The original is preserved; thumbnails, previews, and provider-ready variants are
   additional representations with explicit derivation metadata.
3. `PublicationRevisionMedia` is the ordered relation from a target revision to the
   exact representation used by that revision. It records role, schema location,
   accessibility overrides, and other accepted publication metadata.
4. `ProviderMediaDelivery` records provider-specific upload state and remote identity
   for one revision media item. A provider identifier never becomes an attribute of
   the reusable asset.

The recognized media families are `image`, `video`, `audio`, and `document`.
Animation is image metadata. The database does not contain a permanent MIME allowlist.
A Herald-owned format registry identifies verified formats and inspectors, while
each immutable channel profile declares the exact MIME, byte, count, dimension,
duration, composition, and accessibility constraints that apply to its media fields.
Filename extensions and client MIME declarations are hints only.

Every ready representation records a stable `storeId`, an opaque application-
generated object key, detected format and MIME type, byte size, SHA-256 checksum, and
available family-specific metadata. A derived representation also records its source
representation, canonical recipe, processor identity, and processor version. No
conversion overwrites an original.

Working drafts may refer to a ready asset. Target promotion selects a compatible
ready representation and persists the exact relation. If a required variant is not
ready, Herald reports a pending processing requirement and does not promote the
target. Retries and reconciliation reuse the representation pinned by the execution
revision rather than resolving a newer variant.

## Storage contract

Herald owns a narrow `MediaStore` contract that:

- writes a bounded stream to an opaque key;
- opens bounded complete or range reads;
- returns normalized object metadata and availability;
- deletes an object idempotently.

The store does not allocate domain identities, inspect formats, attach publications,
or decide retention. `LocalMediaStore` uses Bun's local file primitives and
`S3MediaStore` uses `Bun.S3Client`. Both implementations satisfy one contract test
suite. Bun file objects, S3 file objects, credentials, bucket names, local roots, and
absolute paths do not cross the infrastructure boundary.

One configured store identity is active for new writes. Existing store identities
may remain readable during an explicit backend migration; changing the backend
behind an existing identity is rejected. This makes local and S3/R2 deployment
choices interchangeable without changing publication records.

S3 presigned uploads and downloads are optional infrastructure accelerations rather
than required `MediaStore` semantics. Local bytes stream through authenticated
Herald routes; S3 may use short-lived signed URLs. Both paths use the same finalizer,
and storage remains private by default.

## Upload, inspection, and deletion

Media creation uses an explicit intent and finalization workflow:

1. reserve the project asset, original representation, object key, and expiring
   upload intent in SQLite;
2. stream through Herald or upload to a short-lived S3 target;
3. independently stat and stream the stored bytes, enforce resource ceilings,
   compute SHA-256, detect the format, and inspect available metadata;
4. mark the representation and asset ready in one transaction only after successful
   verification;
5. reconcile expired intents, missing objects, partial failures, and identifiable
   orphan objects.

Image inspection and bounded preview generation may use Bun's native image pipeline.
Heavy or optional processors are explicit capabilities and do not silently enlarge
the base production image. A format is not advertised as supported on the Linux
runtime until its inspector has executable contract evidence.

Asset deletion is two-phase. Archiving removes normal selection access. Physical
deletion requires no retained draft, target, execution, or audit reference and a
completed grace period. Provider-side cleanup is separately owned by each provider
module.

## Backup and restore

A complete Herald backup includes SQLite, a manifest of retained representations,
their store identities, keys, byte sizes and checksums, and the corresponding object
bytes from local or S3 storage. Garbage collection is fenced while the manifest
snapshot is copied. Restore verifies bytes before restored assets become ready.

The existing SQLite-only operation remains a database backup primitive. A deliberately
requested metadata-only export may omit media bytes, but neither is described as a
complete recoverable Herald backup after media storage is enabled.

## Alternatives considered

- **Store one attachment path on each publication:** simple initially, but duplicates
  reusable assets and cannot represent immutable variants or provider upload state.
- **Expose `BunFile` and `S3File` throughout the application:** small wrapper count,
  but leaks storage credentials and backend-specific lifecycle semantics into the
  domain.
- **Use FlyDrive:** provides a broader existing abstraction, but adds a dependency
  while Bun already supplies the two required native backends. It remains
  reconsiderable if the required backend matrix grows.
- **Store provider media identifiers on assets:** enables accidental reuse, but
  conflates project assets with account-, provider-, revision-, and attempt-specific
  remote state.

## Consequences

- Media can be reused without allowing a later transform to change an execution.
- Provider upload recovery can distinguish a successful media upload from a failed
  final publication.
- Local and S3/R2 implementations enter together behind one tested boundary.
- Upload interruption, orphan cleanup, deletion, and backup require explicit
  lifecycle services rather than filesystem side effects hidden in route handlers.
- New formats and processors can be added without replacing publication or storage
  records, but each needs real inspection and capability evidence before use.
