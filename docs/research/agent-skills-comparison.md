# First Postdot agent skills: source comparison

Scope: product-operation skills for the first public alpha, not repository coding
instructions. This small design comparison is not a ranking or an evaluation of
the competing products. Sources were inspected at the revisions below; their
instructions were not executed or adopted as repository policy.

## Sources and decisions

- [Postiz Agent](https://github.com/gitroomhq/postiz-agent/blob/17f1e27b006c02cb46c64e8a319dc75dcfd870d2/SKILL.md):
  the official skill connects authentication, integration discovery, destination
  settings, media preparation and posting. Adopt discovery before construction
  and explicit provider-specific constraints. Its large command catalog and
  shorthand examples require interpretation; keep Postdot's entrypoints short
  with runnable, qualified examples. Postiz's CLI installation, OAuth, platform
  count and media semantics do not establish equivalent Postdot features.
- [Resend API](https://github.com/resend/resend-skills/blob/b2ae7b1798b70134faf679f35fc05b4331462988/skills/resend/SKILL.md)
  and [CLI](https://github.com/resend/resend-skills/blob/b2ae7b1798b70134faf679f35fc05b4331462988/skills/resend-cli/SKILL.md):
  selective task references and non-obvious result handling help an agent choose
  its next action. Adopt those patterns and separate skill/application versions.
  Do not copy retry/idempotency guarantees: Postdot has no automatic write retry
  or exactly-once submission guarantee.
- [Sentry debug-issue](https://github.com/getsentry/sentry-for-ai/blob/cb3ad7df272ee52326e1f710a866039aecffc460/src/skills/sentry-debug-issue/SKILL.md):
  relates observed failures to evidence and deployed source, treating diagnostic
  text as untrusted. Adopt scoped evidence collection, release matching and
  hypothesis verification. Do not import its MCP requirement, development/fix
  workflow or issue-resolution side effects into an operator diagnosis request.

Community Buffer skills were considered in discovery but not used as an
implementation authority. The official corpus covers the needed patterns.
These are paraphrased observations; Postdot instructions/scripts are original,
not vendored upstream resources.

## Architecture and compatibility

Three independently installable directories live in `skills/`:
`postdot-self-host`, `postdot`, `postdot-troubleshoot`. Each uses portable
SKILL.md frontmatter and relative references, without mandatory harness-specific
plugins or a dependency on another installed skill.

The use skill defaults to HTTP through a Python standard-library helper; using
a released container does not require a development checkout or Bun. Existing
source CLI commands remain optional; no standalone npm CLI or MCP is claimed.
The self-host skill carries exact Compose assets and prepares a new private
configuration without overwriting an existing deployment. Diagnostics are local
by default, not automatic public issues or perpetual debug logging.

Verified baseline: alpha `0.1.0-alpha.1`, source
`99badfb431b95a817c645e716267815925c1f6cc`.

| Workflow | Surface and limitation |
| --- | --- |
| Deployment, persistence, backup | Published image and Compose; host access required |
| Administrator, key creation, provider OAuth | Authorized human session |
| Discover channels/profiles/publishers | API with effective owner/key permissions |
| Draft/edit/review proposal | API; proposal remains inert |
| Schedule inspected draft | Dispatch permission, expected revision and authorized instant |
| Media transfer | Studio or source CLI; JSON helper does not stream binary files |
| Unknown delivery | Inspect state/evidence; no blind write retry |
| MCP / standalone packaged CLI | Not shipped by these skills |

See [installation and handoff](../agent-skills.md) and
[evaluation](agent-skills-evaluation.md).
