# ADR-031 — Separate the LinkedIn Authorization Principal from the Publication Destination

- Status: accepted
- Scope: LinkedIn OAuth connections, member publication, organization-page publication, and provider media ownership
- Provenance: [PUB-55](../TASKS.md), owner approval on 2026-09-03, and official LinkedIn Posts, Organization Lookup, and authorization documentation
- Related decisions: [ADR-011](ADR-011-select-linkedin-member-text-publisher.md), [ADR-012](ADR-012-own-publisher-credentials-and-use-oauth4webapi.md), [ADR-026](ADR-026-linkedin-single-image-delivery.md)
- Superseded by: none

## Context

LinkedIn's OAuth flow authenticates a member who grants Postbot access. That
member is the authorization principal, but the Posts API can publish either as
that member or as an organization page for which the member has an appropriate
role. The current implementation uses the member ID as both concepts and always
constructs a `urn:li:person:{id}` author.

This is safe only for member publication. It cannot represent the agency page
without risking a publication to the wrong external identity, and it places a
destination identity on the credential even though one authorized member token
may be usable for several project channels and organization pages.

## Decision

Postbot separates the two identities:

- A project-owned publisher credential stores the encrypted OAuth token and the
  LinkedIn member principal returned by the profile endpoint. It remains the
  authorization material, not the publication destination.
- A publisher connection stores one explicit destination for its channel. The
  LinkedIn destination is either a `member` with a member ID or an `organization`
  with an organization ID and display name.
- Existing LinkedIn connections without a destination value resolve to their
  credential's member identity and are materialized as member destinations. They
  are never silently reinterpreted as organization pages.
- Member authorization requests use `openid`, `profile`, and `w_member_social`.
  Organization-page authorization requests use `openid`, `profile`,
  `w_organization_social`, and `rw_organization_admin` so Postbot can verify the
  explicitly requested organization before saving the connection. The exact
  permissions remain subject to the LinkedIn application's approved products.
- The connection flow receives an explicit organization ID for a page
  destination. After OAuth, the LinkedIn adapter verifies that organization and
  obtains its display name before Postbot creates the connection. Postbot never
  chooses the first organization returned by a provider or accepts an arbitrary
  caller-supplied URN as an author.
- The LinkedIn Posts API author and Images API upload owner are constructed from
  the connection destination. Text and one-image delivery therefore share the
  same destination boundary.
- Better Auth remains limited to Postbot email/password authentication. It does
  not participate in LinkedIn authorization or destination ownership.

## Alternatives considered

### Keep using the credential's member ID as the author

This preserves the existing implementation but cannot publish to a company page
and makes a successful connection misleading. Rejected.

### Store the organization page on the credential

This conflates the member token's authorization principal with a channel-specific
destination and prevents a single token from serving multiple page connections.
Rejected.

### Accept arbitrary LinkedIn author URNs from the request

This would make provider identity selection a caller-controlled string, bypass
the explicit destination model, and weaken validation. Rejected.

### Select the first organization returned after OAuth

An operator may administer several pages. Implicit selection could publish to a
different project destination than intended. Rejected.

## Consequences

- Publisher connection persistence and the worker gain a small, explicit
  destination value object; no generic provider DSL is introduced.
- One project-scoped LinkedIn credential can be referenced by more than one
  channel connection, each with its own member or organization destination.
- Organization-page setup requires LinkedIn application access to the relevant
  permissions and currently asks the operator for the page's organization ID.
  Page discovery and richer role-aware selection can be added as a separate
  provider capability once real access evidence justifies it.
- Existing member publication and single-image delivery remain supported and
  continue to use the member scopes and person URN.
- A live organization-page smoke test remains an explicit action-time operation;
  implementation tests must not publish to a real page automatically.

## Sources

- [LinkedIn Posts API](https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/posts-api?view=li-lms-2026-04)
- [LinkedIn Organization Lookup](https://learn.microsoft.com/en-us/linkedin/marketing/community-management/organizations/organization-lookup-api?view=li-lms-2026-02)
- [LinkedIn Organization Access Control](https://learn.microsoft.com/en-us/linkedin/marketing/community-management/organizations/organization-access-control-by-role?view=li-lms-2026-01)
- [LinkedIn 3-legged OAuth flow](https://learn.microsoft.com/en-us/linkedin/shared/authentication/authorization-code-flow)
