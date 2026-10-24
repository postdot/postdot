# ADR-088 — Direct Instagram Login

- Status: accepted
- Date: 2026-10-20
- Provenance: owner explicitly selected direct Instagram Login in response to the INSTAGRAM-535 connection-choice question.
- Related: ISSUE-166, META-505, INSTAGRAM-535.

## Decision

The initial Instagram destination uses Instagram Login for professional Business/Creator accounts. It does not require a linked Facebook Page. Instagram application configuration, credentials and token lifecycle remain distinct from the Facebook Pages connection; do not overload a Facebook application identifier or disguise the two account requirements as a generic Meta connection.

The first publishing format is one JPEG with optional caption and accessibility text. OAuth setup, account eligibility, encrypted configuration and durable container/final-publish recovery must be established before enabling the destination in Studio. The protocol/profile package alone does not establish product availability or permission to send live requests.

## Rationale and alternatives

Direct login avoids imposing Facebook Page linkage on Instagram users and fits an independent project-owned channel. It requires a separate Instagram configuration and token lifecycle. Facebook Login could reuse part of Page discovery, but would impose Page linkage and Facebook business authorization; the owner did not choose that path for this initial destination.

## Consequences and limits

Use the direct-login Graph host and endpoint permission family. Verify app-registration compatibility and actual access in a later explicitly authorized setup task. No App Review approval, account eligibility, live token validity or public media reachability has been proven. Preserve exact callback/state validation and the existing encrypted project credential boundary when implementing OAuth; this decision does not authorize weakening those controls.

Sources: [Meta publishing guide](https://developers.facebook.com/documentation/instagram-platform/content-publishing), [initial comparison](../archive/root-documentation-2026-10-25/source/docs/project/meta-integration-discovery.md).
