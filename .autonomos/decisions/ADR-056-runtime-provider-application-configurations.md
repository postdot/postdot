# ADR-056 — Manage provider application configurations at runtime

- Status: proposed
- Scope: Provider OAuth application configuration, publisher credentials, and
  channel connections
- Provenance: ISSUE-059, CRED-19, and the owner-directed self-hosting policy
  against restart-required per-channel setup
- Related decisions: ADR-012, ADR-031, ADR-033, ADR-041, ADR-044, ADR-045

## Context

Herald is self-hosted and must keep the normal connection workflow inside the
running application. Environment variables are appropriate for deployment
bootstrap and root secrets, but requiring an operator to edit `.env` and restart
Herald whenever a user connects a new LinkedIn account or destination creates
avoidable operational friction.

The distinction is important:

- A provider application is the OAuth client registered with a provider. It may
  have a client identifier, a client secret, scopes, a callback, and provider
  review or approval state.
- A publisher credential is the account authorization obtained after a member
  completes OAuth. It is project-owned, secret material, and may be used by one
  or more channel connections.
- A channel connection binds a credential to a Herald channel and an external
  destination such as a LinkedIn organization page.

The current database already models project-owned credentials and one publisher
per channel. `publisher_credentials` is unique by project, provider, and
external account; `publisher_connections` does not impose a global uniqueness
constraint on a credential. The remaining gap is the application configuration
used to create and refresh those credentials. The current API runtime resolves
that configuration from environment variables at startup.

## Decision

Herald will introduce a runtime-managed provider application configuration
boundary.

1. Deployment environment variables remain responsible for bootstrap concerns:
   database and media locations, listener and public origins, session secrets,
   and the publisher encryption root key. They are not the per-channel setup
   mechanism.
2. Herald will persist provider application configurations as instance-owned
   settings. Client secrets and other confidential fields are encrypted with the
   existing publisher-secret boundary; public identifiers and non-secret
   metadata are stored separately and redacted from ordinary responses and logs.
3. A provider may have multiple application configurations. One may be the
   default for convenience, but the model must allow an OAuth attempt and the
   resulting publisher credential to record the application configuration used.
   This preserves correct token refresh and permits deliberate separation by
   organization, quota, scope, or ownership.
4. OAuth initiation and callback handling resolve the current configuration at
   request time. Saving a configuration or adding another one must not require
   an API restart. Callback URLs remain deployment/provider concerns and are
   displayed as actionable setup information.
5. Projects may contain multiple accounts, channels, and destinations for the
   same provider. Herald will not impose a one-provider or one-channel limit.
   Provider-specific permissions, duplicate-destination rules, quotas, and
   unsupported destination types remain explicit adapter policies.
6. The setup surface must expose truthful readiness states. A provider without
   an application configuration is `not configured`, not a generic runtime
   failure; a configured provider with an unavailable account is a separate
   connection state.

The initial implementation may keep environment-backed configuration as an
explicit compatibility/bootstrap path, but runtime-managed configuration is the
normative direction. Environment values must not silently override a saved
configuration or make ordinary account onboarding restart-dependent.

## Alternatives considered

### Keep all provider application configuration in `.env`

Rejected. It is simple for the process but couples ordinary product work to
DevOps changes and restarts, and hides the distinction between installation and
business data.

### Ship one shared Herald OAuth application per provider

Rejected for the self-hosted product. It would centralize secrets and callbacks
under Herald, weaken installation ownership, and fail for providers or
organizations that require their own application approval.

### Store provider application secrets as plaintext database fields

Rejected. A database-managed setup does not justify weakening protection of
client secrets; the existing encryption key and redaction boundaries remain
necessary.

### Allow only one application configuration per provider

Rejected as a hard invariant. A single default is a useful UX, but separate
applications can be required for ownership, scopes, quotas, provider review, or
organizational isolation.

## Consequences

### Positive

- Users can connect additional accounts and destinations without restarting
  Herald or editing deployment files.
- The product model supports the Vercel example: one project with several
  LinkedIn destinations, or several projects with one destination each.
- OAuth token refresh remains attributable to the application that issued the
  grant.
- Provider readiness, setup errors, and account errors become distinguishable.

### Costs and risks

- A new instance-settings persistence boundary, authorization policy, migration,
  and setup UI/API are required.
- The encryption root key remains an operator responsibility; losing it makes
  encrypted provider secrets unrecoverable.
- Multiple application configurations require explicit selection, rotation, and
  deletion semantics.
- Multi-process deployments will eventually need cache invalidation or a
  database-backed resolver; the single-process V1 can resolve settings directly
  from SQLite at request time.

## Acceptance criteria for implementation

- An authorized operator can create, update, disable, and select provider
  application configurations while Herald is running.
- Client secrets never appear in API responses, logs, audit metadata, or browser
  storage, and encrypted values survive restart with the configured root key.
- Two LinkedIn accounts and multiple LinkedIn destinations can coexist in one
  project without environment changes or a restart.
- OAuth attempts and publisher credentials retain the application configuration
  identity needed for callback validation and token refresh.
- Missing provider setup is represented as a truthful, actionable state.
- Existing environment-backed development and deployment setups have an explicit
  migration/compatibility path rather than an implicit behavior change.
- Tests cover authorization, project isolation, secret redaction, restart
  behavior, multiple configurations, and duplicate-destination policy.
