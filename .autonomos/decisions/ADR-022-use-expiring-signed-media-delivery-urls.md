# ADR-022 — Use Expiring Signed Media Delivery URLs

- Status: accepted
- Scope: Custom-channel media URL mappings and public media delivery
- Provenance: MEDIA-28 implementation review on 2026-08-31
- Related specifications: [SPEC-004](../specs/SPEC-004-publication-content-boundary.md), [SPEC-005](../specs/SPEC-005-continuous-product-scope.md)
- Related decisions: [ADR-017](ADR-017-use-versioned-webhooks-and-mapped-http-for-custom-channels.md), [ADR-019](ADR-019-separate-media-assets-representations-and-deliveries.md)
- Superseded by: none

## Context

The bounded custom HTTP mapping can deliver media as multipart parts or as URLs.
Multipart keeps bytes inside the delivery request, but some receivers require a
publicly readable URL and may fetch the media independently. Herald's local and
S3-compatible stores remain private by default, so a storage locator or permanent
public object URL cannot become part of the custom-channel contract.

The URL must identify one immutable representation, prevent cross-project access,
expire without a database write, and stop working when the representation is no
longer eligible for public delivery. It must not authenticate a person into Herald,
read Better Auth sessions, or expose local paths, object keys, storage credentials,
or publisher secrets.

## Decision

Herald issues a stateless, versioned bearer URL for one project, asset, and ready
representation. The capability contains only the opaque domain identities and an
expiration timestamp. It is authenticated with HMAC-SHA-256 using the dedicated
deployment secret `HERALD_MEDIA_PUBLIC_URL_SECRET` and a protocol version/domain
separation string. The payload is signed, not user-editable, and no storage locator
is included.

The URL authority has these rules:

- the API origin is the configured Herald API origin;
- the default lifetime is short and bounded by a deployment-configured maximum;
- only an asset in the `ready` state and a representation in the `ready` state may
  be served through the public route;
- project, asset, and representation identity are checked together by the media
  service, so a valid token cannot combine identities from different projects;
- invalid, malformed, expired, deleted, missing, or otherwise ineligible tokens
  return the same not-found response;
- the response streams bytes through the Herald media contract, sets the verified
  content type, length, checksum validator, and `X-Content-Type-Options: nosniff`,
  and does not follow redirects or expose storage metadata;
- responses are not reusable as a permanent public cache, and the route does not
  accept credentials or application sessions;
- URL resolution is supplied to the custom HTTP transport by the application and
  is unavailable when the deployment has not composed the public-media authority.

The signed URL is a temporary capability, not a revocation ledger. A copied URL
may be replayed until it expires. Early invalidation is provided by the existing
media lifecycle: a representation must remain ready and its object must remain
available. Multipart delivery remains the preferred path for receivers that do not
need an independently fetchable URL.

## Alternatives considered

- **Permanent public storage URLs:** simple, but violates private-by-default storage,
  leaks backend details, and makes deletion and access lifetime difficult to enforce.
- **A database row for every issued URL:** supports explicit revocation, but adds
  write amplification, cleanup state, and a new lifecycle without being needed for
  short-lived delivery capabilities.
- **Reuse Better Auth sessions or its secret directly:** mixes application login
  semantics into media delivery. The selected design uses a dedicated deployment
  secret and has no Better Auth dependency.
- **Multipart only:** safest for Herald-controlled receivers, but cannot satisfy
  APIs that require a URL rather than an uploaded part.

## Consequences

- Custom HTTP URL mappings work with both local and S3/R2 storage without exposing
  their implementation details.
- No public ACL or storage-provider-specific URL feature is required.
- Operators must configure a strong deployment secret and an API origin reachable by
  the receiving service.
- URL lifetime and bearer replay remain explicit operational trade-offs; a receiver
  that processes media later must copy it or use multipart delivery.
- Secret rotation invalidates outstanding links and requires the same deployment
  rollout as other security-secret rotation.
