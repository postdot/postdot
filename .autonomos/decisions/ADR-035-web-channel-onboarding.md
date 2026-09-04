# ADR-035 — Keep channel onboarding and lifecycle in one web management surface

- Status: accepted
- Date: 2026-09-05
- Scope: authenticated web channel management for `CHANNEL-67`
- Related issue: [ISSUE-033](../ISSUES.md#issue-033-complete-web-onboarding-and-lifecycle-for-runtime-defined-channels)
- Related task: CHANNEL-67

## Context

Herald supports built-in channel profiles and bounded runtime-defined profile
definitions. The server now owns channel lifecycle state, profile revisions,
blockers, and audit events. The web application must expose those contracts
without creating a client-side channel model or hiding a destructive operation
behind an optimistic visual update.

## Decision

- Use one authenticated Channels surface for creation, profile management,
  publisher connection, and channel lifecycle actions.
- Keep built-in creation options visible for the known profiles and provide a
  custom profile JSON editor with documented starter templates. The server
  remains the authority for profile validation; the client only parses JSON
  enough to report malformed input before sending it.
- Treat profile changes as an explicit draft, preview, and activate sequence.
  Saving a draft never activates it, and activation displays the server's
  impact assessment before the user confirms it.
- Expose rename, archive, restore, and delete through a per-channel action
  menu. Each mutation sends the channel revision observed by the client. A
  server conflict remains visible and includes its machine-readable blockers.
- Keep archived channels visible for history and restoration, but exclude them
  from new publication authoring and publisher/OAuth actions in the web UI.
- Offer the existing custom HTTP publisher connection contract for runtime
  profiles without changing the provider or credential model.

## Alternatives considered

- **Separate settings pages for every channel concern:** rejected because it
  hides the relationship between a channel, its profile, its publisher, and its
  lifecycle state.
- **A fully visual schema builder:** deferred because runtime profiles can
  express arbitrary bounded JSON Schema and mappings. A structured JSON editor
  preserves the complete contract without inventing a lossy subset.
- **Client-side lifecycle state transitions:** rejected because archive/delete
  blockers, revisions, and audit events are server-owned invariants.
- **Automatically activate a saved profile draft:** rejected because profile
  activation can require review of existing drafts and scheduled targets.

## Consequences

- The page has more than one dialog, but each dialog has one focused operation
  and shares the existing Base UI primitives.
- Custom profile authors can start from a valid template and still edit the
  complete runtime contract.
- The next UI iteration can replace the JSON editor with richer controls while
  keeping the same API and profile lifecycle boundary.
