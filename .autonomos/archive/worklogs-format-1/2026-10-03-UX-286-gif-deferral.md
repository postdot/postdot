# UX-286 — GIF catalog deferral

## Owner decision

Defer external GIF catalogs and optional animated-media features. The expected
quick addition requires provider contracts, instance configuration and a delivery
pipeline beyond a picker. Core publication workflows take priority. This closes
the research decision without choosing a provider; the pending provider-choice
question is superseded. Do not pivot to a GIF editor or local imports as a
substitute for the requested catalog.

## Conclusions retained

- Branding and provider-specific presentation requirements are manageable costs,
  but must be assessed alongside Postbot accessibility and interface conventions.
- GIPHY beta limits attach to an API key, not independently to every browser.
  Multiple people sharing one instance key share its allowance. Do not promise
  per-browser quotas or guaranteed free production access for either provider.
- A future approved integration should be disabled by default and configured by
  the administrator through the UI, with settings stored in the database rather
  than requiring environment variables. Direct-client keys remain visible to
  the client; database storage does not make such a key server-only.
- Standard provider terms do not establish authorization for Postbot retaining
  selections, retrieving bytes later on the server and uploading them to social
  destinations. This is an unresolved contract fit, not a finding that every
  external publication is categorically illegal. Cache permission alone may not
  authorize destination redistribution; individual media rights remain separate.
- Open-source code does not create different legal obligations from proprietary
  software. Permissive SDK code licenses do not grant catalog content rights.
- No provider integration, registration, subscription or contact was made.

## Reopening criteria

UX-287 remains an open deferred task linked to the
[provider assessment](2026-10-03-UX-284-gif-catalogs.md). Reopen when core readiness
and product priority justify the feature, and verify an explicit compatible
contract for self-hosted instances, retained selections, delayed retrieval,
upload to destinations, attribution, removal obligations and production costs.
Provider contact requires separate authorization. UX-283 is also deferred;
animated delivery is not a prerequisite for the current static-media workflow.

## Core continuation recommendation

1. OPS-271: repair safe API development restarts without deleting runtime locks.
2. UX-277: complete editor keyboard/composition, touch and scope-switching review;
   distinguish simulated checks from physical-device evidence.
3. UX-250: finish existing-publication lifecycle review and failure recovery.

These are existing tasks, not authorization for new account, hosting or provider
architecture. Start with reliable development restarts before another UI pass.

## Evidence and routing

Updated TASKS.md and linked the research report to this owner disposition.
Documentation-only change; spelling and diff checks suffice, with no application
behavior changed. AGENT.md is unchanged: existing scope and decision rules cover
this deferral. Reassessment is a backlog task rather than a blocking dependency.
