# Historical calendar and Queue task records

Source: .autonomos/TASKS.md. Original statuses and wording are retained;
archival does not infer completion dates or create new current instructions.

## 🔮 Backlog

<a id="design-36"></a>

- [x] **[DESIGN-36]** Recompose publication workflows for calm, low-scroll authoring `Priority: 🟠` `Complexity: XL`

<a id="design-40"></a>

- [x] **[DESIGN-40]** Design and implement the project calendar planning surface `Priority: 🟠` `Complexity: L`

## 🧭 Next Sprint

<a id="time-70"></a>

- [x] **[TIME-70]** Define project scheduling timezone semantics before calendar expansion `Priority: 🔴` `Complexity: M`

<a id="web-72"></a>

- [x] **[WEB-72]** Start publication composition from a project calendar date `Priority: 🟠` `Complexity: M`

## 🧱 Foundation consolidation after the 2026-09-11 audit

<a id="web-145"></a>

- [x] **[WEB-145]** Make Queue pagination and calendar range reads complete and bounded `Priority: 🔴` `Complexity: L` — [ISSUE-070]; define stable continuation for Queue and a date-scoped calendar read so history cannot silently hide relevant work.

## 🧭 Queue operational UX

<a id="web-183"></a>

- [x] **[WEB-183]** Consolidate Queue around one filterable publication list `Priority: 🟠` `Complexity: M` — remove the duplicate attention surface, separate lifecycle filters from delivery mode, preserve due-work and bulk actions, and prove mixed-state responsive behavior with localized browser coverage.

<a id="web-185"></a>

- [x] **[WEB-185]** Simplify Queue hierarchy and row actions `Priority: 🟠` `Complexity: M` — consolidate filters, selection, and list presentation into one readable control/list composition, expose global selection directly, and align concise per-publication actions across responsive layouts. Implemented with surface-based controls, compact count badges, direct global selection, icon-led due actions, and aligned publication row actions; targeted and full repository validation passed.

<a id="web-186"></a>

- [x] **[WEB-186]** Make Queue controls responsive and tabular `Priority: 🟠` `Complexity: M` — keep lifecycle tabs on their own wrapping surface, move delivery filters to a separate flow, and place a real global checkbox with column labels in the publication table header so narrow layouts never depend on horizontal scrolling. Implemented with wrapping surface tabs, a separate filter flow, a real table-header selection checkbox, and explicit mobile column placement; targeted and full repository validation passed.

<a id="web-187"></a>

- [x] **[WEB-187]** Keep Queue selection geometry stable `Priority: 🟠` `Complexity: S` — remove the selected-row side stripe and keep one persistent action surface so selecting publications reveals actions without inserting a new block or shifting the table. Implemented with the delivery-mode and taxonomy filters anchored in the persistent bar, conditional bulk actions, and a browser anchor-position assertion; targeted and full repository validation passed.

<a id="web-188"></a>

- [x] **[WEB-188]** Reframe Queue empty states `Priority: 🟠` `Complexity: M` — replace the row-like empty result with a centered, illustrated state that uses the shared Empty primitives, keeps copy concise, supports theme-aware SVG artwork, and preserves the existing Queue actions and responsive contracts. Implemented with a reusable publication empty-state composition, theme-token SVG illustration, omitted draft filler copy, and browser coverage for the illustrated state; targeted and full repository validation passed.

## 🧭 Calendar interaction and operational UX follow-up

<a id="design-154"></a>

- [x] **[DESIGN-154]** Establish the Postbot operational UX review skill and remove redundant contextual-surface affordances `Priority: 🔴` `Complexity: M` — [ISSUE-079]; reusable hierarchy, one-fact/one-marker, and one-dismissal rules are recorded in the project skill and applied to the calendar publication preview.

<a id="web-155"></a>

- [x] **[WEB-155]** Separate calendar inspection from publication creation and make date overflow directly inspectable `Priority: 🔴` `Complexity: M` — [ISSUE-080]; day backgrounds and overflow expand the selected cell and its week row in the calendar, five publications remain visible before overflow, add controls create, event clicks preview, and the full publication path remains explicit without leaving the calendar unexpectedly.

<a id="web-156"></a>

- [x] **[WEB-156]** Recompose the calendar for narrow widths and compare month versus agenda reading modes `Priority: 🟠` `Complexity: L` — [ISSUE-080]; the ReUI calendar is now the default project overview, defaults to a readable agenda below 48rem, keeps month view at wide and tablet widths, offers an intentional horizontally scrollable month view on narrow screens, and preserves dense-day context through view changes and preview dismissal. The previous implementation remains available explicitly with `?calendar=legacy` during review.

## 🗓️ Calendar temporal reading modes

<a id="web-157"></a>

- [x] **[WEB-157]** Add readable week and day calendar views `Priority: 🟠` `Complexity: M` — [ISSUE-081]; expose ReUI's week/day modes with a local, read-only time grid, preserve direct publication preview behavior, anchor the new modes on the current or selected day, and keep the week intentionally horizontally scrollable when its seven columns no longer fit.

## 🗓️ Calendar density and creation follow-up

<a id="web-158"></a>

- [x] **[WEB-158]** Make Week and Day readable with dense publication slots `Priority: 🔴` `Complexity: M` — [ISSUE-082]; replace fixed horizontal overlap columns with content-driven vertical stacking, keep every simultaneous publication individually inspectable, add empty-slot and hover-plus creation through Composer with date/time context, and preserve the intentional Week/Day scope boundary around drag and resize.

## 🗓️ Calendar viewport density

<a id="web-159"></a>

- [x] **[WEB-159]** Reclaim empty Week/Day space without hiding hours `Priority: 🔴` `Complexity: S` — [ISSUE-083]; compact empty slots, remove the duplicate inner minimum, tighten the time gutter and grid gaps, keep occupied slots content-driven, and verify dense content reaches the first viewport without changing the complete 24-hour range.

## 🧱 Calendar column density and event treatment

<a id="web-160"></a>

- [x] **[WEB-160]** Make calendar columns readable, resizable, and visually consistent across views `Priority: 🟠` `Complexity: M` — [ISSUE-084]; keep Week/Day columns above a readable minimum with bounded pointer/keyboard resizing persisted per project/view, align Month's gutters and compact cell rhythm with the time grid, and replace accent-tinted/ringed publication cards with neutral surfaces plus one semantic status marker.

## 🧾 Calendar label containment follow-up

<a id="web-161"></a>

- [x] **[WEB-161]** Keep long channel labels contained in compact calendar rows `Priority: 🟠` `Complexity: S` — [ISSUE-085]; make Agenda channel labels shrink and truncate without horizontal overflow, preserve the complete value for accessible and intentional hover access, and cover a realistic long destination name in the browser scenario.

<a id="web-162"></a>

- [x] **[WEB-162]** Adapt the initial Week/Day time-grid anchor to visible publication data `Priority: 🟠` `Complexity: M` — [ISSUE-086]; position populated ranges near their earliest timed publication with a small context lead, keep empty ranges at `00:00`, preserve the complete timeline and manual scrolling, and cover both states with unit and browser evidence. The anchor is applied once per view/range and initial empty-to-timed transition, so ordinary renders and manual scrolling retain control.

## 🧪 Adaptive calendar edge-case verification

<a id="web-163"></a>

- [x] **[WEB-163]** Prove the adaptive Week/Day anchor across temporal edge cases `Priority: 🟠` `Complexity: S` — [ISSUE-087]; cover late-night data, non-UTC display timezones, and occurrences crossing the visible range boundary with deterministic unit evidence plus a populated browser check, without changing the existing timeline or viewport policy. Unit, browser, full gate, and integrated-browser evidence confirm the behavior.

## 🧭 Calendar continuity and state persistence

<a id="web-164"></a>

- [x] **[WEB-164]** Make the populated Week/Day anchor visibly effective and persist the selected calendar view `Priority: 🟠` `Complexity: M` — [ISSUE-088] [ISSUE-089]; give the time grid a real bounded scroll surface so data-aware positioning is observable without hiding hours, keep headers aligned with the scrolled columns, make `view` a validated overview query source of truth with responsive fallback when absent, and cover empty/populated anchor behavior plus reload persistence in unit and browser evidence. Full format, lint, typecheck/i18n, unit, browser, and package-build validation passed.

## 🧭 Calendar context continuity

<a id="web-165"></a>

- [x] **[WEB-165]** Persist the focused calendar date and apply the route history policy `Priority: 🟠` `Complexity: M` — [ISSUE-090]; validate a canonical `date=YYYY-MM-DD`, make Month/Week/Day/Agenda derive their context from it, use `replace` for reading-state changes, preserve other overview search values, and cover reload, view switching, period navigation, and explicit task navigation. Implemented with timezone-safe civil-date parsing and browser coverage.

## 🎨 Calendar month context

<a id="design-166"></a>

- [x] **[DESIGN-166]** Distinguish outside-month cells with a restrained surface treatment `Priority: 🔵` `Complexity: S` — [ISSUE-091]; keep adjacent-month dates interactive while adding one theme-aware diagonal hatch that respects the surface grammar and does not introduce borders, shadows, or disabled semantics. Implemented and visually verified in light and dark themes.

## ⌨️ Calendar keyboard navigation pilot

<a id="web-167"></a>

- [x] **[WEB-167]** Add focused calendar reading shortcuts with TanStack React Hotkeys `Priority: 🔵` `Complexity: M` — [ISSUE-092]; implement `T`, `M/W/D/A`, and `[/]` period commands only while the calendar owns focus, ignore editable controls and contextual surfaces, reuse existing view/date callbacks, add keyboard metadata, and cover keyboard behavior without creating a global shortcut layer. Implemented with scoped target registration and browser coverage.

## 🧭 Calendar affordance disclosure follow-up

<a id="design-168"></a>

- [x] **[DESIGN-168]** Make the selected calendar view and local reading shortcuts visibly discoverable `Priority: 🟠` `Complexity: S` — [ISSUE-093]; use an explicit filled active surface, add shared `Kbd` primitives to the view/navigation controls, keep disclosure local and responsive, and preserve the existing shortcut scope and URL behavior. Implemented with light/dark integrated-browser review and targeted accessibility assertions.

<a id="web-169"></a>

- [x] **[WEB-169]** Put the Week/Day create action in a content-aware slot header `Priority: 🟠` `Complexity: M` — [ISSUE-094]; keep occupied-slot actions above stacked publications, keep empty slots compact, preserve separate inspect/create intent, and cover dense, empty, keyboard-focus, and narrow-width states. Implemented with six-publication dense-stack browser coverage and full repository validation.

<a id="web-170"></a>

- [x] **[WEB-170]** Move the dense Week/Day action frame outside the cell `Priority: 🔴` `Complexity: S` — [ISSUE-095]; remove the inner padding/header surface, show a non-flowing outer envelope only on hover/focus, keep the publication stack’s geometry unchanged at rest, and verify the external create action remains usable without covering events. Implemented with direct publication children, an external top action band, and light/dark integrated-browser review.

<a id="web-171"></a>

- [x] **[WEB-171]** Overlay Week/Day creation in the cell, slim shortcut disclosure, and pin the time gutter `Priority: 🔴` `Complexity: M` — [ISSUE-096]; keep the `+` inside the existing cell without layout shift or an external frame, remove the noisy navigation keycaps while retaining a compact view-group disclosure, make `Kbd` visibly distinct without shadow-only styling, and keep the hours gutter visible during horizontal scrolling. Implemented with in-cell z-order assertions, deterministic vertical-anchor coverage, horizontal sticky-gutter coverage, and light/dark integrated review.

<a id="web-172"></a>

- [x] **[WEB-172]** Retire the reviewed calendar fallback and make ReUI canonical `Priority: 🟠` `Complexity: S` — [ISSUE-097]; remove the legacy overview query branch, delete the unreachable legacy month/agenda implementation, update browser coverage and user-facing references, then prove the canonical calendar still supports the existing route, view, date, creation, inspection, density, and responsive contracts. Implemented with canonical naming, dead-route removal, generated route/i18n refresh, focused calendar coverage, and the full repository gate.

## 🔎 Issue-driven external audit reconciliation

<a id="web-203"></a>

- [x] **[WEB-203]** Verify Queue and Calendar failure-state boundaries `Priority: 🟠` `Complexity: M` — confirm each route suppresses stale or unrelated publication data on query failure and exposes the shared retryable error state. — [ISSUE-118]

## Browser UX audit — incremental follow-ups

<a id="ux-240"></a>

- [x] **[UX-240]** Clarify the roles of Overview, its calendar, and Queue `Priority: 🟠` `Complexity: M` — [ISSUE-063]; owner retained the calendar as Overview's main surface and rejected an action-first landing/separate Calendar route. The summary now appears only for due manual work or an upcoming scheduled publication; empty counters, stale history, and redundant activity charts are omitted. Queue remains the lifecycle triage surface; routes and domain/API ownership are unchanged. Evidence: [UX-240 worklog](worklogs/2026-09-28-UX-240.md).

<a id="ux-242"></a>

- [x] **[UX-242]** Calibrate readable operational hierarchy on representative screens `Priority: 🟠` `Complexity: M` — [ISSUE-065]; reduced dashboard headings to 30 px through tablet widths and raised Queue selection headers to 12 px sentence case. Sampled text contrast passes; dark surface separation remains evidence for a later reviewed token pass. Validated at 1440, 820, and 390 px without horizontal overflow. Evidence: [UX-242 worklog](worklogs/2026-09-28-UX-242.md).

<a id="ux-251"></a>

- [x] **[UX-251]** Calibrate Queue for quick triage without losing complete history `Priority: 🔵` `Complexity: M` — [ISSUE-145]; remove redundant project/timezone framing and copy, compare mixed lifecycle rows and zero-count filters, and make current action priority legible. Preserve filtering, bulk actions, and published lookup; verify narrow and populated states. Evidence: [UX-251 worklog](worklogs/2026-09-29-UX-251.md).

<a id="ux-265"></a>

- [x] **[UX-265]** Preserve shell edge parity and calendar title readability `Priority: 🟠` `Complexity: M` — owner feedback: use the same structural page contour in both themes and prevent calendar date titles collapsing into vertical character stacks at intermediate widths. Sweep month/week views with expanded/collapsed navigation before continuing UX-243 responsive review.

<a id="ux-266"></a>

- [x] **[UX-266]** Localize calendar date titles and period labels `Priority: 🔵` `Complexity: M` — continuation of responsive review: French month names retain US date order in week/day labels. Use locale-native formatting at the Postbot composition boundary, preserve project timezone and exclusive range ends, and validate cross-month/year labels and intermediate widths after owner dependency updates. Completed with the full root gate; [worklog](worklogs/2026-10-01-UX-266.md).

## Publication reliability audit follow-ups

<a id="web-310"></a>

- [x] **[WEB-310]** Stop offering viewer-forbidden actions in Overview and the calendar `Priority: 🔴` `Complexity: M` — Follow AUDIT-309. Reuse the existing editor predicate and the Queue gating pattern: hide the create entry points (header action, month day add, week/day slot create) and the selection-driven bulk reschedule/cancel surface for viewers, keep every consultation path (event inspection, navigation, due and summary reading), and keep the existing disabled-with-reason behavior for actions that are merely unavailable given the current selection. No new role policy, no server change, no change to the post-revocation state (separate mission). Verify viewer and editor journeys in the browser. Completed: the Overview header create action, month day-add, week/day slot creation and the selection-driven bulk reschedule/cancel surface are now withheld from viewers by reusing the existing editor predicate and the Queue pattern; consultation, the empty-state channel action and the disabled-with-reason behavior are unchanged; server 403s confirmed; browser journey covers owner, viewer and editor with per-layer non-vacuity proved. Evidence: [WEB-310 worklog](worklogs/2026-10-04-WEB-310.md).

<a id="web-311"></a>

- [x] **[WEB-311]** Complete viewer consultation coherence across calendar views `Priority: 🔴` `Complexity: M` — Follow WEB-310. Prove that month, week, day and agenda keep navigation and event opening for viewers while exposing no create entry point and no forbidden bulk action, then present a consultation label instead of `Edit publication` in the contextual sheet for viewers. Reuse existing permissions and translations, keep server rights unchanged, and do not touch live-revocation presentation. Completed: the week/day time-grid add button now honors the existing `showDayAddButton` flag (the month view already did) so no dead create control remains, and the contextual sheet names consultation for viewers using the existing `View publication` translation. All four reading modes verified for navigation, event opening, and absence of create and bulk entry. Evidence: [WEB-311 worklog](worklogs/2026-10-04-WEB-311.md).

## Product sequencing reset

<a id="design-399"></a>

- [x] **[DESIGN-399]** Restore adjacent surface and selection distinction `Priority: 🟠` `Complexity: S` — Neutral shell elevation, explicit selected-control fill and dedicated calendar cell edges, preserving layout.

