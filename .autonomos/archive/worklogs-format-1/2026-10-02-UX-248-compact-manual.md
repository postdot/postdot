# UX-248 — Compact manual and custom media

## Correction

The owner identified the same oversized vertical gallery in Canal manuel after
DEV.to was corrected. Apply the accepted compact media pattern to generic manual
and custom channels too: two columns for multiple images, 112px cells, and a
single image bounded to 176px with its proportions preserved. Keep image order,
all attachments, and normal page flow. No internal preview scrolling.

This supersedes the manual/custom vertical mode recorded in the earlier media
pass. Changes are confined to publication-draft-preview.tsx and its browser
regression. Other destination-specific mosaics remain unchanged.

## Verification

The new four-image journey covers the single-image bound, two-column grid,
maximum 240px gallery height, no internal overflow and no page overflow at
1280px and 390px. Desktop preview precedes delivery; mobile preview follows the
publication controls by the accepted mobile layout. Initial test incorrectly
expected desktop ordering on mobile; correct the assertion to the actual layout.
Fresh desktop and mobile captures inspected. Full repository gate passed:
52 browser journeys, 2 password-reset journeys and 17 successful build/check tasks.

## Continuation

UX-248 remains in progress. Proceed with the approved Discord spoiler pass.
No AGENT.md or accepted design contract changed.
