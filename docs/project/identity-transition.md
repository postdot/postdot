# Postdot identity transition

Postdot is the current product name. The existing GitHub repository was renamed
and transferred to postdot/postdot with its history and pull requests intact.
The checkout is now named postdot, and workspaces use the @postdot npm scope.
These workspace packages remain private; this is not an npm package release.

Use `bun run postdot` for the CLI. `bun run postbot` remains an alias for existing
local commands. Both invoke the same implementation and API with the same access
controls; there is no second client or authentication path.

## Existing installations and stored data

This stage changes the presentation, workspace namespace and repository identity.
It does not migrate databases or require reconnecting provider accounts.

- Keep using the documented `POSTBOT_*` deployment variables for now, including
  the encryption key and key ID. Do not generate a replacement key because the
  product name changed. `POSTDOT_*` deployment aliases are not implemented yet.
- Preserve the existing database path, runtime lock, media directories and Compose
  data volume. The Compose service and its volume still use their prior names.
- Stored API-key prefixes/metadata, custom HTTP profile modes, Bluesky session
  fields, database columns and encrypted-envelope authenticated data remain stable.
  Their names are storage protocols, not instructions to rename rows or secrets.
- Current screenshots and historical task/decision records can show earlier names.
  Source history remains intact; current-document privacy edits do not erase old
  versions from Git.

New provider registrations use the Postdot display name. Existing project-owned
connections retain their stored identity, credentials and granted permissions.
No provider publishing or reconnection was performed for this rename.

The remaining deployment-name transition must preserve compatibility explicitly.
Do not replace every old string mechanically or move an installation to an empty
volume. Public source visibility, container/package publication and site deployment
are separate operations; no site framework migration is part of this transition.
