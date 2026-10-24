# Third-party licenses and release checks

Original Postdot material: Copyright (c) 2026 Hakim Saoudi.

Postdot's AGPL-3.0-only declaration applies to original project material, not to
third-party components. Their licenses and copyright notices remain applicable.
This inventory is a preparation record, not a certificate of distribution compliance.

## Explicitly retained material

| Material                                | License / provenance                           | Existing notice                                                                       |
| --------------------------------------- | ---------------------------------------------- | ------------------------------------------------------------------------------------- |
| Adapted shadcn/ui toast code            | MIT                                            | `packages/ui/LICENSE.shadcn.md`                                                       |
| Bluesky preview symbols                 | MIT                                            | `apps/web/src/assets/platform-preview-icons/LICENSE.bluesky.txt`                      |
| Material preview symbols                | Apache-2.0                                     | `apps/web/src/assets/platform-preview-icons/LICENSE.material.txt`                     |
| MP4Box.js                               | BSD-3-Clause                                   | `licenses/MP4Box.LICENSE`; copied into the runtime image                         |
| FFmpeg poster executable                | LGPL-2.1-or-later in the current minimal build | Runtime `/app/licenses/FFmpeg.LICENSE`; source checksum and build flags in Dockerfile |
| Recursive variable font                 | OFL-1.1                                        | `licenses/Recursive.LICENSE`; copied into the runtime image                      |
| DiceBear Lorelei and Shapes definitions | CC0-1.0                                        | License/creator/source metadata inside the installed JSON definitions                 |

DiceBear's aggregate styles package includes other licenses. Postdot imports only
Lorelei and Shapes; do not treat the entire catalog as CC0. The installed package
code and definition licenses must be considered separately.

## Packaged notice snapshot

Full available notice texts are retained in [distribution notices](licenses/README.md)
and copied into the runtime image. The conservative production dependency closure
contains 357 installed package versions; 345 ship notice files. Nine additional
versions have full texts recovered from version-linked upstream sources. Three
remaining evidence gaps are listed there for release review. This inventory does not establish bundle
reachability or clear the remaining public-release requirements.

The portrait source was recovered from the UX-247 worklog:
<https://images.unsplash.com/photo-1568602471122-7832951cc4c5>.
It remains an illustrative stock photo, not a connected user's identity. The
[Unsplash license](https://unsplash.com/license) permits redistribution as part
of this use, subject to its restrictions; this is not a clearance of personality
or trademark rights. The photographer and original photo page remain unverified.

The 16 empty-state SVGs are selected exports from
[Empty State Illustrations](https://www.figma.com/community/file/1348310526654272437/empty-state-illustrations)
by [ravi kumar](https://www.figma.com/@ravirafa), licensed under CC BY 4.0.
Attribution and integration details are retained in
[illustration attribution](licenses/Empty-state-illustrations.md),
alongside the full license text, and copied into the runtime image.

## Direct production dependencies

The Eden entry was updated on 2026-10-23 to the Elysia v2-compatible client;
its retained upstream MIT notice is unchanged.

Snapshot: 2026-10-11, installed package metadata for non-workspace dependencies
listed in `dependencies` across the apps and packages. Development tools are not
included. This is a conservative source inventory, not the list of code actually
included in a production bundle. Package metadata alone does not replace full
license texts or a transitive dependency review.

| Package                                 | Installed version | Declared license          |
| --------------------------------------- | ----------------- | ------------------------- |
| `@atproto/api`                          | 0.22.0            | MIT                       |
| `@atproto/jwk-jose`                     | 0.2.4             | MIT                       |
| `@atproto/jwk-webcrypto`                | 0.3.4             | MIT                       |
| `@atproto/oauth-client`                 | 0.8.8             | MIT                       |
| `@atproto/oauth-types`                  | 0.7.7             | MIT                       |
| `@base-ui/react`                        | 1.8.0             | MIT                       |
| `@better-auth/api-key`                  | 1.7.7             | MIT                       |
| `@date-fns/tz`                          | 1.5.0             | MIT                       |
| `@dicebear/core`                        | 10.7.0            | MIT                       |
| `@dicebear/styles`                      | 10.6.0            | SEE LICENSE IN LICENSE.md |
| `@elysia/static`                        | 2.0.0-beta.2      | MIT                       |
| `@elysia/eden`                          | 2.0.0-beta.2      | MIT                       |
| `@elysiajs/openapi`                     | 2.0.0-exp.0       | MIT                       |
| `@fontsource-variable/recursive`        | 5.3.0             | OFL-1.1                   |
| `@iconify-icons/flag`                   | 2.0.0             | MIT                       |
| `@iconify-icons/logos`                  | 2.0.2             | CC0-1.0                   |
| `@iconify/react`                        | 6.0.2             | MIT                       |
| `@prometheus-io/client`                 | 0.16.1            | Apache-2.0                |
| `@react-email/body`                     | 0.3.0             | MIT                       |
| `@react-email/button`                   | 0.2.1             | MIT                       |
| `@react-email/container`                | 0.0.16            | MIT                       |
| `@react-email/font`                     | 0.0.10            | MIT                       |
| `@react-email/head`                     | 0.0.13            | MIT                       |
| `@react-email/heading`                  | 0.0.16            | MIT                       |
| `@react-email/html`                     | 0.0.12            | MIT                       |
| `@react-email/link`                     | 0.0.13            | MIT                       |
| `@react-email/preview`                  | 0.0.14            | MIT                       |
| `@react-email/render`                   | 2.1.0             | MIT                       |
| `@react-email/section`                  | 0.0.17            | MIT                       |
| `@react-email/text`                     | 0.1.6             | MIT                       |
| `@sinclair/typebox`                     | 0.34.52           | MIT                       |
| `@solar-icons/react`                    | 2.3.2             | MIT                       |
| `@tanstack/hotkeys`                     | 0.10.1            | MIT                       |
| `@tanstack/react-hotkeys`               | 0.12.1            | MIT                       |
| `@tanstack/react-query`                 | 5.104.0           | MIT                       |
| `@tanstack/react-router`                | 1.170.41          | MIT                       |
| `@tiptap/core`                          | 3.31.4            | MIT                       |
| `@tiptap/extension-image`               | 3.31.4            | MIT                       |
| `@tiptap/markdown`                      | 3.31.4            | MIT                       |
| `@tiptap/pm`                            | 3.31.4            | MIT                       |
| `@tiptap/react`                         | 3.31.4            | MIT                       |
| `@tiptap/starter-kit`                   | 3.31.4            | MIT                       |
| `@uppy/core`                            | 6.2.0             | MIT                       |
| `@uppy/golden-retriever`                | 6.0.0             | MIT                       |
| `@uppy/react`                           | 6.0.0             | MIT                       |
| `@wrksz/themes`                         | 2.0.2             | MIT                       |
| `better-auth`                           | 1.7.7             | MIT                       |
| `class-variance-authority`              | 0.7.1             | Apache-2.0                |
| `clsx`                                  | 2.1.1             | MIT                       |
| `cmdk`                                  | 1.1.1             | MIT                       |
| `date-fns`                              | 4.4.0             | MIT                       |
| `drizzle-orm`                           | 0.45.3            | Apache-2.0                |
| `drizzle-typebox`                       | 0.3.3             | Apache-2.0                |
| `elysia`                                | 2.0.0-exp.64      | MIT                       |
| `exact-mirror`                          | 1.2.6             | MIT                       |
| `frimousse`                             | 0.4.0             | MIT                       |
| `marked`                                | 17.0.6            | MIT                       |
| `mdast-util-gfm-strikethrough`          | 2.0.1             | MIT                       |
| `micromark-extension-gfm-strikethrough` | 2.1.0             | MIT                       |
| `motion`                                | 13.4.6            | MIT                       |
| `mp4box`                                | 2.4.1             | BSD-3-Clause              |
| `nodemailer`                            | 10.0.13           | MIT-0                     |
| `oauth4webapi`                          | 3.8.8             | MIT                       |
| `openapi-types`                         | 12.1.3            | MIT                       |
| `pino`                                  | 10.3.1            | MIT                       |
| `react`                                 | 19.3.0            | MIT                       |
| `react-day-picker`                      | 10.0.2            | MIT                       |
| `react-dom`                             | 19.3.0            | MIT                       |
| `react-easy-crop`                       | 6.2.3             | MIT                       |
| `react-full-screen`                     | 1.1.1             | MIT                       |
| `react-markdown`                        | 10.1.0            | MIT                       |
| `react-zoom-pan-pinch`                  | 4.2.0             | MIT                       |
| `remark-inline-spoiler`                 | 2.1.0             | MIT                       |
| `tailwind-merge`                        | 3.7.0             | MIT                       |
| `tw-animate-css`                        | 1.4.0             | MIT                       |
| `twitter-text`                          | 3.1.0             | Apache-2.0 (LICENSE file) |
| `typebox`                               | 1.3.34            | MIT                       |

## Before any public source or image release

- Assemble full notices for the actual bundled transitive dependencies and fonts,
  preserving upstream copyrights. Check modules with missing license files rather
  than inferring rights from a package name or registry label.
- Preserve the original licenses of adapted components and copied assets. Ensure
  source releases and images carry the appropriate license and notice files.
- Preserve the empty-state illustration attribution, source and CC BY 4.0 text
  in the release, including any later modifications. The portrait source URL is
  recovered above; non-copyright rights remain outside this inventory.
- Supply source corresponding to the released Postdot executable, including build
  scripts, and a source-access mechanism appropriate to AGPL obligations. Agree on
  the public source location before implementing links in the application.
- Preserve the FFmpeg source/build information and fulfill the separate LGPL
  distribution obligations; a current upstream download URL is not a permanent
  source-availability guarantee maintained by Postdot.
- Review the Bun base image and its system component notices separately from the
  JavaScript inventory. No all-platform or all-component clearance is claimed.

Changing a package manifest does not relicense dependencies. Nothing in this file
licenses user-uploaded content, provider brands, or unrelated third-party material.
