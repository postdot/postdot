<!-- cspell:disable -->

# Social Publishing Competitor Survey for Postdot

Survey date: 2026-11-18.

> Verification note (2026-11-18): two rows were checked against the code and corrected. Public signup already closes after the first administrator is created (`POSTDOT_BOOTSTRAP_MODE`, invitations), so the remaining auth gap is OIDC, 2FA and passkeys only. A `Cmd+K` search palette already exists (`apps/web/src/components/dashboard-search.tsx`); only natural-language date input is missing.

## Postdot Baseline Checked

Before listing competitor gaps, the following existing Postdot capabilities were verified in the repository:

- **Core model**: Shared draft text and media with per-channel overrides (`README.md`, `apps/docs/content/docs/(guides)/(studio)/concepts.mdx`).
- **Channels**: X, Bluesky, Mastodon, LinkedIn, Facebook (text/link/photos), Instagram (1 JPEG or 2-10 JPEG carousel only, no Reels/Stories/video), Telegram (text/media/albums/polls), Discord, DEV.to, Custom HTTP (`postdot_webhook` and `mapped_http`), and Manual channels with publish reminders (`apps/docs/content/docs/(guides)/(studio)/providers/provider-capabilities.mdx`, `packages/custom-http/src/transport.ts`).
- **Threads and comments**: Text-only thread replies up to 25 items on X, Bluesky, and Mastodon (media/polls/link cards stay on the root post; no auto-splitter); scheduled first comments and saved reply snapshots on Bluesky and Mastodon only (`packages/core/src/thread.ts`, `packages/db/src/publication-first-comment-store.ts`, `packages/db/src/publication-reply-store.ts`, `apps/docs/content/docs/(guides)/(studio)/first-comments.mdx`).
- **Calendar, queue, and cadence**: Month, week, day, and mobile agenda views with channel occupancy and bulk move/schedule/cancel dialogs; calendar drag-and-drop, resize, and slot selection are disabled (`CALENDAR_INTERACTIONS = { drag: false, resize: false, selectSlot: false }`); queue mode and daily channel cadence caps exist (`DESIGN.md`, `apps/web/src/components/publication-calendar.tsx`, `packages/db/src/channel-cadence.ts`).
- **Media library**: Reusable uploads, URL import, webcam capture, alt text, usage protection, trash/retention, and an in-app image crop editor; no folders, stock media picker, video transcoding, or watermarks (`apps/docs/content/docs/(guides)/(studio)/media.mdx`, `apps/web/src/components/media-image-editor-dialog.tsx`).
- **Collaboration, taxonomy, analytics, automation, auth**: Internal project approval workflow (request, approve, reject with reason), internal project tags and categories, delivery analytics (7/30/90 days, CSV export) plus engagement snapshots for Bluesky/Mastodon/DEV.to, REST API, `@postdot/cli`, MCP server, n8n node, and Better Auth email/password with `admin`, `organization`, and `apiKey` plugins (`packages/db/src/manual-store/publication-approval-store.ts`, `packages/db/src/taxonomy-store.ts`, `apps/docs/.openapi/postdot.json`, `apps/docs/content/docs/(developers)/(clients)/automation.mdx`, `integrations/n8n/package.json`, `packages/auth/src/plugins.ts`).

---

## Part 1: Open-Source Competitors

### 1. Postiz (`gitroomhq/postiz-app`)

- **Repository**: [https://github.com/gitroomhq/postiz-app](https://github.com/gitroomhq/postiz-app) (41,893 stars, AGPL-3.0, active)
- **Docs**: [https://docs.postiz.com/general/platforms/overview](https://docs.postiz.com/general/platforms/overview)

#### Notable Features

- **Wide channel coverage (30+ integrations)**: Supports YouTube, TikTok, Threads, Pinterest, Reddit, Google Business Profile, Slack, Medium, Hashnode, WordPress, Listmonk, Lemmy, Nostr, Farcaster, VK, Dribbble, Twitch, Kick, and Tumblr alongside X, LinkedIn, Instagram, Facebook, Bluesky, Mastodon, Telegram, Discord, and DEV.to ([platforms overview](https://docs.postiz.com/general/platforms/overview)).
- **Richer platform formats**: Publishes Instagram Reels, Stories, and Trial Reels, LinkedIn PDF document carousels, X long-form articles and reply controls, Threads topic tags, Pinterest video covers, and per-subreddit Reddit rules ([platforms overview](https://docs.postiz.com/general/platforms/overview)).
- **Browser extension session-based publishing**: Lets a browser extension use an existing logged-in session for platforms without standard OAuth flows ([platforms overview](https://docs.postiz.com/general/platforms/overview)).
- **Channel time slots and `find-slot` API**: Defines recurring daily/weekly posting time slots per channel to structure Day view, assign RSS drafts, and power a `find-slot` endpoint ([time slots](https://docs.postiz.com/general/channels/time-slots)).
- **Calendar drag-and-drop rescheduling**: Dragging posts between dates/times on the calendar reschedules them ([moving posts](https://docs.postiz.com/general/calendar/moving-posts)).
- **Post repetition (simple evergreen)**: Repeats a post on a chosen cycle directly from the composer ([scheduling](https://docs.postiz.com/general/composer/scheduling)).
- **Plugs (engagement-triggered automations)**: Automatically reposts or adds a follow-up comment once a post crosses a configured like threshold ([plugs](https://docs.postiz.com/general/automations/plugs)).
- **RSS auto-posting**: Polls feeds to create drafts assigned to channel time slots, optionally rewritten by AI ([RSS auto-posting](https://docs.postiz.com/general/automations/auto-post-rss)).
- **Sets and reusable signatures**: Saves channel groups ("Sets") for one-click selection and reusable text sign-offs ("Signatures") for insertion into posts ([sets and signatures](https://docs.postiz.com/general/settings/reusables)).
- **Client groups and unauthenticated approval links**: Groups channels per client ("Customers") and generates unlisted preview URLs where clients can view rendered threads and leave comments without logging in ([approvals](https://docs.postiz.com/general/approvals)).
- **Built-in URL shorteners and link stripping**: Shortens URLs inside the composer and tracks click statistics per post ([links and validation](https://docs.postiz.com/general/composer/links-and-validation)).
- **AI generation and YouTube video clipping**: Generates short/long posts, threads, images, and videos, and clips long YouTube videos into captioned vertical shorts drafted into free slots ([AI generation](https://docs.postiz.com/general/composer/ai-and-imports), [video clipping](https://docs.postiz.com/general/clipping)).
- **Outbound publish webhooks**: Notifies external HTTP endpoints scoped to selected channels when posts publish ([webhooks](https://docs.postiz.com/general/automations/webhooks)).

#### GitHub Issues and Discussions: Top Requests and Complaints

**Most requested features (by +1 reactions and discussion upvotes):**

- Custom/arbitrary Mastodon servers beyond `mastodon.social`: 18 `+1` (22 total, 22 comments, closed) ([issue #345](https://github.com/gitroomhq/postiz-app/issues/345)) and without env vars: 7 `+1` (closed) ([issue #761](https://github.com/gitroomhq/postiz-app/issues/761)).
- Pixelfed provider: 18 `+1` (13 comments, open) ([issue #510](https://github.com/gitroomhq/postiz-app/issues/510)); PeerTube provider: 12 `+1` (closed) ([issue #816](https://github.com/gitroomhq/postiz-app/issues/816)); Tumblr: 6 `+1` (closed) ([issue #900](https://github.com/gitroomhq/postiz-app/issues/900)).
- Responsive/mobile web layout: 17 `+1` (21 total, 11 comments, closed) ([issue #1008](https://github.com/gitroomhq/postiz-app/issues/1008)).
- Registration/access controls for self-hosters: disable signups 13 `+1` (closed) ([issue #392](https://github.com/gitroomhq/postiz-app/issues/392)), invite-only registration 9 `+1` (closed) ([issue #1071](https://github.com/gitroomhq/postiz-app/issues/1071)), disable user registration 7 `+1` (closed) ([issue #480](https://github.com/gitroomhq/postiz-app/issues/480)).
- Custom OpenAI-compatible base URL and model env vars for self-hosters: 10 `+1` (25 total, 23 comments, open) ([issue #1074](https://github.com/gitroomhq/postiz-app/issues/1074)), plus earlier requests ([issue #498](https://github.com/gitroomhq/postiz-app/issues/498): 9 `+1`; [issue #256](https://github.com/gitroomhq/postiz-app/issues/256): 8 `+1`).
- Native `@mentions` and people/company tagging across LinkedIn and other networks: 10 `+1` (closed) ([issue #944](https://github.com/gitroomhq/postiz-app/issues/944)), and 7 upvotes in [discussion #284](https://github.com/gitroomhq/postiz-app/discussions/284).
- S3 / MinIO self-hosted object storage: 7 `+1` ([issue #322](https://github.com/gitroomhq/postiz-app/issues/322), closed; [issue #1124](https://github.com/gitroomhq/postiz-app/issues/1124), open).
- Post lifecycle webhooks (create, update, delete, publish, fail) rather than publish-only: 7 `+1` (open) ([issue #1191](https://github.com/gitroomhq/postiz-app/issues/1191)); generic Webhook as a provider: 7 `+1` (open) ([issue #321](https://github.com/gitroomhq/postiz-app/issues/321)).
- Platform format depth: Instagram Story links 8 `+1` ([issue #580](https://github.com/gitroomhq/postiz-app/issues/580)), YouTube Community Tab 8 `+1` ([issue #537](https://github.com/gitroomhq/postiz-app/issues/537)), LinkedIn PDF carousels 5 `+1` ([issue #1381](https://github.com/gitroomhq/postiz-app/issues/1381)), Threads Topic Tags 4 `+1` ([issue #1497](https://github.com/gitroomhq/postiz-app/issues/1497)), Instagram Reels parity 3 `+1` ([issue #1770](https://github.com/gitroomhq/postiz-app/issues/1770)), location tagging 3 `+1` ([issue #1486](https://github.com/gitroomhq/postiz-app/issues/1486)), LinkedIn personal profile analytics 3 `+1` ([issue #1680](https://github.com/gitroomhq/postiz-app/issues/1680)).
- Design and link tools in Discussions: Canva integration 8 upvotes ([discussion #666](https://github.com/gitroomhq/postiz-app/discussions/666)), IG/FB stories and reels 6 upvotes ([discussion #426](https://github.com/gitroomhq/postiz-app/discussions/426)), IG & FB comments 4 upvotes ([discussion #235](https://github.com/gitroomhq/postiz-app/discussions/235)), API/MCP parity for alt text, tags, deletion, and local uploads ([discussion #2192](https://github.com/gitroomhq/postiz-app/discussions/2192)).

**Most common complaints (by comments and reactions):**

- **OAuth and channel connection fragility**: "Could not add provider" for Instagram/Meta is the highest-commented issue at 56 comments ([issue #918](https://github.com/gitroomhq/postiz-app/issues/918)); Meta's 2026 Unified Login broke new IG connections ([issue #2350](https://github.com/gitroomhq/postiz-app/issues/2350): 6 `+1`); Instagram disconnections ([issue #623](https://github.com/gitroomhq/postiz-app/issues/623): 11 `+1`); self-hosted LinkedIn OAuth failures ([issue #1582](https://github.com/gitroomhq/postiz-app/issues/1582): 5 `+1`, 16 comments); TikTok Direct Post audit rejection for self-hosters ([issue #1362](https://github.com/gitroomhq/postiz-app/issues/1362): 6 `+1`; [issue #2297](https://github.com/gitroomhq/postiz-app/issues/2297): 2 `+1`).
- **Self-hosting complexity, container bloat, and reverse-proxy pitfalls**: Fresh docker-compose signup 502 errors ([issue #1174](https://github.com/gitroomhq/postiz-app/issues/1174): 9 `+1`, 37 comments); 5.24 GB Docker image size ([issue #950](https://github.com/gitroomhq/postiz-app/issues/950): 8 `+1`, 13 comments; [discussion #830](https://github.com/gitroomhq/postiz-app/discussions/830)); Temporal spawning 32 auto-started workers consuming constant idle CPU/RAM ([issue #1570](https://github.com/gitroomhq/postiz-app/issues/1570): 3 `+1`); Railway/Coolify deployment failures ([issue #340](https://github.com/gitroomhq/postiz-app/issues/340): 32 comments; [issue #650](https://github.com/gitroomhq/postiz-app/issues/650): 7 `+1`).
- **Media handling and token refresh reliability**: YouTube token refresh failures ([issue #1595](https://github.com/gitroomhq/postiz-app/issues/1595): 8 `+1`), GIFs to LinkedIn flattened to static PNGs ([issue #825](https://github.com/gitroomhq/postiz-app/issues/825): 20 comments), >1 GB upload limits ([issue #1431](https://github.com/gitroomhq/postiz-app/issues/1431): 3 `+1`), and upload/reverse-proxy issues.

---

### 2. Mixpost (`inovector/mixpost`, Lite & Pro)

- **Repository (Lite, MIT)**: [https://github.com/inovector/mixpost](https://github.com/inovector/mixpost) (3,947 stars, last pushed 2026-03-16)
- **Product & Docs**: [https://mixpost.app/features](https://mixpost.app/features), [https://mixpost.app/pricing](https://mixpost.app/pricing), [https://mixpost.app/releases/pro](https://mixpost.app/releases/pro), [https://roadmap.mixpost.app](https://roadmap.mixpost.app), [https://docs.mixpost.app/lite/](https://docs.mixpost.app/lite/)

Note: Mixpost Lite (MIT open source) covers basic scheduling for Facebook, X, Mastodon, and Pixelfed without teams, workspaces, API, MCP, or approvals. Mixpost Pro ($299 one-time commercial license, source-available to buyers) adds most modern daily-driver features. Both are detailed below.

#### Notable Features

- **Per-account posting queues and individual schedules (Pro v7.0)**: Each social account maintains its own queue slots and can receive a separate publish timestamp inside a single multi-channel post ([Pro releases](https://mixpost.app/releases/pro)).
- **Best posting time suggestions (Pro v7.0)**: Suggests optimal publishing slots based on account activity ([Pro releases](https://mixpost.app/releases/pro)).
- **Mention Manager with verified handles (Pro v7.4)**: Stores cross-network people/company profiles, searches LinkedIn typeahead, converts pasted profile URLs to handles, tracks verified vs unverified vs text-only status per network, and inserts `{{mention:<ref>}}` tokens ([Pro releases](https://mixpost.app/releases/pro)).
- **Media Library folders, favorites, stock media, and video covers (Pro v4.6-v7.6)**: Organizes assets in folders and favorites, fetches remote URLs, integrates Giphy/stock media, picks custom video frame covers (`timestamp_ms`), supports HEIC/HEIF, and chunks large uploads ([Pro releases](https://mixpost.app/releases/pro)).
- **AI assistant, Brand Voice, AI alt text, and pre-publish linting (Pro v5.0-v7.5)**: Uses multiple LLM providers (including OpenRouter and Ollama) with Brand Voice examples, generates image alt text, runs pre-publishing checks with one-click AI fixes, and reports per-call token cost ([Pro releases](https://mixpost.app/releases/pro)).
- **Unified Engagement Inbox (Pro v6.0-v7.4)**: Handles inbound replies/comments across connected networks with Open/Resolved states, allowlists, mark-all-read/resolved, and Meta webhook subscriptions ([Pro releases](https://mixpost.app/releases/pro)).
- **Post templates, hashtag groups, post variations, and calendar drag-and-drop**: Saves reusable post templates and hashtag groups, supports post variations, and drags scheduled posts on the calendar ([features](https://mixpost.app/features), [Pro releases](https://mixpost.app/releases/pro)).
- **Social account groups and live co-editing indicators (Pro v7.0)**: Groups accounts, filters by group, and shows live presence when another teammate is editing the same post ([Pro releases](https://mixpost.app/releases/pro)).
- **SSO (OIDC) and OAuth for MCP clients (Pro v6.3-v7.1)**: Supports OpenID Connect login plus OAuth app registration so ChatGPT, Claude, and Cursor connect without pasting static API keys ([Pro releases](https://mixpost.app/releases/pro)).
- **URL shorteners and public sharing**: Includes URL shortening (with Kutt on roadmap) and copy-link sharing for team reviewers ([roadmap](https://roadmap.mixpost.app), [Pro releases](https://mixpost.app/releases/pro)).

#### GitHub Issues, Roadmap, and Community Complaints

GitHub Discussions are disabled on `inovector/mixpost`. On the Lite repository and public roadmap:

**Top requests on GitHub and `roadmap.mixpost.app`:**

- MySQL compatibility and installation reliability: 4 `+1` (10 comments, closed) ([issue #80](https://github.com/inovector/mixpost/issues/80)).
- Mastodon integration and Mastodon content warnings/image censoring: 1 `+1` (10 comments) ([issue #16](https://github.com/inovector/mixpost/issues/16)) and 1 `+1` ([issue #41](https://github.com/inovector/mixpost/issues/41)).
- Schedule post and replies / threads: [issue #13](https://github.com/inovector/mixpost/issues/13) (3 comments, closed).
- Address book / reusable contacts or mentions: 1 `+1` ([issue #18](https://github.com/inovector/mixpost/issues/18)).
- Docs for adding custom social providers: 1 `+1` (6 comments) ([issue #64](https://github.com/inovector/mixpost/issues/64)).
- Active public roadmap priorities ([https://roadmap.mixpost.app](https://roadmap.mixpost.app)): Analytics PDF report export ("Now"), Mention Manager fixes ("Now"), LinkedIn first-comment fixes ("Now"), YouTube tags and categories in composer ("Next"), Kutt URL shortener ("Next"), and pre-upload media validation ("Next").

**Most common complaints:**

- **Docker, PHP/Laravel, and Redis/Horizon setup friction**: Fresh install 500 errors, MySQL incompatibilities, and Docker TLS/Horizon queue misconfigurations dominate top-commented issues ([issue #50](https://github.com/inovector/mixpost/issues/50): 8 comments; [issue #56](https://github.com/inovector/mixpost/issues/56): 8 comments; [issue #60](https://github.com/inovector/mixpost/issues/60): 7 comments; [issue #104](https://github.com/inovector/mixpost/issues/104): 8 comments; [issue #147](https://github.com/inovector/mixpost/issues/147): 1 `+1`).
- **Platform API version churn and media upload failures**: LinkedIn API version `426 NONEXISTENT_VERSION` ([issue #167](https://github.com/inovector/mixpost/issues/167): 2 `+1`), Instagram empty media URI 9004/2207052 ([issue #197](https://github.com/inovector/mixpost/issues/197): 9 comments), MP4 upload/FFmpeg friction ([issue #63](https://github.com/inovector/mixpost/issues/63): 9 comments; [issue #6](https://github.com/inovector/mixpost/issues/6)).
- **Lite vs Pro feature gating and maintenance cadence questions**: Lite omits Instagram, LinkedIn, Bluesky, API, MCP, queues, and approvals ([pricing](https://mixpost.app/pricing)); users questioned Lite's development pace ([issue #9](https://github.com/inovector/mixpost/issues/9): 11 comments) and UI clarity when only one account exists ([issue #117](https://github.com/inovector/mixpost/issues/117): 1 `+1`).

---

### 3. Socioboard (`Socioboard-developers/Socioboard-5.0`)

- **Repository**: [https://github.com/Socioboard-developers/Socioboard-5.0](https://github.com/Socioboard-developers/Socioboard-5.0) (1,532 stars, no standard SPDX license file recognized by GitHub)
- **Website**: [https://socioboard.com/features/](https://socioboard.com/features/)

#### Notable Features

- **RSS Feed Reader and Content Studio**: Aggregates news, blogs, and podcasts via RSS and pulls third-party media from Imgur, Flickr, Dailymotion, Pixabay, and Giphy into an asset gallery ([features](https://socioboard.com/features/)).
- **BoardMe / Topic discovery**: Searches trending posts by keyword across platforms to curate and re-share.
- **Team task assignment and notification logs**: Assigns follow-up tasks to team members with activity logs ([features](https://socioboard.com/features/)).
- **Auto-theme switching**: Switches UI theme based on time of day ([features](https://socioboard.com/features/)).

#### GitHub Issues: Top Requests and Complaints

Socioboard 5.0 suffers severe maintenance and installation problems:

- **Requests**: Official Dockerization of API and frontend ([issue #119](https://github.com/Socioboard-developers/Socioboard-5.0/issues/119): 7 `+1`), installation demo video ([issue #293](https://github.com/Socioboard-developers/Socioboard-5.0/issues/293): 6 `+1`, open), Mastodon support ([issue #107](https://github.com/Socioboard-developers/Socioboard-5.0/issues/107): 5 `+1`), selfhosted_templates PR ([issue #171](https://github.com/Socioboard-developers/Socioboard-5.0/issues/171): 1 `+1`).
- **Complaints**: Maintainer/community abandonment ("I'm abandoning the project" [issue #399](https://github.com/Socioboard-developers/Socioboard-5.0/issues/399): 6 `+1`, 7 total; "Is this project alive?" [issue #417](https://github.com/Socioboard-developers/Socioboard-5.0/issues/417): 1 `+1`), broken Linux installation scripts ([issue #2](https://github.com/Socioboard-developers/Socioboard-5.0/issues/2): 25 comments; [issue #72](https://github.com/Socioboard-developers/Socioboard-5.0/issues/72): 10 comments; [issue #250](https://github.com/Socioboard-developers/Socioboard-5.0/issues/250): 1 `+1`), missing LICENSE file ([issue #149](https://github.com/Socioboard-developers/Socioboard-5.0/issues/149): 8 comments), login page failures ([issue #161](https://github.com/Socioboard-developers/Socioboard-5.0/issues/161): 8 comments), and forced OTP verification errors ([issue #269](https://github.com/Socioboard-developers/Socioboard-5.0/issues/269): 5 comments).

---

### 4. Other Active Open-Source Social Schedulers

1. **Brightbean Studio (`brightbeanxyz/brightbean-studio`)** ([repo](https://github.com/brightbeanxyz/brightbean-studio), 2,656 stars, AGPL-3.0, active)
   - **Notable features**: Self-hosted scheduler focused on federated and creator channels (Mastodon, Bluesky, LinkedIn, etc.) with agent gateway integration ([issue #199](https://github.com/brightbeanxyz/brightbean-studio/issues/199)).
   - **Top GitHub requests/complaints**: X/Twitter support: 12 `+1` (open) ([issue #19](https://github.com/brightbeanxyz/brightbean-studio/issues/19)); pre-built container image: 4 `+1` (open) ([issue #111](https://github.com/brightbeanxyz/brightbean-studio/issues/111)); disable signup/registration: 3 `+1` (open) ([issue #23](https://github.com/brightbeanxyz/brightbean-studio/issues/23)); i18n UI translations: 2 `+1` (open) ([issue #163](https://github.com/brightbeanxyz/brightbean-studio/issues/163)); Reddit support: 1 `+1` (open) ([issue #20](https://github.com/brightbeanxyz/brightbean-studio/issues/20)); clickable `@mention` links: 1 `+1` (open) ([issue #133](https://github.com/brightbeanxyz/brightbean-studio/issues/133)); automated retweet/repost ([issue #21](https://github.com/brightbeanxyz/brightbean-studio/issues/21)).

2. **TryPost (`trypostit/trypost`)** ([repo](https://github.com/trypostit/trypost), 959 stars, AGPL-3.0, active)
   - **Notable features**: Ideas Kanban board alongside List and Calendar views; imports media from Unsplash, Google Drive, Google Photos, and Canva; reusable signatures and labels; post review notes with email alerts; outbound lifecycle webhooks; 16-language UI; video repurposing.
   - **Top GitHub requests/complaints**: Schedule reposts/retweets: 1 `+1` (closed) ([issue #211](https://github.com/trypostit/trypost/issues/211)); LinkedIn analytics ([issue #377](https://github.com/trypostit/trypost/issues/377), open); custom OAuth apps for white-label onboarding ([issue #456](https://github.com/trypostit/trypost/issues/456), open); live broadcast sync across List/Calendar/Board views ([issue #502](https://github.com/trypostit/trypost/issues/502), open); Meta/Instagram OAuth setup doc drift and Facebook page selector bugs ([issue #186](https://github.com/trypostit/trypost/issues/186), [issue #212](https://github.com/trypostit/trypost/issues/212)).

3. **OpenPost (`getopenpost/openpost`)** ([repo](https://github.com/getopenpost/openpost), 922 stars, AGPL-3.0, active)
   - **Notable features**: Built-in Image and Carousel Designer (`app.openpo.st/image-editor`), multitrack video editor and screen/camera recorder, meme maker, auto-repost rules, unified engagement inbox, "Find people" discovery for Bluesky/Mastodon, passkeys and 2FA, AI writing with custom OpenAI base URL, reusable workspace mentions ([issue #472](https://github.com/getopenpost/openpost/issues/472)), and mobile app.
   - **Top GitHub requests/complaints**: Video aspect-ratio stretching in editor ([issue #320](https://github.com/getopenpost/openpost/issues/320)), YouTube comment scope errors ([issue #317](https://github.com/getopenpost/openpost/issues/317)), MCP public-media URL verification parity ([issue #323](https://github.com/getopenpost/openpost/issues/323)), and i18n localization ([issue #445](https://github.com/getopenpost/openpost/issues/445)).

4. **Postmill (`postmill-ai/postmill-app`)** ([repo](https://github.com/postmill-ai/postmill-app), 379 stars, AGPL-3.0, active)
   - **Notable features**: Claims 45+ social channels, 46 built-in media tools (Canva-like canvas designer and video timeline), bring-your-own-key AI across 31 providers, persisted cross-platform analytics, and a unified reply inbox ([postmill.ai](https://postmill.ai)).
   - **Top GitHub requests/complaints**: Self-hosted Instagram failing when Facebook Page linking is absent ([issue #60](https://github.com/postmill-ai/postmill-app/issues/60)) and migrating root media to S3 ([issue #368](https://github.com/postmill-ai/postmill-app/issues/368)).

5. **CogSend (`cogsend/cogsend`)** ([repo](https://github.com/cogsend/cogsend), 299 stars, MIT, active)
   - **Notable features**: Single-click Cloudflare Workers deployment (D1 + R2), auto-splits long text into platform-sized threads, browser-side video conversion with cover-frame picker, revocable expiring shareable draft preview links (no login required, [issue #20](https://github.com/cogsend/cogsend/issues/20)), URL link-preview cards, and 2FA.
   - **Top GitHub requests/complaints**: Bluesky 23-character URL length counter ([issue #24](https://github.com/cogsend/cogsend/issues/24), [issue #25](https://github.com/cogsend/cogsend/issues/25)), R2 media library asset reuse ([issue #26](https://github.com/cogsend/cogsend/issues/26)), Threads topic tags ([issue #23](https://github.com/cogsend/cogsend/issues/23)), and top-4 priorities (Analytics, Inbox, Meta/Instagram, MCP server) ([issue #8](https://github.com/cogsend/cogsend/issues/8), [issue #18](https://github.com/cogsend/cogsend/issues/18)).

6. **Postflare (`FerdiKT/postflare`)** ([repo](https://github.com/FerdiKT/postflare), 11 stars, AGPL-3.0, active)
   - **Notable features**: Runs on Cloudflare Workers Free tier (zero Docker/Postgres/Redis); Account Groups (`group:<name>` across composer, calendar, CLI, and MCP); Playbooks (versioned post templates with performance ranking); "Needs check" status for uncertain publish outcomes; automatic media retention cleanup that spares link-dependent platforms (DEV, Hashnode, Medium, Discord embeds); streaming 5 GB R2 multipart uploads.

7. **Social0 (`Abhishek-B-R/social0-oss`)** ([repo](https://github.com/Abhishek-B-R/social0-oss), 8 stars, AGPL-3.0, active)
   - **Notable features**: Lightweight self-hosted social publisher focused on simple multi-account scheduling and API automation.

---

## Part 2: Commercial Competitors

### 1. Buffer

- **Product & Feedback Board**: [https://buffer.com/publish](https://buffer.com/publish), [https://suggestions.buffer.com](https://suggestions.buffer.com)
- **Notable Features**:
  - **Ideas board ("Create")**: Scratchpad and Kanban library for saving raw ideas, links, and tags before promoting them into scheduled drafts ([Buffer Create](https://buffer.com/create)).
  - **Queue-based time slots with Prioritize and Next Available**: Per-channel recurring weekly slot schedules with "Next Available", "Prioritize" (front of queue), and "Shuffle" helpers ([Buffer Publish](https://buffer.com/publish)).
  - **Recurring posts (Beta)**: Republishes a single post automatically a set number of times on a defined cadence ([Buffer Suggestions](https://suggestions.buffer.com/p/recurring-posts)).
  - **Feeds (RSS reader)**: Imports RSS/Atom feeds into Buffer collections so authors can browse new articles and draft posts in one click ([Buffer Publish](https://buffer.com/publish)).
  - **Substack Notes, Threads, TikTok, YouTube, Pinterest, Google Business Profile**: Direct scheduling beyond Postdot's current network set ([Buffer Publish](https://buffer.com/publish)).
  - **Content Templates library and AI Assistant**: Built-in post prompt templates plus AI rewriting/repurposing per network ([Buffer Templates](https://buffer.com/templates), [Buffer AI Assistant](https://buffer.com/ai-assistant)).
  - **Browser extension and iOS/Android mobile app**: Clips any web page/quote/image directly into the Buffer queue and supports mobile push notifications for manual formats ([Buffer Publish](https://buffer.com/publish)).
  - **Community Inbox, Insights, Zapier/n8n, API, and MCP**: Unified comment reply feed, analytics + best-time insights, native Zapier/n8n integrations, and MCP tools ([Buffer Community](https://buffer.com/community), [Buffer MCP](https://buffer.com/mcp)).
- **Documented User Requests (`suggestions.buffer.com`)**: Top feature board items include Reddit ([link](https://suggestions.buffer.com/p/reddit-50ea01be-a04b-4233-b463-30edf50e32b8)), Telegram ([link](https://suggestions.buffer.com/p/telegram-52a29dc-6772-4b43-8b60-dd690ba31f07)), Discord ([link](https://suggestions.buffer.com/p/discord-e92e5169-b2ae-4885-a11f-ffe9d66f9e16)), Tumblr, Snapchat, WhatsApp Channels/Groups, custom video/Reel thumbnails ([link](https://suggestions.buffer.com/p/customize-thumbnails-for-video-posts-including-reels)), WordPress/Medium/Substack Articles, and native recurring posts ([link](https://suggestions.buffer.com/p/recurring-posts)).

### 2. Typefully

- **Website**: [https://typefully.com](https://typefully.com)
- **Notable Features**:
  - **Distraction-free thread and long-form writer with auto-split**: Writes continuously and auto-splits text into numbered thread chunks, with a "Thread Finisher" summary/CTA block and X Articles support ([typefully.com](https://typefully.com)).
  - **Pixel-perfect live platform previews**: High-fidelity previews across X, LinkedIn, Threads, Bluesky, and Mastodon including mentions, media, polls, and LinkedIn PDF carousels ([typefully.com](https://typefully.com)).
  - **Shareable draft links with inline highlight comments**: Generates a link to a draft where reviewers highlight specific phrases, leave inline comments, and trigger AI "Address Feedback" edits ([typefully.com](https://typefully.com)).
  - **Auto-Plug, Auto-Retweet, and Auto-DM**: Automatically appends a promotional reply ("Auto-Plug") or reposts ("Auto-RT") once a post hits an engagement threshold, and triggers keyword DMs ([typefully.com](https://typefully.com)).
  - **Natural language scheduling, Streaks, and AI Voice**: Parses dates like "next Tuesday morning", tracks daily/weekly publishing streaks, learns writing voice from past posts, and generates AI image alt text ([typefully.com](https://typefully.com)).
  - **Keyboard command bar, macOS app, and synced team launches**: Full keyboard-first Command Bar (`Cmd+K`), Slack launch alerts, Tags & Pins, Free API, MCP, and AI Agent Skills ([typefully.com](https://typefully.com)).

### 3. Publer

- **Website**: [https://publer.com/features](https://publer.com/features)
- **Notable Features**:
  - **Bulk CSV / spreadsheet import (up to 500 posts)**: Uploads a CSV with captions, links, media URLs, dates, and recycling flags to populate the calendar in one batch ([publer.com/features](https://publer.com/features)).
  - **Evergreen recycling with Spintax and post callbacks**: Re-queues posts automatically with `{option1|option2}` Spintax variations and sets conditional follow-up callbacks based on reach or engagement ([publer.com/features](https://publer.com/features)).
  - **Image and video watermarks + Canva integration**: Stamps brand logos/watermarks onto media automatically and imports designs straight from Canva ([publer.com/features](https://publer.com/features)).
  - **Multi-provider URL shorteners and UTM presets**: Connects Bitly, Rebrandly, Dub, Switchy, PixelMe, etc., and applies per-account UTM templates ([publer.com/features](https://publer.com/features)).
  - **Hashtag groups, reusable shortcodes, and holiday calendar**: Inserts saved hashtag sets and text shortcodes (`{{signature}}`) and surfaces social media holiday prompts on the calendar ([publer.com/features](https://publer.com/features)).
  - **First comment and delayed follow-up comments**: Schedules first comments across Instagram, Facebook, LinkedIn, and X, plus multi-comment sequences ([publer.com/features](https://publer.com/features)).
  - **Browser extension, mobile app, and PDF reports**: Clips links/images from Chrome, triggers mobile reminder push alerts, and exports client analytics reports ([publer.com/features](https://publer.com/features)).
- **Documented User Complaints**: No unified social inbox for comments/DMs, no Reddit scheduling, paywalled recycling/best-time/X on higher tiers, cluttered widget-heavy UI, client approval requiring workspace account login (no login-free link), and Meta/mobile upload friction.

### 4. Hypefury

- **Website**: [https://hypefury.com](https://hypefury.com)
- **Notable Features**:
  - **Voice-trained AI writer with auto-refill queue**: Learns from past posts, edits, and rejections to draft posts into empty queue slots automatically (1-click slot fill or 6-hour auto-refill) ([hypefury.com](https://hypefury.com)).
  - **Evergreen queue and Autoplug**: Automatically cycles evergreen winners back into open slots and attaches follow-up promo comments on high-performing posts ([hypefury.com](https://hypefury.com)).
  - **Instagram Auto DMs with email capture**: Sends automatic DMs containing links or lead magnets when users comment a trigger keyword, optionally collecting and exporting email addresses ([hypefury.com](https://hypefury.com)).
  - **Engagement Builder feed (Threads & Bluesky)**: Curates posts from chosen accounts and niche keywords into a single reply queue with AI-drafted reply suggestions ([hypefury.com](https://hypefury.com)).
  - **Reddit and Hacker News Social Listening**: Monitors up to 5 brand/competitor keywords on Reddit and HN and drafts contextual replies ([hypefury.com](https://hypefury.com)).
  - **Tweetshots and built-in link-in-bio (`hfl.ink`)**: Converts text posts into styled quote-card images for Instagram/LinkedIn and hosts mobile deep-linking bio pages ([hypefury.com](https://hypefury.com)).
  - **Bulk CSV import, ghostwriter seats, and MCP**: Supports CSV queue uploads, ghostwriter/manager roles, and Claude/ChatGPT MCP control ([hypefury.com](https://hypefury.com)). (Note: Hypefury dropped X support in 2026 and focuses on Instagram, Facebook, Threads, LinkedIn, TikTok, and Bluesky.)

### 5. Metricool

- **Website**: [https://metricool.com/social-media-management/](https://metricool.com/social-media-management/)
- **Notable Features**:
  - **Autolists (evergreen + RSS/CSV feeds)**: Creates themed recurring queues fed manually, by CSV, or from RSS feeds that auto-fill the calendar ([metricool.com/planner](https://metricool.com/planner/)).
  - **Planner with Best Time heatmap and Kanban/Calendar views**: Overlays historical audience-activity heatmaps directly onto calendar time slots to guide scheduling ([metricool.com/planner](https://metricool.com/planner/)).
  - **SmartLinks 2.0 (link-in-bio + UTM tracking)**: Provides customizable multi-link landing pages mapped to Instagram/TikTok posts with click analytics ([metricool.com/socialmedia-smartlinks](https://metricool.com/socialmedia-smartlinks/)).
  - **Competitor analysis and Hashtag Tracker**: Tracks rival accounts' posting cadence/growth and audits hashtag campaign reach ([metricool.com/competitors](https://metricool.com/competitors/), [metricool.com/hashtag-tracker](https://metricool.com/hashtag-tracker/)).
  - **Looker Studio (Data Studio) connector, PDF/PPT reports, and Metricool Studio AI**: Streams live social metrics to external BI dashboards, exports branded reports, and summarizes analytics via MCP/AI ([metricool.com/dsconnector](https://metricool.com/dsconnector/), [metricool.com/reports](https://metricool.com/reports/), [metricool.com/metricool-mcp-claude](https://metricool.com/metricool-mcp-claude/)).
  - **Unified Inbox and DM Flows**: Consolidates comments and DMs with automated keyword DM flows ([metricool.com/social-media-inbox](https://metricool.com/social-media-inbox/), [metricool.com/flows](https://metricool.com/flows/)).
- **Documented User Complaints**: Aggressive image compression degrading uploaded client photos, X charged as a separate per-account add-on, account disconnection complaints, and multi-year analytics chart glitches.

### 6. Later

- **Website**: [https://later.com/social-media-management/](https://later.com/social-media-management/)
- **Notable Features**:
  - **Visual Instagram 3xN Grid Planner**: Drag-and-drop preview of how scheduled and published posts align visually on the Instagram profile grid before publishing ([later.com/social-media-scheduler](https://later.com/social-media-scheduler/)).
  - **Linkin.bio**: Clickable, shoppable Instagram/TikTok grid mirror page routing post clicks to product or article URLs ([later.com/social-media-management](https://later.com/social-media-management/)).
  - **Saved Captions and Hashtag Suggestions**: Reusable caption snippets and hashtag groups with automated hashtag recommendations based on post text ([later.com/social-media-scheduler](https://later.com/social-media-scheduler/)).
  - **External Review Links (7-day guest sign-off)**: Shares calendar/post batches with external clients for approval without requiring them to join the workspace ([later.com/social-media-approval-workflow](https://later.com/social-media-approval-workflow/)).
  - **UGC Collect with automatic attribution**: Searches mentions/hashtags/URLs to pull user-generated media into the library with creator handles preserved ([later.com/social-media-management](https://later.com/social-media-management/)).
  - **Best Time to Post and Future Trends**: Highlights personalized high-engagement posting windows and emerging audio/format trends ([later.com/social-media-analytics](https://later.com/social-media-analytics/)).
- **Documented User Complaints**: Rigid "Social Set" billing (1 profile per platform per set), low monthly post caps on entry plans, strict AI credit caps, thumbnail selection bugs, and missing inbox/approvals on lower tiers.

### 7. SocialBee

- **Website**: [https://socialbee.com/features/](https://socialbee.com/features/)
- **Notable Features**:
  - **Category-based scheduling matrix**: Organizes posts into topic categories (e.g., Blog Posts, Quotes, Promos) and assigns weekly calendar slots to categories rather than individual posts ([socialbee.com/features](https://socialbee.com/features/)).
  - **Evergreen requeue with Post Variations and Expiration**: Cycles evergreen posts back into their category queue, rotates multiple caption/media variations so repeats look fresh, and auto-expires posts on a date or after N shares ([socialbee.com/features](https://socialbee.com/features/)).
  - **RSS import mapped straight to categories**: Ingests RSS articles directly into chosen evergreen or one-off categories ([socialbee.com/features](https://socialbee.com/features/)).
  - **Canva, Unsplash, and GIPHY integrations**: Imports designs, stock photos, and GIFs inside the composer ([socialbee.com/features](https://socialbee.com/features/)).
  - **AI Copilot strategy generator**: Generates a full category mix, posting times, and initial posts from a website URL and brief ([socialbee.com/ai-social-media-manager](https://socialbee.com/ai-social-media-manager/)).
  - **URL shorteners, UTM presets, first comment, and PDF analytics**: Supports 7 shorteners (Bitly, Rebrandly, Replug, Switchy, RocketLink, BL.INK, JotURL), UTM/Ref tagging, first comments, Universal Posting reminders, team `@mention` notes, and PDF report exports ([socialbee.com/features](https://socialbee.com/features/)).
- **Documented User Complaints**: No native X thread composer, no social listening, category-queue workflow feels rigid for ad-hoc visual planning, and basic analytics/inbox depth compared to suites.

### 8. Hootsuite

- **Website**: [https://www.hootsuite.com/platform](https://www.hootsuite.com/platform)
- **Notable Features**:
  - **Streams and Social Listening (Lumen)**: Multi-column live feeds monitoring keywords, hashtags, lists, sentiment, and brand mentions across 30+ networks, forums, and review sites ([hootsuite.com/platform](https://www.hootsuite.com/platform)).
  - **Bulk Composer (up to 350 posts via CSV)**: Imports large scheduled batches from spreadsheets with inline validation ([hootsuite.com/platform/publishing](https://www.hootsuite.com/platform/publishing)).
  - **Best Time to Publish by Goal**: Recommends posting times segmented by objective (reach, engagement, clicks, awareness) ([hootsuite.com/platform/analytics](https://www.hootsuite.com/platform/analytics)).
  - **Multi-tier Approvals and Compliance (Vigil)**: Enforces multi-step sign-offs, role permissions, and compliance checks before publishing ([hootsuite.com/platform](https://www.hootsuite.com/platform)).
  - **Enterprise Unified Inbox (Nest) and Employee Advocacy (Parliament)**: Skill-based routing, auto-responders, CRM links (Salesforce/HubSpot), and one-click employee resharing ([hootsuite.com/platform](https://www.hootsuite.com/platform)).
  - **Canva/Adobe Express templates, Wisdom AI, and Custom PDF Reports**: Built-in design integrations, AI captioning, industry benchmarks, and scheduled PDF report delivery ([hootsuite.com/platform](https://www.hootsuite.com/platform)).
- **Documented User Complaints**: High per-seat pricing (~$199-$249/user/month), cluttered stream-heavy UI, frequent social account disconnects, and gating approvals behind expensive tiers.

---

## Part 3: Cross-Product Demand and Self-Hosting Pain Summary

1. **Author daily-experience gaps most cited across tools**:
   - **Evergreen recycling and category/time-slot queues** (Typefully, Publer, Buffer Beta, Metricool Autolists, SocialBee, Hypefury, Postiz repeat).
   - **Shareable, login-free client review links** (Postiz approvals, Typefully inline-comment draft links, Later 7-day links, CogSend expiring draft links) vs requiring client accounts (Publer complaint, Postdot current gap).
   - **First comments on Instagram, Facebook, and LinkedIn** (Publer, SocialBee, Mixpost Pro, Buffer) and **YouTube/TikTok/Threads/Pinterest** support.
   - **Bulk CSV import and RSS-to-draft automation** (Publer, Hootsuite, Metricool, SocialBee, Postiz, Buffer Feeds).
   - **Calendar drag-and-drop rescheduling** (expected baseline in Buffer, Postiz, Mixpost Pro, Publer, Later, Postflare).
   - **Reusable composer helpers**: hashtag groups, text snippets/signatures, post templates, `@mention` lookup/manager, and URL shorteners + UTM presets.
2. **Self-hosting complaints Postdot should avoid repeating**:
   - **OAuth fragility and Meta/LinkedIn/TikTok setup barriers**: Postiz `#918` (56 comments), `#2350`, `#1582`, `#1362`, `#2297`; Mixpost `#167`, `#197`; TryPost `#186`, `#212`; Postmill `#60`. Self-hosters repeatedly ask for clear provider capability flags, local/browser-extension or BYO-credentials fallbacks, and resilient token refresh (`#1595`).
   - **Heavy container footprint and multi-service install failures**: Postiz `#950` (5.24 GB image), `#1174` (37 comments), `#1570` (32 idle workers); Mixpost `#50`, `#56`, `#60`, `#80`, `#104`; Socioboard `#2`, `#119`, `#250`; Brightbean `#111`.
   - **Signup lockdown and self-hosted auth**: Disabling public signups, invite-only mode, OIDC/SSO, and 2FA/Passkeys appear near the top of Postiz (`#392`, `#1071`, `#480`) and Brightbean (`#23`, `#22`), and are highlighted in OpenPost, CogSend, and Mixpost Pro (`v6.3.0`).
   - **Media pipeline reliability**: Behind-reverse-proxy media URL failures, missing video transcoding/size checks, and S3/R2 storage options (`Postiz #322`, `#1124`, `#1431`, `#1472`; `Mixpost #63`, `#197`; `Mixpost roadmap`; `CogSend #26`).

---

## Part 4: Candidate Features for Postdot (Unranked)

Effort scale: **S** (days, single module/UI tweak), **M** (1-3 weeks, new schema/jobs/UI), **L** (multi-week+, new platform/media/AI infrastructure).

| feature | seen in | evidence of demand (links, reactions) | already in Postdot | rough effort |
|---|---|---|---|---|
| Calendar drag-and-drop rescheduling and click-slot creation | Postiz, Mixpost Pro, Buffer, Publer, Later, Postflare | Baseline expectation across schedulers; Postiz calendar docs ([moving posts](https://docs.postiz.com/general/calendar/moving-posts)) and Mixpost Pro v7.0 ([releases](https://mixpost.app/releases/pro)) | **partly** (`CALENDAR_INTERACTIONS = { drag: false, resize: false, selectSlot: false }` in `apps/web/src/components/publication-calendar.tsx`) | S |
| External login-free draft preview and approval links | Postiz, Typefully, Later, CogSend | Postiz approvals ([docs](https://docs.postiz.com/general/approvals)); CogSend #20 ([issue](https://github.com/cogsend/cogsend/issues/20)); Publer users complain about forcing client logins ([Publer features](https://publer.com/features)) | **partly** (internal project approvals only in `packages/db/src/manual-store/publication-approval-store.ts`; gap noted in `apps/docs/content/alternatives/postiz.mdx`) | M |
| Inline phrase comments and revision notes on drafts | Typefully, SocialBee, TryPost | Typefully collaborative draft highlights ([typefully.com](https://typefully.com)); SocialBee `@mention` notes ([socialbee.com/features](https://socialbee.com/features/)) | **no** (rejection reason string only in `packages/db/src/manual-store/publication-approval-store.ts`) | M |
| First comment scheduling for Instagram, Facebook, and LinkedIn | Publer, SocialBee, Mixpost Pro, Buffer | Postiz D#235 (4 upvotes, [discussion](https://github.com/gitroomhq/postiz-app/discussions/235)); Mixpost Pro roadmap "Now" ([roadmap](https://roadmap.mixpost.app)) | **partly** (Bluesky and Mastodon only in `packages/db/src/publication-first-comment-store.ts` and `apps/docs/content/docs/(guides)/(studio)/first-comments.mdx`) | M |
| Media in thread replies and automatic long-text thread splitter | Typefully, Postiz, CogSend, Buffer | Postiz #275 (7 `+1`, [issue](https://github.com/gitroomhq/postiz-app/issues/275)); Typefully & CogSend core workflow ([typefully.com](https://typefully.com), [cogsend](https://github.com/cogsend/cogsend)) | **partly** (text-only thread replies up to 25 items on X/Bluesky/Mastodon in `packages/core/src/thread.ts`, no media in replies, no auto-split) | M |
| Evergreen content recycling and post expiration | Postiz, Buffer (Beta), Publer, Hypefury, Metricool, SocialBee | Buffer Suggestions ([recurring posts](https://suggestions.buffer.com/p/recurring-posts)); [Postiz #279](https://github.com/gitroomhq/postiz-app/issues/279) (18 comments); SocialBee/Publer core differentiator ([socialbee.com/features](https://socialbee.com/features/)) | **no** (checked `DESIGN.md`, `apps/docs/content/docs/(guides)/(studio)/concepts.mdx`) | M |
| Post variations / Spintax for recycled or cross-posted drafts | Publer, SocialBee, Mixpost Pro | Highlighted in SocialBee ([features](https://socialbee.com/features/)) and Publer ([features](https://publer.com/features)) to avoid duplicate-spam penalties | **no** (only per-channel manual overrides exist in `apps/docs/content/docs/(guides)/(studio)/concepts.mdx`) | M |
| Weekly recurring posting time-slot grid and "Next Available" queue button | Buffer, Postiz, Mixpost Pro, SocialBee, Hypefury | Postiz time slots + `find-slot` API ([docs](https://docs.postiz.com/general/channels/time-slots)); Buffer queue slots ([buffer.com/publish](https://buffer.com/publish)) | **partly** (queue mode and daily cadence caps exist in `packages/db/src/channel-cadence.ts`, no weekly day-by-day slot matrix or one-click Next Slot picker) | M |
| Bulk CSV / spreadsheet post import | Publer, Hootsuite, Metricool, Hypefury, SocialBee | Publer G2/FB reviews cite 500-post CSV upload as a top time-saver ([publer.com/features](https://publer.com/features)) | **no** (only bulk move/schedule/cancel on existing drafts in `apps/web/src/components/publication-bulk-schedule-dialog.tsx`) | M |
| RSS / Atom feed auto-import to drafts or queue | Postiz, Buffer Feeds, Publer, Metricool, SocialBee, Socioboard | Standard automation feature across 6 surveyed tools ([Postiz RSS](https://docs.postiz.com/general/automations/auto-post-rss)) | **no** (checked `apps/docs/content/docs/(developers)/(clients)/automation.mdx`) | M |
| Outbound lifecycle webhooks (post scheduled, published, failed, approved) | Postiz, Mixpost Pro, TryPost | Postiz #1191 (7 `+1`, [issue](https://github.com/gitroomhq/postiz-app/issues/1191)); Mixpost Pro v7.0.11/v7.2 ([releases](https://mixpost.app/releases/pro)) | **no** (`packages/custom-http/src/transport.ts` is an outbound post destination channel, not lifecycle event webhooks) | M |
| Built-in URL shortener integration (Shlink, Kutt, Dub, Bitly) and UTM preset builder | Postiz, Mixpost Pro, Publer, SocialBee, Metricool | Mixpost roadmap "Next" for Kutt ([roadmap](https://roadmap.mixpost.app)); [Postiz D#1339](https://github.com/gitroomhq/postiz-app/discussions/1339); Publer/SocialBee multi-shortener support | **no** (checked `apps/docs/content/docs/(guides)/(studio)/concepts.mdx`) | M |
| Reusable post templates, signatures/snippets, and hashtag groups | Mixpost Pro, Publer, Later, Buffer, Postiz, TryPost, Postflare | Postiz reusables ([docs](https://docs.postiz.com/general/settings/reusables)); Mixpost #19; Later Saved Captions ([later.com](https://later.com/social-media-scheduler/)) | **no** (`packages/db/src/taxonomy-store.ts` provides internal filtering tags/categories only, not reusable caption snippets or hashtag lists) | S |
| Saved channel sets / account groups for one-click composer targeting | Postiz, Mixpost Pro, Postflare | Postiz sets ([docs](https://docs.postiz.com/general/settings/reusables)); Postflare `group:<name>` across UI/CLI/MCP ([postflare](https://github.com/FerdiKT/postflare)) | **no** (channels are selected individually or by project) | S |
| Cross-platform `@mention` manager / autocomplete | Mixpost Pro, OpenPost, Typefully, Brightbean Studio | Postiz #944 (10 `+1`, [issue](https://github.com/gitroomhq/postiz-app/issues/944)), D#284 (7 upvotes, [discussion](https://github.com/gitroomhq/postiz-app/discussions/284)); Brightbean #133 (1 `+1`, [issue](https://github.com/brightbeanxyz/brightbean-studio/issues/133)); [OpenPost #472](https://github.com/getopenpost/openpost/issues/472) | **no** (checked `apps/docs/content/docs/(guides)/(studio)/providers/provider-capabilities.mdx`) | M |
| Instagram Reels, Stories, video posts, and LinkedIn PDF carousels/polls | Postiz, Mixpost Pro, Buffer, Publer, Later, Hypefury, Metricool | Postiz #580 (8 `+1`, [issue](https://github.com/gitroomhq/postiz-app/issues/580)), #1381 (5 `+1`, [issue](https://github.com/gitroomhq/postiz-app/issues/1381)), #1770 (3 `+1`, [issue](https://github.com/gitroomhq/postiz-app/issues/1770)), [D#426](https://github.com/gitroomhq/postiz-app/discussions/426) (6 upvotes); Buffer thumbnail request ([link](https://suggestions.buffer.com/p/customize-thumbnails-for-video-posts-including-reels)) | **partly** (Instagram supports 1 JPEG or 2-10 JPEG carousels only; LinkedIn has no PDF document upload or polls in `provider-capabilities.mdx`) | M |
| Additional channels: Threads, YouTube, TikTok, Pinterest, Google Business Profile, Reddit | Postiz, Mixpost Pro, Buffer, Publer, Metricool, SocialBee, Hootsuite | Buffer top requests: Reddit ([link](https://suggestions.buffer.com/p/reddit-50ea01be-a04b-4233-b463-30edf50e32b8)); [Postiz #510](https://github.com/gitroomhq/postiz-app/issues/510) Pixelfed (18 `+1`), [#334](https://github.com/gitroomhq/postiz-app/issues/334) GMB (22 comments), [#537](https://github.com/gitroomhq/postiz-app/issues/537) YouTube Community (8 `+1`); [Brightbean #20](https://github.com/brightbeanxyz/brightbean-studio/issues/20) Reddit (1 `+1`) | **no** (checked `apps/docs/content/docs/(guides)/(studio)/providers/provider-capabilities.mdx`) | L |
| Engagement-triggered Auto-Plug and Auto-Repost rules | Typefully, Postiz, Hypefury, Publer, OpenPost | Postiz Plugs ([docs](https://docs.postiz.com/general/automations/plugs)); Brightbean #21 ([issue](https://github.com/brightbeanxyz/brightbean-studio/issues/21)); TryPost #211 (1 `+1`, [issue](https://github.com/trypostit/trypost/issues/211)) | **no** (checked `apps/docs/content/docs/(guides)/(studio)/concepts.mdx`) | M |
| Media library folders/collections and stock photo/GIF picker (Unsplash, Giphy, Pexels) | Mixpost Pro, Publer, SocialBee, TryPost, Later, Socioboard | Mixpost Pro v4.9/v7.0 ([releases](https://mixpost.app/releases/pro)); Postiz third-party media ([docs](https://docs.postiz.com/general/composer/ai-and-imports)) | **no** (flat project media library with crop editor in `apps/docs/content/docs/(guides)/(studio)/media.mdx`) | S-M |
| Video transcoding, pre-upload platform validation, and custom cover frame picker | Mixpost Pro, CogSend, Publer, SocialBee, OpenPost | [Mixpost #63](https://github.com/inovector/mixpost/issues/63) (9 comments) and Roadmap "Next" video/photo validation ([roadmap](https://roadmap.mixpost.app)); [Postiz #814](https://github.com/gitroomhq/postiz-app/issues/814) (21 comments), #1572 (3 `+1`, [issue](https://github.com/gitroomhq/postiz-app/issues/1572)); Buffer video thumbnail request ([link](https://suggestions.buffer.com/p/customize-thumbnails-for-video-posts-including-reels)) | **partly** (image cropper exists in `apps/web/src/components/media-image-editor-dialog.tsx`; video requires ready H.264 MP4 with no cover picker or transcoding in `media.mdx`) | M-L |
| Watermarks / automatic brand logo overlay and text-to-image quote card generator | Publer, Hypefury, OpenPost, Postmill | Core daily features in Publer ([features](https://publer.com/features)), Hypefury Tweetshots ([hypefury.com](https://hypefury.com)), and OpenPost Image Designer ([github.com/getopenpost/openpost](https://github.com/getopenpost/openpost)) | **no** (checked `apps/web/src/components/media-image-editor-dialog.tsx`) | M |
| Visual Instagram 3xN Grid preview | Later, Metricool, Publer | Core differentiator driving Instagram creators to Later ([later.com](https://later.com/social-media-scheduler/)) | **no** (checked `apps/web/src/components/publication-calendar.tsx`) | S |
| Analytics expansion (X, LinkedIn, IG, FB), follower growth charts, and PDF client reports | Mixpost Pro, Metricool, Later, SocialBee, Hootsuite, Typefully, Postiz | Postiz #1680 (3 `+1`, [issue](https://github.com/gitroomhq/postiz-app/issues/1680)); TryPost #377 ([issue](https://github.com/trypostit/trypost/issues/377)); Mixpost Roadmap "Now" PDF export ([roadmap](https://roadmap.mixpost.app)) | **partly** (delivery logs + Bluesky/Mastodon/DEV.to snapshots + CSV export only in `provider-capabilities.mdx` and `apps/docs/.openapi/postdot.json`) | L |
| Best-time-to-post recommendations / engagement heatmap | Buffer, Mixpost Pro, Metricool, Later, SocialBee, Hootsuite | Highlighted across 6 commercial tools and Mixpost Pro v7.0 ([releases](https://mixpost.app/releases/pro)) | **no** (checked `packages/db/src/channel-cadence.ts`) | M |
| Unified comment and DM inbox across connected networks | Mixpost Pro, Buffer, Metricool, Later, SocialBee, Hootsuite, OpenPost, Postmill | Postiz D#235 (4 upvotes, [discussion](https://github.com/gitroomhq/postiz-app/discussions/235)); CogSend #8 ([issue](https://github.com/cogsend/cogsend/issues/8)); Publer/SocialBee gap cited in Reddit reviews | **partly** (reply snapshots and replies for Bluesky and Mastodon only in `packages/db/src/publication-reply-store.ts`) | L |
| Ideas backlog / Kanban board view | Buffer Create, TryPost, Metricool | Buffer Create ([buffer.com/create](https://buffer.com/create)); TryPost Board view ([issue #500](https://github.com/trypostit/trypost/issues/500)) | **no** (list and calendar views only in `DESIGN.md`) | M |
| BYOK AI writing assistant, Brand Voice, AI alt text, and custom OpenAI base URL | Postiz, Mixpost Pro, Typefully, Hypefury, OpenPost, Postmill, Buffer | Postiz #1074 (10 `+1`, 25 total, [issue](https://github.com/gitroomhq/postiz-app/issues/1074)), [#498](https://github.com/gitroomhq/postiz-app/issues/498) (9 `+1`), [#256](https://github.com/gitroomhq/postiz-app/issues/256) (8 `+1`); Mixpost Pro v5.0/v7.0 ([releases](https://mixpost.app/releases/pro)) | **no** (AI workflow relies on external agents via MCP/CLI/API in `automation.mdx`, no built-in LLM/alt-text generator) | M |
| Browser extension for quick web clipping and saving drafts | Buffer, Publer, Postiz | Buffer, Publer, and Postiz all ship Chrome extensions for clipping or session auth ([docs.postiz.com](https://docs.postiz.com/general/platforms/overview)) | **no** (checked `README.md` and `integrations/`) | M |
| Native mobile app or mobile share-sheet / push reminders | Buffer, Publer, Later, Hootsuite, OpenPost, Typefully | Postiz #1008 mobile support (17 `+1`, [issue](https://github.com/gitroomhq/postiz-app/issues/1008)); Publer mobile reminders ([publer.com/features](https://publer.com/features)) | **partly** (mobile-responsive web agenda view and internal notifications in `DESIGN.md` and `packages/core/src/notification.ts`, no native app or mobile push) | L |
| Self-hosting auth hardening: disable/invite-only registration, OIDC/SSO, 2FA/TOTP, Passkeys | Mixpost Pro, OpenPost, CogSend, Postiz | [Postiz #392](https://github.com/gitroomhq/postiz-app/issues/392) (13 `+1`), [#1071](https://github.com/gitroomhq/postiz-app/issues/1071) (9 `+1`), [#480](https://github.com/gitroomhq/postiz-app/issues/480) (7 `+1`), [#807](https://github.com/gitroomhq/postiz-app/issues/807) (19 comments); [Brightbean #23](https://github.com/brightbeanxyz/brightbean-studio/issues/23) (3 `+1`), [#22](https://github.com/brightbeanxyz/brightbean-studio/issues/22); Mixpost Pro v6.3 OIDC ([releases](https://mixpost.app/releases/pro)) | **no** (`packages/auth/src/plugins.ts` configures Better Auth `admin`, `organization`, and `apiKey` only) | S-M |
| Natural-language date input and command palette (`Cmd+K`) | Typefully | Core author-speed feature in Typefully ([typefully.com](https://typefully.com)) | **no** (standard date/time picker in Studio) | S |
