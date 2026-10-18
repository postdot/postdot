# Facebook and Instagram integration discovery

Status: researched proposal, not an accepted implementation contract.
Checked: 2026-10-18. Related: ISSUE-166, META-505.

## Recommended delivery order

1. Facebook Pages: text, optional link, then one photo. Keep Postbot responsible
   for scheduling; publish at execution time rather than maintaining a second
   remote schedule. No personal timeline or Group publishing claim.
2. Instagram professional accounts: one JPEG with optional caption. Treat a
   required image as a real content constraint, not an empty text-post fallback.
3. Reels, carousels and Stories as separate bounded additions after durable
   preparation/publishing recovery is proven. Comments and analytics remain
   separate permissions and product slices.

This sequence is a recommendation, not a reason to make the first format the
permanent feature ceiling. No provider has been registered by this discovery. FACEBOOK-506 subsequently adds an isolated Pages protocol package; OAuth connection setup, profiles, worker and Studio integration are not active yet.

## What the provider documentation establishes

### Facebook Pages

[Pages overview](https://developers.facebook.com/documentation/pages-api/overview)
explains the authorization chain: user consent, managed Page discovery through
`/me/accounts`, then that Page's token and destination identity. Account discovery
can return several Pages; selecting one must be explicit. Permissions and Page
roles/tasks are separate checks. Development access for an app-role user does not
prove public access; Page permissions require review for live use outside the
app's eligible roles.

[Posts](https://developers.facebook.com/documentation/pages-api/posts) documents
`POST /{page-id}/feed` for text and optional link, and `/{page-id}/photos` for a
photo. Photo responses distinguish photo ID from post ID; retain publication
identity rather than treating the uploaded asset as the published post. Video
uses a separate API. Its broad prerequisite list covers replies/moderation too;
do not request every listed permission for a publishing-only feature.

Verified on 2026-10-18 against the v26.0 [Page Feed publishing](https://developers.facebook.com/docs/graph-api/reference/page/feed/) and [Page Photos creating](https://developers.facebook.com/docs/graph-api/reference/page/photos/) references:
`pages_show_list` for discovery, `pages_manage_posts` for publishing and
`pages_read_engagement` for this bounded flow, with the authorizing person able to perform CREATE_CONTENT. Do not silently add messaging, ads,
moderation or business-management scopes. Version-specific endpoint requirements
and granted Page tasks must be part of connection acceptance tests.

### Instagram account and login choices

[Platform overview](https://developers.facebook.com/documentation/instagram-platform)
identifies two professional-account routes. Instagram Login does not require a
linked Facebook Page. Facebook Login requires the Instagram Business/Creator
account to be linked to a Page. Neither route is a basis for promising personal
Instagram-account publishing.

| Choice | Benefit | Cost / boundary |
| --- | --- | --- |
| Instagram Login | Direct Instagram connection without a Facebook Page prerequisite | Separate Instagram credentials and token lifecycle; some Facebook-only capabilities differ |
| Facebook Login | Page discovery can also locate linked Instagram accounts | Imposes Page linkage and Facebook business authorization on Instagram users |

Prefer direct Instagram Login for the initial independent Instagram destination,
but leave this decision open until the provider-app configuration is reviewed.
Do not add a generic Meta connection that conceals different account requirements.

[App Review](https://developers.facebook.com/documentation/instagram-platform/app-review)
distinguishes own/managed-business Standard Access from serving other businesses
with Advanced Access. The latter requires review. It also says one app cannot use
both Instagram login setups. This must be verified in the actual app dashboard
before deciding whether one or separate Meta app registrations serve Postbot's
Facebook and Instagram integrations. No approval or business-verification result
has been obtained.

### Instagram credentials

[Business Login](https://developers.facebook.com/documentation/instagram-platform/instagram-api-with-instagram-login/business-login)
documents authorization-code exchange, server-side secret use and long-lived
60-day tokens. A valid long-lived token can be refreshed after 24 hours; expired
tokens cannot be refreshed. Publishing requests use
`instagram_business_basic` and `instagram_business_content_publish`.
The App Review page spells the latter permission with a different suffix;
use the current authorization/endpoint reference and actual dashboard grant,
not an inferred alias. Retain cancellation and missing-permission outcomes.
PKCE compatibility needs an explicit check: no weakening of Postbot's existing
state/callback validation is authorized by these examples.

### Instagram media lifecycle

[Content Publishing](https://developers.facebook.com/documentation/instagram-platform/content-publishing)
describes container creation, readiness checks and `media_publish`; image inputs
are JPEG, fetched from a public URL. An uploaded/prepared container is not a
published media identity. Containers can expire after 24 hours and distinguish
processing, ready, failed, expired and published states. Preserve the remote
container ID before polling or retrying. A lost final-publish response requires
reconciliation rather than another blind publish.

The guide's general rate section says 100 posts per rolling 24 hours, while its
carousel section still says 50. Do not encode either as a universal constant;
verify the selected API version and use `content_publishing_limit` feedback.
Video resumable-upload support differs by login setup in this guide. Do not
promise it for direct Instagram Login without endpoint confirmation.

## Fit with current Postbot architecture

These are repository findings and proposed application behavior, not Meta claims.

| Existing boundary | Reuse / work required |
| --- | --- |
| Provider applications | `packages/db/src/provider-application-store.ts` and API application routes currently enumerate LinkedIn, Bluesky and X. Add provider-specific configuration deliberately; do not overload another provider's app ID. |
| OAuth protocol | `packages/oauth/src/authorization-code.ts` has state/callback validation and explicit PKCE policy. Provider deviations belong in an adapter with tests. |
| Project connections | Keep credentials encrypted and owned by the project. The authorizing person is attribution, not the connection owner. Verify destination and granted access without sending a probe. |
| Versioned profiles | Separate Facebook text/link/photo and Instagram image requirements. Preserve execution-revision behavior for existing publications when profiles evolve. |
| Media delivery | `apps/api/src/modules/media/public-delivery.ts` issues expiring signed URLs. URLs are minted at execution, not scheduling. Public HTTPS reachability and a lifetime covering provider fetch/retry must be verified; localhost-only hosting will not satisfy Instagram image fetches. A public S3 bucket is not inherently required. |
| Durable preparation | `provider-media-delivery-store.ts` persists remote IDs and expiry; worker adapters already support provider-specific recovery. Assess container checkpoints and final-publish reconciliation before claiming this ledger alone models the whole Instagram lifecycle. |
| Studio | Use shared real editor and native constraints. Connection is a short task: consent, explicit destination selection, confirmation. Put exceptional setup help on demand; do not put API terminology or a tutorial into the routine form. |

Do not send permission/token URLs or signed media URLs to logs. Keep media public
access bounded to the selected immutable representation and expiry. A successful
mock is not evidence that Meta fetched an installation's URL or approved its app.

## Next bounded lot

The isolated Pages protocol now covers discovery and text/link/single-photo publishing with injected transport tests. Photo bytes use the documented multipart upload, avoiding a public image URL requirement for this Facebook slice. Next: register a versioned profile and project connection setup, then integrate the worker with pinned media and durable delivery states before adding Studio controls. This work does not need
to wait for public App Review, but real authorization/publishing tests require an
explicit test app, Page and operator authorization.

Resolve the Instagram login/app-registration decision before implementing its
connection flow. The two credible choices remain above; discovery has not adopted
one as a permanent product contract.

## Evidence limits

Read the current Meta pages in the browser without signing in. Older `/docs/`
URLs were rate-limited or empty through the web reader; the current navigation
uses `/documentation/`. Official Meta Postman collections corroborated the two
Instagram login families and Page-token discovery, but current endpoint guides
are the implementation reference. No third-party tutorial was used as authority.
No app dashboard, real token, connection, remote post or test message was used.
