# ADR-098 — Optional Studio serving and a shared client authentication boundary

- Status: accepted — owner approved the staged plan on 2026-11-13
- Scope: API-only serving, separately hosted Studio, future native-client requirements
- Provenance: DEPLOY-635; owner direction to assess deployment/security conflicts and prepare for a mobile client
- Partially supersedes: [ADR-003](ADR-003-use-a-single-process-singleton.md),
  [ADR-007](ADR-007-use-a-react-spa-dashboard.md) and
  [ADR-010](ADR-010-use-bun-runtime-image-for-v1-packaging.md), only the requirement
  that production Studio assets must be served by the API process
- Related: [SPEC-005](../specs/SPEC-005-continuous-product-scope.md),
  [ADR-075](ADR-075-user-owned-api-keys.md),
  [ADR-093](ADR-093-versioned-container-releases.md),
  [ADR-097](ADR-097-selectable-storage-profiles.md)

## Context

The Studio is already a static React SPA. Browser transports use relative URLs and
the page origin for API requests, media and authenticated event streams. The API
also derives provider callback and signed media URLs from its configured public
origin. Serving files elsewhere need not change that browser boundary.

A native mobile client would call the same API, but ordinary native HTTP does not
use browser CORS or automatic browser cookie behavior. A WebView or web build does.
Enabling cross-origin browser requests alone would not provide native login,
session renewal, private media access or safe return links.

## Decision

### Serving and deployment

1. Keep the integrated image and asset serving as the default. Add an explicit
   `POSTDOT_WEB_ENABLED=false` option that skips production asset loading entirely,
   including filesystem validation. Missing assets still fail startup when serving
   is enabled. Disabling files does not disable authentication or backend services.
2. API, scheduler, worker, database and media topology continue to follow ADR-097.
   Separating static files does not require PostgreSQL or another worker. A static
   hosting platform does not become the Postdot application runtime.
3. A separately hosted Studio initially uses a single public HTTPS origin with a
   streaming reverse proxy for `/api/*` and `/oauth/*`. `BETTER_AUTH_URL` and
   `POSTDOT_WEB_ORIGIN` identify that public origin, not the upstream server.
   Health, OpenAPI and MCP can remain directly accessible at the backend according
   to operator policy. Metrics retain their dedicated authentication.
4. The proxy upstream is deployment configuration, never a user-supplied request
   parameter. Preserve path/query, Origin, cookies, Set-Cookie, redirect locations,
   streaming, cancellation and binary bodies. Do not cache API/OAuth responses or
   signed media. Never let an API miss fall through to the SPA. Sanitize forwarded
   identity headers at the trusted ingress; configured URLs own OAuth identity.
5. Use Studio assets and API from the same source revision/release initially.
   Separately deploying files does not promise independently compatible versions.
   Keep the public origin stable across hosting changes and preserve previous
   release assets during a coordinated update/rollback. Existing distribution and
   release authorization rules still apply; no new hosted service is implied.

### Identity, sessions and client transports

All clients resolve the same human identity and current instance/workspace/project
authorization at the server. An Origin header identifies a browser request context;
it is not proof of a trusted application or a substitute for authentication.

| Client | Credential boundary | Status in this lot |
| --- | --- | --- |
| Studio/browser | Better Auth human session, host-only HttpOnly cookies, existing origin/CSRF controls | Preserve and qualify through a separate static host/proxy |
| CLI, script, MCP | User-owned key, live access intersection and explicit action ceiling | Preserve; document session-based key provisioning without Studio |
| Future native app | Revocable human session with platform-secure storage and explicit transport | Requirements only; no native adapter or bearer-session endpoint introduced |
| Future browser on another origin | Credentialed CORS plus complete browser mutation/session/media policy | Separate qualification required; not enabled by this decision |

The mobile application must support selecting a self-hosted HTTPS server, human
login, renewal, expiry, revocation and account/server switching. It must scope its
stored credentials, caches, uploads and event streams to that server and account,
and cancel work before discarding credentials. Private media and event streams
need authenticated native transports. Logout and administrative revocation must
stop access through the same server policy as Studio.

Keep email/password authentication. Choose a supported Better Auth native session
transport in a later bounded implementation; this decision does not select Expo,
JWT, new identity providers or an OAuth authorization server. Native credentials
must not be a bundled application secret or an automation key that bypasses
human-session-only operations. Provider secrets and authorization attempts stay
on Postdot's server. Any future app-return flow needs explicit return URI rules,
one-use state and account/server binding; no arbitrary redirect whitelist.

### API-only administration

Disabling Studio files leaves human session endpoints and session-only operations
available. Provision an administrator using existing signup/bootstrap policy,
authenticate over HTTPS with a private cookie jar, create a scoped/expiring key
through the existing session-only API, then sign out. Neither a new admin token
nor a key-management permission for machine keys is introduced.

`POSTDOT_WEB_ORIGIN` continues to identify the Studio for invitations, notification
links and publisher return paths. Without an external Studio, those browser
journeys have no UI destination; operators must use the corresponding human-session
APIs or offline recovery where available. Disabling file serving does not promise
provider OAuth without a browser or a CLI replacement for every administration screen.

## Alternatives considered

- A flag for API-only serving with no client contract: small, but leaves callback,
  session, lifecycle and version assumptions implicit.
- Direct cross-origin Studio access now: requires coordinated changes to HTTP,
  private media, cookies, CORS and mutation protections. Cross-site cookie policies
  remain a browser constraint even with credentialed CORS.
- A new server-rendered Studio/BFF or moving scheduled work to edge functions:
  introduces another runtime/application boundary without a demonstrated need.
- Native access through an embedded shared secret or general-purpose user API key:
  does not preserve interactive human session semantics and safe revocation.

## Qualification and consequences

The implementation must prove production startup with absent assets when disabled,
default startup failure with absent assets, backend readiness and worker operation,
session/key provisioning and machine-key refusal on human-only routes. Separately
served production assets must pass HTTPS browser login, logout/expiry, rejected
auth origins, binary/private media, realtime delivery/reconnection and access
revocation. Provider callback/state and email-return contracts require focused
coverage; local controlled fixtures do not establish live provider acceptance.

Qualify the reference proxy locally before advertising cloud-host compatibility.
Hosted proxy upload limits, streaming timeouts, cache rules and TLS policy remain
part of each deployment's acceptance. Adding CDN hosting is an optional operating
choice; it does not remove the backend or its hosting cost.

Initial delivery order: configuration and API-only lifecycle; separately served
Studio behind a proxy; deployment instructions and compatible static artifact;
native session transport as a later client-specific lot. Acceptance of this
direction is distinct from implementation or hosted-provider qualification.

Run the isolated production browser journey after building API and Studio:

```sh
POSTDOT_E2E_PRODUCTION_WEB=true POSTDOT_E2E_SEPARATE_STUDIO=true POSTDOT_E2E_TLS_PROXY=true bun x playwright test e2e/separate-studio.spec.ts
```

## Sources

- [Better Auth cookies and cross-domain guidance](https://better-auth.com/docs/concepts/cookies)
- [Browser credentialed CORS constraints](https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/CORS)
- [Native OAuth app-return considerations, when OAuth is used](https://www.rfc-editor.org/rfc/rfc8252)
