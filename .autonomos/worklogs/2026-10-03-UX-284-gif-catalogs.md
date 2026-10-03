<!-- cspell:words KLIPY -->

# UX-284 — External GIF catalogs for Herald

## Scope

Owner chose catalog assessment before animated-import implementation. Compare
current official documentation, without credentials, registrations, provider
contacts or catalog integration. Research is not a provider agreement.

## Comparison

| Candidate | Production access | Important constraint | Fit today |
| --- | --- | --- | --- |
| Tenor | Closed API | Google sunset it June 30, 2026 | Exclude |
| GIPHY | Review and pricing discussion; beta is 100 calls/hour | Standard integration forbids caching media/URLs and proxying; direct client calls and branding required | Conditional, needs explicit authorization for scheduled cross-platform publishing |
| KLIPY | Test key 100 calls/hour; request production approval | Standard integration forbids mirroring and server proxying; preserve delivery URLs/results; required branded search placeholder | Conditional, needs written approval for Herald's delivery workflow |

KLIPY advertises optional ads and unlimited approved production calls. The public
pages reviewed do not establish a guaranteed free contract for Herald's specific
self-hosted, scheduled, multi-platform use. Do not confuse unlimited request
count with a guaranteed price or unrestricted redistribution license.

## Why this is more than an editor plugin

Inference from provider requirements and Herald's delivery model: selecting a GIF
is not enough. Herald normally stores media bytes, schedules delivery, and uploads
bytes to a destination. The standard catalog policies conflict with retaining
and later fetching selected assets through Herald. Saving only a URL is not a
universal workaround: even media-URL retention is constrained in GIPHY's docs,
and links do not automatically become native media on social platforms.

Neither an editor extension nor a permissive SDK license grants media rights or
an approved server delivery architecture. General API access also does not
settle business use of individual third-party content.

Client-side search exposes the query and client IP to the selected provider;
media previews add CDN requests. A server proxy would alter that exposure but is
not permitted by the standard integrations. No proxy was introduced.

## Recommendation

Do not choose a default provider or ship a decorative picker yet. KLIPY and GIPHY
are credible candidates for a commercial/custom integration discussion, not
currently approved drop-in dependencies for Herald's workflow.

For either candidate, resolve these concrete questions before implementation:

1. May Herald retain selected IDs/URLs and fetch/download assets at scheduled
   publication time, then upload to LinkedIn, Discord, Mastodon, X or DEV.to?
2. May private/self-hosted instances use per-instance credentials without a
   publicly reachable Herald domain? Is each instance separately reviewed?
3. What are production cost, quotas and optional-ad terms for this use?
4. What attribution must survive in the picker and in destination publications?
5. What retention, removal, rights and unavailable-media obligations apply?

No blanket product policy or provider selection was adopted. The implementation
remains deferred pending a compatible provider agreement, or an owner decision
to use independently sourced/imported GIFs instead. UX-283 stays proposed.

## Primary references checked October 3, 2026

- [Google's Tenor sunset notice](https://support.google.com/tenor/answer/10455265?hl=en)
- [GIPHY integration and caching requirements](https://developers.giphy.com/docs/)
- [GIPHY production pricing](https://support.giphy.com/hc/en-us/articles/10390181572762-Is-there-a-fee-for-using-GIPHY-s-SDK)
- [GIPHY API terms](https://support.giphy.com/hc/en-us/articles/360028134111-GIPHY-API-Terms-of-Service)
- [KLIPY integration requirements](https://docs.klipy.com/)
- [KLIPY production access and optional ads](https://klipy.com/developers)
