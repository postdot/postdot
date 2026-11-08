# UX-277 — Touch and composition regression

## Scope

Continue the existing editor-readiness task without adding features. Use Chromium
composition commands to commit Japanese text into the configured editor; verify
exact serialized output, emoji insertion at the committed cursor and restored
focus. Exercise destination switching through actual emulated touch events at
390 pixels and retain both shared copy and formatted destination adaptation.

This is browser-level composition and touch emulation, not evidence from a
physical mobile keyboard or a real operating-system input method. Those checks
remain open under UX-277. No editor feature or production code is changed.

## Evidence

Focused browser journey passed. The first run expected plain Discord output but
the laboratory starts with bold content; replacing its text correctly retains
that mark. The test now checks the exact bold serialization before and after
scope switching, rather than stripping or ignoring formatting. Composition text
is committed exactly once and emoji insertion restores editor focus.

Full `bun run check` passed: 64 main browser journeys, two password-reset
journeys and 17 build tasks. Log: `/tmp/postbot-touch-check.log`.

## Files and continuation

Added `e2e/editor-touch-composition.spec.ts`; linked this evidence from TASKS.md.
OPS-271 is complete. Existing lifecycle/browser tests cover planned, manual,
failed and ambiguous workflows, but UX-250 remains a broader review task, not
closed by this editor regression. Continue with physical-device editor evidence
when available and bounded populated lifecycle reviews.
AGENT.md unchanged: existing evidence and interface rules remain applicable.
