# ADR-101 — Optional Cloudflare Studio ingress recipe

- Status: proposed — locally implemented recipe under accepted ADR-098; hosted adoption remains an operator choice
- Scope: optional static hosting and protected transport, not a Studio framework migration
- Provenance: DEPLOY-638; owner requested the next hosting lot and an assessment of TanStack Start
- Related: [ADR-098](ADR-098-optional-studio-and-client-authentication.md), [ADR-100](ADR-100-trusted-proxy-client-addresses.md)

## Context

Studio is a Vite/TanStack Router SPA. Its browser transports already share the
public origin with authentication, private media and SSE. Separating static files
needs an ingress on that origin; it does not require moving authorization out of
the API. A generic Cloudflare address allowlist cannot authenticate our own
Worker: unrelated customers share the platform's networks.

The owner suggested TanStack Start as a possible answer to deployment/authentication
constraints, explicitly without requesting migration or a second application
service. Current Start documentation distinguishes static SPA output from its
optional server functions/routes. Start supplies request, cookie and middleware
primitives, while application/library code still owns sessions and authorization.

## Proposal and implemented local recipe

Keep the current SPA. Package the same production assets with distribution
notices and use Cloudflare Workers Static Assets. Invoke a small proxy Worker
first for exact API/OAuth roots and their descendants, including navigation.
Existing assets use the platform's asset router. Missing paths invoke the Worker:
only GET/HEAD HTML navigation requests without a filename extension receive index.html.
Missing resources return 404. The installed runtime's SPA fallback returned HTML
even for missing scripts, so this recipe uses an explicit navigation fallback
instead of enabling its blanket SPA mode.

The Worker uses a configured fixed HTTPS upstream, preserves Origin, session/key
credentials, binary bodies, separate cookies and redirect responses, streams
bodies, disables subrequest caching and propagates client cancellation. It never
follows redirects with its ingress credential. Configuration and transport errors
fail closed without disclosing infrastructure details. HTTP loopback is accepted
only as a useful local qualification target; it provides no hosted origin path.

Protect a dedicated HTTPS origin ingress with a separate 256-bit random secret.
The Worker overwrites that secret and the client-address transport header. Nginx
checks the secret before forwarding, strips private headers and supplies the
verified address as X-Forwarded-For. ADR-100 then validates the immediate socket
peer. Keep the raw API port private. Compromise of this secret compromises ingress
provenance, not the independent user/session authorization requirement. Rotate it
at both ends and exclude it from assets, logs and public configuration.

Keep alternate Worker URLs off. Pair Studio/API revisions, preserve old hashed
assets for open tabs and retain the integrated deployment as the default. Use the
installed Wrangler 4.152.0 with compatibility date 2026-10-26: its workerd binary
refuses today's 2026-11-13 date. Explicitly enable request signals and repeat qualification
when advancing the runtime. Root Wrangler is development tooling already present
at the same version in docs; no application runtime dependency is introduced.

## Alternatives and the Start question

- Static files with a user-managed reverse proxy: remains the simpler existing
  option when the operator already has one on the public origin.
- A Start server/BFF: useful if a demonstrated requirement calls for server-held
  downstream credentials, request-specific SSR or enterprise authentication
  adaptation. It adds its own session/proxy/cache/error boundaries. The API must
  still authorize every operation for browser, native and machine clients.
- Start with static-only output: does not add a required runtime, but also does
  not supply request-time authentication or solve this ingress problem. Existing
  Router routes help migration; browser APIs, route guards, imports, sessions and
  optional SSR still need a dedicated assessment rather than a mechanical rename.
- Direct cross-origin browser access: retains the cookie/CORS/private-media
  qualification deferred by ADR-098; Start does not remove browser origin rules.
- Trust all Cloudflare peers: cannot distinguish the intended Worker service.
- Cloudflare Tunnel, per-hostname origin certificates or Access: valid alternative
  ingress boundaries, but not qualified by this recipe.

## Qualification and consequences

Boundary tests cover fixed origins, spoofed forwarding headers, refusal of invalid
configuration, separate cookies, redirects, binary bodies and stream cancellation.
The opt-in browser path uses a local workerd instance and the actual Nginx snippet
against an asset-free production API. The existing TLS test proxy connects to an
HTTPS Wrangler listener so its development proxy preserves Origin/Location schemes;
Worker-to-Nginx transport uses isolated loopback HTTP. This does not prove
Cloudflare's edge TLS, visitor-header provenance, account policy or deployed limits.

Hosted acceptance must check origin TLS and network isolation, secret storage,
fresh session IPs, plan/zone upload limits, cache transforms, quotas, stream
interruption/revocation, version pairing and coordinated rollback. No account,
domain or deployment is created by implementing this optional recipe. A native
application remains governed by the separate native-session qualification.

## Sources

- [Start SPA mode](https://tanstack.com/start/latest/docs/framework/react/guide/spa-mode)
- [Start authentication and authorization](https://tanstack.com/start/latest/docs/framework/react/guide/authentication)
- [Cloudflare SPA and Worker routing](https://developers.cloudflare.com/workers/static-assets/routing/single-page-application/)
- [Cloudflare request, redirect and cancellation semantics](https://developers.cloudflare.com/workers/runtime-apis/request/)
- [Cloudflare visitor IP semantics](https://developers.cloudflare.com/fundamentals/reference/http-headers/#cf-connecting-ip)
- [Cloudflare limits](https://developers.cloudflare.com/workers/platform/limits/)
