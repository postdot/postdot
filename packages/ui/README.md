# @herald/ui

Shared Herald UI primitives, design tokens, and Tailwind integration.

The package uses shadcn/ui component patterns on top of Base UI. It does not
depend on Radix UI and does not contain product-domain components, API clients,
or application routing.

## Usage

Import the shared stylesheet once from each Tailwind-powered application:

```tsx
import '@herald/ui/globals.css'
```

Import components through their public subpaths so bundlers can keep the
dependency graph explicit:

```tsx
import { Button } from '@herald/ui/components/button'
```

The package exposes `cn` from `@herald/ui/lib/utils` for class composition.

Product brand assets live under `src/assets/brand`, with reusable inline marks
exported as shared components. Use `HeraldLogo` when the mark must inherit the
current text color across themes.

Each consuming application owns its Tailwind entrypoint and must declare its
own source roots with `@source`. The shared stylesheet declares only the UI
package source root, so adding another Herald application does not require
changing this package.

New shadcn components belong here when they are genuinely reusable. Keep
application-specific composition in the consuming app and follow the package
`components.json` configuration when generating or adapting components.
