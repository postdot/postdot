<!-- cspell:ignore nifrajs zerotal rakun Unpic Nifra -->

# MEDIA-389 — existing image optimization options

## Verified runtime

Bun 1.4.3 is installed. A throwaway in-memory PNG to WebP transformation using
Bun.Image, inside fit and no enlargement succeeded on this Linux host; output
metadata was read back. This proves basic API availability, not production
coverage, color fidelity or platform parity. No dependency installed.

Official docs: https://bun.com/docs/runtime/image . This is a native pipeline
inspired by Sharp, not a drop-in implementation. JPEG/PNG/WebP use portable
codecs; TIFF/HEIC/AVIF support depends on platform. The default two-dimension
resize fit is fill; specify inside for preserved proportions. WebP output avoids
the AVIF platform limitation. Unsupported input remains a separate question.

## Candidates inspected

- IPX: https://github.com/unjs/ipx . MIT, embeddable library as well as standalone
  server, custom source storage. Its inspected implementation loads Sharp,
  rather than offering an injectable Bun engine. npm latest observed:
  4.0.0-beta.1. It is not an automatic Bun-first/Sharp-fallback solution.
- @nifrajs/image: https://github.com/nifrajs/nifra/tree/main/packages/image . MIT,
  npm 4.0.2, no declared runtime dependencies in the inspected manifest. Separate
  backends export supports Bun.Image and injected Sharp. Server handler adds
  source resolution, limits, admission control and HTTP handling. Its inspected
  source accepts a filesystem root or allowed HTTP origins, not Postbot's media
  storage/authorization contract. No automatic backend fallback observed in
  backend.ts; callers select a backend. Candidate for a bounded experiment,
  not adopted solely from its README. Check published artifact against source.
- @zerotal/media: https://zerotal.dev/docs/media . Native Bun driver and Sharp
  option, conversions and responsive variants. Pulls its core and ORM and owns
  media persistence: an architectural replacement rather than a narrow codec.
- @rakun-kit/core: broader application core with image backends but unrelated
  dependencies (auth, QR, collaboration). Not a focused dependency for Postbot.
- Unpic React: https://unpic.pics/img/react/ . Frontend responsive presentation
  and image URL integration, not a replacement for server image generation.

Registry manifests were read without installing any package. Repository main
sources may differ from released code. No claims of package maturity or
exhaustive market coverage.

## Owner clarification and revised recommendation

The owner rejected @nifrajs/image as a dependency. Do not install or experiment
with it. The earlier candidate recommendation is superseded. The requested
primitive concerns variant generation, persistence and delivery, not a wrapper
around Bun.Image and Sharp.

Payload's upload imageSizes configuration demonstrates the established CMS
pattern: named sizes generated during upload, stored files and sizes metadata,
and an adminThumbnail selection. This belongs to its collection upload lifecycle;
no standalone extraction is proposed. Reference:
https://payloadcms.com/docs/upload/overview .

IPX is the closest inspected standalone primitive: an embedded image optimizer
with size/format URL modifiers and storage adapters. It does not require another
service, but uses Sharp. It does not eliminate Postbot's private storage,
authorization or durable derivative lifecycle integration. Stable v3 reference:
https://github.com/unjs/ipx/tree/v3 .

For the media library, prefer Payload's stored-variant pattern over an arbitrary
on-demand transformation endpoint. Postbot already models derived representations
and their source representation. Add a few named presets using that model,
generate portable WebP with Bun.Image, and connect authenticated delivery and
cleanup. Browser srcset/sizes can then select the appropriate variant. Preserve
originals. This is narrow application integration around an existing image
engine, not a new image processing library. Unsupported formats and video
posters remain separate, evidence-driven decisions.

No dependency installed or application behavior changed. Next implementation:
MEDIA-389, with representative before/after transfer byte measurements.
