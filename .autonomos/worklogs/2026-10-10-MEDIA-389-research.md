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
  source accepts a filesystem root or allowed HTTP origins, not Herald's media
  storage/authorization contract. No automatic backend fallback observed in
  backend.ts; callers select a backend. Candidate for a bounded experiment,
  not adopted solely from its README. Check published artifact against source.
- @zerotal/media: https://zerotal.dev/docs/media . Native Bun driver and Sharp
  option, conversions and responsive variants. Pulls its core and ORM and owns
  media persistence: an architectural replacement rather than a narrow codec.
- @rakun-kit/core: broader application core with image backends but unrelated
  dependencies (auth, QR, collaboration). Not a focused dependency for Herald.
- Unpic React: https://unpic.pics/img/react/ . Frontend responsive presentation
  and image URL integration, not a replacement for server image generation.

Registry manifests were read without installing any package. Repository main
sources may differ from released code. No claims of package maturity or
exhaustive market coverage.

## Recommendation for next implementation

Reuse native Bun.Image for ordinary images and portable WebP output. Before
adding abstraction, compare the published Nifra backend in a disposable small
probe with the direct native call; adopt it only if its contract removes real
work. Do not build a general-purpose URL transformation service or migrate
Herald's media model. A few named size presets, stored derivatives, current
project authorization and cleanup wiring remain Herald-specific regardless of
codec choice. Sharp fallback should cover demonstrated unsupported formats,
not silently retry every failure or bypass input/resource limits.

Next: select the narrow processing seam, then implement MEDIA-389 and measure
actual bytes for representative large images. No application behavior changed.
