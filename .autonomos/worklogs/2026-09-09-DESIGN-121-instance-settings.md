# DESIGN-121 — Make instance settings scope explicit

- Date: 2026-09-09
- Status: completed for the instance-settings slice; DESIGN-121 remains in progress
- Base: `cdaf9d65` (`main`, after PR #156)
- Branch: `feat/design-121-instance-settings-scope`
- Scope: clarify the global provider-application route without beginning the
  broader shell, responsive, or empty-state redesign.

## Changes

- Added an explicit `Instance settings` context to the authenticated header
  when the current route is global settings.
- Added an `Instance` navigation group for global settings and removed the
  project Work, Project, and Channels groups from that route only.
- Removed project publication counters from the global settings footer, where
  they had no useful project context; sign-out remains available.
- Added the same scope as a compact badge on the provider-application page.
- Kept the project selector available so the user can switch workspace context,
  while provider applications remain instance-owned and are never presented as
  project-owned.
- Added English and French catalog entries for the instance scope and its
  accessible navigation label.

## Verification

- Web format, lint, typecheck, i18n coverage, and unit tests passed.
- i18n coverage: 777/777 messages in English and French.
- Browser verification on the authenticated local app:
  - global settings shows `Réglages de l’instance` and only the `Instance`
    navigation group;
  - project overview still shows Work, Project, Channels, counters, and the
    project breadcrumb.

## Remaining DESIGN-121 work

- Reduced-sidebar and narrow-viewport accessibility remain to be reviewed.
- The broader Access/provider first-visit density pass and empty-state
  comparison remain separate follow-up work described by AUDIT-125.
