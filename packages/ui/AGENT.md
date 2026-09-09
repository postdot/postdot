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
- Use `@solar-icons/react` version 2 with the `bold` icon set for shared icon
  examples and defaults.
- Keep Tailwind class candidates statically discoverable.
- Prefer direct public subpath imports such as
  `@herald/ui/components/button`.
- Keep product brand source assets under `src/assets/brand` and use the shared
  inline brand components when a mark must inherit `currentColor`.

## CSS and ownership

`src/styles/globals.css` is the source of truth for shared tokens and base
styles. A consuming app imports it from its own Tailwind entrypoint and declares
its own `@source` roots, including this package. Do not hardcode an app path in
the shared stylesheet.

Add a component here only when it is reusable across Herald surfaces or is part
of the shared visual language. Keep one-off product composition in the app.

## Herald composition guardrails

- Shared primitives provide behavior and geometry; consuming pages provide
  product meaning, labels, and task-specific composition.
- Do not add helper paragraphs or tutorial copy to a primitive by default. Add
  copy at the page boundary only when it changes the operator's next action,
  explains a state, or provides recovery guidance.
- Every reusable control must retain a visible or programmatic name, keyboard
  focus and activation, dark/light semantic roles, and locale-safe labels.
- Long labels must have an intentional wrap, scroll, or truncation behavior.
  Use `min-w-0` in flex children where appropriate, and keep the complete
  accessible value even when the visual label is truncated.
- Prefer a deliberate disclosure action for secondary options over rendering
  every provider detail or override in the initial layer. Never hide an error,
  destructive consequence, recovery path, or capability limitation.

## Motion

- Keep essential state understandable without animation.
- Prefer CSS transitions for local feedback and animate only color, opacity,
  shadow, border, or small transforms. Never use `transition-all`.
- Avoid decorative infinite motion, scroll hijacking, parallax, and large-area
  scaling or panning.
- Honor `prefers-reduced-motion: reduce`; the shared stylesheet provides a
  fallback, and imperative animations must check the preference themselves.
- Do not add GSAP or another animation runtime without a concrete interaction,
  bundle measurement, reduced-motion behavior, and an accepted decision record.
