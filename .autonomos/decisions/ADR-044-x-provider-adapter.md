# ADR-044 — Use Dedicated X (Twitter) Built-in Provider Adapter

- Status: accepted
- Date: 2026-09-06
- Scope: X built-in channel connections, OAuth 2.0 PKCE, credentials, and publication delivery
- Related issue: PROVIDER-92

## Context

X (formerly Twitter) is a centralized multichannel publication platform. X API v2 uses
OAuth 2.0 with PKCE (RFC 7636) for user-context authorization and Bearer tokens for creating
tweets and uploading media.

Herald requires an explicit built-in execution contract for X that integrates cleanly into
its existing project-owned publisher credential boundary, durable media checkpoints, and
strict external-outcome classification without leaking secrets, adding universal abstractions,
or depending on Better Auth.

## Decision

- X is a built-in provider identified by `x` and uses one publisher connection per project channel.
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
- Publication sends plain text (up to 280 characters) via `POST https://api.x.com/2/tweets`.
- Media support allows up to 4 images (JPEG, PNG) up to 5MB each. Media upload uses Herald's
  existing `MediaStore` and `ProviderMediaDeliveryPort` to reserve, upload to X via
  `POST https://upload.twitter.com/1.1/media/upload.json`, attach alt-text metadata via
  `POST https://upload.twitter.com/1.1/media/metadata/create.json` if present, and record
  durable remote media checkpoints before tweet creation.
- Outcomes are strictly classified:
  - 401: `permanent_failure` with `authentication_required`
  - 403: `permanent_failure` with `forbidden`
  - 400/404/422: `permanent_failure` with `invalid_request`
  - 429: `retryable_failure` with `rate_limited`
  - 409: `retryable_failure` with `conflict`
  - 5xx / timeout / network exceptions on mutating operations (tweet creation or media upload):
    `ambiguous` failure with `provider_failure` or `network_failure` or `provider_timeout`. Never
    silently retried.
- In tests, deterministic fake transports and injected fetchers are used; no real external
  network calls or real credentials are ever used.

## Alternatives considered

- **OAuth 1.0a User Context:** rejected because OAuth 1.0a requires request tokens and HMAC-SHA1
  signatures, whereas X API v2 standardizes on OAuth 2.0 with PKCE and token refresh.
- **Store tokens in user account:** rejected because credentials belong to a project channel in
  Herald, not to an individual human user.
- **Rely on Better Auth for external OAuth:** rejected because Better Auth is strictly for
  authenticating users into Herald.

## Consequences

- Herald can publish posts and images directly to X channels with atomic credential management
  and restart-safe media checkpoints.
- The shared BuiltInProviderAdapter contract registers `x` with contract `x@post-v1`.
- The shared conformance test suite covers X alongside LinkedIn, Bluesky, and Mastodon.

## References

- X API v2 Tweet Creation: https://developer.x.com/en/docs/x-api/tweets/manage-tweets/api-reference/post-tweets
- X API v2 OAuth 2.0: https://developer.x.com/en/docs/authentication/oauth-2-0/authorization-code
- X API v2 Users Me: https://developer.x.com/en/docs/x-api/users/lookup/api-reference/get-users-me
- X Media Upload: https://developer.x.com/en/docs/x-api/media/upload-media/api-reference/post-media-upload
