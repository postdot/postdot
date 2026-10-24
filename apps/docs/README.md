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

The site is public at https://postdot.app and indexable (`public/robots.txt`,
`/sitemap.xml`, canonical links). GitHub Actions deploys it from `main`
(`.github/workflows/docs-deploy.yml`).
Public release claims remain unapproved. The production Postdot image excludes
this site.
