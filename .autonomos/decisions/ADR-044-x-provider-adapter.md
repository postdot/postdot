# ADR-044 — Use Dedicated X (Twitter) Built-in Provider Adapter

- Status: proposed
- Date: 2026-09-06
- Scope: X built-in channel connections, OAuth 2.0 PKCE, credentials, and publication delivery
- Related issue: PROVIDER-93

## Context

X (formerly Twitter) is a centralized multichannel publication platform. X API v2 uses
OAuth 2.0 with PKCE (RFC 7636) for user-context authorization and Bearer tokens for creating
tweets and uploading media.

Herald requires an explicit built-in execution contract for X that integrates cleanly into
its existing project-owned publisher credential boundary, durable media checkpoints, and
strict external-outcome classification without leaking secrets, adding universal abstractions,
or depending on Better Auth.

## Decision

- X is a first-class built-in provider identified by `x`: `createChannelBody` accepts
  the `x` profile literal, `resolveChannelProfile` resolves it to `xChannelProfile`,
  and one publisher connection is used per project channel.
- Authentication uses OAuth 2.0 Authorization Code Flow with PKCE (S256 challenge method) and
  confidential client credentials (`client_id` and `client_secret` with `client_secret_basic`
  authentication at the token endpoint `https://api.x.com/2/oauth2/token`).
- The authorization flow requests the narrow scopes required for publication: `tweet.read`,
  `tweet.write`, `users.read`, `offline.access`, and `media.write`.
- The callback validates the PKCE verifier, exchanges the authorization code, retrieves the
  authenticated user's profile via `GET https://api.x.com/2/users/me`, and persists the
  encrypted access token, refresh token, and token expiration in Herald's project-owned
  `PublisherCredentialStore`.
- The channel destination is typed as `{ type: 'account', id: string, name: string | null }`,
  where `id` is the numeric X user ID and `name` is `@${username}`.
- Automatic token refresh is performed at the execution boundary when an access token is expired,
  using the stored refresh token with atomic persistence in the credential store. If refresh fails,
  the credential is marked as requiring reconnection and fails permanently.
- Post text is validated with X-compatible weighted counting (twitter-text v3 rules: NFC
  normalization, URLs count 23, emoji and CJK count 2, 280 weighted maximum). The channel
  profile keeps a static 280-character schema bound as a coarse authoring approximation;
  the workflow adapter enforces the weighted limit before any external effect and fails
  permanently on overweight text.
- Media support allows up to 4 images (JPEG, PNG) up to 5MB each. The current image-only
  scope uses the documented v2 multipart upload on `https://api.x.com`: `POST /2/media/upload`
  with `media` and `media_category: tweet_image`, followed by the optional alt-text
  attachment via `POST /2/media/metadata` before tweet creation. Herald's existing
  `MediaStore` and `ProviderMediaDeliveryPort` reserve the delivery and record durable
  remote media checkpoints before tweet creation. Chunked upload remains a future provider
  capability for media types that require it; deprecated v1.1 `upload.twitter.com` endpoints
  are never used.
- Uploaded media checkpoints are reused across attempts and restarts only while both the
  provider-reported `expires_after_secs` deadline (when present) and Herald's conservative
  20-hour horizon (`X_UPLOADED_MEDIA_REUSE_TTL_MS`) remain valid. Older or expired
  checkpoints require explicit reconciliation instead of risking a stale identifier; a
  provider rejection of media identifiers at tweet creation surfaces as permanent
  `invalid_request`.
- Outcomes are strictly classified:
  - 401: `permanent_failure` with `authentication_required`
  - 403: `permanent_failure` with `forbidden`
  - 400/404/422: `permanent_failure` with `invalid_request`
  - 429: `retryable_failure` with `rate_limited`
  - 409: `retryable_failure` with `conflict`
  - 5xx / timeout / network exceptions on mutating operations (tweet creation or media upload):
    `ambiguous` failure with `provider_failure` or `network_failure` or `provider_timeout`. Never
    silently retried.
  - Failed v2 media processing: `permanent_failure` with `invalid_request`; pending
    processing: `ambiguous` with the media identifier checkpointed.
- In tests, deterministic fake transports and injected fetchers are used; no real external
  network calls or real credentials are ever used.

## Alternatives considered

- **OAuth 1.0a User Context:** rejected because OAuth 1.0a requires request tokens and HMAC-SHA1
  signatures, whereas X API v2 standardizes on OAuth 2.0 with PKCE and token refresh.
- **Store tokens in user account:** rejected because credentials belong to a project channel in
  Herald, not to an individual human user.
- **Rely on Better Auth for external OAuth:** rejected because Better Auth is strictly for
  authenticating users into Herald.
- **Legacy v1.1 media upload (`upload.twitter.com/1.1/...`):** rejected because X documents
  those endpoints as deprecated. Herald uses the v2 API on the same `api.x.com` host and
  `media.write` scope as tweet creation.
- **v2 chunked upload for the current image scope:** deferred because the documented simple
  upload accepts the supported JPEG/PNG payloads directly. Chunked INIT/APPEND/FINALIZE can
  be added when a supported media type or size requires it, without changing the durable
  delivery boundary.
- **Naive 280-code-unit text validation:** rejected because X counts URLs as 23 and emoji/CJK
  as 2; a naive limit both rejects valid posts and accepts posts X would reject.

## Consequences

- Herald can publish posts and images directly to X channels with atomic credential management
  and restart-safe media checkpoints bounded by both provider expiry and Herald's safety horizon.
- The shared BuiltInProviderAdapter contract registers `x` with contract `x@post-v1`.
- The shared conformance test suite covers X alongside LinkedIn, Bluesky, Mastodon, and
  Discord, plus X-specific refresh, checkpoint, expiry, and retry coverage.
- Dedicated OAuth route integration tests cover connection start, callback success, PKCE
  verifier delivery, invalid/replayed/mismatched states, provider errors, token
  non-disclosure, and project-owned persistence.

## References

- X API v2 Tweet Creation: https://developer.x.com/en/docs/x-api/tweets/manage-tweets/api-reference/post-tweets
- X API v2 OAuth 2.0: https://developer.x.com/en/docs/authentication/oauth-2-0/authorization-code
- X API v2 Users Me: https://developer.x.com/en/docs/x-api/users/lookup/api-reference/get-users-me
- X API v2 Media Upload: https://docs.x.com/x-api/media/upload-media
- X API v2 Append Media Upload: https://docs.x.com/x-api/media/append-media-upload
- X API v2 Media Upload Introduction: https://docs.x.com/x-api/media/introduction
- twitter-text weighted configuration (v3): https://github.com/twitter/twitter-text/blob/master/config/v3.json
