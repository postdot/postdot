# Postdot public site

Keep this workspace statically prerendered (TanStack Start, `dist/client`, served
by Cloudflare Workers static assets). It has no Worker script, production Node
server, authentication, or access to the application database. Search uses the
prerendered Fumadocs index. Motion is optional presentation and respects reduced motion.

`content/docs/` is the canonical authored documentation source, including
`(self-hosting)/(deployment)/installation.mdx`. Do not maintain a parallel root
Markdown guide or overwrite authored installation content during synchronization.
`sync:content` generates only API/reference and supporting build assets. Run it
before developing, typechecking, or building. Proposals and dated execution
evidence belong to Autonomos; verify them against current code before writing
public instructions.

Editorial MDX lives in `content/blog/`, `content/compare/` and `content/features/`.
See DOCUMENTATION.md for their metadata, public evidence and static export contracts.

For local review of the actual static output, run `bun run build` then
`bun run preview` in this workspace. It runs `wrangler dev` on 127.0.0.1:5174 with
the production asset rules (trailing-slash redirects, `404.html`). It is a
development helper, not a deployment; do not run `wrangler deploy` without the
owner's approval.

The build must fail on prerender errors: the prerenderer logs `Error in render` and
still exits 0, so `scripts/build.ts` checks the log. A CommonJS dependency imported
by name is the usual cause; use its default import. `vite.config.ts` dedupes the
Fumadocs packages and React, otherwise links silently become full page loads (bun
installs several copies of `fumadocs-core`, and `tsconfig.json` pins one for types).
The site is live at postdot.app and indexable.
Analytics: anonymous audience (`/s.js`) always; session replay and heatmaps
(`/p.js`, `/r.js`) only after the reader allows them (`src/lib/consent.ts`,
panel with Accept all / Customize / Decline all, per-category switches defined in
`consentCategories`, a floating button and the footer reopen it); a change of choice
reloads the page. Do not use the words record or replay in the panel (the privacy
page explains them). Solar has no cookie icon (saoudi-h/solar-icons#631): icons Solar lacks come from
Iconify through `unplugin-icons` (`import Icon from '~icons/<set>/<name>'`, sets in
`@iconify-json/*` devDependencies, installed on demand in development). Names must
be static imports; scripts outside Vite read `@iconify-json/*` with `@iconify/utils`. Legal
pages (`/legal`, `/privacy`) read their facts from `src/lib/legal.ts`; keep the
privacy text in step with what the site collects. Feedback goes through the Worker in `worker/` to GitHub discussions (GitHub App
`postdot-docs`, secret `GITHUB_APP_PRIVATE_KEY` set with `wrangler secret put`
from a file, never pasted). Accessibility is checked with axe (`axe-core` in Playwright, both themes, desktop and
mobile) plus keyboard passes; site-owned violations are fixed. Known upstream
items left on purpose: unnamed language/server selects and a scrollable tab bar in
Fumadocs OpenAPI pages, duplicate banner/region landmarks in Fumadocs layouts. Do
not patch them with DOM scripts; fix upstream or replace the component.
Deploys run from `main` in CI. `www.postdot.app` is redirected by a Cloudflare
redirect rule on the zone (with a proxied placeholder DNS record), not by code;
manage zone settings with the `cf` CLI (`cf cli search "<task>"`). Do not deploy from a
stale checkout.

Read [PUBLIC-STYLE.md](PUBLIC-STYLE.md) for landing-page, section-heading, and capability-illustration rules, and [DOCUMENTATION.md](DOCUMENTATION.md) for Fumadocs folder structure, URL groups, and generated OpenAPI reference boundaries.
