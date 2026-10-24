# Historical routes, access and channel-management task records

Source: .autonomos/TASKS.md. Original statuses and wording are retained;
archival does not infer completion dates or create new current instructions.

## 🧭 UX/IA Sprint — proposed

<a id="web-117"></a>

- [x] **[WEB-117]** Consolidate independent UX/UI audit evidence and establish the sprint baseline `Priority: 🔴` `Complexity: M`

<a id="web-118"></a>

- [x] **[WEB-118]** Decide the primary job, hierarchy, and first action of each authenticated route `Priority: 🔴` `Complexity: XL`

<a id="web-119"></a>

- [x] **[WEB-119]** Define empty, loading, populated, partial, failed, and recovery contracts for the web workflows `Priority: 🟠` `Complexity: L`

<a id="design-120"></a>

- [x] **[DESIGN-120]** Make Postbot's progressive-disclosure and shadcn/Base UI foundation explicit `Priority: 🟠` `Complexity: L`

<a id="design-121"></a>

- [x] **[DESIGN-121]** Harden the authenticated shell, global/project navigation, and reduced-sidebar accessibility `Priority: 🔴` `Complexity: L`

<a id="web-122"></a>

- [x] **[WEB-122]** Implement the accepted route information architecture and differentiated empty states `Priority: 🔴` `Complexity: XL`

<a id="web-123"></a>

- [x] **[WEB-123]** Apply the verified responsive, keyboard, labeling, and localization corrections `Priority: 🟠` `Complexity: L`

<a id="web-124"></a>

- [x] **[WEB-124]** Validate realistic data, loading transitions, notifications, and realtime feedback in the browser `Priority: 🟠` `Complexity: L`

<a id="audit-125"></a>

- [x] **[AUDIT-125]** Reconcile an independent UX/UI audit after the sprint implementation `Priority: 🟠` `Complexity: M`

<a id="web-126"></a>

- [x] **[WEB-126]** Preserve the active project context while opening instance settings `Priority: 🟠` `Complexity: S`

## 🧭 Notification scope follow-up

<a id="notify-127"></a>

- [x] **[NOTIFY-127]** Make the in-app notification inbox user-global with optional project context `Priority: 🔴` `Complexity: L`

## 🔔 User-wide notification realtime

<a id="notify-128"></a>

- [x] **[NOTIFY-128]** Add one authenticated user-wide SSE stream for notification invalidation `Priority: 🟠` `Complexity: M`

## 🏷️ Taxonomy implementation

<a id="taxonomy-129"></a>

- [x] **[TAXONOMY-129]** Implement the durable categories and publication-tags foundation `Priority: 🟠` `Complexity: L`

<a id="taxonomy-130"></a>

- [x] **[TAXONOMY-130]** Integrate taxonomy into project context, Compose, publication detail, and Queue filtering `Priority: 🟠` `Complexity: XL`

## 🔐 Access implementation follow-up

<a id="access-131"></a>

- [x] **[ACCESS-131]** Implement instance bootstrap, membership authority, invitation persistence, and authorization cutover `Priority: 🔴` `Complexity: XL` — Better Auth Admin/Organization/API Key plugins now own the applicable lifecycle; instance membership and Postbot actor projections remain explicit extensions, with dedicated instance invitation storage.

<a id="access-132"></a>

- [x] **[ACCESS-132]** Add access administration surfaces, invitation acceptance, and browser validation `Priority: 🟠` `Complexity: XL` — guarded Postbot access routes, organization invitation acceptance, user-owned API-key routes with bounded project scope, expiry UX, and focused API/browser regression coverage are in place.

<a id="access-133"></a>

- [x] **[ACCESS-133]** Reassess and cut over project access to Better Auth `Priority: 🟠` `Complexity: XL` — Postbot has no deployed data to reconcile; the clean development baseline removes the obsolete project-membership, project-invitation, bearer-token, compatibility-marker, and compatibility-store paths. Better Auth Organization members/invitations/API keys are the only project access authority.

<a id="access-134"></a>

- [x] **[ACCESS-134]** Add project-member administration UI backed by Better Auth Organization when collaborative project management is exposed in the dashboard `Priority: 🟠` `Complexity: L` — project members, owner invitations with copyable links, invitation acceptance, editor/viewer role changes, and removal are exposed through the dashboard with API and browser coverage; API-key management remains in user configuration.

<a id="access-135"></a>

- [x] **[ACCESS-135]** Remove obsolete project-access storage and regenerate the development migration baseline `Priority: 🟠` `Complexity: L` — the dedicated instance invitation table, Better Auth project membership/invitation/API-key records, and a single generated Drizzle baseline now define the clean development schema. No retention window or legacy database upgrade path is required for this private, data-disposable application.

## ✉️ Invitation delivery follow-up

<a id="access-136"></a>

- [x] **[ACCESS-136]** Complete the Better Auth invitation lifecycle with one-active-invitation rotation, expiry visibility, and deployment-conditioned email hooks `Priority: 🟠` `Complexity: M` — re-inviting cancels pending duplicates, the explicit resend action rotates the invitation ID, expired invitations can be resent, and local deployments keep copyable links without pretending an email was sent.

<a id="access-137"></a>

- [x] **[ACCESS-137]** Integrate an actual invitation and account-verification mail transport after choosing the deployment transport and templates `Priority: 🟠` `Complexity: M` — SMTP delivery is now optional and deployment-configured through Nodemailer, with Postbot templates for project invitations, signup verification, and password reset. Local/manual-link mode remains the default; invitation links preserve project context through login.

<a id="access-138"></a>

- [x] **[ACCESS-138]** Extract transactional email templates into a dedicated React Email package and add a disposable Mailpit development relay `Priority: 🟠` `Complexity: M` — template rendering is independent from API transport, HTML and plain-text alternatives are covered by package tests, all three preview entrypoints render with safe fixture data and the shared Postbot brand system, the local visual preview command starts successfully, and the loopback SMTP setup is documented and verified through Mailpit.

## 🔐 Custom HTTP authentication follow-up

<a id="security-141"></a>

- [x] **[SECURITY-141]** Support path-authenticated custom HTTP receivers safely `Priority: 🔴` `Complexity: M` — mapped profiles may bind exactly one encrypted connection secret to a dedicated encoded path segment; origin-only egress, webhook separation, response redaction, API validation, and UI guidance are covered by regression tests.

## 🧩 Built-in channel profile follow-up

<a id="channel-142"></a>

- [x] **[CHANNEL-142]** Add reusable built-in channel profile presets `Priority: 🔵` `Complexity: M` — expose editable, versioned starting profiles for common channel families without making presets live authorities or limiting fully runtime-defined custom channels. Provider-owned profiles are published through a typed catalog and copied into editable custom starters in the channel flow.

## 🧱 Foundation consolidation after the 2026-09-11 audit

<a id="access-143"></a>

- [x] **[ACCESS-143]** Enforce the accepted role matrix across all project mutations `Priority: 🔴` `Complexity: L` — [ISSUE-068]; cover viewer/editor/owner and project-key principals across content, channels, profiles, media, tags, delivery, and access operations with no side effects on denial.

<a id="realtime-144"></a>

- [x] **[REALTIME-144]** Reauthorize or close project SSE streams after access lifecycle changes `Priority: 🔴` `Complexity: L` — [ISSUE-069]; cover removal, downgrade, disablement, session expiry/logout, bounded revocation delay, and fully authorized reconnects.

<a id="notify-146"></a>

- [x] **[NOTIFY-146]** Make notification projection recovery drain durable backlogs `Priority: 🟠` `Complexity: M` — [ISSUE-071]; continue bounded batches, recover after transient errors, and expose a truthful lag/runtime state.

<a id="realtime-147"></a>

- [x] **[REALTIME-147]** Complete the server/client realtime event contract for taxonomy `Priority: 🟠` `Complexity: M` — [ISSUE-072]; deliver tag changes to other clients and verify deterministic invalidation without widening event payloads.

## 🔎 Issue-driven external audit reconciliation

<a id="security-197"></a>

- [x] **[SECURITY-197]** Confirm the current publisher encryption key lifecycle `Priority: 🔴` `Complexity: XL` — [ISSUE-111]; ADR-012 and the implementation already define one deployment-owned key, separately backed up, with key/version identifiers in encrypted envelopes. Postbot does not currently support key rotation or re-encryption. If the key is lost or replaced, existing publisher credentials cannot be decrypted and those social accounts must be connected again. Closed as confirmation of the accepted current contract; automated rotation remains future work if a concrete deployment need arises.

<a id="security-198"></a>

- [x] **[SECURITY-198]** Verify authorization coverage across route families `Priority: 🔴` `Complexity: L` — inspect the shared authentication macro, project role checks, API-key scope, publisher routes, analytics routes, and existing boundary tests; record the current result without adding speculative guards. — [ISSUE-112]

## External product diagnostic — prioritized follow-ups

<a id="access-219"></a>

- [x] **[ACCESS-219]** Complete the web password-reset journey `Priority: 🔴` `Complexity: L` — [ISSUE-062]; add localized request and token-completion screens over the existing Better Auth email flow, with safe response semantics and browser coverage using the disposable mail relay. Evidence: [ACCESS-219 worklog](worklogs/2026-09-26-ACCESS-219.md).

<a id="access-220"></a>

- [x] **[ACCESS-220]** Provide the accepted mail-less local account-recovery path `Priority: 🟠` `Complexity: L` — [ISSUE-062]; implement the operator-controlled offline recovery contract from ADR-061 without a reusable bypass secret, requiring the stopped instance and explicit target database confirmation, and verify preservation of projects and encrypted credentials. Evidence: [ACCESS-220 worklog](worklogs/2026-09-26-ACCESS-220.md).

<a id="channel-222"></a>

- [x] **[CHANNEL-222]** Complete X publisher connection in the web workflow `Priority: 🟠` `Complexity: L` — [ISSUE-130]; expose the existing X authorization lifecycle in the channel UI, clarify required instance provider configuration, and cover success, denial, cancellation, reconnection, and errors in browser tests. Evidence: [CHANNEL-222 worklog](worklogs/2026-09-26-CHANNEL-222.md).

## User-owned API-key action limits

<a id="access-236"></a>

- [x] **[ACCESS-236]** Add optional least-privilege action ceilings to user-owned API keys `Priority: 🔴` `Complexity: L` — [ISSUE-140]; preserve unrestricted keys as dynamically inheriting the owner's current project actions, and intersect restricted keys with current project roles and optional project scope. Enforce an explicit fail-closed route capability map for publication preparation/lifecycle, channels, media, analytics refresh, and permanent media deletion; keep workspace/access administration, publisher OAuth, notifications/realtime, API-key management, and installation administration session-only. Reuse Better Auth's native permission field, add localized create/edit controls and safe key metadata, and cover API authorization, updates, UI, and documentation. Evidence: [ACCESS-236 worklog](worklogs/2026-09-27-ACCESS-236.md).

## Publication reliability audit follow-ups

<a id="access-309"></a>

- [x] **[ACCESS-309]** Revoke project read access for API keys after owner removal `Priority: 🔴` `Complexity: M` — [ISSUE-153]. Add one `AccessStore` accessor listing a user's currently accessible projects, then resolve each API key's effective project set at authentication as the intersection of its stored scope with the owner's current access, reusing the existing hidden 404. Keep actor attribution rows, roles, action ceilings, retries, and ambiguity rules unchanged; flip the kept reproduction expectations to 404. Completed: the key branch now reuses the session authorization callback (`authorizeProjectAccess`), so one decision governs both methods; non-regression tests cover all/selected scope, before/after removal, other-project retention, team-grant inheritance and revocation, and media reads. One existing assertion moved from 403 to the documented hidden 404 because masking now precedes the role check. Audit D2 was withdrawn after re-examination: the project list already filters by `canAccessProject || canManageWorkspace`. No key revocation, role change, or UX change. Evidence: [ACCESS-309 worklog](worklogs/2026-10-04-ACCESS-309.md), [corrected audit](../../worklogs/2026-10-04-AUDIT-309.md).

## Product sequencing reset

<a id="channel-479"></a>

- [x] **[CHANNEL-479]** Prove lossless structured profile edits with isolated contract fixtures `Priority: 🟠` `Complexity: M`

<a id="channel-480"></a>

- [x] **[CHANNEL-480]** Deliver structured channel content controls and local target preview in creation and profile editing `Priority: 🟠` `Complexity: L`

<a id="channel-481"></a>

- [x] **[CHANNEL-481]** Show before/after content controls during channel profile review `Priority: 🟠` `Complexity: M`

<a id="channel-482"></a>

- [x] **[CHANNEL-482]** Simplify channel rules and add fixed dialog actions with pre-creation manual configuration `Priority: 🟠` `Complexity: M`

<a id="channel-483"></a>

- [x] **[CHANNEL-483]** Explain channel lifecycle failures inside the active confirmation dialog `Priority: 🟠` `Complexity: S`

<a id="channel-484"></a>

- [x] **[CHANNEL-484]** Model absent, optional and required titles and align profile preview with the destination editor `Priority: 🟠` `Complexity: M`

<a id="channel-485"></a>

- [x] **[CHANNEL-485]** Share the New publication writing surface with channel rule previews `Priority: 🟠` `Complexity: M`

<a id="channel-486"></a>

- [x] **[CHANNEL-486]** Share composer count rendering and constraint evaluation with the channel preview `Priority: 🟠` `Complexity: S`

<a id="channel-487"></a>

- [x] **[CHANNEL-487]** Align HTTP connection authentication choices with active contracts and anchor dialog actions `Priority: 🟠` `Complexity: M`

<a id="channel-488"></a>

- [x] **[CHANNEL-488]** Restore the local API and verify the contract-aware HTTP connection dialog `Priority: 🟠` `Complexity: M`

<a id="channel-489"></a>

- [x] **[CHANNEL-489]** Prove lossless mapped HTTP request edits before structured form integration `Priority: 🟠` `Complexity: M`

<a id="channel-490"></a>

- [x] **[CHANNEL-490]** Integrate structured mapped-request controls with atomic response classification `Priority: 🟠` `Complexity: M`

<a id="channel-491"></a>

- [x] **[CHANNEL-491]** Show mapped HTTP changes in the existing profile comparison `Priority: 🟠` `Complexity: M`

<a id="channel-492"></a>

- [x] **[CHANNEL-492]** Add optional HTTP response extraction controls and profile comparison `Priority: 🟠` `Complexity: M`

<a id="channel-493"></a>

- [x] **[CHANNEL-493]** Edit existing simple JSON body properties without flattening nested mappings `Priority: 🟠` `Complexity: M`

<a id="channel-494"></a>

- [x] **[CHANNEL-494]** Add simple JSON property lifecycle and explicit value-source selection `Priority: 🟠` `Complexity: M`

<a id="channel-495"></a>

- [x] **[CHANNEL-495]** Initialize absent mapped JSON bodies explicitly and compare their creation `Priority: 🟠` `Complexity: M`

<a id="channel-496"></a>

- [x] **[CHANNEL-496]** Edit fixed text query parameters with protected dynamic mappings and readable comparison `Priority: 🟠` `Complexity: M`

<a id="channel-497"></a>

- [x] **[CHANNEL-497]** Verify mapped builder edits through authenticated draft persistence, impact review and activation `Priority: 🟠` `Complexity: M`

