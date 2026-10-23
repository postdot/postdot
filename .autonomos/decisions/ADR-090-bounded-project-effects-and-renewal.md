# ADR-090 — Bound Project Effects and Renew Active Claims

- Status: accepted
- Scope: Publication, reply and first-comment execution within the singleton worker
- Provenance: Owner approval of the complete ISSUE-186 recommendation; WORK-568
- Related decisions: [ADR-003](ADR-003-use-a-single-process-singleton.md), [ADR-006](ADR-006-use-a-next-event-durable-scheduler.md), [ADR-009](ADR-009-fence-external-effects-with-durable-claims.md)
- Supersedes: ADR-009's deferral of lease renewal only

## Context

The serial worker blocked unrelated projects behind any slow external effect.
Reproduction with SQLite established that crossing lease expiry alone did not
reject completion: recovery had to revoke the claim first. Adding overlapping
execution without renewable ownership would let another admission recover a
still-running effect as ambiguous.

## Decision

Keep one Bun process and one logical publication worker. Admit at most two
publication-family effects in total and one per project, shared by publications,
replies and prepared first comments. Rotate project/family candidates after each
admission rather than draining one family's queue first. Refresh project discovery
while effects run; new due work is reconsidered within one second when capacity
is available, subject to event-loop and SQLite availability. A single slow project
therefore cannot occupy both slots. There is no absolute scheduling guarantee
under arbitrary backlog or when both slots are occupied by uncooperative code.

Renew a live claim with one conditional SQLite update that checks running state,
claim token and strictly unexpired lease. Renewal never shortens a lease or revives
an expired/recovered claim. Publications retain a five-minute lease, comments a
two-minute lease; renew at least every 30 seconds (earlier for shorter test leases).
The executor also verifies ownership before finalization. Provider requests and
publication credential/media checkpoint mutations check active ownership.

Use cooperative per-attempt deadlines: fifteen minutes for publication execution,
sixty seconds for replies and first comments. These are runtime defaults, not new
provider limits. Preserve shorter provider request timeouts and durable processing
deferrals. At deadline, abort the effect signal and prevent further dispatch. Keep
the slot, lease heartbeat and shutdown drain until the actual operation settles;
never use a timeout race to hide a still-active remote operation. Its late outcome
is recorded as ambiguous, without automatic retry. Loss of ownership aborts the
signal and fences all completion; ordinary expired-claim recovery remains the
source of durable ambiguity.

Stop closes admission, then awaits every actual active operation before SQLite
closes. No new schema, queue service, process, horizontal execution or provider
side effect is introduced by this decision.

## Alternatives and consequences

- Longer fixed leases alone retain global blocking and merely move the expiry gap.
- Unbounded promises let a busy project exhaust connections and provider limits.
- Separate family pools violate the shared bound and allow project overlap.
- Releasing a slot on timeout can exceed the physical concurrency bound and allow
  SQLite to close beneath an operation that ignored cancellation.
- A blocked event loop can miss renewal. Strict expiry then fails closed; ownership
  is never reconstructed from an in-memory assertion that the operation is alive.
- An operation that ignores cancellation can prolong shutdown. Forced termination
  remains crash recovery, with an ambiguous result after the effect boundary.
