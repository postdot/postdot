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

## Existing primitives

GIPHY's official JavaScript monorepo is MIT-licensed and offers React components,
framework-independent UI components and a fetch-only package. Its README states
that the UI SDK sends analytics events; the fetch-only option does not include
SDK analytics. Client requests still expose their normal network information.
The package license does not override catalog/API terms. If GIPHY is approved,
assess these primitives before building a picker from scratch; preserve Herald's
shared input, tooltip and popover material rather than importing unrelated UI.

The reviewed KLIPY repository and docs provide integration examples. They do not
establish an equivalent production-ready React picker with Herald's keyboard,
focus, loading and reduced-motion requirements. Do not infer that none exists;
that verification belongs after provider approval.

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

- [Official GIPHY JavaScript primitives and license](https://github.com/Giphy/giphy-js)
- [KLIPY integration examples](https://github.com/KLIPY-com/Klipy-GIF-API)

## Owner disposition

The owner deferred catalog implementation and animated-media extras in favor of
core workflow reliability. This supersedes the pending provider-choice question;
no answer or approval is required to continue core work. Reassessment stays open
under UX-287. See [decision and reopening criteria](2026-10-03-UX-286-gif-deferral.md).
