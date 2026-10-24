# ADR-093 — Versioned container releases

- Status: accepted
- Provenance: release policy accepted on 2026-10-11; first publication authorized
  and completed on 2026-10-24. Consolidated under DOCS-581 without a new policy decision.
- Supersedes: the location of the former root docs release-policy.md, not its accepted scope.

## Decision

Distribute the first alpha through `ghcr.io/postdot/postdot`, tag
`0.1.0-alpha.1`, for native-accepted Linux AMD64 and ARM64. Publish manually from
an exact recorded source with successful integration CI and container recovery
acceptance on both advertised architectures. Do not publish automatically on main
pushes, silently reduce platforms or reassign an existing version tag. Do not use a latest
alias during the alpha period.

Publication requires explicit authorization. Public source and a successful
candidate build alone do not authorize an image push or public package visibility.
Verify actual package visibility and anonymous access independently of repository
visibility. Record version, exact source, manifest digest, platforms and release notes.

Preserve available upstream notices and matching decoder source/build information.
This is bounded distribution work, not authorization for exhaustive dependency
license investigations or invented attribution.

## Upgrade evidence

The first public image has no previous release to upgrade from. Do not label a
same-version restart as an upgrade test. For subsequent releases, validate an
isolated previous-release data set upgraded to the candidate, representative
project/media preservation, and restoration of its pre-upgrade backup with the
matching prior executable. Send no provider requests in this acceptance fixture.
Image rollback alone does not reverse migrations or external publication effects.

## Current implementation and evidence

`container-release.yml` validates source/tag authorization, invokes native candidate
acceptance, builds the multi-platform image and checks its manifest. It records
visibility; it does not automatically change a private package to public.

The first publication is recorded in RELEASE-579 and the public release page.
The original policy and its historical candidate examples remain in the
[root-documentation snapshot](../archive/root-documentation-2026-10-25/source/docs/deployment/release-policy.md).
Future workflow changes must preserve the accepted requirements above; the
historical document is not a command to rerun old release attempts.
