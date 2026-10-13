# Tala Tools TypeScript Preset Update

## What Was Done

- Updated every workspace and root development dependency from
  `@tala-tools/tsconfig@0.0.2` to `@tala-tools/tsconfig@0.1.0`.
- Replaced all removed `bun.json` references with the published Bun-specific
  presets.
- Applied `bun-base.json` to the root scripts, API, authentication, core, and
  database configurations.
- Applied `bun-react-library.json` to the Bun-powered React web application.
- Kept `bun-next.json` unused because Postbot is a Vite SPA and has no Next.js
  application.

## Key Decision and Why

The new presets are the narrowest matches for the current runtime surfaces:
server-side Bun code gets Bun module and type settings without browser libraries,
while the React client keeps DOM and JSX support through the Bun React preset. No
custom local preset or compatibility alias was introduced.

This is a configuration maintenance change, not an architectural decision. No ADR
or `AGENT.md` update is needed.

## Validation

- `bun install --frozen-lockfile` passed.
- `bun run check` passed: formatting, warning-free lint, strict typechecking, 48
  tests, and all production builds.
- `bun pm ls @tala-tools/tsconfig` resolves `0.1.0`.
- Repository search found no remaining `bun.json` reference.

## Files Modified

- `package.json`
- `bun.lock`
- `tsconfig.json`
- `apps/api/package.json`
- `apps/api/tsconfig.json`
- `apps/web/package.json`
- `apps/web/tsconfig.json`
- `packages/auth/package.json`
- `packages/auth/tsconfig.json`
- `packages/core/package.json`
- `packages/core/tsconfig.json`
- `packages/db/package.json`
- `packages/db/tsconfig.json`
- `.autonomos/worklogs/2026-08-28-TSCONFIG-UPDATE.md`

## Next Steps

Continue with `MANUAL-08`. The next dependency/configuration changes should use the
same workspace-level preset mapping unless a new runtime surface is introduced.
