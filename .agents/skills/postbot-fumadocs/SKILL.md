---
name: postbot-fumadocs
description: Implement or review Postbot's Fumadocs navigation, MDX components, layouts, search and generated OpenAPI reference. Use for documentation mechanics, not prose-only edits or the marketing homepage.
---

# Postbot Fumadocs

Read [apps/docs/DOCUMENTATION.md](../../../apps/docs/DOCUMENTATION.md) and the
nearest AGENT.md before editing. That document owns this project's technical
choices and generation pipeline; do not duplicate its manual here.

## Work against the installed version

Inspect `apps/docs/package.json`, installed exports and type declarations for the
API you will use. Check current official documentation when needed, then reconcile
it with the pinned version. Fumadocs evolves quickly: an online example is not proof
that an older installed API supports it. Keep the Base UI distribution; do not
introduce Radix patterns or the default theme provider over the existing provider.

Notebook and its top-level spaces are accepted. Color themes and layout are
independent; preserve Postbot's typography and palette. Use native root folders,
metadata and grouped folders rather than rebuilding navigation. Check URL effects
before moving a page; parenthesized groups preserve child slugs.

## Use components for a reader's need

Inspect the installed component API before adding callouts, steps, tabs, cards or
API widgets. Prefer native components over custom approximations. Choose a widget
because it helps the task, not because it is available. Keep the reading order
usable on mobile and without discovering an optional interaction. Use
[postbot-writing](../postbot-writing/SKILL.md) for content decisions.

### Component selection

See [the installed component guide](references/mdx-components.md) for verified
exports and authoring choices. A component shown on Fumadocs' own site may be
custom; confirm availability and registration before using its MDX name.

## Preserve generated-content boundaries

Installation MDX is projected from canonical operational Markdown. API operation
pages, schema fragments and downloads come from the isolated route exporter.
Edit their source, not the generated files. Keep the docs statically exportable,
with no live API/database dependency. The public API playground remains disabled.
Read the pipeline notes before changing generation, metadata, preload or cleanup.

For affected content/navigation, run the docs build and its exported-link gate.
Check the affected browser scenario when interaction/layout changed. Use checks
proportionate to the change; do not run the application's full test matrix for
prose or metadata. Pure skill edits need validation of the skill and its references,
not a website build. Add a new trick here only after it solves an observed problem.

Official entry points: [layouts](https://www.fumadocs.dev/docs/ui/layouts),
[page conventions](https://www.fumadocs.dev/docs/headless/page-conventions),
[components](https://www.fumadocs.dev/docs/ui/components),
[OpenAPI](https://www.fumadocs.dev/docs/integrations/openapi).
