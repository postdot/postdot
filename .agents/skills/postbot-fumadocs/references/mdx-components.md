# MDX component selection

Checked against the installed Base UI distribution 16.17.1 for SITE-463.
Recheck exports when upgrading. The official quick-start excerpt supplied by the
owner demonstrates possibilities, not a requirement to reproduce its density.

## Available through the current page mapping

`apps/docs/src/app/docs/[[...slug]]/page.tsx` spreads `fumadocs-ui/mdx`.
Its default exports already include:

- `Callout`, plus its container, title and description primitives.
- `Cards` and `Card` for meaningful navigation choices.
- Code block tabs and enhanced standard Markdown elements.

`Callout` accepts a title, children, a semantic type (info, warn, error, success,
warning or idea) and an icon. Use `icon={false}` for a labelled example without
an information/warning symbol. `null` triggers the default icon in this version
because the implementation uses a nullish fallback; `false` suppresses it. An example request is not a warning. Reserve warn
for a consequence the reader should notice, such as checking for an existing
saved draft before retrying a failed request.

## Native components requiring an import or registration

These modules exist in the installed distribution. Steps/Step are now registered
in our page mapping; the other modules still need an import or registration.
Inspect their declarations before use:

| Module | Use |
| --- | --- |
| `fumadocs-ui/components/steps` | A required sequence; registered globally as Steps/Step; preserve linked heading anchors |
| `fumadocs-ui/components/tabs` | Real alternatives, such as deployment environments |
| `fumadocs-ui/components/accordion` | Optional troubleshooting, never hidden prerequisites |
| `fumadocs-ui/components/files` | A file tree that helps locate an actual file |
| `fumadocs-ui/components/type-table` | Structured authored type reference when generated OpenAPI does not cover it |

The quick-start's `AgentInstructions` is not a standard component supplied by our
MDX mapping. Do not copy an unknown tag and assume it will render.

## Authoring discipline

Use blockquotes for quotations, not as a universal substitute for notes and
examples. Code fences describe code or terminal input; prose prompts remain prose.
Prefer a small number of useful components to a page full of competing boxes.
Do not put every paragraph into a callout or hide consecutive required steps
behind tabs. Preserve mobile reading order and keyboard access.

Build the export and check the affected page in the browser after changing its
presentation. Native availability does not establish a new palette or layout.

The first-publication lesson uses Steps/Step with explicit heading IDs. Let the
component number the sequence instead of repeating numbers in visible headings.
Keep subheadings inside their step and leave further-reading links outside Steps.
