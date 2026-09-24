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
- [x] **[ACCESS-132]** Add access administration surfaces, invitation acceptance, and browser validation `Priority: 🟠` `Complexity: XL` — guarded Herald access routes, organization invitation acceptance, user-owned API-key routes with bounded project scope, expiry UX, and focused API/browser regression coverage are in place.
- [x] **[ACCESS-133]** Reassess and cut over project access to Better Auth `Priority: 🟠` `Complexity: XL` — Herald has no deployed data to reconcile; the clean development baseline removes the obsolete project-membership, project-invitation, bearer-token, compatibility-marker, and compatibility-store paths. Better Auth Organization members/invitations/API keys are the only project access authority.
- [x] **[ACCESS-134]** Add project-member administration UI backed by Better Auth Organization when collaborative project management is exposed in the dashboard `Priority: 🟠` `Complexity: L` — project members, owner invitations with copyable links, invitation acceptance, editor/viewer role changes, and removal are exposed through the dashboard with API and browser coverage; API-key management remains in user configuration.
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

## 🧭 Queue operational UX

- [x] **[WEB-183]** Consolidate Queue around one filterable publication list `Priority: 🟠` `Complexity: M` — remove the duplicate attention surface, separate lifecycle filters from delivery mode, preserve due-work and bulk actions, and prove mixed-state responsive behavior with localized browser coverage.
- [x] **[WEB-185]** Simplify Queue hierarchy and row actions `Priority: 🟠` `Complexity: M` — consolidate filters, selection, and list presentation into one readable control/list composition, expose global selection directly, and align concise per-publication actions across responsive layouts. Implemented with surface-based controls, compact count badges, direct global selection, icon-led due actions, and aligned publication row actions; targeted and full repository validation passed.
- [x] **[WEB-186]** Make Queue controls responsive and tabular `Priority: 🟠` `Complexity: M` — keep lifecycle tabs on their own wrapping surface, move delivery filters to a separate flow, and place a real global checkbox with column labels in the publication table header so narrow layouts never depend on horizontal scrolling. Implemented with wrapping surface tabs, a separate filter flow, a real table-header selection checkbox, and explicit mobile column placement; targeted and full repository validation passed.
- [x] **[WEB-187]** Keep Queue selection geometry stable `Priority: 🟠` `Complexity: S` — remove the selected-row side stripe and keep one persistent action surface so selecting publications reveals actions without inserting a new block or shifting the table. Implemented with the delivery-mode and taxonomy filters anchored in the persistent bar, conditional bulk actions, and a browser anchor-position assertion; targeted and full repository validation passed.
- [x] **[WEB-188]** Reframe Queue empty states `Priority: 🟠` `Complexity: M` — replace the row-like empty result with a centered, illustrated state that uses the shared Empty primitives, keeps copy concise, supports theme-aware SVG artwork, and preserves the existing Queue actions and responsive contracts. Implemented with a reusable publication empty-state composition, theme-token SVG illustration, omitted draft filler copy, and browser coverage for the illustrated state; targeted and full repository validation passed.

## 🧭 Publication lifecycle UX

- [x] **[WEB-184]** Make publication detail lifecycle actions explicit `Priority: 🟠` `Complexity: M` — expose due manual work, retry, cancellation, and terminal read-only transitions from one state-aware detail surface, with confirmation and localized browser coverage.

## 🧭 Autonomos ledger reconciliation

- [x] **[META-153]** Reconcile issue completion state with task evidence and isolate explicit follow-ups `Priority: 🟠` `Complexity: S` — [ISSUE-078]; completed accepted issues are resolved with concise evidence, while open worktree/MCP limitations and deliberately deferred UX, account-lifecycle, and analytics work remain visible as separate follow-ups.

## 🧭 Calendar interaction and operational UX follow-up

- [x] **[DESIGN-154]** Establish the Herald operational UX review skill and remove redundant contextual-surface affordances `Priority: 🔴` `Complexity: M` — [ISSUE-079]; reusable hierarchy, one-fact/one-marker, and one-dismissal rules are recorded in the project skill and applied to the calendar publication preview.
- [x] **[WEB-155]** Separate calendar inspection from publication creation and make date overflow directly inspectable `Priority: 🔴` `Complexity: M` — [ISSUE-080]; day backgrounds and overflow expand the selected cell and its week row in the calendar, five publications remain visible before overflow, add controls create, event clicks preview, and the full publication path remains explicit without leaving the calendar unexpectedly.
- [x] **[WEB-156]** Recompose the calendar for narrow widths and compare month versus agenda reading modes `Priority: 🟠` `Complexity: L` — [ISSUE-080]; the ReUI calendar is now the default project overview, defaults to a readable agenda below 48rem, keeps month view at wide and tablet widths, offers an intentional horizontally scrollable month view on narrow screens, and preserves dense-day context through view changes and preview dismissal. The previous implementation remains available explicitly with `?calendar=legacy` during review.

## 🗓️ Calendar temporal reading modes

- [x] **[WEB-157]** Add readable week and day calendar views `Priority: 🟠` `Complexity: M` — [ISSUE-081]; expose ReUI's week/day modes with a local, read-only time grid, preserve direct publication preview behavior, anchor the new modes on the current or selected day, and keep the week intentionally horizontally scrollable when its seven columns no longer fit.

## 🗓️ Calendar density and creation follow-up

- [x] **[WEB-158]** Make Week and Day readable with dense publication slots `Priority: 🔴` `Complexity: M` — [ISSUE-082]; replace fixed horizontal overlap columns with content-driven vertical stacking, keep every simultaneous publication individually inspectable, add empty-slot and hover-plus creation through Composer with date/time context, and preserve the intentional Week/Day scope boundary around drag and resize.

## 🗓️ Calendar viewport density

- [x] **[WEB-159]** Reclaim empty Week/Day space without hiding hours `Priority: 🔴` `Complexity: S` — [ISSUE-083]; compact empty slots, remove the duplicate inner minimum, tighten the time gutter and grid gaps, keep occupied slots content-driven, and verify dense content reaches the first viewport without changing the complete 24-hour range.

## 🧱 Calendar column density and event treatment

- [x] **[WEB-160]** Make calendar columns readable, resizable, and visually consistent across views `Priority: 🟠` `Complexity: M` — [ISSUE-084]; keep Week/Day columns above a readable minimum with bounded pointer/keyboard resizing persisted per project/view, align Month's gutters and compact cell rhythm with the time grid, and replace accent-tinted/ringed publication cards with neutral surfaces plus one semantic status marker.

## 🧾 Calendar label containment follow-up

- [x] **[WEB-161]** Keep long channel labels contained in compact calendar rows `Priority: 🟠` `Complexity: S` — [ISSUE-085]; make Agenda channel labels shrink and truncate without horizontal overflow, preserve the complete value for accessible and intentional hover access, and cover a realistic long destination name in the browser scenario.
- [x] **[WEB-162]** Adapt the initial Week/Day time-grid anchor to visible publication data `Priority: 🟠` `Complexity: M` — [ISSUE-086]; position populated ranges near their earliest timed publication with a small context lead, keep empty ranges at `00:00`, preserve the complete timeline and manual scrolling, and cover both states with unit and browser evidence. The anchor is applied once per view/range and initial empty-to-timed transition, so ordinary renders and manual scrolling retain control.

## 🧪 Adaptive calendar edge-case verification

- [x] **[WEB-163]** Prove the adaptive Week/Day anchor across temporal edge cases `Priority: 🟠` `Complexity: S` — [ISSUE-087]; cover late-night data, non-UTC display timezones, and occurrences crossing the visible range boundary with deterministic unit evidence plus a populated browser check, without changing the existing timeline or viewport policy. Unit, browser, full gate, and integrated-browser evidence confirm the behavior.

## 🧭 Calendar continuity and state persistence

- [x] **[WEB-164]** Make the populated Week/Day anchor visibly effective and persist the selected calendar view `Priority: 🟠` `Complexity: M` — [ISSUE-088] [ISSUE-089]; give the time grid a real bounded scroll surface so data-aware positioning is observable without hiding hours, keep headers aligned with the scrolled columns, make `view` a validated overview query source of truth with responsive fallback when absent, and cover empty/populated anchor behavior plus reload persistence in unit and browser evidence. Full format, lint, typecheck/i18n, unit, browser, and package-build validation passed.

## 🧭 Calendar context continuity

- [x] **[WEB-165]** Persist the focused calendar date and apply the route history policy `Priority: 🟠` `Complexity: M` — [ISSUE-090]; validate a canonical `date=YYYY-MM-DD`, make Month/Week/Day/Agenda derive their context from it, use `replace` for reading-state changes, preserve other overview search values, and cover reload, view switching, period navigation, and explicit task navigation. Implemented with timezone-safe civil-date parsing and browser coverage.

## 🎨 Calendar month context

- [x] **[DESIGN-166]** Distinguish outside-month cells with a restrained surface treatment `Priority: 🔵` `Complexity: S` — [ISSUE-091]; keep adjacent-month dates interactive while adding one theme-aware diagonal hatch that respects the surface grammar and does not introduce borders, shadows, or disabled semantics. Implemented and visually verified in light and dark themes.

## ⌨️ Calendar keyboard navigation pilot

- [x] **[WEB-167]** Add focused calendar reading shortcuts with TanStack React Hotkeys `Priority: 🔵` `Complexity: M` — [ISSUE-092]; implement `T`, `M/W/D/A`, and `[/]` period commands only while the calendar owns focus, ignore editable controls and contextual surfaces, reuse existing view/date callbacks, add keyboard metadata, and cover keyboard behavior without creating a global shortcut layer. Implemented with scoped target registration and browser coverage.

## 🧭 Calendar affordance disclosure follow-up

- [x] **[DESIGN-168]** Make the selected calendar view and local reading shortcuts visibly discoverable `Priority: 🟠` `Complexity: S` — [ISSUE-093]; use an explicit filled active surface, add shared `Kbd` primitives to the view/navigation controls, keep disclosure local and responsive, and preserve the existing shortcut scope and URL behavior. Implemented with light/dark integrated-browser review and targeted accessibility assertions.
- [x] **[WEB-169]** Put the Week/Day create action in a content-aware slot header `Priority: 🟠` `Complexity: M` — [ISSUE-094]; keep occupied-slot actions above stacked publications, keep empty slots compact, preserve separate inspect/create intent, and cover dense, empty, keyboard-focus, and narrow-width states. Implemented with six-publication dense-stack browser coverage and full repository validation.
- [x] **[WEB-170]** Move the dense Week/Day action frame outside the cell `Priority: 🔴` `Complexity: S` — [ISSUE-095]; remove the inner padding/header surface, show a non-flowing outer envelope only on hover/focus, keep the publication stack’s geometry unchanged at rest, and verify the external create action remains usable without covering events. Implemented with direct publication children, an external top action band, and light/dark integrated-browser review.
- [x] **[WEB-171]** Overlay Week/Day creation in the cell, slim shortcut disclosure, and pin the time gutter `Priority: 🔴` `Complexity: M` — [ISSUE-096]; keep the `+` inside the existing cell without layout shift or an external frame, remove the noisy navigation keycaps while retaining a compact view-group disclosure, make `Kbd` visibly distinct without shadow-only styling, and keep the hours gutter visible during horizontal scrolling. Implemented with in-cell z-order assertions, deterministic vertical-anchor coverage, horizontal sticky-gutter coverage, and light/dark integrated review.
- [x] **[WEB-172]** Retire the reviewed calendar fallback and make ReUI canonical `Priority: 🟠` `Complexity: S` — [ISSUE-097]; remove the legacy overview query branch, delete the unreachable legacy month/agenda implementation, update browser coverage and user-facing references, then prove the canonical calendar still supports the existing route, view, date, creation, inspection, density, and responsive contracts. Implemented with canonical naming, dead-route removal, generated route/i18n refresh, focused calendar coverage, and the full repository gate.

## 📝 Publication authoring IA and vocabulary

- [x] **[DESIGN-173]** Clarify the publication authoring entry points and user vocabulary `Priority: 🔴` `Complexity: M` — [ISSUE-098]; map the current creation route and shortcuts to the operator’s job, separate domain terms from user-facing language, compare viable navigation strategies, and record the accepted vocabulary/IA before changing Composer or its implementation. Decision accepted: `/publications/new` is the canonical creation route, `publication` is the user-facing noun, and creation is a primary sidebar action rather than a Work peer.
- [x] **[WEB-174]** Replace the Composer entry point with a canonical new-publication action `Priority: 🔴` `Complexity: M` — [ISSUE-098]; move the route to `/dashboard/projects/$projectId/publications/new`, update every in-scope link and browser contract, remove the standalone project-creation disclosure from the sidebar, expose it from the project selector, and add one prominent `New publication` action without redesigning the authoring form or the remaining sidebar. Implemented with the project selector relabeled to clarify the active project context, generated route and i18n refresh, focused browser coverage, and the full repository gate.

## 📝 Publication authoring hierarchy

- [x] **[DESIGN-175]** Reframe new-publication authoring around the operator’s job `Priority: 🔴` `Complexity: M` — [ISSUE-099]; define the first-frame hierarchy, user-facing vocabulary, channel selection order, and progressive disclosure boundary for shared versus channel-specific publication settings before implementation. Implemented with the accepted Content/Publish to contract and an explicit preview/editor follow-up boundary.
- [x] **[WEB-176]** Implement the accepted new-publication authoring hierarchy `Priority: 🔴` `Complexity: M` — [ISSUE-099]; make Content primary, rename the publication scope to Publish to, put channel selection before shared delivery settings, remove duplicate destination framing, preserve all multi-channel behavior, and prove the result with localized browser and full repository checks. Implemented with responsive hierarchy, no-channel preservation, focused browser assertions, and full-gate verification.

## 👁️ Publication draft preview

- [x] **[DESIGN-177]** Define the contextual multi-channel draft preview contract `Priority: 🟠` `Complexity: M` — [ISSUE-100]; specify the active-channel relationship, effective shared/override content, honest profile-specific treatment, media behavior, empty state, surface hierarchy, and explicit non-goals before implementation. Implemented with one active-channel preview after the publish controls, truthful generic/custom handling, an explicit empty state, and provider-compliance/rendering work deferred.
- [x] **[WEB-178]** Implement the live contextual preview for new publications `Priority: 🟠` `Complexity: M` — [ISSUE-100]; expose the active target and loaded media to the page, render the selected channel’s effective draft without API changes, localize the UI, and verify content, override, media, channel switching, narrow layout, and no-channel behavior. Implemented with live shared/override resolution, DEV.to title treatment, existing identity/media primitives, localized copy, unit coverage, focused browser coverage, and the full repository gate.

## 🎞️ Media system and editor exploration

- [x] **[MEDIA-179]** Prototype a Herald-owned media workspace and standalone image editor `Priority: 🟠` `Complexity: L` — [ISSUE-101]; keep upload orchestration separate from Herald presentation, add a reusable viewer/editor proof with crop/zoom/rotation and non-destructive output, validate ordered attachments and accessible alternatives, compare Uppy core/headless with a React-oriented editor, measure the browser cost, and document the production boundary before changing the publication authoring flow. Implemented with a Herald-owned viewer/editor using `react-easy-crop`, verified new-asset output, native drag ordering with keyboard-visible arrow fallbacks, lazy loading, and localized light/dark browser coverage; production packaging and provider-specific transforms remain a deliberate follow-up.

## 🎞️ Media library and headless intake boundary

- [x] **[MEDIA-180]** Make the Media route a first-class library and introduce a headless Uppy intake boundary `Priority: 🟠` `Complexity: M` — [ISSUE-102]; keep publication attachment selection separate from library management, route file input and drop handling through Uppy Core/React headless hooks, preserve Herald's reserve/upload/finalize verification lifecycle, and cover ready/pending/failed uploads plus the Media route in localized browser tests. Implemented with a testable Herald adapter, explicit manage mode without selection toggles, a direct New publication action, and no Uppy Dashboard or CSS adoption. The existing Herald-owned image editor remains intact; Uppy Image Editor, cancellation/progress/resumability, and generic media package extraction are separate follow-ups.

## 🌐 External media sources

- [x] **[MEDIA-181]** Deliver the first safe media-source set `Priority: 🔵` `Complexity: L` — [ISSUE-103]; device selection, browser-owned webcam capture, and explicitly configured URL import all use the shared verified intake path. URL transfer has controlled egress and bounded redirects, type, size, and time. Cloud OAuth providers, Companion, and Unsplash are deferred for now, not permanently excluded.

## 🎞️ Media library contract

- [x] **[MEDIA-182]** Close the media deletion-recovery contract `Priority: 🟠` `Complexity: S` — [ISSUE-104]. Deletion now moves files out of the library and into a project-scoped Trash view; the configured retention duration and permanent-deletion deadline are visible, and eligible files can be restored before expiry. The database preserves the exact pre-deletion lifecycle state, rejects restoration after expiry, and claims permanent purge before deleting bytes so reconciliation can safely retry partial storage cleanup. Evidence: [MEDIA-182 trash recovery worklog](worklogs/2026-09-24-MEDIA-182-trash-recovery.md).

## 🔎 External audit reconciliation

- [x] **[AUDIT-166]** Reconcile the external Herald audit and enforce English repository artifacts `Priority: 🔴` `Complexity: XL` — confirm each reported process, security, reliability, web, operations, and documentation finding against current source; apply safe corrections in evidence order, add a repository-language gate that excludes only translation catalogs and generated localization output, and record unresolved integration or governance decisions without deleting user work.

## 🔎 Issue-driven external audit reconciliation

- [x] **[AUDIT-189]** Reconcile `ISSUE-105` through `ISSUE-124` using the issue → accepted approach → task → evidence workflow `Priority: 🔴` `Complexity: XL` — re-check every report item against the current checkout, preserve historical records, implement confirmed corrections, classify deliberate deferrals without making them permanent decisions, and leave only explicit owner choices or future work active. Closeout: `.autonomos/worklogs/2026-09-24-AUDIT-189-closeout.md`.
- [x] **[TOOLING-190]** Replace the heuristic repository-language check with a standard CSpell gate `Priority: 🔴` `Complexity: M` — keep ordinary code, documentation, tests, and Autonomos artifacts spell-checked in English; exclude only translation catalogs and generated localization output plus standard build/runtime paths; maintain a small reviewed project dictionary; integrate the gate into the existing lint/check flow; and remove the custom regex scanner. — [ISSUE-117]
- [x] **[OPS-191]** Classify the current audit checkout and untracked paths `Priority: 🔴` `Complexity: M` — record the current branch/worktree baseline and classify untracked paths as retained project work or owner-controlled integration state without deleting or absorbing user changes. — [ISSUE-105] [ISSUE-106]
- [x] **[OPS-192]** Resolve branch and worktree integration ownership `Priority: 🟠` `Complexity: S` — identify the authoritative branch and remove or merge stale state only after the repository owner chooses the integration baseline and authorizes cleanup. — [ISSUE-105] [ISSUE-107] Evidence: `main` fast-forwarded to `codex/reui-calendar-spike`; all secondary worktrees were evaluated and removed; 47 already-integrated local branches and four individually-evaluated superseded or duplicate branches were removed; no remote branch was modified.
- [x] **[OPS-193]** Align local, CI, and release quality gates with their intended scope `Priority: 🟠` `Complexity: S` — verify the fast pre-commit path and complete CI path against the current root scripts, then record the relationship as current evidence. — [ISSUE-108]
- [x] **[OPS-195]** Reconcile current issue, task, and worklog identity `Priority: 🟠` `Complexity: M` — verify protocol status, current task links, and historical worklog preservation without rewriting prior evidence. — [ISSUE-109]
- [x] **[AUDIT-196]** Revalidate the historical H-01 through H-07 closure boundaries `Priority: 🟠` `Complexity: M` — compare each historical claim with current source, tests, and accepted records, then classify it as current, corrected, not reproduced, or historical-only. — [ISSUE-110]
- [x] **[SECURITY-197]** Confirm the current publisher encryption key lifecycle `Priority: 🔴` `Complexity: XL` — [ISSUE-111]; ADR-012 and the implementation already define one deployment-owned key, separately backed up, with key/version identifiers in encrypted envelopes. Herald does not currently support key rotation or re-encryption. If the key is lost or replaced, existing publisher credentials cannot be decrypted and those social accounts must be connected again. Closed as confirmation of the accepted current contract; automated rotation remains future work if a concrete deployment need arises.
- [x] **[SECURITY-198]** Verify authorization coverage across route families `Priority: 🔴` `Complexity: L` — inspect the shared authentication macro, project role checks, API-key scope, publisher routes, analytics routes, and existing boundary tests; record the current result without adding speculative guards. — [ISSUE-112]
- [x] **[REALTIME-194]** Revoke user notification streams after session or project-access loss `Priority: 🔴` `Complexity: M` — re-evaluate the user’s visible project set during the long-lived stream, emit a terminal access-revoked control event when it becomes empty, close the browser source, and cover the server/client contracts without exposing notification payloads. — [ISSUE-113]
- [x] **[NOTIFY-199]** Record the external notification transport boundary `Priority: 🟠` `Complexity: S` — [ISSUE-114]; the owner explicitly defers real Ntfy, Telegram, and provider adapters for now, without permanently excluding them. Keep the transport-neutral store and recording-transport tests; revisit when a concrete destination is requested.
- [x] **[NOTIFY-200]** Confirm transactional email failure handling `Priority: 🟠` `Complexity: L` — [ISSUE-115]; ADR-066 already decides the current behavior: SMTP is optional, email sends do not hold up the request, failures are logged, and Herald does not retry failed messages. Local/manual-link operation remains available. Closed as confirmation of the accepted current contract; durable retries remain future work if a deployment needs a delivery guarantee.
- [x] **[WORKFLOW-201]** Close the worker fairness and deployment-topology audit `Priority: 🟠` `Complexity: M` — [ISSUE-116]; one process/worker remains the supported boundary (ADR-003); OPS-150 and OPS-151 verify shutdown/restart, fairness, claims, retries, cancellation, and ambiguous outcomes. Metrics remain under OPS-207; no multi-process policy or coordination is implied.
- [x] **[WEB-203]** Verify Queue and Calendar failure-state boundaries `Priority: 🟠` `Complexity: M` — confirm each route suppresses stale or unrelated publication data on query failure and exposes the shared retryable error state. — [ISSUE-118]
- [x] **[WEB-204]** Extract the first bounded component-debt seam `Priority: 🔵` `Complexity: L` — split media-library management rendering from `MediaAttachmentPicker` orchestration without preserving an obsolete internal API, keep attachment selection and upload/dialog lifecycles explicit, and validate the existing workflow with targeted browser evidence. — [ISSUE-119] Evidence: `MediaLibraryManagementSurface` now owns management-mode toolbar, bulk actions, collection states, pagination, and drop hint rendering; the parent retains upload, attachment, and dialog orchestration.
- [x] **[A11Y-205]** Close confirmed accessibility and responsive gaps `Priority: 🟠` `Complexity: L` — verify remaining calendar, media, and composer keyboard, touch, focus, overflow, and narrow-layout behavior with standard browser evidence, then fix only reproduced defects. — [ISSUE-120]
- [x] **[WEB-206]** Expand deterministic browser coverage for high-risk workflows `Priority: 🟠` `Complexity: L` — map existing notification, calendar, bulk, media, and recovery scenarios, add only the missing high-value transitions, and keep the isolated runtime serial. — [ISSUE-121]
- [ ] **[OPS-207]** Implement the owner-approved self-hosted metrics surface `Priority: 🟠` `Complexity: M` — [ISSUE-122]; use the approved Prometheus JavaScript client direction for a bounded scrape endpoint and operational process/worker metrics. Do not add a hosted service. Leave scrape cadence, retention, dashboards, and alert thresholds to the deployment operator; verify endpoint exposure and tests before enabling it.
- [x] **[OPS-208]** Verify and document current deployment and recovery boundaries `Priority: 🟠` `Complexity: M` — confirm the production image, health/readiness contract, Mailpit development boundary, database/media backup, restore lock, and publisher-key recovery instructions. — [ISSUE-123]
- [x] **[DOCS-209]** Reconcile public documentation with current providers and route boundaries `Priority: 🟠` `Complexity: M` — verify the supported provider list, LinkedIn scope, API-key model, recovery references, and explicit deferrals against the current source. — [ISSUE-124]
