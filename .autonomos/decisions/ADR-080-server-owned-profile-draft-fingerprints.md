# ADR-080 — Server-owned Profile Draft Fingerprints

- Status: accepted (owner approval of UX-328 on 2026-10-07)
- Scope: saving newly edited channel profile drafts
- Related decisions: ADR-020, ADR-079
- Evidence: [UX-327 diagnostic](../worklogs/2026-10-07-UX-327.md)

## Context

Operators editing a saved profile schema could encounter compiler collisions
unless they manually changed the supplied schema fingerprint. The collision
could also affect an independent channel using the same profile identity and
version. Arbitrary replacement strings were accepted; a complete profile
fingerprint could remain unchanged despite an altered definition. Existing
symbolic built-in fingerprints must not be mistaken for verified content digests.

## Decision

The draft-save boundary owns metadata and derives fingerprints on the server.
The authoring definition contains the schema, bindings, capabilities, execution
configuration and any existing supported definition attributes. The web editor
exposes these fields and displays technical metadata separately as read-only.

For backward compatibility the endpoint continues accepting complete definitions.
Supplied identity and origin must still match the channel's active profile when
present; they may now be omitted. The server owns the next profile version,
record ID and optimistic record revision. Supplied schema and complete profile
fingerprints are ignored and recalculated, including when omitted. Response
shape and activation endpoints do not change.

### Deterministic representation

Normalize identity, origin and the next version before hashing. Use the existing
profile canonical JSON representation: object keys sorted by default JavaScript
string ordering, arrays in declared order, finite numbers and JSON scalar values
serialized by JSON.stringify, with cycles and non-JSON values rejected. Do not
normalize string contents, reorder arrays or drop definition attributes.

- `schemaHash`: SHA-256 of canonical `contentSchema`, before runtime-only provider
  validation preparation.
- `profileHash`: SHA-256 of the complete normalized definition, including derived
  `schemaHash`, identity, version, origin, bindings, capabilities and execution,
  excluding only the `profileHash` field itself.
- Both use lowercase hexadecimal digest values prefixed with `sha256:`.

Core defines the representation and fingerprint inputs through an injected hash
function; persistence supplies SHA-256 using the existing Bun-compatible
`node:crypto` API. No browser hashing, new dependency or production runtime is
introduced. Runtime-only validation adapters remain outside stored definitions.
Compiler schema collision checks remain intact.

### Save and preservation semantics

Saving an unchanged existing draft produces unchanged fingerprints and still
advances the record revision, preserving the existing save/audit concurrency
contract. Opening an active profile and saving a new draft still creates its next
profile version. This decision does not introduce no-op suppression.

Only the authorized draft-save operation derives new fingerprints. It does not
rewrite existing active, superseded or selected versions, built-in packaged
values, target revisions, approvals or execution snapshots. Existing mutable
profile drafts acquire derived fingerprints when explicitly saved; no background
migration is added. Explicit activation, review, adoption, approval and delivery
rules are unchanged. No schema migration is required.

## Alternatives

- Manual fingerprint instructions leave correctness and shared cache identity in
  operator hands and do not resolve the underlying authoring boundary.
- Web-only calculation leaves other API clients with the same problem.
- Retroactive fingerprint migration changes historical snapshot contracts and is
  unnecessary for new saves.

## Consequences

Clients can submit just editable definition fields or keep the legacy complete
shape. Returned metadata is authoritative. Array reordering changes fingerprints;
object-key reordering does not. Future changes to the canonical representation or
hash inputs require an explicit compatibility decision, not a silent rewrite of
stored profiles.
