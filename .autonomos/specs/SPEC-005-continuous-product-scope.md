# SPEC-005 — Continuous Product Development and Foundation Scope

- Status: accepted
- Scope: Current product direction, architectural foundations, and delivery sequencing
- Provenance: Owner direction on 2026-08-29
- Related specifications: [SPEC-002](SPEC-002-engineering-operating-model.md), [SPEC-003](SPEC-003-product-foundation.md), [SPEC-004](SPEC-004-publication-content-boundary.md)
- Related decisions: [ADR-001](../decisions/ADR-001-separate-channel-from-publisher.md), [ADR-002](../decisions/ADR-002-separate-post-from-publication.md), [ADR-005](../decisions/ADR-005-use-sqlite-first-persistence.md), [ADR-009](../decisions/ADR-009-fence-external-effects-with-durable-claims.md), [ADR-019](../decisions/ADR-019-separate-media-assets-representations-and-deliveries.md), [ADR-022](../decisions/ADR-022-use-expiring-signed-media-delivery-urls.md), [ADR-026](../decisions/ADR-026-linkedin-single-image-delivery.md)
- Superseded by: none

> This specification replaces the release-oriented framing of SPEC-001 as the
> current product direction. SPEC-001 remains in the repository as historical
> traceability for decisions made before this direction was adopted.

## Intent

Herald is developed continuously. There is no planned V1 or MVP release boundary
that justifies deliberately temporary domain models, storage seams, capability
contracts, or client behavior.

Development milestones remain useful for sequencing and review, but they are not a
permanent feature cut. A milestone may defer a feature for priority, evidence, or
implementation order; it must not defer a required architectural primitive merely
to make an early demonstration smaller.

## Product direction

Herald is a lightweight, self-hosted multichannel publication orchestrator. It keeps
automated and manual destinations in one source of truth and supports humans,
scripts, and agents through product-owned interfaces.

The product should provide durable foundations for:

- shared publication content and channel-specific adaptations;
- channel-owned or publisher-owned capability descriptions and validation;
- a unified media model with interchangeable local and S3-compatible storage;
- explicit publication snapshots, revisions, retries, and reconciliation;
- manual and automated channels without forcing unsupported destinations through a
  provider-specific model.

The product is not required to reproduce every feature of established competitors.
Feature selection remains intentional, but a selected capability must be designed
to remain coherent with the established domain and storage boundaries.

## Non-negotiable constraints

- The default deployment remains a small self-hosted monolith with one Bun process,
  API, dashboard, scheduler, worker, and SQLite database.
- Media storage must be backend-neutral at its application boundary. Local storage
  and Bun's S3-compatible client are implementations of the same Herald contract,
  not two successive generations of the media model.
- Each provider or channel module owns the destination-specific capability
  knowledge it needs. Shared code defines the capability protocol and validation
  machinery; it does not become a central catalog of every provider's rules.
- `Post`, `Publication`, `Channel`, and optional `Publisher` retain their distinct
  responsibilities. A manual channel remains a normal channel without a publisher.
- Better Auth remains limited to the current email/password application-authentication
  strategy. Publisher authorization remains a project-owned Herald concern.
- Strict formatting, linting, typechecking, unit tests, integration tests, and
  relevant end-to-end or provider smoke tests remain part of the development gate.
- Redis, Temporal, Elasticsearch, microservices, horizontal scaling, and a
  universal database abstraction require concrete evidence before introduction.

## Foundation-first delivery rules

1. Frame each loop around a durable product or architectural outcome, not a
   demonstration deadline.
2. Compare credible alternatives before deciding on data ownership, public
   contracts, lifecycle semantics, or security boundaries.
3. Implement the smallest complete boundary that supports the chosen behavior,
   including its failure, migration, backup, and test semantics.
4. Keep provider-specific behavior in the provider module while exposing enough
   typed capability information for the web editor and shared server validation.
5. Keep storage implementations behind the same contract from their first use;
   the default backend may be local without making S3/R2 a future rewrite.
6. Defer a feature when it is not currently prioritized, but do not create a
   throwaway representation when the future boundary is already known.

## Scope and sequencing

The current scope is defined per accepted specification and active Autonomos task.
It may grow through deliberate decisions as the product becomes better understood.
The following are sequencing milestones, not release gates:

- establish the domain and persistence invariants;
- prove durable scheduling, execution, retries, and reconciliation;
- deliver usable manual and automated publication flows;
- establish the common content, capability, and media foundations;
- improve client surfaces, provider coverage, operability, and footprint with
  evidence from real use.

No milestone is complete merely because a happy-path demonstration works. Its
boundary, invalid states, recovery behavior, and resource impact must be tested at
the level appropriate to the risk.

## Current publication and media consequence

[SPEC-004](SPEC-004-publication-content-boundary.md) is the active specification for
the publication content boundary. Its media direction is an extensible foundation:
the current implementation already has the shared asset, representation, and
provider-delivery seams, interchangeable local and S3-compatible storage
contracts, and a LinkedIn one-image JPEG/PNG slice. This slice is not a permanent
media ceiling. Additional media families and provider constraints still require
evidence and explicit decisions, but they must not require replacing the first
implementation.
