# ADR-045 — Use a Dedicated DEV.to Built-in Provider Adapter

- Status: proposed
- Date: 2026-09-06
- Scope: DEV.to channel profiles, project-owned API-key connections, and article delivery
- Related issue: PROVIDER-94

## Context

Herald needs to publish long-form Markdown content to DEV.to while keeping the
destination-specific protocol isolated from the shared publication model. DEV.to
uses the Forem API v1 and authenticates API requests with a project-provided
API key. Article creation accepts an article object containing a title,
Markdown body, publication state, and an optional absolute main-image URL.

The provider must fit Herald's existing project-owned credential boundary,
source/target content separation, public media delivery, and explicit external
outcome classification. A connection must be verifiable without putting the
API key in the response or associating the credential with the human who
performed the connection.

## Decision

- DEV.to is a first-class built-in provider identified by `devto`.
- The DEV.to profile uses the versioned `article-v1` execution contract and
  maps Herald's `headline` to `title`, `body.text` to `body_markdown`, and the
  ordered source media list to a target `media` field.
- The profile accepts plain text or Markdown source text. Plain text remains
  valid Markdown; no provider-specific syntax is introduced into the shared
  source model.
- The current article slice supports zero or one JPEG/PNG main image. Herald
  creates a short-lived signed public URL for that image and sends the URL as
  `main_image`; DEV.to does not receive Herald's local path or storage
  credentials.
- A connection uses a DEV.to API key supplied by the user. Herald verifies it
  with `GET /api/users/me`, stores it encrypted in the project-owned publisher
  credential store, and records the DEV.to account as the channel destination.
  Better Auth remains limited to authentication into Herald.
- Organization publishing is not included in this slice. Adding it requires a
  deliberate destination ownership decision rather than silently treating an
  organization as a user account.
- The package adapter owns Forem API headers, request construction, response
  parsing, timeout boundaries, and provider error classification. The API
  module owns sessions, project/channel access, credential persistence, and
  route responses.
- A successful article creation returns DEV.to's article identifier and URL.
  A timeout, network failure, server error, or malformed success response after
  the mutating request is treated as ambiguous because DEV.to may have created
  the article. Authentication failures mark the project credential for
  reconnection; rate limits remain retryable.

## Alternatives considered

- **Better Auth account/provider storage:** rejected because Better Auth
  authenticates humans into Herald; DEV.to credentials belong to a project
  channel and must survive changes to the connecting actor.
- **Generic declarative HTTP channel:** rejected for this built-in provider
  because a dedicated package can validate the article contract, isolate Forem
  behavior, and evolve its error semantics without weakening custom channels.
- **OAuth:** not used because the current DEV.to API v1 connection flow is
  API-key based.
- **Local or permanent media URLs:** rejected because DEV.to must be able to
  fetch the image without receiving Herald storage credentials; signed delivery
  preserves the local-storage deployment option.
- **DEV.to organization destinations in this slice:** deferred until Herald's
  destination model explicitly represents ownership and organization-specific
  publishing semantics.

## Consequences

- DEV.to joins the common built-in adapter conformance surface and can be
  exercised without real credentials or network calls.
- The web application can create a DEV.to channel, verify an API key, and
  connect the resulting project-owned account.
- DEV.to article delivery is intentionally limited to the stable article shape
  implemented here. Tags, series, canonical URLs, organization publishing,
  and provider-specific article metadata can be added as an explicit profile
  evolution rather than leaking into the shared source model.
- A real provider test remains a separate validation step because deterministic
  tests cannot verify the current account's API permissions or DEV.to's live
  publication behavior.

## References

- Forem API v1: https://developers.forem.com/api/v1
- Forem `GET /api/users/me`: https://developers.forem.com/api/v1#tag/users/operation/getUser
- Forem `POST /api/articles`: https://developers.forem.com/api/v1#tag/articles/operation/createArticle
