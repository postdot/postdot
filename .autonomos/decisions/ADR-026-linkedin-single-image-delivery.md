# ADR-026 — Deliver One LinkedIn Member Image per Publication

- Status: accepted
- Scope: LinkedIn member publication delivery with one Postbot-managed image
- Provenance: [PUB-10](../TASKS.md), LinkedIn Images API and Posts API review on 2026-08-31
- Related decisions: [ADR-011](ADR-011-select-linkedin-member-text-publisher.md),
  [ADR-019](ADR-019-separate-media-assets-representations-and-deliveries.md),
  [ADR-020](ADR-020-version-and-assess-channel-profile-changes.md)
- Superseded by: none

## Context

The LinkedIn member publisher already supports text posts. Postbot now needs to
deliver a verified project image without weakening the immutable execution
revision or treating a provider asset as part of the reusable Postbot media asset.

LinkedIn's current Images API uses a multi-step flow: initialize an upload for the
member owner, transfer the bytes to the returned upload URL, and reference the
resulting image URN from the Posts API. The provider accepts JPEG, PNG, and GIF
images, but this channel profile deliberately starts with one JPEG or PNG image.

The default member permission, `w_member_social`, is write-only for versioned
`rest/images` reads. The current Images API also does not support
`SYNCHRONOUS_UPLOAD`. Requesting a read permission solely to poll image status
would change the default credential scope and still would not be necessary for the
documented upload-and-post request sequence.

## Decision

The built-in LinkedIn member profile is versioned to support:

- required `commentary` text;
- zero or one ordered media item;
- JPEG or PNG representations selected during target promotion;
- optional accessibility text, capped at LinkedIn's documented 4,086 characters.

The provider adapter owns the LinkedIn-specific mapping and performs the following
sequence:

1. `POST /rest/images?action=initializeUpload` with the member owner URN;
2. `PUT` the exact pinned representation bytes to the returned HTTPS upload URL;
3. persist the returned image URN in `ProviderMediaDelivery`;
4. mark the provider media delivery uploaded;
5. `POST /rest/posts` with the image URN and optional alt text.

`ProviderMediaDelivery` is the durable checkpoint for this provider-specific
resource. A process can therefore reuse a confirmed uploaded image when a later
final post attempt is retried. If the transfer outcome is ambiguous, the delivery
remains visible as ambiguous and retains the provider image URN when one is known;
Postbot never starts another upload blindly from that state.

The adapter does not poll `GET /rest/images` in this slice. The successful upload
response and the final Posts API response are the available provider signals under
the default member scope. A future status or reconciliation capability may add
permissioned reads as a separate decision; it must not silently broaden the
default OAuth scope.

Upload URLs must use HTTPS and are fetched without automatic redirects. OAuth
tokens and signed upload URLs are excluded from provider error messages.

## Alternatives considered

### Poll the Images API until `AVAILABLE`

This would provide a more explicit processing signal, but versioned image reads
are unavailable to a token with only `w_member_social`. Adding a read scope to the
default member flow would broaden permissions for a feature that does not require
it in the documented request sequence. Rejected for this slice.

### Upload every image immediately before every final post

This would avoid a provider-media checkpoint but would duplicate provider assets
after safe final-post retries and make recovery after a process interruption less
precise. Rejected because it conflicts with the existing media delivery model.

### Store the LinkedIn image URN on `MediaAsset`

An image URN belongs to a provider account and a particular execution, not to a
reusable Postbot asset. Storing it on the asset would allow an image to be reused
under the wrong member connection. Rejected by the media boundary in ADR-019.

## Consequences

### Positive

- Text and one-image member posts share one versioned channel profile.
- Exact local or S3-backed bytes remain pinned before any provider effect.
- A successful provider upload is reusable across safe final-post retries.
- Ambiguous upload outcomes remain explicit and recoverable instead of being
  duplicated automatically.
- The default LinkedIn permission set remains limited to the existing member
  publishing flow.

### Costs and risks

- LinkedIn processing is asynchronous and the default flow does not poll image
  status; the Posts API remains authoritative for whether the image can be used.
- Provider-specific limits such as the documented pixel-count ceiling can still
  produce a provider rejection until the shared capability contract can express
  them precisely.
- GIF, video, multi-image posts, organization owners, and provider-side media
  cleanup require separate provider evidence and decisions.

## Sources

- [LinkedIn Images API](https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/images-api?view=li-lms-2026-08)
- [LinkedIn Posts API](https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/posts-api?view=li-lms-2026-08)
- [LinkedIn API versioning](https://learn.microsoft.com/en-us/linkedin/marketing/versioning?view=li-lms-2026-08)
