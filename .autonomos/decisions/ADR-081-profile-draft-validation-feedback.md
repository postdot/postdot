# ADR-081 — Profile Draft Validation Feedback

- Status: accepted (owner approval of UX-330 on 2026-10-07)
- Scope: structural safety in compilation and profile-draft save feedback
- Related: ADR-080, UX-329 and UX-330

## Decision

Check definition structure before accessing nested typed fields. Return normalized
validation issues for malformed objects, arrays and primitive fields; preserve the
existing semantic validators and all save/activation/concurrency rules. Validate
prepared runtime profiles too, preserving module attribution.

Preserve normalized issues in a typed domain failure across persistence. Normalize
schema-policy paths where they originate so all profile compiler issues address
the complete definition. Do not parse joined diagnostic messages to reconstruct
field identity.

The profile-draft route alone returns a fixed summary plus optional structured
issues and issueCount. Expose only recognized local codes and valid bounded JSON
Pointers; suppress raw diagnostic messages, submitted values and internal/module
paths. Unsupported detail uses a fixed general code. Return at most 20 issues and
at most 512 characters per path; issueCount makes omission explicit. These are
presentation limits, not a relaxation of validation or permission policy.

The profile dialog uses fixed localized messages selected by code, preserves the
JSON and saved revision on rejection, and replaces the generic failure with one
field-oriented summary. Editing clears stale diagnostics. Unknown codes remain a
safe general error. Access, authentication, internal failure and stale-revision
handling retain their existing contracts.

## Alternatives and limits

Rendering existing joined messages would disclose arbitrary interpolated or
exception text, lose reliable field addressing and prevent proper localization.
A web-only structural validator leaves API clients exposed to the same crashes.
A global structured-exception renderer unnecessarily widens this bounded contract.

Other authoring routes, generated forms, automatic corrections, migrations and
activation behavior are outside this decision. Additional code mappings must
remain fixed, locally owned and covered by their validator rather than accepting
raw provider messages as UI copy.

## Evidence

See [UX-329 diagnostic](../worklogs/2026-10-07-UX-329.md) and
[UX-330 implementation](../worklogs/2026-10-07-UX-330.md).
