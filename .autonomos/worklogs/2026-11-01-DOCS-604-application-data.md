# DOCS-604 — Application privacy and data deletion documentation

Status: completed documentation preparation; instance-specific policy not finalized.

## Scope

The owner accepted the next App Review preparation slice: document application
privacy and data deletion against implemented behavior. This pass adds public
software documentation and an operator checklist. It does not claim that the
software publisher operates every installation, choose an instance operator's
retention periods or publish an application-specific legal policy on their behalf.

Asked the owner to identify the review-instance operator and request contact,
noting the existing website publisher/contact as context. No operator-specific
identity was assumed without that answer. The general documentation remains
useful independently of that outstanding detail. Actual review-instance policy,
deployment and Meta URL configuration remain separate readiness requirements.

## Changes

- Added Application data and privacy at `/docs/application-privacy/`, describing
  account/access data, API-key metadata, provider credentials, content/media,
  supported engagement/analytics, execution history and deployment dependencies.
- Explained the roles of the instance operator, authorized team members, hosting,
  email/storage providers and selected publishing platforms. Kept website privacy
  distinct from application data handling.
- Added Delete application data at `/docs/delete-application-data/`, covering
  disconnection, access removal, archiving, permanent project/workspace deletion,
  media references/trash/cleanup, operator requests and remote-provider content.
- Distinguished local credential revocation from removing all related history,
  workspace-shared resources, provider-side authorization and old backups. Did not
  invent a user-account deletion button or Meta deletion callback.
- Added both pages to Guides navigation, linked them from Instagram's guide and
  the existing website privacy page, and added the operator policy checklist to
  Backups and recovery.
- No backend behavior, live data, Meta settings or deployed service changed.

## Evidence and writing boundary

Checked `packages/auth/src/index.ts`, request logging, the publisher credential
store's secret-clearing revocation statements, publisher disconnection, the
project/workspace lifecycle routes, and existing source-backed guides for shared
channels, permanent deletion, media trash and recovery. These support the software
behavior described; they do not establish the operator's identity, deployment
processors or retention schedule.

[CNIL transparency guidance](https://www.cnil.fr/fr/conformite-rgpd-information-des-personnes-et-transparence)
identifies the information a responsible operator must provide. Used it to check
the operator checklist, without choosing a legal basis or processing location for
an unspecified instance. Current Meta app/privacy/deletion requirements and the
missing application URLs are recorded in [META-603](2026-11-01-META-603-app-review.md).
These documentation URLs describe software behavior; they must not be represented
as a complete instance-specific Meta privacy/deletion policy.

## Validation

Docs TypeScript check passed. Full static docs build and the exported link,
Markdown/LLM and social metadata checks passed on the initial pages. A concurrent
content-regeneration command caused the first attempted build to lose a generated
API page during image generation; rerunning sequentially resolved it without
changing generation logic. The final build includes the completed data inventory.
Spelling, formatting and commit static gates are checked before integration. No
new tests mirror prose, and no application browser matrix is needed for these
content/navigation changes.

## Next step

Finalize the review-instance operator/contact, hosting origin and retention/
request-handling choices, then publish that instance's specific privacy and
deletion instructions and verify its contact process. Prepare a stable HTTPS review
instance and reviewer access after those facts are set. Do not fill Meta's policy
fields with generic software documentation as if it identifies the application
operator or completes its data-deletion service.
