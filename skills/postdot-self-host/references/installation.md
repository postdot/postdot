# Install alpha 0.1.0-alpha.1

Requires Docker Engine/Compose v2.20+, Python 3 for the optional preparer, and an
operator-controlled host. Supported image platforms: Linux AMD64 and ARM64.
The matching application source is commit
`99badfb431b95a817c645e716267815925c1f6cc` in `postdot/postdot`.

Image:
`ghcr.io/postdot/postdot:0.1.0-alpha.1`

Pinned manifest:
`ghcr.io/postdot/postdot@sha256:690778f5d1af8f4a363406b989e17da8672fc764c6e62f9cca8e1a09c483638e`

## Prepare private configuration

Choose a new directory and an origin before executing. Set `SKILL_DIR` to the
installed `postdot-self-host` directory, and `DEPLOY_DIR` to that new destination.
The script refuses a nonempty destination and writes no secret to stdout:

```sh
python3 "$SKILL_DIR/scripts/prepare.py" "$DEPLOY_DIR" --origin https://social.example.com
cd "$DEPLOY_DIR"
docker compose config --quiet
docker compose pull
```

For a protected local installation use `--origin http://127.0.0.1:3000`.
`--port` changes the host-loopback binding; when using a local origin, make its
port match. The public HTTPS origin can use the proxy's normal port independently.
The script generates three independent secrets, pins the published digest and
copies the bundled Compose file. It starts no services. Review `.env` privately;
never paste `docker compose config` output or environment values into a report.
Without Python, copy the two assets into a new private directory, copy the env
example to `.env`, set mode 600, generate three independent 32-byte secrets using
a secure tool, and set `POSTBOT_IMAGE` to the pinned manifest above.

## Start and claim

```sh
docker compose up -d --no-build --wait
curl --fail --silent --show-error http://127.0.0.1:3000/health
curl --fail --silent --show-error http://127.0.0.1:3000/ready
```

Adapt the readiness port if `--port` changed it. Set up the chosen HTTPS proxy
with a protected route first; complete initial account creation before opening
public access. For a remote loopback-only bootstrap, use the user's authorized
SSH tunnel/proxy arrangement. Do not weaken cookie/origin security to bypass it.

Open Studio at the configured origin, create the first administrator account,
create a project and a manual channel, then save/reopen an unscheduled draft.
These checks need no provider request. On a new empty installation, a controlled
restart can verify that the project/draft persist. On an existing installation,
consider scheduled work before restarting; it may interrupt delivery.

Verify HTTPS, application access and a persistence check separately. If readiness
fails, inspect a bounded log interval and retain the existing volume/configuration.
Do not delete volumes or lock/WAL files to force startup.

## Provider connections and email

Connect providers in Studio using an authorized human session. Machine API keys
cannot complete built-in publisher OAuth. The exact OAuth requirements vary:
public Bluesky metadata/callbacks must be reachable at their configured HTTPS
URLs; loopback development uses a distinct profile. Do not invent a universal
callback URL. Inspect the provider's configuration UI and the matching version's
[provider requirements](https://github.com/postdot/postdot/blob/99badfb431b95a817c645e716267815925c1f6cc/docs/deployment/provider-requirements.md).

SMTP is optional. Without it, automatic verification/password-reset emails and
email alerts are unavailable. Copyable invitation links remain available. Do not
make invitation verification mandatory before configuring working email delivery.
An SMTP check sends a real email; use a recipient authorized by the user.

The running instance exposes its API contract at `/openapi/json`. Match the
installed release rather than assuming the repository's latest branch applies.
