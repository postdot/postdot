# Implemented provider capabilities

Repository review: 2026-10-21, including TELEGRAM-541 and ENGAGEMENT-543/544. Use this reference to choose
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
| [Telegram](../../packages/telegram/src/profile.ts) | Text, or one image/MP4 with optional caption; ordinary anonymous text-answer polls exclude media | Absent | Absent / absent | Bot token and destination chat |
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
are not an account-wide inbox or moderation tools. Native automatic Bluesky and Mastodon
publications also support a separately prepared [first comment](first-comments.md)
with a delay after confirmed publication and an independent delivery outcome.

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

## Telegram poll slice

TELEGRAM-541 adds ordinary anonymous polls with single or multiple selections,
text answers and optional relative automatic closing. The publication text is
the question. New channels use message-v2; existing message-v1 publications stay
executable. Polls preserve the same durable send outcomes as ordinary messages.
The typed editor, preview and delivery use local synthetic acceptance; real
delivery still needs an authorized bot and chat.

The current [Telegram Bot API](https://core.telegram.org/bots/api#sendpoll)
documents additional poll features, including quizzes and media. Those remain
outside the owner-approved first slice. The implemented conservative limits are
a question of up to 300 UTF-16 units, one to twelve answers of up to 100 units,
and optional closing from 5 to 2628000 seconds after provider creation. Omitted
closing leaves the poll open. This does not collect votes or results.

## Next product gap

Choose attribution rules for shared-post and tag-based performance reports
(ISSUE-172) before implementing aggregation. Existing provider observations can
support that slice without another account or collector. Keep unlike provider
metrics separate and make incomplete coverage explicit.

X post counters are an alternative, but existing OAuth scopes do not prove
endpoint entitlement or free access. The current
[X pricing documentation](https://docs.x.com/x-api/getting-started/pricing)
charges for API reads. Do not describe X metrics as an access-free integration.
Tag reports still require an attribution decision (ISSUE-172). Instagram stays
deferred. Additional locales need the owner's language selection.
