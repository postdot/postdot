# DESIGN-98 — Progressive configuration surfaces

- Date: 2026-09-09
- Status: completed for the Access/provider configuration slice; DESIGN-98
  remains in progress
- Base: `ce1087cd` (`main`, after PR #157)
- Branch: `feat/design-98-progressive-configuration`

## Changes

- Kept the provider-application form open when the instance has no configured
  application, so the first useful action remains immediate.
- Replaced the always-visible form beside an existing provider-application list
  with a compact `New application` action. Editing an existing application
  opens the form again and canceling returns to the compact list state.
- Shortened the provider page introduction; security details remain beside the
  secret field and the instance scope remains visible in the page badge.
- Replaced the long first-visit project-access explanation with a native,
  keyboard-accessible disclosure. The full capability boundary remains
  available on demand, while the create-token action is immediately visible.
- Added English and French copy for the compact access summary.

## Verification

- Web format, lint, typecheck, i18n coverage, and tests passed locally.
- Existing browser and E2E coverage remains the required regression gate.

## Remaining DESIGN-98 work

- Compare compact empty-state alternatives on Overview and Queue.
- Continue checking progressive disclosure on other configuration surfaces
  without hiding recovery or security-critical information.
