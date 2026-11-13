# Optional Studio Cloudflare transport

This directory packages the existing SPA and a streaming proxy; authentication,
authorization and scheduled work remain in the Postdot API. Follow ADR-098,
ADR-100 and the optional recipe assessment in ADR-101. Keep origin selection in
operator configuration. Preserve Origin, separate cookies, API statuses, private
cache directives and cancellation; never follow an upstream redirect with ingress
credentials or buffer complete media/stream bodies.

Visitor-IP headers are authoritative only at Cloudflare's request boundary. The
dedicated origin ingress must authenticate this Worker before converting its
client-address header to X-Forwarded-For. Keep the raw API port private and choose
the actual immediate proxy peer for Postdot's allowlist. Shared Cloudflare address
ranges do not authenticate a particular operator's Worker.

Generate binding declarations with `bun run types:studio:cloudflare`. That pipeline
scopes generated types to a module so Worker bindings do not become required Node
process variables elsewhere. Match compatibility dates/flags to the pinned runtime
and qualify navigation, missing resources and API/OAuth navigation explicitly.

The opt-in production journey is documented in the public Cloudflare Studio guide.
It uses local workerd and Nginx, not a hosted Cloudflare account. Its HTTPS Wrangler
listener avoids development proxy rewriting of Origin/Location between schemes.
Freeze this directory during that browser run; do not regenerate bindings or assets
while Wrangler watches them. Start/stop Docker only outside browser execution.

For release input, use `build.ts --release-dir` and verify the archive's manifest
before replacing staging. Keep the extracted archive immutable; retained assets,
Cloudflare headers and robots rules belong in the serving copy. Archives are
exported from a stopped, immutable image, not rebuilt independently of the API.
