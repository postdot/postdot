# UX-248 — Destination media and accessibility

## Changes

Preserve the source attachment description in new-publication previews. Add an
optional image alternative to the shared media renderer; decorative library
thumbnails retain their existing empty alternative. In publication detail,
resolve attachments through the profile's ordered-media bindings instead of
unconditionally rendering source attachments. Destination order and descriptions
now take priority. Missing descriptions use the asset's default description,
matching publication media resolution; filenames are not invented descriptions.
An empty destination list stays empty.

The locked-detail asset lookup now uses destination references too, so target-only
images can be loaded. Partial raw target edits are tolerated without crashing.
No content, delivery, storage, or API contract changed. No visible explanatory
copy or extra surface was added.

## Verification

Nine target-media unit tests passed, including nested custom binding paths,
destination descriptions/order, absent or empty lists, and malformed raw entries.
The focused browser journey passed on isolated services: four uploaded images
retain compact desktop/mobile layout and a seeded default alternative; a real
draft is then adapted to one different image and description, then no images.
Both detail transitions render the destination selection correctly.

Full repository gate passed: 51 browser journeys, 2 password-reset journeys
and 17 successful build/check tasks.

## Continuation

UX-248 remains in progress. Review accessibility editing in the compact composer
and remaining platform formatting. Link-card work remains deferred by the owner.
No AGENT.md or accepted design contract was changed.
