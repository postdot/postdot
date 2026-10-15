# Studio screenshot tour

SITE-452 replaces the separate Planning section with three existing screenshot
views in the hero: Compose, Queue and Calendar. This is a reviewable presentation,
not an interactive Studio embedded in the public page.

## Behavior

- Desktop with adequate viewport height: a CSS sticky figure sits within a short
  184svh region. Native scroll selects one of three equal progress intervals.
  No wheel/touch cancellation, scroll lock or automatic timer is added.
- Three native buttons select views and move to the corresponding scroll interval.
  Focus remains on the button. Skip tour links directly to the following network
  rail. Reversing scroll reverses the view selection.
- At <=900px width, <700px height, or reduced motion: no sticky region or added
  scroll distance. A native horizontal snap strip supports gestures and the same
  buttons. Reduced motion selects instantly and disables fades.
- Each view has one concise sentence. No extra heading section replaces Planning.
  Navigation now targets #studio-tour instead of the removed #planning section.

## Stability and budget

Images share 1440x1000 geometry. Layer opacity changes, not frame position or size.
Caption dimensions are reserved and its neutral surface protects contrast over
animated material. Only Compose is high priority; other existing WebP views load
lazily. The material shader retains fixed-size grain and caps canvas resolution
in both dimensions, avoiding a tall full-resolution canvas for the extended hero.

The existing screenshot assets remain examples, not current customer data. Future
changes must preserve three views maximum and the ability to bypass the sequence.
