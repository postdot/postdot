# ADR-061 — Establish human account bootstrap and instance/project access policy

- Status: proposed
- Scope: self-hosted human accounts, instance administration, project membership,
  invitations, and authorization boundaries
- Provenance: ACCESS-116; ISSUE-013; current Better Auth, project actor, notification,
  and runtime provider-configuration boundaries
- Related decisions: [ADR-008](ADR-008-enforce-project-scoped-domain-state.md),
  [ADR-030](ADR-030-project-scoped-machine-access.md),
  [ADR-038](ADR-038-project-durable-facts-into-recipient-owned-notifications.md),
  [ADR-056](ADR-056-runtime-provider-application-configurations.md),
  [ADR-057](ADR-057-propose-route-information-architecture.md)
- Superseded by: none

## Context

Herald currently authenticates people with Better Auth email/password sessions. Any
authenticated human can sign up, and project access is inferred from a project-scoped
human actor whose `subject_id` is the Better Auth user ID. A project creator therefore
gets access, but there is no instance identity, administrator, membership lifecycle,
invitation, suspension, or project role model. Instance provider-application settings
currently accept any human session as a deliberate temporary operator boundary.

This is sufficient for a single trusted operator, but it is not a safe policy for a
self-hosted instance shared by a team. The missing layer must remain distinct from
Better Auth identity and from project-owned publisher credentials. It must also remain
compatible with a low-friction local installation: a new operator should not need a
hosted identity service, an SMTP account, or an environment-file edit before creating
the first project.

## Decision

### 1. Instance bootstrap and operating modes

- An empty database is in `unclaimed` bootstrap state. The first successful
  email/password account creation claims the instance in the same transaction that
  creates the user and makes that user the initial instance administrator.
- The bootstrap operation is race-safe: only one concurrent first-account request can
  claim the instance. The account receives a session and may immediately create a
  project; no email delivery is required.
- After the first account exists, unaffiliated public sign-up is closed. A sign-up
  request without a valid invitation is rejected with a generic account-creation
  error. This prevents an installation exposed beyond localhost from becoming an
  open registration service.
- The initial administrator is also an active instance member. The first project they
  create gives them the `owner` project role. A single-user installation can therefore
  remain entirely self-contained and need not configure team features.
- Herald does not add a hosted identity provider or an environment bootstrap password.
  An operator who controls the deployment can use the supported offline recovery
  command described below if the instance is locked out.

The unclaimed/claimed state is Herald instance state, not a Better Auth option. Better
Auth remains responsible for password hashing, sessions, and email/password protocol
handling; Herald decides whether a signup is eligible.

### 2. Roles and authorization boundaries

Herald has one instance boundary and many project boundaries. An instance role never
implicitly grants access to project content, and a project role never grants access to
instance configuration.

#### Instance roles

- `admin`: manage instance members, invitations, instance recovery metadata, and
  runtime provider-application configurations. An instance administrator may manage
  membership records for any project but must have a project role to read or mutate
  that project's operational data. The initial administrator is an `admin`.
- `member`: an enabled human account allowed to participate in projects to which it
  has a project membership. A member may create a new project by default; its creator
  becomes that project's owner. A member cannot change instance settings or promote
  another person to instance administrator.

There is no separate `owner` instance role in V1. Multiple admins are supported, but
the last active admin cannot be disabled, removed, or demoted through the application.

#### Project roles

- `owner`: full project access, including project membership and invitation management,
  project settings, channels, publisher connections, publication workflows, project
  notification preferences, and project machine-token management.
- `editor`: read/write project authoring and operational access, including channels,
  publisher connections, publication workflows, media, and project notifications. An
  editor cannot manage project membership or machine tokens.
- `viewer`: read-only project data and the recipient's project notification inbox;
  no project mutation, connection, publication, or token-management operations.

Approval workflows and finer-grained permissions are out of scope. The existing
project-wide machine-token permission is narrowed to `owner` for newly authorized
humans because token creation is an access-management operation; existing project
access is migrated to `owner` so the change does not silently remove current rights.

The effective authorization check for a human request is:

1. resolve the Better Auth session;
2. require an active Herald instance membership;
3. for a project route, require an active project membership and the operation's
   minimum project role; or
4. for an instance route, require `admin`.

Project bearer tokens remain the separate machine principal from ADR-030. They are
project-scoped, cannot access instance administration, cannot accept invitations,
cannot create projects, and cannot start interactive publisher OAuth. A bearer token
is authoritative when supplied and never falls back to a human session.

Instance administrators do not receive implicit project notifications or project data
access merely because they administer the instance. They may grant themselves or
another account a project role through the membership surface. This keeps the
authorization boundary explicit while allowing instance recovery and membership
administration without broadening ordinary project visibility.

### 3. Membership lifecycle

Membership is Herald domain data and is not represented by Better Auth organization
tables or by the existence of an `actors` row alone.

- An instance membership has an enabled/disabled lifecycle and an instance role.
  Disabling it blocks new sessions and invalidates active sessions; it also makes all
  project memberships ineffective without deleting project data.
- A project membership has an active/removed lifecycle and a project role. Removing
  access invalidates future project authorization immediately. The human actor row is
  retained for audit attribution and historical notifications; it is not reused as an
  authorization shortcut.
- Re-adding a person reactivates their existing membership and human actor where
  possible. Role changes are durable and auditable.
- Removing or disabling a human does not revoke project-owned publisher credentials,
  channel connections, or project bearer tokens. Those are owned by the project and
  must survive the departure of the person who connected or created them, as required
  by the existing publisher and machine-access decisions. An owner/admin may revoke
  machine tokens explicitly.
- Hard deletion of a Better Auth user is not the normal access-removal operation. A
  future privacy/anonymization operation must preserve the non-personal actor and
  audit invariants, expire sessions and invitations, and be a separate decision.
- Notification projection must resolve current active project human memberships, not
  every historical human actor. Existing recipient-owned inbox rows remain stable;
  removed people receive no new facts.

### 4. Invitations

- An instance admin may invite a person as an instance `member` and optionally assign
  project roles in the same invitation. Only an existing instance admin may grant
  `admin`; admin promotion is never granted by an ordinary project invitation.
- A project owner may invite an existing or new person to that project as `editor` or
  `viewer`. Accepting a project invitation creates or activates the recipient's
  instance `member` record, but never an instance admin record.
- An invitation is single-use, expires after seven days by default, can be revoked,
  and can be replaced without invalidating unrelated invitations. The database stores
  only a hash of its high-entropy token. The raw link is displayed once to the inviter
  and is never logged.
- Invitations carry a normalized target email. Acceptance must use that email when a
  new account is created or an existing account accepts the invitation. An already
  authenticated account cannot use a link addressed to another email.
- Acceptance is transactional: consume the invitation, create or resolve the Better
  Auth account, create/activate Herald memberships and human actors, and issue the
  session together. A failed transaction leaves the invitation available.
- Pending invitations do not grant access. Revoking or disabling a person revokes
  their pending invitations; disabling an instance or project also prevents
  acceptance for that scope.

### 5. Email and optional mail delivery

- A Better Auth email address is required for every human account. It is the stable
  account identifier and the target for invitations; it is not, by itself, proof that
  the operator controls a mailbox.
- Email verification is optional for the local bootstrap and manual-link workflows.
  When a mail transport is configured, Herald may require verification for normal
  invited-account acceptance and may expose password-reset and invitation email
  delivery. The exact verification requirement is an implementation checkpoint, not
  a reason to make SMTP mandatory for self-hosting.
- Mail delivery is an optional deployment capability configured through environment
  variables (for example, an SMTP/relay URL and sender identity). If it is absent,
  Herald must not claim that an invitation or reset email was sent; the UI and CLI
  provide a copyable invitation link and the operator follows the documented offline
  password-recovery path.
- Mail credentials are deployment secrets and are not business credentials stored in
  Herald's settings tables. Herald stores invitation metadata and token digests, not
  SMTP passwords or provider-account mail credentials.

### 6. Recovery and last-administrator safety

- Application password reset uses Better Auth's email flow when mail delivery is
  configured. Without mail, the supported recovery path is a local/offline maintenance
  command that requires filesystem access to the SQLite database, a recent backup,
  and the server being stopped. It creates a short-lived recovery session or resets a
  password without exposing a reusable admin secret in the URL or logs.
- A separate offline `admin recover` operation may designate a new admin only when
  the operator can prove local deployment control. It must report the target database,
  require explicit confirmation, write an audit record once the server starts, and
  preserve all projects, publisher credentials, tokens, and historical actors.
- The web/API path refuses to remove, disable, or demote the last active instance
  admin. Recovery is intentionally an operator/deployment responsibility, not a
  hidden backdoor or a magic environment value.
- A database backup alone is insufficient to recover encrypted provider credentials or
  sessions. The operator must retain the configured Better Auth secret and publisher
  encryption root key alongside the database/media backup, consistent with the
  existing recovery guidance.

### 7. Environment configuration versus Herald business credentials

The following remain deployment/environment configuration:

- database and migration locations, listener/public origins, trusted web origin, and
  Better Auth secret;
- media storage configuration and public-media signing secret;
- publisher encryption root key and key identifier;
- optional outbound-network policy; and
- optional mail transport endpoint, sender identity, and mail credentials.

The following are business or instance data stored by Herald, with secrets protected
by their existing boundaries:

- Better Auth users, password hashes, sessions, and verification records;
- Herald instance membership, project membership, role, invitation, and audit state;
- runtime provider-application configurations and their encrypted client secrets
  (ADR-056);
- project-owned encrypted publisher credentials and channel connections; and
- project-scoped bearer-token digests and their lifecycle metadata (ADR-030).

An operator changing the environment changes deployment trust and cryptographic
boundaries. It must not be required for ordinary team membership, project invitation,
provider-app setup, publisher connection, or token rotation.

## Migration from the current state

Migration is additive and must not infer authorization from an actor after the new
guards are enabled.

1. Add one instance-state row and membership/invitation tables. If Better Auth users
   already exist, mark them active instance members. The earliest user by
   `created_at, id` becomes the initial admin because current data contains no admin
   marker; record this deterministic choice in the migration report and expose a
   transfer-admin action immediately.
2. For every project human actor whose `subject_id` matches a user, create an active
   project membership for that user and project. Map each existing human project
   actor to `owner` to preserve current project-wide human rights. Keep actor IDs,
   audit events, notification rows, publisher connections, and machine-token actors
   unchanged.
3. Existing users with no actor remain instance members but have no project access.
   Existing projects with no resolvable human owner are marked for operator recovery;
   they are not silently assigned to a random account.
4. Existing provider-application configurations are governed by the migrated
   instance-admin role. Their `created_by_user_id` and encrypted secrets remain
   unchanged. The current temporary any-session operator behavior ends after the
   authorization guard is deployed.
5. Existing project access tokens continue to authenticate and retain their project
   scope. Human token management is checked through project `owner` membership after
   migration; token rows and token actors are not re-owned by the instance admin.
6. Update notification recipient resolution to use active project memberships. Do not
   delete or rewrite existing inbox items during migration.
7. Once the migration has created the claimed instance state, disable anonymous
   sign-up. A maintenance report must show the selected initial admin, orphaned
   projects, users without project access, and any duplicate/ambiguous actor mappings
   before the operator treats the upgrade as complete.

If the database has no Better Auth users but contains project data, the normal web
bootstrap must remain blocked until `admin recover` or an explicit operator bootstrap
procedure assigns the first admin. The migration must never grant an arbitrary new
browser account access to pre-existing projects.

## Alternatives considered

### Keep public signup and treat every human actor as an administrator

Rejected. It is convenient for local development but turns an exposed self-hosted
instance into an open registration surface and cannot express instance versus project
responsibility.

### Use Better Auth's organization/team plugin as the authority

Rejected. Herald's project membership, actor attribution, notification recipients,
project tokens, and publisher ownership have different lifecycles. Better Auth should
authenticate people; Herald should own domain authorization.

### Give instance admins implicit access to every project

Rejected for the initial policy. It is easy to explain, but makes instance
administration inseparable from project content access and causes every admin to become
a notification recipient. Explicit project roles are safer and still allow an admin
to grant access when needed.

### Require SMTP or verified email for first bootstrap

Rejected. It would make a local/self-hosted installation depend on a hosted mail
service before the operator can create the first project. Email delivery remains an
optional deployment capability.

### Add a permanent environment admin password or bypass token

Rejected. It creates a second authentication path that is hard to rotate and easy to
leak. Local operator recovery with a stopped server and a backup is slower but keeps
the deployment boundary explicit.

## Consequences

Positive:

- A fresh installation remains one-person and low-friction while becoming safe to
  expose to an invited team.
- Instance configuration, project operations, human identity, machine access,
  notifications, and publisher ownership have explicit boundaries.
- Membership removal is immediate without destroying project-owned automation or audit
  provenance.
- Invitation links work without SMTP, while configured mail can improve convenience
  and enable self-service password recovery.

Costs and risks:

- New membership, invitation, bootstrap, and recovery persistence requires migration,
  route guards, and UI/CLI work.
- The first-admin migration rule is necessarily an inference for old databases and
  must be shown in an operator-facing report.
- Project owners now carry responsibility for human membership and machine-token
  management; a future delegated access role may be needed if teams outgrow this
  coarse model.
- Offline recovery must be implemented and documented before public signup is closed,
  or operators could lock themselves out of an instance without mail delivery.

## Open questions before acceptance

- Should member-created projects remain enabled by default, or should an instance
  admin be able to disable project creation before the first team rollout?
- Should verified email become mandatory for all invited accounts when mail is
  configured, or only for password reset and subsequent invitations?
- Should project owners be allowed to invite a new account directly, or should all
  invitations be initiated from the instance Members surface for clearer governance?
- What exact recovery command and confirmation UX can be implemented safely against
  Better Auth without exposing a reusable credential?
- What anonymization contract is required if an operator requests deletion of a
  person's email/name while retaining attribution and audit history?

## Phased implementation proposal

1. **Foundation and migration:** add instance state, instance memberships, project
   memberships, invitations, role checks, migration report, and deterministic legacy
   backfill. Keep existing project actors and tokens intact.
2. **Bootstrap and invitation UX:** gate first-account signup, close anonymous signup,
   add admin/member and project-membership surfaces, copyable one-use invitation links,
   and clear no-mail states.
3. **Authorization cutover:** apply instance-admin guards to provider-application
   settings, project-role guards to project routes and token management, and replace
   actor-existence checks in notifications and project reads with active membership
   checks. Add session invalidation on disable/remove.
4. **Recovery and optional mail:** implement local password/admin recovery, optional
   mail transport, verification/reset/invitation templates, and backup/restore
   documentation for environment secrets and Herald business data.
5. **Hardening:** prove race-safe bootstrap, invitation replay/expiry/revocation,
   project isolation, last-admin protection, disabled-session behavior, token
   continuity, notification membership timing, migration idempotence, and redaction
   through focused database/API tests and the supported browser flows.

## Verification targets

Implementation must prove that only one first account can claim an empty instance;
anonymous signup closes after claim; invitations are hashed, single-use, scoped, and
email-bound; disabled/removed users lose access without deleting project credentials;
instance admins cannot read projects without a project role; viewers cannot mutate;
bearer tokens cannot cross into instance administration; provider application secrets,
invitation tokens, and recovery material are never returned or logged; and legacy
databases retain projects, actors, audit history, publisher credentials, and machine
access during migration.
