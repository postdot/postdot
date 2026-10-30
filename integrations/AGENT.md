# Public integrations

- This private npm workspace owns public npm packages and their release tooling. Keep it outside the root Bun workspaces and the Postdot server dependency graph. Use Node.js 24 and run npm commands from `integrations/`; the shared `package-lock.json` belongs here.
- Public package READMEs address installation and use by integration users. Keep repository architecture, build instructions, lint exceptions, release credentials and maintainer procedures in this file or the package's `AGENT.md`.
- Changesets formatting is disabled in its own config so generated changelogs do not load the ancestor Bun repository formatter or its unavailable dependencies in release CI. Package code checks still use the official n8n toolchain.
- Add a changeset with `npm run changeset` for package changes. `integrations/.changeset` owns versioning independently of Postdot application releases. Keep prerelease mode on `alpha` until the owner approves a stable release.
- `.github/workflows/npm-publish.yml` runs Changesets on main: it creates or updates the version pull request, then publishes the reviewed version after merge. The workflow builds and checks n8n and the CLI before packing and publishing reviewed archives. Do not publish from a developer machine. Routine releases use OIDC only.
- npm must trust owner `postdot`, repository `postdot`, workflow `npm-publish.yml`, with no environment. Configure this once in the package's npm Settings / Trusted Publisher section using interactive npm account authentication. GitHub grants `id-token: write`; npm exchanges that identity for publishing authorization and records provenance. Do not claim OIDC publication has passed until an actual CI release succeeds.
- Changesets creates package-qualified release tags. Keep npm-package GitHub release creation disabled so these releases do not replace the application's latest GitHub release.

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

## CLI packaging and initial publication

- `cli/package.json` is the canonical public CLI manifest. Source and Bun-only dependencies remain in the private `packages/cli` workspace; the shared npm workspace must not resolve `workspace:` dependencies. Build from the frozen root Bun lockfile, then run `npm run prepare:cli` here.
- `npm run pack:release` uses pinned Changesets 3 publish-plan/pack commands. It normalizes the plan's tags to the public manifests' `latest` tag. Every published version is an alpha prerelease by policy, so `latest` always names the newest alpha and no manual `npm dist-tag` step is needed; versions stay `-alpha.N` through Changesets prerelease mode. `release-files.mjs` verifies the plan, archive identity and integrity before any upload. Keep these experimental plan-format assumptions covered by the focused release checks.
- Initial creation uses the same workflow's explicit `bootstrap-cli` dispatch with a temporary stage-only `CLI_NPM_STAGE_TOKEN`. Apply the candidate Changesets version first. The bootstrap refuses an existing package and stages only its verified CLI archive. npm account approval with 2FA and CLI Trusted Publisher configuration remain interactive owner actions. Remove the temporary GitHub secret after staging; it is never a routine-release fallback.
- Until the CLI has an approved public version, routine releases omit it while allowing n8n publication. Both packages retain independent versions in the same Changesets inventory. Configure the same trusted workflow separately for each package. Do not run manual `npm dist-tag` commands for routine releases.
- Run `POSTDOT_CLI_NODE=/path/to/supported/node bun test integrations/tests/release.test.ts` from the repository root for identity, archive and independent-version checks. `bun run scripts/qualify-public-cli.ts` verifies an installed tarball against an isolated real API under Bun and Node.
