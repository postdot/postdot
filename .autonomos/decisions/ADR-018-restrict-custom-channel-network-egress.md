# ADR-018 — Restrict Custom-Channel Network Egress

- Status: accepted
- Scope: Outbound HTTP delivery for runtime-defined custom channels
- Provenance: Owner review of DOMAIN-07 on 2026-08-30
- Related specifications: [SPEC-004](../specs/SPEC-004-publication-content-boundary.md)
- Superseded by: none

## Context

An automatic custom channel needs to reach public publication APIs and may also need
to reach an operator-owned blog on a private Docker or LAN network. An unrestricted
endpoint would also let project-controlled configuration make the Herald process
request loopback services, cloud metadata endpoints, or unrelated private services.
This is a server-side request forgery boundary even when the default deployment is
self-hosted, because project authority and host-network authority are not the same.

Public-only delivery would remove that boundary but would also reject an intentional
single-process or private-network publishing workflow. Requiring a separate egress
proxy would provide strong isolation at the cost of another deployed service and is
not necessary for the accepted monolith.

## Decision

Automatic custom-channel delivery uses a deny-by-default network policy with two
explicit authority levels:

- project configuration may target public HTTPS endpoints without expanding the
  instance's network authority;
- only the instance operator may allow an exact private hostname and port or a
  bounded private CIDR and port policy. This policy is deployment configuration, not
  project-owned channel data and not editable through the project API;
- public plain HTTP is rejected. A private destination may use HTTP only when the
  operator's matching rule explicitly permits it.

The connection owns one fixed endpoint origin: scheme, hostname, and port. A webhook
or mapped request may construct only a bounded path and query beneath that origin.
Publication content, profile mappings, imported presets, and provider responses
cannot select another origin.

Every outbound attempt:

1. parses and normalizes the endpoint, allowing only HTTP or HTTPS and rejecting URL
   credentials;
2. resolves all IPv4 and IPv6 answers at execution time and classifies them before
   opening a connection;
3. rejects loopback, link-local, private, reserved, and mixed public/private answers
   unless the private destination is covered by the operator policy;
4. rejects known infrastructure metadata destinations regardless of project
   configuration;
5. connects to a selected validated address while preserving the original HTTP Host
   value and HTTPS server name, so a second uncontrolled DNS resolution cannot
   bypass validation;
6. disables redirects and applies bounded connection time, total time, response
   bytes, and redacted observability.

Network policy is evaluated again for every retry. A previously accepted DNS result
is not permanent authority. Implementation must cover DNS rebinding, IPv4-mapped
IPv6, multiple-address responses, HTTPS SNI, cancellation, redirect responses, and
response limits with contract and adversarial tests.

Bun's `node:http`-compatible lookup hook has been probed successfully for pinned HTTP
address selection while preserving the Host header. HTTPS and mixed IPv4/IPv6 cases
must still be proven before the transport is considered complete. No external proxy
or network library is selected by this decision.

## Alternatives considered

- **Unrestricted endpoints for trusted self-hosters:** smallest implementation, but
  silently grants every project-level channel editor the Herald host's network
  reachability.
- **Public HTTPS only:** strong and simple, but excludes legitimate private blogs and
  Docker-network receivers.
- **Mandatory external egress proxy:** strong infrastructure isolation, but adds an
  operational service and conflicts with the default monolithic deployment.
- **Public HTTPS plus operator-owned private allowlist:** preserves the intended local
  workflow while keeping host-network authority outside project configuration. This
  is the selected alternative.

## Consequences

- A normal custom channel cannot use Herald to probe or call the host's private
  network.
- A self-hosting operator can deliberately authorize a private publication service
  without granting that power to every project member.
- Endpoint validation is an execution-time security control, not only a form
  validation check.
- The HTTP transport needs a small address-classification and pinned-connection layer
  plus adversarial tests, but it does not require another deployed service.
- A future deployment may route the same policy through an external proxy without
  changing the channel or publication contracts.
