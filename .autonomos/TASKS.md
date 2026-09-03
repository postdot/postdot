# PROJECT TASKS & ROADMAP

> **LEGEND**
> **Priority:** [🔴 Critical] [🟠 High] [🔵 Medium] [⚪ Low]
> **Complexity:** [S] Small (1h), [M] Medium (4h), [L] Large (1-2 days), [XL] Huge (Planning req.)
> **Status:** [ ] Todo, [/] In Progress, [x] Done, [!] Blocked

## 🚀 Active Sprint

- [x] **[INIT-01]** Bootstrap Herald's Bun/Turborepo monorepo and Autonomos protocol `Priority: 🔵` `Complexity: S`
- [x] **[FOUND-02]** Align the foundation with Elysia 2 beta, React 19, TanStack Router, and English Git workflow `Priority: 🔵` `Complexity: M`
- [x] **[FOUND-03]** Add Drizzle, Better Auth, Tailwind, shadcn Base UI, and Solar Icons foundations `Priority: 🔵` `Complexity: M`
- [x] **[PLAN-04]** Define the V1 scope, delivery loops, quality gates, and SQLite-first storage posture `Priority: 🔴` `Complexity: M`
- [x] **[META-11]** Keep the IDE workspace synchronized with monorepo apps and packages `Priority: 🔵` `Complexity: S`
- [x] **[GOV-12]** Accept Herald's V1 specifications and foundational decisions `Priority: 🔴` `Complexity: S`
- [x] **[FOUND-13]** Add Elysia 2 request logging and declarative environment configuration `Priority: 🔵` `Complexity: M`
- [x] **[GOV-14]** Remove private context from repository artifacts and history `Priority: 🔴` `Complexity: L`
- [x] **[CRED-15]** Define a project-owned publisher credential and OAuth boundary `Priority: 🔴` `Complexity: M`
- [x] **[CRED-16]** Implement project-owned encrypted publisher credential storage `Priority: 🔴` `Complexity: L`
- [x] **[CRED-17]** Implement the reusable OAuth authorization-attempt lifecycle `Priority: 🔴` `Complexity: L`
- [x] **[CRED-18]** Migrate LinkedIn routes, clients, and workers away from Better Auth publisher accounts `Priority: 🔴` `Complexity: L`
- [x] **[DOMAIN-07]** Resolve publication content, channel capability, media, and storage boundaries `Priority: 🔴` `Complexity: XL`
- [x] **[DOMAIN-20]** Implement shared source content, channel profile, capability, and validation contracts `Priority: 🔴` `Complexity: L`
- [x] **[DOMAIN-21]** Persist drafts, immutable target and execution revisions, profile versions, and review state `Priority: 🔴` `Complexity: L`
- [x] **[E2E-32]** Prove the post-merge local media publication path through the dashboard `Priority: 🟠` `Complexity: M`
- [x] **[E2E-33]** Add reproducible browser integration coverage for mixed and media-only publications `Priority: 🟠` `Complexity: L`

## 🔮 Backlog

- [x] **[QUAL-05]** Replace placeholder checks with a real test gate and record the first footprint baseline `Priority: 🔴` `Complexity: M`
- [x] **[DOMAIN-06]** Define and persist the executable Project, Channel, Post, Publication, Publisher, Job, and Actor model `Priority: 🔴` `Complexity: L`
- [x] **[MEDIA-22]** Implement the Herald MediaStore contract with local and Bun S3 adapters `Priority: 🔴` `Complexity: L`
- [x] **[MEDIA-23]** Implement project media upload, inspection, representation, and cleanup lifecycles `Priority: 🔴` `Complexity: L`
- [x] **[MEDIA-24]** Integrate revision media, provider delivery state, and complete media-aware backup and restore `Priority: 🔴` `Complexity: L`
- [x] **[CHANNEL-25]** Persist and activate versioned custom channel profiles with impact assessment `Priority: 🔴` `Complexity: L`
- [x] **[CHANNEL-26]** Implement signed webhooks, mapped HTTP delivery, and restricted network egress `Priority: 🔴` `Complexity: XL`
- [x] **[MEDIA-28]** Add signed public media delivery URLs for custom HTTP URL mappings `Priority: 🟠` `Complexity: L`
- [x] **[EDITOR-27]** Implement zero-loss publication editing with capability feedback and explicit target promotion `Priority: 🟠` `Complexity: XL`
- [x] **[DESIGN-29]** Establish the shared Herald UI package with Base UI components and Tailwind tokens `Priority: 🟠` `Complexity: L`
- [x] **[DESIGN-30]** Define and adopt the motion policy before adding an animation runtime `Priority: 🟠` `Complexity: M`
- [x] **[WORK-07]** Prove restart-safe scheduling, execution, retry, cancellation, and ambiguous-outcome semantics `Priority: 🔴` `Complexity: XL`
- [x] **[WORK-07A]** Prove atomic job claims and the durable external-effect boundary `Priority: 🔴` `Complexity: L`
- [x] **[WORK-07B]** Implement next-event scheduling, replanning, and startup reconstruction `Priority: 🔴` `Complexity: L`
- [x] **[WORK-07C]** Prove retries, cancellation, and the external-outcome crash matrix `Priority: 🔴` `Complexity: L`
- [x] **[WORK-11]** Make automatic execution history append-only and attributable `Priority: 🔴` `Complexity: L`
- [x] **[MANUAL-08]** Deliver the manual-channel vertical slice through REST, CLI, and the minimal dashboard `Priority: 🟠` `Complexity: L`
- [x] **[PUB-09]** Select and implement one production-relevant automatic publisher `Priority: 🔴` `Complexity: XL`
- [x] **[PUB-10]** Add LinkedIn single-image publication delivery `Priority: 🔴` `Complexity: L`
- [x] **[OPS-10]** Package and validate the single-process V1 deployment, backup, restore, and resource budgets `Priority: 🟠` `Complexity: L`
- [x] **[OPS-11]** Make local API and web startup reproducible across database and port configuration `Priority: 🟠` `Complexity: M`
- [x] **[OPS-12]** Revalidate the current single-process distribution after media and editor integration `Priority: 🟠` `Complexity: M`
- [x] **[OPS-13]** Expose truthful liveness and readiness signals for the single-process runtime `Priority: 🔴` `Complexity: M`
- [x] **[ACCESS-14]** Add project-scoped bearer tokens and attributable machine principals `Priority: 🔴` `Complexity: L`
- [x] **[MEDIA-31]** Connect the durable media workflow to the web publication editor `Priority: 🔴` `Complexity: L`
- [x] **[QUAL-38]** Repair the documented Bun coverage command `Priority: 🟠` `Complexity: S`
- [x] **[DESIGN-31]** Harden authenticated dashboard navigation and narrow-screen header behavior `Priority: 🟠` `Complexity: S`
- [x] **[DESIGN-32]** Record the owner-accepted product-wide design direction and calibration evidence `Priority: 🟠` `Complexity: M`
- [x] **[DESIGN-33]** Archive Autonomos design holdouts as Herald reference examples without changing production UI `Priority: 🟠` `Complexity: S`
- [x] **[META-34]** Refresh Autonomos and adopt the project design workflow `Priority: 🟠` `Complexity: M`
- [x] **[DESIGN-35]** Implement the first authenticated app-shell design slice `Priority: 🟠` `Complexity: L`
- [x] **[DOMAIN-39]** Define the multi-destination authoring and source-conflict recovery contract `Priority: 🔴` `Complexity: XL`
- [x] **[DESIGN-36]** Recompose publication workflows for calm, low-scroll authoring `Priority: 🟠` `Complexity: XL`
- [x] **[DESIGN-40]** Design and implement the project calendar planning surface `Priority: 🟠` `Complexity: L`
- [x] **[MAINT-41]** Extract project and channel persistence from the manual store `Priority: 🔴` `Complexity: L`
- [x] **[MAINT-42]** Extract channel-profile lifecycle persistence without breaking atomic impact assessment `Priority: 🔴` `Complexity: L`
- [x] **[MAINT-43]** Extract publication authoring persistence without weakening revision and media invariants `Priority: 🔴` `Complexity: L`
- [x] **[MAINT-44]** Extract publication outcome persistence without weakening state transitions `Priority: 🔴` `Complexity: L`
- [x] **[MAINT-45]** Extract atomic post and publication creation persistence without weakening initial revision or scheduling invariants `Priority: 🔴` `Complexity: L`
- [x] **[MAINT-46]** Extract publication media capability resolution without weakening media validation or snapshot invariants `Priority: 🔴` `Complexity: M`
- [x] **[MAINT-47]** Extract channel-profile impact assessment without weakening activation transactions `Priority: 🔴` `Complexity: M`
- [x] **[MAINT-48]** Extract publication authoring read models without weakening draft mutation transactions `Priority: 🔴` `Complexity: M`
- [x] **[MAINT-49]** Extract immutable publication target promotion without weakening scheduling invariants `Priority: 🔴` `Complexity: M`
- [x] **[MAINT-50]** Extract channel-profile reads without weakening profile mutation transactions `Priority: 🔴` `Complexity: M`
- [x] **[AUDIT-37]** Reconcile independent architecture audits against the current product state `Priority: 🔴` `Complexity: L`
