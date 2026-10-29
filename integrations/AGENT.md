# Public integrations

- This private npm workspace owns public integration packages and their release tooling. Keep it outside the root Bun workspaces and the Postdot server dependency graph. Use Node.js 24 and run npm commands from `integrations/`; the shared `package-lock.json` belongs here.
- Public package READMEs address installation and use by integration users. Keep repository architecture, build instructions, lint exceptions, release credentials and maintainer procedures in this file or the package's `AGENT.md`.
- Add a changeset with `npm run changeset` for package changes. `integrations/.changeset` owns versioning independently of Postdot application releases. Keep prerelease mode on `alpha` until the owner approves a stable release.
- `.github/workflows/n8n-publish.yml` runs Changesets on main: it creates or updates the version pull request, then publishes the reviewed version after merge. The workflow builds and checks the node before publishing. Do not publish from a developer machine or add an npm token fallback.
- npm must trust owner `postdot`, repository `postdot`, workflow `n8n-publish.yml`, with no environment. Configure this once in the package's npm Settings / Trusted Publisher section using interactive npm account authentication. GitHub grants `id-token: write`; npm exchanges that identity for publishing authorization and records provenance. Do not claim OIDC publication has passed until an actual CI release succeeds.
- Changesets creates package-qualified release tags. Keep n8n GitHub release creation disabled so these releases do not replace the application's latest GitHub release.

## Development and release checks

```sh
cd integrations
npm ci --ignore-scripts
npm run typecheck
npm run lint
npm run build
npm run changeset -- status
npm pack --workspace @postdot/n8n-nodes-postdot --dry-run
```

`npm run version-packages` applies pending changesets, updates the changelog and synchronizes the npm lockfile. Inspect the version diff before merging a Changesets PR. `npm run release` is CI-only and checks the repository, main branch, workflow identity and OIDC environment before calling Changesets.
