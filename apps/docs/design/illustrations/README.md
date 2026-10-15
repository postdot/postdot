# Illustration pilot

Live study: `/illustrations/`. The accepted composition also appears in the homepage distribution feature.

The active pilot uses the vendored Hairline kernel for its fixed camera, rounded
solids and shared animation scheduler. `scene.js` is the single geometry model:
source, plates, content, brand anchors and routes all derive from the same pose.
`figure.js` updates all of them together; CSS must never independently move a
connected plate. Draw routes first, then opaque solids from bottom to top.

Actual logo bodies come from the installed Iconify logos package, exported in
`brands.js`. Do not recreate brand marks with text or approximate their paths.
Postbot retains its accepted palette and branded diagrams; this intentionally
is not Hairline's stricter unbranded monochrome illustration style.

`scene.test.ts` samples a complete motion cycle to check attachment and stack
order, including the endpoints and finite geometry. Run with:

```
bun test apps/docs/design/illustrations/scene.test.ts
```

The original `dispatch.py` and dispatch SVGs are archived experiments. They are
not the model or renderer used by the current pilot.

## React integration

`DistributionIllustration` in `src/components/public-distribution.tsx` renders
a complete fixed SVG frame on the server, reserving the final aspect ratio. An
IntersectionObserver loads the motion renderer near the viewport. Live geometry
owns a separate empty SVG; it never mutates React-owned fallback paths. If the
module fails to load, the fixed frame remains visible. Effect cleanup unregisters
the shared scheduler, removes its visibility listener and clears owned nodes.
Theme colors are scoped to this component, not global SVG classes.

The standalone `preview.js` handles its own page lifecycle, including restoration
from the browser back/forward cache. Do not auto-mount figures at module import.
