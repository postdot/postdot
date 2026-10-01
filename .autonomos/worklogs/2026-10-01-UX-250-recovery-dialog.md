# UX-250 — Explicit composition recovery decision

Status: Scoped pass complete; UX-250 remains in progress

The owner reported that previous composition recovery looked like a timid notification although the rest of the composer was blocked. Requested a dialog to make the required decision obvious. This applies to new-publication recovery, not replacement of an existing publication's recovery snapshot.

Replaced the inline banner with the existing shared modal Dialog. It has the previous-draft title, a concise localized decision prompt, an excerpt, and the existing Discard/Restore actions. No close control, Escape or outside dismissal can bypass the required decision; the controlled dialog stays open until an existing recovery handler resolves it. The underlying form remains inert. Errors while discarding are now visible inside the dialog; ordinary form errors remain outside after recovery resolves. Existing server/local draft persistence and recovery handlers are unchanged.

Files: new-publication-page.tsx, English/French message catalogs, and design-121-narrow-new-publication.spec.ts. The existing interrupted-composition journey asserts dialog role and accessible name, verifies Escape cannot bypass the decision, then restores at mobile width and discards a later composition. The old visible-background assertion was replaced because modal accessibility correctly hides its background. Form inert and content preservation assertions remain intact.

Full validation passed with exit zero using bundled Node 24; evidence: /tmp/herald-recovery-dialog-final-check.log. Development services remain running. Live-browser access was previously refused; no workaround was attempted. No AGENT.md update: this implements the owner's explicit modal requirement with existing primitives.

Remaining: separate recovery/current-edit preservation for existing publication detail and additional connected-destination states remain in UX-250. This pass does not silently change their storage contract.

Final gate: formatting, lint, spelling, types, unit tests, 44 primary browser journeys, 2 additional recovery checks and production builds passed. The interrupted-composition journey passed the dialog name/role, Escape blocking, restoration and discard outcomes at narrow width. An initially broad test replacement also affected an unrelated workspace assertion; type checks caught it and that original assertion was restored before the final gate. No checks were weakened.

Promoted the owner-directed modal recovery contract to DESIGN.md under composer interaction: required decision, preserved excerpt, inert background, explicit outcomes and errors visible inside the decision. AGENT.md remains unchanged because this is product interaction guidance.
