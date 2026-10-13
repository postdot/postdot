<!-- cspell:ignore Wischofsky Bereket Engida -->

# Distribution notice snapshot

Snapshot date: 2026-10-11. These files preserve upstream license texts and
notices without changing their terms. The root LICENSE covers original Postbot
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

## Recovered upstream texts

The original 12 packages shipped no top-level license file. Nine now have full
texts recovered from their version's source repository. These are supplementary
to the original 345-package installed-file snapshot, giving 354 of 357 package
versions full texts with version-linked evidence.

| Package / version                                                                                            | Retained text             | Evidence                                                                                                           |
| ------------------------------------------------------------------------------------------------------------ | ------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `@uppy/components@2.0.0`                                                                                     | `Uppy-components.LICENSE` | npm publication commit `3582173228dc2fa797e01df58a39def1a91708d4`                                                  |
| `@wrksz/themes@2.0.2`                                                                                        | `Themes.LICENSE`          | npm publication commit `233310f99ca22c72937f647eb216165d26e43184`                                                  |
| `drizzle-orm@0.45.3`, `drizzle-typebox@0.3.3`                                                                | `Drizzle.LICENSE`         | release tag `0.45.3`, commit `15454dbe49d827c6081f3d0231e2e7985e517295`; sibling manifest confirms TypeBox version |
| `mdast-util-inline-spoiler@2.1.0`, `micromark-extension-inline-spoiler@2.1.0`, `remark-inline-spoiler@2.1.0` | `Inline-spoiler.LICENSE`  | commit `fdb18a6287a7999d20c9be32ce04f91941dd9b50`; all three source manifests match                                |
| `mime-match@1.0.2`                                                                                           | `Mime-match.LICENSE`      | complete ISC section from README at npm publication commit `6299160272c42c3d26e56ddc444567cb985908f2`              |
| `wildcard@1.1.2`                                                                                             | `Wildcard.LICENSE`        | complete MIT section from README at npm publication commit `d844aaa3ac09f35c79036178040c85b97ce74c54`              |

The upstream sources are pinned:

- `Uppy-components.LICENSE`: <https://raw.githubusercontent.com/transloadit/uppy/3582173228dc2fa797e01df58a39def1a91708d4/LICENSE>
- `Themes.LICENSE`: <https://raw.githubusercontent.com/jakubwarkusz/themes/233310f99ca22c72937f647eb216165d26e43184/LICENSE>
- `Drizzle.LICENSE`: <https://raw.githubusercontent.com/drizzle-team/drizzle-orm/15454dbe49d827c6081f3d0231e2e7985e517295/LICENSE>
- `Inline-spoiler.LICENSE`: <https://raw.githubusercontent.com/hlysine/remark-inline-spoiler/fdb18a6287a7999d20c9be32ce04f91941dd9b50/LICENSE>
- `Mime-match.LICENSE`: <https://raw.githubusercontent.com/DamonOehlman/mime-match/6299160272c42c3d26e56ddc444567cb985908f2/README.md>
- `Wildcard.LICENSE`: <https://raw.githubusercontent.com/DamonOehlman/wildcard/d844aaa3ac09f35c79036178040c85b97ce74c54/README.md>

## Remaining evidence gaps

- `@better-auth/utils@0.4.2` and `@better-auth/utils@0.5.0`: the release sources
  and npm manifests declare MIT and identify author Bereket Engida, but contain
  no complete license text or project copyright notice. Release README files
  state only `MIT`. This is missing notice evidence, not a claim that the
  package is unlicensed or prohibited. Do not invent a copyright year or insert
  another project's notice as though it were supplied for this package.
  Sources: <https://github.com/better-auth/utils/tree/b20329a32d78f1f9bcc088bbd6f982b28c4192f1>
  and <https://github.com/better-auth/utils/tree/f03c1c76aff7bfa3f4de4af47b112315c770a0d1>.
- `react-remove-scroll-bar@2.3.8`: MIT declared. The npm publication commit
  `b3b1287aad81def2e2ae707274b74531b61ddbaf` is unavailable in the declared
  upstream repository. A full MIT notice exists in the current repository,
  but the inspected package history reaches version 2.3.7, not 2.3.8. A current
  notice alone is not presented as version-matched evidence. Verify release
  provenance before closing this gap.

These three gaps remain bounded release checks; no upstream contact or
replacement dependency has been initiated. Metadata is not a substitute for
version-specific notice evidence.

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

- `Uppy-components.LICENSE`: `a0bceade78956c1954caa8dc9a8a665e78792ce94021baa15af72ffd6072b793`

- `Themes.LICENSE`: `0576a0d0923e9d522619b04706ef80c124df6d4986c1defc6dd476d4a208300e`

- `Drizzle.LICENSE`: `c71d239df91726fc519c6eb72d318ec65820627232b2f796219e87dcf35d0ab4`

- `Inline-spoiler.LICENSE`: `91b4e39053f42a5527b261482df85d8319922ab80184631b4992b8ff91add8e7`

- `Mime-match.LICENSE`: `246e1db8cdfb6f229c577d46b340606b0f8933530ea105a3db0599a825215fe3`

- `Wildcard.LICENSE`: `984dad806fc9843be655fdef946a57198a48f8c79fe48a7ddb5064194fad1291`
