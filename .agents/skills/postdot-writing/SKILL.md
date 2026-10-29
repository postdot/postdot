---
name: postdot-writing
description: Draft, edit or review Postdot documentation and authored API explanations. Use for reader goals, wording, page hierarchy and documentation media choices; not routine chat replies, worklogs or generated endpoint files.
---

# Postdot writing

This is a small, evolving project layer. It does not establish a finished brand
voice. Extend it from owner feedback and observed writing problems, not imagined
preferences or a growing list of forbidden words.

## Use the existing skills

Read [documentation-writer](../documentation-writer/SKILL.md) to distinguish a
lesson, task guide, explanation and reference. Read
[stop-slop](../stop-slop/SKILL.md) when drafting or revising prose; load its detailed
references only for patterns relevant to the passage.

Use the task context to identify the reader and outcome. The owner's standing
authorization for bounded autonomous work takes precedence over upstream requests
to ask questions or await outline approval each time. Ask only when a consequential
missing choice remains. Research authorization already given by the owner remains
valid; verify claims against code and authoritative sources.

## Make the page useful

- Choose the reader's job before choosing headings. A community manager using
  Studio needs a different explanation from an operator restoring an instance.
- Keep technical names, field labels, prerequisites and effect boundaries exact.
  “Human” writing must not blur who acts, what permission is needed or what sends
  a publication. Software can be the real actor. Keep a necessary qualifier even
  when a general prose heuristic would remove it.
- Give the next useful action and its observable result. Use examples that match
  implemented commands and fields. Distinguish code inspection from live success.
- Keep the accepted Guides / Self-hosting / Development / API reference navigation.
  Diátaxis describes page purposes; it does not replace those audience spaces.
- Start directly. Remove promotional openings, mechanical contrasts, repeated
  reassurance and conclusions that restate the page. No section eyebrows or
  decorative Unicode arrows. Personality should come from concrete choices,
  helpful examples and natural phrasing, not jokes or forced informality.
- Match length to the task. A short page can be complete; operational detail can
  deserve space. Do not give every page an identical outline or a word quota.

For a new presentation pattern, read the small
[reference comparison](references/documentation-patterns.md). Its observations are
candidates, not owner-approved requirements. For MDX, components or layout work,
use [postdot-fumadocs](../postdot-fumadocs/SKILL.md).

Before delivering, read the passage as the intended reader: can they find the
answer, act without guessing and tell what happened? Cut repeated information;
retain the facts needed to do the task. A prose score is not evidence of quality.

## Accepted calibration

Public npm READMEs serve package users discovering the integration. Explain installation, credentials, supported operations and a first successful result. Keep monorepo boundaries, lint exceptions, CI secrets and release procedures in maintainer guidance, outside that README (owner correction, 2026-10-29).

The owner reviewed the SITE-462 first-publication, Bluesky and concepts pages
and found their tone and explanation level coherent and well calibrated. Use
that level of directness and detail as a baseline, not a fixed page template.

Do not use blockquotes as a generic container for notes or example prompts.
Reserve them for quotations. Inspect native Fumadocs components for labelled
examples, consequential notes, choices and sequences; presentation is part of
writing quality. Keep ordinary prose where a component adds no reading value.
Break long passages at useful task boundaries; use native Steps for a sequential
lesson and navigation icons as landmarks, without decorating every paragraph.

## Evolve without accumulating clutter

When the owner gives a correction, capture its scope and one short example in this
skill or a relevant reference. Replace superseded guidance. Keep page-specific
findings in the task worklog. Proposed wording stays provisional until reviewed;
do not treat the last AI draft as an accepted example merely because it exists.
