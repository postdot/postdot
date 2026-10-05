# AUDIT-319 — Inventory of the waits SSE-318 made unnecessary

Preparation for a small, separate pass. Nothing is removed here. No sleep,
timeout, worker, or retry setting is touched, and no assertion is weakened.

Scope: the 14 fixed sleeps and the oversized assertion ceilings that exist
because a quiet event stream was being killed at ten seconds. AUDIT-317 measured
them; SSE-318 fixed the defect that made them necessary.

## What the numbers say

Across the four specs that hold fixed waits:

| Spec | Sleeps | Total sleep | Ceilings | Largest ceiling | Sum of ceilings |
| ---- | ------ | ----------- | -------- | --------------- | --------------- |
| `web-314-editor-access-state.spec.ts` | 8 | 34.0s | 32 | 300s | 3135s |
| `publication-concurrent-editing.spec.ts` | 3 | 2.9s | 6 | 90s | 385s |
| `realtime-validation.spec.ts` | 2 | 2.8s | 9 | 90s | 310s |
| `design-121-shell.spec.ts` | 1 | 0.1s | 2 | 30s | 60s |
| **Total** | **14** | **39.8s** | **49** | **300s** | **3890s** |

Two readings matter. First, the sleeps are 39.8 s against a 19.4 min suite, so
removing all of them buys about 3% of wall time — this pass is about *honesty of
the assertions*, not speed. Second, the ceilings sum to 65 min against 19.4 min
observed, so they never shortened a passing run either; what they did was make a
regression take minutes to surface instead of seconds. That is the real cost, and
it is invisible in the timing log.

## Classification, by what each wait is actually for

The 14 sleeps are not one thing. Only some of them exist because of the dead
stream.

### A. Compensating for the dead stream — candidates for removal

| Site | Value | Why it exists |
| ---- | ----- | ------------- |
| `web-314` :91, :226, :832 | 3s each | Let the editor settle after an in-band signal before asserting no extra draft patch or exactly one membership read. These windows were sized against a signal that only arrived through a long bounded wait. |
| `web-314` :113, :238, :342, :363, :600 | 5s each | The same shape after a refusal, a resync, a conflict, or a deferred reread. The spec comments say it directly: background refetches "share the membership endpoint in flap-heavy environments". |
| `concurrent-editing` :325 | 1.5s | Commented "let the existing journal replay refresh retries settle". The replay burst it was damping came from the stream reconnecting and replaying repeatedly. |

Web-314's paired ceilings are the clearest signal. `timeout: 60_000` and
`timeout: 90_000` appear on assertions whose expected value was "the surface
eventually settles". With the stream alive the in-band signal is the trigger, so
the ceiling should be the default and the assertion should pass on the first
delivery. `test.setTimeout(300_000)` on one scenario is in the same class.

### B. Negative and quiescence windows — keep, but make observable

| Site | Value | What it proves |
| ---- | ----- | -------------- |
| `web-314` :91 | 3s | `draftPatchRequests` did not grow: no repeat write after the reveal. |
| `web-314` :113, :342 | 5s | `draftPatchRequests` and the recovery-buffer count did not change: no self-recovery, no second dispatch. |
| `web-314` :600 | 5s | `mutatingRequests` did not grow: nothing restarts while the reread is deferred. |
| `web-314` :832 | 3s | `membershipRequests` is still 1: one verification, not two. |
| `concurrent-editing` :348 | 700ms | `reads` is still 0: a hidden tab does not reread. |
| `concurrent-editing` :359 | 700ms | Offline save window: the client does not lose local work while disconnected. |

These are not "wait for something to appear". They are "prove nothing happened
during a window", which no positive assertion can express. They are also not
SSE-318 casualties — they would be needed even with a perfect stream. Shortening
them would weaken them.

### C. Unrelated to the transport — leave alone

| Site | Value | Why |
| ---- | ----- | --- |
| `realtime-validation` :57, :77 | 1.4s each | This spec installs a **fake** `EventSource`. The sleeps wait for the refetch burst the fake produced, so they are fake-transport timing, not proxy timing. |
| `design-121-shell` :156 | 50ms | A viewport resize settle before an overflow assertion. Nothing to do with SSE. |

## Proposed pass: observable conditions instead of fixed pauses

Scope: category A and the category-B ceilings. Two files, no behaviour change to
the product.

### The condition that replaces a pause

A soak window becomes observable when the thing being watched has a counter that
must stop moving. Every category-B assertion already has one
(`draftPatchRequests`, `mutatingRequests`, `membershipRequests`, `reads`). So the
replacement is a helper that waits for **quiescence** rather than for a duration:

```
await expectQuiescence(() => mutatingRequests, { quietMs: 500 })
expect(mutatingRequests).toBe(mutingAtReconciling)
```

where `expectQuiescence` polls the counter until it has been unchanged for
`quietMs`, and fails if it keeps moving within a bounded budget. The window is
then *derived from observed behaviour* — 500 ms of genuine stillness — instead of
being a 5 s guess that is either too short on a slow machine or too long on a
fast one. A regression that starts a polling loop now fails loudly at the budget
instead of being absorbed by a long sleep.

### Per-site conditions

| Site | Current | Proposed observable condition |
| ---- | ------- | ------------------------------ |
| `web-314` :91, :226 | `waitForTimeout(3_000)` then counter unchanged | quiescence on `draftPatchRequests` (quiet 500 ms, budget 3 s) |
| `web-314` :113, :342, :363, :600 | `waitForTimeout(5_000)` then counter unchanged | quiescence on the counter already asserted (quiet 500 ms, budget 5 s) |
| `web-314` :832 | `waitForTimeout(3_000)` then `membershipRequests === 1` | `expect.poll(() => membershipRequests).toBe(1)` for the arrival, then quiescence for the absence |
| `web-314` ceilings | `timeout: 60_000` / `90_000` | default expect timeout; `test.setTimeout(300_000)` reduced to the observed duration plus margin |
| `concurrent-editing` :325 | `waitForTimeout(1_500)` to damp replay | drop it; assert the replay count directly, so a repeated replay is a failure rather than something the sleep hides |
| `concurrent-editing` :348, :359 | `waitForTimeout(700)` | quiescence on `reads`, and an offline assertion that does not depend on elapsed time |

### Acceptance, all observable

1. Every category-A and category-B pause is gone; `waitForTimeout` survives only
   in category C, and each survivor carries a comment saying why.
2. Summed ceilings in the touched specs fall below their observed runtime by a
   stated factor, recorded in the worklog.
3. Each touched spec passes standalone **twice**, and passes again under the
   selector's targeted set, with zero flakes.
4. `realtime-validation` and `design-121-shell` are not modified.
5. A deliberately introduced polling loop fails each replaced assertion inside its
   budget. Without this, "the wait is gone" could just mean "the test stopped
   noticing". This is the criterion that makes the pass honest.

### What this pass must not do

- No retry, no lengthened wait, no worker change.
- No assertion weakened from "exactly once" to "at least once".
- No combining with the SSE removal itself: SSE-318 is already landed, and this
  pass only removes what it made redundant.

## First pass, applied: WEB-314 only

The mechanism question decided the shape of the replacements, and the answer came
from the code rather than from taste.

### The mechanisms that could produce the forbidden action

| Mechanism | Where | Shape |
| --------- | ----- | ----- |
| Autosave debounce | `publication-editor.tsx` | one `setTimeout(…, 650)`, re-armed on each dirty transition |
| Save promise continuation | `publication-editor.tsx` | `.then/.catch/.finally`, **no timer**, guarded by `accessEpoch` and generation |
| Query invalidation rounds | `project-realtime.tsx` | `[0, 80, 240, 800]` ms after any event or reconnect, so the last round is at +800 ms |
| Reconnect full invalidation | `project-realtime.tsx` | `refresh('project', true, true)` on reconnect, including publication editors |
| Browser EventSource retry | the browser | a fresh attempt a few seconds after a failed stream |

**This is why a generic 500 ms quiet window is wrong rather than merely
optimistic.** The last invalidation round fires at +800 ms. A window that closes
at 500 ms has already reported success while the mechanism it was meant to watch
is still scheduled to run. The budget used here is `REFRESH_BURST_SETTLE_MS =
1_500`, derived as "the 800 ms round plus the request it causes, with margin",
and every site that uses it first proves the mechanism actually ran.

### What was replaced, and with what

| Site | Before | After |
| ---- | ------ | ----- |
| held draft response, `waitForTimeout(3_000)` | pause | `waitForEvent('requestfinished', …)` on the draft PATCH — the continuation has no timer, so request completion is the exact moment it becomes runnable |
| frozen editor, `waitForTimeout(3_000)` | pause | owner renames a channel → real `project.update` on the live stream → observed refetch on the observer → counter asserted |
| removal surface, `waitForTimeout(5_000)` | pause | same traversal, a second time |
| retry state, `waitForTimeout(5_000)` | pause | same traversal; the membership count is deliberately not asserted here, see below |
| reconciled editor, `waitForTimeout(5_000)` | pause | owner saves the same draft → real `project.draft-changed` → the editor really is reread |
| deferred reread, `waitForTimeout(5_000)` | pause | same traversal while the reread is held |
| close refusals, `waitForTimeout(3_000)` | pause | wait for an **observed** additional EventSource attempt, then the derived budget |

Two of these traversals were impossible before SSE-318. Driving a real event into
a connected tab requires a connected stream, and the stream used to die after ten
seconds. That is the concrete link between the two missions: the pauses existed
because the mechanism could not be reached.

### The one window kept, and why

The late-draft-response scenario keeps a bounded wait before re-asserting the
removal surface and the buffer count. The forbidden action there is a purge caused
by a reconnect-driven **full** invalidation that includes publication editors, and
that invalidation is only reachable from a `resync-required` frame. A frame cannot
be produced from a browser on demand without corrupting the journal cursor, so
absence cannot be proven by traversal. What is done instead is bounding the
observation by the mechanism that would carry it: the resync path uses the same
`[0, 80, 240, 800]` ms rounds, so the budget outlives the last of them. This is
recorded as a known limit, not presented as equivalent.

### One assertion deliberately withdrawn

In the retry scenario the membership read count is no longer asserted. Every
project-data refetch reads membership as part of loading project data —
`loadProjectData` calls `getProjectMembership` in `dashboard-context.tsx` — so on a
live stream that endpoint cannot separate a verification launch from a background
read, and the first version of this pass failed exactly there (`1` became `3`).
Counting it measures the refresh rounds, not the retry. Exactly-once verification
is measured where it is measurable: in the scenario that cuts both streams, where
membership reads can only come from verification, and in the reducer unit tests.
Withdrawing it is honest; leaving it would have been a false guarantee.

### Verification by injection

A temporary shaft scheduled an undesirable request from the page and was never
committed. Results, all on this spec:

| Site | Injected action | Injected at | Result |
| ---- | --------------- | ----------- | ------ |
| frozen editor | extra draft PATCH | 500 ms | fails, 1 → 2 |
| frozen editor | extra draft PATCH | 800 ms | fails, 1 → 2 |
| frozen editor | extra draft PATCH | 1000 ms | fails, 1 → 2 |
| deferred reread | extra mutating request | 800 ms | fails, 1 → 2 |
| close refusals | second membership read | 800 ms | fails, 1 → 2 |

And the control, which is the point of the whole exercise: the naive replacement
the owner rejected — a bare 500 ms quiet window, no traversal — **passed** with an
undesirable mutating request injected at 800 ms and again at 1 s. The window closed
and reported success while the mechanism was still scheduled to fire.

The traversal helpers also require the observed refetch, so a stream that silently
stops delivering fails the helper rather than turning a negative assertion into a
vacuous pass.

### Before and after

| | Wall | Scenarios | Fixed waits | Largest ceiling |
| - | ---- | --------- | ----------- | --------------- |
| Before | 107 s | 6 passed | 8, totalling 34.0 s | 300 s |
| After | 84 s, 86 s | 6 passed, twice | 0 | unchanged |

Two consecutive runs, zero flakes. The saving is 23 s of wall time; the larger
change is that three of the six negative assertions now run *after* the mechanism
they watch, instead of hoping it fired inside a window.

Not touched: the `60_000` and `90_000` positive ceilings and the `300_000` scenario
budgets. Shrinking those is a separate measurement, and the user directed that this
pass stay limited to WEB-314's waits.

## Cost and risk

Expected saving is small — roughly 39.8 s of sleep and, more importantly, ceilings
that stop masking regressions. Risk is concentrated in web-314's 34 s, which is
where the compensating pattern is densest; that file should be done alone, with
its own before/after runs, rather than in a batch with the 2.9 s in
concurrent-editing.

## Files

- `e2e/web-314-editor-access-state.spec.ts` — 8 sleeps, 32 ceilings
- `e2e/publication-concurrent-editing.spec.ts` — 3 sleeps, 6 ceilings
- Unchanged by design: `e2e/realtime-validation.spec.ts`, `e2e/design-121-shell.spec.ts`
