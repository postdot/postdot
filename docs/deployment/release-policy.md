# Release policy

Status: accepted by the owner on 2026-10-11. Related task: RELEASE-303.
This document does not authorize publication or change the current source-build
installation. The repository and image visibility remain unchanged.

## Recommended first distribution

- Registry: GitHub Container Registry, `ghcr.io/saoudi-h/postbot`.
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
external publication. Owner authorization of public opening and first publication
remains a separate final step. Preserve the current local Compose path meanwhile.

## Accepted scope and remaining evidence

The owner accepted GHCR, the alpha version and two target architectures. A Docker
Hub mirror is deferred until it serves a demonstrated distribution need.
If ARM validation cannot be completed,
report the obstacle and choose explicitly between postponing publication and
launching with AMD64 only; do not silently reduce the advertised platforms.

## References

- [GitHub Container Registry](https://docs.github.com/en/packages/working-with-a-github-packages-registry/working-with-the-container-registry)
- [Package visibility](https://docs.github.com/en/packages/learn-github-packages/configuring-a-packages-access-control-and-visibility)
- [Docker multi-platform builds](https://docs.docker.com/build/building/multi-platform/)

## Candidate workflow

`.github/workflows/container-candidate.yml` is manual (`workflow_dispatch`) and
has read-only repository permissions. Select the intended branch or tag when
starting it. Both native jobs build from that selected commit, check the packaged
H.264 decoder and Bun image generation, and run production recovery acceptance
against the exact local image. The job summary records the source and local image
ID; this ID is not a registry manifest digest. No login or push step exists.

GitHub runner execution has not yet been performed from this private checkout.
Local AMD64 evidence does not establish ARM64 support. The workflow is a candidate
check, not a substitute for the integration gate before the eventual release.
Images are not exported as large Actions artifacts in this preparation step.
Publication and multi-platform manifest assembly remain separate work.

For local checks against an already-built image:

```bash
POSTBOT_CONTAINER_TEST_IMAGE=postbot:local bun run test:container:recovery
```

The supplied image must exist locally. The harness creates isolated disposable
containers and directories but retains that image. Without this variable, the
existing command still builds and removes its own uniquely tagged image.

The focused scenario runs only the container startup-termination check against
the supplied image:

```bash
POSTBOT_CONTAINER_TEST_IMAGE=postbot:local POSTBOT_CONTAINER_TEST_SCENARIO=startup-termination bun run test:container:recovery
```

It exists to exercise the stop of a container whose entrypoint is PID 1
without the packaged poster decoder, the backup and restore scenario and the
forced-stop probe. The default scenario, `full`, and an unset variable keep
the whole acceptance scenario.
