# ACCESS-KEYS-E2E

## Objective

Verify the user-owned API-key flow through the browser after removing project-bound and organization-bound key surfaces.

## Changes

- Added a Playwright scenario for the optional key name and readable generated names.
- Verified the default all-project scope with the radio control.
- Verified the selected-project scope with the multi-select combobox.
- Kept the test on the user configuration surface reached through the account menu.

## Verification

- `bunx playwright test e2e/access-137-user-api-keys.spec.ts --workers=1`
- `bun run test:e2e` (29 tests)

## Result

The browser contract now covers the key creation choices that are easy to regress while reorganizing access and configuration navigation.
