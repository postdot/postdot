# ADR-087 — Unknown Facebook pending token expiration

- Status: proposed
- Scope: Facebook OAuth token response and transient Page selection only
- Evidence: ISSUE-178, FACEBOOK-520; candidate verification in FACEBOOK-521
- Adoption: Pending review of a concrete patch; no runtime policy change yet

## Proposed behavior

Represent an omitted `expires_in` on the final Facebook token-exchange response as unknown (`expiresInSeconds: null`). Absence is not proof of validity, token class or non-expiration. A present value, including JSON null, must satisfy the existing positive safe-integer and maximum bounds. Do not substitute the first exchange's token or expiry.

Keep the token encrypted only in the existing pending Page-selection state. Its database attempt remains single-use, actor/project/channel/application/callback-bound and limited by the existing local TTL. A known provider deadline remains an additional earlier bound. Unknown provider expiration is represented separately from the local retention deadline.

The existing permission check must succeed before creating pending selection. Page discovery and selection continue using the token in authorization headers; selecting a Page still verifies current permissions and that Page's publishing task before saving its distinct credential. Provider rejection remains a failure. No token introspection endpoint, new scopes, schema change or change to persistent Page credential lifetime is included.

## Rationale and alternatives

The shared OAuth contract already permits unknown expiration. [RFC 6749 section 5.1](https://www.rfc-editor.org/rfc/rfc6749#section-5.1) recommends expiration metadata and expects provider information when it is omitted; it does not justify guessing a default. The observed Meta response lacks that metadata, while the current adapter refuses it before its existing authorization checks.

Keeping the current refusal is reversible but blocks this observed flow. Changing Meta app configuration or adding introspection requires additional provider facts and may introduce a new token-transport exception. Assuming a sixty-day or infinite lifetime would introduce unsupported facts. The candidate instead preserves explicit uncertainty and the already enforced local bounds.

## Required verification and limits

Prove unknown expiration remains bounded by attempt expiry, shorter known expiration remains binding, malformed values and provider refusal fail closed, and only the selected Page token becomes a credential. Preserve callback/state, replay and foreign-actor regressions. A successful synthetic test does not establish the real token's type or validity or complete the native publication acceptance. UI error classification remains a separate concern.
