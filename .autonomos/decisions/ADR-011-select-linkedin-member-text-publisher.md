# ADR-011 — Select LinkedIn Member Text Publishing for the First Automatic Slice

- Status: accepted
- Scope: PUB-09 provider selection and the first automatic publishing boundary
- Provenance: [PUB-09](../TASKS.md), provider documentation review, and the 2026-08-28 feasibility spike
- Related specifications: [SPEC-001](../specs/SPEC-001-v1-scope.md), [SPEC-002](../specs/SPEC-002-engineering-operating-model.md)
- Related decisions: [ADR-001](ADR-001-separate-channel-from-publisher.md), [ADR-006](ADR-006-use-a-next-event-durable-scheduler.md), [ADR-009](ADR-009-fence-external-effects-with-durable-claims.md)
- Superseded by: none

## Context

Herald needs one production-relevant automatic publisher to validate the complete
scheduled publication path. The product context identifies LinkedIn as the first
automatic destination in the intended workflow, while X and unsupported
destinations remain valid manual or custom channels.

The first implementation must prove the publisher boundary, account connection,
scheduling, external-effect fencing, result persistence, and recovery semantics.
It must not pull media storage, organization administration, comments, analytics,
or a universal provider framework into this first provider slice before the
evidence requires them.

The official LinkedIn documentation confirms that:

- LinkedIn uses OAuth 2.0 member authorization for requests on behalf of a member.
- `w_member_social` is an open permission for posting, commenting, and liking on
  behalf of an authenticated member.
- Organic text posts use `POST https://api.linkedin.com/rest/posts` and return the
  created post identifier in the `x-restli-id` response header.
- Versioned LinkedIn API calls require both a `LinkedIn-Version` header and the
  `X-Restli-Protocol-Version: 2.0.0` header. Marketing API versions are released
  monthly; the current reference version on 2026-08-28 is `202608`.
- Organization publishing uses additional restricted permissions and depends on
  the authenticated member's organization role.

Sources:

- [Getting Access to LinkedIn APIs](https://learn.microsoft.com/en-us/linkedin/shared/authentication/getting-access)
- [LinkedIn OAuth 2.0 overview](https://learn.microsoft.com/en-us/linkedin/shared/authentication/authentication)
- [LinkedIn Posts API](https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/posts-api)
- [LinkedIn Marketing API versioning](https://learn.microsoft.com/en-us/linkedin/marketing/versioning)

## Decision proposal

Select a LinkedIn member-profile publisher as the first automatic publisher,
with this deliberately narrow initial contract:

1. Connect a member profile through OAuth 2.0.
2. Request only the scopes required for the first flow: `openid`, `profile`, and
   `w_member_social`.
3. Publish one organic text post through the versioned Posts API.
4. Persist the provider-issued post identifier returned by `x-restli-id` and map
   it to a stable LinkedIn URL when the URL form is known by the adapter.
5. Send an explicit, pinned API version. The implementation may provide a
   `LINKEDIN_API_VERSION` override, but must have a reproducible default and must
   never make an unversioned Marketing API request.
6. Treat the create-post mutation as non-idempotent unless LinkedIn documents an
   idempotency contract for the exact endpoint. A timeout or thrown error after
   the durable effect boundary therefore remains ambiguous and is never retried
   blindly.
7. Keep provider-specific OAuth, request mapping, error classification, and
   reconciliation behavior in the LinkedIn adapter. Do not create a generic
   provider configuration language or a second domain model.

Organization Pages, comments, analytics, reshares, and additional publishers were
outside the PUB-09 slice. PUB-10 subsequently added one-image member delivery
through [ADR-026](ADR-026-linkedin-single-image-delivery.md). Further provider
capabilities remain separate evidence-backed changes and must not change
`Channel -> 0..1 Publisher`.

## Alternatives considered

### Mastodon first

Mastodon's status API is technically attractive for a first adapter: it supports a
granular `write:statuses` scope and an `Idempotency-Key` retained by the server for
up to one hour. It still requires instance discovery and per-instance OAuth, and it
does not validate the LinkedIn-centered workflow that Herald is intended to replace.
It remains a strong second-provider candidate if real usage needs it.

### Bluesky first

Bluesky's AT Protocol is open and lightweight. A post is a repository record created
through `com.atproto.repo.createRecord`, with an `at://` URI and CID returned by the
write. It introduces protocol-specific service discovery, repository identity, and
credential semantics that are not part of the intended first workflow. It remains a
candidate for a later provider-specific adapter.

### X first

The product context intentionally permits X channels without automation when API
access or cost is not justified. Making X the first automatic publisher would turn a
known manual boundary into a provider-access and pricing dependency.

### LinkedIn Organization Page first

Organization publishing is closer to some eventual use cases, but it requires
restricted permissions such as `w_organization_social` and appropriate organization
roles. It adds account selection and access-control failure modes before the basic
automatic path is proven.

### A generic publisher DSL or marketplace

This would move OAuth, media workflows, provider limits, retries, and reconciliation
into an implicit programming language. The project has already rejected that scope;
complex publishers remain code and channel instances remain data.

## Consequences

### Positive

- The first automatic path matches the product's stated workflow instead of merely
  selecting the easiest API.
- Text-only publishing validated scheduling, credentials, external effect fencing,
  result persistence, and operator-visible failure handling without making media a
  prerequisite of the first provider slice.
- The adapter boundary remains small and provider-specific behavior stays explicit.
- The initial permission request follows least privilege and leaves organization
  access out of the default connection flow.

### Costs and risks

- LinkedIn app creation, callback configuration, and live publishing access remain
  external prerequisites for the opt-in smoke test.
- LinkedIn's non-idempotent create endpoint means ambiguous results must be visible
  and reconciled explicitly before PUB-09 can be considered complete.
- A monthly API version requires maintenance and a version migration check; the
  pinned default must be updated before its provider support window ends.
- Organization pages and additional media capabilities require separate domain,
  credential, storage, and provider capability decisions.

## Implementation exit criteria

PUB-09 must not be marked complete until all of the following are true:

- the minimal project-scoped account and credential boundary is persisted safely;
- deterministic contract tests cover OAuth mapping, versioned text publication,
  response-ID extraction, error classification, and secret redaction;
- an integration test runs the publisher through the real SQLite-backed workflow
  executor and verifies success, retryable failure, and ambiguous recovery;
- the product exposes an explicit reconciliation path for a LinkedIn publication
  whose external result is unknown;
- an opt-in live smoke test is documented and passes with operator-provided
  credentials, without making network access part of the default quality gate;
- `bun run check` and the footprint measurements remain green.

## Live validation

On 2026-08-31, an operator-approved smoke test completed with the configured
LinkedIn member application:

- the OAuth callback persisted a project-owned LinkedIn connection;
- the scheduler and worker delivered one real text post through the Posts API;
- Herald persisted the provider result and marked the job as succeeded;
- the exact provider post was deleted through LinkedIn's idempotent delete
  operation, which returned HTTP `204`;
- `bun run check` and the production footprint measurement passed after the live
  flow changes;
- no client secret or token material was recorded in the repository or logs.
