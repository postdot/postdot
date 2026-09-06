# ADR-041 — Use Per-Instance OAuth for Mastodon Connections

- Status: accepted
- Date: 2026-09-06
- Scope: Mastodon built-in channel connections, credentials, and publication delivery
- Related issue: PROVIDER-87

## Context

Mastodon is a federation of independently operated servers rather than one
centralized API. The instance is therefore part of the account identity and the
API origin for every connection. Mastodon requires an OAuth application to be
registered on the instance before a user authorizes it; the resulting client
credentials and access token are instance-specific.

Herald already stores project-owned publisher credentials and allows a publisher
connection to retain an endpoint origin, but built-in providers currently reject
endpoint settings. Treating Mastodon as a global environment configuration would
make one deployment unable to connect accounts from multiple instances and would
force a restart whenever a project adds or changes a server.

## Decision

- Mastodon is a built-in provider identified by `mastodon` and uses one publisher
  connection per project channel.
- The connection flow accepts one normalized Mastodon instance origin. HTTPS is
  required, with loopback HTTP allowed only for local development. Credentials,
  paths, queries, and fragments are rejected.
- Herald registers its client on that instance, requests only the scopes required
  for the initial publishing flow (`read:accounts`, `write:statuses`, and
  `write:media`), and uses the OAuth authorization-code flow with S256 PKCE.
- The normalized instance origin is stored in
  `publisher_connections.endpoint_url`. The instance-issued client ID and client
  secret are stored in the encrypted provider-session envelope alongside the
  token context; none of them are deployment environment variables.
- The callback verifies the authorized account on the same instance before saving
  a project-owned credential and an account destination. The destination is the
  Mastodon account ID; the human-readable `acct` value is metadata only.
- Herald remains the scheduler. It sends an ordinary Mastodon status at the
  execution boundary and does not delegate scheduling to Mastodon's scheduled
  status API.
- The initial built-in profile uses Herald's existing portable media boundary:
  plain text plus up to four JPEG or PNG images with accessibility text. Instance
  limits remain provider truth and are checked by the adapter; synchronizing
  instance-specific limits into editor feedback is a later capability task, not a
  reason to duplicate provider tables or weaken the common profile model.
- Mastodon media uploads use the durable provider-media lifecycle. A provider
  media ID is checkpointed before publication; an upload or status response that
  cannot be classified as no-effect is surfaced as ambiguous rather than
  silently retried.

## Alternatives considered

- **Deployment-wide Mastodon credentials:** rejected because a Herald deployment
  must connect accounts from different instances without environment changes.
- **Treat the instance as a custom HTTP channel:** rejected because Mastodon's
  OAuth, account verification, media upload lifecycle, response classification,
  and refresh semantics are provider-specific and deserve a typed adapter.
- **Use one shared app registration for every instance:** impossible in the
  general case because Mastodon application credentials are issued by each
  instance.
- **Store the Mastodon client secret in public connection settings:** rejected
  because connection metadata and immutable execution snapshots must never expose
  provider credentials.
- **Delegate scheduling to Mastodon:** rejected because it would split Herald's
  durable schedule and outcome model across two schedulers.

## Consequences

- A single Herald deployment can serve multiple Mastodon instances while
  retaining project ownership and the existing encrypted credential boundary.
- The publisher store needs a provider policy that can validate and persist an
  endpoint origin for selected built-in providers without opening endpoint
  configuration for every provider.
- The first profile remains portable rather than pretending all instances have
  identical limits. Later instance-capability synchronization can improve
  authoring feedback without changing credential ownership or execution
  identity.
- No Mastodon account or external network is required for unit and integration
  tests; provider fetches and instance registration are injected at the package
  boundary.

## References

- Mastodon application registration: https://docs.joinmastodon.org/methods/apps/
- Mastodon OAuth: https://docs.joinmastodon.org/spec/oauth/
- Mastodon status creation: https://docs.joinmastodon.org/methods/statuses/
- Mastodon media upload: https://docs.joinmastodon.org/methods/media/
