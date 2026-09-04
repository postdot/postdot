# ADR-032 — Use a Project Timezone for Civil Scheduling

- Status: accepted
- Scope: Human scheduling, calendar interpretation, API/CLI time contracts, and future recurrence
- Provenance: [ISSUE-035](../ISSUES.md), [TIME-70](../worklogs/2026-09-04-TIME-70.md), owner approval on 2026-09-04
- Related decisions: [ADR-005](ADR-005-use-sqlite-first-persistence.md), [ADR-006](ADR-006-use-next-event-durable-scheduler.md), [ADR-009](ADR-009-fence-external-effects-with-durable-claims.md)
- Superseded by: none

## Context

Herald schedules publications as exact instants, but people author schedules in
civil time. A civil time such as “09:00” is incomplete without a timezone. The
current web editor and calendar use the browser timezone implicitly, which is
consistent on one device but gives different wall-clock interpretations to
operators in different locations.

UTC is the correct interchange and execution reference, but it is not a sufficient
replacement for the business context of a project. A publication manager used by an
American company should allow an operator in France to reason in the company's
business timezone without manually converting every schedule.

## Decision

### Exact time and persistence

- `Publication.scheduledAt` and `Job.runAt` remain non-negative epoch-millisecond
  instants in the domain and SQLite persistence.
- The scheduler, worker, claims, retries, and provider requests operate only on
  exact instants. They never depend on the server operating-system timezone.
- API and CLI machine contracts use an absolute timestamp: epoch milliseconds or an
  RFC 3339 value with `Z` or an explicit numeric offset. A timezone-less local
  date-time is not an interoperable machine timestamp.

### Project civil-time context

- Each project has one validated IANA timezone identifier used as the default civil
  context for authoring and calendar presentation, for example
  `America/New_York` or `Europe/Paris`.
- This setting is a project/business preference. It is not an environment variable
  and it is not inferred from the server process timezone at runtime.
- The web editor interprets and displays scheduled values in the project timezone by
  default and makes the active timezone visible to the operator.
- A future viewer-local presentation mode may show the same exact instant in the
  operator's local timezone, but it must not change the schedule or become the
  default interpretation of a project schedule without an explicit product change.

### Resolving a schedule

- When a human schedules a one-time publication, Herald resolves the entered local
  date-time using the project's IANA timezone and persists the resulting exact
  instant.
- A human-oriented API operation may accept a local date-time together with an
  explicit IANA timezone. It must resolve it using the same conversion boundary as
  the web editor.
- Once resolved, changing the project timezone never silently moves an existing
  publication. Existing stored instants are preserved. A timezone change must make
  its effect on displayed wall-clock values and future edits explicit.
- The schedule's timezone context may be retained as metadata when needed to explain
  or re-edit the original civil-time intent; this metadata does not replace the
  exact execution instant.

### Daylight-saving transitions

- A local time that does not exist in the selected IANA timezone is rejected and must
  be corrected by the operator.
- A local time that occurs twice is rejected unless the request supplies an explicit
  offset or disambiguation choice. Herald must not silently guess which occurrence
  the operator intended.

### Recurrence boundary

Recurring schedules are not required by this decision's first implementation. If
recurrence is introduced, its civil rule and IANA timezone must be persisted in
addition to each calculated execution instant. Storing only UTC instants cannot
represent a rule such as “09:00 in New York” across daylight-saving transitions.

## Alternatives considered

### Browser or device timezone as the project default

This is convenient for a single operator and requires little code, but it makes a
shared project's schedule depend on the device used to edit it. It was rejected as
the project default; the browser timezone remains a possible explicit display mode.

### UTC-only authoring and display

This is deterministic and machine-friendly, but forces operators to convert business
hours manually and makes the primary human workflow unnecessarily difficult. UTC
remains the exact-time contract, not the sole authoring representation.

### User or actor timezone as the schedule context

This provides personal convenience but gives a shared project no stable civil-time
meaning. It is rejected as the scheduling source of truth.

### Fixed numeric offset instead of an IANA identifier

An offset cannot express daylight-saving or later civil-time rule changes. It may be
used as an explicit instant input, but not as the project's recurring civil-time
identity.

## Consequences

- Project creation and settings gain one validated IANA timezone value.
- The web client needs a shared conversion and formatting boundary rather than
  relying on implicit `Date` behavior.
- Existing epoch timestamps and the durable scheduler remain compact and unchanged.
- A project timezone change affects interpretation and presentation, not the stored
  execution instant. The UI must explain this rather than silently reschedule work.
- DST behavior is explicit and testable instead of being inherited accidentally from
  the browser or server.
- A timezone-capable conversion mechanism is required at the boundary. A fixed
  offset calculation or scattered `Date` calls is not an acceptable implementation.

## Verification requirements

- Validate IANA identifiers at the project boundary.
- Test conversion and formatting in at least `Europe/Paris` and
  `America/New_York` with different device timezones.
- Test project calendar grouping around midnight in the project timezone.
- Test nonexistent and repeated DST local times using the accepted rejection and
  explicit-disambiguation policy.
- Test that changing a project timezone does not mutate existing `scheduledAt` or
  `runAt` values.
- Test that scheduler due-event selection and retries remain timezone-independent.
- Test that API/CLI absolute timestamps cannot be reinterpreted as client-local
  values.
