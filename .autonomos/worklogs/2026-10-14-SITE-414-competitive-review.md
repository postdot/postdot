# SITE-414 — Competitor marketing and product presentation

Reviewed 2026-10-14. This is a research proposal, not approved public copy or an
instruction to clone competitors. Scope: official public homepages, selected
product/assistant pages and documentation. No account creation, purchase or test
of their production publishing. Their feature statements are advertised claims.

## What each site makes the visitor understand

| Site | Primary proposition | Presentation method | Useful lesson for Postbot |
| --- | --- | --- | --- |
| [Postiz](https://postiz.com/) | Agents operating a social publishing workflow | Agent-oriented opening, named audiences, integrations, demonstrations, testimonials and repeated conversion actions | An agent connection must become an understandable, usable journey rather than a general API claim |
| [Mixpost](https://mixpost.app/) | Control through self-hosted social media management | Ownership first, cloud/self-hosted choices, a selectable interface gallery, platform pages and team workflows | Explain who operates the installation and what users actually do inside it |
| [OpenPost](https://openpo.st/) | Helping a small business turn its work into content | Task-oriented story, a screenshot tour, varied demonstrations, free media tools and practical guides | Start with recognizable material and show the next action, rather than listing internal architecture |

These are interpretations of their messaging, not evidence of market conversion.
Browser inspection confirmed their visual presentations; no source assets or text
were copied into Postbot. Free tools, comparison pages and provider pages are
acquisition entry points; their traffic or conversion performance was not measured.

## Agents are already a category expectation

Postiz's [agent hub](https://postiz.com/agent) presents connection paths, client
specific guides, authentication and example actions. Mixpost's [MCP page](https://mixpost.app/mcp)
shows a connection sequence and a conversational adaptation/scheduling example.
OpenPost's [assistant documentation](https://openpo.st/docs/mcp) separates MCP,
skills and CLI according to what the assistant can execute.

Inference: mentioning agents or self-hosting alone is not a defensible exclusive
position. Postbot can make its workflow easier to understand: an agent prepares,
a person reviews the result, destination content is adapted, and publication is
an explicit action. This is a candidate emphasis, not a claim that others lack
review, permissions or revisions. Postbot currently has CLI/API surfaces, not a
shipped MCP server. Do not use competing client logos as evidence of integrations
we have not exercised.

## Documentation turns interest into first success

[Mixpost's product guide](https://docs.mixpost.app/using/) explains the relationships
between workspaces, versions, states and queue slots before discussing automation.
[OpenPost's automation index](https://openpo.st/docs/automate) offers different entry
paths and directs readers toward an unpublished draft before unattended actions.
Both demonstrate how technical concepts can support a task rather than lead it.

[OpenPost's platform index](https://openpo.st/platforms) and
[LinkedIn page](https://openpo.st/platforms/linkedin) distinguish an advertised
integration from live availability and account requirements. At review time those
pages explicitly said final live checks were still pending. Therefore a logo list
or feature screenshot cannot establish reliable provider coverage. Apply the same
standard to our own claims, without turning the hero into a technical disclaimer.

## Findings in Postbot

- Our public narrative now has concrete X/LinkedIn adaptations and actual interface
  scenes. Keep that foundation; do not replace it with an undifferentiated feature
  grid or another full aesthetic restart.
- `apps/docs/content/docs/first-publication.mdx` starts with a manual channel. This
  is useful for a credential-free trial, but does not fulfil the common expectation
  of connecting a real social account. Offer it as an alternative path, not the
  only first-success journey.
- `apps/docs/content/docs/automation.mdx` describes permissions and help discovery,
  but lacks an executable end-to-end draft journey. That is a documentation gap,
  not a reason to invent a built-in AI writer.
- `apps/docs/content/docs/providers.mdx` is broad and defers setup detail to source
  docs. It incorrectly denied ordinary local Bluesky OAuth despite the implemented
  loopback mode. Corrected that factual inconsistency during this pass against
  `.autonomos/archive/root-documentation-2026-10-25/source/docs/deployment/provider-requirements.md`.
- The studio has source/destination editing, queue, calendar, media and project
  access. These should form a coherent product tour, rather than marketing only
  the installation and CLI. This review did not audit all interaction details or
  establish absent features merely because a homepage omits them.

## Recommended order

| Priority | Deliverable | Completion evidence |
| --- | --- | --- |
| Next | First-success documentation: real provider setup plus an agent-created draft visible in the studio | Copyable, verified CLI/API sequence; draft preserved; no implicit publication; prerequisites explicit |
| Then | Homepage content pass, section by section | Every section has one useful proposition, one concrete proof and a relevant next link; owner reviews actual wording |
| Then | Studio task review: connect, adapt, schedule and inspect results | One complete representative journey; actionable connection failures and outcome states, not a whole-app polish audit |
| Later | Evaluate reusable destination groups, publishing slots, content templates and richer media organisation | Confirm a repeated user task and inspect existing behaviour before opening an implementation task |
| Separate product decision | MCP, additional major networks and richer analytics | Prioritize against the intended first users; these are capabilities, not decorative marketing changes |

A dedicated image/video editor, workflow builder, inbox or growth-automation suite
would be a large expansion. Do not add these simply to match competitor feature
lists. Similarly, no fabricated users, testimonials, performance gains or public
release claims. Keep free-tool SEO and mass client/provider landing pages deferred
until the core adoption paths work and the project is actually public.

## Proposed message to test, not adopted copy

Show a recognizable task: prepare a week's worth of content from material the user
already has, let their agent prepare drafts, review destination adaptations in the
studio, then choose delivery times. Focus on fewer handoffs between existing tools
and on knowing what will be published. Do not promise universal autopilot, privacy
from the user's chosen external AI service, zero provider costs or effortless
provider registration.

No homepage messaging or studio behaviour changed as a result of this research.
The sole immediate content correction is the verified Bluesky deployment statement.
