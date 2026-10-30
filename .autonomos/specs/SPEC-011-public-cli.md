# SPEC-011 — Independently installable public CLI

<!-- cspell:words Citty -->

- Status: draft
- Scope: public remote-operation CLI, packaging and first-alpha release
- Provenance: owner delegates CLI scope and design on 2026-10-30; explicitly retains Eden Treaty as the typed API client.
- Related tasks: CLI-601 (design), CLI-602 (implementation and release)

## Product boundary

An operator installs `@postdot/cli`, obtains the `postdot` command and operates a remote Postdot instance without a source checkout, Bun, server installation or database access. Interactive operators and unattended scripts share the same commands. The first alpha covers the existing API-key-authorized publication workflow, including project/channel discovery, content contracts, media, drafts, scheduling and recovery. The first alpha leaves project/channel setup, sharing configuration, project lifecycle administration and audit in Studio or the legacy source script. It does not promise a command for every HTTP endpoint.

The existing script is a working remote client, not a server-maintenance executable. Its HTTP behavior is useful implementation input; its manual argument parser, monolithic help and cookie-printing login are not the public product contract. Inventory its commands and authorization requirements before migration. Document any deliberate difference; do not silently remove an operator workflow.

## Recommended architecture

1. `packages/cli` is a private root Bun source/build workspace. `integrations/cli` owns the canonical public manifest, version and `postdot` bin in the existing npm release workspace. Bun is the primary development and build runtime. The first public distribution is a bundled JavaScript npm package usable with an installed Bun or supported Node runtime. Keep standalone compilation available as an optional distribution path; an executable embeds Bun and needs no preinstalled JavaScript runtime, but its size and platform qualification cost must justify release support. Keep portable Node-standard APIs where they do not compromise Bun behavior. Qualify each advertised platform/runtime; cross-compilation alone is not execution evidence. Do not install a separate global Bun runtime as an npm side effect.
2. Commander declares nested commands, options, validation, help and usage errors. Handlers own user workflows and presentation; they call the existing `@postdot/client` factory. Keep configuration, credential access and output formatting separate from handlers. No generic command/plugin framework or per-endpoint command generation.
3. `packages/client` remains transport-focused. `treaty<PostdotApp>` derives requests and responses from Elysia types; do not maintain handwritten API DTOs, endpoint wrappers or a parallel OpenAPI-generated client. Type-only server imports disappear from the runtime bundle. Bundle the existing client implementation into the CLI; publishing a standalone SDK is not a prerequisite.
4. Preserve inferred Treaty response types through handlers and the shared error boundary. Review the existing generic `call<T>` casts rather than carrying unchecked result assertions into the new CLI. The server remains authoritative for content validation, authorization and lifecycle rules. Local CLI validation covers syntax, required arguments and configuration only.
5. Authentication routes mounted outside the typed application surface are a distinct boundary. Use the supported auth client's inferred contract if session-based commands are later exposed. Do not pretend Treaty already types those routes or introduce a second business API client for them.

Commander is the preferred fit because the existing operator surface needs detailed help, required/conflicting options and structured command errors. Citty offers a compact composable alternative but would require more command-policy glue here. Oclif's plugin/platform capabilities exceed the current product need. This is an engineering fit assessment, not a performance benchmark. Pin the actual chosen dependency version during implementation.

## Configuration and authentication

- Named connection profiles associate one server origin, an optional default project and a credential reference. Provide `config add`, `config use`, `config list`, `config remove`, `auth login`, `auth status` and `auth logout`; `--profile` selects a connection for one invocation.
- Effective values resolve explicitly: invocation options, `POSTDOT_*` environment, selected profile, then documented defaults. An explicit URL must never silently inherit another origin's stored credential. Bind saved credentials to the normalized server origin. Keep configuration outside the working repository in the platform's user configuration directory; support an explicit configuration directory for CI/isolation.
- First-alpha authentication uses existing scoped API keys created in Studio with project-read permission for verification and discovery. `auth login` accepts a hidden terminal input or `--token-stdin`, verifies access and stores the credential only after success. `POSTDOT_API_KEY` remains sufficient for CI with no configuration writes. Never prompt in noninteractive/JSON mode. Do not require users to put a token in shell arguments.
- Separate nonsecret configuration from the credential file. Use atomic writes, user-only permissions (0700 directory / 0600 file on POSIX), and verify the equivalent Windows access restriction before claiming persistent credential support there. Describe file storage as local, unencrypted storage. Never display secrets in status, errors, JSON or debug output. Logout removes the local credential; it does not claim to revoke the server key.
- Password/browser login, device authorization and native keychain integration are later extensions. Existing session-only account/workspace administration remains available in Studio and the legacy source script until deliberately migrated; the public alpha help must not advertise unsupported commands. Do not add OAuth or change server authentication to ship the CLI.

## Command and output contract

- Preserve established resource/action vocabulary where useful: `projects list`, `channels list`, `posts create`, `publications list/show/save/schedule/cancel/retry`, and `media ...`. Provide command-specific help with examples. `--help` and `--version` require no configuration, credentials or network.
- Explicit flags override the selected profile's defaults. Resolve project names only when unambiguous; identifiers remain accepted. No hidden selection of the first returned project.
- Human output favors concise lists, actionable errors and readable timestamps. Machine output uses one documented JSON result on stdout, with no banners, progress or ANSI escapes. Diagnostics go to stderr. Define and test the result/error shape and exit codes before release; preserve API error codes and relevant concurrency/confirmation details.
- Use `--input <file|->` for structured content. Retain bounded stdin/file handling, media uploads, cursor pagination, transport deadlines and interrupt handling. Return continuation cursors explicitly; do not silently truncate or exhaust arbitrarily large lists.
- Never automatically replay writes after transport failure. Preserve revision checks, lifecycle fingerprints, cadence confirmation and uncertain-delivery inspection. CLI convenience must not bypass server safety contracts or turn a remote rejection into a successful exit.
- Treat server compatibility as a runtime concern. The Elysia type describes the build-time API, not any arbitrary deployed server. Establish a minimum supported release per exposed command from actual release history; exercise that version and the current server. Use available release metadata for actionable diagnostics, tolerate missing metadata on older servers and do not preflight every command with a health request. Avoid a speculative new negotiation API.

## Distribution and release

Publish `@postdot/cli` on the `alpha` tag through the shared `npm-publish.yml` GitHub Actions workflow, Changesets and npm trusted publishing/OIDC. CLI and n8n versions remain independent within `integrations/.changeset`; one workflow creates their version PR and publishes prepared archives. Build CLI source from the root frozen Bun lockfile, prepare the public package under `integrations/cli`, then pack only reviewed files and licenses. No developer-machine publication or routine token fallback.

The first CLI package creation uses an explicit CI-only staged upload with a temporary stage-only credential. The owner approves the stage on npm with 2FA and configures that package's Trusted Publisher; later releases use OIDC exclusively. Keep this bootstrap separate from ordinary publication and remove its temporary GitHub secret afterward. While bootstrap is pending, n8n releases remain possible.

The package must contain no `workspace:` dependencies, server/database runtime code or source-checkout requirements. Validate the installed tarball from a directory outside the repository, including help and real remote calls. Prioritize the npm JavaScript package, with explicit installed-runtime requirements. Standalone executables are optional follow-up artifacts once demand justifies their download size, platform qualification and maintenance. Document the runtime requirements of each channel explicitly. Shell install scripts, shell completion and update notifications are deferred. Future AOT compilation and runtime-module reduction are evaluation opportunities, not release dependencies; introduce them only after measured compatibility, size and startup acceptance. npm's initial package/trust association is a release dependency to resolve using the owner's established CI-only practice, not an assumed existing permission.

## Delivery slices and acceptance

1. Prove the packaging boundary: installed Bun and compatible Node JavaScript CLI using the bundled Treaty client; retain the standalone proof as optional evidence, remote authenticated read and a media file upload. Inspect the runtime dependency graph for accidental server/database dependencies. Record supported runtime/OS evidence before migrating all commands.
2. Deliver configuration, origin-bound credentials, command tree, help, JSON/error contract and the API-key command inventory. Port existing business workflows without duplicating server contracts. Retain the source-script entry point as a thin adapter only where compatibility is real; mark unsupported legacy administrative paths explicitly.
3. Qualify a complete remote workflow from the installed package: discover project/channel contract, upload media, create and inspect a draft, schedule/cancel, handle denied access, stale revision and uncertain transport. Cover profile isolation, noninteractive input, credential permissions and the supported server-version range. Add focused checks at each boundary rather than repeating the entire Studio matrix.
4. Prepare the public README and CLI docs, release workflow, Changeset and tarball. Keep public docs accurate until the package is actually available. Publish the reviewed alpha through CI, then verify clean installation from npm. Local build success is not publication acceptance.

## Deferred scope

A separately published SDK, mandatory native binary distribution, experimental AOT optimizations, a terminal dashboard, a plugin system, automatic background updates, new server endpoints and new authentication protocols are outside this release. Session-only administration is explicitly excluded from the first API-key alpha; revisit after the publication workflows ship, using the existing authentication contract.

## Sources reviewed

- [Eden Treaty](https://elysiajs.com/eden/treaty/overview): derived API types and client model.
- [Commander](https://github.com/tj/commander.js): command/option declarations, help and output/error controls.
- [Citty](https://github.com/unjs/citty): composable command declarations and lazy loading.
- [Oclif](https://oclif.io/docs/introduction/): extensible CLI platform and plugin model.
- [Bun compiler](https://bun.com/docs/compiler): stable standalone compilation versus experimental AOT.
- [Bun AOT implementation](https://github.com/oven-sh/bun/pull/45631): merged work is not a release qualification.
- [Node.js releases](https://nodejs.org/en/about/previous-releases): runtime support policy.
- [npm trusted publishing](https://docs.npmjs.com/trusted-publishers/): CI identity and provenance.
