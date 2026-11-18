<!-- cspell:disable -->

# Postdot Web Studio Image Editor Library Survey

Date: 2026-11-18
Target codebase: Postdot web Studio (`apps/web`, `packages/ui`)

## 1. Current Baseline in Postdot

Postdot's web application runs on React `19.3.0`, Vite `8.3.1`, Tailwind CSS `4.3.3`, `@base-ui/react` `1.8.0` (`packages/ui/src/components`), `@solar-icons/react` `2.3.2`, Paraglide i18n (`@inlang/paraglide-js` `2.25.4`), and headless `@uppy/core` `6.2.0` / `@uppy/react` `6.0.0` (with no `@uppy/dashboard`). The repository is licensed under `AGPL-3.0-only` (see `package.json` and `apps/web/package.json`).

The existing editor at `apps/web/src/components/media-image-editor-dialog.tsx` wraps `react-easy-crop@6.2.3` inside `@postdot/ui/components/dialog` (`MediaImageEditorDialog`) and provides:
- Pan, zoom (`1` to `3`, `zoomWithScroll`, `keyboardStep={1}`), and `-90` / `+90` degree rotation buttons plus a full reset button.
- Four aspect presets (`source`, `square` `1:1`, `portrait` `4:5`, `landscape` `16:9`).
- Custom HTML5 canvas export (`createEditedImage`) that fetches `api.mediaContentUrl(projectId, assetId)` with `credentials: 'same-origin'`, draws the rotated image onto an intermediate canvas, crops the target rectangle, and exports JPEG or PNG at `0.92` quality.
- Current gaps observed in the dialog: `packages/ui/src/components/` has no `slider.tsx` yet so zoom uses an unstyled native `<input type="range">`, `Cropper` receives no `cropperProps` (`role`, `aria-label`) or `mediaProps` (`alt`), there is no flip or free-angle straighten, aspect presets are generic rather than channel-aware (Postdot supports `bluesky`, `devto`, `discord`, `email`, `facebook`, `instagram`, `linkedin`, `mastodon`, `telegram`, and `x`), and there is no redaction/blur or WebP/max-dimension control.

Key constraints for any candidate:
1. Embeddable, light to ship, crop-first (not a Photoshop clone).
2. Headless or deeply stylable with Tailwind CSS v4 and Base UI primitives in `packages/ui`.
3. Strong mobile touch (pinch-to-zoom, drag) and keyboard accessibility.
4. Compatible with React `19.3.0` and Postdot's `AGPL-3.0-only` license.

---

## 2. Candidate Library Survey

### 2.1 `react-easy-crop` (Current Baseline: `6.2.3` in repo, `6.2.5` latest)

- **License:** MIT ([GitHub](https://github.com/ValentinH/react-easy-crop)).
- **Bundle size:** `24,975 B` minified / `7,218 B` (~7.2 kB) minified+gzipped for `6.2.5`, 1 dependency (`normalize-wheel`) ([Bundlephobia](https://bundlephobia.com/api/size?package=react-easy-crop@6.2.5)), plus `react-easy-crop.css`.
- **Last release and maintenance:** `6.2.5` published November 9, 2026, with `7.0.0--canary.*` pre-releases active on npm ([npm](https://www.npmjs.com/package/react-easy-crop)). Continuously maintained since 2018.
- **React 19 support:** Full support (`peerDependencies: react >=16.4.0`) ([npm](https://www.npmjs.com/package/react-easy-crop)).
- **Headless or styling model:** Single pre-built React component (`<Cropper>`) plus stylesheet (`react-easy-crop.css`), styled via `classes`, `style`, and CSS overrides. Not headless.
- **Features:**
  - *Free rotation / straighten:* Supports any numeric `rotation` prop (`0-360` or negative) and two-finger touch twist (`onRotationChange`), but provides no automatic minimum-zoom corner-fit solver when tilting, so rotated crops expose empty corners at `zoom={1}` ([GitHub issue #350](https://github.com/ValentinH/react-easy-crop/issues/350)).
  - *Flip:* Not built in; must be implemented via `transform` overrides and canvas `ctx.scale` during export.
  - *Aspect presets:* Controlled via `aspect` numeric prop; frame is fixed-center and not user-resizable via drag handles.
  - *Mobile touch:* Native pinch-to-zoom, single-finger pan, and two-finger rotation twist.
  - *Keyboard accessibility:* Supports arrow-key panning via `keyboardStep` ([docs](https://github.com/ValentinH/react-easy-crop#props)), no built-in zoom/rotate shortcuts or crop-frame resize handles.
  - *Filters, adjustments, annotations, redaction/blur:* None.
  - *Resize / export:* Coordinate-only output (`onCropComplete(croppedArea, croppedAreaPixels)`). Postdot already owns canvas export (`createEditedImage`).
- **Accessibility notes:** Exposes `cropperProps` and `mediaProps` for custom `role`, `aria-label`, and `alt`, but provides no built-in ARIA live announcements, slider semantics, or focusable handle controls.

---

### 2.2 `react-advanced-cropper` (`0.20.1`) / `advanced-cropper` (`0.17.1`)

- **License:** MIT ([GitHub](https://github.com/advanced-cropper/react-advanced-cropper)).
- **Bundle size:** `92,319 B` minified / `24,758 B` (~24.8 kB) minified+gzipped for `react-advanced-cropper@0.20.1` ([Bundlephobia](https://bundlephobia.com/api/size?package=react-advanced-cropper@0.20.1)).
- **Last release and maintenance:** `react-advanced-cropper@0.20.1` released March 1, 2025; core `advanced-cropper@0.17.1` released June 9, 2024 ([npm](https://www.npmjs.com/package/react-advanced-cropper)). Marked `0.x` beta in README with noticeably slower release cadence in 2025-2026.
- **React 19 support:** `peerDependencies` require `react >=16.8.0` and install cleanly on React 19, though devDependencies still target `@types/react ^17` (note: sibling package `react-mobile-cropper` caps React at 18) ([npm](https://www.npmjs.com/package/react-advanced-cropper)).
- **Headless or styling model:** Componentized React wrapper with 5 built-in CSS themes (`classic`, `compact`, `circle`, `bubble`, plus custom CSS) and replaceable `stencilComponent`, `wrapperComponent`, and `backgroundWrapperComponent` ([docs](https://advanced-cropper.github.io/react-advanced-cropper/)). Partially composable rather than true unstyled headless.
- **Features:**
  - *Free rotation / straighten:* Built-in free `rotateImage(angle)` and EXIF auto-orientation. Default behavior leaves transparent corners unless wired to `fitStencilToImage` from `advanced-cropper/showcase/mobile` via `postProcess` ([docs](https://advanced-cropper.github.io/react-advanced-cropper/docs/guides/mobile-cropper/)).
  - *Flip:* Built-in `flipImage(horizontal, vertical)`.
  - *Aspect presets:* `stencilProps={{ aspectRatio, minAspectRatio, maxAspectRatio }}` with 8 resizable handles (or `FixedCropper` mode).
  - *Mobile touch:* Supports pinch-to-zoom and two-finger rotation.
  - *Keyboard accessibility:* No built-in keyboard navigation (`tabIndex`, arrow-key nudging, or ARIA roles are absent in `0.20.1`).
  - *Filters, adjustments, annotations, redaction/blur:* None.
  - *Resize / export:* Built-in `cropperRef.current.getCanvas(DrawOptions)` with `maxWidth` / `maxHeight` / `fillColor` and `canvas.toBlob()`.
- **Accessibility notes:** Weak out of the box. Handles and crop region lack `role`, `tabIndex`, `aria-label`, and live region announcements, requiring custom stencil replacements to meet WCAG keyboard standards.

---

### 2.3 Cropper.js v2 (`cropperjs@2.3.1`, Web Components)

- **License:** MIT ([GitHub](https://github.com/fengyuanchen/cropperjs)).
- **Bundle size:** `49,825 B` minified / `14,809 B` (~14.8 kB) minified+gzipped for the full `cropperjs@2.3.1` package ([Bundlephobia](https://bundlephobia.com/api/size?package=cropperjs@2.3.1)). Modular sub-packages allow smaller builds (`@cropper/element-canvas` is ~3.9 kB gzipped; `@cropper/element-selection` is ~6.6 kB gzipped) ([Bundlephobia element-canvas](https://bundlephobia.com/api/size?package=@cropper/element-canvas)).
- **Last release and maintenance:** v2.0.0 launched March 2025; `2.3.1` released October 16, 2026 ([npm](https://www.npmjs.com/package/cropperjs), [docs](https://fengyuanchen.github.io/cropperjs/)). Actively maintained.
- **React 19 support:** React 19 natively supports Custom Elements and custom event listeners, but `cropperjs` does not ship React JSX type declarations (`TS2339` unless augmented) and SSR/static evaluation throws `ReferenceError: HTMLElement is not defined`. Legacy `react-cropper` (`2.3.3`) only wraps Cropper.js v1; community package `@imerljak/react-cropper-2` (`0.2.1` on npm March 2026 / `0.3.1` on GitHub, MIT) provides React 18/19 bindings ([GitHub](https://github.com/imerljak/react-cropper-2)).
- **Headless or styling model:** Framework-agnostic Web Components (`<cropper-canvas>`, `<cropper-image>`, `<cropper-selection>`, `<cropper-handle>`, `<cropper-shade>`) using Shadow DOM and embedded CSS-in-JS ([docs](https://fengyuanchen.github.io/cropperjs/v2/api/cropper-element.html)). Shadow DOM makes styling with Tailwind utility classes or Base UI tokens awkward compared to regular DOM elements.
- **Features:**
  - *Free rotation / straighten:* Full 2D transformation matrix via `$rotate(angle)` and `$setTransform(...)`. No automatic zoom-to-cover straighten helper built in.
  - *Flip:* Supported via `$scale(-1, 1)` or `$scale(1, -1)`.
  - *Aspect presets:* `aspectRatio` on `<cropper-selection>`, resizable handles, multi-selection support, and `border-radius` styling.
  - *Mobile touch:* Pinch-to-zoom, pan, and two-finger rotate.
  - *Keyboard accessibility:* Opt-in `keyboard` attribute attaches a global `document` keydown listener ([docs](https://fengyuanchen.github.io/cropperjs/v2/api/cropper-selection.html)), rather than focusable tab stops inside the cropper.
  - *Filters, adjustments, annotations, redaction/blur:* None.
  - *Resize / export:* Async `selection.$toCanvas({ width, height, beforeDraw })`. Omitting `width` and `height` exports at rendered CSS pixel size rather than full source resolution, so integrators must compute natural output dimensions explicitly.
- **Accessibility notes:** Global document keyboard binding can conflict with surrounding dialog/editor shortcuts (such as `@tanstack/hotkeys` already in Postdot's `apps/web/package.json`), and Shadow DOM elements lack native tabbable handle controls and ARIA live feedback.

---

### 2.4 `react-image-crop` (`11.1.2`)

- **License:** ISC ([GitHub](https://github.com/dominictobias/react-image-crop)).
- **Bundle size:** `15,509 B` minified / `4,599 B` (~4.6 kB) minified+gzipped with zero dependencies ([Bundlephobia](https://bundlephobia.com/api/size?package=react-image-crop@11.1.2)), plus ~1 kB CSS (`ReactCrop.css`).
- **Last release and maintenance:** `11.1.2` released June 21, 2026 (note: avoid `11.1.0`/`11.1.1` bug-fix regressions) ([npm](https://www.npmjs.com/package/react-image-crop)). Long-lived and actively maintained since 2015.
- **React 19 support:** Full support (`react >=16.13.1`, devDependencies tested on React 19) ([npm](https://www.npmjs.com/package/react-image-crop)).
- **Headless or styling model:** Minimal styled wrapper around a user-supplied `<img>` (or `<video>`) with `ReactCrop.css` driven by `--rc-*` CSS variables ([GitHub](https://github.com/dominictobias/react-image-crop)).
- **Features:**
  - *Free rotation / straighten / flip:* None. Rotation and zoom were intentionally removed in v10; it only draws a selection box over a still media element.
  - *Aspect presets:* `aspect`, `minWidth`, `maxWidth`, `circularCrop` (visual mask only), `ruleOfThirds`.
  - *Mobile touch:* Draggable touch handles (`24px` hit targets on coarse pointers), **no pinch-to-zoom**.
  - *Keyboard accessibility:* Strong keyboard support with 9 tab stops (crop box plus 8 handles) and `1px` / `10px` / `100px` arrow-key increments ([GitHub](https://github.com/dominictobias/react-image-crop)).
  - *Filters, adjustments, annotations, redaction/blur:* None.
  - *Resize / export:* v11.1+ includes `cropToCanvas` and `cropToImg` helpers (exporting PNG object URLs at source size times DPR), alongside coordinate callbacks (`PixelCrop`, `PercentCrop`).
- **Accessibility notes:** Best-in-class simple box keyboard model with customizable `ariaLabels` prop, though it has no `aria-live` announcements. Because it drops zoom, rotation, and pinch-to-zoom, adopting it would be a step backward from Postdot's current `react-easy-crop` feature set.

---

### 2.5 Pintura (`@pqina/pintura@8.101.1` + `@pqina/react-pintura@9.0.4`)

- **License and pricing:** Proprietary commercial SDK ([license terms](https://pqina.nl/pintura/license/)). The public npm package is a watermarked evaluation build. Pricing ([pricing page](https://pqina.nl/pintura/)):
  - *Personal:* EUR 169/year (EUR 229/year with video) for 1 solo developer, 1 product, under $100k annual revenue/funding.
  - *Developer:* EUR 749/year per seat (EUR 1,149/year with video).
  - *Enterprise:* Custom pricing. Perpetual fallback license included after 12 months.
  - **License blocker:** Incompatible with Postdot's `AGPL-3.0-only` open-source distribution.
- **Bundle size:** `692,549 B` minified / `218,400 B` (~218.4 kB) minified+gzipped for `@pqina/pintura` ([Bundlephobia](https://bundlephobia.com/api/size?package=@pqina/pintura)) plus `752 B` gzipped for `@pqina/react-pintura` and ~95 kB raw CSS (tree-shakeable down when using `appendEditor` with selected plugins).
- **Last release and maintenance:** Very active (`8.100.4` September 28, 2026; `8.101.0` / `8.101.1` November 2026; `react-pintura@9.0.4` March 2025) ([npm](https://www.npmjs.com/package/@pqina/pintura)).
- **React 19 support:** Yes ([docs](https://pqina.nl/pintura/docs/v8/installation/react/)).
- **Headless or styling model:** Pre-built turnkey UI (inline, modal, or overlay modes) themed via CSS custom properties, not headless.
- **Features:**
  - *Crop, straighten, flip, presets:* Full crop with presets, free-angle straighten with automatic edge-fill zoom fitting, 90-degree rotations, flip X/Y, zoom.
  - *Mobile touch:* Full pinch, pan, and touch gestures.
  - *Keyboard accessibility:* Modifier keys (`Alt`/`Shift`), arrow-key sliders, modal focus trapping, `aria-hidden` background handling, and Lighthouse accessibility fixes. No published VPAT.
  - *Filters, adjustments, annotations, redaction/blur:* Complete suite: `plugin_finetune`, `plugin_filter`, `plugin_annotate`, `plugin_decorate`, `plugin_sticker`, `plugin_frame`, and a dedicated `plugin_redact` plugin for blurring/redacting sensitive regions ([docs](https://pqina.nl/pintura/docs/v8/api/plugins/)).
  - *Resize / export:* `plugin_resize` and built-in JPEG, PNG, and WebP export with quality controls and EXIF preservation.
- **Accessibility notes:** Solid modal and slider keyboard ergonomics, though closed-source UI limits deep Base UI integration.

---

### 2.6 Filerobot Image Editor (`react-filerobot-image-editor@4.9.1` / `5.0.0-beta.159`)

- **License:** MIT ([GitHub](https://github.com/scaleflex/filerobot-image-editor)).
- **Bundle size:** `664,869 B` minified / `191,081 B` (~191.1 kB) minified+gzipped for `react-filerobot-image-editor@4.9.1` **excluding peer dependencies** ([Bundlephobia](https://bundlephobia.com/api/size?package=react-filerobot-image-editor@4.9.1)). Full runtime cost with `react-konva`, `konva`, and `styled-components` peers is ~331 kB gzipped JS ([Orshot benchmark](https://orshot.com/blog/best-javascript-image-editor-libraries)).
- **Last release and maintenance:** Stable `4.9.1` released December 30, 2024; `5.0.0-beta.159` published June 2, 2026 ([npm](https://www.npmjs.com/package/react-filerobot-image-editor)).
- **React 19 support:** Stable `4.x` targets React 17/18 and hits `react-konva` compatibility issues on React 19; `5.0.0-beta.159` is required for React 19 (still beta).
- **Headless or styling model:** Monolithic pre-built toolbar/workspace UI built on `styled-components`, `@scaleflex/ui`, and `react-konva`. Very difficult to restyle to match Tailwind CSS v4 + Base UI tokens.
- **Features:**
  - *Crop, straighten, flip, presets:* Crop + elliptical crop, rotate slider + 90-degree buttons, flip X/Y, resize, aspect presets.
  - *Mobile touch:* Basic pan/drag; Konva-heavy touch interactions feel non-native on mobile.
  - *Keyboard accessibility:* Minimal keyboard shortcuts; main Konva canvas is opaque to screen readers and tab navigation.
  - *Filters, adjustments, annotations, redaction/blur:* 40+ filters, finetune adjustments (including **global** image blur only, no regional redaction/pixelate tool), watermark, and rich vector annotations (text, rectangle, ellipse, polygon, pen, line, arrow) ([GitHub](https://github.com/scaleflex/filerobot-image-editor)).
  - *Resize / export:* Exports PNG, JPEG, and WebP with quality and target dimension options.
- **Accessibility notes:** Poor accessibility due to `<canvas>`-rendered controls in Konva and `styled-components` modal layering.

---

### 2.7 Uppy Image Editor (`@uppy/image-editor@5.0.1` + `@uppy/react@6.0.0`)

- **License:** MIT ([GitHub](https://github.com/transloadit/uppy)).
- **Bundle size:** `66,032 B` minified / `21,712 B` (~21.7 kB) minified+gzipped for `@uppy/image-editor@5.0.1`, which bundles Preact and Cropper.js v1.x ([Bundlephobia](https://bundlephobia.com/api/size?package=@uppy/image-editor@5.0.1)). Using the headless `useImageEditor` hook in `@uppy/react@6.0.0` (which Postdot already has installed) without `@uppy/dashboard` adds ~35 kB Brotli JS+CSS ([zriz comparison](https://zriz.dev/docs/zriz-vs-uppy-image-editor)).
- **Last release and maintenance:** `5.0.1` released October 16, 2026, though Uppy docs still mark Image Editor as beta ([npm](https://www.npmjs.com/package/@uppy/image-editor), [Uppy docs](https://uppy.io/docs/image-editor/)).
- **React 19 support:** Yes via `@uppy/react@6.0.0` ([npm](https://www.npmjs.com/package/@uppy/react)).
- **Headless or styling model:** Historically coupled to `@uppy/dashboard` (Preact), though `@uppy/react@6.0.0` exposes a headless `useImageEditor` hook that delegates cropping mechanics to bundled Cropper.js v1.x.
- **Features:**
  - *Crop, straighten, flip, presets:* 90-degree rotation (resets selection box/slider), +/-45 degree straighten slider with auto-zoom, flip H/V, aspect presets, zoom, reset ([Uppy docs](https://uppy.io/docs/image-editor/)).
  - *Mobile touch:* Inherited from Cropper.js v1.x (pinch-to-zoom, drag).
  - *Keyboard accessibility:* Toolbar buttons are accessible, but the underlying Cropper.js v1 crop box is not keyboard-navigable, and the straighten slider and 90-degree button share a single accessible label bug ([zriz comparison](https://zriz.dev/docs/zriz-vs-uppy-image-editor)).
  - *Filters, adjustments, annotations, redaction/blur:* None.
  - *Resize / export:* Exports edited file back into the Uppy upload queue with configurable `quality` (default `0.8`), `maxWidth`, and `maxHeight`.
- **Accessibility notes:** Postdot already uses `@uppy/core` `6.2.0` and `@uppy/react` `6.0.0` headlessly in `apps/web/src/lib/postdot-media-upload.ts`, so integrating `@uppy/image-editor` looks tempting on paper, but it pulls in Preact + deprecated Cropper.js v1 while leaving the crop stage keyboard-inaccessible.

---

### 2.8 Toast UI Image Editor (`tui-image-editor@3.15.3` / `@toast-ui/react-image-editor@3.15.2`)

- **License:** MIT ([GitHub](https://github.com/nhn/tui.image-editor)).
- **Bundle size:** Core `700,822 B` minified / `188,062 B` (~188.1 kB) minified+gzipped ([Bundlephobia](https://bundlephobia.com/api/size?package=tui-image-editor)); React wrapper `744,113 B` minified / `203,958 B` (~204.0 kB) minified+gzipped ([Bundlephobia React wrapper](https://bundlephobia.com/api/size?package=@toast-ui/react-image-editor)). Depends on Fabric.js.
- **Last release and maintenance:** **Officially archived on September 2, 2026** ([GitHub](https://github.com/nhn/tui.image-editor)). Last npm releases were April 25, 2022 (`tui-image-editor@3.15.3`) and October 20, 2021 (`@toast-ui/react-image-editor@3.15.2`) ([npm](https://www.npmjs.com/package/tui-image-editor)).
- **React 19 support:** `@toast-ui/react-image-editor` fails cleanly on React 19 (`peerDependencies: react ^17.0.0`, class component wrapper, no TypeScript declarations). The vanilla package works only inside a client-side `useRef` (SSR throws `window is not defined`) and sends Google Analytics telemetry by default unless `usageStatistics: false` is passed ([GitHub README](https://github.com/nhn/tui.image-editor)).
- **Headless or styling model:** Monolithic built-in workspace UI with theme object overrides. Not headless.
- **Features:** Crop, rotate, flip, resize, freehand drawing, shapes, icons, text, masks, 15+ filters (including blur and pixelate), `toDataURL()` export.
- **Accessibility notes:** Poor accessibility: tool palette is not keyboard-accessible, sliders are non-native mouse controls, and global `Delete` key handling can leak outside the editor. Do not adopt.

---

### 2.9 img.ly CreativeEditor SDK (`@cesdk/cesdk-js@1.86.2`) & PhotoEditor SDK (`photoeditorsdk@5.20.0`)

- **License and pricing:** Proprietary commercial SDK ([pricing](https://img.ly/pricing)). Custom enterprise quote based on subscription, monthly active users (MAU) or exports, and platforms; includes remote license validation/telemetry by default.
  - **License blocker:** Incompatible with Postdot's `AGPL-3.0-only` open-source distribution.
- **Bundle size:**
  - *CE.SDK (`@cesdk/cesdk-js`):* `2,975,529 B` minified / `814,353 B` (~814.4 kB) minified+gzipped JS ([Bundlephobia](https://bundlephobia.com/api/size?package=@cesdk/cesdk-js)), plus `6.2-8.2 MB` of WebAssembly engine and asset payloads loaded at runtime.
  - *PE.SDK (`photoeditorsdk`):* `1,480,971 B` minified / `375,136 B` (~375.1 kB) minified+gzipped JS ([Bundlephobia](https://bundlephobia.com/api/size?package=photoeditorsdk)) plus static asset bundles and `styled-components`.
- **Last release and maintenance:** CE.SDK is actively developed (`1.86.2` November 12, 2026) ([npm](https://www.npmjs.com/package/@cesdk/cesdk-js)). PE.SDK `5.20.0` is the latest release, and IMG.LY actively steers new projects toward CE.SDK ([PE.SDK docs](https://img.ly/docs/pesdk/web/getting-started/react/)).
- **React 19 support:** Supported in CE.SDK and PE.SDK `5.20.0`.
- **Headless or styling model:** Full-featured studio UI (CE.SDK also exposes a headless scene/engine API, though at multi-megabyte WASM weight).
- **Features:** Complete Photoshop/Canva-class editing: crop, straighten, flip, presets, touch pinch/pan, filters/LUTs, text/shapes/stickers, export. CE.SDK adds dedicated redaction workflows (blur/pixelate/solid) ([CE.SDK docs](https://img.ly/docs/cesdk/engine/guides/)); PE.SDK provides radial/linear focus blur.
- **Accessibility notes:** CE.SDK ships WCAG AA themes, configurable `a11y` heading hierarchy, and customizable `cesdk.shortcuts` ([CE.SDK accessibility](https://img.ly/docs/cesdk/ui/guides/accessibility/)), while PE.SDK offers localized ARIA labels. Far too heavy and commercially incompatible for Postdot.

---

### 2.10 Newer 2025-2026 Headless Crop Editors

Three newer projects from 2025-2026 specifically target React 19 and headless/shadcn workflows:

#### A. `@zriz/react` + `@zriz/core` (`0.2.1`, November 2026)

- **License:** MIT ([GitHub / docs](https://zriz.dev/docs)).
- **Bundle size:** `@zriz/react@0.2.1` is `3,703 B` min+gzip ([Bundlephobia](https://bundlephobia.com/api/size?package=@zriz/react@0.2.1)); `@zriz/core@0.2.1` is `8,881 B` min+gzip ([Bundlephobia](https://bundlephobia.com/api/size?package=@zriz/core@0.2.1)), totaling **~12.6 kB min+gzip** JS with zero dependencies and ESM-only output (author benchmarks report 22-29 kB Brotli JS+CSS with Rolldown plus up to 11 kB lazy export utilities) ([zriz docs](https://zriz.dev/docs)).
- **Last release and maintenance:** Initial release November 7-11, 2026 (`0.2.1`) by maintainer `pqoqubbw` ([npm @zriz/react](https://www.npmjs.com/package/@zriz/react)). Very new with <1,000 weekly downloads and a single primary maintainer.
- **React 19 support:** Built and tested specifically on React 19 (`19.3.1`).
- **Headless or styling model:** Headless primitive components (`Cropper.Root`, `Cropper.Viewport`, `Cropper.Image`, `Cropper.Frame`, `Cropper.Handles`, `Cropper.Dial`, `Cropper.Announcer`, `Cropper.Instructions`) plus copy-paste shadcn blocks for both Radix and **Base UI** (`@base-ui/react`) with optional `@layer` CSS ([zriz shadcn docs](https://zriz.dev/docs/shadcn)). Matches Postdot's stack directly.
- **Features:**
  - *Free rotation / straighten:* iOS-Photos-style `-45` to `+45` degree straighten dial with a minimum-zoom corner-fit solver so tilted images never show empty triangles, plus animated 90-degree rotations (WAAPI).
  - *Flip:* Built-in horizontal and vertical flip.
  - *Aspect presets:* Free, original, aspect ratio lock, and circular mask.
  - *Mobile touch:* Pinch-to-zoom, pan, two-finger twist rotation, and two-finger handle resize.
  - *Keyboard accessibility:* Full keyboard support across frame, handles, and straighten dial.
  - *Filters, adjustments, annotations, redaction/blur:* None.
  - *Resize / export:* Off-main-thread Web Worker export to JPEG, PNG, and WebP with `maxSize` bounding and quality settings. Note: URL loading requires CORS headers, which works with Postdot's same-origin `api.mediaContentUrl(...)` endpoint.
- **Accessibility notes:** Best-in-class accessibility design in this category: includes `Cropper.Announcer` (`aria-live` readouts), `Cropper.Instructions`, `prefers-reduced-motion` handling, and **zero hardcoded English strings** (every label is user-supplied, ideal for Postdot's Paraglide i18n checks).

#### B. `@zag-js/image-cropper` (`1.48.0`) / `@ark-ui/react` (`5.40.0`)

- **License:** MIT ([GitHub](https://github.com/chakra-ui/zag)).
- **Bundle size:** `@zag-js/image-cropper@1.48.0` is `11,650 B` min+gzip ([Bundlephobia](https://bundlephobia.com/api/size?package=@zag-js/image-cropper)) and `@zag-js/react@1.48.0` is `4,231 B` min+gzip ([Bundlephobia](https://bundlephobia.com/api/size?package=@zag-js/react)), totaling **~15.9 kB min+gzip**. Note that the full `@ark-ui/react` barrel reports ~296.9 kB gzipped across 69 dependencies on Bundlephobia ([Bundlephobia @ark-ui/react](https://bundlephobia.com/api/size?package=@ark-ui/react)), though tree-shaking the ImageCropper module yields ~16 kB Brotli. Using `@zag-js/image-cropper` directly avoids pulling the entire Ark UI barrel.
- **Last release and maintenance:** Shipped October 2025; actively maintained by the Chakra/Ark team (`@zag-js/image-cropper@1.48.0` released November 13, 2026; `@ark-ui/react@5.40.0` released October 29, 2026) ([npm](https://www.npmjs.com/package/@zag-js/image-cropper)). Tagged `preview` status in Ark UI documentation ([Ark UI docs](https://ark-ui.com/docs/components/image-cropper)).
- **React 19 support:** Yes.
- **Headless or styling model:** True headless state machine exposing `data-*` attributes and `get*Props()` spreaders (`getRootProps`, `getViewportProps`, `getImageProps`, `getSelectionProps`, `getHandleProps`) ([Zag.js docs](https://zagjs.com/components/react/image-cropper)). Styles cleanly with Tailwind CSS v4 and `@postdot/ui` Base UI components.
- **Features:**
  - *Free rotation / straighten:* Exposes a rotation API (`setRotation`), but lacks a built-in minimum-zoom corner-fit straighten solver.
  - *Flip:* Built-in `setFlip({ horizontal, vertical })`.
  - *Aspect presets:* Resizable 8-handle selection box plus `fixedCropArea` mode and `aspectRatio` lock.
  - *Mobile touch:* Supports pinch-to-zoom and drag; wheel zoom calls `preventDefault()` unconditionally when hovering the viewport.
  - *Keyboard accessibility:* Selection box acts as a `role="slider"` tab stop supporting arrow-key nudging, `Shift` resize, and zoom keys.
  - *Filters, adjustments, annotations, redaction/blur:* None.
  - *Resize / export:* Built-in `getCroppedImage()` returning a `Blob` or data URL with `maxSize` / quality options.
- **Accessibility notes:** Strong ARIA semantics (`role="slider"`, `aria-valuetext`, `translations` prop for full Paraglide localization). Layout quirk: Zag's default image styling uses `object-fit: fill`, so Postdot's container must match the image aspect ratio to avoid distortion.

#### C. `@origin-space/image-cropper` (`0.1.9`, May 2025)

- **License:** MIT ([GitHub](https://github.com/origin-space/image-cropper)).
- **Bundle size:** `9,590 B` minified / `3,731 B` (~3.7 kB) minified+gzipped, zero dependencies ([Bundlephobia](https://bundlephobia.com/api/size?package=@origin-space/image-cropper@0.1.9)).
- **Last release and maintenance:** `0.1.9` released May 2, 2025 ([npm](https://www.npmjs.com/package/@origin-space/image-cropper)); dormant for 18+ months as of November 2026.
- **React 19 support:** Strictly requires `react ^19.1.0` in peerDependencies.
- **Headless or styling model:** Headless composable primitives (`Cropper`, `CropperImage`, `CropperCropArea`) made for Tailwind / shadcn-style UIs.
- **Features:** Zoom and pan only. Missing rotation, straighten, flip, aspect handle resizing, built-in canvas export, filters, annotations, and blur.
- **Accessibility notes:** Basic keyboard pan and ARIA role on crop area, but too incomplete and unmaintained to replace `react-easy-crop`.

---

## 3. Comparison Table

| Library | License | Size (min+gzip JS) | Last Release | React 19 | Styling Model | Free Rotate / Straighten | Flip | Pinch Mobile | Keyboard A11y | Filters / Annotate / Redact-Blur | Resize / Export Formats |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| `react-easy-crop` (`6.2.5`) | MIT | ~7.2 kB | Nov 2026 (active) | Yes | Pre-styled + CSS/classes | Free prop, no corner-fit | No (DIY) | Yes + twist | Pan arrows only | No / No / No | Coords only (DIY canvas) |
| `react-advanced-cropper` (`0.20.1`) | MIT | ~24.8 kB | Mar 2025 (slow) | Yes (beta) | Themes + custom stencils | Yes (fit via addon) | Yes | Yes + twist | None built-in | No / No / No | `getCanvas` + `toBlob` |
| `Cropper.js` v2 (`2.3.1`) | MIT | ~14.8 kB (or 3.9+6.6 kB) | Oct 2026 (active) | Native CE (no TS/SSR) | Shadow DOM Web Comp | Matrix `$rotate` | Yes (`$scale`) | Yes + twist | Global `document` keydown | No / No / No | `$toCanvas` (explicit W/H) |
| `react-image-crop` (`11.1.2`) | ISC | ~4.6 kB + 1 kB CSS | Jun 2026 (active) | Yes | Styled box + CSS vars | No / No | No | Drag only (no pinch) | 9 tab stops + arrows | No / No / No | `cropToCanvas` (PNG) |
| Pintura (`8.101.1`) | Commercial (EUR 169-749+/yr) | ~218.4 kB + 95 kB CSS | Nov 2026 (active) | Yes | Pre-built themed UI | Yes + auto-fit | Yes | Yes | Good (sliders, focus trap) | Yes / Yes / `plugin_redact` | Resize + JPEG/PNG/WebP |
| Filerobot (`4.9.1` / `5-beta`) | MIT | ~191.1 kB (+ ~140 kB peers) | Dec 2024 / Jun 2026 beta | Beta `5.x` only | Monolithic `styled-components` | Slider + 90s | Yes | Basic | Poor (Konva canvas) | Yes / Yes / Global blur only | Resize + PNG/JPEG/WebP |
| `@uppy/image-editor` (`5.0.1`) | MIT | ~21.7 kB (~35 kB Brotli hook) | Oct 2026 (beta) | Yes (`@uppy/react` 6) | Dashboard or `useImageEditor` | +/-45 straighten + 90s | Yes | Yes | Buttons yes, box no | No / No / No | Uppy queue, quality, maxW/H |
| Toast UI (`3.15.3`) | MIT | ~188.1 kB core / ~204 kB React | Apr 2022 (**Archived** Sep 2026) | No (React 17 wrapper) | Monolithic themed UI | Rotate | Yes | Basic | Poor | Yes / Yes / Blur+pixelate | `toDataURL` |
| img.ly CE.SDK / PE.SDK | Commercial (custom quote) | ~814 kB + 6-8 MB WASM / ~375 kB | Nov 2026 (active) | Yes | Turnkey Studio / Scene | Yes + auto-fit | Yes | Yes | WCAG AA themes + shortcuts | Yes / Yes / Redact (CE) | Multi-format + resize |
| `@zriz/react` + `@zriz/core` (`0.2.1`) | MIT | ~12.6 kB (~22-29 kB Brotli) | Nov 2026 (new) | Yes | Headless + Base UI blocks | +/-45 dial + corner-fit | Yes | Yes + twist | Full + `Announcer` + i18n | No / No / No | Worker JPEG/PNG/WebP + `maxSize` |
| `@zag-js/image-cropper` (`1.48.0`) | MIT | ~15.9 kB (Ark ~16 kB tree-shaken) | Nov 2026 (preview) | Yes | Headless `data-*` machine | Rotate API, no corner-fit | Yes | Yes | `role="slider"` + `translations` | No / No / No | `getCroppedImage` + `maxSize` |
| `@origin-space/image-cropper` (`0.1.9`) | MIT | ~3.7 kB | May 2025 (dormant) | Yes (`^19.1`) | Headless Tailwind | No / No | No | Pinch/pan | Basic pan | No / No / No | Coords only |

---

## 4. Top 3 Fits for Postdot and Trade-Offs

### 1. `@zag-js/image-cropper` + `@zag-js/react` (or `@ark-ui/react` ImageCropper)
- **Why it fits:** MIT-licensed, ~15.9 kB min+gzip JS, genuinely headless (`data-*` state attributes and prop spreaders), React 19 compatible, and backed by the active Chakra/Zag team. It ships resizable 8-handle cropping plus fixed-area mode, horizontal/vertical flip, pinch zoom, built-in `getCroppedImage()`, `role="slider"` keyboard controls, and a `translations` prop that maps cleanly to Postdot's Paraglide i18n rules.
- **Trade-offs:** Still marked `preview` in Ark UI docs, its image element uses `object-fit: fill` so the stage wrapper must keep the image aspect ratio, and it does not include a minimum-zoom corner-fit solver for free-angle straighten (Postdot would still write a ~15-line math helper if free-angle straighten is added).

### 2. `@zriz/react` + `@zriz/core` (`0.2.1`)
- **Why it fits:** Specifically targets Postdot's exact stack: React 19, Base UI (`@base-ui/react`) shadcn blocks, Tailwind v4 `@layer` opt-in styling, ~12.6 kB min+gzip JS, zero dependencies, and zero hardcoded strings for Paraglide. It is the only small MIT headless library that includes an iOS-style `-45` to `+45` straighten dial with automatic corner-fit zoom, two-finger twist, `Cropper.Announcer` (`aria-live`), and Web Worker WebP/JPEG/PNG export.
- **Trade-offs:** Very young (`0.2.1` published November 2026), single maintainer (`pqoqubbw`), low npm adoption (<1,000 weekly downloads), and sparse production track record compared to Zag.js or `react-easy-crop`.

### 3. Keep `react-easy-crop` (`6.2.5`) and Upgrade Postdot's Dialog Wrapper
- **Why it fits:** Zero migration risk, lightest proven footprint (~7.2 kB min+gzip), full React 19 support, active maintenance through November 2026, and Postdot already owns a clean `createEditedImage` canvas pipeline in `apps/web/src/components/media-image-editor-dialog.tsx`. Upgrading the surrounding controls in `packages/ui` (adding a Base UI `Slider`, keyboard shortcuts, flip, straighten math, and channel presets) solves most UX complaints without changing the crop engine.
- **Trade-offs:** Keeps a fixed-center crop viewport (no drag-resizable 8-handle box), offers only arrow-key pan natively (zoom/rotate keyboard controls and `aria-live` status must be wired in the wrapper), and still requires custom corner-fit zoom math if free-angle straighten is added.

*Why the heavier/commercial options were excluded:* Pintura and img.ly are proprietary and incompatible with `AGPL-3.0-only` (and img.ly adds ~814 kB + multi-MB WASM); Toast UI is archived; Filerobot requires ~331 kB with peers and `5.x` beta for React 19; Cropper.js v2 uses Shadow DOM Web Components without official React 19 JSX/SSR ergonomics.

---

## 5. Features Worth Adding Even If Keeping `react-easy-crop`

All of the items below can be added directly inside `apps/web/src/components/media-image-editor-dialog.tsx` and `packages/ui` with minimal bundle cost:

1. **Free-angle straighten (`-45` to `+45` degrees) with corner-safe minimum zoom:** Expose a fine slider alongside `-90` / `+90` buttons and clamp `minZoom` to `(width * |cos(a)| + height * |sin(a)|) / width` (and corresponding height term) so rotating a photo never exposes empty corner triangles.
2. **Horizontal and vertical flip:** Track `flipX` / `flipY` booleans, preview with CSS `scaleX` / `scaleY` via `mediaProps.style` (or `transform`), and apply `context.scale(flipX ? -1 : 1, flipY ? -1 : 1)` in `createEditedImage`.
3. **Channel-aware social aspect presets:** Expand beyond `source`, `1:1`, `4:5`, `16:9` to match Postdot's channels (`packages/instagram`, `packages/x`, `packages/linkedin`, `packages/bluesky`, `packages/facebook`, `packages/mastodon`, `packages/telegram`, `packages/devto`): e.g. `Original`, `1:1` (Square feed), `4:5` (Instagram/LinkedIn portrait), `3:4` (Instagram 2025-2026 grid), `16:9` (X/Bluesky/YouTube landscape), `1.91:1` (Link card / OG), and `9:16` (Stories / Reels), plus an option to toggle crop orientation (landscape/portrait swap).
4. **Lightweight redaction (blur or pixelate boxes):** Add an optional "Redact" mode that lets the user draw one or more normalized rectangles over the preview and applies `ctx.filter = 'blur(16px)'` (or downscale-upscale pixelation for guaranteed removal of text/faces) clipped to those rectangles inside `createEditedImage` before export. Zero external library needed.
5. **Output format, quality, and dimension controls:** Support `image/webp` alongside JPEG/PNG in `createEditedFilename` and `createEditedImage`, add a quality slider or preset for lossy formats, and optionally cap `maxWidth` / `maxHeight` (such as 2048px or 4096px) to prevent oversized canvas exports and match platform upload limits. Detect animated GIF/WebP inputs and warn the user that saving a crop flattens animation to a static frame.
6. **Base UI Slider, accessibility metadata, and `@tanstack/react-hotkeys` integration:** Add a `@base-ui/react` `Slider` component to `packages/ui/src/components/slider.tsx` to replace the unstyled `<input type="range">`, pass `cropperProps={{ role: 'application', 'aria-label': ... }}` and `mediaProps={{ alt: asset.asset.originalFilename }}`, wire keyboard shortcuts (`+`/`-` zoom, `[`/`]` rotate 90, `R` reset, `H`/`V` flip) using `@tanstack/react-hotkeys` (already in `apps/web/package.json`), and render a visually hidden `aria-live="polite"` readout for zoom, angle, and aspect changes.
