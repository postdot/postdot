# Postdot public positioning and page narrative

Status: owner-directed product priorities, updated 2026-10-15. Section composition,
headlines and final copy remain proposals. No publication or release is authorized.

## Product and audience

Postdot is an open-source, lightweight, self-hosted social publishing tool for
humans and their existing AI agents. Entrepreneurs, community managers, artists
and teams should recognize their work before encountering technical terminology.
Do not narrow the audience to developers or independent software maintainers.

One product has multiple access paths. Studio supports direct human use; agents
work through supported tools with the same project permissions and publication
boundaries. An agent conversation uses the person's natural language, rather than
requiring the website visitor to understand shell commands. Postdot is not an
embedded AI chat product and does not require a particular model subscription.

Self-hosting starts with one service, SQLite and local media; S3-compatible storage
is optional. Infrastructure flexibility must not obscure this accessible default.
A possible future hosted service is not an existing offer or a launch commitment.

## Proposed page sequence

### Publish once, adapt and schedule

Keep the distribution illustration and shared-source story as one coherent
feature. Destination-specific text, media and scheduling can enrich that story;
a separate section that merely adds an hour would repeat it. Do not imply that
source editing rewrites published destinations or that every platform supports
identical content types.

### Humans and agents use the same Postdot

This is a primary product message, not a technical appendix. Show a common
publication/workspace with recognizable entry points: Studio, agent conversation,
CLI/API, MCP, n8n and future mobile use. Skills guide agents across the supported
workflows; they are not another transport or a separate content generator.

Recommended visual direction for review: a shared central scene with distinct
access points and one short interaction at a time. A natural-language request can
produce a draft that remains accessible in Studio. Preserve a direct human path.
Avoid terminal-first promotion, six equal feature cards, or suggesting every tool
is required. No fixed card grid/carousel/gallery layout has been accepted. Prefer a
composition that keeps access paths discoverable; a gallery may serve detailed
examples later without hiding the overall relationship.

### Core capabilities and organization

Present useful groups rather than an undifferentiated icon inventory:

- Publishing: scheduling, destination adaptations, built-in connected publishers,
  manual destinations and custom HTTP channels.
- Media: images and video, originals and internal previews, local storage and
  optional S3-compatible storage. Do not imply universal video conversion.
- Organization and access: workspaces, projects, invitations, roles and scoped
  access. A workspace groups people and projects; a project is the operational
  scope for its channels, posts, publications and media. Membership and project
  permissions are distinct. Avoid claiming infrastructure/database isolation
  merely from the existence of workspace scopes.
- Accessibility across audiences: EN/FR interface today, further languages staged
  later. Interface locale and the language of a post are separate concerns.

Show examples that clarify these concepts; the site must not become the user
manual. Accurate role/coverage details belong in the docs. The existing
[capability evidence](../capability-evidence.md) records implementation and gaps.

### Open source and simple to operate

Use a short technical explanation to substantiate low-friction self-hosting:
Bun/Elysia, TypeScript, SQLite, Drizzle, Better Auth and the TanStack-based Studio.
The benefit is an installable, maintainable product, not a technology-logo wall.
Public site/docs use a separate TanStack Start static build; do not confuse that with
the single-service production Studio/API runtime.

Lead with Docker/Compose installation, then link to exercised additional guides
when available. Swarm, Kubernetes and possibly Helm are roadmap candidates, not
currently supported deployment promises. Public AMD64/ARM64 image links must refer
to accepted published artifacts; a planned workflow or registry name is not an
available image. See [release policy](../deployment/release-policy.md) and
[self-hosting](../deployment/self-hosting.md). Speak of open source in the main
story; license details remain available without becoming a promotional argument.

## Availability boundaries

| Surface or capability | Current repository evidence | Public presentation |
| --- | --- | --- |
| Studio, API, CLI | Present; CLI operation coverage is partial | Existing ways to work, describe actual workflows |
| MCP | ISSUE-036 remains deferred for workflow stability | Planned; do not present as available |
| Agent skills | Explicit first-launch intent; not authored yet | Launch preparation; stabilize workflows before authoring |
| n8n | API exists, dedicated supported workflow not established | Intended integration; delivery format undecided |
| Mobile app | No dedicated client workspace | Future; responsive Studio is not a native app |
| Images/video, local/S3 media | Implemented boundaries and guides | Explain user benefit with provider-specific limits |
| Workspaces/projects and roles | Separate domain and authorization scopes exist | Explain the distinction without universal client-parity claims |
| Interface languages | Paraglide declares EN and FR | Name these; do not imply an existing large catalog |
| Docker/Compose | Dockerfile and Compose resources exist | Default documented installation path |
| Swarm/Kubernetes/Helm | No corresponding deliverables found | Roadmap candidates requiring independent validation |
| Public AMD64/ARM64 images | RELEASE-303 active; candidate workflow exists | No availability claim before acceptance and publication |

This is a source inventory, not a fresh validation of every feature or provider.
No release dates, capacity claims or launch platform count are established here.

## Prioritized intake

- High: ISSUE-157 public narrative, existing ISSUE-036 MCP readiness, ISSUE-158
  launch agent skills. Skills are an explicit launch intention; implementation
  waits for stable workflows. MCP's earlier stability prerequisite remains.
- Medium: ISSUE-159 n8n, ISSUE-161 additional deployment resources, ISSUE-162
  language expansion and ISSUE-163 intentional client coverage.
- Later: ISSUE-160 mobile client exploration.
- Continue RELEASE-303 for versioned images; do not duplicate the task or infer
  authorization to publish. No new implementation task follows from this intake.

The scheduling-only illustration proposal from SITE-439 is superseded by this
page direction. The next design proposal should concern the shared human/agent
usage section, with core capabilities and self-hosting following as distinct
subjects. Keep repository visibility, remote publication and product development
outside this documentation pass.
