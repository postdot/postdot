# SPEC-008 — Telegram publishing

- Status: draft; initial single-media scope accepted by owner on 2026-10-17
- Scope: First-party Telegram connection, content validation and durable publication
- Provenance: Owner-approved expansion sequence; [ISSUE-165](../ISSUES.md); TELEGRAM-498
- Related specification: [SPEC-004](SPEC-004-publication-content-boundary.md)
- Superseded by: none

This is a reviewable implementation proposal, not an accepted public contract or
an announcement of available functionality. No live bot has been connected.

## Operator outcome

Connect a bot to a Telegram broadcast channel, prepare a publication in Studio or
through the existing machine clients, and schedule it through Postbot's normal
queue. A successful publication records a stable remote identity. Connection
checks must not send a test post.

The publishing integration is independent of Telegram as a notification delivery
provider. It must not acquire a user's personal Telegram session.

## Verified provider constraints

Checked against the official Bot API and FAQ on 2026-10-16:

- Bot credentials occur in the API URL path, requiring URL redaction.
- Text messages allow 1–4096 characters; photo/video captions allow 0–1024.
- Photos have a 10 MB limit, combined dimensions at most 10000 and aspect ratio
  at most 20. Video upload supports MPEG4, up to 50 MB.
- Message methods return one Message; media groups return multiple messages.
- Channel posting requires appropriate bot administrator rights.
- Errors may include retry_after or migrate_to_chat_id.

Provider limits are not proof that Postbot's current inspectors or upload policy
support every accepted file. Keep Postbot's supported MIME types explicit and
verify exact byte boundaries before encoding constants.

## Proposed initial contract

One publication produces one Telegram message: plain text, or one supported image
or MP4 video with an optional caption. Do not split long text into multiple posts,
truncate content or silently discard media. Reject excess media before dispatch.

Use a conditional caption limit when media is present; do not restrict all text
posts to the caption limit. Shared schema/capability validation and the native
provider validation adapter must agree. Test astral emoji and combining characters
against the counting strategy; do not guess that UTF-16 length is the limit.

This proposal starts with public/private broadcast channels. Group permissions,
forum topics and direct messages need explicit follow-up scope. Polls remain a
separate native format; discovering sendPoll is not enough to expose a correct
poll editor, options model and result identity.

## Connection and ownership

Use the existing project-owned publisher/credential boundary. Accept a bot token
and channel reference, resolve getMe and getChat, then check the bot's own
getChatMember entry and posting rights. Persist the resolved numeric chat identity
as text; a mutable username is display metadata, not destination identity.

Never send a message to verify a connection. Do not register/delete Telegram
webhooks or consume getUpdates: the same bot may already serve another tool.
Connection success verifies current access only; send-time errors must still
handle revoked rights. Do not offer arbitrary production Bot API origins in the
connection form. Inject transport origins/fetchers for deterministic tests.

Public connection responses contain only safe bot/channel metadata. Encrypt the
bot token through the current secret store. Error bodies, request URLs and thrown
exceptions must not disclose it. Disable redirects on credential-bearing calls.

## Delivery and recovery

Preserve the executor's durable claim and effect boundary. Upload from owned
local/S3 storage through the existing media abstraction. Avoid an extra public
media service or provider-side fetch dependency for the initial upload path.

Record a remote identity that includes both chat and message identifiers. The
current ExternalEffectOutcome exposes one externalId string, so a bare message
number would be insufficient outside its chat. Specify the encoding in the
provider contract and test round trips. Add an external URL only where its public
form is verified; do not fabricate invite links for private channels.

An uncertain send result is ambiguous: timeout, broken response or missing remote
identity must not trigger blind replay. A valid negative provider response may
support a definitive failure; classify status and envelope together. Do not trust
arbitrary description text as proof of retry safety. Respect a validated retry
hint for flood control. Do not enable paid broadcasting. A reported destination
migration must not silently redirect an existing connection.

## Why albums require a separate choice

Single media preserves the current one-result execution shape and provides a
usable path without schema changes for multiple remote identifiers. Its cost is
that a source with several media needs a destination adaptation.

Albums avoid that restriction but introduce several message identifiers, shared
album identity and recovery questions. Choosing one message as externalId while
losing the others would hide those responsibilities. An album-capable contract
needs explicit storage, inspection and future deletion/comment semantics. The
owner selected text plus one media on 2026-10-17; albums are deferred.

Adding a separate text message after media has the same multi-effect problem; it
is not an acceptable shortcut around the caption limit.

## Implementation sequence and acceptance

1. Provider package: typed input/outcome contracts, metadata checks, text and
   multipart publication, safe errors and injected fetcher tests. Adding the
   package also updates the IDE workspace, lockfile and Docker manifest inputs;
   validate a fresh production image.
2. Application integration: versioned built-in profile, provider registration,
   encrypted project connection and execution adapter. Check the actual runtime
   and model registries rather than only adding a provider to Studio's list.
3. Studio: connection fields, actionable errors, native constraints/preview and
   translated labels. API, CLI and MCP must share server validation.
4. Isolated integration: connection verification sends no message, stored secrets
   stay private, scheduling uses the existing worker, remote identity persists,
   definite rate limiting defers and uncertain sends become ambiguous.
5. Live acceptance only with an explicitly supplied test bot and destination.
   Never infer authorization to send from the existence of local credentials.

Required test cases include invalid/revoked tokens, missing posting rights,
username resolution, private channels, incorrect response chat, invalid message
identity, malformed envelopes, rate-limit hints, timeouts, redirects, secret
redaction, media inspection failures, caption limits and no automatic replay.

## Sources and code anchors

- [Bot API authentication and request envelope](https://core.telegram.org/bots/api#making-requests)
- [Text](https://core.telegram.org/bots/api#sendmessage), [photo](https://core.telegram.org/bots/api#sendphoto), [video](https://core.telegram.org/bots/api#sendvideo)
- [Media groups](https://core.telegram.org/bots/api#sendmediagroup)
- [Chat lookup](https://core.telegram.org/bots/api#getchat), [membership](https://core.telegram.org/bots/api#getchatmember)
- [Administrator rights](https://core.telegram.org/bots/api#chatmemberadministrator)
- [Error parameters](https://core.telegram.org/bots/api#responseparameters)
- [Rate-limit guidance](https://core.telegram.org/bots/faq#my-bot-is-hitting-limits-how-do-i-avoid-this)
- packages/core/src/executor.ts: one external identity and explicit ambiguity.
- apps/api/src/modules/publishers/runtime.ts: provider connection policies.
- packages/discord/AGENT.md: provider protocol versus application ownership.
