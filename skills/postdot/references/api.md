# API access for Postdot 0.1.0-alpha.5

Set `POSTDOT_URL` to the chosen instance origin and `POSTDOT_API_KEY` through the
agent's private secret mechanism or operator-controlled environment. Do not ask
for a key in chat, put it into command arguments or print the environment.
An authorized human creates a suitably scoped key in Studio's personal settings.
HTTPS is required off loopback. The helper refuses redirects so credentials do
not follow an unexpected endpoint. It makes one request, with a 30-second limit,
and never automatically retries a write.

Resolve `SKILL_DIR` to the installed `postdot` skill directory. Then:

```sh
python3 "$SKILL_DIR/scripts/request.py" GET /api/projects
python3 "$SKILL_DIR/scripts/request.py" GET "/api/projects/$PROJECT_ID/channels"
python3 "$SKILL_DIR/scripts/request.py" GET "/api/projects/$PROJECT_ID/channels/$CHANNEL_ID/profile"
python3 "$SKILL_DIR/scripts/request.py" GET "/api/projects/$PROJECT_ID/publishers"
```

Only use IDs returned by the selected instance. The helper accepts JSON files or
stdin for JSON writes. Exit 0 means HTTP success, not publication delivery. Exit 1
means HTTP/transport failure; exit 2 means invalid local input. For HTTP failures
it reports status and API error code without echoing arbitrary server messages.
A transport failure has unknown write outcome. stdout can contain private project
content on successful reads; inspect it privately and summarize only needed facts.

`/openapi/json` on the running instance supplies the full contract. Examples here
match the published alpha, not hypothetical future endpoints. There is no
Postdot MCP server in this release and no standalone npm CLI package to install.
The published application container contains the server/maintenance executable,
not the source CLI script.

If a matching source checkout with dependencies and Bun is already available,
`bun run postdot --help` and `bun run postdot projects list --json` provide the
existing CLI. Do not install an unrelated `postdot` package or clone/install a
whole development environment just to perform an HTTP request. The full source
CLI guide is at
https://github.com/postdot/postdot/blob/e7af5550ffa446f9264ec13159e0ed9e263e1495/apps/docs/content/docs/%28developers%29/%28clients%29/cli-reference.mdx.
