# ADR-023: Establish a Shared UI Package

- Status: Accepted
- Date: 2026-08-31

## Context

Postbot currently has Tailwind tokens, the global stylesheet, and the first
shadcn/Base UI primitive inside `apps/web`. A future website and documentation
surface should reuse the same visual language, while application-specific
composition must remain independent from shared primitives. Tailwind CSS v4
also requires consuming applications to make source roots explicit when shared
components live outside the application source tree.

## Decision

Create the private workspace package `@postbot/ui` under `packages/ui`.

The package owns:

- shared design tokens and base styles;
- the shared Tailwind stylesheet entrypoint;
- reusable shadcn components implemented with Base UI;
- the `cn` class-composition utility;
- the Solar Icons v2 Linear convention for shared component examples.

Each consuming application owns its Tailwind compiler entrypoint and declares
its application and shared-package source roots with `@source`. The shared
stylesheet must not contain paths to a particular application. Product-domain
components, route composition, data fetching, and API clients remain in the
consuming application or their relevant domain package.

The web application imports shared components through `@postbot/ui` public
subpaths and imports the shared stylesheet once from its local Tailwind entry
point. The first migration moves the existing Button primitive and class
utility into the package without changing their public behavior.

## Alternatives considered

1. Keep the components and tokens in `apps/web`: this avoids a workspace
   dependency now but makes the future website extraction and visual
   consistency harder.
2. Create a separate generic Tailwind package and leave components in the app:
   this splits ownership of the design system and creates a second boundary to
   coordinate.
3. Build a fully generic publishable component library immediately: this adds
   packaging and compatibility constraints before Postbot has more than one
   consuming surface.

## Consequences

- Shared UI code has a durable ownership boundary and can be consumed by future
  Postbot applications.
- Tailwind source discovery is explicit and remains local to each consumer.
- The workspace gains a small React package and a package-local component test
  gate.
- Generic UI remains separate from product behavior; components are still
  allowed to be intentionally Postbot-specific rather than prematurely
  general-purpose.
