# Project Issues

## [ISSUE-021] Validate the central publication loop through real use

- Type: proposal
- Status: open
- Evidence: The repository has deterministic unit, integration, browser, and
  provider tests, but the continuous product direction has not yet been validated
  through a sustained real workflow using multiple destinations and the dashboard,
  API, and CLI together. EVAL-53 established and exercised the safe local
  validation loop; the automatic-provider stage remains gated by an explicit
  destination and action-time approval.
- Impact: Technical foundations can appear complete while the real publication
  manager still requires a parallel tracker or awkward manual workarounds.
- Desired outcome: Postbot periodically exercises and records the complete intended
  publication workflow in realistic use, including automatic and manual channels,
  failures, edits, and recovery, without reintroducing a release-oriented MVP
  boundary.
- Tasks: EVAL-53 (completed; repeat periodically), EVAL-54 (completed), PUB-55 (completed), EVAL-57 (completed; repeat periodically)
- EVAL-54 completed the automatic-provider stage with an operator-approved,
  organization-scoped LinkedIn smoke test. The provider acknowledged the text
  publication, Postbot persisted the successful job and publication outcome, and
  the dashboard displayed the target as published. This issue remains open as
  a recurring validation practice rather than a one-time implementation task.
- EVAL-57 completed the automatic image-provider stage with an operator-approved
  disposable publication. The provider acknowledged the image delivery, Postbot
  persisted the successful media checkpoint and publication outcome, and the
  dashboard displayed the target as published. This remains a recurring
  validation practice rather than a release gate.
- The 2026-09-11 validation completed the same controlled loop with the Bluesky
  provider: the local loopback OAuth flow was accepted on the real provider,
  the project-owned connection was restored, and an automatic text publication
  was acknowledged by Bluesky and displayed as published in the Postbot queue.
  The validation also corrected two provider-boundary defects found during the
  run: the OAuth grant now requests the granular repository/blob permissions
  required for publication, and a revoked credential is reactivated with the
  scopes from a fresh grant instead of being rejected by the uniqueness guard.
  The publication scheduler is explicitly woken after a reschedule so the
  requested run time is applied without waiting for the previous timer.

- Remaining scope (ALPHA-578, 2026-10-24): Recurring real publication-loop validation; retain actual provider/action authorization. Not a missing publisher implementation.

## [ISSUE-127] Recover safely after an abrupt runtime termination

- Type: problem
- Status: accepted
- Evidence: ADR-068 deliberately uses a database-specific sidecar marker and
  fails closed when it remains after forced termination. The operator must
  establish that no Postbot process is using the database and then remove that
  exact marker manually before restarting.
- Impact: A normal host crash or forced stop can turn the next startup into a
  manual recovery procedure, adding friction to the self-hosted operating
  model even though the marker correctly prevents concurrent restore.
- Desired outcome: Runtime exclusion is released after process death while
  restore remains unable to race an active Postbot process. Recovery must not
  depend on marker age or PID checks alone.
- Tasks: OPS-217
- Related issue: ISSUE-026
- Related decision: ADR-068
- Scope note: The current fail-closed behavior is intentional, not a newly
  reproduced regression. OPS-217 is an evaluation task only; changing the lock
  contract requires a separately accepted decision.
- Evaluation (OPS-217, 2026-09-26): A forced-stop experiment on the current
  sidecar confirmed that SIGKILL leaves the marker and blocks restore, while a
  Linux `flock` prototype on the repository's local ext4 filesystem excluded a
  concurrent process and released after SIGKILL. This proves feasibility on this
  Linux host, not Bun integration or cross-platform behavior. The documented
  container is Linux, but the project has no explicit host-platform support
  matrix. Keep the existing contract until the owner chooses whether direct
  Windows/macOS deployment is supported and accepts a platform-tested kernel
  lock implementation; do not use heartbeat expiry or PID-only reclamation as a
  substitute. See the [OPS-217 worklog](archive/runtime-recovery-observability/worklogs/2026-09-26-OPS-217.md).

- Remaining scope (ALPHA-578, 2026-10-24): Choose host-platform support and accept/test a kernel-lock contract before replacing the fail-closed sidecar. OPS-217 evaluated feasibility only; automatic stale-marker removal is not implemented.

## [ISSUE-160] Explore a mobile Postbot client

- Type: proposal
- Status: open
- Priority: later — exploratory, not a first-launch commitment
- Evidence: The owner envisages a future mobile client alongside Studio and machine-facing tools. No dedicated mobile app workspace exists; the responsive website is not a shipped mobile application.
- Impact: Future marketing could overstate availability or a mobile implementation could duplicate domain behavior without a clear user need.
- Desired outcome: Define the mobile audience, high-value workflows, platforms and access boundaries before choosing delivery technology. Keep mobile visibly future-facing until implemented and validated; this issue does not authorize building an app.
- Tasks: none — recorded for triage; no implementation authorized by intake
- Source: owner direction, 2026-10-15; public-site planning captured in
  [public positioning](archive/root-documentation-2026-10-25/source/docs/project/public-positioning.md).

- Remaining scope (ALPHA-578, 2026-10-24): Mobile client remains an exploration proposal, not an alpha release prerequisite.

## [ISSUE-184] Validate the product with sustained real use before widening scope

- Type: problem
- Status: open
- Evidence: SPEC-001 defined a falsifiable hypothesis: one real project uses Postbot as its only publication source of truth for four consecutive weeks, including an automatic and a manual channel. SPEC-005 superseded the release framing with continuous development and did not carry over a validation milestone. No task, issue or worklog records that test being run. In about eight weeks the repository reached roughly 1,000 commits, nine built-in providers, analytics, replies, first comments, approvals, workspaces/groups, an image editor and webcam capture.
- Impact: Scope grows from internal design logic rather than observed demand, and every feature added before real use increases maintenance and later rework. Real friction (onboarding, provider setup, daily workflow) remains unknown.
- Desired outcome: A recorded, time-boxed period of real operation (for example the Postdot launch communication itself) produces evidence that drives prioritization, and an explicit owner decision states how new scope is admitted relative to that evidence.
- Related: ISSUE-181, ISSUE-190
- Tasks: none

- Remaining scope (ALPHA-578, 2026-10-24): Run a time-boxed real project workflow and prioritize from observed friction. This is product validation, not additional provider breadth.

## [ISSUE-198] The post editor fails as a whole when one channel cannot be read

- Type: problem
- Status: open
- Evidence: `loadExistingPost` (`apps/web/src/components/post-composer/load-existing-post.ts`) reads the post, every publication summary page, then every channel's editor state with `Promise.all`. One failed channel read rejects the whole load, so the route shows its error page instead of the editor. The post editor also issues one editor read per channel on every open and every refresh. Seen during UX-683: a test that failed one sibling read made the review action disappear until the load was retried.
- Impact: A transient error on one channel blocks editing every other channel of the post; posts with many channels cost N+2 requests per open and per realtime refresh.
- Desired outcome: A channel that cannot be read shows as unavailable (with retry) on its own tab while the others stay editable; consider a single post-level read for all channel states.
- Source: UX-683 migration, 2026-11-18.
- Tasks: none

## [ISSUE-199] A required media description is not signalled on the thumbnail

- Type: question
- Status: open
- Evidence: Bluesky's channel profile sets `accessibilityTextRequired: true`. Since UX-683 the description sits behind an optional "ALT" badge on the composer thumbnail, which only distinguishes empty and filled. The default description comes from the media library, so most items have one, but an item without it is not marked on the badge.
- Impact: For a channel that requires a description, the person may learn it only from a validation message elsewhere, or not before publishing.
- Desired outcome: Verify what happens today when a Bluesky media item has no description; if it blocks or fails, mark the badge (attention state) on that channel's tab only, without making the field mandatory elsewhere.
- Source: owner review, 2026-11-18.
- Tasks: none

## [ISSUE-200] Opt-in and development-only browser suites rot unnoticed

- Type: problem
- Status: open
- Evidence: `realtime-automatic-acceptance.spec.ts` (needs `POSTDOT_E2E_REALTIME_ACCEPTANCE`), the experience audit (`POSTDOT_EXPERIENCE_AUDIT`) and `editor-experiment.spec.ts` (development builds only) are excluded from the default run. During UX-683 all three had fallen behind the product: stale selectors, an obsolete menu locator, a contrast check measured mid-transition. Running the realtime acceptance found a real bug (a channel published elsewhere stayed editable under unsaved text).
- Impact: The suites that cover the riskiest paths give false confidence and find bugs late.
- Desired outcome: Run them on a schedule or as a release gate (see ADR-093 acceptance), with their results recorded in the release worklog.
- Source: UX-683, 2026-11-18.
- Tasks: none

## [ISSUE-201] Text rendered outside a language subscription stays in English

- Type: problem
- Status: open
- Evidence: Non-English catalogs load lazily (ISSUE-193). A component that renders messages without `useLanguage()` and has no subscribed ancestor keeps the English strings it rendered first. The French setup and login pages showed mixed languages until UX-683 added the subscription to the auth pages; only one browser test (setup in French) caught it.
- Impact: Any other surface outside the dashboard shell can regress the same way silently.
- Desired outcome: A guard (lint rule or a test that renders each public route in fr, es and de and finds no English base strings) instead of relying on per-component discipline.
- Source: UX-683, 2026-11-18.
- Tasks: none

## [ISSUE-202] Unused Studio message keys and retired editor leftovers

- Type: proposal
- Status: open
- Evidence: About 209 keys of `apps/web/messages/en.json` are not referenced statically from `apps/web/src` (some may be built dynamically); UX-683 removed only the 43 its deletions orphaned. The development-only `?editor=legacy` switch (`configuredEditor`) still exists on the post and publication routes, and recovery still reads legacy `postdot:publication-editor:v3:` local copies.
- Impact: Translators and the copy guards maintain text nobody sees; dead switches keep code paths alive.
- Desired outcome: Classify the unused keys (dynamic or dead), delete the dead ones with a guard against new ones; retire the legacy editor switch; drop the v3 recovery reader one release after 0.1.0-alpha.8.
- Source: UX-683, 2026-11-18.
- Tasks: none

## [ISSUE-203] Should "Save" apply channels the person did not change?

- Type: question
- Status: open
- Evidence: In the post editor, "Save" applies every channel with pending changes, which includes a channel whose draft was never applied even when the person only edited another channel (SPEC-013 "applies the post text and every changed channel version"). Seen while migrating `publication-concurrent-editing.spec.ts`.
- Impact: Probably what people expect ("what will be published equals what is shown"), but it can surprise someone who edited one channel on purpose.
- Desired outcome: Owner decision; if it stays, name the channels Save will apply (for example in its tooltip or a count).
- Source: UX-683, 2026-11-18.
- Tasks: none

## [ISSUE-204] Instance bootstrap with an API key can fail on PostgreSQL

- Type: problem
- Status: resolved (2026-11-18)
- Evidence: CI run 44318221807 (PR #40), "Unit tests on PostgreSQL": `access HTTP routes > closes public sign-up in token_required mode and bootstraps admin, workspace, session cookie, and API key atomically` returned 500 instead of 201. The log shows `[Better Auth]: Failed to delete expired API keys: PostgresError: cannot run a query after its transaction or savepoint ended`. The same code passed on the previous run; the API key plugin's background expired-key cleanup appears to run on the bootstrap transaction after it ended (ambient transaction from ADR-097 leaking into a fire-and-forget query).
- Impact: Intermittent 500 on `POST /api/instance/bootstrap` with an initial API key on PostgreSQL instances (AUTH-648); intermittent CI.
- Desired outcome: Fire-and-forget work started inside a request transaction runs outside it (or the cleanup is disabled during bootstrap); a test that reproduces the race.
- Source: PR #40 CI, 2026-11-18.
- Resolution: reproduced on every run against a local PostgreSQL 18. The bootstrap route now runs the plugin's expired-key cleanup before opening its transaction, so key creation inside it skips the cleanup (ten-second throttle). An adapter-level fix (closing the frame when the body returns) did not help: the cleanup query is already in flight on the transaction connection.
- Tasks: none

## [ISSUE-205] The access suspension journey is timing-sensitive

- Type: problem
- Status: resolved (2026-11-18)
- Evidence: `e2e/web-314-editor-access-state.spec.ts:10` ("an ambiguous signal suspends writes, verifies once, then shows removal") failed in PR #40 CI (run 44319733363: the editor textbox was gone while "Checking project access…" should hold it frozen) and once in five local development-mode repeats (test timeout; the typed attempt after revocation never reached the editor). The live revocation signal can start verification, or conclude removal, before the test's held membership read and its typed write.
- Impact: Intermittent CI; possibly a real path where removal is shown without the frozen intermediate state.
- Desired outcome: Determine whether the product can skip the frozen state (then decide if that is acceptable) and make the journey deterministic by controlling the live signal as well as the membership read.
- Source: PR #40 CI, 2026-11-18.
- Resolution: the CI trace showed a navigation to `/publications/new`. The live revocation froze the editor while the test was typing; the frozen editor lost focus, so the typed letters reached the document and the plain N shortcut (new post) fired. A real hazard for anyone typing at that moment. N now does nothing when it arrives within a second of another key. 4/4 local repeats in development mode.
- Tasks: none

## [ISSUE-210] External tools cannot react to what happens in Postdot

- Type: proposal
- Status: open
- Evidence: Postdot emits no general lifecycle events to the outside. What exists: the custom HTTP channel in `postdot_webhook` mode sends one event, `publication.delivery` (`packages/custom-http/src/contract.ts`), because it is a destination, not a subscription; the project event stream (`apps/api/src/modules/projects/realtime-routes.ts`) is server-sent events reserved to human sessions (API keys get 403); notifications cover published, failed and ambiguous outcomes, in Studio and by e-mail; the n8n node has actions only, no trigger. Postiz users ask for lifecycle webhooks (gitroomhq/postiz-app#1191, 7 votes).
- Impact: An automation or an AI workflow cannot start when a draft is created, a publication is approved, fails, or a manual publication becomes due. Manual channels are where this matters most: an external script or agent could publish on a platform Postdot cannot reach, then report the URL back.
- Desired outcome: A person subscribes an endpoint (or an n8n trigger, or a future built-in agent) to chosen events of a project, with signed deliveries, retries and a delivery log; an external tool can claim a due manual publication and confirm it with the published URL. First decide whether a custom HTTP channel already covers "publish this manual post elsewhere" and document it if so.
- Source: owner request, 2026-11-18.
- Tasks: none

## [ISSUE-211] A built-in AI agent in Studio

- Type: proposal
- Status: open
- Evidence: Postdot already exposes an MCP server with scoped tools, a REST API, a CLI and an n8n node, so external agents can operate it. The owner wants an agent inside Studio: a chat in the person's language, acting through tools within permissions the person grants, and later started by events (ISSUE-210), as Twenty CRM does. Competitors ask for bring-your-own-key and custom OpenAI-compatible base URLs (gitroomhq/postiz-app#1074, #498, #256).
- Impact: Makes Postdot usable by conversation, and turns events into automations without external tooling.
- Desired outcome: A decision on framework, provider layer (OpenAI-compatible, Anthropic, local models), reuse of the MCP tool catalog and API key scopes for permissions, key storage and cost limits, and event triggers with human approval for risky actions. Also assess the owner's idea of driving subscription CLIs (Claude Code, Codex, Gemini CLI) from the server, which is cheaper for users but fragile to install, update and authenticate, and must respect each provider's terms.
- Research (2026-11-18, [AI agent survey](reviews/2026-11-18-ai-agent-survey.md)): Twenty uses the Vercel AI SDK with lazily discovered tools, chat runs under the user's own role, and event triggers skip agent-caused events and run under a dedicated role. Suggested fit: Vercel AI SDK (Apache-2.0), provider registry for OpenAI-compatible, OpenAI Responses and Anthropic, keys encrypted with the existing secret cipher, an in-process executor shared with the MCP catalog, `confirm` rules mapped to tool approval, triggers on the existing scheduler with no new broker. Subscription CLIs on the server conflict with the consumer terms of Anthropic, OpenAI and Google as reported (to confirm before any decision) and would run a shell next to the instance secrets; the supported path for subscription users is their local CLI connected to Postdot's MCP endpoint.
- Owner position (2026-11-18): Postdot targets one person running their own instance with their own subscription, not a hosted service; most of that audience pays for AI subscriptions and few use metered APIs, which cost far more for the same volume. Subscription CLIs remain desirable; the obstacles are technical (installing, updating and authenticating CLIs on a server) and the providers' terms, not multi-user abuse. Priority: last, after the smaller items.
- Source: owner request, 2026-11-18.
- Tasks: none

## [ISSUE-212] Stronger sign-in options suited to self-hosting

- Type: proposal
- Status: open
- Evidence: Sign-in is e-mail and password through Better Auth (`packages/auth/src/plugins.ts`: admin, organization, apiKey). Public signup already closes after bootstrap and access is by invitation. Self-hosters of competing tools ask for 2FA, passkeys and OIDC (gitroomhq/postiz-app#807; brightbeanxyz/brightbean-studio#22, #23).
- Impact: An instance exposed on the internet relies on passwords alone.
- Desired outcome: Options that need no third-party application first: TOTP two-factor with backup codes, passkeys (WebAuthn, bound to the instance's domain). Then optional OIDC single sign-on against the operator's own identity provider (Authentik, Keycloak, Pocket ID, Authelia), configured by the operator. Social OAuth logins are out of scope.
- Source: owner discussion, 2026-11-18.
- Tasks: none

## [ISSUE-213] Which new platforms bring value to a self-hosted user

- Type: question
- Status: open
- Evidence: Competitors' most requested platforms: Pixelfed (gitroomhq/postiz-app#510, 18 votes), Threads, YouTube, TikTok, Pinterest, Reddit, Google Business Profile. Owner experience: TikTok direct posting needs an audited platform application, out of reach for an individual; YouTube works with a Google Cloud application in testing mode but setup is tedious. Both suit a hosted service holding one approved application, which is not planned.
- Impact: Adding a logo nobody can connect brings no value; each provider costs maintenance.
- Desired outcome: A short list ranked by "a self-hoster can connect it alone in minutes" and demand, with setup effort recorded per provider (as `providers/setup-effort.mdx` does). Likely first candidates to verify: Pixelfed (Mastodon-like API, per-instance app registration), Threads, Reddit.
- Source: owner discussion, 2026-11-18.
- Tasks: none

## [ISSUE-214] Browser tests fail intermittently on the production build

- Type: problem
- Status: open
- Evidence: On PR #46 (run 44408936164, shard 4/5) `e2e/settings-people.spec.ts` measured the invitation e-mail and role labels 1.4 px apart (limit 1 px) and `e2e/queue-bulk-actions.spec.ts` did not find the bulk action bar after rescheduling two publications. Both passed on rerun and twice locally with `POSTDOT_E2E_PRODUCTION_WEB=true`. The same run also showed `publication-media` depending on which of two same-time publications leads a grouped calendar entry (fixed on PR #43), and `editor-experiment` emoji undo failing once on the development server. On PR #43 (run 44411996480, shard 3/5) `publication-concurrent-editing.spec.ts` "applies a scheduled version once" hit its 30 s timeout in CI while it takes about 6 s locally (3 of 3 passes); a full rerun passed.
- Impact: A red round costs about 8 minutes and erodes trust in the suite.
- Desired outcome: Each test waits for the state it asserts (dialog open animation finished, bar rendered after the refresh) instead of measuring a transient frame; no rerun needed for these specs.
- Tasks: none

## [ISSUE-215] Should media be shareable between projects?

- Type: question
- Status: open
- Evidence: Media belong to one project. Owner scenario (2026-11-18): two projects announce the same event (a personal account and the product account both post about a stable release) and want the same video or image. Today this works by uploading the file twice, or by sharing the channel of one project with the other (ADR-095) and posting from there. The owner has not met the need in practice and considers it rare.
- Impact: Sharing would add cross-project ownership, permissions, usage protection and deletion rules to media, which today rely on one project owning each asset (usage protection, trash and retention); a mistake there produces orphan files or posts whose media disappear.
- Desired outcome: Decide from real use. Until a case shows that duplication or channel sharing is not enough, keep media project-scoped. If it comes back, compare "copy to another project" (no shared ownership) before any shared library.
- Tasks: none

## [ISSUE-216] Diagnosing a problem on a production instance is hard

- Type: proposal
- Status: open
- Evidence: The SMTP test (GH #49) returns one generic message for every failure and drops the cause. The API logs with pino (`LOG_LEVEL`) and exposes metrics (`docs/(self-hosting)/(operations)/metrics.mdx`), but Studio offers no way for a person to see why an operation failed, nor to produce a report to share with whoever helps them. Earlier decisions rejected third-party telemetry for a self-hosted product (ADR-042, ADR-051) and set redaction rules for operational logs (ADR-018, ADR-060); OpenTelemetry export was never decided.
- Impact: The owner, running alpha.8 in production on Kubernetes, could not tell whether the SMTP failure was configuration, TLS or a blocked port. Other users will hit the same wall without anyone to ask.
- Desired outcome: (1) failures shown in Studio say which step failed with a safe, specific reason; (2) an administrator can download a redacted diagnostic report (version, configuration summary without secrets, recent sanitized errors, connectivity checks such as SMTP and provider reachability) to attach to an issue; (3) an optional, operator-enabled OpenTelemetry export (traces, metrics, logs) for those who run a collector, off by default, never phoning home. Discuss scope with the owner before tasks.
- Source: owner discussion, 2026-11-19.
- Tasks: none
