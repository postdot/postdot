# AUDIT-125 follow-up — Correct concrete UX/UI findings

- Date: 2026-09-09
- Status: implementation ready for review; the broader independent UX audit
  remains open
- Base: `c3478bbd` (`origin/main`)
- Branch: `fix/audit-ux-followups`
- Scope: resolve the concrete P2/P3 findings from the independent post-sprint
  audit without starting another global visual rewrite.

## Corrections

- Project URLs that do not resolve now remain explicit and explain that the
  project is unavailable. The recovery link opens a real project selector
  instead of silently changing context or leaving a blank dashboard.
- The Queue filter strip suppresses the unintended desktop vertical overflow
  affordance while retaining horizontal overflow behavior.
- Collapsed channel navigation exposes the channel name, provider, and
  connection state through its tooltip.
- Empty calendar days now provide a subtle hover/focus affordance for creating
  a publication.
- Composer destinations expose connection state and link to channel management
  when an automatic destination needs a connection or reconnection.
- Media and channel empty-state copy no longer reports a misleading selected
  count or adds duplicate punctuation.

## Verification

- `bun run check` — passed formatting, lint, workspace typechecks, i18n
  coverage (750/750 in English and French), unit tests, Playwright E2E, and
  production builds.
- `git diff --check` — passed.
- The invalid-project browser regression verifies that the URL remains
  project-specific until the user deliberately returns to the project
  selector.

## Remaining scope

This follow-up does not close `AUDIT-125`, `WEB-119`, `WEB-122`, `DESIGN-120`,
`DESIGN-121`, or `WEB-124`. Populated multi-channel, failed/ambiguous,
media-upload, and narrow-mobile visual validation, as well as the larger
progressive-disclosure and copy-density work, still require a dedicated pass.
