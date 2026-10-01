# UX-250 — Direct conflict resolution access

Status: Scoped pass complete; UX-250 remains in progress

Continue the recorded conflict finding. Incoming server updates with a mismatched source revision set the editor to conflict but displayed a generic background-update message. The resolution block opens inside Technical details, below the content; a narrow first frame could show an alert without a visible way to reach its actions.

Changes: incoming source conflicts now use the existing localized revision-specific warning, naming draft/current revisions and the need to rebase. Ordinary updates retain the polite background notice. The local-change branch is unchanged and continues to preserve current edits. Conflict notices gain one explicit resolution action using the existing localized reconciliation label. It opens Technical details, focuses its summary and scrolls it into view without animation. It does not rebase, reload, restore or dispatch automatically. The native details/ref boundary retains normal keyboard behavior and reduced-motion safety.

Files: publication-editor.tsx, publication-editor-status.tsx and publication-detail-actions.spec.ts. The existing simulated mobile source-conflict journey now asserts the specific warning, absence of the misleading latest-server message, the alert role, and focus transfer after the explicit resolution action. Existing lifecycle and media assertions remain intact.

Full validation passed with exit zero using the bundled Node 24 runtime; evidence: /tmp/herald-ux250-conflict-access-check.log. Development API/web remain active on 3002/5173; validation uses isolated fixtures and ports. Previously refused live-browser access was not bypassed.

Remaining: UX-250 remains in progress for connected destination customization and preservation of separate local recovery/current edit copies before replacement. This pass improves conflict discoverability without redefining storage or revision ownership. No AGENT.md update: accepted hierarchy and explicit interaction intent already cover it.

Final verification: 44 primary browser journeys passed (8.5 minutes), 2 additional recovery checks passed (11.2 seconds), alongside formatting, lint, spelling, types, unit tests and production builds. Inspected the mobile source-conflict capture after the resolution action: the summary is focused, both resolution controls precede source comparisons, and no horizontal overflow appears. Development API readiness and web HTTP 200 remain healthy after validation.
