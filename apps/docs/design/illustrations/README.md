# Illustration pilot

Live study: `/illustrations/`. The homepage placement was withdrawn: the owner accepted basic usability, not the visual standard.

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

## Current study sequence

The source and destination stack share the same ground-plane sum and central
height, giving a balanced composition with one orthographic camera. The stack
remains still. Curved connections, brand anchors and content use the same pose.
`transferAt` defines departures, arrival, content drawing and reset; content does
not appear before its transfer arrives. Avoid decorative opening/closing loops
that do not explain a product action. The dormant React wrapper is retained as
an integration tool, not a published feature or approved artistic treatment.

## Finishing baseline

The owner preferred the SITE-437 study; keep its composition and content-transfer
concept. SITE-438 separates receptions by 600 ms: a target edge highlights on
arrival, one target at a time. Completed content rests before a 600 ms fade. The
reset fades without drawing the text backwards. Logos use 24 viewBox units;
small-screen strokes use non-scaling widths. Build fixed geometry and cache route
lengths once per mount, updating only animation state on frames. Homepage
reintegration is a separate review, not implied by this refinement.
