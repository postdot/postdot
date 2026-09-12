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
- [x] **[WEB-52]** Replace raw target JSON editing with a schema-aware publication editor `Priority: 🟠` `Complexity: L`
- [x] **[OPS-16]** Document separate publisher-key recovery with application backups `Priority: 🟠` `Complexity: S`
- [x] **[EVAL-53]** Define and exercise a safe real-use publication validation loop `Priority: 🔴` `Complexity: M`
- [x] **[EVAL-54]** Reconcile completed operational issues and validate one controlled automatic-publication loop `Priority: 🔴` `Complexity: M`
- [x] **[SCHED-56]** Verify and harden schedule input persistence through ordinary browser interaction `Priority: 🔴` `Complexity: M`
- [x] **[EVAL-57]** Validate one controlled automatic LinkedIn image publication loop `Priority: 🔴` `Complexity: M`
- [x] **[FIX-58]** Align provider media delivery timestamps with the workflow processing clock `Priority: 🔴` `Complexity: S`
- [x] **[PUB-55]** Add explicit LinkedIn member and organization-page destinations `Priority: 🔴` `Complexity: L`
- [x] **[META-60]** Pilot serialized orchestration with parallel Codex worktrees and review agents `Priority: 🟠` `Complexity: M`

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
- [x] **[WEB-51]** Make the web project context URL-authoritative `Priority: 🔴` `Complexity: M`
- [x] **[META-61]** Validate the complete parallel agent lifecycle and finalize orchestration policy `Priority: 🟠` `Complexity: M`
- [!] **[META-62]** Prove visible control for app-managed worktree missions `Priority: 🟠` `Complexity: M`
- [x] **[WEB-63]** Restrict web entry points to the authenticated application and authentication surfaces `Priority: 🟠` `Complexity: S`
- [x] **[AUDIT-64]** Reconcile the second independent product audit against the current product state `Priority: 🔴` `Complexity: L`
- [x] **[QUAL-65]** Add regression coverage for verified audit boundaries `Priority: 🔴` `Complexity: M`
- [x] **[PLAN-66]** Prepare the next product sprint and isolated implementation missions `Priority: 🔴` `Complexity: M`

## 🧭 Next Sprint

- [x] **[AUDIT-90]** Re-audit the post-provider-expansion architecture and product boundaries `Priority: 🔴` `Complexity: L`
- [x] **[SECURITY-91]** Route per-instance Mastodon OAuth token requests through the controlled egress boundary `Priority: 🔴` `Complexity: M`

- [x] **[CHANNEL-71]** Define and implement the project channel lifecycle foundation `Priority: 🔴` `Complexity: L`
- [x] **[CHANNEL-67]** Complete web onboarding and lifecycle for runtime-defined channels `Priority: 🔴` `Complexity: XL`
- [x] **[ACCESS-68]** Expose project machine access through supported operator clients `Priority: 🔴` `Complexity: L`
- [x] **[PROVIDER-69]** Isolate built-in provider execution behind an explicit contract `Priority: 🟠` `Complexity: M`
- [x] **[TIME-70]** Define project scheduling timezone semantics before calendar expansion `Priority: 🔴` `Complexity: M`
- [x] **[WEB-72]** Start publication composition from a project calendar date `Priority: 🟠` `Complexity: M`
- [x] **[OPS-73]** Make populated SQLite schema-rebuild migrations safe `Priority: 🔴` `Complexity: S`
- [x] **[PROVIDER-74]** Generalize built-in provider connection and destination boundaries before the next adapter `Priority: 🔴` `Complexity: L`
- [x] **[CHANNEL-75]** Add the first Bluesky built-in channel vertical slice after the provider boundary `Priority: 🔴` `Complexity: XL`
- [x] **[CHANNEL-77]** Expose the Bluesky connection flow through the supported web client `Priority: 🔴` `Complexity: M`
- [x] **[CHANNEL-78]** Make the Bluesky OAuth connection flow compatible with PAR state handling `Priority: 🔴` `Complexity: S`
- [x] **[WEB-76]** Define and implement Herald's web client information architecture and UX system `Priority: 🔴` `Complexity: XL`
- [x] **[EVENT-79]** Define and implement Herald's durable domain-event journal `Priority: 🔴` `Complexity: L`
- [x] **[NOTIFY-80]** Implement the persistent project notification inbox and authenticated API `Priority: 🔴` `Complexity: L`
- [x] **[NOTIFY-81]** Build the transport-neutral external notification delivery outbox `Priority: 🔴` `Complexity: L`
- [x] **[NOTIFY-82]** Add the encrypted secret boundary required by external notification transports `Priority: 🔴` `Complexity: M`
- [x] **[NOTIFY-83]** Integrate the built-in notification inbox into the dashboard and verify the transport handoff with a recording boundary `Priority: 🔴` `Complexity: M`
- [x] **[NOTIFY-84]** Expose notification preferences and verify local event-to-inbox projection `Priority: 🔴` `Complexity: M`
- [x] **[NOTIFY-85]** Verify worker-generated failed and ambiguous outcomes reach the notification inbox `Priority: 🔴` `Complexity: S`
- [x] **[PROVIDER-86]** Add a shared conformance suite for built-in provider adapters `Priority: 🟠` `Complexity: M`
- [x] **[PROVIDER-87]** Add a per-instance Mastodon built-in channel vertical slice `Priority: 🔴` `Complexity: XL`
- [x] **[SECURITY-88]** Define operator-controlled outbound network policy for per-instance built-in providers `Priority: 🟠` `Complexity: L`
- [x] **[ANALYTICS-89]** Define the provider-neutral analytics foundation from durable publication and execution events `Priority: 🟠` `Complexity: L`
- [x] **[PROVIDER-92]** Add Discord built-in channel vertical slice `Priority: 🔴` `Complexity: XL`
- [x] **[PROVIDER-93]** Add X (Twitter) built-in channel vertical slice `Priority: 🔴` `Complexity: XL`
- [x] **[PROVIDER-94]** Add DEV.to built-in channel vertical slice `Priority: 🔴` `Complexity: XL`
- [x] **[I18N-95]** Evaluate and establish the user-facing web localization foundation `Priority: 🟠` `Complexity: L`
- [x] **[REALTIME-96]** Define and implement reconnectable project updates for the web client `Priority: 🟠` `Complexity: L`
- [x] **[REALTIME-102]** Establish the authenticated SSE transport from the durable event journal `Priority: 🟠` `Complexity: L`
- [x] **[REALTIME-103]** Integrate the authenticated SSE transport into the production web Query boundary `Priority: 🟠` `Complexity: L`
- [x] **[REALTIME-104]** Replace per-connection journal polling with a process-level wakeup and projection bridge `Priority: 🟠` `Complexity: L`
- [x] **[REALTIME-105]** Establish the post-commit project signal boundary and remove normal realtime SQLite polling `Priority: 🟠` `Complexity: L`
- [x] **[REALTIME-106]** Validate realtime restart, reconnect, zero-subscriber, and burst-load behavior `Priority: 🟠` `Complexity: M`
- [x] **[ANALYTICS-107]** Define the analytics read model, measurements, and provider-data boundary `Priority: 🟠` `Complexity: L`
- [x] **[ANALYTICS-108]** Implement the first operational analytics read model and API `Priority: 🟠` `Complexity: L`
- [x] **[ANALYTICS-109]** Map provider engagement analytics and competitor parity boundaries `Priority: 🟠` `Complexity: L`
- [x] **[ANALYTICS-110]** Benchmark operational analytics cost and historical coverage `Priority: 🟠` `Complexity: M`
- [x] **[ANALYTICS-111]** Harden large-project analytics reads and decide the projection boundary `Priority: 🟠` `Complexity: L`
- [x] **[ANALYTICS-112]** Implement the first Bluesky provider-owned observations slice `Priority: 🟠` `Complexity: L`
- [x] **[ANALYTICS-113]** Design a replayable SQLite analytics projection beyond the interactive envelope `Priority: 🔵` `Complexity: L`
- [x] **[ANALYTICS-114]** Implement the first real Bluesky provider-owned engagement collection `Priority: 🟠` `Complexity: L`
- [x] **[CRED-19]** Move provider application configuration to runtime-managed instance settings `Priority: 🔴` `Complexity: XL`
- [x] **[CRED-20]** Allow an explicit provider application when starting channel OAuth `Priority: 🟠` `Complexity: M`
- [x] **[ACCESS-116]** Define human account bootstrap, instance administration, membership, and invitation policy `Priority: 🔵` `Complexity: L`
- [x] **[PROVIDER-115]** Add AT Protocol loopback OAuth and provider-specific deployment requirements `Priority: 🟠` `Complexity: M`
- [x] **[DESIGN-97]** Recompose the notification inbox as a contextual non-blocking surface `Priority: 🔵` `Complexity: M`
- [x] **[DESIGN-98]** Reduce repeated explanatory UI copy and improve operational information density `Priority: 🔵` `Complexity: M`
- [x] **[I18N-99]** Migrate authenticated web copy and locale-aware formatting to the localization boundary `Priority: 🟠` `Complexity: XL`
- [x] **[I18N-100]** Enforce localization catalog coverage in build and release gates `Priority: 🟠` `Complexity: S`
- [x] **[TAXONOMY-101]** Define project categories and publication tags before implementation `Priority: 🔵` `Complexity: M`

## 🧭 UX/IA Sprint — proposed

This sprint is sequenced around the independent UX/UI audits and the draft
target in `SPEC-006`. Existing backlog tasks `DESIGN-97` and `DESIGN-98` are
part of this sprint; they remain the implementation homes for the notification
surface and operational copy-density work.

- [x] **[WEB-117]** Consolidate independent UX/UI audit evidence and establish the sprint baseline `Priority: 🔴` `Complexity: M`
- [x] **[WEB-118]** Decide the primary job, hierarchy, and first action of each authenticated route `Priority: 🔴` `Complexity: XL`
- [x] **[WEB-119]** Define empty, loading, populated, partial, failed, and recovery contracts for the web workflows `Priority: 🟠` `Complexity: L`
- [x] **[DESIGN-120]** Make Herald's progressive-disclosure and shadcn/Base UI foundation explicit `Priority: 🟠` `Complexity: L`
- [x] **[DESIGN-121]** Harden the authenticated shell, global/project navigation, and reduced-sidebar accessibility `Priority: 🔴` `Complexity: L`
- [x] **[WEB-122]** Implement the accepted route information architecture and differentiated empty states `Priority: 🔴` `Complexity: XL`
- [x] **[WEB-123]** Apply the verified responsive, keyboard, labeling, and localization corrections `Priority: 🟠` `Complexity: L`
- [x] **[WEB-124]** Validate realistic data, loading transitions, notifications, and realtime feedback in the browser `Priority: 🟠` `Complexity: L`
- [x] **[AUDIT-125]** Reconcile an independent UX/UI audit after the sprint implementation `Priority: 🟠` `Complexity: M`
- [x] **[WEB-126]** Preserve the active project context while opening instance settings `Priority: 🟠` `Complexity: S`

## 🧭 Notification scope follow-up

- [x] **[NOTIFY-127]** Make the in-app notification inbox user-global with optional project context `Priority: 🔴` `Complexity: L`

## 🔔 User-wide notification realtime

- [x] **[NOTIFY-128]** Add one authenticated user-wide SSE stream for notification invalidation `Priority: 🟠` `Complexity: M`

## 🏷️ Taxonomy implementation

- [x] **[TAXONOMY-129]** Implement the durable categories and publication-tags foundation `Priority: 🟠` `Complexity: L`
- [x] **[TAXONOMY-130]** Integrate taxonomy into project context, Compose, publication detail, and Queue filtering `Priority: 🟠` `Complexity: XL`

## 🔐 Access implementation follow-up

- [x] **[ACCESS-131]** Implement instance bootstrap, membership authority, invitation persistence, and authorization cutover `Priority: 🔴` `Complexity: XL` — Better Auth Admin/Organization/API Key plugins now own the applicable lifecycle; instance membership and Herald actor projections remain explicit extensions, with dedicated instance invitation storage.
- [x] **[ACCESS-132]** Add access administration surfaces, invitation acceptance, and browser validation `Priority: 🟠` `Complexity: XL` — guarded Herald access routes, organization invitation acceptance, project-scoped API-key routes, expiry UX, and focused API/browser regression coverage are in place.
- [x] **[ACCESS-133]** Reassess and cut over project access to Better Auth `Priority: 🟠` `Complexity: XL` — Herald has no deployed data to reconcile; the clean development baseline removes the obsolete project-membership, project-invitation, bearer-token, compatibility-marker, and compatibility-store paths. Better Auth Organization members/invitations/API keys are the only project access authority.
- [x] **[ACCESS-134]** Add project-member administration UI backed by Better Auth Organization when collaborative project management is exposed in the dashboard `Priority: 🟠` `Complexity: L` — project members, owner invitations with copyable links, invitation acceptance, editor/viewer role changes, removal, and owner-only automation-token access are now exposed through the dashboard with API and browser coverage.
- [x] **[ACCESS-135]** Remove obsolete project-access storage and regenerate the development migration baseline `Priority: 🟠` `Complexity: L` — the dedicated instance invitation table, Better Auth project membership/invitation/API-key records, and a single generated Drizzle baseline now define the clean development schema. No retention window or legacy database upgrade path is required for this private, data-disposable application.

## ✉️ Invitation delivery follow-up

- [x] **[ACCESS-136]** Complete the Better Auth invitation lifecycle with one-active-invitation rotation, expiry visibility, and deployment-conditioned email hooks `Priority: 🟠` `Complexity: M` — re-inviting cancels pending duplicates, the explicit resend action rotates the invitation ID, expired invitations can be resent, and local deployments keep copyable links without pretending an email was sent.
- [x] **[ACCESS-137]** Integrate an actual invitation and account-verification mail transport after choosing the deployment transport and templates `Priority: 🟠` `Complexity: M` — SMTP delivery is now optional and deployment-configured through Nodemailer, with Herald templates for project invitations, signup verification, and password reset. Local/manual-link mode remains the default; invitation links preserve project context through login.
- [x] **[ACCESS-138]** Extract transactional email templates into a dedicated React Email package and add a disposable Mailpit development relay `Priority: 🟠` `Complexity: M` — template rendering is independent from API transport, HTML and plain-text alternatives are covered by package tests, all three preview entrypoints render with safe fixture data and the shared Herald brand system, the local visual preview command starts successfully, and the loopback SMTP setup is documented and verified through Mailpit.

## 🧪 Runtime isolation follow-up

- [x] **[OPS-139]** Isolate concurrent E2E runtime data, media, ports, and teardown ownership `Priority: 🔴` `Complexity: M` — every Playwright invocation gets a unique disposable runtime root, OS-selected loopback ports, an invocation-specific output directory, and teardown scoped to that run; Playwright workers reuse the parent runtime instead of creating additional roots.

## 🔒 Recovery quiescence follow-up

- [x] **[OPS-140]** Enforce fail-closed runtime quiescence before database and media restore `Priority: 🔴` `Complexity: M` — the API runtime and restore paths now acquire one database-specific sidecar lock, graceful shutdown releases it, restore fails before validation or writes while Herald is active, and forced-stop markers require explicit operator verification.

## 🔐 Custom HTTP authentication follow-up

- [x] **[SECURITY-141]** Support path-authenticated custom HTTP receivers safely `Priority: 🔴` `Complexity: M` — mapped profiles may bind exactly one encrypted connection secret to a dedicated encoded path segment; origin-only egress, webhook separation, response redaction, API validation, and UI guidance are covered by regression tests.

## 🧩 Built-in channel profile follow-up

- [x] **[CHANNEL-142]** Add reusable built-in channel profile presets `Priority: 🔵` `Complexity: M` — expose editable, versioned starting profiles for common channel families without making presets live authorities or limiting fully runtime-defined custom channels. Provider-owned profiles are published through a typed catalog and copied into editable custom starters in the channel flow.

## 🧱 Foundation consolidation after the 2026-09-11 audit

The independent foundation audit is recorded in `worklogs/2026-09-11-herald-audit/`.
The following tasks are intentionally linked to separate accepted issues so that
each correction retains its evidence and its own completion contract. The practical
sequence starts with low-risk hygiene, then closes the access boundary, then fixes
the central project reads and projection/realtime reliability.

- [x] **[OPS-148]** Keep Drizzle migration sources intact during ordinary cleanup `Priority: 🟠` `Complexity: S` — [ISSUE-073]; clean only disposable build outputs and prove the migration directory survives a disposable clean/start cycle.
- [x] **[QUAL-149]** Add root script tests to the standard repository gate `Priority: 🟠` `Complexity: S` — [ISSUE-074]; make the eight CLI/runtime-isolation tests part of `bun run check` and prove the gate catches a regression in that family.
- [x] **[ACCESS-143]** Enforce the accepted role matrix across all project mutations `Priority: 🔴` `Complexity: L` — [ISSUE-068]; cover viewer/editor/owner and project-key principals across content, channels, profiles, media, tags, delivery, and access operations with no side effects on denial.
- [x] **[REALTIME-144]** Reauthorize or close project SSE streams after access lifecycle changes `Priority: 🔴` `Complexity: L` — [ISSUE-069]; cover removal, downgrade, disablement, session expiry/logout, bounded revocation delay, and fully authorized reconnects.
- [x] **[WEB-145]** Make Queue pagination and calendar range reads complete and bounded `Priority: 🔴` `Complexity: L` — [ISSUE-070]; define stable continuation for Queue and a date-scoped calendar read so history cannot silently hide relevant work.
- [x] **[NOTIFY-146]** Make notification projection recovery drain durable backlogs `Priority: 🟠` `Complexity: M` — [ISSUE-071]; continue bounded batches, recover after transient errors, and expose a truthful lag/runtime state.
- [x] **[REALTIME-147]** Complete the server/client realtime event contract for taxonomy `Priority: 🟠` `Complexity: M` — [ISSUE-072]; deliver tag changes to other clients and verify deterministic invalidation without widening event payloads.

## 🛑 Runtime shutdown and restart proof

- [x] **[OPS-150]** Make graceful shutdown drain in-flight work and prove durable restart recovery `Priority: 🔴` `Complexity: L` — [ISSUE-075]; stop new scheduling, await provider/projection/media operations before closing SQLite and releasing the runtime lock, then cover graceful SIGTERM-equivalent draining, restart reconstruction, and explicit forced-stop recovery semantics without adding a supervisor.

## ⚖️ Operational fairness and complete Queue counts

- [x] **[OPS-151]** Bound multi-project worker fairness and verify provider/media fault checkpoints `Priority: 🟠` `Complexity: L` — [ISSUE-076]; the worker now uses a bounded round-robin quantum while preserving serial lease-fenced effects, and representative provider/MediaStore failure paths are covered without requiring live cloud credentials.
- [x] **[WEB-152]** Return complete Queue aggregates alongside paginated publication rows `Priority: 🔴` `Complexity: M` — [ISSUE-077]; the API now returns authorization-scoped, tag/range-aware aggregate counts so tabs and summary bars never mistake a partial page for the complete project history.

## 🧭 Autonomos ledger reconciliation

- [x] **[META-153]** Reconcile issue completion state with task evidence and isolate explicit follow-ups `Priority: 🟠` `Complexity: S` — [ISSUE-078]; completed accepted issues are resolved with concise evidence, while open worktree/MCP limitations and deliberately deferred UX, account-lifecycle, and analytics work remain visible as separate follow-ups.

## 🧭 Calendar interaction and operational UX follow-up

- [x] **[DESIGN-154]** Establish the Herald operational UX review skill and remove redundant contextual-surface affordances `Priority: 🔴` `Complexity: M` — [ISSUE-079]; reusable hierarchy, one-fact/one-marker, and one-dismissal rules are recorded in the project skill and applied to the calendar publication preview.
- [x] **[WEB-155]** Separate calendar inspection from publication creation and make date overflow directly inspectable `Priority: 🔴` `Complexity: M` — [ISSUE-080]; day backgrounds and overflow expand an inline date context in the calendar, add controls create, event clicks preview, and the full publication path remains explicit without leaving the calendar unexpectedly.
- [ ] **[WEB-156]** Recompose the experimental calendar for narrow widths and compare month versus agenda reading modes `Priority: 🟠` `Complexity: L` — [ISSUE-080]; validate wide, tablet, and mobile density with realistic multi-publication days before replacing the current calendar.
