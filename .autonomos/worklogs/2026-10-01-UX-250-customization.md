# UX-250 — Quiet destination customization

Status: Scoped pass complete; UX-250 remains in progress

The destination disclosure repeated Compatible on every healthy draft while source editing and delivery already communicate readiness. Its larger radius and padding also differed from the accepted compact composer controls.

Changes: healthy customization disclosures no longer show a permanent compatibility badge. Review required remains visible for incompatible review state, recorded validation issues or a JSON parsing error. The native disclosure now shares the compact surface/radius and minimum height of delivery, with a reduced-motion-safe arrow. JSON error and validation notices retain their messages and alert semantics without decorative borders. Compact advanced JSON uses a smaller inset surface; its consequence warning and complete payload editor remain available. No field, capability, validation or publication behavior changed.

Files: publication-editor-target-section.tsx, publication-target-editor.tsx and publication-detail-actions.spec.ts. The existing scheduled-detail journey checks the absence of the redundant healthy label and keyboard opening/closing of customization without losing the structured editor. Existing media and raw-payload persistence checks remain unchanged.

Final full validation passed with exit zero using bundled Node 24; evidence: /tmp/herald-ux250-customization-final-check.log. Development API/web remain running. Visual coverage remains isolated fixture evidence under the previously reported live-browser access refusal.

Remaining: UX-250 remains in progress for recovery replacement safety and additional connected destination states. Preserve the old local recovery copy separately from current edits before introducing replacement confirmation. No AGENT.md update is needed: accepted quiet-state, surface and progressive disclosure rules already cover this pass.

An initial added test selector matched both the customization summary and its nested advanced-JSON summary. Scoped it to the direct summary, stopped the exact isolated validation process tree, and reran the full gate with a separate log. Final formatting, lint, spelling, types, unit tests, 44 primary browser journeys, 2 additional recovery checks and production builds passed. Inspected the mobile failed-detail fixture: customization and delivery now have coherent compact surfaces, the healthy badge is absent, and content/actions remain readable.
