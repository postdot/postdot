# ADR-013 — Support Runtime-Defined Custom Channel Contracts

- Status: accepted
- Scope: Custom channel schemas, capabilities, transport mappings, and delivery modes
- Provenance: Owner review of DOMAIN-07 on 2026-08-29
- Related specifications: [SPEC-004](../specs/SPEC-004-publication-content-boundary.md), [SPEC-005](../specs/SPEC-005-continuous-product-scope.md)
- Superseded by: none

## Context

Postbot's primary purpose is publication management for social and adjacent
publishing platforms. The built-in provider set cannot cover every regional,
niche, private, or project-specific destination. A custom channel must therefore
be able to represent a destination whose content shape is not known when Postbot is
built.

Presets remain useful as creation accelerators, but a closed preset catalogue would
make unsupported destinations impossible to model. At the same time, accepting
arbitrary executable code in a channel record would make validation, security,
testing, and reproducibility unsafe.

## Decision

Postbot supports custom channels with a complete runtime-defined target-content
schema. Built-in providers and custom channels use the same persisted target-content
and capability protocol:

- built-in providers may define schemas and validators statically in code with
  TypeBox;
- custom channels store a validated, versioned, bounded runtime schema;
- presets provide an editable initial schema, capability profile, and transport
  mapping rather than a closed channel type;
- the resolved profile is versioned so later edits do not reinterpret historical
  publication revisions;
- the runtime schema describes data and validation only; it cannot execute scripts;
- automatic delivery uses a bounded declarative HTTP mapping for request construction,
  media delivery, response identity, idempotency, and error classification;
- APIs that need provider-specific code, complex OAuth, signatures, or multi-step
  media processing require a separately governed connector;
- a publication explicitly chooses manual or automatic delivery, independently of
  whether a channel connection is currently available.

Custom channel configuration and credentials remain separate. A channel describes
the destination contract, while a connection supplies endpoint-specific access
material. A manual publication can use the channel contract without requiring a
working connection.

## Alternatives considered

- **Closed presets only:** simpler to implement, but cannot cover destinations whose
  content shape does not match an existing preset.
- **Opaque provider payloads:** flexible at first, but loses common validation,
  editor assistance, migration visibility, and safe API contracts.
- **User-provided executable scripts:** expressive, but creates an unsafe plugin
  host inside persisted project data and weakens reproducibility and resource
  controls.
- **A specialized database model for every provider:** preserves static types but
  duplicates the publication lifecycle and makes custom destinations impossible
  without schema changes.

## Consequences

- Custom destinations can be created without shipping a new Postbot release.
- Built-in provider code retains strong static typing and can implement complex
  protocols without weakening the custom-channel boundary.
- Runtime validation and request mapping require explicit size, depth, reference,
  transformation, and resource limits.
- Channel schema changes must preserve old profile versions and surface affected
  drafts or scheduled work for explicit review or migration.
- A runtime schema alone cannot guarantee that an unknown remote API accepts a
  request; automatic failures remain observable delivery outcomes.
