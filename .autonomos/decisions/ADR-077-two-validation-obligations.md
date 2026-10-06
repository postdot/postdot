# ADR-077 — Two validation obligations: local commit and full validation

- Status: accepted
- Date: 2026-10-05
- Accepted by: owner, explicitly, on 2026-10-05
- Scope: repository validation policy for local agent work
- Provenance: AUDIT-317 and its selector work, SSE-318 and its final full control
- Related decisions: ADR-076
- Applies to: `AGENT.md`, on owner approval only

Applied on owner approval. `AGENT.md` now carries the two obligations, and the
selector distinguishes a documentation-only change set from a code change set so an
ordinary worklog no longer forces the matrix on its own.

## Context

`AGENT.md` currently names one obligation: run the full `bun run check`. Because
it names no other validation step, it reads as "after every pass", and the
measured cost of that reading is the whole E2E matrix on every commit.

AUDIT-317 measured the repository's validation layers: pre-commit hook ~5 s warm,
all unit tests ~11 s cold for 17 packages, one E2E scenario ~25 s including
harness startup, a forced web build ~3 s, and the full 84-scenario matrix at
18–29 min across four green runs. The cost is concentrated in the matrix, not in
the harness and not in the unit tests. That measurement produced a selector
(`scripts/e2e-affected.ts`) that reports the scenarios a change set can affect and
falls back to the full matrix whenever a path is unknown or transversal, without
being wired into any gate.

SSE-318 then showed a change that moves shared transport belongs to the full
control, and also showed that a documentation-only change does not: no scenario
observes Markdown. The policy has to distinguish those, or it pays 20 minutes for
a sentence.

Two constraints shape the wording:

- Merging into local `main` must **not** be an automatic trigger. In this
  workflow that would re-impose the full suite on every commit and defeat the
  purpose of having a cheaper validated step at all.
- A flake is a signal to investigate, not a standing instruction to re-run
  everything.

## Decision

Two distinct obligations, stated separately, with neither implied by the other.

### 1. Local commit obligation

A commit is a self-consistent checkpoint on a working branch. It requires:

- `bun run check:quick` — format, lint, typecheck (the pre-commit hook already
  enforces this, so a commit cannot bypass it);
- `bun run test:unit` — **every** unit test in every package, not a filtered
  subset. At ~11 s cold it is the cheapest layer in the repository, and scoping
  it by package would trade a real cross-package guarantee for seconds;
- the E2E scenarios reported by
  `bun scripts/e2e-affected.ts --base <mission base>`, or the full matrix when
  the selector reports one. When the selector retains the password-reset
  scenario, `bun run test:e2e:password-reset` runs as a separate command,
  because it is a separate harness;
- `bun run build --filter=<touched packages>` when runtime code changed, and the
  full `bun run build` when the selector reports a transversal path.

The mission base is recorded before the first edit
(`git rev-parse HEAD | tee .git/herald-mission-base`) and passed explicitly, so
the comparison is reproducible. Uncommitted work counts: the selector unions
committed, staged, unstaged, and untracked paths.

### 2. Full validation obligation

A full validation is an authoritative statement about a repository state. It is
`bun run check`, plus `bun run test:container:recovery` when container behaviour
is involved. Its triggers are:

1. **Closing a coherent set of passes** — a mission or a group of related
   missions whose combined result is the thing being asserted, not each
   individual commit inside it.
2. **Before publication** — before pushing, tagging, or otherwise making a state
   visible outside the working copy.
3. **A risky transversal change** — anything the selector itself reports as
   transversal or unmapped, and specifically: `packages/db`, `packages/core`,
   `packages/client`, `packages/email`, the API composition root or entry point,
   shared dashboard transport or context, dependency or lockfile changes,
   harness or CI configuration, and the commit gate itself.
4. **A security- or authority-bearing change** — authentication, sessions,
   authorization, access revocation, and publisher credential protocol packages.
5. **A claim the targeted layer cannot support** — cross-spec interference, a
   shared-runtime ordering assumption, or any invariant only the whole matrix
   observes.
6. **A retained selection that is not materially cheaper** — more than half the
   matrix, or more than ten minutes of expected runtime. At that point the
   targeted layer is the full control under a slower name.

Merging into local `main` is deliberately **absent** from this list.

### Not required for a local commit

- **Documentation-only changes.** Markdown, Autonomos records, and code comments
  are observed by no scenario. They need `check:quick` and, when a script changed,
  that script's own tests. Replaying the matrix for them is cost without signal.
- **A flake alone.** See below.

### Flakes

A failing scenario starts a targeted investigation: reproduce it standalone,
identify the cause, and prove the fix or the absence of a cause. A new full
control is required only when the investigation justifies it — the fix touches
shared transport or a transversal path, the cause is unknown after the
investigation, the fix removes or weakens an assertion, or the flake recurs in a
context only the full matrix reproduces. A flake with a demonstrated cause and a
targeted proof does not, by itself, require the full control.

### Tracing the last fully validated state

The newest commit that passed a full control lives on a `validated/*` ref, and
the same SHA appears in the task entry and the session worklog. Any commit newer
than that ref is locally validated only, and saying so is part of reporting.

### Trace

**Correction.** An earlier version of this record said `9c1c669f9` and the commits
after it were documentation-only. That was wrong. Measured from the commits
themselves:

| Commit | Files | Level actually validated | Selector verdict for that change set |
| ------ | ----- | ------------------------ | ------------------------------------- |
| `d70108840` | worklog, task board, corrections to three historical worklogs | **fully validated** — `bun run check` green: 84 E2E in 19.4 min, 2 password-reset in 10.6 s, 256 API / 129 web / 168 db / 92 core / 45 script unit tests, build, format, lint, typecheck | not applicable: this is the reference state |
| `9c1c669f9` | one worklog | documentation checks only | documentation only |
| `15e7c9475` | task board, this record, two worklogs | documentation checks only | documentation only |
| `1b3b80871` | `cspell.json`, `e2e/web-314-editor-access-state.spec.ts`, two Autonomos files | **code and test change**, targeted: the spec run twice | full matrix — `e2e/**` is transversal |
| `a31d2c792` | task board | documentation checks only | documentation only |
| `56429fb48` | `cspell.json`, `e2e/web-314-editor-access-state.spec.ts`, two Autonomos files | **code and test change**, targeted | full matrix |
| `0259edf56` | `e2e/web-314-editor-access-state.spec.ts`, two Autonomos files | **code and test change**, targeted | full matrix |
| `be1a070fe` | two spec comment blocks, task board, one worklog | **comment change in test files**, targeted | full matrix |

Two things follow, and both are recorded rather than smoothed over.

First, `d70108840` was the last fully validated commit until this mission ran the full
control required by trigger 3 for its own change set. On `4e89b3c0d`,
`bun run check` was green: 84 E2E scenarios in 18.8 min, 2 password-reset in
10.4 s, 51 script tests, and the full set of package unit tests, build, format,
lint, typecheck, with zero failures and zero flakes. So `4e89b3c0d` became the
newest fully validated commit at that point, and it held the position until the
UX-298 mission, whose change set also included the selector correction: on
`2c238e9d8` the full control was green again — 84 E2E in 18.7 min, 2 password-reset
in 10.0 s, 55 script tests, zero failures and zero flakes — so `validated/full`
now points there. The four WEB-314 commits between `d70108840` and `4e89b3c0d`
remain locally validated only, carrying code or test changes rather than
documentation.

Second, there is a real divergence: the selector reports the **full matrix** for
the four WEB-314 commits because `e2e/**` is transversal, while the work actually
performed was a targeted spec run. That divergence was approved pass by pass at the
time. It is exactly the kind of mismatch this record's measurement phase exists to
surface, and it is the first thing the five missions should quantify.

## Consequences

- A commit on a narrow change costs seconds plus the affected scenarios, usually
  1–4 minutes, instead of 18–29 minutes.
- The selector reports a large selection when a change genuinely overlaps several
  domains, and that is information rather than a reason to bypass it.
- A risk of this policy is that a small transversal change slips through because
  it looked small. It is mitigated by the selector returning the full matrix for
  exactly that case, and by trigger 3 being written as a property of the change
  rather than of the mission.
- A second risk is that "targeted" becomes a habit of skipping. The rule states
  that a targeted run may never be widened to make a failure disappear, and the
  selector may never be edited to hide a path.

## Alternatives considered

- **Keep the full check as the only rule.** Rejected: measured at 18–29 min per
  commit, and it made no distinction between a sentence and a transport change.
- **Trigger the full control on merge to `main`.** Rejected as automatic: in a
  workflow where missions merge one at a time, it is indistinguishable from
  running it on every commit, which is the cost this record exists to remove.
  Merging can still be a human decision to close a set of passes.
- **Scope unit tests by changed package.** Rejected: ~11 s buys cross-package
  coverage, and AUDIT-317 already showed cross-package cache invalidation is
  correct but invisible — a package-filtered run would not notice a regression in
  that behaviour either way, while dropping real coverage for no time.
- **Wire the selector into `check`.** Rejected for now. The selector is being
  used under surveillance; automating it before its false-negative rate is known
  would turn a reporting tool into a gate.
- **Treat an Autonomos worklog as a transversal change.** Rejected, and corrected
  in the selector: `.autonomos/**` was listed as transversal, which meant an
  ordinary evidence record forced the whole matrix on its own. Documentation is now
  classified separately, and only a code path alongside it re-engages the full
  fallback.

## Out of scope

- Removing the compensating waits left in four E2E specs. That is a separate,
  small pass with its own evidence, tracked as AUDIT-319.
- Remote caching, Docker layer reuse, and any harness or worker change.
- The password-reset harness and container acceptance, whose commands are already
  separate and stay separate.
