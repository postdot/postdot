# ADR-016 — Use a Bounded JSON Schema Runtime Profile

- Status: accepted
- Scope: Runtime-defined custom channel content and shared validation
- Provenance: Owner review of DOMAIN-07 on 2026-08-30
- Related specifications: [SPEC-004](../specs/SPEC-004-publication-content-boundary.md)
- Superseded by: none

## Context

Custom channels must define target-content shapes that are not known when Postbot is
built. Built-in modules still need static TypeScript inference, while the web editor,
API, CLI, and MCP need one deterministic validation result for both built-in and
runtime-defined targets.

Accepting every JSON Schema feature without a policy would expose Postbot to excessive
resource use, remote references, unsafe regular expressions, and ambiguous extension
keywords. Inventing a Postbot-only schema language would duplicate an established
standard and create a permanent parser and tooling burden.

## Decision

Postbot uses a bounded profile of JSON Schema 2020-12 for runtime-defined custom
channel content:

- built-in modules may author equivalent schemas with TypeBox and retain static
  TypeScript inference;
- custom-channel content remains `unknown` until its stored schema validates it;
- TypeBox compiles both native JSON Schema and built-in TypeBox schemas through the
  same runtime validation path;
- a resolved profile separates structural `contentSchema` from Postbot-owned
  `fieldBindings` that identify semantics such as primary text, headline, language,
  ordered media, and accessibility text;
- all validation layers return normalized issues containing a JSON Pointer location,
  stable code, message, severity, and source;
- schemas pass the JSON Schema meta-schema and Postbot policy validation before
  compilation;
- compiled validators are cached by immutable profile version and content hash.

The custom profile rejects remote references, `$dynamicRef`, user-controlled `$id`,
custom vocabularies, executable formats, automatic content decoding, and unknown
keywords. References are limited to the same profile's `$defs`. Regular-expression
keywords remain unavailable until Postbot has a bounded implementation that cannot
expose JavaScript catastrophic backtracking.

Schemas and validated instances have explicit limits for bytes, depth, node count,
properties, composition branches, string length, and array length. The exact default
ceilings are technical constants that must be justified by adversarial and
representative tests; changing those defaults does not change this architectural
decision. Validation does not coerce values or insert defaults.

Structural schema validation does not replace domain validation. Postbot separately
resolves media and other domain references, enforces project ownership and lifecycle
rules, and lets built-in modules add deterministic imperative provider checks while
returning the same normalized issue shape.

## Alternatives considered

- **Unrestricted JSON Schema:** expressive but exposes unsupported vocabularies,
  unbounded resource use, remote resolution, and unsafe regular expressions.
- **Postbot-specific schema language:** can be tightly controlled but duplicates
  standard schema semantics and requires custom editor, validator, and migration
  tooling.
- **Opaque JSON with module validation only:** prevents a generic custom-channel
  editor and gives API, CLI, and MCP clients no inspectable contract.
- **Executable validation scripts:** flexible but unsafe, non-deterministic, and
  incompatible with the persisted-data boundary.

## Consequences

- Built-in and custom channels share one validation protocol without giving up
  static types inside built-in modules.
- Custom schemas can drive editor assistance and server-authoritative validation.
- Postbot must implement and test a schema-policy validator before compiling stored
  profiles.
- Field bindings and domain checks remain explicit instead of being hidden in schema
  annotations.
- New JSON Schema keywords require an explicit compatibility and resource review.
