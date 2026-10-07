# ADR-082 — Custom-Channel Creation Fingerprints and Feedback

- Status: proposed (awaits owner acceptance with UX-332)
- Scope: creating a channel with a custom profile definition
- Related: ADR-080 (draft fingerprints), ADR-081 (draft validation feedback), UX-331, UX-332
- Supersedes nothing; amends no existing decision until accepted

## Context

UX-331 demonstrated that custom-channel creation still required operators to
author technical fingerprints by hand: the HTTP body demanded `profileHash`
and `schemaHash`, the store kept them verbatim (arbitrary strings accepted),
and editing a reused template schema without inventing new hashes blocked the
second channel with a global cache collision and generic copy. The same
surface returned joined diagnostic messages (echoing submitted values) behind
a generic page banner, while draft editing already named fields with
localized corrections under ADR-081. The shipped `custom-manual` and
`custom-webhook` starters also lacked the required JSON Schema dialect, so the
default custom creation failed before the operator changed anything.

The owner direction for UX-332 retains the existing identity contract:
declared profile `id` and `version` are preserved, sharing one profile `id`
across channels stays possible, and no fresh identity is minted per channel.
A high declared version or a shared identifier alone is not a defect; the
defect was manual fingerprint management without assistance. ADR-081 was
scoped to draft editing, so the creation gap is recorded as an ergonomic
inconsistency with that contract, not as a past violation of it.

## Decision (proposed)

Derive both fingerprints on the server when a custom profile is created,
reusing the existing `fingerprintChannelProfile` derivation and canonical
representation from ADR-080 (sorted object keys, declared array order,
SHA-256 hex with `sha256:` prefix, schema hash before provider preparation,
complete hash excluding only itself). Normalization runs before compilation
and persistence so both observe derived values:

- The creation input keeps declared `id`, `version >= 1` and
  `origin: 'custom'` as required fields with their existing rules; they are
  preserved verbatim and never incremented or pinned at creation.
- `profileHash` and `schemaHash` become omissible. Supplied values (legacy
  symbolic, arbitrary, or correct digests) are accepted for compatibility and
  always replaced by the derived digests.
- Built-in profiles (preset literals and the default manual profile) are not
  normalized and keep their packaged values. No stored profile is rewritten.
- The compiler collision guard is unchanged; with derived fingerprints, an
  altered-schema reuse derives a different key and succeeds, while a
  genuinely inconsistent cache identity still fails as before.

Fix the shipped `custom-manual` and `custom-webhook` starters to declare the
required `https://json-schema.org/draft/2020-12/schema` dialect. Built-in
provider presets remain provider-owned and are untouched.

Project creation definition failures through the same `ChannelProfileValidationError`
boundary as drafts and return the ADR-081 safe projection on the creation
route: recognized codes only, bounded JSON Pointer paths, at most 20 issues
with an explicit `issueCount`, no raw messages and no submitted values. The
Elysia shape boundary is unchanged: absent required keys stay `422
validation_error`; only fingerprint omission is newly permitted. The creation
dialog renders the same per-field localized corrections beside the JSON,
preserves the typed text after refusal, clears stale diagnostics on edit, and
is the single signal for definition errors (no duplicate page banner, which
is kept for generic, access, and other failures).

## Alternatives considered

- Minting a fresh profile identity per new channel would end identifier
  sharing, contradicting the retained contract; rejected.
- Channel-scoping the compiler cache would hide genuine immutability
  conflicts instead of deriving correct keys; rejected.
- Keeping caller-owned fingerprints with written guidance leaves correctness
  in operator hands, the outcome UX-328 already rejected for drafts;
  rejected for the same reason.
- A creation-specific feedback shape would duplicate ADR-081; reusing the
  existing projection and client copy is narrower.

## Consequences

- New custom channels store derived `sha256:<hex>` fingerprints; legacy
  clients sending complete definitions keep working with replaced values.
- Template reuse (identical or schema-altered) succeeds with correct
  fingerprints; the starter works as shipped.
- Definition refusals create no channel or profile state and show field
  corrections in the creation dialog in English and French.
- Explicit activation, historical definitions, execution contracts,
  authorization, transactions, built-in behavior, and the `422`/`400`
  shape/content split are unchanged. No migration, automatic adoption,
  dependency, or service is added.

## Evidence

See [UX-331 diagnostic](../worklogs/2026-10-07-UX-331.md) and
[UX-332 implementation](../worklogs/2026-10-07-UX-332.md).
