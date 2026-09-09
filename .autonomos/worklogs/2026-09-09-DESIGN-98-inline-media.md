# DESIGN-98 — Inline composer media preview

- Status: implementation complete on `feat/design-98-inline-media-preview`
- Scope: keep source media inside the composer editor surface instead of rendering it as a separate form section.
- The composer now shows selected image previews above a compact media action row, with explicit remove and reorder controls.
- The action row opens the existing media library first; uploading from the device remains available from that library.
- Empty composer state is reduced to the action itself; the full media library keeps its existing explanatory and accessibility controls.
- No API, provider, persistence, or publication payload contract changed.
- Browser coverage verifies that the picker is nested in the editor and that an uploaded image is rendered there.

## Verification

- `bun run --cwd apps/web typecheck`
- `bun run --cwd apps/web test`
- targeted `publication-media.spec.ts` E2E (after the full gate)
- `git diff --check`

## Follow-up

- The broader `DESIGN-98` copy-density work remains open outside the composer.
- Provider-specific media constraints and richer editing tools remain out of scope.
