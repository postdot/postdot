# UI Package Guidance

## Scope

`@herald/ui` is Herald's shared React UI package. It owns reusable design
tokens, the shared Tailwind stylesheet, Base UI-based shadcn components, and
small styling utilities such as `cn`.

It must not own product-domain state, API clients, route definitions, or
application-specific page composition.

## Component rules

- Use Base UI primitives and the repository's `base-nova` shadcn style.
- Do not add Radix UI dependencies or Radix-only APIs such as `asChild`.
- Use Base UI's `render` prop when a component needs a different element.
- Use `@solar-icons/react` version 2 with the `linear` icon set for shared icon
  examples and defaults.
- Keep Tailwind class candidates statically discoverable.
- Prefer direct public subpath imports such as
  `@herald/ui/components/button`.

## CSS and ownership

`src/styles/globals.css` is the source of truth for shared tokens and base
styles. A consuming app imports it from its own Tailwind entrypoint and declares
its own `@source` roots, including this package. Do not hardcode an app path in
the shared stylesheet.

Add a component here only when it is reusable across Herald surfaces or is part
of the shared visual language. Keep one-off product composition in the app.
