# SPEC-010 — Web experience standard

- Status: draft
- Scope: authenticated web application journeys, navigation hierarchy, scope transitions, page width classes, wayfinding and cross-route coherence
- Provenance: owner review after alpha.3 (2026-10-28); COMM-016 review by the communications agent; baseline audit in [UX-389 worklog](../worklogs/2026-10-28-UX-389.md)
- Related issue: ISSUE-192
- Related task: UX-389
- Related specifications: SPEC-006, SPEC-007 (accepted; this standard does not amend them)
- Related contracts: `DESIGN.md` (visual foundations), `postdot-operational-ux` (calendar interaction and copy), `postdot-experience-review` (audit procedure)

## Intent

`DESIGN.md` decides how Postdot looks and what each route is for. This standard decides whether a person who has not read either can move through the application without guessing. Every rule is observable: a reviewer, human or agent, can state pass or fail from the rendered application or from the route registry without asking the owner what was meant.

## How to use the rules

- A finding cites a rule identifier, the route and viewport, and evidence (capture or measurement). A finding without a rule is a candidate for a new rule, not a defect.
- Only `accepted` rules are normative. Rules marked `candidate` need an owner decision before any finding can cite them as a defect; reviewers still record the observation.
- Verification is one of: **registry** (checked against `e2e/experience/route-registry.ts`), **measure** (deterministic browser measurement, can be automated), **review** (rendered inspection against the stated test). Rules whose verification is `review` must not be turned into brittle assertions.
- A rule changes only by owner decision. Evidence from the audit may propose a change; it does not make one.

## Vocabulary

- **Scope**: what a page acts on — `project`, `workspace`, `personal` or `installation`.
- **Shell**: the navigation frame — `product` (project navigation) or `settings` (configuration navigation).
- **Width class**: `work-surface` (uses the available width), `reading-column` (compact centred column for configuration) or `directory` (peer objects listed for choosing).
- **Prerequisite**: a thing an action needs that does not yet exist (for example a channel before a publication has a destination).

## Rules

### Journey and prerequisites (JRN)

- **JRN-01 — An offered action is possible, or says what it needs.** A primary action shown while a prerequisite is missing either completes or names the missing prerequisite on the same surface. Test: from an empty project, activate each primary action; the next screen must not require discovering the prerequisite by failure.
- **JRN-02 — A missing surface explains its absence.** When a route's main surface is replaced by an empty state (for example the calendar before any channel), the replacement states why the surface is not shown and what makes it appear. Verification: review.
- **JRN-03 — One prerequisite, one story.** The same missing prerequisite uses the same next action and an equivalent explanation wherever it appears (Overview, Compose, Queue, Channels). Verification: review of the registry's empty states side by side.
- **JRN-04 — One primary action per frame.** A visible frame has one prominent instance of an action; an empty state does not repeat the header action already visible. Verification: measure.
- **JRN-05 — The same action keeps its icon and label.** An action with one meaning (for example New publication) uses one icon and one label across routes. Verification: measure.

### Navigation and scope (NAV)

- **NAV-01 — Choosing a destination does not drop the selected project unless the destination cannot use one.** Navigating from a project to a destination of another scope retains the project selector's value when that destination can show it, and states plainly when it cannot. Verification: measure (selector text before and after).
- **NAV-02 — A destination inside the navigation group the person was using does not replace the navigation.** Entering an item that the sidebar presents beside the current items keeps the same sidebar. A shell change is announced by the destination name and a return that names where it leads. Verification: measure (shell before and after) and review.
- **NAV-03 — Selected scope survives reload and direct links.** Reloading, or opening a link that omits optional context, restores the last selected workspace and project, or shows the scope it fell back to as the selected value. Verification: measure.
- **NAV-04 — The return control names its destination and exists once.** A return leads to the previous place the person visited or the declared parent, never to a differently named area with a similar word. A top-level destination listed in the sidebar has no return to a sibling destination. Verification: measure and registry.
- **NAV-05 — A navigation item and the page it opens share their name.** The sidebar label, the page title and the search entry for one destination use one noun. Verification: measure.
- **NAV-06 — A navigation item is not repeated as a card inside a page already framed by that navigation.** Verification: review.
- **NAV-07 — Items of one scope live in one place.** If the sidebar lists a scope's destinations in the product shell, its other destinations of that scope do not live only in a second shell without a visible link between them. Verification: registry.

### Width and layout (LAY)

- **LAY-01 — A page has one width class.** Content blocks of one page share the page's class; a page does not combine a reading column with full-width sections except for a declared comparison or management task. Verification: measure (distinct block widths).
- **LAY-02 — Width class follows the shell and job.** The `settings` shell uses `reading-column`; the `product` shell uses `work-surface` or `directory` as the registry declares. A route that departs from its declaration is a finding or a registry change by owner decision. Verification: registry and measure.
- **LAY-03 — A directory shows peer objects with their identity.** A page that lists projects, workspaces or channels shows the identity mark the application already generated for each object (for example the project avatar used in the selector), on a width that suits scanning rather than stretching two columns across the viewport. Verification: review.
- **LAY-04 — No horizontal page overflow** at 390 px and 1440 px. Verification: measure.

### Wayfinding and identity (WAY)

- **WAY-01 — Scope is recognizable at a glance.** Workspace, project, personal and installation destinations are told apart by more than their section label. Status: **candidate** — a restrained colour role per scope, applied to navigation icons and nothing else, is the proposed mechanism; it conflicts with `DESIGN.md` on semantic colour and needs an owner decision before application.
- **WAY-02 — Generated identity is reused.** An object that has a generated or uploaded identity mark shows it wherever the object is named in a list, selector or heading. Verification: review.
- **WAY-03 — The active location is visible.** The sidebar marks exactly one active destination, and it corresponds to the page title (NAV-05). Verification: measure.
- **WAY-04 — One noun per concept.** `Workspace` names the organizational container and is not also used for the project area; a return label, group label or empty state uses the noun the person would use for where they are. Verification: review of strings in both locales.

### Coherence and feedback (COH)

- **COH-01 — Disabled means explained.** A disabled navigation item or action states its reason on focus and hover. Verification: measure.
- **COH-02 — A consequence is stated before the action that causes it.** Destructive or withdrawing actions state what happens to dependent work before confirmation (`DESIGN.md`, feedback rules, apply here to every scope).
- **COH-03 — A choice that has a lasting effect explains itself where it is made.** A decision whose consequence is stated only elsewhere (for example the managing project of a channel) carries one short sentence at the point of choice. Verification: review.
- **COH-04 — Time shows its zone where it is chosen.** A date or time control shows the zone it will be interpreted in. Verification: measure.

## Acceptance for this specification

1. The owner reviews the rules above and accepts, rewrites or rejects each; `candidate` stays until decided.
2. The route registry matches the application's routes; a new route cannot ship without a registry entry once rule NAV-07 is accepted.
3. The audit procedure (`postdot-experience-review`) produces findings that cite these identifiers.
4. Automation is added only for rules whose verification is `measure` and whose outcome is unambiguous after acceptance.

## Out of scope

- Visual tokens, typography and surface treatment (`DESIGN.md`).
- Calendar interaction and copy density (`postdot-operational-ux`).
- Repair of the defects in the baseline audit; each repair is a separate task.
- Real-device accessibility and physical-touch review (UX-243, UX-277).
