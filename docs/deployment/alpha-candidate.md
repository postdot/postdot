# First alpha candidate

Status: preparation only. Version `0.1.0-alpha.1` is reserved by the accepted
release policy; no versioned image has been published.

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
Remaining notice-provenance and distribution review is tracked by PROJECT-302;
these preparation notes do not assert that it is complete.

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
