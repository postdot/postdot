# Postdot isometric illustration method — research proposal

Status: proposed, not an accepted style or instruction to replace product imagery.
Owner supplied Anatomy and Hairline to establish a repeatable production method.
No illustration library, skill or Blender extension installed in this pass.

## Verified references

- [Anatomy](https://skills.wheresryan.sh/anatomy) and its
  [skill source](https://github.com/wheresryan22/anatomy/blob/main/SKILL.md):
  world-coordinate solids projected into SVG, depth ordering and face shading;
  selected effects use WebGL. It does not require a Three.js scene for each figure.
- [Hairline documentation](https://hairline.lucasmarkes.com/docs) and
  [create skill](https://github.com/lucasmarkes/hairline/tree/main/skills/hairline-create):
  lightweight SVG figures with a reusable projection/solid engine, restrained line
  hierarchy and shared themes. Do not infer copying between the authors from style
  similarity; no provenance comparison was performed.
- [Blender Lab MCP](https://www.blender.org/lab/mcp-server/): official experimental
  project. Distinguish its canonical source from community forks, including the
  modified bpy-dev distribution. Installed Blender is 5.2.2 LTS; no MCP connection
  is currently configured or required for the proposed first SVG trial.

Both figure resources are substantive: public implementations, examples and
methodology exist. That is not proof that they produce good Postdot imagery without
art direction. Hairline is the better small-scale restraint reference; Anatomy
is useful for solid construction and depth. Its mandatory minimum of forty parts
and long mechanical audits should not become our marketing-art default.

## Recommended pipeline

Construct the scene in coherent coordinates, then choose its delivery format.
SVG is a projection target, not an obligation to manually draw arbitrary paths.

1. Define one recognizable scene and one purpose in plain language. Separate
   illustrative metaphor from literal product capability. No false dashboards,
   tiny invented copy, stacked feature cards or arbitrary floating slabs.
2. Choose a simple object vocabulary and draw a composition silhouette. Validate
   the object and framing with the owner before adding mechanical detail.
3. Lock one camera and one scale. Initial trial: orthographic, corner view,
   45-degree azimuth and roughly 35-degree elevation. Keep parallel edges parallel.
   This is a proposed preset; do not silently approve it as the brand camera.
4. Define a reusable style sheet: neutral face tones, a single blue accent,
   silhouette/structural/detail stroke levels and one light direction. Test on
   accepted light/dark page surfaces; fills must hide rear geometry correctly.
5. Build geometry from reusable solids and world coordinates. Resolve depth
   before export; do not repair occlusion with arbitrary hand-tuned path offsets.
   For a modest fixed-view scene, emit SVG at build time and keep its source model.
6. Approve a still at real display size before animating. Judge silhouette, faces,
   spacing, occlusion, stroke scale and recognizability at mobile/desktop size.
   Detail must belong to the scene; do not add screws to meet a numerical quota.
7. Add at most one meaningful movement, preserving the useful rest pose. Optional
   interactivity must work on touch/keyboard; reduced motion and offscreen pauses
   remain required. Never turn a passive illustration into a pretend control.
8. Deliver the SVG, editable scene source, palette/camera settings and thumbnail.
   Record actual compressed size/path count and runtime needs on the pilot,
   rather than promising that all SVGs are lightweight.

## When Blender helps

Use Blender for complex rounded forms, dependable occlusion, orthographic camera,
line/edge rendering and controlled lighting. It is a production tool, not a browser
runtime dependency. A .blend scene can deliver static image assets without shipping
Three.js. Clean SVG line export requires a deliberate pipeline; not every shaded
Blender render can be losslessly exported as a compact vector. Choose vector or
raster on purpose; avoid a giant embedded raster pretending to be SVG.

Reserve browser 3D for interaction that genuinely requires spatial rotation or
changing viewpoints. Do not adopt it merely because the source illustration was
modeled in 3D. No renderer dependency or animation policy is accepted here.

## First trial proposal

One compact physical preparation desk: a document, organized trays and a small
publishing control, with a recognizable composition rather than a fake interface.
The scene is a candidate to discuss, not a new homepage section or imposed metaphor.
First deliverable is a refined still in both themes, not an animated assembly line.
Use it to test the method, including whether this object vocabulary feels right
for Postdot. Only a successful pilot should become a reusable design-system skill.

Do not claim that an illustration system removes the need for per-scene judgment.
Consistent camera, materials and construction reduce drift; they do not choose a
meaningful subject or guarantee visual quality.
