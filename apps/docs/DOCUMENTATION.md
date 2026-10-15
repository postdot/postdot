# Documentation structure

Status: Notebook layout accepted by the owner on 2026-10-15. Content organization
and editorial examples remain open to refinement.

## Navigation

Four root folders produce native Fumadocs layout tabs. Notebook with top navigation
keeps the areas visible; its compact sidebar holds each area's local hierarchy.
This uses the installed Base UI distribution, not a parallel custom navigation.

| Space         | Reader's job                    | Current groups                     |
| ------------- | ------------------------------- | ---------------------------------- |
| Guides        | Use the product                 | Getting started, Studio            |
| Self-hosting  | Install and operate an instance | Deployment, Operations             |
| Development   | Integrate or contribute         | Clients & integrations, Codebase   |
| API reference | Look up HTTP contracts          | Schema entry point, authentication |

Parenthesized content folders organize the tree without changing existing URLs.
For example `(guides)/(studio)/media.mdx` still serves `/docs/media/`. Each area is
marked `root: true`; `pagesIndex` identifies overviews whose filename is not index.
Do not create two index files that resolve to the same public URL.

Future guides should be added where the reader would look for them, not as another
root item. Split providers into their own folder once individual setup guides are
written. Keep human workflows in Guides, client usage in Development and HTTP
method/schema lookup in API reference. A package inventory is not a promise of
public package distribution.

## Content boundaries

- `docs/deployment/self-hosting.md` remains canonical for installation. The sync
  script writes its MDX projection into the deployment folder; edit the source.
- Operational guides describe supported behavior. Put proposed deployment targets
  and future clients in planning records, not empty public navigation entries.
- No empty Kubernetes, Helm, mobile or MCP guide is added just to fill a category.
- Avoid copying a workflow into multiple areas. Explain it once and link to it.

## Writing and presentation guidance

Use the project [Postbot writing skill](../../.agents/skills/postbot-writing/SKILL.md)
for authored documentation. It coordinates `documentation-writer` and `stop-slop`
and owns the evolving editorial preferences. Its small reference comparison records
observations and open questions; it does not turn AI drafts into accepted style.

Use [Postbot Fumadocs](../../.agents/skills/postbot-fumadocs/SKILL.md) for documentation
mechanics. This document remains the technical source of truth; skills point here
rather than copying the generation/navigation manual. Owner feedback should update
the narrowest relevant guidance, replacing outdated rules instead of accumulating
contradictory instructions.

## Layout and theme evaluation

The installed version includes Docs, Notebook, Flux, Glass and Spacious layouts.
Notebook is the accepted layout because visible top-level spaces and a local
sidebar fit several documentation audiences. Default Docs is useful for a single
continuous manual; its dropdown makes the area change less prominent. Spacious
prioritizes breathing room; Flux removes more navigation chrome; Glass adds a
floating translucent treatment. Neither minimal navigation nor decorative glass
solves this project's immediate information-architecture problem.

Color themes and layout are separate choices. Keep the existing neutral preset
and Postbot's accepted font, surfaces and blue links; changing to an unrelated
stock palette would break continuity without improving navigation. Review actual
pages before changing a layout or palette again.

## Generated OpenAPI reference

SITE-456 implements the official `fumadocs-openapi` integration (12.4.2) alongside
Fumadocs/Base UI 16.17.1. `bun run sync:content` now runs this sequence:

1. Project canonical installation Markdown into its grouped MDX location.
2. Run `apps/api/src/openapi-export.ts` through Bun. It assembles `createApp` with
   an in-memory migrated database and a temporary local media adapter. It never
   imports `src/index.ts`, starts a listener, starts workers or reads instance
   credentials. Temporary files and the database are closed after extraction.
3. Validate unique operation IDs and tags, and export `.openapi/postbot.json`.
   No deployment URL is embedded. A route without a declared response receives
   an explicit unspecified-response description rather than an invented schema.
4. Split the schema into one-operation local fragments. Each retains its inherited
   security and only the relevant path; this prevents preloading the entire API
   into every page. Reference-only fragments use `https://postbot.example` as a
   replaceable sample origin. The downloadable schema has no deployment origin.
5. Generate MDX operation pages grouped by tag below `reference/(generated)`.
   The source loader adds the official method badges. Metadata is written once
   per folder: enabling Fumadocs `meta: true` with many schema inputs produces
   duplicate metadata paths and concurrent writes. Generation rejects duplicate
   page paths and verifies operation/page coverage.
6. Build the normal static Next export. Schema fragments are preloaded at build
   time, so rendering the exported site never fetches a running API.

Generated files and the downloadable schema are ignored, reproducible artifacts.
Do not edit them. Change route definitions, annotations or generation logic.
`sync:openapi` can regenerate just the reference. Cleanup removes only the dedicated
generated directory, never authored introductions or the active instance's data.

The client page uses the official renderer with request playgrounds disabled.
Readers can inspect schemas and copy examples without entering credentials or
sending requests. No proxy or OAuth handler is installed on the static site.

The isolated export test checks repeatability, zero fetch calls, representative
route coverage and the difference between public, session-only and inherited
bearer/session security. It does not prove every API handler works, nor claim a
complete Better Auth or optional metrics reference. The API integration tests
remain responsible for request behavior. Future schema work should improve actual
route annotations and examples rather than hand-editing generated MDX.

## Static link gate

`bun run build` finishes with `check:links`. The checker parses exported HTML with
Bun's HTMLRewriter, resolves local links against their page, and verifies target
files, HTML fragment IDs and downloadable assets. It never calls a server or
checks third-party URLs. Encoded fragments and relative page links are supported.
Run `bun run check:links` to inspect an existing export. The focused utility test
uses temporary files and exercises missing-page and missing-anchor failures.

This gate covers actual exported links, not product behavior or the truth of
provider instructions. A successful run is not a live-provider acceptance result.

## Sources checked

- https://www.fumadocs.dev/docs/headless/page-conventions
- https://www.fumadocs.dev/docs/ui/layouts
- https://www.fumadocs.dev/docs/ui/layouts/notebook
- https://www.fumadocs.dev/docs/integrations/openapi
- https://www.fumadocs.dev/docs/integrations/openapi/generate-files

Checked against installed fumadocs-core 16.17.1, the aliased @fumadocs/base-ui
16.17.1 distribution and fumadocs-mdx 15.4.7 on 2026-10-15. Online examples may
advance ahead of these pinned versions; local type declarations decide API use.
