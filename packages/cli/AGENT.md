# Public CLI source

- Bun is the primary development and build tool. The public npm JavaScript artifact runs with an installed supported Bun or Node runtime. Standalone binaries are optional and must justify their size and platform maintenance; experimental AOT and runtime trimming are not release prerequisites.
- Runtime code uses portable Node/Web APIs qualified on both Node and Bun; keep Bun-only APIs in build and test tools.
- Derive business API contracts through the existing `@postdot/client` Eden Treaty factory. Do not duplicate endpoint DTOs or import server runtime modules.
- Resolve the server, project and credential once per remote operation. Saved credentials and project defaults are bound to the profile origin; a different origin must not inherit them.
- Commander owns grammar and help only. Workflow handlers, configuration, output and interactive prompts have separate responsibilities.
- Keep npm artifacts self-contained with no workspace runtime dependencies. Verify the installed tarball outside the checkout and qualify standalone binaries separately. A cross-compiled artifact is not evidence that it runs on that platform.
- The legacy root script remains supported until its workflows have been deliberately migrated. Do not publish an incomplete command inventory as a finished CLI.

- This private Bun workspace builds `@postdot/cli-source`. The sole public package manifest, version, README and notices live in `integrations/cli`; `integrations/scripts/prepare-cli.mjs` copies the verified bundle and license there. Keep the Turbo cache inputs bound to that public manifest.
