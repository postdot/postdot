# AGENT: apps/web

- **Stack:** React 19, Vite, TanStack Router, Tailwind CSS, shadcn/ui `base-nova`, Base UI, Solar Icons React v2 Linear, TypeScript
- **Conventions:** Use TanStack Router file-based routes under `src/routes/`; the Vite plugin owns `src/routeTree.gen.ts`.
- **Conventions:** Add shadcn components through the Vite app's `components.json`; use Base UI's `render` prop rather than Radix's `asChild`; import icons from `@solar-icons/react/linear/<icon>`.
- **Constraints:** Keep this app client-first and browser-focused. Do not introduce a second server architecture, use Radix UI primitives, or use React hooks inside TanStack Router loaders or guards.
