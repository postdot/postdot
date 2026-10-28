---
name: postdot-experience-review
description: Audit Postdot's authenticated web application against the accepted experience standard (SPEC-010) and report findings that cite rule identifiers with evidence.
metadata:
    short-description: Review journeys, navigation, width and wayfinding
---

# Postdot experience review

Use this skill when asked to review how Postdot feels to move through: first use,
menu hierarchy, scope changes, page width, wayfinding, or coherence between
routes. It complements `postdot-operational-ux` (calendar and copy density) and
`DESIGN.md` (visual foundations); it does not decide product meaning.

## Authority

- Read `.autonomos/specs/SPEC-010-web-experience-standard.md` first. Cite only
  its rule identifiers. A rule marked `candidate` is recorded as an observation,
  not a defect. An observation that fits no rule becomes a proposed rule for the
  owner, never a defect.
- Read `e2e/experience/route-registry.ts`. A page that disagrees with its
  declaration is a finding against the matching LAY or NAV rule; a registry
  entry changes only by owner decision.
- Report evidence, not taste. Separate what was rendered from what was inferred
  from source, and state any viewport, theme, locale or data state that was not
  examined.
- Object details keep their declared parent as the active navigation destination;
  their title still names the object. Use the registry's `parent` and the route
  contract in `DESIGN.md` when reviewing that relationship.

## Procedure

1. Collect evidence. Run the collector from the repository root:
   `POSTDOT_EXPERIENCE_AUDIT=true bunx playwright test e2e/experience/experience-audit.spec.ts`.
   It creates isolated English/dark empty and French/light populated cases, then
   records captures and `observations.json` in scenario folders under
   `test-results/experience-audit/` at 1440 and 390 px, plus first-use and scope
   transitions. Object routes without a seeded object are recorded as omitted;
   do not turn an omission into a successful review. The folder is untracked;
   keep conclusions, not captures, in the worklog.
2. Look at the captures. Do not rely on the measurements alone: they are coarse
   (block widths, selector text, shell groups, active item, icon colours).
3. Extend the data when the question needs it. The populated baseline includes
   manual drafts, scheduled work and sharing; it does not cover every lifecycle
   or role. For post/publication details, run
   `POSTDOT_EXPERIENCE_AUDIT=true bunx playwright test e2e/experience/detail-journeys.spec.ts`.
   That focused pass covers wide/tablet/mobile layouts, retained publication
   history, error returns and sibling destinations beyond the first result page.
   Distinguish real fixtures from synthetic failed-provider presentation.
4. Walk each rule family in order (JRN, NAV, LAY, WAY, COH). For each failed rule
   record route, viewport, rule identifier, observation and evidence.
5. Rank by the effect on a first-time operator: blocked or misled first, then
   lost context, then inconsistency, then polish.
6. Report in the task worklog. Open no repair task and change no code unless the
   owner accepted the rule and asked for the repair; a repair is its own task.

## What this review does not cover

Real-device touch, screen-reader behaviour, provider outcomes, and anything the
collector did not render. Do not claim them.
