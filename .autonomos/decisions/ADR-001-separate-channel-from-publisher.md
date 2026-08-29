# ADR-001 — Separate Channel from Publisher

- Status: accepted
- Scope: Publication destination and automation domain model
- Provenance: V1 product review and domain modeling task
- Related specs: [SPEC-001](../specs/SPEC-001-v1-scope.md), [SPEC-003](../specs/SPEC-003-product-foundation.md)
- Superseded by: none

## Context

The real workflow contains supported social accounts, unsupported services, blogs,
internal systems, paid APIs that are not worth using, and destinations with no API.
A provider-centric model excludes these destinations and forces a parallel tracker.

## Decision

A `Channel` represents where the project intends to publish. A `Publisher`
represents the optional technical ability to automate delivery. A channel has zero
or one publisher; a manual channel is a normal channel with no publisher.

## Alternatives considered

- Model only integrated providers: simpler for automatic delivery, but cannot become
  the source of truth for unsupported or intentionally manual destinations.
- Add a `ManualPublisher`: makes manual work look like a technical integration and
  adds behavior where absence already expresses the domain truth.
- Allow several publishers per channel: no concrete need exists; separate channels
  make distinct configurations clearer.

## Consequences

- Manual and automatic publications share one schedule, history, and audit model.
- Custom channels do not require a plugin framework.
- Publisher capabilities and failures remain provider-specific.
- Channel identity and constraints must not depend on adapter configuration.
