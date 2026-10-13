# Postbot public positioning — proposal

Status: proposed; review with the owner before publishing website or launch copy.
This document describes the implemented product direction, not a feature promise.

## Proposed introduction

**Prepare once. Publish on your terms.**

Postbot is an open-source, self-hosted publishing workspace. Prepare one source
post, adapt it for each destination, and follow scheduled and manual publications
from the same place.

## Audience and value

For independent maintainers and small teams who publish across several channels
and want to control their content, credentials and infrastructure.

The distinguishing story is the shared source and independent destinations:
unsupported or manual channels are first-class alongside connected publishers.
Automation is optional, and uncertain delivery is visible rather than silently
retried. A dashboard and machine-facing API/CLI serve the same project workflows.

## Four demonstration paths

1. Compose one post and adapt it for several destinations.
2. Schedule a connected destination while tracking a manual destination.
3. Inspect an outcome, handle a failure or resolve an uncertain result.
4. Run Postbot on your own infrastructure with local or S3-compatible media storage.

Use isolated demonstration data and accurately identify manual versus automated
behavior. Do not expose personal accounts, real tokens or private project content.

## Claims we can support

- AGPL-3.0-only for original Postbot code, with third-party licenses retained.
- One Bun server process with SQLite; the production dashboard is served by that
  process, without a separate Vite server.
- Shared source editing and explicit per-destination adaptations.
- Scheduling, approval, manual follow-up, recovery and an inspectable history.
- Media library, bounded image previews and optional video posters; publication
  uses the originals, without automatic video conversion.
- Project permissions, scoped API keys and a supported CLI.

## Claims to avoid

Do not promise every social platform, identical features across providers,
error-free or exactly-once delivery, an available hosted service, a supported MCP
server, production acceptance on every architecture, or an existing public image
registry. Self-hosting also requires the operator to configure provider applications
where applicable and own infrastructure, backups and upgrades.

## Launch sequence

Agree on this positioning, resolve licensing and asset provenance, deliver the
first-installation journey, then establish versioned images and their supported
architectures. Build the site around installation, the four workflows and explicit
limits. Keep marketing copy short; detailed operator instructions belong in docs.
No repository visibility change or external publication is authorized by this draft.
