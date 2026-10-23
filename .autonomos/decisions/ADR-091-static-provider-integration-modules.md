# ADR-091 — Static Provider Integration Modules

- Status: accepted
- Scope: Nine built-in provider integrations in the server and browser
- Provenance: Owner approval of the complete ISSUE-185 recommendation; PROV-569
- Related: SPEC-005, ADR-083

## Context

Execution already selected exact versioned provider adapters. Connection setup,
application configuration, authoring, preview and engagement rules still spread
across shared services and components. Adding a provider required unrelated
feature edits, obscuring which owner supplied a rule.

## Decision

Keep protocol mechanics in `packages/<provider>`. Own server integrations under
`apps/api/src/providers/<provider>` and browser integrations under
`apps/web/src/providers/<provider>`. Register installed modules statically. Shared
features consume their capability contracts; manual and declarative HTTP channels
remain independent. Unknown native identities grant no native capability.

Browser definitions supply connection loaders, authoring fields and constraints,
preview slots, application forms, comment limits and performance capabilities.
Connection and field controls load on demand with stable component identities.
Provider API methods retain Eden inference and compose into the existing facade.

Server modules own connection and application policies, runtime configuration,
profiles, exact supported worker revisions, routes and engagement adapters. Keep
route composition explicit where Elysia's chained type inference requires it;
registration is not a runtime discovery or plugin system. Provider-specific HTTP
schemas stay with the integration, while common workflow schemas stay shared.

SQLite owns encryption, access checks, transactions, identity pinning, revisions
and durable claim fences. It receives explicit provider policies instead of
implementing provider rules. A policy cannot bypass those invariant checks.

## Extension boundary

A new ordinary publishing integration adds its protocol package and provider
modules, then registers browser metadata/API methods and server metadata/runtime,
worker factories and typed routes. These edits belong to composition roots; shared
composer, preview, connection panel, worker dispatch and stores do not acquire a
provider-name branch. Optional engagement capabilities have their own static
registrations. A new workspace also requires the existing Docker/workspace setup.

This architecture does not promise arbitrary database plugins. The versioned
provider-application SQLite CHECK still permits the five shipped application
identities. A new identity needing persisted application configuration requires an
explicit additive migration and the corresponding reviewed HTTP contract. Do not
rewrite historical migrations or remove that constraint to demonstrate extension.
Comment provider enum annotations were TypeScript-only and can follow registered
policies without changing the physical schema.

## Consequences

There is one owner for each destination rule and separate browser/server bundles.
A small number of typed composition edits remains deliberate. Common visual
layouts and OAuth controls can be shared without becoming provider catalogs.
Synthetic registration tests prove extension and refusal behavior without network
access; existing provider tests preserve identity, authorization and execution
semantics. Visual and HTTP validation remains necessary for a grouped migration.
