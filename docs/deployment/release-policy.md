# Release policy

Status: accepted by the owner on 2026-10-11. Related task: RELEASE-303.
This document does not authorize publication or change the current source-build
installation. The source repository is public. The first versioned image was published on
2026-10-24, but its GHCR package remains private; see the
[publication record](alpha-candidate.md).

## Recommended first distribution

- Registry: GitHub Container Registry, `ghcr.io/postdot/postdot`.
- First public version: `v0.1.0-alpha.1`, with image tag `0.1.0-alpha.1`.
- Target platforms: `linux/amd64` and `linux/arm64`, advertised only after each
  passes production container acceptance. A build alone is not support evidence.
- No `latest` tag during the alpha period. Installation examples pin an exact
  version; record the image digest for reproducible deployments.
- No automatic deployment or publication on pushes to `main`.

GHCR keeps source and image administration together and permits anonymous pulls
of public images. Docker Hub is a credible alternative if its discovery surface
becomes important; operating both registries is deferred. Image visibility needs
its own explicit check, independent of repository visibility.

An alpha label communicates that contracts and migrations may still change.
Choosing a version does not promise a release date or production stability.
Version tags must never be reassigned to a different source or image. Corrections
receive a new version. An optional moving `alpha` alias can be considered later;
it is not needed for the first installation path.

## Build and acceptance

Build both architectures from the same recorded source commit with the existing
Dockerfile and frozen lockfile. Prefer native builders for compilation: Docker
documents that emulation can be substantially slower. Verify the Bun base image,
native image processing and bundled poster decoder on each target rather than
assuming that JavaScript portability covers native dependencies.

The release record contains the source commit, version, image digest, supported
platforms and concise release notes. Include user-visible changes, configuration
changes, migration impact, known limits and an upgrade command using the exact
version. Keep available license notices and link the matching source revision;
do not expand this task into another transitive-license investigation.

For the final executable state, run the integration gate once and production
container acceptance for each advertised architecture. Preparation iterations
use focused checks. Do not repeat the browser matrix for release-note edits.
Container acceptance includes startup, authenticated dashboard use, persistence,
graceful stop, backup and held restoration. Extend the existing harness where
needed instead of introducing a second independent acceptance suite.

For the first release there is no previous public release to upgrade from. Record
this explicitly; do not label a same-version restart as an upgrade test. From the
second release onward, verify an isolated previous-release volume upgraded to the
candidate, preservation of representative project/media data, and restoration
of the pre-upgrade backup with the matching previous image. Do not send provider
requests in this test or claim that image rollback reverses schema migrations.

## Publication boundary

Preparing or accepting this policy does not open the repository or publish an
image. After acceptance, implement and validate the build workflow without
external publication. Public source opening was completed under PUBLIC-554. The
first image publication still requires separate owner authorization. Preserve the
current local Compose path meanwhile.

The manual release workflow requires the accepted image tag, a full source SHA
with a successful push CI run on `main`, release notes and explicit confirmation
that public visibility is approved. It checks the source, native acceptance,
tag availability and both platforms before pushing the image. It does not run
on pushes to `main`.

GitHub may create the first organization package with private visibility. After
the push, the workflow records the package's actual visibility and verifies an
anonymous pull only when GitHub reports it as public. If it remains private, an
organization owner must open **postdot > Packages > postdot > Package settings**
and choose **Change visibility > Public**, then verify an anonymous pull. GitHub
does not allow a public package to become private again. The workflow does not
change package visibility or claim public availability while it is private.

Run this after changing visibility to check anonymous access to the first image:

```bash
docker logout ghcr.io
docker buildx imagetools inspect ghcr.io/postdot/postdot:0.1.0-alpha.1 --raw
```

## Accepted scope and remaining evidence

The owner accepted GHCR, the alpha version and two target architectures. A Docker
Hub mirror is deferred until it serves a demonstrated distribution need.
If ARM validation cannot be completed,
report the obstacle and choose explicitly between postponing publication and
launching with AMD64 only; do not silently reduce the advertised platforms.

## References

- [GitHub Container Registry](https://docs.github.com/en/packages/working-with-a-github-packages-registry/working-with-the-container-registry)
- [Package visibility](https://docs.github.com/en/packages/learn-github-packages/configuring-a-packages-access-control-and-visibility)
- [GitHub Packages REST API](https://docs.github.com/en/rest/packages/packages)
- [Docker multi-platform builds](https://docs.docker.com/build/building/multi-platform/)

## Candidate workflow

`.github/workflows/container-candidate.yml` is manual (`workflow_dispatch`) and
has read-only repository permissions. Select the intended branch or tag when
starting it. The workflow also supports `workflow_call`; the release workflow
uses that entry point to accept the exact source SHA. Both native jobs build from
that selected commit, check the packaged H.264 decoder and Bun image generation,
and run production recovery acceptance against the exact local image. The build
selects its platform explicitly. Before acceptance, the job compares the
inspected image platform and revision label with the selected target and source
commit. It passes the immutable image ID to the harness and records that same
ID and platform in the job summary. This
ID is not a registry manifest digest. No login or push step exists.

[GitHub run 39684993689](https://github.com/postdot/postdot/actions/runs/39684993689)
passed full acceptance on native AMD64 and ARM64 hosted runners, both built from
`485a11bb7efca1d532575fd5e319a55f4f2c7c0b`. The jobs verified native Docker
architecture, image platform and source revision before testing each immutable
local image ID. See the [native acceptance record](../../.autonomos/worklogs/2026-10-22-RELEASE-303.md).
The earlier [local acceptance record](../../.autonomos/worklogs/2026-10-21-RELEASE-303.md)
covers native AMD64 and emulated ARM64; the hosted run now supplies native ARM64
evidence without a dedicated OCI runner.

This candidate check does not replace the final source integration gate.
Images are not exported as large Actions artifacts. Multi-platform manifest
assembly and separately authorized versioned image publication are handled by
`.github/workflows/container-release.yml`. The workflow is manual. Its first authorized
[publication run](https://github.com/postdot/postdot/actions/runs/40126611747)
succeeded for 0.1.0-alpha.1; public package visibility is still pending. It uses Buildx/QEMU to build the
final multi-platform image on AMD64 after the exact source passes native
acceptance on AMD64 and ARM64. If emulation makes the release build fail or
exceed its limit, use native build jobs and manifest assembly rather than
reducing the advertised platforms.

For local checks against an already-built image:

```bash
POSTBOT_CONTAINER_TEST_IMAGE=postbot:local bun run test:container:recovery
```

The supplied image must exist locally. The harness pins its immutable ID and
reports its inspected platform before execution. It tests the image supplied by
the caller; it does not imply that an arbitrary image matches the current
checkout. The candidate workflow performs the source-label check separately.
The harness creates isolated disposable containers and directories but retains
that image. Without this variable, the existing command still builds and
removes its own uniquely tagged image.

The full scenario checks a disposable local account, an authenticated session
and project create/read. It confirms that project survives backup and held
restoration. Runtime checks distinguish native Bun from a confirmed ARM64 Bun
application executed through QEMU; the harness does not install an emulator or
change host configuration.

The focused scenario runs only the container startup-termination check against
the supplied image:

```bash
POSTBOT_CONTAINER_TEST_IMAGE=postbot:local POSTBOT_CONTAINER_TEST_SCENARIO=startup-termination bun run test:container:recovery
```

It exists to exercise the stop of a container whose entrypoint is PID 1
without the packaged poster decoder, the backup and restore scenario and the
forced-stop probe. The default scenario, `full`, and an unset variable keep
the whole acceptance scenario.
