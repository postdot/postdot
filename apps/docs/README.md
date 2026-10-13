# Postbot site

Local Next.js + Fumadocs site, with a static export and Motion interactions.

```sh
bun run --cwd apps/docs dev
bun run --cwd apps/docs build
```

Development uses port 5174. The exported `out/` directory can be hosted as static
files, including the search index; no Next.js server is required. Installation
content is generated from the canonical deployment guide. Other pages are in
`content/docs/`.

This is a private launch preparation. Hosting, domain, public release claims, and
indexing remain to be configured before publication. The current metadata asks
search engines not to index the site. The production Postbot image excludes this
site.
