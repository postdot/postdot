# Postdot site

TanStack Start + Fumadocs site, prerendered to static files, with Motion interactions.

```sh
bun run --cwd apps/docs dev
bun run --cwd apps/docs build
```

Development uses port 5174. The build writes `dist/client/`, which Cloudflare
Workers static assets serve (`wrangler.jsonc`); there is no Worker script and no
server at runtime. `bun run preview` serves that directory through `wrangler dev`.
Installation
content is generated from the canonical deployment guide. Other pages are in
`content/docs/`.

This is a private launch preparation. The domain, public release claims, and
indexing remain to be configured before publication; nothing is deployed. The current metadata asks
search engines not to index the site. The production Postdot image excludes this
site.
