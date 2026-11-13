# ADR-099 — Qualify native HTTP with existing human-session cookies

- Status: proposed — transport recommendation from AUTH-636; no mobile SDK selected
- Scope: native session wire contract, client transport settings and qualification limits
- Provenance: AUTH-636, following the owner-approved multi-client plan in
  [ADR-098](ADR-098-optional-studio-and-client-authentication.md)
- Related: [ADR-075](ADR-075-user-owned-api-keys.md),
  [ADR-061](ADR-061-human-account-and-instance-access-policy.md),
  [ADR-097](ADR-097-selectable-storage-profiles.md)

## Context

Postdot uses Better Auth 1.7.7 with email/password authentication and persistent
human sessions. API middleware treats Authorization Bearer and X-API-Key as
user-owned API keys before consulting cookies. Human-only account, access,
provider-connection and realtime operations deliberately reject API keys.

The installed Better Auth bearer plugin translates bearer tokens into session
cookies. Installing it alone would not change Postdot's API-key dispatch in domain
routes. Better Auth's native Expo integration instead documents sending the signed
session cookie explicitly, with platform-secure storage and ambient credentials
omitted. This wire format already matches Postdot's authorization boundary.

## Alternatives

| Transport | Fit with current Postdot | Qualification decision |
| --- | --- | --- |
| Explicit signed session Cookie | Uses existing human identity, database expiry and revocation across domain/media/SSE routes | Qualify now at HTTP level |
| Better Auth bearer-session plugin | Shares Authorization Bearer with existing key dispatch; requires an explicit credential discriminator and complete boundary review | Defer |
| User API key for mobile UI | Action ceilings exclude human-session-only operations | Preserve for automation |
| JWT or a new authorization server | Adds issuance, revocation and audience policy without a demonstrated need | Defer |
| Expo-specific integration | A possible adapter for cookie storage and app returns, but the mobile framework has not been chosen | SDK/device qualification remains separate |

## Proposed native-client contract

Retain opaque signed human-session cookies for an initial native client. Authenticate
against the selected installation's canonical HTTPS origin. Capture the signed
cookie from Set-Cookie; the JSON login token is not interchangeable with the signed
cookie and is not a Postdot API key. Native requests explicitly send Cookie and,
where required by the existing mutation policy, the canonical origin in Origin.
An Origin header remains request context, never proof of a trusted client.

Use platform-secure storage scoped to canonical server origin and human account.
Respect cookie host, path, Secure and expiry attributes. Persist cookie updates
from authentication responses with a platform cookie manager; do not parse multiple
Set-Cookie fields by splitting on commas. Store no password for automatic login.
Do not log or place credentials in URLs, analytics, crash reports or ordinary caches.

For explicit native cookies, use `credentials: 'omit'` to avoid interference from
the platform's ambient cookie jar and `redirect: 'error'` for authenticated API
requests. Refuse a changed request origin before attaching credentials. Validate
relative private-media URLs against that same server. Browser JavaScript retains
its current same-origin cookie transport; this is not cross-origin browser support.

On launch/resume, read `/api/auth/get-session` before protected work. Process its
Set-Cookie updates and authoritative expiry. Better Auth's current persistent
session policy renews an eligible live session on that read; it does not revive an
expired or revoked session. Business-route success alone does not establish an
updated client cookie expiry. Do not add a parallel refresh-token lifecycle.

On logout, request server revocation and clear local credentials. If offline,
clear local access and disclose that server revocation has not been confirmed;
do not silently retain a credential to retry after another account logs in.
Cancel authenticated work, uploads and streams before switching account/server.
Scope cached content to that pair and discard late responses from the old scope.
Treat technical failures as retryable; clear authenticated UI after confirmed
session loss rather than interpreting every network error as logout.

Private media and native streaming clients must attach the current cookie through
authenticated HTTP, support cancellation and honor refusal/revocation. Current
server streams recheck access at each pull, including the idle heartbeat. Browser
provider OAuth remains a separate server-owned workflow: native app-return URIs
and callback/account binding require a dedicated implementation and acceptance.

## Qualification boundary

Controlled tests use production Postdot authentication and authorization, an
explicit cookie transport and no browser cookie jar. Persistence fixtures cover
renewal, expiry, logout, password-change revocation, current project roles, removed
grants, foreign installations, signed-cookie tampering and key/session separation.
An isolated production HTTPS journey covers raw native-style HTTP, private binary
media, session-only SSE, cross-transport revocation and rejected browser origins.
Better Auth skips origin validation by default in its test environment, so origin
refusal is asserted in the production HTTPS journey rather than simulated by unit
configuration changes.

This is protocol qualification, not acceptance of iOS/Android storage, lifecycle,
TLS handling, background execution, media loaders or a native SSE implementation.
Production clients must validate TLS certificates; only the isolated loopback probe
trusts its generated test certificate. App/server switching and offline logout are
requirements for the future client, not features delivered by the HTTP probe.

Run the production journey after building API and Studio:

```sh
POSTDOT_E2E_PRODUCTION_WEB=true POSTDOT_E2E_SEPARATE_STUDIO=true POSTDOT_E2E_TLS_PROXY=true POSTDOT_E2E_NATIVE_SESSION=true bun x playwright test e2e/native-session.spec.ts
```

## Consequences

This qualification needs no server bearer-session plugin, identity-provider change,
database migration, cookie sharing across sites or relaxation of origin/CSRF rules.
The typed internal client exposes explicit credentials/redirect settings while
retaining existing defaults. Selecting and testing an on-device adapter remains a
later bounded choice, following review of this recommendation.

## Sources

- [Better Auth 1.7 documentation index](https://better-auth.com/llms.txt)
- [Native cookie forwarding and secure storage](https://better-auth.com/docs/integrations/expo#making-authenticated-requests-to-your-server)
- [Session expiry and renewal](https://better-auth.com/docs/concepts/session-management)
- [Optional bearer-session transport](https://better-auth.com/docs/plugins/bearer)
