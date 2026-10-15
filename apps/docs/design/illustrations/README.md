# Illustration pilot

Live study: `/illustrations/`. This is not an approved homepage section.

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
