# Use Postdot with an agent

The first skills support Postdot `0.1.0-alpha.1`. They teach deployment, ordinary
product use and troubleshooting; they do not require a Postdot MCP server.
The application remains alpha software and each action uses the actual rights
available to the user and their agent.

## Install the skills

For an agent supporting the skills CLI:

```sh
npx skills add postdot/postdot --skill postdot-self-host --skill postdot --skill postdot-troubleshoot
```

Choose the intended agent and project/global installation when prompted. For
manual installation, copy the desired complete directories from `skills/` into
your agent's supported skills directory. Keep each SKILL.md together with its
references, assets and scripts. Installing only SKILL.md loses required files.
The skills do not depend on the repository's developer `.agents/skills` collection.

- `postdot-self-host` prepares and verifies an installation, including persistence
  and backup instructions. Its optional configuration helper needs Python 3.
- `postdot` prepares content, requests review and performs authorized scheduling
  through the instance API. Its JSON helper needs Python 3 and a scoped API key.
- `postdot-troubleshoot` investigates failures and writes sanitized local feedback.

The helpers use the Python standard library. They install no packages, start no
background agents and require no third-party telemetry. Configure credentials
through the agent's private mechanism; do not paste them into a conversation.
A suitably authorized Studio session is still required for initial identity,
API-key creation and built-in provider OAuth.

## Hand off a first alpha deployment

Give the deployment agent the relevant host access through its supported private
mechanism, then adapt this prompt:

```text
Use postdot-self-host to deploy Postdot alpha 0.1.0-alpha.1 for my personal use.
Use the verified published image, not a development build.

Target host: [host or existing infrastructure workspace]
Deployment directory: [dedicated path]
Public origin: [HTTPS origin]
Reverse proxy: [existing proxy or choice to resolve]
Backup destination: [independent protected storage or choice to resolve]

Inspect the existing environment before changing it. Complete deployment and
verify readiness, administrator access, a project/manual channel, an unscheduled
draft and persistence. Help me complete identity and provider sign-in where a
human session is required. Do not send real posts as an installation test.

I am using this early alpha to find product problems. Keep a private local
feedback report of failures, confusing steps and workarounds as you encounter
them. Use postdot-troubleshoot where useful. Separate observations from suspected
causes and record version/digest and timestamps. Report problems even when you
find a workaround. Do not permanently enable verbose logs or expose secrets.

Give me the resulting origin, image digest, data/backup locations, completed
checks, untested integrations and remaining actions. Keep feedback local;
publication of an issue or logs is a separate request.
```

The deployment skill adapts to the chosen host; it does not prescribe moving an
existing infrastructure project to another provider. After setup, start with a
draft-only API key or give the agent a dispatch-capable key only for the workflows
you actually authorize. Key capabilities constrain access; they are not a request
to publish anything.

## Maintain compatibility

Skills are versioned in their frontmatter independently of the application.
The first version supports the exact released alpha recorded in each skill.
For another application release, check its API/operational contract before
assuming compatibility. The self-host Compose assets mirror the root templates;
when either changes, update and validate the bundled assets in the same change.

The public source comparison is in [research](research/agent-skills-comparison.md).
[Evaluation evidence](research/agent-skills-evaluation.md) distinguishes executed
checks from scenarios still requiring a human or another agent harness.
