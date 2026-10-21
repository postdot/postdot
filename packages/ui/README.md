# @postdot/ui

Shared Postdot UI primitives, design tokens, and Tailwind integration.

The package uses shadcn/ui component patterns on top of Base UI. It does not
depend on Radix UI and does not contain product-domain components, API clients,
or application routing.

## Usage

Import the shared stylesheet once from each Tailwind-powered application:

```tsx
import '@postdot/ui/globals.css'
```

Import components through their public subpaths so bundlers can keep the
dependency graph explicit:

```tsx
import { Button } from '@postdot/ui/components/button'
```

The package exposes `cn` from `@postdot/ui/lib/utils` for class composition.

Product brand assets live under `src/assets/brand`, with reusable inline marks
exported as shared components. Use `PostbotLogo` when the mark must inherit the
current text color across themes.

Each consuming application owns its Tailwind entrypoint and must declare its
own source roots with `@source`. The shared stylesheet declares only the UI
package source root, so adding another Postdot application does not require
changing this package.

New shadcn components belong here when they are genuinely reusable. Keep
application-specific composition in the consuming app and follow the package
`components.json` configuration when generating or adapting components.

## Product composition guardrails

Postdot's primitives are deliberately not a second product framework. Shared
components own accessible behavior, stable geometry, and semantic tokens;
pages own the operator's vocabulary, hierarchy, and progressive disclosure.

- Keep the first layer focused on the current task, required state, and next
  action. Put secondary options behind an explicit contextual action.
- Do not add explanatory prose to a primitive by default. Page-level copy is
  justified when it changes the next action, explains a state, or provides a
  recovery path.
- Controls must remain usable with keyboard input, long labels, English and
  French copy, and both themes. Truncation must not remove the complete
  accessible value.
- Errors, destructive consequences, capability limits, and recovery actions
  are never hidden merely to make a surface look simpler.
