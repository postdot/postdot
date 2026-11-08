# DOCS-605 — Provider setup effort and access barriers

Status: completed documentation; no provider access or deployment changed.

## Owner direction

Postdot is self-hosted and has no central SaaS service. The owner set central Meta
App Review and a reviewer-hosted instance aside, and requested that documentation
explain the practical differences between simple credentials, automatic client
registration, manual developer setup and provider-reviewed access. These are
provider/use-case requirements, not a universal Postdot approval workflow.

## Implementation

Added `/docs/providers/setup-effort/` with four setup paths, an account/use-case
comparison for the nine supported native providers, own-business versus external-
business Meta access, and separate LinkedIn member/organization requirements.
Kept setup burden distinct from format capabilities, API entitlement, public
reachability and usage charges. No guaranteed setup time, free access, review
approval or universal difficulty score is promised. Manual/custom HTTP destinations
are explained without presenting them as API-rule workarounds.

Linked the comparison near the start of provider connections, the self-hosting
overview and deployment configuration; added it to provider navigation. Added
Facebook and Telegram to the connection index, which previously omitted those
implemented destinations. The LinkedIn and Instagram guides now point to their
specific eligibility/review boundaries before configuration.

Updated the current META-603, DOCS-604 and INSTAGRAM-538 task descriptions to remove
central App Review/reviewer hosting as the next project dependency. Appended the
owner's changed direction to the historical preparation records rather than
rewriting their earlier observations. Added the durable self-hosted provider-
access boundary to root AGENT.md.

## Sources and verification

Checked Postdot's provider guides, Telegram connection/verification code and the
existing Meta live-acceptance/preparation evidence. Primary sources used:

- [Forem API](https://developers.forem.com/api): user-generated API keys.
- [Telegram bot tutorial](https://core.telegram.org/bots/tutorial): BotFather bot creation and token issuance. Postdot's own verification requires channel administration and posting rights.
- [Mastodon OAuth](https://docs.joinmastodon.org/spec/oauth/): provider application registration endpoint and authorization flow.
- [AT Protocol OAuth specification](https://atproto.com/specs/oauth): automated client registration through public metadata and local-development exception.
- [Discord application setup](https://docs.discord.com/developers/quick-start/getting-started): manual bot application, credentials and server installation rights. Did not infer a large-scale bot-verification rule for a private installation.
- [Share on LinkedIn](https://learn.microsoft.com/en-us/linkedin/consumer/integrations/self-serve/share-on-linkedin): member publishing product/permission.
- [LinkedIn Community Management review](https://learn.microsoft.com/en-us/linkedin/marketing/community-management-app-review): vetted product, legal-organization/commercial-use eligibility and broader-access review. Used the current unversioned entry point, not an expired API version.
- [Meta Unified access levels](https://developers.facebook.com/documentation/instagram-platform/instagram-api-with-unified-login/permissions) and [review scenarios](https://developers.facebook.com/documentation/instagram-platform/app-review): eligible role-authorized own-account Standard Access differs from external-business Advanced Access. Both were read through the official portal in META-603.
- [X OAuth configuration](https://docs.x.com/fundamentals/authentication/oauth-2-0/authorization-code): existing verified Postdot setup boundary. No current price, universally free entitlement or guaranteed automatic approval is stated.

Full docs build passed with the added navigation, comparison page and heading
links: 249 exported pages, 1,163 local link targets and zero link failures.
Markdown/LLM export, social metadata, formatting and spelling checks passed.
The repository commit hook runs the full static gates before integration. No application behavior changed and no new provider calls or
publication acceptance were performed.

## Next step

Return to preparing the grouped Instagram delivery for the next alpha release.
Keep the comparison visible before users start configuring a destination. Any
future Studio prerequisite summary should use the same use-case distinctions,
without implying that Postdot can grant provider access or that every operator
needs a central App Review process.
