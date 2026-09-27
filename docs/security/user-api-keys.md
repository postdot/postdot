# User-Owned API Keys

API keys are user-owned credentials for external Herald clients. A key is not a
separate user or integration identity; it authenticates as its owner.

## Effective access

For a project operation, Herald requires all applicable boundaries to allow it:

- the owner currently has the required project role;
- the project is included in the key's project scope;
- if the key is limited, its action list includes the required capability.

Keys without an action limit inherit the owner's current project actions. This
also applies to existing keys whose Better Auth permission record is null.
Limited keys use Better Auth's native `apikey.permissions` storage field, but
Herald explicitly authorizes each route. In this Herald policy, null means “no
key-level action limit”; it does not rely on Better Auth treating null as a
wildcard. Unknown routes are denied to API keys until they receive an explicit
capability mapping.

## Capabilities

| Capability | Allows |
| --- | --- |
| `project:read` | Read project content, channels, media, publications, and cached analytics. |
| `publication:manage` | Create and edit publication drafts, duplicate or remove drafts, and manage publication tags and project taxonomy. |
| `publication:dispatch` | Schedule, cancel, publish, retry, or reconcile publication work. |
| `channel:manage` | Create and manage channels and profiles, and configure custom HTTP publishers. Built-in publisher OAuth remains session-only. |
| `media:manage` | Upload, import, trash, and restore media. |
| `analytics:refresh` | Explicitly call a supported provider to refresh publication analytics. Reading cached observations needs only `project:read`. |
| `media:permanently_delete` | Permanently delete trashed media. This is separate from `media:manage`. |

These capabilities are ceilings, not grants: a key cannot exceed its owner's
current role. Workspace or project access administration, account and API-key
management, built-in publisher OAuth, notifications and realtime streams,
project audit events, and installation administration require a human session.

## Use a key

Send the one-time secret as a bearer token:

```http
Authorization: Bearer herald_pat_…
```

The key's project scope and action limit can be changed from Settings → API
keys. Changes take effect on the next request. An unrestricted action setting
is represented by `actionAccess: null` in the session-only key-management API;
a limited key supplies one or more capability names. The key-management API
itself cannot be called with an API key.
