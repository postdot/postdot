# Scenario — H-10 multi-surface consistency

Status: holdout
Scenario version: 2026-09-01
Surfaces: Calendar month overview, Queue, Compose
Reader: operator planning, reviewing, and preparing publications
Reader job: recognize the same product and its source-to-publications model
while switching between three different tasks

## Frozen inputs

- Prompt/request: keep the H-09 direction constant and make three different
  Herald jobs legible
- Data/content fixture: one source post, four destinations, four channels,
  queued/due/draft/published states
- Viewport/device: 1280 × 720, pointer
- Contract under test: Cobalt instrument + neutral surface-led grammar

## Rubric

Hard gates:

- [x] The product category and primary task remain legible on each surface.
- [x] The source-to-publications relationship remains visible without relying
  on the lab notes.

Observable criteria:

- [x] Calendar supports overview without becoming a generic calendar.
- [x] Queue supports prioritization without becoming an arbitrary metrics list.
- [x] Compose supports source editing while preserving destination differences.
- [x] The three surfaces share a visual identity without using the same layout
  or the same density everywhere.
- [x] The contextual right surface has a concrete job on each view.

## Runs

| Run | Contract | Render | Result | Corrections |
| --- | --- | --- | --- | --- |
| 2026-09-01 / H-10 | H-09 candidate | local browser, 1280 × 720 | pending owner review | inspect all three surfaces |
| 2026-09-01 / H-10 owner review | H-09 candidate | local browser, 1280 × 720, dark/light | holdout accepted for cross-surface identity | preserve task-dependent composition; validate production shell separately |
