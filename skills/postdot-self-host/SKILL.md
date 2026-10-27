---
name: postdot-self-host
description: Deploy and operate a self-hosted Postdot instance using its published container. Use for first installation, HTTPS, persistence, backup and deployment verification. For publication workflows use postdot; for investigating failures use postdot-troubleshoot.
metadata:
  version: "0.1.1"
  application-version: "0.1.0-alpha.3"
---

# Self-host Postdot

Deploy the user's chosen environment without assuming a hosting provider or
replacing their existing infrastructure. This skill includes Compose/configuration
assets; it needs no Postdot development checkout. Postdot is early alpha software.

## Establish the target

Identify the host, deployment directory, public origin, reverse proxy, persistent
storage and backup destination from available context. Ask only for missing facts
needed to proceed. Explain conflicts before changing existing services, ports,
DNS or certificates. An installation request authorizes that installation, not
unrelated infrastructure changes or real social publications.

Read [installation](references/installation.md) for prerequisites, the pinned
image, private configuration preparation, first administrator and checks. Use the
bundled preparation script only in a new dedicated deployment directory. Resolve
`SKILL_DIR` to this installed skill's directory, not the shell's working directory.

## Verify the deployment

- Keep the deployment on one application process with persistent SQLite/media on
  a local filesystem supporting SQLite locks. Do not share one database between
  multiple running instances or place it on an unverified network filesystem.
- Bind to loopback behind the selected HTTPS proxy. Set the two application
  origins to the same public HTTPS origin. A proxy container needs an explicit
  private-network arrangement; host loopback is not reachable from that container.
- Check `/health`, `/ready` and the actual authenticated Studio workflow. Readiness
  alone does not establish working OAuth, SMTP, social delivery or recovery resume.
- The first account becomes administrator. Complete that setup over a protected
  connection before exposing an unclaimed instance. Ask the user to complete
  identity/provider sign-in when the agent lacks an authorized session.
- Record the exact image digest, architecture, data location, configured origin,
  backup location and checks performed. Keep secret values out of the handoff.

For backups, restore or replacement, read
[operations](references/operations.md) before changing persisted state. Keep the
publisher encryption key separately from backups; replacing it is not rotation.

## Optional alpha feedback

When the user requests diagnostic operation, keep a short local list of observed
failures, confusing steps and workarounds, including successful checks. Use
[feedback](references/feedback.md). Do not enable verbose logging permanently,
run provider test posts, change application source or send reports to a third
party merely because this is an alpha deployment.
