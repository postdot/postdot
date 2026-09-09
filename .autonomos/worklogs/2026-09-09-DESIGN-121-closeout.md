# DESIGN-121 — Authenticated shell closeout

- Date: 2026-09-09
- Status: completed
- Base: `17a006f4` (`main`, after PR #170)
- Scope: close the authenticated shell, instance/project navigation, reduced
  sidebar, and responsive accessibility task after the bounded implementation
  and validation slices.

## Evidence

- Instance settings expose their own navigation context and no longer render
  project Work or Project navigation. Returning to a project restores the
  project navigation context.
- Reduced desktop navigation remains reachable through accessible labels and
  tooltips; the mobile drawer preserves route access and a localized close
  action.
- Narrow Compose and Queue remain usable with long channel names at 390px and
  768px without horizontal overflow.
- Queue filters keep overflow on the horizontal axis only at desktop, tablet,
  and mobile widths.
- Access and provider-application first visits use compact states while
  retaining security, instance scope, and OAuth context.

## Validation

- `bunx playwright test e2e/design-121-instance-scope.spec.ts`
- Existing DESIGN-121 shell, narrow-layout, queue-filter, and publication
  journeys remain in the repository gate.
- Full repository gate and CI passed on PR #170.
- English and French catalogs remain at 100% coverage.

## Boundary

This closes the bounded shell and responsive accessibility sprint. It does not
freeze Herald's visual identity or prevent future evidence-driven work under
`ISSUE-063`, `ISSUE-064`, and `ISSUE-065`.
