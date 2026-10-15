# Studio screenshot tour

SITE-453 supersedes the initial SITE-452 navigation. Three existing screenshots
stay in the hero: Compose, Queue and Calendar. This is a presentation, not an
interactive Studio embedded in the public page.

## Behavior

- Desktop: native scroll through a 200svh region selects three complete slides.
  Each composition includes a centered heading, short description and screenshot.
  The composition is centered in the available viewport below the header.
- The first caption starts hidden and enters after 6% progress. Queue starts at
  38%, Calendar at 70%. Reverse scrolling reverses the sequence.
- Caption height is reserved at 112px. All screenshots retain identical geometry.
  Transitions combine a directional vertical movement, focus and opacity; no
  layout dimension is animated. There are no tabs or Skip tour link.
- At <=900px width, <700px height, or reduced motion, all three screenshots appear
  in normal vertical flow. The first caption remains omitted because the hero
  already introduces it. No gestures or controls are needed to discover content.
- No wheel interception, scroll lock or automatic timer. Visitors can always
  scroll past the sequence. The footer links to #studio-tour.

## Stability and budget

Images share 1440x1000 geometry. Only Compose is high priority; other existing
WebP views load lazily. The material shader retains fixed-size grain and caps
canvas resolution in both dimensions. Existing screenshot assets remain example
projects, not customer data. Keep three views maximum.
