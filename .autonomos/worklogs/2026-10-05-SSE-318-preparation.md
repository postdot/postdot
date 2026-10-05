# SSE-318 — Preparation: why quiet event streams die

Preparation only. Nothing is fixed here. No transport code, no worker, retry,
timeout, delay, or product behaviour was changed. The only additions are
observation scripts and this record.

## What earlier investigations concluded, and what is actually true

WEB-312 and WEB-314 recorded "the Vite dev proxy breaks event streams", with
`502` and `socket hang up` in the Vite log. The proxy is the messenger. The
cause is upstream of it: **Bun's HTTP server closes any connection that has been
idle for 10 seconds, and Herald's SSE heartbeat interval is 15 seconds.** A
quiet stream is therefore always torn down before the first heartbeat can be
written. The proxy only changes how the failure is *seen*.

## Isolated reproduction

Three scripts, each self-contained and each using its own data directory and
operating-system-assigned loopback ports. No shared path is touched.

```bash
# 1. Runtime in isolation: no Elysia, no Herald module, no product code.
bun scripts/sse-runtime-idle-probe.ts

# 2. Herald API origin versus Vite dev origin, timestamped chunk arrivals.
bash scripts/sse-proxy-repro.sh chunks 40

# 3. Same runtimes, but a real mutation happens after the quiet period.
bash scripts/sse-proxy-repro.sh late-event 14
```

## Evidence

### 1. The runtime closes quiet streams by itself

`bun scripts/sse-runtime-idle-probe.ts` on Bun 1.4.2, a bare `Bun.serve` that
writes one frame and then stays silent:

```
/quiet-sse: status 1ms, first byte 1ms, terminal threw TypeError ECONNRESET at 12003ms
/quiet-body: status 0ms, first byte 0ms, terminal threw TypeError ECONNRESET at 12002ms
2 of 2 quiet responses were torn down by the runtime rather than ending on their own
warn: Bun.serve() timed out a request after 10 seconds. Pass `idleTimeout` to configure.
```

Bun names the mechanism in its own warning. The documentation agrees: `idleTimeout`
defaults to 10 seconds, applies *while a response is being streamed*, and tells
browsers and `fetch` clients to expect a connection reset.

### 2. Herald reproduces it, with the heartbeat interval as the trigger

`apps/api/src/modules/projects/realtime-routes.ts:110` sets
`heartbeatIntervalMs: 15_000`, which is already longer than the runtime's idle
ceiling. Three consecutive runs of `sse-proxy-repro.sh chunks`, identical to the
millisecond:

| Run | Direct to API | Through the Vite proxy |
| --- | ------------- | --------------------- |
| 1 | 324 bytes at 8ms, `ECONNRESET` at 12003ms | 324 bytes at 20ms, still open at 40012ms (our own abort) |
| 2 | 324 bytes at 8ms, `ECONNRESET` at 12003ms | 324 bytes at 20ms, still open at 25001ms (our own abort) |
| 3 | 324 bytes at 7ms, `ECONNRESET` at 12002ms | 324 bytes at 20ms, still open at 25001ms (our own abort) |

No `: heartbeat` frame ever appears on either path, because the connection dies
at ~12s and the first heartbeat is due at 15s. The single frame that does arrive
is the backlog event (`project.created`), which is why a stream *looks* healthy
for the first seconds.

### 3. Through the proxy the same event becomes a 502

`sse-proxy-repro.sh late-event 14` against `/api/notifications/events`:

```
== direct ==
  mutation at 14005ms: project create http 201
  12002ms threw TypeError ECONNRESET
  verdict: nothing arrived after the quiet period

== proxied ==
  mutation at 14003ms: project create http 201
  12010ms headers 502
  12010ms closed by server
  verdict: nothing arrived after the quiet period

vite log: http proxy error: /api/notifications/events
          Error: socket hang up
```

That is the `502` / `socket hang up` signature recorded during WEB-312 and
WEB-314, reproduced in 14 seconds without a browser. The proxy is faithfully
reporting an upstream socket that the API closed.

### 4. A second, quieter defect on the notification stream

In the proxied run the *response headers* arrive at 12010ms carrying `502`; no
`200` was ever delivered. `/api/notifications/events` does not write anything
until it has something to send, so the status line is not flushed on connect.
A browser `EventSource` therefore never fires `open` for that stream while
nothing is pending, which is a second reason dashboard discovery degrades into
long bounded waits. `/api/projects/:id/events` differs only because a backlog
event happens to exist.

## Cause, stated plainly

One defect, with two shapes:

- **Primary.** Bun's default server `idleTimeout` is 10s; the SSE heartbeat is
  15s. Every quiet stream is killed by the runtime. Applies in dev *and*
  production: `apps/api/src/index.ts:273` uses the same `app.listen()` path in
  both environments, and production only adds a static-asset middleware. This is
  not a dev-harness artefact.
- **Consequent.** The dev proxy converts the upstream reset into `502`, which a
  browser `EventSource` treats as a fatal response rather than a retryable
  disconnect. So the browser neither errors nor reconnects, and the application
  falls back to heartbeat-bounded waits with 60–90s timeouts. That is the
  behaviour the earlier missions measured, and it is why the tests needed long
  ceilings and stability sleeps.

A secondary contributor, on the notification stream only, is the absence of an
initial write, so headers never flush.

## Options for the mission, none applied here

The mission owns the decision; these are the candidates with their trade-offs,
recorded so the choice is not made implicitly.

1. **Heartbeat below the ceiling.** Set `heartbeatIntervalMs` under 10s. Smallest
   diff, keeps the runtime default. Cost: a permanent write every few seconds per
   open stream, and it stays fragile against any future lower ceiling.
2. **Disable the idle timeout for stream requests.** `server.timeout(request, 0)`
   on the two stream routes. Correct for long-lived streams, per Bun's own
   guidance. Cost: reaches into runtime-specific behaviour, and Elysia's
   `listen` does not obviously expose Bun's `server` handle, so feasibility must
   be checked first rather than assumed.
3. **Raise the server-wide `idleTimeout`.** Blunt: it changes every route, not
   just streams, and 255s is the ceiling.

Two things this preparation explicitly rules out, because they would hide the
defect rather than fix it: lowering the heartbeat *below* the point where the
stream is genuinely idle just to keep the test alive, and adding client-side
retries or longer waits. Both are the failure mode the audit already rejected.

## Acceptance sketch for the mission

- The runtime probe shows a quiet stream surviving past 15s, with heartbeats
  arriving on both paths.
- `sse-proxy-repro.sh chunks` shows identical chunk arrival sequences for the API
  origin and the Vite origin.
- `sse-proxy-repro.sh late-event` shows the post-quiet event arriving on both
  paths, with no `502` in the Vite log.
- A regression test at the API level asserts the first frame and the heartbeat
  cadence without a browser.
- No change to product semantics, no client-side retry, no lengthened timeout.

## Files added by this preparation

- `scripts/sse-runtime-idle-probe.ts` — runtime isolation, no application code
- `scripts/sse-proxy-repro.sh` — one-shot isolated runtimes, `chunks` or `late-event`
- `scripts/sse-proxy-chunks.ts` — timestamped arrival comparison
- `scripts/sse-proxy-late-event.ts` — post-quiet real-event delivery check

These are diagnostic tools. They are deliberately outside the selector's domain
mapping, so changing one falls back to the full matrix rather than pretending to
know what an observation script affects.