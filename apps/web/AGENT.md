# AGENT: apps/web

- **Stack:** React 19, Vite, TanStack Router, Tailwind CSS, shadcn/ui `base-nova`, Base UI, Recursive Variable, Solar Icons React v2 Linear, TypeScript
- **Conventions:** Use TanStack Router file-based routes under `src/routes/`; the Vite plugin owns `src/routeTree.gen.ts`.
- **Conventions:** Add shared shadcn components through `packages/ui/components.json`; use Base UI's `render` prop rather than Radix's `asChild`; import icons from `@solar-icons/react/linear/<icon>`.
- **UI boundary:** Use shared primitives from `@herald/ui` and keep page composition and product-specific components in this app. `src/styles.css` is the app's Tailwind entrypoint and source-registration layer; shared tokens and base styles live in `@herald/ui`.
- **Development integration:** Browser requests remain same-origin; Vite proxies `/api` and `/oauth` to `HERALD_API_ORIGIN`, defaulting to `http://localhost:3000`. Keep alternate local API ports in the ignored `apps/web/.env` file. When using a temporary HTTPS tunnel, set `HERALD_VITE_ALLOWED_HOST` to that tunnel's hostname instead of disabling Vite host checks globally.
- **Preview icons:** Platform post simulations may use destination-specific SVG glyphs instead of Solar when fidelity requires it; retain source attribution and licenses for copied assets. Application controls continue to use Solar.
- **Motion:** Follow [ADR-024](../../.autonomos/decisions/ADR-024-adopt-a-native-first-motion-policy.md); prefer targeted native CSS transitions, never use `transition-all`, and keep state understandable with reduced motion enabled.
- **Constraints:** Keep this app client-first and browser-focused. Do not introduce a second server architecture, use Radix UI primitives, or use React hooks inside TanStack Router loaders or guards.

- **Configuration context:** Personal settings and installation administration retain the current page when the workspace selector changes; record the workspace in search parameters and clear the previous project with `projectId=none`. Header context does not grant permissions or turn person-owned settings into workspace-owned state. Keep operational project selection consistent with the established project-navigation contract.
- **Browser gate stability:** Freeze files under this app during isolated Vite browser tests. Even an AGENT.md update can reload the active page and legitimately reopen draft recovery, invalidating an in-progress authoring scenario.

- **Settings return controls:** When a settings page gains its own AccessPageHeader return, update DashboardShell hasPageBack for that destination. The shell must not render a second return beside the workspace/project selectors. Keep the navigation continuity test asserting one unambiguous return.

- **Vite runtime:** Launch development and production web builds explicitly with `bun run --bun vite --configLoader native`. The bundled configuration loader in Vite 8.3.1 currently fails under Bun 1.4.2; native loading uses Bun's TypeScript support and preserves the established plugins. Do not add Node to the production image to work around this.
