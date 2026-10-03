<!-- cspell:words APNG GIFV -->

# UX-279 — Animated media assessment

## Finding

A GIF picker is not currently a usable delivery feature. Herald's default upload
policy accepts PNG, JPEG and WebP, and its byte inspector has no GIF parser.
PNG/APNG and WebP inspection already record animation metadata. All six built-in
publisher media contracts constrain uploads to JPEG/PNG; broadening MIME labels
alone would bypass important provider and inspection constraints.

Evidence: `packages/core/src/media.ts`, each publisher's profile/channel-profile,
contract and publisher modules. No production provider request was made.

## Destination boundaries

- Discord: official client documentation accepts GIF uploads; API attachments use
  multipart bodies. Existing Herald transport can carry bytes, but the contract,
  validation and inspection must be extended and tested.
- Mastodon: animated GIFs become silent MP4/GIFV on the instance. Limits are
  instance-dependent; media processing and polling are part of delivery, not a
  picker concern.
- LinkedIn: Images API documents GIF support with a 250-frame limit. Client help
  documents a different 500-frame limit; use the API-specific limit for Herald.
  Do not infer animation survival in every publication context without testing.
- X: client GIF support is established, but old API examples are not a current
  implementation contract. Current chunked upload, media category, processing,
  mix restrictions and account entitlement require a separate adapter review.
- DEV.to: body Markdown and main-image URLs are the documented article interface.
  External article images already fit the accepted URL boundary. This does not
  authorize making private Herald assets public or promise remote GIF rendering.
- Bluesky: Herald currently uses image embeds with JPEG/PNG contracts. GIF-link
  cards/video conversion are distinct content/delivery models; do not silently
  convert them into ordinary image attachments.

## Catalog decision

Tenor is unsuitable for a new integration: Google's official notice says its API
was sunset June 30, 2026, with new integrations closed January 13. Old quickstart
pages remaining online do not make the service available.

GIPHY offers maintained SDK/API primitives, but production access requires review,
pricing discussion and attribution. Searches disclose user queries to the
provider; using its SDK also adds provider network dependencies to authoring.
A paid-independent editor does not imply a free-independent catalog.

A local/imported GIF library avoids search-provider credentials and query
sharing, preserves the existing single Bun monolith and storage lifecycle, but
still requires GIF inspection and destination-specific delivery. No additional
service, dependency, API key or external publisher call was added.

## Recommendation and checkpoint

First implement animated attachments for a bounded supported destination set
(Discord and Mastodon), using existing local/URL import. Specify byte, dimensions,
frame/resource limits, processing/retry outcomes, mixed-media rules and reduced
motion previews before implementation. Keep other destinations explicitly
incompatible until their adapters support the format. Existing public image
hosting remains deferred.

A commercial catalog is a later optional integration, not a prerequisite. Owner
approval is needed for the new animated-media public contracts and destination
scope, or for accepting an external catalog's cost/privacy obligations.

## Primary references checked October 3, 2026

- [Discord attachments](https://github.com/discord/discord-api-docs/blob/main/developers/reference.mdx)
- [Discord GIF uploads](https://support.discord.com/hc/en-us/articles/211866427-How-do-I-upload-images-and-GIFs)
- [Mastodon posting and GIFV](https://docs.joinmastodon.org/user/posting/)
- [Mastodon instance media configuration](https://docs.joinmastodon.org/entities/Instance/)
- [LinkedIn Images API](https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/images-api?view=li-lms-2026-01)
- [LinkedIn client media formats](https://www.linkedin.com/help/linkedin/answer/a792945)
- [X client pictures and GIFs](https://help.x.com/en/using-x/posting-gifs-and-pictures)
- [Forem article API](https://developers.forem.com/api/v0)
- [Tenor sunset notice](https://support.google.com/tenor/answer/10455265?hl=en)
- [GIPHY developer requirements](https://developers.giphy.com/docs/)
- [GIPHY production pricing](https://support.giphy.com/hc/en-us/articles/10390181572762-Is-there-a-fee-for-using-GIPHY-s-SDK)
