# Runtime and distribution status

This review separates the deployed application from build and development tools.
It records the current packaging path and remaining release work; it is not a
claim that a public distribution is ready.

## Runtime boundaries

| Scope                                              | Current execution                           |
| -------------------------------------------------- | ------------------------------------------- |
| Production API, scheduler, worker, dashboard files | One Bun process, bundled Elysia server      |
| Database and object storage                        | Bun SQLite and Bun-backed local/S3 adapters |
| Web compilation and development server             | Vite explicitly launched with Bun           |
| Browser tests and other developer CLIs             | Tool-dependent; some use Node               |

Imports from `node:*` are compatibility APIs available in Bun, not evidence of a
separate Node process. The Bun base image also supplies a command named `node`
that delegates to Bun. The production image entrypoint is `bun /app/herald.js`.
Vite and workspace dependencies remain in the build stage; the final stage copies
only the server bundle, migrations and static dashboard into the Bun slim image.

The web commands use `bun run --bun vite --configLoader native`. Bun normally
honors an executable's Node shebang unless explicitly overridden. Vite's native
loader uses the runtime's TypeScript support. This avoids the reproduced
`vite-module-runner:import-meta-resolve` configuration-loading failure with
Vite 8.3.1 and Bun 1.4.2. Keep the Vite/router/localization/Tailwind plugin stack;
replacing it with another bundler is not justified by this finding.

References: [Bun CLI execution](https://bun.sh/docs/runtime),
[Vite configuration loading](https://vite.dev/config/).

## Existing packaging and checks

The root README documents `docker build`, a persistent `/data` volume, required
configuration, same-origin dashboard serving, health/readiness checks and backup
recovery. `Dockerfile` is a multi-stage build. The repository has a CI container
recovery step and a local `bun run test:container:recovery` command.

The recovery check uses a fresh image and isolated temporary data. It checks the
production executable, readiness, dashboard assets, database/media backup and
restored startup. It also checks graceful shutdown and forced-termination visibility. It does not
prove real publisher delivery, multi-architecture support or an upgrade from a
previously released image.

The October 4 review reproduced and corrected a web build failure in the Bun
container. Browser loading, web compilation and module hot updates also passed
under Bun. Container shutdown needed a separate correction (OPS-300): after
serving dashboard files, the `@elysia/static` asset cache owns a TTL sweep
interval that is never cleared, so the process could not exit on its own and
Docker SIGKILLed it after the stop grace period (exit 137). The server now
drains the worker and maintenance runtimes, closes the listener and SQLite,
releases the runtime lock, then exits explicitly: an orderly `docker stop`
reports exit 0 with the lock released, while a forced `docker kill` still
reports exit 137, retains the lock, and blocks a fresh server until an operator
verifies the stale marker. A drain failure exits 1 and an incomplete final
cleanup — including a retained lock marker, which `release()` reports instead
of implying success — exits 2. The production acceptance check verifies both
signatures; successful startup and recovery alone are not presented as proof of
an orderly stop. Track any remaining release work in OPS-300 follow-ups.

## Recommended release sequence

1. Verify graceful container stop, bounded drain and runtime lock release. Make
   forced termination visible in the production acceptance test (OPS-300).
2. Provide a dedicated self-hosting guide and production Compose example, with
   first setup, persistent data, secrets, optional SMTP, provider connectivity,
   backup/restore, updates and rollback limitations (DOCS-301).
3. Choose the project license with the owner and review dependency/asset notices
   before claiming open-source distribution terms (PROJECT-302).
4. Establish tagged versions, changelog and a published image policy, including
   supported architectures and upgrade acceptance checks (RELEASE-303).
5. Consolidate user and contributor documentation around verified capabilities,
   then scope a small project site linking to installation and limitations
   (DOCS-304).

A README, contributor guide and several deployment/security documents already
exist. The first-user journey is now consolidated in DOCS-301. The original review predated the accepted AGPL-3.0-only license and the production
Compose example. See the root LICENSE and [installation guide](self-hosting.md)
for their current state. An image-publication workflow remains future work;
external publication is still an owner decision.
