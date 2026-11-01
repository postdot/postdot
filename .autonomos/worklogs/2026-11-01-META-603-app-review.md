# META-603 — Instagram Unified Login App Review preparation

Status: preparation completed; submission not ready.

## Scope and decision boundary

The owner authorized preparation of the App Review materials after successful
Instagram publishing acceptance. This pass inspects the current application and
Meta documentation, prepares reviewer copy and a recording script, and identifies
submission dependencies. It does not submit a review, accept Tech Provider terms,
start business verification, enable Live mode, deploy a hosted application or
publish another Instagram post.

App Review is relevant when this Meta application serves other businesses. Meta's
current guide distinguishes that case from publishing for a business the operator
owns or manages, which can use Standard Access. Postdot remains self-hosted:
operators using their own Meta applications do not automatically become clients
of a centrally hosted Postdot service. A review-ready deployment must identify its
operator and supported audience before claiming otherwise.

## Primary evidence checked on 2026-11-01

- [Unified Login permissions](https://developers.facebook.com/documentation/instagram-platform/instagram-api-with-unified-login/permissions): Standard Access is for people with app roles; external clients require Advanced Access for every requested permission and Live mode.
- [Unified Login setup](https://developers.facebook.com/documentation/instagram-platform/instagram-api-with-unified-login/get-started): the default configuration requires `instagram_basic` and `instagram_manage_messages`; publishing adds `instagram_content_publish`. A real professional account, portfolio and HTTPS callback are required.
- [Instagram App Review](https://developers.facebook.com/documentation/instagram-platform/app-review): externally testable application, visible login, detailed per-permission use cases, reviewer instructions and screen recordings. Unused permissions are grounds for rejection. Some permissions require a successful API call before requesting Advanced Access.
- The app dashboard currently says Become a Tech Provider to submit for App Review and access data from other businesses.
- The App Review page says Not submitted, with nothing added. Its notice says reviewers examine existing access, app identity, privacy and deletion URLs too, and submissions cannot be edited or cancelled during review.
- Business Suite shows the test portfolio's verification status as Unverified. No verification was initiated.
- Basic app settings show no privacy-policy or data-deletion instructions URL. The website URL field is empty. Icon/category readiness was not established.
- The existing public privacy page explicitly covers only the documentation website and excludes self-hosted instances. It cannot honestly stand in for this application's data policy.

The general App Review guide still describes older navigation and permission
names. For Unified configuration names, use the newer Unified-specific guide and
the live dashboard; do not substitute `instagram_content_publishing` for the
configured `instagram_content_publish` permission.

## Permission matrix

| Permission | Delivered Postdot use | Review position |
| --- | --- | --- |
| `instagram_basic` | Resolve the authorized account ID and username so the operator can confirm the destination | Draft justification ready; record the actual destination selection and account identity |
| `instagram_content_publish` | Create one JPEG container, inspect its status, publish it and store the published media ID | Draft justification ready; demonstrate one complete publication and receipt |
| `instagram_manage_messages` | No Instagram inbox, message sending or receiving is implemented | Setup guide calls it mandatory for Unified Login; do not fabricate a messaging use case. Establish with Meta how a publishing-only app satisfies this dependency before requesting Advanced Access |
| `instagram_manage_comments` | No Instagram comment management is implemented | Exclude from the publishing-only review request and final consent configuration; the acceptance configuration included it, so recheck configuration and consent before recording |
| `ads_management`, `ads_read` | No advertising feature | Exclude |
| `business_management` | No automatic system-user token management is implemented | Exclude unless a separately accepted feature requires it |
| `instagram_business_*` | Existing direct-login compatibility only | Do not request these as substitutes for Unified Login permissions |

A configuration default is not evidence that Postdot uses a permission. The
messaging prerequisite is an unresolved submission dependency, not authorization
to add an inbox or to claim that profile reading requires message access.

## Draft submission text

The following copy describes delivered functionality. Add the actual review
instance URL and a private reviewer account through Meta's review form before use.

### Application purpose

Postdot lets authorized teams prepare and schedule posts for their own publishing
channels. An operator connects an Instagram professional account through Meta
Unified Login, confirms the account shown in Postdot, and creates a publication
containing one JPEG and an optional caption. Postdot sends that selected content
to Instagram and shows the resulting publication status and media identifier.

### How we use instagram_basic

Postdot uses this permission during account connection to identify the Instagram
professional account shared with the application. We retrieve its account ID and
username, display the selected destination, and associate it with the publishing
channel. This lets the operator confirm which account will receive a post before
scheduling a publication.

### How we use instagram_content_publish

Postdot uses this permission to publish the image and caption that an authorized
operator has prepared and scheduled for the connected Instagram professional
account. Our server creates an image container from a publicly reachable HTTPS
URL for the selected JPEG, checks the container status, and publishes the ready
container. Postdot records the returned media ID and shows the outcome in the
publication history. An uploaded draft is not published until it is scheduled
for delivery.

### Messaging dependency note for clarification, not a feature justification

Our application publishes selected JPEG posts and does not read or send Instagram
direct messages. The Unified Login setup guide lists instagram_manage_messages as
a required configuration permission. Please clarify the supported Advanced Access
review path for a publishing-only integration with this mandatory dependency.
We do not claim a messaging use case or provide a messaging demonstration.

Do not paste this note into a field requiring evidence of an implemented messaging
feature. Resolve the dependency first through Meta's documented support/review
channel. No message was sent during this pass.

## Reviewer journey and recording script

Prepare an English Studio session on the same version intended for review. Use a
stable HTTPS review instance with an isolated workspace/project, a professional
account authorized for testing and one synthetic JPEG. Use the dedicated Postdot
reviewer account supplied privately in the Meta form; never share the owner's
Facebook password, app secret, API key or access token in a recording or document.

1. Open the review instance's sign-in page and sign in to the dedicated Postdot
   account. Show the isolated review workspace and project.
2. Open Channels, select the Instagram channel and start its account connection.
   Show the login action before navigating away. Let Meta display the actual
   account/portfolio selection and consent screen; explain the permissions shown.
3. Select the authorized professional account and return to Postdot. Show the
   resulting username/destination. This is the profile-identification evidence.
4. Create a draft for that channel, upload exactly one JPEG and enter a short,
   recognizable caption. Show the destination and preview before scheduling.
5. Schedule the publication for the immediate next test slot using the normal
   Studio controls. Show delivery progress and the final published result.
6. Open Instagram for the selected account and show the matching image and
   caption. Relate the real receipt to the Postdot publication, without exposing
   secrets or callback parameters.
7. In a separate cleanup segment, demonstrate the available connection-disconnect
   action once no publication is active. Explain that disconnecting does not
   delete an already published Instagram post or every locally authored draft.

Record the complete journey without skipping consent or the user action that
causes delivery. Record only when the instance and privacy/deletion instructions
are ready, so the video does not describe an inaccessible temporary deployment.
The historical live test proves one publication, not this new recording or
external reviewer access. No new video or external-user test was produced here.

## Data handling facts for the operator's policy

Use these as implementation evidence when drafting the application policy, not as
a replacement for the operator's approved privacy and retention terms:

- The operator runs the instance and controls its database, media storage and
  provider-credential encryption key. The documentation host is a separate system.
- Postdot stores account identifiers/names, permission metadata, encrypted
  access credentials, connection metadata, authored publications, media and
  delivery history. Review actual deployment logging and backups before promising
  a retention period or deletion deadline.
- The publisher gives Meta a signed HTTPS media URL when delivering the selected
  image. It does not send an owner's Facebook password to Postdot.
- Disconnecting a connection revokes an unreferenced local credential and clears
  its encrypted secret columns. Workspace sharing can keep a credential referenced
  elsewhere. This is not the same as deleting all account-related content,
  previously published Instagram posts, backups or Meta's authorization.
- No Meta-specific callback for revoking authorization or signed-request deletion was found
  in the current Instagram routes. Use an accurate, published deletion-instructions
  process if Meta offers that alternative; do not configure a nonexistent callback.

## Submission readiness and next implementation slice

| Item | Current state | Required before submission |
| --- | --- | --- |
| Real OAuth/JPEG publication | Verified in INSTAGRAM-538 | Preserve evidence; record the reviewer journey on the final review build |
| Provider configuration | Working template created; temporary redirect addresses removed | Final permission set, stable callback and fresh consent |
| Tech Provider prerequisite | Dashboard explicitly requests onboarding | Resolve the operator/business identity and complete the normal provider process with factual details |
| Business verification | Unverified | Inspect the actual Tech Provider requirements and supply owner-held documents only when requested; do not assume test-account creation proves eligibility |
| Application privacy policy | App URL unset; site policy excludes instances | Publish an application-specific policy with the actual operator, data use and retention facts |
| User-data deletion | Instructions URL unset; no provider-specific callback | Publish and verify an actionable deletion procedure matching shared-credential/content retention behavior |
| Stable review instance | No review deployment or website URL established | Choose an operator-controlled HTTPS origin, deploy the reviewed build, register its callback and provide private reviewer access |
| App identity | Test name; icon/category not qualified | Review display name, icon, category and contact settings before submitting |
| Messaging permission | Mandatory setup dependency; no delivered use case | Obtain a supported publishing-only review path; no invented feature evidence |
| Screencast | Script ready; recording absent | Capture real consent, account identity, scheduling, publication and receipt |

Recommended next slice: prepare the application privacy/deletion instructions and
the review-instance deployment plan, with a clear instance-operator boundary.
Then resolve the messaging dependency and Tech Provider onboarding before creating
an actual review request. Do not turn the documentation-only postdot.app deployment
into the authenticated API/Studio host as part of this preparation.

## Validation and completion

Checked the current Meta dashboard, review page, basic settings, portfolio
verification and primary developer guides in read-only browser sessions. Cross-
checked the implemented OAuth/profile/publishing scope, local credential revocation
and public website privacy boundary against source. No application settings,
permissions, provider status or business identity were changed. Repository changes
are this preparation record and task state only; no application behavior changed.

META-603 is complete as preparation. Advanced Access, business verification,
external reviewer access, a new recording and actual submission remain unclaimed.
