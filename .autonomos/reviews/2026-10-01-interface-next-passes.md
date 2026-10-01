# Interface review and proposed next passes

Date: 2026-10-01 (Europe/Paris)
Status: provisional source review; live visual review incomplete
Task: UX-259

## Evidence boundary

The development services were restarted after a machine reboot. API /ready reports all four checks healthy; Vite responds HTTP 200 at port 5173. Browser access to the existing Herald URL was explicitly rejected by the browser security policy. No alternate browser, raw browser protocol, or other browser automation was used to bypass that decision. This report must not be represented as a fresh visual walkthrough. It combines current source inspection with previously documented review evidence. Desktop/mobile rendering, live populated state and interactions still need direct verification.

## Inventory

| Surface | Evidence and concern | Proposed outcome | Existing work |
| --- | --- | --- | --- |
| Overview/calendar | Calendar-first direction and contextual widgets are accepted. Dense calendar interactions were already verified; current live content was not inspected. | Preserve the calendar and quiet widgets; check hierarchy with real work before adding indicators. | UX-246, UX-253 completed |
| New publication | Compact 44 px destination rail, selected ring, touch-specific removal and protected custom-content deletion are implemented and tested. | Preserve this baseline; inspect many custom identities, touch discoverability and long localized labels. Avoid another wholesale redesign. | UX-258 completed |
| Queue | Previous rendered review identified header/row column drift under varying action widths. | One consistent grid for destination/state/action information, preserving stacked mobile rows and bulk selection. | UX-255 pending, ISSUE-145 |
| Publication detail | Current editor retains operational source/target controls and technical/activity disclosures. Its header has separate responsive composition from the shared page header; sidebar source contains revision/profile/schema metadata. Rendering is required to decide whether useful technical information is still too prominent. | First frame led by content, destination, current state and next action; technical/history access stays discoverable but secondary. | UX-250 in progress, ISSUE-144 |
| Channels | Duplicate sidebar inventory is removed; compact identities and composer creation are accepted. | Verify scanability of connected, disconnected, archived and repeated-platform channels; retain precise connection state without repeating provider descriptions. | UX-244 in progress; UX-256 completed |
| Media | Toolbar currently offers search, date/type filters, sorting, view modes and selection controls. This is a source-observed control inventory, not proof of visual overload. | Review a collapsed contextual filter surface on mobile; prioritize search/import and expose bulk actions when selection starts. Preserve selection, sorting and media safety. | Requires rendered review before new implementation task |
| Performance | Previous work removed unsupported-only dead rows. The remaining question is navigation value for projects without usable analytics. | Useful results when available, truthful quiet unavailable states; decide route prominence with representative connected projects. Do not invent metrics. | UX-252 in progress, ISSUE-146 |
| Settings hub | Source uses a descriptive page subtitle, two large cards with description and repeated action text; no shared centered-return header pattern. | Shorter entry points, consistent scope and header, descriptions only when they explain a genuine choice. | Link to existing administration review, ISSUE-063 |
| Provider applications | Source uses a large left title, explanatory paragraph and independently aligned create action; the form coexists with application inventory. | Match shared header hierarchy; distinguish instance OAuth application configuration from project channel connection; disclose configuration only on explicit edit/create. Keep scope and credential explanations that prevent mistakes. | New proposal under administration review; not yet accepted implementation |
| Preferences and API keys | Preferences subtitle repeats the settings purpose. API-key description explains real access/security scope and should not be blindly removed. | Compact preferences; clear API access scope at creation and review, one identifiable row action, protected secret and revocation flows. | Review first; preserve access contracts |
| Access/invitations | Prior implementation normalized scope and headers. | Verify populated membership, pending invitations and mobile role controls; retain meaningful permission explanations. | UX-254 completed; no fresh finding |

## Proposed sequence

1. **Consistency pass:** settings, provider applications, preferences and API-key entry headers. Separate redundant prose from essential access/scope information. Reuse accepted surfaces and compact actions rather than introduce new primitives.
2. **Operational reading pass:** UX-255 Queue alignment and UX-250 publication detail. Review draft, scheduled, manual-due, failed and published content; identify the next action without reading a large explanation.
3. **Library/connection pass:** populated Channels and Media, with narrow-screen controls and contextual selection. Register new work only after direct rendered evidence.
4. **Preview fidelity pass:** continue UX-248 rich media, platform formatting, link cards and truncation, retaining truthful content and licensed assets. Use representative images/text, not decorative mock metrics as a substitute for fidelity.
5. **Analytics decision pass:** UX-252 with usable metrics, stale metrics, disconnected providers and unsupported-only projects. A navigation change is a product proposal, not an automatic styling cleanup.
6. **Closure:** desktop/intermediate/mobile review, both locales/themes, keyboard/touch and realistic populated/empty/error states; targeted checks followed by the mandatory full gate for implementation.

## Completion criteria for each implementation pass

A visually clear primary action; stable layout between adjacent states; no duplicate context or purposeless empty counters; no decorative border where a quiet surface suffices; consistent control geometry; touch-safe separate selection/destructive actions; meaningful accessible names; no loss of drafts, media, permissions or publication history. Record concrete screenshot evidence and any unresolved product decision.

No application UI code was changed in this review. The plan is a proposal; current source facts are identified separately from hypotheses requiring rendered verification.

## First implementation and rendered follow-up

UX-260 implements the accepted settings consistency pass: centered headings, compact preferences, lighter administration navigation and removal of the orphan OAuth count/closed-form gap. Essential OAuth scope and API-key access descriptions remain.

Fresh browser access succeeded. The primary project pages were visited in French/light mode. Next concrete rendered priority: reduce repeated connection-purpose prose on Channels while preserving setup prerequisites. Review contextual Media metadata and narrow filters next. Keep Queue/detail operational states and supported analytics data in their existing tasks; the current empty Performance frame is insufficient to decide the populated experience. See UX-259/UX-260 worklogs for evidence and coverage limits.
