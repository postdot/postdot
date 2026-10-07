# UX-244 — Channel Readiness Review

- Base: `6cf361ea0`.
- Status: bounded diagnosis complete; UX-244 remains in progress.

## Reproduced defect

Creating the supplied custom manual and custom webhook starters succeeds through
actual API routes. Their active profiles report execution kinds `manual` and
`declarative_http`, respectively. The manual channel nevertheless displays
“Needs connection”, advice to connect a declarative HTTP endpoint, and “Connect
HTTP”. This is false guidance, not a missing credential.

Connecting that manual channel through the offered custom HTTP route returns
400 `invalid_connection`. The same request on the webhook channel returns 200
and changes its row to “Connected”. The endpoint is `https://destination.invalid`
and authentication is `none`; no provider request or real credential is involved.
The manual row still incorrectly requires a connection after reload.

## Cause and correction boundary

`channel-row.tsx` identifies manual readiness only by `manual-message` identity.
`publisher-connection-panel.tsx` similarly treats every non-built-in identity as
an HTTP connection candidate. Custom profile identities do not define execution.
The publisher store already checks the compiled execution contract and correctly
rejects HTTP connections for manual profiles. Preserve that server guard.

The channel summary currently exposes profile identity and version but not
execution. UX-340 must determine an appropriate existing read-model source for
active execution before changing readiness and actions. Adding `custom-manual`
as another name exception would leave user-defined names and later profile
versions incorrect. Custom copies of built-in profiles may have a similar
identity-versus-contract mismatch, but this review did not reproduce that case.

## Evidence and validation

A temporary isolated browser probe exercised actual starter creation, active
profile reads, both connection responses and resulting row states. The manual
row has no document overflow at 1280, 820 and 390 pixels; its narrow screenshot
was inspected. Layout is readable, but the instruction itself is wrong.

The two retained `publisher-connection-recovery` scenarios pass: revoked DEV.to
readiness exposes its repair action, and repair from publication detail preserves
content and execution. These do not establish correctness for every provider,
viewer, archived channel or settings scope.

Initial probe plus neighboring scenarios: 3 passed in approximately one minute;
the probe itself took 6.9 seconds. An additional probe run strengthened the
active execution check from a textual observation to an exact property assertion.
No production file changed. The temporary probe is removed after completion;
UX-340 should retain a regression for corrected behavior. Delivery is documentary:
static checks only, no full matrix replay, and `validated/full` remains on the
base commit.

## Next step

UX-340: derive readiness and connection choices from the active execution
contract, preserving authorization and compatible publisher behavior. UX-244
cannot be closed while a valid manual channel is presented as broken.
