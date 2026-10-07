# ADR-083 — Active Channel Execution Summary

- Status: accepted
- Date: 2026-10-07
- Owner decision: enriched channel list approved in the UX-340 conversation.
- Related: UX-244, UX-340, ADR-082

## Context

Custom profile identity is caller-owned and does not determine execution. The
channel list exposed identity and active profile version, but connection setup
was chosen by identity. A custom manual channel was consequently offered an HTTP
connection which the server correctly rejected.

## Decision

Enrich `GET /api/projects/:projectId/channels` items with an `execution` summary
from the profile version referenced by the channel. Return the kind (`manual`,
`declarative_http`, `built_in`) and a contract identifier only for built-in
execution. Keep the Channel entity, creation and lifecycle responses unchanged.
No new persisted field or migration is required.

Connection presentation uses the active execution summary. Manual channels do
not require publishers. Declarative HTTP profiles use the existing HTTP setup;
built-in contracts use their matching provider setup. Unknown built-in contracts
do not acquire an HTTP fallback. Profile identity remains useful for labels and
avatars. Authorization and server-side publisher compatibility remain unchanged.

## Alternatives and consequences

Fetching profile state per row would preserve the response contract, but add one
request per channel, redundant full definitions and extra UI failure/loading
states. The enriched list was selected explicitly by the owner.

List summaries exclude draft versions, HTTP configuration and authentication
bindings. Consumers must retain enriched list metadata when an entity response
updates a row, or reload the list. Creation reloads the list instead of guessing
execution from the submitted profile or mutation response.

This is a readiness read model, not a new publication or migration policy.
Authoring capabilities still belong to profile capabilities and field bindings;
this summary does not replace them.
