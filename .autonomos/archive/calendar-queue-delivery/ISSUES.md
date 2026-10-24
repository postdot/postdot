# Historical calendar and Queue issues

Source: .autonomos/ISSUES.md. Historical evidence and superseded mechanisms
remain preserved; applicable current contracts stay in accepted records.

<a id="issue-019"></a>

## [ISSUE-019] Define the operational planning experience

- Type: proposal
- Status: resolved
- Evidence: Postbot currently presents operational work through dashboard sections
  and publication lists. A calendar or timeline has not been designed, and the
  owner identified the need to rethink information hierarchy and scroll behavior
  before adding more incremental web surfaces.
- Impact: Adding more controls and sections without a coherent planning model can
  make scheduling and review fragmented, dense, or unnecessarily tiring to use.
- Desired outcome: A deliberate information architecture explains how overview,
  composition, queue, channels, media, and time-based planning fit together across
  desktop and small screens before the corresponding UI is expanded.
- Tasks: DESIGN-36 (completed), DESIGN-40 (completed)
- Resolution: DESIGN-36 established the route-oriented workspace and dedicated
  task surfaces, while DESIGN-40 added the project-scoped calendar planning
  surface with desktop, tablet, and mobile compositions. Both preserve the
  existing publication and scheduling boundaries; further planning affordances
  remain separate product work.

<a id="issue-034"></a>

## [ISSUE-034] Create publications directly from calendar planning

- Type: proposal
- Status: resolved
- Evidence: The project calendar currently presents scheduled publications and
  planning states, but an empty day does not start composition with that date
  carried into the scheduling flow.
- Impact: Calendar users must leave the planning surface and re-enter the date
  manually, adding friction to the central scheduling workflow.
- Desired outcome: A calendar interaction can start a new publication with an
  explicit date context while preserving the editor's draft, validation, and
  promotion boundaries across desktop and small screens.
- Tasks: WEB-72 (calendar-to-compose date context)
- Related issue: ISSUE-019
- Resolution: Empty calendar days now open the project compose route with a
  validated civil date in the URL. The composer initializes the first target
  at 09:00 in the project timezone while keeping the schedule editable; the
  calendar header and mobile date control provide the same explicit context.
  Existing publication links still open their detail route, and no publication
  is created until the owner submits the form.
- Verification: The focused browser flow and the full repository gate pass.

<a id="issue-035"></a>

## [ISSUE-035] Define project scheduling timezone semantics

- Type: question
- Status: resolved
- Evidence: The web editor renders and edits scheduled timestamps in the browser's
  local timezone. Postbot does not yet expose a project timezone policy or show the
  timezone used when a schedule is authored and displayed.
- Impact: The same publication can appear at different local wall-clock times on
  different devices, and a future timezone choice cannot be added safely without
  deciding how existing timestamps and calendar boundaries are interpreted.
- Desired outcome: Postbot has an explicit scheduling-timezone contract covering
  storage, authoring, calendar display, device changes, and migration of existing
  scheduled data before timezone-aware UI is implemented.
- Tasks: TIME-70 (completed)
- Related decision: ADR-032
- Resolution: Projects now persist a validated canonical IANA timezone with UTC as
  the deterministic default. Web authoring, calendar grouping, queue, overview, and
  attention surfaces use that project timezone, while stored schedule instants and
  scheduler execution remain unchanged. Nonexistent and ambiguous DST local times
  fail closed, project timezone changes are audited without moving existing
  instants, and the API exposes the update boundary.

<a id="issue-070"></a>

## [ISSUE-070] Make publication history and calendar reads complete at supported scale

- Type: problem
- Status: resolved
- Evidence: The publication summary reader applies a fixed limit of 100 while the
  API returns only `{ publications }` and the web project context consumes that
  array as the complete data set for Queue and calendar views. The audit created 101
  stored publications and received 100 with no continuation metadata. See the
  [reliability audit](../../worklogs/2026-09-11-postbot-audit/02-reliability-data-and-operations.md).
- Impact: Queue filters, counters, and the calendar can silently omit valid work.
  Ordering the bounded result before the calendar groups it can also hide future
  publications behind older history; the database rows themselves are not lost.
- Desired outcome: Users can reach every publication relevant to Queue filters and
  every publication in a selected calendar period without silent truncation, while
  response size and query cost remain bounded and the scope of counters is explicit.
- Tasks: WEB-145
- Related issues: ISSUE-009, ISSUE-019, ISSUE-063, ISSUE-066
- Related decisions: ADR-002, ADR-032, ADR-057
- Resolution: Publication summaries now use a bounded keyset page with a
  versioned continuation cursor. Queue exposes an explicit load-more action,
  while calendar reads request the selected month as a half-open timestamp range
  and drain its pages. Calendar queries have their own cache key and realtime
  invalidation path, and the database/API tests cover tails, filters, invalid
  cursors, ranges, and timezone boundaries.

<a id="issue-079"></a>

## [ISSUE-079] Remove redundant hierarchy and duplicate affordances from contextual surfaces

- Type: problem
- Status: resolved
- Evidence: The experimental calendar publication preview adds a visible
  “Publication preview” eyebrow even though it is opened directly from a
  publication, adds a footer “Close” action alongside the primitive close
  button and outside-click/Escape behavior, and renders a decorative status
  dot next to a status component that already contains its own marker. These
  choices were identified during owner review as unnecessary labeling and
  duplicate controls rather than useful guidance.
- Impact: The preview feels over-explained and less deliberate than the rest of
  Postbot. Repeated affordances compete with the actual publication content and
  make the interface appear to need instruction for familiar interactions.
- Desired outcome: Contextual surfaces lead with their invoked object, expose
  only state and actions that add information, use one representation per
  fact, and retain the primitive's established dismissal behavior without
  duplicate controls.
- Tasks: DESIGN-154
- Related issues: ISSUE-063, ISSUE-065
- Related decisions: ADR-057, ADR-024
- Resolution: The calendar publication preview now leads with the invoked
  publication instead of a redundant preview label, keeps only the primitive
  close behavior, and lets `PublicationStatus` own its single status marker.
  The rendered French browser check confirmed the accessible surface contains
  one explicit full-page action and no duplicate visible dismissal or status
  marker. Responsive calendar composition remains tracked separately by
  WEB-156.

<a id="issue-080"></a>

## [ISSUE-080] Give calendar inspection and density a distinct interaction contract

- Type: problem
- Status: resolved
- Evidence: In the calendar, a day background and its add button
  currently share the same slot callback and therefore the same create route.
  A visible event opens a publication preview, while “+N more” first opens a
  second list before the publication can be inspected. The fixed seven-column
  month composition also has an explicit three-event cap whose usefulness
  degrades as a day becomes dense or the viewport narrows.
- Impact: The operator cannot reliably distinguish inspect from create, must
  perform extra clicks to see hidden work, and loses readable temporal context
  when the month grid is squeezed. This undermines the calendar's role as a
  daily planning surface even when the underlying data is correct. The
  experimental calendar now uses a five-publication cap with direct in-cell
  expansion and a responsive month/agenda composition.
- Desired outcome: Existing events, day backgrounds, add controls, and
  overflow have separate predictable intents. The selected cell and its week
  row expose all scheduled work directly in the calendar flow, with five
  publications visible before overflow; narrow screens use a readable
  agenda/day composition and month view remains an intentional choice rather
  than a compressed default.
- Tasks: WEB-155, WEB-156
- Related issues: ISSUE-063, ISSUE-065, ISSUE-066
- Related decisions: ADR-057, ADR-024
- Resolution: WEB-155 and WEB-156 now keep inspect, create, and navigate intents
  distinct; expand dense days in place; preserve the selected day while a
  publication preview opens and closes; default the ReUI calendar in the
  project overview to agenda below 48rem; keep month view as the default at
  tablet and desktop widths; and make a manually selected narrow month view
  scroll horizontally instead of compressing seven columns into unreadable
  cells. The previous calendar remains available explicitly with
  `?calendar=legacy` while the new default is reviewed. Wide, tablet, and
  narrow behavior is covered by the populated ReUI browser scenario.

<a id="issue-081"></a>

## [ISSUE-081] Offer week and day reading modes for the project calendar

- Type: proposal
- Status: resolved
- Evidence: The project overview calendar provided a month grid and a narrow-screen agenda, but no way to inspect a shorter temporal window. As publication density grows, a month cell necessarily compresses time and competing posts into a small area, while an agenda removes their position within the week.
- Impact: Operators cannot switch from a month-level planning overview to a precise weekly or daily schedule without leaving the calendar or mentally reconstructing the time relationship between publications.
- Desired outcome: The same calendar offers Month, Week, Day, and Agenda modes. Week and Day retain the existing event preview behavior, show scheduled publications at their time positions, navigate by their own period, and remain usable when seven columns do not fit on a narrow viewport.
- Scope boundary: This issue does not add drag-to-create, event resizing, resource scheduling, or a second publication authoring flow. The existing page-level creation action remains the explicit creation entry point until those interactions receive a separate decision.
- Tasks: WEB-157
- Related issues: ISSUE-080
- Related decisions: ADR-057
- Resolution: The local ReUI calendar now exposes Month, Week, Day, and Agenda. A vendored read-only time grid reuses ReUI's date ranges, per-day segmentation, overlap packing, event rendering, time-zone formatting, and preview callback. Switching from Month to Week or Day anchors on the selected day when one exists, otherwise on today; navigating those views updates the same calendar cursor and its bounded monthly read. Week keeps a deliberate minimum width and horizontal scrolling on narrow screens, while Day uses the available width. Point-in-time publications receive the same minimum visual block height as the calendar's overlap packer so they remain visible. The populated ReUI browser scenario covers both new modes and direct preview without URL navigation.

<a id="issue-082"></a>

## [ISSUE-082] Make week and day publication density readable and actionable

- Type: problem
- Status: resolved
- Evidence: Owner review of the first Week implementation showed that it inherited appointment-style horizontal overlap packing. Multiple publications sharing one time slot were compressed into fixed-width columns, making their titles and channel information difficult to read. The view also exposed no create action from an empty time slot, even though Week and Day are operational planning views.
- Impact: A dense schedule could not be inspected reliably, and the absence of slot creation made the new views less useful than the Month view for composing work. The fixed-height time-grid assumption treated variable publication density as if it were bounded appointment data.
- Desired outcome: Week and Day use content-driven rows. Publications starting in the same slot stack vertically and remain individually clickable for preview; the slot and its hover "+" create a publication through the existing Composer with the selected date and time. Week scrolls only when its seven columns need more width, while Day uses the available width.
- Scope boundary: This correction does not introduce drag-to-create, event movement, resizing, or a second authoring flow. Those interactions remain separate product decisions.
- Tasks: WEB-158
- Related issues: ISSUE-080, ISSUE-081
- Related decisions: ADR-057
- Resolution: Replaced absolute overlap columns in the local Week/Day time grid with flow-based, variable-height slot rows. All events starting in a slot are rendered as stacked publication blocks; event clicks still open the existing preview. Empty slots and their hover add controls now call the existing Composer and carry a validated `date` and `time` query context into the initial schedule. The dense browser scenario uses six publications at one timestamp and verifies all six are visible, slot creation reaches Composer at `00:00`, and preview remains available afterward.

<a id="issue-083"></a>

## [ISSUE-083] Reclaim empty vertical space without hiding calendar hours

- Type: problem
- Status: resolved
- Evidence: After the Week/Day density correction, the integrated browser still started every day at `00:00` with a full-height row for each empty hour. On a deep but finite screen, the useful publications around `15:54` were pushed below the first viewport. The time gutter and repeated row gaps also consumed width and height that could have supported the publication content.
- Impact: The complete 24-hour range remained technically available but the first view under-emphasized the schedule's actual data. Users had to scroll through a long run of empty, equally sized cells before reaching the work they came to inspect.
- Desired outcome: Keep every hour and every creation slot available, but let empty slots use a compact minimum height, let occupied slots grow from their content, and reduce only the redundant gutter/padding/gap. Do not guess a user's working hours or silently remove overnight scheduling.
- Scope boundary: This issue does not add persistent user-defined zoom, column resizing, row resizing, drag-to-create, or event movement. Those controls need a separate interaction and persistence decision.
- Tasks: WEB-159
- Related issues: ISSUE-081, ISSUE-082
- Related decisions: ADR-057
- Resolution: The Week/Day time grid now uses a 2rem empty-slot baseline, removes the duplicate inner minimum that made empty rows taller than intended, tightens its time gutter from 4.5rem to 3.5rem, and uses 2px grid gaps with compact slot padding. Occupied rows still expand to fit their stacked publication blocks. No hours are filtered out. The populated browser scenario asserts that a dense slot is taller than an empty slot while retaining all six simultaneous publications.

<a id="issue-084"></a>

## [ISSUE-084] Give calendar columns readable density and a restrained publication surface

- Type: problem
- Status: resolved
- Evidence: The Week view kept seven equal tracks even when a publication needed more room, leaving dense days narrow and forcing the operator to read cramped cards. Its separators also had an incomplete hit area because the day header's text truncation clipped the resize control. The Month view used larger, inconsistent gutters and more generous cell padding than the corrected time grid. Publication blocks still inherited accent-tinted backgrounds and inset rings, which made them read as colorful post-its rather than neutral schedule content.
- Impact: Calendar density was governed by the empty layout instead of the content. The operator could not reclaim width for a dense day, could miss the resize affordance with a pointer, and saw different visual rhythms between Month and Week. Strong card treatments also competed with the semantic status information.
- Desired outcome: Week and Day keep a bounded readable minimum and horizontal scrolling when their columns do not fit, with optional per-column resizing through a full pointer hit area and keyboard controls. Widths are bounded and remembered per project and view. Month uses the same compact 2px rhythm and borderless cell treatment. Publication surfaces stay neutral; only the small status marker carries publication state color.
- Scope boundary: This issue does not add arbitrary content-driven `fit-content` tracks, hide hours or publications, or implement independent row-height resizing. Time rows remain content-driven from ISSUE-083; a global density/zoom model remains a separate product decision.
- Tasks: WEB-160
- Related issues: ISSUE-081, ISSUE-082, ISSUE-083
- Related decisions: ADR-057
- Resolution: Week and Day now use a 9.5rem minimum column track, an intentional 64rem Week viewport, and bounded 9.5rem–22.5rem per-column widths. Six accessible separators support pointer drag plus ArrowLeft/ArrowRight/Home/End and persist widths by project/view without affecting empty projects. The day header keeps its label truncated inside an overflow-safe child so the entire separator remains interactive. Month now uses 2px row/header/cell gutters, compact padding, borderless rounded cells, and a readable 60rem scroll floor. Publication events use a neutral surface with no inset ring or shadow and a single semantic state marker; state colors remain token-based rather than arbitrary.

<a id="issue-085"></a>

## [ISSUE-085] Keep long channel labels contained in compact calendar rows

- Type: problem
- Status: resolved
- Evidence: The populated browser review showed that Agenda rows keep the channel-name flex item `shrink-0`. The current fixture name fits, but a realistic long destination label can force the row beyond its available width, especially because Agenda is the narrow-screen reading mode.
- Impact: A destination label can compete with the publication title and time, create horizontal overflow, or make the mobile agenda harder to scan. This violates the responsive contract even though the underlying publication remains valid.
- Desired outcome: Agenda rows preserve the publication title and scheduled time, contain long channel names within the available row width, and keep the complete channel value available through an intentional accessible or hover affordance.
- Scope boundary: This is a label-containment correction, not a new calendar density control or a change to the Month/Week/Day information model.
- Tasks: WEB-161
- Related issues: ISSUE-084
- Related decisions: ADR-057
- Resolution: Agenda channel labels now have a bounded shrinkable slot with
  ellipsis and a native title, while the publication button's accessible name
  retains the complete value. The dense browser scenario covers a deliberately
  long destination name at the narrow responsive width and verifies that the
  agenda stays within its scroll container.

<a id="issue-086"></a>

## [ISSUE-086] Adapt the initial time-grid anchor to visible publication data

- Type: proposal
- Status: resolved
- Evidence: Week and Day retain the complete 24-hour timeline, but opening a
  populated range still places the operator at `00:00`. In a realistic review
  schedule, the first timed publications may begin much later in the day, so a
  deep viewport spends its first screenful on empty rows. A fixed `07:00`
  anchor would improve one schedule while imposing an arbitrary working-hours
  convention on every Postbot user.
- Impact: The first frame under-emphasizes the schedule's actual work and
  makes the useful content harder to discover, while a universal morning
  default would be surprising for users with different routines or overnight
  publication schedules.
- Desired outcome: When the visible Week or Day range contains timed
  publications, the initial viewport opens near the earliest available timed
  data with enough preceding context to orient the operator. When it contains
  no timed data, it starts at `00:00`. All hours and publications remain
  available, and an operator's manual scroll position is not repeatedly
  overridden.
- Scope boundary: This issue does not hide hours, infer a user's working hours,
  add a permanent zoom preference, or resize individual time rows. It covers
  only the initial vertical position of the existing Week/Day time grid.
- Tasks: WEB-162
- Related issues: ISSUE-081, ISSUE-082, ISSUE-083, ISSUE-084
- Related decisions: ADR-057
- Resolution: WEB-162 now derives the initial Week/Day anchor from the
  earliest timed occurrence in the visible range, keeps two configured slots
  of context before it, and leaves empty/all-day-only ranges at their existing
  top-of-page `00:00` baseline. The complete time range remains rendered, and
  the anchor is applied once per view/range plus the initial empty-to-timed
  transition so ordinary renders and manual scrolling are not overwritten.

<a id="issue-087"></a>

## [ISSUE-087] Prove adaptive time-grid anchoring across temporal edge cases

- Type: problem
- Status: resolved
- Evidence: WEB-162 covers an empty range, a populated UTC range, and early
  data clamped to the beginning of the day, but it does not yet prove the
  behavior for late-night work, a non-UTC display timezone, or a timed
  occurrence that starts before the visible range and continues into it.
- Impact: A regression in range intersection or timezone conversion could open
  Week or Day at the wrong local hour, make late work harder to find, or anchor
  on an event that is not actually visible in the current range.
- Desired outcome: Deterministic unit and browser evidence proves that the
  existing anchor chooses the earliest visible local timed data, keeps its
  context lead, handles day-boundary intersections and non-UTC zones, clamps
  safely at the rendered limits, and leaves the empty baseline unchanged.
- Scope boundary: This is a verification and precision follow-up to ISSUE-086.
  It does not change the 24-hour timeline, introduce a working-hours default,
  add persistent zoom, or alter event layout and scrolling policy.
- Tasks: WEB-163
- Related issues: ISSUE-086
- Related decisions: ADR-057
- Resolution: WEB-163 added deterministic coverage for early-morning and
  late-night publications, non-UTC display-time conversion, and an occurrence
  crossing the visible range boundary. The populated browser scenario now
  schedules six publications at 23:30 and confirms the `23:00` time slot,
  automatic initial scrolling, and full Week/Day visibility without changing
  the production timeline or viewport policy.

<a id="issue-088"></a>

## [ISSUE-088] Make the adaptive Week/Day anchor visible in the first frame

- Type: problem
- Status: resolved
- Evidence: The current browser implementation computes a useful anchor for
  populated Week/Day ranges, but the integrated page scroll container reaches
  its bottom boundary before the target row can be placed at the top. With
  publications around `15:54`, the page still exposes the `00:00` row in the
  first frame even though the pure helper returns a later contextual anchor.
- Impact: The implementation appears unchanged to the operator and the useful
  schedule remains visually buried below a long run of empty hours. A passing
  scrollTop assertion is not sufficient evidence when the selected row is not
  actually the first useful content in the viewport.
- Desired outcome: Populated Week/Day views open inside a bounded calendar time
  surface whose initial scroll can place the adaptive anchor before the first
  timed publication. The day headers remain associated with the time columns,
  all hours stay available through scrolling, and manual scrolling is not
  repeatedly overridden. Empty and all-day-only ranges retain the `00:00`
  baseline.
- Scope boundary: This corrects the existing initial-position behavior and its
  rendering contract. It does not invent working hours, remove time slots,
  add row resizing, or change the publication density model.
- Tasks: WEB-164
- Related issues: ISSUE-083, ISSUE-086, ISSUE-087
- Related decisions: ADR-057
- Resolution: WEB-164 gives Week and Day a bounded internal time-grid scroll
  surface, keeps the day-header row sticky and aligned with its columns, and
  applies the data-aware anchor after the rows have settled through a bounded
  requestAnimationFrame retry. All hours remain rendered and empty/all-day-only
  ranges keep the `00:00` baseline. The populated integrated-browser scenario
  now opens on useful afternoon data instead of the midnight frame.

<a id="issue-089"></a>

## [ISSUE-089] Persist the selected calendar reading mode across reloads

- Type: problem
- Status: resolved
- Evidence: `PublicationCalendarExperiment` stores the selected Month/Week/Day/
  Agenda view only in component state. Selecting Week or Day works until the
  overview route is refreshed, after which the state returns to the responsive
  default Month mode on desktop (or Agenda on narrow screens). The overview URL
  currently carries the implementation toggle but no reading-mode selection.
- Impact: A user's chosen way of reviewing the schedule is lost during a normal
  refresh or when the overview is opened from a copied link. This makes the
  calendar feel unstable and prevents a precise calendar view from being shared
  or restored through browser navigation.
- Desired outcome: The overview route accepts a validated `view` query value for
  Month, Week, Day, or Agenda. An explicit value is the source of truth across
  reloads, back/forward navigation, and shared links; when it is absent the
  current responsive default remains active. Switching views preserves the
  existing calendar implementation query and does not add a history entry for
  every presentation-only change.
- Scope boundary: This persists the reading mode only. It does not persist the
  calendar cursor, expanded day, scroll position, or column widths, which have
  separate contracts and storage decisions.
- Tasks: WEB-164
- Related issues: ISSUE-080, ISSUE-086, ISSUE-088
- Related decisions: ADR-057
- Resolution: WEB-164 makes `view=month|week|day|agenda` a validated overview
  query parameter and the source of truth for the selected reading mode. View
  switches use replacement navigation, preserve the calendar implementation
  query, and keep the responsive fallback when `view` is absent. Browser
  coverage confirms Week and Day survive a reload. The calendar cursor, scroll
  position, expanded day, and column widths remain intentionally separate
  contracts.

<a id="issue-090"></a>

## [ISSUE-090] Preserve the focused calendar date across reading changes

- Type: problem
- Status: resolved
- Evidence: The selected `view` is now URL-authoritative, but the calendar
  cursor still lives in `PublicationCalendarPage` state. Refreshing an
  overview, opening a copied link, or changing between Month, Week, Day, and
  Agenda can therefore lose the date the operator was reviewing and fall back
  to the current month or day.
- Impact: Calendar navigation is not durable, and a user can lose temporal
  context during an ordinary reload or view switch. Using browser history for
  every period click would also make routine reading create a long, low-value
  history trail.
- Desired outcome: The overview accepts a canonical civil `date=YYYY-MM-DD`
  query value interpreted in the project's timezone. Month derives its
  containing month from that date; Week, Day, and Agenda retain the focused
  date. View/date/period changes replace the current overview history entry,
  while explicit navigation to another task keeps normal push semantics.
- Scope boundary: This persists the focused date and defines its history
  policy. It does not persist scroll position, expanded cells, column widths,
  or a user working-hours preference.
- Tasks: WEB-165
- Related issues: ISSUE-089
- Related decisions: ADR-057, ADR-070
- Resolution: WEB-165 makes the focused civil date a validated `date=YYYY-MM-DD`
  overview parameter interpreted in the project timezone. Month, Week, Day, and
  Agenda derive their context from the same URL date, and reading changes use
  replacement navigation while Compose and publication detail retain push
  navigation. Unit, browser, and integrated-browser checks confirm date/view
  continuity after navigation and reload.

<a id="issue-091"></a>

## [ISSUE-091] Distinguish adjacent-month days without disabling them

- Type: problem
- Status: resolved
- Evidence: The experimental Month view renders leading and trailing days in
  the same surface treatment as the active month. The date numbers are muted,
  but the grid does not communicate the month boundary clearly enough during
  scanning.
- Impact: Publications shown in a six-week frame can appear to belong to the
  wrong month, especially when a dense day or a selected date sits near a
  boundary. A stronger fill or border would conflict with Postbot's restrained
  surface grammar and could imply that those dates are unavailable.
- Desired outcome: Outside-month cells remain fully interactive and readable,
  while a subtle theme-aware diagonal hatch distinguishes them from the
  current month without adding a new border, shadow, or semantic disabled
  state.
- Scope boundary: This covers Month-view context only. It does not change
  date selection, event grouping, responsive breakpoints, or the number of
  rendered weeks.
- Tasks: DESIGN-166
- Related issues: ISSUE-084, ISSUE-090
- Related decisions: ADR-057, ADR-070
- Resolution: DESIGN-166 adds one restrained, foreground-derived diagonal hatch
  to outside-month ReUI cells. The cells remain interactive and keep the
  existing surface, border, shadow, and accessibility semantics. Light- and
  dark-theme browser captures, plus the populated calendar scenario, verify the
  distinction without introducing a disabled visual state.

<a id="issue-092"></a>

## [ISSUE-092] Add a bounded, calendar-scoped keyboard navigation pilot

- Type: proposal
- Status: resolved
- Evidence: Calendar view and navigation controls already expose a stable
  product vocabulary, and the project direction explicitly supports pointer,
  keyboard, and narrow-screen use. The calendar primitive carries shortcut
  configuration and localized view hints, but no actual reading-mode shortcut
  handler is wired in the experimental surface.
- Impact: Operators who review schedules frequently must repeatedly reach for
  navigation controls, while adding global shortcuts prematurely could steal
  keystrokes from forms, dialogs, and other routes.
- Desired outcome: Introduce a small pilot using the TanStack React Hotkeys
  package, scoped to a focused calendar surface and ignored while typing in
  editable controls. `T` goes to today, `M`/`W`/`D`/`A` select Month/Week/Day/
  Agenda, and `[`/`]` move to the previous/next period. The pilot must reuse
  the existing callbacks, preserve the URL state contract, and expose
  keyboard metadata without adding explanatory copy to the calendar by
  default.
- Scope boundary: No create/publish shortcut, user-customizable bindings,
  global application shortcut layer, or shortcut-help panel is included in
  this pilot. Those require evidence from real use.
- Tasks: WEB-167
- Related issues: ISSUE-089, ISSUE-090
- Related decisions: ADR-057, ADR-070
- Resolution: WEB-167 adds a TanStack React Hotkeys pilot scoped to the mounted
  calendar surface. `T`, `M`/`W`/`D`/`A`, and `[`/`]` reuse the calendar's
  existing Today, view, and period callbacks, update the same URL state, ignore
  editable controls, and are disabled while the in-context preview is open.
  Browser coverage verifies view/date changes and reload continuity; no global
  shortcut layer or extra explanatory copy was introduced.

<a id="issue-093"></a>

## [ISSUE-093] Make calendar view state and reading shortcuts discoverable

- Type: problem
- Status: resolved
- Evidence: In the populated Week view, the selected week-view control is
  rendered with the same tonal family as its container and relies mainly on a
  shadow to form its boundary. The controls carry `aria-keyshortcuts`, but no
  visible keycap tells an operator that `M`, `W`, `D`, `A`, `T`, `[` or `]`
  are available.
- Impact: The active reading mode is easy to miss at a glance, and the
  keyboard pilot currently behaves like an undocumented feature. Making every
  application shortcut global or permanently explaining all of them would add
  noise, but hiding shortcuts entirely wastes the affordance on the one
  control group where they are directly useful.
- Desired outcome: Give the selected view a clear filled surface with a
  restrained state contrast that does not depend on a shadow alone. Show
  compact semantic keycaps beside the calendar controls that own the most
  useful shortcuts; keep the disclosure local to the calendar toolbar and
  avoid a global shortcut legend for now.
- Scope boundary: This does not add new shortcuts, a command palette, a
  preferences screen, or a global keyboard-help overlay. The existing
  keyboard behavior, URL contract, and pointer actions remain unchanged.
- Tasks: DESIGN-168
- Related issues: ISSUE-089, ISSUE-090, ISSUE-092
- Related decisions: ADR-057, ADR-070
- Resolution: DESIGN-168 adds a shared Base UI-compatible `Kbd` primitive,
  gives the selected reading mode a filled `surface-raised` state without a
  shadow-dependent boundary, and shows the existing calendar keys beside the
  controls they operate. The disclosure remains local to the toolbar and the
  existing scoped keyboard behavior is unchanged.

<a id="issue-094"></a>

## [ISSUE-094] Keep Week/Day creation actions above dense publication stacks

- Type: problem
- Status: resolved
- Evidence: The Week/Day time-grid `+` control is absolutely positioned in
  the top-right of a slot while publication events are rendered in a later,
  higher `z-index` stack. When several publications share the same slot, the
  `+` is consequently painted beneath the first publication instead of
  occupying a predictable action area.
- Impact: The create action is partially hidden exactly where the schedule is
  densest, and the slot no longer communicates a stable relationship between
  its time, its publications, and its actions.
- Desired outcome: Occupied slots expose a compact in-slot frame with a
  small time/action header and the publications below it. The `+` belongs to
  that header, so it never overlays or hides a publication. Empty slots stay
  compact and may reveal the same action on hover/focus without reserving a
  permanent header solely for the button.
- Scope boundary: This is a Week/Day presentation and creation-affordance
  correction. It does not introduce drag/resize, change event ordering, or
  turn a day background into a create action.
- Tasks: WEB-169
- Related issues: ISSUE-080, ISSUE-081, ISSUE-082, ISSUE-083, ISSUE-084
- Related decisions: ADR-057
- Resolution: WEB-169 renders occupied Week/Day slots as a content-driven
  surface with a compact time/action header above the publication stack. The
  add action no longer competes with event z-order, empty slots keep their
  compact baseline, and occupied-slot background clicks no longer duplicate
  the explicit create action. Focus and dense-stack browser assertions pass.

<a id="issue-095"></a>

## [ISSUE-095] Make the dense-slot action frame external and transient

- Type: problem
- Status: resolved
- Evidence: The first implementation of ISSUE-094 places a new framed surface,
  padding, and literal start-time label inside an occupied cell. The owner’s
  intended interaction is an outer envelope that appears only while a cell is
  hovered or focused, surrounds the existing cell/content from outside, and
  provides room for actions without shrinking the publication area.
- Impact: The inner frame adds an unnecessary layer of inset spacing, makes the
  dense stack consume more room, and gives prominence to an incidental time
  label instead of the actual interaction model. The result is visually and
  spatially opposite to the requested dense calendar treatment.
- Desired outcome: Keep the cell’s existing surface and publication stack
  unchanged at rest. On hover or keyboard focus, show a non-flowing outer frame
  around the cell and place the create action in that external interaction
  envelope. The frame must not reserve layout space, add an always-visible
  header, or require a special time label.
- Scope boundary: This corrects the Week/Day occupied-slot affordance only. It
  does not add drag/resize, change event inspection, or introduce a permanent
  card/container around publication content.
- Tasks: WEB-170
- Related issues: ISSUE-080, ISSUE-081, ISSUE-082, ISSUE-083, ISSUE-094
- Related decisions: ADR-071, ADR-072
- Resolution: WEB-170 removes the occupied-only inner frame, padding, and
  incidental time label. Every Week/Day slot now keeps its existing content
  geometry and exposes a non-flowing outer interaction frame only on
  hover/focus-within, with the create action in the external top band. The
  frame and action remain fully visible at the edge of the horizontal grid,
  while dense publications remain direct inspectable targets. Browser tests
  verify the frame visibility transition, external bounds, unchanged slot
  dimensions, action ordering, and six-publication rendering.

<a id="issue-096"></a>

## [ISSUE-096] Keep Week/Day actions in-cell and reduce calendar chrome

- Type: problem
- Status: resolved
- Evidence: Owner review of the WEB-170 result rejects the external action
  band and frame. The `+` should appear in the existing cell on hover/focus,
  layered above the publication stack, without adding an outer border, a new
  padding tier, or a flow-affecting header. The visible `[`, `T`, and `]`
  keycaps also make the toolbar noisy, while the shared `Kbd` treatment is
  oversized and relies too much on a shadow against a similar surface. The
  horizontally scrollable Week/Day grid additionally lets the time gutter
  leave the viewport, so the operator loses the hour context while reading a
  later day column.
- Impact: The current implementation spends scarce calendar space on an
  affordance the operator did not ask for, makes the reading toolbar compete
  with its own navigation controls, and makes horizontal schedule scanning
  harder because hour labels disappear.
- Desired outcome: Keep the publication stack as the content owner of the
  cell, reveal one compact in-cell create button only on hover/focus, paint it
  above the stack with a higher interaction z-order, and preserve identical
  slot geometry before and after disclosure. Retain visible keycaps only in
  the local view switcher, where they explain the reading-mode shortcuts;
  remove the navigation keycaps for now while keeping accessible shortcut
  metadata and behavior. Give `Kbd` a compact, clearly contrasting field
  treatment whose distinction does not depend on a shadow. Make the time
  gutter sticky at the inline start for the Week/Day horizontal scroll, with
  the header intersection layered above day content.
- Scope boundary: This is a correction to the Week/Day affordance, toolbar
  disclosure, and scroll orientation. It does not introduce a global
  shortcut-help overlay, new keyboard commands, drag/resize behavior, or a
  second calendar layout.
- Tasks: WEB-171
- Related issues: ISSUE-080, ISSUE-081, ISSUE-082, ISSUE-083, ISSUE-084,
  ISSUE-093, ISSUE-094, ISSUE-095
- Related decisions: ADR-071, ADR-072, ADR-073
- Acceptance: Browser coverage proves the in-cell action is hidden at rest,
  visible on hover/focus, above dense publications, inside the slot, and
  geometry-neutral; empty slots remain compact and create still routes with
  date/time context. The view toolbar contains only the local view keycaps,
  `Kbd` is compact and contrastive in light/dark themes, and a horizontal
  scroll keeps the time gutter at the scroll surface's inline start. Full
  format, lint, typecheck, unit, browser, build, and integrated visual checks
  pass.
- Resolution: WEB-171 removes the external frame and renders the `+` as a
  transient, in-cell overlay above the publication stack without layout
  shift. Navigation keycaps are removed while the view switcher keeps its
  compact `M`/`W`/`D`/`A` disclosure, `Kbd` uses a contrasting field surface,
  and the time gutter/header intersection stay sticky during horizontal
  scrolling. The deterministic browser scenario, full E2E suite (17/17),
  full repository gate, and light/dark integrated review pass.

<a id="issue-097"></a>

## [ISSUE-097] Retire the reviewed calendar fallback

- Type: maintenance
- Status: resolved
- Evidence: The ReUI calendar is now the reviewed default overview and owns
  the current Month, Week, Day, Agenda, density, creation, inspection,
  responsive, and URL-state contracts. The old month/agenda implementation is
  still reachable through `?calendar=legacy`, and the route/tests retain a
  second implementation that no longer represents the accepted product path.
- Impact: A disposable review switch keeps dead UI code, stale test contracts,
  and an unsupported alternate behavior in the application. It also makes the
  overview's canonical route less explicit and leaves future calendar fixes
  vulnerable to being applied to the wrong implementation.
- Desired outcome: The ReUI calendar is the sole overview implementation. The
  overview route ignores/removes the legacy selector, the dead legacy
  components and copy are deleted, and tests prove the canonical route without
  weakening the existing calendar behavior.
- Scope boundary: This retires only the reviewed calendar fallback and its
  obsolete implementation/test references. It does not redesign Calendar or
  Composer, change the URL contract for `view`/`date`, or remove the separate
  project calendar route unless code inspection proves it is an unused alias.
- Tasks: WEB-172
- Related issues: ISSUE-080, ISSUE-081, ISSUE-089, ISSUE-090, ISSUE-096
- Related decisions: ADR-070, ADR-073
- Acceptance: No application or test path relies on `calendar=legacy`; the
  overview route exposes the canonical ReUI calendar with validated `view` and
  `date` state; the legacy month/agenda implementation and now-unused copy are
  removed; focused calendar tests and the full repository gate pass.
- Resolution: WEB-172 makes the ReUI calendar the sole overview implementation.
  The legacy selector, obsolete month/agenda component, unused project-calendar
  alias, stale helpers/messages, and experimental naming were removed; route
  generation and browser coverage now exercise the canonical `view`/`date`
  contract. Focused unit and browser tests, the full repository gate, and the
  production build pass. Historical Autonomos records remain unchanged.

<a id="issue-118"></a>

## [ISSUE-118] Make Queue and Calendar query failures explicit

- Type: problem
- Status: resolved
- Evidence: The supplied audit reports that Queue and Calendar can render fallback publication data when their own query fails instead of presenting a failure state.
- Impact: Operators can mistake incomplete or unrelated data for an accurate project view.
- Desired outcome: Failed reads are visibly distinguishable from empty reads, preserve the correct scope, and offer an appropriate recovery action.
- Tasks: WEB-203
- Resolution: Queue and Calendar render the shared retryable `QueryErrorState`
  when their own server query fails and suppress the affected data list. The
  previous unrelated-data fallback is not present in the current source.

<a id="issue-154"></a>

Status reconciled by META-573 on 2026-10-24 from open to resolved: the
existing resolution, completed WEB-310/311 evidence, current role gates and
four-view regression coverage establish the stated outcome. No new runtime
validation or authorization change is claimed.

## [ISSUE-154] Overview and calendar offer viewer-forbidden actions

- Type: problem
- Status: resolved
- Evidence: AUDIT-309 found the Overview calendar rendering `New publication` without the editor predicate (`publication-calendar-page.tsx` header action), a bulk reschedule/cancel bar reachable by any viewer because selection is always wired, and week/day slot clicks that create a publication. The server correctly answers 403 (`canAccessProjectRole`), so this is a UI correctness defect rather than an authorization failure. Queue already gates the same actions.
- Impact: Viewers are invited into actions they cannot perform, producing raw forbidden errors and breaking the validated operational hierarchy.
- Desired outcome: Overview and calendar expose create and bulk-mutation actions only to owners and editors, while consultation stays identical for every role.
- Tasks: WEB-310 (completed)
- Resolution: the Overview header create action, the month day-add affordance, week/day slot creation and the selection-driven bulk reschedule/cancel surface now require the existing editor predicate, mirroring Queue. Viewers keep event inspection, the preview sheet and all reading paths; temporarily unavailable actions keep their disabled reason. The server already answered 403 and is unchanged.

<a id="issue-155"></a>

Status reconciled by META-573 on 2026-10-24 from open to resolved: the
existing resolution, completed WEB-310/311 evidence, current role gates and
four-view regression coverage establish the stated outcome. No new runtime
validation or authorization change is claimed.

## [ISSUE-155] Viewer consultation is not coherent across calendar views

- Type: problem
- Status: resolved
- Evidence: WEB-310 withheld the Overview create and bulk actions, but only the month view was exercised. Week, day and agenda slot behavior for a viewer was not verified, and the contextual sheet footer label still follows the publication lifecycle (`canEditPublication`), so a viewer opening a scheduled publication is offered `Edit publication` and lands on a read-only page.
- Impact: A viewer can still meet an editing affordance that leads nowhere editable, and the remaining reading modes are unproven for that role.
- Desired outcome: Every calendar reading mode stays fully readable for viewers, with no create or bulk-mutation entry point, and the contextual sheet names the consultation action honestly.
- Tasks: WEB-311 (completed)
- Resolution: the week/day time-grid `+` now honors the same `showDayAddButton` flag the month view already used, so no create affordance survives for viewers in any reading mode, and the contextual sheet requires editor rights in addition to an editable lifecycle state before naming the action as editing. Navigation, event opening, and the existing translations are unchanged; server rights are unchanged.

