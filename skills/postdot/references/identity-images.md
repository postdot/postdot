# Identity images (current source API)

Use these operations only on instances whose `/openapi/json` advertises them.
They are source features; the alpha.7 reference does not promise them in an older
published installation.

Projects, workspaces and channels return `websiteUrl`, `imageUrl` and
`imageSource` (`upload`, `url`, `favicon` or null). Built-in platform channels
keep their brand logo. Custom channel identity follows the channel across its
project attachments.

| Scope     | Base path                                        | Capability         |
| --------- | ------------------------------------------------ | ------------------ |
| Project   | `/api/projects/{projectId}`                      | `project:manage`   |
| Workspace | `/api/workspaces/{workspaceId}`                  | `workspace:manage` |
| Channel   | `/api/projects/{projectId}/channels/{channelId}` | `channel:manage`   |

Append the operation to the base path:

| Method and suffix     | Body                                                            | Effect                                                                                         |
| --------------------- | --------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `PUT /website`        | `{"websiteUrl":"https://example.com"}` or `{"websiteUrl":null}` | Set/clear the website; automatically resolve an icon unless an explicit image takes precedence |
| `POST /image`         | Multipart `file`, raw bytes, or `{"base64":"…"}`                | Upload and normalize an image                                                                  |
| `POST /image/url`     | `{"url":"https://example.com/logo.png"}`                        | Copy and normalize a remote image                                                              |
| `POST /image/favicon` | None                                                            | Replace the image with the saved website's icon                                                |
| `DELETE /image`       | None                                                            | Remove the image while retaining the website                                                   |

Channel JSON website/URL bodies accept `expectedRevision`; binary uploads,
favicon refresh and deletion accept it as a query parameter. Reread a stale
channel before deciding how to retry. Only a live channel manager can mutate a
shared channel; an editor on another attached project cannot. Workspace changes
require a workspace owner/admin and an unrestricted key with workspace authority.

The 2 MB input limit applies to decoded raster bytes. Type sniffing accepts PNG,
JPEG, WebP, GIF and ICO, rejects SVG, limits canvas size and re-encodes to a square
WebP at most 256 px. Responses use content-hashed same-origin `imageUrl` values.
Authenticated reads require access to a referencing project/workspace and use
private immutable caching. Storage lives in the database and follows database
backup/transfer; there is no operator-supplied filesystem path.

Remote fetches allow only HTTP(S), reject credentials and check resolved
addresses on every redirect through the shared outbound policy. The transport
pins the selected validated IP. HTML and image sizes and redirects are bounded; the whole remote operation
shares an eight-second deadline, including DNS authorization. Private destinations need an explicit installation policy allowance.
A website can be saved with a warning when no supported icon is available;
network policy refusals do not save it. Uploaded/imported images survive website
changes. Removal restores the monogram; selecting the website icon is explicit.

MCP exposes the same five operations per scope: `set_project_website`,
`upload_project_image`, `import_project_image_url`, `use_project_website_icon`,
`remove_project_image`, with `workspace` or `project_channel` replacing `project`.
Uploads accept `base64`. Workspace tools require `confirm:true`. CLI subcommands
under `projects`, `workspaces` and `channels` are `set-website`, `upload-image`,
`import-image-url`, `use-website-icon` and `remove-image`. Use `--help` for scope
flags; the bundled HTTP helper handles JSON/base64 bodies without a CLI install.
