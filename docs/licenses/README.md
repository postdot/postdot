<!-- cspell:ignore Wischofsky -->

# Distribution notice snapshot

Snapshot date: 2026-10-11. These files preserve upstream license texts and
notices without changing their terms. The root LICENSE covers original Herald
material. No public release is authorized by this directory.

## Collected files

- `JavaScript-dependencies.LICENSE`: full shipped notice files from 345 of 357
  installed production dependency packages (distinct name/version pairs).
  Collection starts at every workspace's `dependencies`, walks installed
  `dependencies` and `optionalDependencies` using the declaring package's actual
  resolution location, and excludes peer-only and development-only edges.
  This conservative closure includes code that bundlers may remove; it is not
  proof that every listed package occurs in the release executable.
- `Recursive.LICENSE`: the font's OFL text and upstream copyright, copied from
  `@fontsource-variable/recursive@5.3.0`.
- `shadcn.LICENSE`, `Bluesky-symbols.LICENSE`, `Material-symbols.LICENSE`: exact
  copies of the notices beside the adapted toast and preview assets.
- `MP4Box.LICENSE`: the previously retained MP4Box BSD notice.
- `Flag-icons.LICENSE`: full MIT notice linked by `@iconify-icons/flag@2.0.0`,
  retrieved from <https://raw.githubusercontent.com/lipis/flag-icons/main/LICENSE>.
- `Provider-logos.LICENSE`: full CC0 text linked by `@iconify-icons/logos@2.0.2`,
  retrieved from <https://raw.githubusercontent.com/gilbarbara/logos/master/LICENSE.txt>.
- `CC0.LICENSE`: full CC0 text for the selected DiceBear artwork, retrieved from
  <https://creativecommons.org/publicdomain/zero/1.0/legalcode.txt>.
  Lorelei is by Lisa Wischofsky, source
  <https://www.figma.com/community/file/1198749693280469639>; Shapes is by DiceBear,
  source <https://www.dicebear.com>. Installed definition metadata establishes
  these two styles as CC0; other catalog styles retain their own terms.

The Dockerfile copies this directory to `/app/licenses`, alongside FFmpeg's
notice from its build stage. The web build already ships the emoji dataset
license with its files. Notices for branded symbols do not grant trademark rights.

- `CC-BY-4.0.LICENSE` and `Empty-state-illustrations.md`: full legal text and
  attribution for the empty-state SVG pack by ravi kumar. The Figma resource
  page independently confirmed the owner-supplied license and creator.

## Missing shipped texts

These packages declare licenses in metadata but ship no top-level license or
notice file. Obtain the applicable upstream version's text and copyright before
public distribution if the package is included. Metadata is not a substitute.

| Package                              | Version | Declared license |
| ------------------------------------ | ------- | ---------------- |
| `@better-auth/utils`                 | 0.4.2   | MIT              |
| `@better-auth/utils`                 | 0.5.0   | MIT              |
| `@uppy/components`                   | 2.0.0   | MIT              |
| `@wrksz/themes`                      | 2.0.2   | MIT              |
| `drizzle-orm`                        | 0.45.3  | Apache-2.0       |
| `drizzle-typebox`                    | 0.3.3   | Apache-2.0       |
| `mdast-util-inline-spoiler`          | 2.1.0   | MIT              |
| `micromark-extension-inline-spoiler` | 2.1.0   | MIT              |
| `mime-match`                         | 1.0.2   | ISC              |
| `react-remove-scroll-bar`            | 2.3.8   | MIT              |
| `remark-inline-spoiler`              | 2.1.0   | MIT              |
| `wildcard`                           | 1.1.2   | MIT              |

## Refresh before a release

Recollect from a clean frozen-lockfile installation for the release commit,
preserving separate versions and all upstream notice files. Review missing texts,
asset provenance, and actual build inputs; do not resolve an absent text by
inserting a generic license with invented copyright. This is a dated preparation
snapshot, not an automatically maintained compliance system. Bun/base-image
components and FFmpeg source-distribution obligations require separate review.

## Copied-file integrity

SHA-256 values for the retained standalone texts:

- `Bluesky-symbols.LICENSE`: `67d4cc159fec22b2c88998ed6dac344d8e1d20f55aff903686745b0c7df1e5c0`
- `CC0.LICENSE`: `a2010f343487d3f7618affe54f789f5487602331c0a8d03f49e9a7c547cf0499`
- `Flag-icons.LICENSE`: `8f1195d55a2fd315a07d812328470ca9ba2abb78c8d317ff19619d5125e00cea`
- `JavaScript-dependencies.LICENSE`: `10772bde90be4d671011a4fa2c407049d95a2db554ef1efe0a4d914fa220df45`
- `MP4Box.LICENSE`: `ebad0332150a08f37389158289d93ab2f70b0ee8717d1db9b3d002febc6c5047`
- `Material-symbols.LICENSE`: `cfc7749b96f63bd31c3c42b5c471bf756814053e847c10f3eb003417bc523d30`
- `Provider-logos.LICENSE`: `36ffd9dc085d529a7e60e1276d73ae5a030b020313e6c5408593a6ae2af39673`
- `Recursive.LICENSE`: `b4160a38a0fb152c167fada709bd6757a5785cfa4670c3106d386d5558626ce3`
- `shadcn.LICENSE`: `fbdad8aa044b43ce787fbee20a866b0dd9643956a51e3df37d34c41b0c6ef7e7`

- `CC-BY-4.0.LICENSE`: `9ba9550ad48438d0836ddab3da480b3b69ffa0aac7b7878b5a0039e7ab429411`
