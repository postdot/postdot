# Postdot for n8n

Prepare a Postdot draft from a workflow, then read its saved state. The node also lists accessible projects and their channels. Project and channel fields load choices from your Postdot instance.

This package runs inside n8n and has its own npm lockfile. It is outside the Postdot application workspaces and does not add dependencies to the publishing server.

Installation and the first workflow are documented in the [n8n guide](https://postdot.app/docs/n8n/). The alpha package supports self-hosted n8n and is not verified for n8n Cloud.

As the n8n runtime user, install the exact prerelease in its persistent nodes directory, then restart n8n:

```sh
mkdir -p ~/.n8n/nodes
cd ~/.n8n/nodes
npm install --omit=dev @postdot/n8n-nodes-postdot@0.1.0-alpha.1
```

The package is released on npm's `alpha` tag. It has been exercised in n8n 2.45.6.

## Develop

Use Node.js 22.16 or later, then run from this directory:

```sh
npm ci
npm run typecheck
npm run lint
npm run build
npm pack
```

The build uses the official `@n8n/node-cli` toolchain and emits CommonJS node and credential files. The build hook copies the authored node metadata beside the compiled node. The archive includes the compiled files, the [example workflow](examples/create-draft.json) and the AGPL license.

The linter retains the upstream rules with two package-metadata exceptions: Postdot keeps AGPL-3.0-only instead of the starter's MIT default, and identifies its author by name and public URL without a personal email. Strict Cloud-verification mode is disabled; passing local lint does not establish n8n verification.

## Behavior

- **Project / Get Many** returns one item per accessible active project.
- **Channel / Get Many** returns one item per attached channel.
- **Post / Create Draft** creates one source post and one unscheduled, text-only publication per input item. The server adapts its canonical source to the channel's profile. A saved draft may still require review.
- **Publication / Get** returns the publication editor state, including its draft, selected target and recorded outcome.

Use a Postdot API key scoped to the intended project, with `project:read` and `publication:manage`. Creating a draft never supplies `scheduledAt`. The node exposes no scheduling or provider-connection operation.

Keep **Retry On Fail** off for Create Draft. A failed or lost response can leave a saved draft; inspect Postdot before repeating the write. Multiple input items produce multiple posts. The node does not add request idempotency or deduplicate items.

## Release

Publication runs from `.github/workflows/n8n-publish.yml` in GitHub Actions with provenance, on a matching `n8n-v<VERSION>` tag. The release guard rejects a different repository, version tag or visibility. Keep prereleases on `alpha`; a stable version must explicitly use `latest`.

For trusted publishing, configure the npm package to trust repository owner `postdot`, repository `postdot`, workflow `n8n-publish.yml`, with no GitHub environment name. The first publication may use the temporary repository secret `N8N_NPM_BOOTSTRAP_TOKEN`; remove it after success and use OIDC for subsequent versions. Do not publish from a local machine.
