# AUDIT-319 — Inventory of the waits SSE-318 made unnecessary

Preparation for a small, separate pass. Nothing is removed here. No sleep,
timeout, worker, or retry setting is touched, and no assertion is weakened.

Scope: the 14 fixed sleeps and the oversized assertion ceilings that exist
because a quiet event stream was being killed at ten seconds. AUDIT-317 measured
them; SSE-318 fixed the defect that made them necessary.

Status: the WEB-314 tranche is closed; the remaining wait optimizations are carried over
below. The measurement tables earlier in this record describe the state *before*
this pass and are kept as provenance; the "Where this stands" section at the end is
the state that conforms to the code today.

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

## Proposed pass, as first drafted — REPLACED, kept for provenance

**This section is superseded and describes an approach that was rejected in
review.** It is kept so the reasoning that changed is visible, not because it
reflects the code. The applied approach is in "First pass, applied: WEB-314 only"
and in "Where this stands".

The rejected proposal was a universal quiescence helper:

```
await expectQuiescence(() => mutatingRequests, { quietMs: 500 })
expect(mutatingRequests).toBe(mutingAtReconciling)
```

It failed review for two reasons that were confirmed by injection rather than
argument. A 500 ms quiet window completes *before* an undesirable action at 800 ms
or one second, because the query invalidation rounds are scheduled at
`[0, 80, 240, 800]`; the helper would have reported success while the mechanism it
watched was still due. And a window of stillness proves nothing about *why* the
counter stopped moving: the replacement has to name the mechanism that could move
it and assert after that mechanism has run, which is what the applied pass does.

The rest of the drafted section — the per-site table and the ceiling reductions —
was never implemented either. The ceiling reductions remain open work, recorded in
"Carried over, not done".

### Per-site conditions, as drafted and not applied

| Site | Current at the time | Proposed then, superseded now |
| ---- | ------------------- | --------------------------- |
| `web-314` :91, :226 | `waitForTimeout(3_000)` then counter unchanged | real stream event, required observed refetch, then a mechanism-derived observation window |
| `web-314` :113, :342, :363, :600 | `waitForTimeout(5_000)` then counter unchanged | same, except :113, :238 which keep a necessary negative window |
| `web-314` :832 | `waitForTimeout(3_000)` then `membershipRequests === 1` | an observed additional EventSource attempt, then the observation window |
| `web-314` ceilings | `timeout: 60_000` / `90_000`, `setTimeout(300_000)` | not applied; carried over as open work |
| `concurrent-editing` :325 | `waitForTimeout(1_500)` to damp replay | not applied; carried over |
| `concurrent-editing` :348, :359 | `waitForTimeout(700)` | not applied; carried over |

### Acceptance, as drafted

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
| Query invalidation rounds | `project-realtime.tsx` | `[0, 80, 240, 800]` ms, awaited **sequentially**, with each round's refetches inside its own elapsed time |
| Reconnect and resync full invalidation | `project-realtime.tsx` | `refresh('project', true, true)` on reconnect *and* on `resync-required`, including publication editors — a reconnect is the stronger case, not the weaker one |
| Browser EventSource retry | the browser | a fresh attempt a few seconds after a failed stream |

**This is why a generic 500 ms quiet window is wrong rather than merely
optimistic.** The fourth delay is 800 ms, so a window closing at 500 ms has already
reported success while the mechanism it was meant to watch is still due. The window
used here is `SETTLEMENT_OBSERVATION_MS = 1_500`, and it is deliberately *not*
described as covering the rounds: 1.12 s is a floor with no upper bound, and a
reconnect is the stronger case because it also invalidates publication editors.
Every site either proves its mechanism separately or states that its window is
weaker than proof.

### What was replaced, and with what, classified by kind of change

"Replaced" hides three different things. Separated:

**Pauses removed outright** — no time-based wait survives at the site:

| Site | Before | After |
| ---- | ------ | ----- |
| held draft response | `waitForTimeout(3_000)` | `requestfinished` installed *before* `fulfill()`, then a task-queue drain |
| close refusals | `waitForTimeout(3_000)` | an **observed** additional EventSource attempt |

**Pauses moved into a named helper** — the time is no longer chosen per site and
lives once, next to the mechanism it accounts for:

| Site | Before | After |
| ---- | ------ | ----- |
| frozen editor | `waitForTimeout(3_000)` | `driveProjectDataRefresh`: real event, required observed refetch, then `SETTLEMENT_OBSERVATION_MS` |
| removal surface | `waitForTimeout(5_000)` | same helper |
| retry state | `waitForTimeout(5_000)` | same helper |
| deferred reread | `waitForTimeout(5_000)` | same helper |
| reconciled editor | `waitForTimeout(5_000)` | `driveEditorReread`: real draft hint, then the captured request's own completed response, checked for the saved revision, then the observation window |

The observation window is retained inside these helpers, so a call site that shows
no wait has not had its mechanism dropped — the time has moved, not vanished.

**Pauses shortened, and kept as necessary negative windows** — explicitly
labelled as such in the spec:

| Site | Before | After | Why it stays |
| ---- | ------ | ----- | ------------ |
| late response, after the removal surface | `waitForTimeout(5_000)` | `SETTLEMENT_OBSERVATION_MS` (1500 ms) | a purge arrives via a reconnect-driven full invalidation that includes publication editors, reachable only from a `resync-required` frame, which cannot be produced from a browser on demand without corrupting the journal cursor |
| close refusals, after the observed retry | part of `waitForTimeout(3_000)` | `SETTLEMENT_OBSERVATION_MS` | exactly-once cannot be shown by traversal here: nothing can be delivered that would provoke a second membership read without provoking the thing under test |

Two of these traversals were impossible before SSE-318. Driving a real event into
a connected tab requires a connected stream, and the stream used to die after ten
seconds. That is the concrete link between the two missions: the pauses existed
because the mechanism could not be reached.

### The arithmetic, corrected

An earlier draft of this record said the last invalidation round "lands about
1.12 s later" and that 1500 ms therefore covers it with margin. That was wrong in
a way that mattered. `reconnectRefreshDelays = [0, 80, 240, 800]` is a **sequential
loop**: each delay is awaited, and then that round's invalidations are awaited
before the next delay starts. The four rounds therefore occupy at least
0 + 80 + 240 + 800 ≈ 1.12 s *plus* the refetches each round triggers, and there is
no fixed upper bound on that.

So the constant is renamed `SETTLEMENT_OBSERVATION_MS` and documented as an
**observation window, not a bound**. No assertion rests on it alone: every site
either observes the mechanism it cares about — a required refetch, a required
reread, an observed stream retry — or is labelled as a window whose limit is
explicitly weaker than proof.

### Two proofs that had to be rebuilt

**Network receipt versus application of the continuation.** `requestfinished` is
installed before `fulfill()` so the event cannot be missed by a race. Receipt is
explicitly *not* treated as application.

An intermediate version drained the page's task queue after receipt and called
that an execution-model barrier proving the continuation had run. That claim was
withdrawn on review, and it was weaker than it sounded: the continuation returns
early **by design**, so when it does the right thing it leaves no trace at all,
and no amount of draining reveals it. There is no reliable observable witness here.
So no instrumentation was added to manufacture one. Instead:

- what is observable is used: `requestfinished` for receipt, and the paired control
  that earlier in the same scenario the same save path applied an acceptable
  response and produced a visible `Saved` state, which makes `Saved` a real positive
  signal for application;
- what is not observable becomes an explicitly limited negative window before the
  applied outcomes are checked, labelled as weaker than proof;
- the task-queue drain helper was deleted rather than left behind as decoration.

The first attempt at an adapted proof used a sentinel value injected into the
response payload. It was abandoned on evidence too: with the sentinel delivered
while the machine was *not* frozen — the case where a response really is applied —
the sentinel never rendered. The field is not one this page displays in this
scenario, so its absence would have been a false guarantee. The conflict surface
and the recovery-buffer count are kept as guards, and labelled as guards, because
their reachability here was not demonstrated.

**The reread is tied to one request, and to its content.** `driveEditorReread`
originally performed the owner's save and waited. It now captures the specific
`Request` object of the first editor read that starts, awaits *that* request's own
response and its completion, and then checks that the body carries the revision
the owner's save produced.

Two failures were found by injection rather than by reading. An earlier version
counted read starts and awaited a generic `requestfinished`; it passed even with
stream delivery cut, because a read already in flight could satisfy a completion
wait. And the first cut-signal injection was itself wrong: `page.route` only affects
subsequent requests, so aborting after the stream had connected cut nothing. With
delivery cut before the connection, the helper fails with its own message.

The stale-response guard was then verified directly: with the new read held open
while older reads completed, the helper did not report delivery from the old
completion, and rejected the held response on its revision — the check that a stale
body cannot stand in for a fresh one.

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

Re-run after the review corrections, on the corrected code:

| Site | Injected action | Injected at | Result |
| ---- | --------------- | ----------- | ------ |
| frozen editor | extra draft PATCH | 800 ms | fails |
| frozen editor | extra draft PATCH | 1000 ms | fails |
| deferred reread | extra mutating request | 800 ms | fails |
| stream delivery cut before connect | no delivery at all | — | `driveEditorReread` fails with its own message |
| sentinel delivered pre-freeze | payload sentinel | — | abandoned: the sentinel does not render, so it could not prove anything |

And the control, which is the point of the whole exercise: the naive replacement
the owner rejected — a bare 500 ms quiet window, no traversal — **passed** with an
undesirable mutating request injected at 800 ms and again at 1 s. The window closed
and reported success while the mechanism was still scheduled to fire.

The traversal helpers also require the observed refetch, so a stream that silently
stops delivering fails the helper rather than turning a negative assertion into a
vacuous pass.

### Before and after

| | Wall | Scenarios | Waits at call sites | Waits retained in helpers | Largest ceiling |
| - | ---- | --------- | ------------------- | -------------------------- | --------------- |
| Before | 107 s | 6 passed | 8, totalling 34.0 s | 0 | 300 s |
| After, first pass | 84 s, 86 s | 6 passed, twice | 0 | 5 | unchanged |
| After, review corrections | 90 s, 88 s | 6 passed, twice | 0 | 5 | unchanged |
| After, final corrections | 88 s | 6 passed | 0 | 5 | unchanged |

The honest reading of the last two columns: eight site-level waits of 34.0 s became
five windows of 1.5 s that live in the helpers and are documented there. That is a
reduction, not an elimination, and nothing here should be read as "no waits
remain".

Two consecutive runs per stage, zero flakes. The saving is roughly 20 s of wall
time; the larger change is that the negative assertions now run *after* the
mechanism they watch, or are labelled as windows whose limit is weaker than proof.
The review corrections cost about 5 s because the task-queue drains and the two
required observations are real waits for real signals.

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

## Where this stands after the WEB-314 tranche

The original inventory measured 14 fixed sleeps and 49 ceilings across four spec
files. After this pass, measured statically from the code:

| Spec | Waits at call sites | Windows retained in helpers | Ceilings | Largest ceiling |
| ---- | ------------------- | -------------------------- | -------- | --------------- |
| `web-314-editor-access-state.spec.ts` | 0 | 5 (7.5 s) | 36 | 300 s |
| `publication-concurrent-editing.spec.ts` | 3 (2.9 s) | 0 | 6 | 90 s |
| `realtime-validation.spec.ts` | 2 (2.8 s) | 0 | 9 | 90 s |
| `design-121-shell.spec.ts` | 1 (0.1 s) | 0 | 2 | 30 s |
| **Total** | **6 (5.8 s)** | **5 (7.5 s)** | **53** | **300 s** |

So 8 of the 14 original sleeps are gone and 5 windows of 1.5 s replaced them. Ceiling
counts rose from 49 to 53 because the traversals added explicit per-observation
budgets; none of the pre-existing ceilings was touched. The honest reading is that
the waits moved and shrank, not that they disappeared.

## Conclusions that were replaced

Kept as provenance, explicitly superseded:

| Earlier statement | Superseded by | Now |
| ----------------- | ------------- | ---- |
| "The vite proxy kills event streams (502 / socket hang up)" — AUDIT-317 finding 5 | SSE-318 | Bun's idle ceiling closed quiet streams upstream; the proxy reported the reset |
| "the event stream dies at the proxy (502)" — WEB-314 worklog | SSE-318 | same correction, recorded in that worklog and in this one |
| "The dev proxy tears the event stream down repeatedly, which makes the open tab refetch far more often" — `web-312` spec header | SSE-318 | corrected in the spec file itself; those refetches no longer occur |
| "14 fixed sleeps … 39.8 s (2.9% of wall) across 4 of 83 spec files" — AUDIT-317 | this pass | 6 waits at call sites (5.8 s) plus 5 windows in WEB-314 helpers (7.5 s) |
| "REFRESH_BURST_SETTLE_MS = 1500, derived as the 800 ms round plus the request it causes, with margin" — first pass of this record | review | the delays are sequential and include the awaited refetches; 1.12 s is a floor with no upper bound, and the constant is an observation window |
| "draining the page's task queue proves the continuation ran" — first pass of this record | review | the continuation returns early by design and leaves no trace; the claim was withdrawn and the helper deleted |
| "a sentinel payload proves a late success was not applied" — first pass of this record | review | the field does not render in this scenario, so its absence proved nothing |

## Carried over, not done

Explicitly deferred, in the order that seems safest:

1. **`publication-concurrent-editing.spec.ts`, 3 waits totalling 2.9 s.** The
   1.5 s one is the clearest SSE-318 casualty: its own comment says it exists to
   let journal replay refresh retries settle, and that storm came from a stream
   that could not stay connected. The two 700 ms ones are negative windows over a
   hidden tab and an offline save, so they need the same treatment WEB-314 got:
   name the mechanism, then assert after it has run. Low value in wall time, real
   value in honesty.
2. **The 53 ceilings, none of which was reduced.** WEB-314 alone sums to 54 min
   against a 1.4 min run. They were sized to outlast a dead stream. Shrinking them
   is a separate measurement: run the scenario, record the observed duration per
   assertion, then set a bound from that with margin. Doing it without measuring
   would just move the failure mode from "slow to notice" to "flaky".
3. **`realtime-validation.spec.ts` (2 × 1.4 s) and `design-121-shell.spec.ts`
   (50 ms) are out of scope and should stay that way.** The first compensates for
   a *faked* `EventSource`, not the transport; the second is a viewport settle.
   Neither is an SSE-318 casualty, and touching them would be churn.
4. **The 5 retained windows in WEB-314.** Two are necessary negative windows whose
   mechanism cannot be produced on demand (`resync-required`; exactly-once
   verification). The other three are the price of the traversals. If they are ever
   attacked, the attack has to come with the traversal it would invalidate.
