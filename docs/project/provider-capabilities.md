# Implemented provider capabilities

Repository review: 2026-10-20, after ANALYTICS-539. Use this reference to choose
product work and understand current Postbot coverage. It describes implemented
workflows, not everything an upstream API might permit. Limits and supported
file types remain in each linked provider profile.

The [profile catalog](../../apps/api/src/modules/projects/channel-profile-presets.ts)
contains nine native providers and one manual preset. The
[production registry](../../apps/api/src/index.ts) registers their execution
adapters, including retained historical revisions. Studio exposes connection
and authoring for all nine. Custom HTTP is a separate execution kind; SMTP
serves notifications and is not a publishing destination.

## Current coverage

“Absent” means Postbot has no implementation for that workflow. It does not mean
the platform prohibits it. “Stored snapshot” means an editor explicitly refreshes
provider data and project members read the saved result. Counts alone do not
provide comment bodies or a reply interface.

| Destination | Publishing in the current profile | Provider performance | Comment bodies / conversation replies | Connection |
| --- | --- | --- | --- | --- |
| [Bluesky](../../packages/bluesky/src/channel-profile.ts) | Text with up to four images, or one MP4 | Post engagement counters; account counters also available through the analytics API | Stored public snapshot / durable text replies | Project OAuth application and account |
| [Mastodon](../../packages/mastodon/src/profile.ts) | Text, images or one MP4; native polls exclude media | Status favourites, boosts and replies | Stored public snapshot / durable text replies | Instance OAuth application and account |
| [DEV.to](../../packages/devto/src/profile.ts) | Markdown article, title and optional cover image | Article views, reactions and comment count | Absent / absent | API key |
| [Discord](../../packages/discord/src/profile.ts) | Text, images or one MP4 | Absent | Absent / absent | Bot token and destination channel |
| [X](../../packages/x/src/profile.ts) | Weighted text with up to four images | Absent | Absent / absent | Project OAuth application and account |
| [LinkedIn](../../packages/linkedin/src/channel-profile.ts) | Text with up to twenty images, or one MP4; member or organization | Absent | Absent / absent | Project OAuth application and authorized identity |
| [Telegram](../../packages/telegram/src/profile.ts) | Text, or one image/MP4 with optional caption | Absent | Absent / absent | Bot token and destination chat |
| [Facebook](../../packages/facebook/src/profile.ts) | Page text, link or one photo; link and photo exclude each other | Absent | Absent / absent | Project application, user authorization and Page selection |
| [Instagram](../../packages/instagram/src/profile.ts) | One JPEG with optional caption and accessibility text | Absent | Absent / absent | Distinct Instagram configuration and direct professional-account login |
| [Manual](../../packages/core/src/profile-presets.ts) | Operator records the publication outcome | No native collector | Absent / absent | No publisher or provider credentials |
| [Custom HTTP](../../packages/custom-http/src/contract.ts) | Configured webhook or mapped HTTP request, subject to the profile | No native collector | Absent / absent | Operator-configured endpoint and authentication |

Provider performance uses cumulative observations with explicit availability and
freshness. The [Performance page](../../apps/web/src/components/publication-performance-page.tsx)
groups loaded destinations by source post and supports manual refresh for
Bluesky, DEV.to and Mastodon. It does not combine their metrics into totals or
expose Bluesky account counters as publication results. Operational publication
counts are separate from provider engagement.

The [comment routes](../../apps/api/src/modules/projects/publication-comments-routes.ts)
and [reply service](../../apps/api/src/modules/projects/publication-replies-service.ts)
support only Bluesky and Mastodon. Reads retain the latest bounded public
snapshot; replies retain conversation-owned send history and outcomes. These
are not an account-wide inbox, moderation tools or scheduled first comments.

## Verification and external prerequisites

Code, injected protocol tests and local browser scenarios establish different
evidence from a successful real-provider delivery. Recorded live examples include
[Bluesky video](../../.autonomos/worklogs/2026-10-09-PROVIDER-362.md),
[Discord video](../../.autonomos/worklogs/2026-10-08-PROVIDER-359.md),
[LinkedIn organization text/image](../../.autonomos/worklogs/2026-09-03-EVAL-57.md)
and [Facebook text/photo](../../.autonomos/worklogs/2026-10-18-FACEBOOK-512.md),
with [later Facebook text acceptance](../../.autonomos/worklogs/2026-10-19-FACEBOOK-519.md).
Those examples do not verify every format or grant on those providers.

The Mastodon analytics and conversation work has local synthetic evidence;
this review adds no live acceptance. Instagram implementation is present but
[live acceptance is owner-deferred](../../.autonomos/worklogs/2026-10-20-INSTAGRAM-538.md).
An absent live record is not evidence of a broken implementation. No provider
credentials, accounts or publications were used during this inventory.

## Recommended next slice

Add ordinary native Telegram polls to the existing authoring and delivery path.
This expands a publishing format rather than adding another counter. Develop
the protocol, immutable profile revision, typed controls, validation, preview and
durable delivery with synthetic responses; keep the existing message profile
compatible. An eventual real delivery still needs an authorized bot and chat,
but development need not wait for an owner-created account.

The current [Telegram Bot API](https://core.telegram.org/bots/api#sendpoll)
documents native polls and options beyond a first Postbot slice, including quiz
and media features. Before implementation, settle the first slice's anonymity,
single/multiple choice, closing behavior and media policy. Verify current limits
instead of copying Mastodon's option or duration limits. These choices remain
proposals; this inventory does not approve a new format contract.

X post counters are an alternative, but existing OAuth scopes do not prove
endpoint entitlement or free access. The current
[X pricing documentation](https://docs.x.com/x-api/getting-started/pricing)
charges for API reads. Do not describe X metrics as an access-free integration.
Scheduled first comments require dependent-delivery semantics (ISSUE-171), and
tag reports still require an attribution decision (ISSUE-172). Instagram stays
deferred. Additional locales need the owner's language selection.
