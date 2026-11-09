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

## Login protocol

- The login hosts are fixed: `www.instagram.com` authorizes, `api.instagram.com` exchanges the code, and `graph.instagram.com` serves the long-lived token, the refresh and the profile resource. Never accept a provider-supplied endpoint.
- The confidential code exchange posts the documented form to the fixed token endpoint. The selected documented flow does not document PKCE parameters, so this adapter disables them explicitly for that flow only. It does not claim that every Instagram flow rejects PKCE and it does not change the shared default.
- The documented code response carries the token, the user identifier and the granted permissions inside a one-item `data` envelope; some provider examples show the same fields at the top level. Accept those two shapes only. A mixed body, a body describing several accounts, an absent identifier or absent granted permissions is refused, because missing permission metadata never proves support.
- A body that carries a provider error beside a success shape is refused, and so is an error inside the envelope entry. An ambiguous body never yields an identity or a token.
- The app-scoped identifier and the professional publishing identifier are different identities. `account.id` is the professional `user_id` addressed by the media endpoints; `account.appScopedId` is the `/me` `id` and must match the user identifier reported by the code exchange. Only a business or media creator account with a usable username is eligible.
- The fixed token endpoints carry the client secret as a documented transport exception. Never log, return or attach those URLs, the secret, the code, the state or a token to an error, and never reuse an error cause.
- A durable Instagram credential needs a known lifetime. The long-lived token keeps the provider's actual lifetime, and an absent, null, zero, negative or malformed expiry is a failure on completion and on refresh. A 60-day lifetime is never guessed, an unknown lifetime never becomes a stored credential and the refreshed result therefore always carries a real expiry.
- Refreshing uses the long-lived token itself. An expired token cannot be refreshed and a token younger than 24 hours is refused before any request. Corrupt metadata is refused before any request too: a negative issuance or a lifetime that ends no later than it starts. The provider issues no refresh token, so none is invented.
- The callback accepts only the documented literal `#_` or Meta Unified `#_=_` artifact and removes it before validation without rebuilding the address, so the rest of it, including any userinfo, stays visible to the checks below. Every other fragment, a foreign origin or path, userinfo, a duplicated state or code, an empty code and a refusal that does not carry the expected state are refused before any provider request.

## Unified Login

- Unified Login uses a configuration ID and the fixed `www.facebook.com` authorization and `graph.facebook.com/v26.0` API hosts. Keep its token lifecycle separate from direct Instagram Login.
- Preserve a finite provider lifetime. If exchange omits expiry or reports zero, confirm `is_valid`, issuing `app_id` and `expires_at` through the fixed Meta `debug_token` endpoint before storing the credential. Only confirmed zero expiration produces a nullable deadline and encrypted `nonExpiring` metadata; unknown or malformed metadata fails closed. The debugging endpoint's `input_token` query is a documented transport exception and must never enter logs or errors.
- A verified non-expiring Unified credential may publish with a null deadline; a direct-login credential with unknown expiry must still require reconnection. Unified credentials with finite deadlines use their existing token until expiry and then require reconnection. Do not report a successful renewal without actually issuing a new token through the separate management API.
- Write the Graph host from explicit adapter metadata, never infer the new connection's host from a token prefix. Keep this metadata encrypted with the credential.
