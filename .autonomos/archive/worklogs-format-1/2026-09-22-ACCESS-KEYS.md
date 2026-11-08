# ACCESS — Complete the user-owned API-key cutover

## Objective

Align the access model with Postbot's product boundary: a key represents the
user who creates it, while its project selection can only narrow that user's
current project access. Project membership, groups, and invitations remain on
project/workspace access surfaces; API-key management remains in user
configuration.

## Change

- Removed project-bound API-key routes, models, actor storage, typed-client
  methods, web API helpers, dashboard route/components, and CLI management
  commands.
- Removed the remaining organization-referenced Better Auth API-key
  configuration. Better Auth's required default configuration now also points
  to the user-owned model.
- Kept the user-owned `/api/api-keys` contract as the only Postbot API-key
  surface. Bearer requests authenticate as the creating user and are filtered
  by the key's optional project scope before normal project-role checks.
- Kept API-key management session-only. A bearer key cannot create, list,
  update, or revoke keys.
- Updated API, client, CLI, and web regression coverage to use user-owned keys
  and to assert owner identity in audit records.
- Removed dead project-key translation messages and renamed the remaining
  user-key messages under the `api_keys_*` namespace.
- Updated the access ADR, task descriptions, and issue resolutions to record the
  intentional breaking cutover. No compatibility facade was retained because
  Postbot is private and has no deployed data contract to preserve.
- Marked the older project-machine-key decisions as superseded where needed and
  corrected current ADR/issue references so the repository describes one
  user-owned API-key model.

## Verification

- `bun run format`
- `bun run lint`
- `bun run typecheck`
- `bun run test:unit`
- `bun test apps/api/src/app.test.ts packages/client/src/index.test.ts scripts/postbot.test.ts`
- `bun run build`
- `bunx playwright test e2e/design-121-navigation-matrix.spec.ts --workers=1`

All checks passed. The browser matrix confirms that project configuration no
longer exposes API-key navigation and that API keys remain available from user
settings. The full unit suite passed with 17 packages and 7 script tests.
