# ACCESS-138 — React Email package and Mailpit development relay

- Status: complete
- Date: 2026-09-11
- Scope: transactional email templates, local SMTP development, and API integration
- Decision: [ADR-067](../decisions/ADR-067-react-email-mailpit-development.md)

## Objective

Give Herald a maintainable, visually previewable home for invitation, account
verification, and password-reset emails, and make the local SMTP path observable
without using a real mailbox.

## Implementation

- Added the private `@herald/email` workspace package with React Email templates,
  shared layout/styles, typed HTML/text renderers, and package-local tests.
- Moved template rendering out of the API email transport; the API now maps
  Better Auth callback data to the package and retains Nodemailer ownership.
- Added the development-only `docker-compose.dev.yml` Mailpit service on loopback
  SMTP `1025` and web UI `8025`.
- Added package preview, Docker/SMTP setup documentation, workspace registration,
  and the production Dockerfile package manifest entry.
- Aligned the root TypeScript configuration with the browser DOM APIs exercised
  by the Playwright shell and layout assertions.

## Verification

- `@herald/email`: typecheck, lint, format, unit tests, build, import smoke test,
  and preview startup on port `3001`.
- `apps/api`: typecheck, lint, format, delivery tests, and production build.
- `docker compose config`, plus an isolated alternate-port Mailpit startup,
  `/livez` check, process listing, and cleanup.
- End-to-end SMTP submission to the existing local Mailpit relay, with the
  captured verification message found through the Mailpit API.
- Repository `bun run check`: 17 package format/lint/typecheck/build tasks, 151
  unit tests, and 15 Playwright E2E tests passed.
