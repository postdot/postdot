# Documentation structure

Status: initial organization for owner review, not a finished content plan.

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

## Initial editorial guardrails

These are a starting floor for later tone review, not an assertion that the voice
is finished. Use direct English, concrete tasks and product labels. Start a how-to
with its outcome and prerequisites, then steps, expected result and relevant
failure recovery. References describe contracts; explanations describe reasoning.
Do not force every page into the same outline.

No generic introductions about a changing digital world, claims of seamlessness,
unearned performance guarantees, repeated conclusions, rhetorical questions,
marketing filler or section eyebrows. Avoid exhaustive caveat paragraphs on every
step: place an important boundary at the action it affects. Examples must match
implemented fields and commands. State planned capabilities explicitly. Never
present a local code check as a successful real-provider experiment.

## Layout and theme evaluation

The installed version includes Docs, Notebook, Flux, Glass and Spacious layouts.
Notebook is the current candidate because visible top-level spaces and a local
sidebar fit several documentation audiences. Default Docs is useful for a single
continuous manual; its dropdown makes the area change less prominent. Spacious
prioritizes breathing room; Flux removes more navigation chrome; Glass adds a
floating translucent treatment. Neither minimal navigation nor decorative glass
solves this project's immediate information-architecture problem.

Color themes and layout are separate choices. Keep the existing neutral preset
and Postbot's accepted font, surfaces and blue links; changing to an unrelated
stock palette would break continuity without improving navigation. Review actual
pages before changing a layout or palette again.

## OpenAPI integration plan

The API already registers `@elysiajs/openapi`, exposing `/openapi/json` and an
instance explorer at `/openapi`. The new reference area links readers to those
existing resources. It is not yet a generated endpoint reference.

Next implementation should:

1. Export a reproducible schema from an isolated runtime matching the source
   revision. Do not import a production server entry point that starts workers or
   opens the shared database merely to build docs.
2. Validate stable operation IDs, tags, auth annotations, request/response schemas
   and examples. Session-only and API-key operations must remain distinguishable.
3. Add the official `fumadocs-openapi` integration after checking compatibility
   with the pinned Fumadocs/Base UI versions. Use a local schema artifact as input
   to `createOpenAPI`; generate grouped operation pages with `generateFiles`.
4. Keep generated pages beneath the API reference root, separate from authored
   introductions. Register its page component and CSS using the installed API,
   not examples from older Fumadocs major versions.
5. Verify a static export with the application stopped. The docs site must not
   fetch a running API to render, require private credentials or proxy requests.
   An interactive playground needs an explicit instance target; do not prefill
   production hosts or credentials or imply that a docs visit can publish safely.

No OpenAPI dependency or build-time API coupling is introduced by this structure
pass. No custom renderer or hand-maintained duplicate endpoint schema is needed.

## Sources checked

- https://www.fumadocs.dev/docs/headless/page-conventions
- https://www.fumadocs.dev/docs/ui/layouts
- https://www.fumadocs.dev/docs/ui/layouts/notebook
- https://www.fumadocs.dev/docs/integrations/openapi
- https://www.fumadocs.dev/docs/integrations/openapi/generate-files

Checked against installed fumadocs-core 16.17.1, the aliased @fumadocs/base-ui
16.17.1 distribution and fumadocs-mdx 15.4.7 on 2026-10-15. Online examples may
advance ahead of these pinned versions; local type declarations decide API use.
