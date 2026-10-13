# Contributing to Postbot

This document defines the working agreement for changes to Postbot.

## Contribution licensing

By submitting an original contribution for inclusion in Postbot, you agree to
license it under AGPL-3.0-only. You retain copyright in your contribution; no
copyright transfer or commercial relicensing permission is requested. Submit only
work you have the right to license, and preserve the licenses and attribution of
third-party material. Identify such material explicitly in the contribution.

Postbot currently has no commercial dual-license program. Any future proposal
requires a separate decision and sufficient rights from the relevant copyright
holders; this contribution policy does not grant those rights automatically.

## Before Starting

- Read `AGENT.md`, `.autonomos/PROTOCOL.md`, and `.autonomos/TASKS.md`.
- Check the current official documentation and package releases for the technology
  involved, especially for beta dependencies.
- Search the installed project skills and add a focused skill when it materially
  improves the task.

## Repository Hygiene

- Treat conversational context, personal details, and one-off analysis as private by
  default; do not commit them unless they are deliberately converted into durable,
  public-ready project guidance.
- Keep competitor comparisons and market research outside operational documentation
  unless the project explicitly scopes and approves a public research artifact.
- Do not commit temporary review documents, external evaluation prompts, or scratch
  files created for a single decision.

## Branches

Keep `main` releasable and use short-lived branches with an intent prefix:

```text
feat/publications
fix/scheduler-recovery
chore/tooling-update
docs/contributing
```

Do not combine unrelated work in the same branch.

## Commits

Commits must follow Conventional Commits:

```text
<type>(<optional scope>): <imperative summary>
```

Use a concise subject that explains the necessary change. Add a body only when the
reason, trade-off, or migration detail would otherwise be lost.

Common types include `feat`, `fix`, `refactor`, `docs`, `test`, `build`, `ci`, and
`chore`.

Each commit should be focused, buildable when practical, and free of unrelated
formatting or cleanup. The local commit hook runs the repository checks and validates
the commit message.

## Pull Requests

Open a pull request when a change is ready for review. A pull request should:

- explain the problem and the chosen solution;
- link the relevant issue or task when one exists;
- call out intentional scope and known limitations;
- include validation commands and their results;
- include screenshots or a short recording for visible UI changes;
- keep the diff small enough to review confidently.

Reviewers should verify behavior, boundaries, tests, documentation, and whether the
change introduces complexity beyond the current MVP needs.

## Issues

Use issues for reproducible bugs, accepted proposals, and questions that need triage.
Record evidence and desired outcomes before prescribing an implementation. Use the
Autonomos `/issue` workflow when an issue needs structured triage.

## Merge and Cleanup

After approval and green CI, merge using the hosting repository's configured policy.
Prefer a clean history of focused commits; use squash merge when the review branch
contains exploratory commits that do not carry useful history. Delete merged branches
and confirm the local worktree is clean.
