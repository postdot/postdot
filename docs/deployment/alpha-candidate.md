# First alpha candidate

Status: image `0.1.0-alpha.1` published on 2026-10-24; GHCR visibility is private.
Anonymous installation is not available until the owner changes package visibility
to public and anonymous manifest access is verified.

## Proposed release notes

Postdot is self-hosted social publishing for people and their agents. This first
alpha provides Studio, the HTTP API and the existing CLI, with project-owned
channels, manual destinations, media, scheduling, approvals and a durable
publication ledger. Provider-native formats, performance reading and comments
have different coverage; consult the capability matrix rather than assuming
identical support across destinations. MCP and a mobile client are not shipped.

This is early software. Configuration, data contracts and migrations may change.
There is no previous released image, so no upgrade from a prior release has been
validated. Installation currently builds from source. Back up database/media and
preserve deployment keys separately before replacing an installation.

Target platforms are native-accepted Linux AMD64 and ARM64. The selected source,
platform image identities and final registry manifest digest must be recorded
from successful workflow outputs before publishing installation claims.

The image includes Postdot's AGPL-3.0-only notice, retained third-party notices,
the exact decoder source/build configuration and base package inventory.
The owner accepted final distribution on 2026-10-24 under PROJECT-302, including
the explicitly documented version-provenance limitations. This is bounded
notice/source preservation, not an exhaustive license audit or legal certification.

## Candidate acceptance

Use the read-only Container candidate workflow against the exact selected full
commit SHA. It verifies both native architectures, packaged distribution material,
startup/shutdown, persistent authenticated use and backup/held restoration.
The source integration CI is a separate requirement. Neither workflow publishes
an image. Registry publication still uses the separately authorized manual release
workflow with the accepted tag, source SHA and actual release notes.

- [Release policy](release-policy.md)
- [Installation from source](self-hosting.md)
- [Provider capability matrix](../project/provider-capabilities.md)
- [Notice evidence and decoder source](../licenses/README.md)

## Selected native candidate

Source: `99badfb431b95a817c645e716267815925c1f6cc`.
[Native acceptance](https://github.com/postdot/postdot/actions/runs/40110422239)
passed both platforms, including distribution-material verification and the
complete production recovery scenario.
[Source integration CI](https://github.com/postdot/postdot/actions/runs/40110416940)
also passed, including static checks/build, production backup/restoration and all
four browser-test shards.

| Platform | Accepted local image ID |
| --- | --- |
| linux/amd64 | `sha256:b78ba4a1d9d325bc0d961aed22744eaadff25918ae47864e0c0340575f7d2ecb` |
| linux/arm64 | `sha256:ff99bb702deff99f744adfa983dd710c1e62aabb18d31ef634c21f2443b5286b` |

These are local candidate image identities from hosted runners, not registry
manifest digests or downloadable images. Publication rebuilds the selected source
through the release workflow after its separate source CI and release review.

## Registry publication

[Publication workflow](https://github.com/postdot/postdot/actions/runs/40126611747)
succeeded after fresh native acceptance on both architectures.

- Image: `ghcr.io/postdot/postdot:0.1.0-alpha.1`
- Manifest digest: `sha256:690778f5d1af8f4a363406b989e17da8672fc764c6e62f9cca8e1a09c483638e`
- Platforms: `linux/amd64`, `linux/arm64`, verified in the published manifest.
- Visibility: private, as reported by GitHub after publication.
- Anonymous access: not verified; the workflow correctly skipped it while private.
- No `latest` tag was created.

The organization owner must change the package visibility to public in
[package settings](https://github.com/orgs/postdot/packages/container/postdot/settings),
then verify anonymous manifest access before public image installation is advertised.
Do not republish or replace the immutable version to change visibility.
