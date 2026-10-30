# Public CLI

- Bun is the primary runtime and build tool. Standalone executables embed Bun; keep Node compatibility in the JavaScript artifact when supported by the same source. Experimental AOT and runtime trimming are not release prerequisites.
- Derive business API contracts through the existing `@postdot/client` Eden Treaty factory. Do not duplicate endpoint DTOs or import server runtime modules.
- Commander owns grammar and help only. Workflow handlers, configuration, output and interactive prompts have separate responsibilities.
- Keep npm artifacts self-contained with no workspace runtime dependencies. Verify the installed tarball outside the checkout and qualify standalone binaries separately. A cross-compiled artifact is not evidence that it runs on that platform.
- The legacy root script remains supported until its workflows have been deliberately migrated. Do not publish an incomplete command inventory as a finished CLI.
