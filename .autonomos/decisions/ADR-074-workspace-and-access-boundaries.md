# ADR-074 — Establish Workspace and Access Boundaries

- Status: accepted — implemented
- Scope: Better Auth organization/team usage, Postbot instance access, project authorization, and invitations
- Provenance: product direction discussion on 2026-09-18
- Supersedes: the assumption that one Better Auth organization is the complete Postbot project boundary

## Context

Postbot currently exposes two different access systems:

- Postbot-owned `instance_memberships` and instance invitations, with `admin` and
  `member` roles;
- Better Auth Organization memberships and invitations, currently created one
  per Postbot project and projected into project access.

This previously made a Better Auth organization function as both a workspace
and a project. An instance invitation therefore granted access to Postbot but
did not grant access to a project. A newly invited user could legitimately have
no visible project, even though that was not the intended product experience.

The product needs to support the following primary use case without making the
user reason about multi-tenancy:

- one person self-hosts Postbot;
- one installation contains a personal project, a business project, and an
  open-source project;
- each project owns its channels, media, and publications;
- collaborators can be granted access to selected projects.

The model must also leave room for small teams and stronger workspace
separation without prematurely becoming a public SaaS tenancy platform.

## Decision

### 1. Use five distinct product concepts

```text
Postbot installation
└── Workspace
    ├── Members and groups
    └── Projects
        └── Channels
            └── Publications
```

| Concept      | Product meaning                                                                         | Primary authority                           |
| ------------ | --------------------------------------------------------------------------------------- | ------------------------------------------- |
| Installation | One self-hosted Postbot deployment and its global configuration                          | Instance administration                     |
| Workspace    | Ownership, membership, and security boundary for a set of projects                      | Better Auth organization                    |
| Project      | A communication identity or operating context such as Personal, Company, or Open Source | Postbot domain model                         |
| Channel      | A concrete social destination/account owned by a project                                | Postbot domain model                         |
| Group        | A reusable set of workspace members which grants project access                         | Better Auth team plus Postbot project grants |

`workspace` is the canonical product term. `organization` remains an
implementation term when required by Better Auth; the UI must not expose both
as separate concepts.

### 2. Map Better Auth primitives deliberately

The recommended technical mapping is:

| Better Auth primitive     | Postbot responsibility                                                 |
| ------------------------- | --------------------------------------------------------------------- |
| `organization`            | Workspace membership, ownership, and workspace-level roles            |
| `member`                  | A user's membership in a workspace                                    |
| `invitation`              | A workspace invitation, optionally targeted at a Better Auth team     |
| `team`                    | A workspace group used to collect members                             |
| `teamMember`              | Membership in a group                                                 |
| `admin` plugin user role  | Instance-level administration and global user operations              |
| Postbot tables/projections | Project membership, group-to-project grants, and domain authorization |

Better Auth's organization plugin already supports custom roles, invitations,
teams, team-targeted invitations, and organization-scoped permission checks.
Its team membership record does not carry a Postbot project role, so project
authorization remains a domain concern rather than being forced into a global
organization role.

The initial implementation should therefore not create a custom authentication
system or duplicate Better Auth's organization memberships. It should add only
the Postbot projection needed to answer:

```text
Does this user have this role on this project in this workspace?
```

### 3. Keep instance administration separate

The Better Auth `admin` role represents the installation operator, not a
workspace administrator. The current Postbot `instance_memberships` table is a
migration-era access projection and must not become a second permanent source
of truth for instance roles.

An instance administrator can:

- configure authentication, provider applications, storage, and maintenance;
- manage instance-level users and security controls;
- create, archive, or recover workspaces;
- appoint workspace owners or administrators;
- inspect operational metadata and audit information.

An instance administrator must not automatically become a routine editor of
every publication. Any exceptional support access to workspace content should
be explicit, time-bounded where possible, and auditable.

The first account created during setup receives both the instance administrator
role and ownership of the default workspace. This keeps the solo self-hosted
experience simple while preserving the conceptual separation.

During migration, existing instance memberships may continue to protect legacy
routes, but new authorization code must use the Better Auth admin role for
instance administration and Better Auth organization membership for workspace
access. A normal collaborator invitation must never create only an instance
membership.

### 4. Define workspace administration

Workspace owners and administrators can:

- manage workspace members and groups;
- create, archive, and configure projects;
- grant project roles to groups or individual members;
- manage channels and project-level credentials;
- manage publications, media, and project settings.

They cannot change instance-wide authentication or storage settings and cannot
administer other workspaces.

The initial project roles remain:

| Role   | Scope                                                                                                     |
| ------ | --------------------------------------------------------------------------------------------------------- |
| Owner  | Full control of a project; normally the workspace owner or an explicitly appointed project owner          |
| Editor | Read and modify project content, channels, and drafts; publication capabilities follow the project policy |
| Viewer | Read-only access to the project                                                                           |

The first version should avoid channel-specific ACLs. Channels inherit the
project boundary.

### 5. Make groups useful without making them mandatory

Groups are workspace-local and should be the preferred way to administer teams:

- `Administrators` — workspace-wide administration;
- `Editors` — editor access to selected projects;
- `Reviewers` — review/read access to selected projects;
- `Viewers` — read-only access to selected projects.

A group-to-project grant includes the effective project role. Direct project
membership can remain available for exceptional cases, but the normal invite
flow should select a workspace group or a project assignment rather than
requiring an administrator to manage individual memberships repeatedly.

No nested groups, cross-workspace groups, or channel-level groups are included
in this decision.

### 6. Make invitations contextual

The normal invitation flow is workspace-scoped:

1. A workspace administrator chooses an email address.
2. They choose a group or an explicit project assignment.
3. Better Auth sends a workspace invitation, optionally with its `teamId`.
4. Acceptance creates the workspace membership and group membership.
5. Postbot redirects the user to the invited workspace and first accessible project.

Instance invitations are reserved for bootstrap and operational administration.
They must not be the normal way to invite a collaborator.

If a signed-in user has an instance membership but no workspace membership, the
application must show a pending-assignment state rather than an empty project
creation experience.

### 7. Implement the boundary in safe slices

The first implementation slice establishes the boundary without rewriting every
project route at once:

- `workspaces` is the Postbot projection backed by one Better Auth organization;
- the first account receives a default workspace and the starter groups
  Administrators, Editors, Reviewers, and Viewers;
- projects carry a `workspace_id`;
- accepting the current instance invitation also creates membership in the
  default workspace and grants read access to the projects already in it;
- projects do not carry a project-specific Better
  Auth organization identifier;
- the disposable development database was reset after the boundary was
  implemented, so no legacy project organization data needs to be carried
  forward.

The Better Auth organization is deliberately not exposed as a second product
concept. It backs the workspace only; it is not a project authorization source.

The next implementation slice now exposes the workspace boundary through a
small session-only API:

- users can list the workspaces they belong to and inspect a workspace's
  members and groups;
- workspace owners and administrators can invite an email to a workspace,
  optionally targeting one of the workspace groups;
- invited users can accept the invitation through a Postbot route, which calls
  Better Auth's organization invitation primitive and keeps the legacy
  instance-membership projection synchronized;
- project API tokens and project-specific organizations cannot call these
  routes.

This makes the intended workspace flow testable. A workspace member still
needs an explicit project grant to see project content; workspace membership
alone is not content access. Accepting an instance invitation grants viewer
access to the projects already in the default workspace as an explicit
bootstrap rule.

The project-grant projection is now implemented as the next slice:

- `project_user_grants` stores direct Postbot user-to-project roles;
- `project_team_grants` stores workspace-team-to-project roles;
- access checks resolve the highest effective role across direct and team
  grants only; Better Auth organization membership is not project access;
- team grants are exposed through session-only project routes, and team-member
  hooks provision the project actor needed by existing project listing and
  domain operations;
- project invitations use the workspace organization and create Postbot grants;
  user-owned API keys keep the creator as their identity and optionally narrow
  requests to selected projects through key metadata.

The project member and invitation routes now read and mutate the Postbot grant
projection. Project invitations use Better Auth workspace invitations with
`projectId` and `projectRole` custom fields; accepting one keeps the workspace
membership in Better Auth and creates the corresponding Postbot user grant.
Existing workspace members should receive a direct grant instead of another
invitation. The schema no longer retains a project organization field, and API
keys are owned by their creating user rather than by a project organization.

Workspace group administration is now exposed as a Postbot access surface:

- Better Auth owns team creation, renaming, and membership mutations;
- workspace owners and administrators are authorized by Postbot before those
  operations are called;
- group-member reads use a workspace-scoped access-store query because
  Better Auth's `listTeamMembers` endpoint additionally requires the caller to
  belong to the team being inspected, which would incorrectly hide a group
  from a workspace administrator who has not joined it;
- group deletion is intentionally deferred because deleting a team cascades
  project-team grants and would need an explicit impact preview first.

Workspace membership administration is now exposed beside group administration:

- workspace owners and administrators can promote or demote non-owner members;
- they can remove non-owner members without using instance administration;
- the owner and the acting member are protected from accidental role or removal
  changes, and the last administrator cannot be demoted;
- project access resolution requires an active Better Auth workspace membership,
  including team-derived access, so removing a workspace member also revokes
  effective project access even if a stale grant record remains.

## Permission matrix

| Capability                               |         Instance admin | Workspace owner/admin |      Project owner |           Editor | Viewer |
| ---------------------------------------- | ---------------------: | --------------------: | -----------------: | ---------------: | -----: |
| Change Postbot authentication and storage |                    Yes |                    No |                 No |               No |     No |
| Manage instance users and security       |                    Yes |                    No |                 No |               No |     No |
| Create or archive a workspace            |                    Yes |                    No |                 No |               No |     No |
| Manage workspace members and groups      |        Appoint/recover |                   Yes |                 No |               No |     No |
| Create or archive projects               |        Appoint/recover |                   Yes | Yes, within policy |               No |     No |
| Grant project access                     |        Appoint/recover |                   Yes |                Yes |               No |     No |
| Manage channels and credentials          | Emergency/support only |                   Yes |                Yes | Policy-dependent |     No |
| Create and edit publications             | Emergency/support only |                   Yes |                Yes |              Yes |     No |
| Publish or schedule                      | Emergency/support only |                   Yes |                Yes | Policy-dependent |     No |
| Read project content                     |         Not by default |                   Yes |                Yes |              Yes |    Yes |

The `Appoint/recover` wording is intentional: the instance administrator can
recover or reassign ownership as an operational authority, but that is not the
normal workspace workflow.

## Alternatives considered

### Keep Better Auth organization as one organization per project

Rejected as the long-term model. It matches the current implementation, but it
forces workspace membership and project membership to be the same thing. It
also explains the current blank-space invitation behavior.

### Add a custom Postbot workspace above the existing Better Auth organizations

Useful as a migration bridge, but not preferred as the final model. It would
duplicate workspace memberships and invitations beside Better Auth's native
organization system, increasing synchronization and authorization risks.

### Use Better Auth teams as projects and skip Postbot project authorization

Rejected. Better Auth teams provide group membership, but their membership
record does not express Postbot's project roles or publication capabilities. The
domain still needs a project authorization projection.

### Build full SaaS tenancy now

Deferred. The current product hypothesis is self-hosted personal and small-team
use. Billing, tenant provisioning, high-scale workers, provider quotas, and
large OAuth fleets are not required to validate that hypothesis.

## Migration direction

The first implementation migration adds the workspace projection, team tables,
the default workspace pointer, and `projects.workspace_id`. The workspace
column remains nullable during this disposable development phase so isolated
domain tests and old fixtures can still construct projects without an auth
context; the application project-creation route always supplies it. The
current access-control slice establishes these invariants for application data:

1. Every project belongs to exactly one workspace.
2. Every workspace is backed by exactly one Better Auth organization.
3. Every workspace member is represented by Better Auth.
4. Every project authorization check is scoped by both workspace and project.
5. The Better Auth admin role is the long-term authority for instance administration.
6. Instance membership never grants project access by itself.
7. Project credentials and content cannot be read through another workspace.
8. An invitation always carries enough context to produce an accessible landing
   destination.

`projects.organization_id` is now a nullable compatibility field only. New
projects leave it empty, member and invitation authorization never consult it,
and new API keys are referenced by the workspace organization. Its eventual
removal can therefore be a reset-time schema cleanup rather than a live
authorization migration.

Development data is intentionally disposable at this stage. A local SQLite
file may be backed up temporarily and recreated after a schema change; no
production-data migration or organization merge is implied. When real data
preservation becomes relevant, existing project organizations and memberships
must be backfilled into workspaces with a verified rollback path rather than
merged destructively.

## Risk register

| Risk                                                          | Category  | Likelihood | Impact | Mitigation                                                                 |
| ------------------------------------------------------------- | --------- | ---------: | -----: | -------------------------------------------------------------------------- |
| Existing project organizations are merged incorrectly         | Technical |     Medium |   High | Backfill with stable mapping and keep rollback data                        |
| Instance membership is accidentally treated as content access | Security  |       High |   High | Centralize workspace/project authorization and add cross-scope tests       |
| Groups make the solo experience feel like enterprise software | Product   |     Medium | Medium | Create a default workspace and hide group management unless needed         |
| Better Auth roles are mistaken for project roles              | Technical |     Medium |   High | Keep instance roles, workspace roles, and project grants as separate types |
| A global admin reads workspace content by default             | Privacy   |     Medium |   High | Use explicit recovery access and audit events                              |
| Migration scope delays core product work                      | Execution |       High | Medium | Implement the smallest workspace projection first; defer advanced groups   |

## Scope boundary

### Must Have

- One default workspace during setup.
- A separate instance-admin boundary.
- Workspace membership and workspace-level roles.
- Projects explicitly associated with a workspace.
- Project-scoped authorization.
- Contextual workspace/project invitations.
- No blank dashboard after accepting an invitation.

### Should Have

- Better Auth teams exposed as workspace groups.
- Group-to-project grants with project roles.
- A dedicated instance administration area.
- Workspace administration screens.
- Explicit recovery/audit behavior for instance administrators.
- Multiple workspaces per installation, with a switcher only when needed.
- Retirement of the legacy instance-membership role authority.

### Deferred

- Channel-level ACLs.
- Nested or cross-workspace groups.
- Billing, SaaS provisioning, and tenant quotas.
- Enterprise SSO/SCIM workflows.
- Large-scale distributed execution.

## Consequences

- Postbot gains a coherent hierarchy without exposing tenancy jargon to solo
  users.
- Better Auth handles identity, workspace membership, invitations, teams, and
  workspace roles instead of being reimplemented by Postbot.
- Postbot retains a small, explicit projection for project-level authorization,
  which is necessary because project roles are domain-specific.
- The first migration is substantial and must be treated as an architecture
  project, not as a route rename.
- Existing project member and instance access screens should be consolidated
  only after the data model and backfill plan are validated.
