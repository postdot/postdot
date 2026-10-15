# Provider deployment requirements

Postbot does not impose one global DNS or HTTPS requirement. The requirement is
defined by the provider flow being used. The application can remain a simple
single-process self-hosted deployment while a particular provider may require a
public callback or a public client document.

## Common Postbot requirements

- Keep the database, `BETTER_AUTH_SECRET`, media signing secret, and publisher
  encryption key in the deployment environment.
- Keep provider application settings and connected account credentials separate.
  Provider applications are instance-level; connected accounts and channels
  remain project-owned.
- In production, use a stable canonical origin for the API and dashboard and
  serve the authenticated application over HTTPS.
- Do not expose client secrets, access tokens, refresh tokens, or provider
  sessions in the browser, logs, or provider metadata documents.

These requirements do not mean that every provider needs a public HTTPS
endpoint. They only become mandatory when the provider's authorization model
requires a public web client or callback.

## Optional account email delivery

Postbot can deliver project invitations, signup verification, and password-reset
messages through an operator-supplied SMTP relay. Configure
`POSTBOT_EMAIL_SMTP_HOST` and `POSTBOT_EMAIL_FROM` in the API environment; port `587`
is the default, `POSTBOT_EMAIL_SMTP_SECURE` selects TLS mode, and username/password
are optional but must be supplied together. Keep credentials in the deployment
secret store or ignored environment file.

SMTP is not required for the local profile: without it, project invitations remain
copyable one-use links. Enable
`POSTBOT_REQUIRE_EMAIL_VERIFICATION_ON_INVITATION=true` only alongside a working
mail transport. SMTP submission is asynchronous and best-effort; delivery
guarantees, retries, bounces, and provider webhooks are outside this boundary.

For local development, `docker-compose.dev.yml` starts a Mailpit relay on
`127.0.0.1:1025` and its inspection UI on `127.0.0.1:8025`. The React Email
templates are owned by the `@postbot/email` workspace package; the API owns only
the SMTP transport and deployment configuration.

## Bluesky / AT Protocol

Postbot supports two OAuth deployment profiles:

### Local loopback development

Select **Local loopback** when the Postbot API and browser run on the same
machine. This uses the AT Protocol's official native loopback client ID
(`http://localhost`) and a callback on a loopback IP. No tunnel, DNS record,
public metadata URL, or Bluesky developer application is required.

Use the same loopback literal for the API, Vite proxy, and dashboard. The
recommended setup is:

```dotenv
# apps/api/.env
BETTER_AUTH_URL=http://127.0.0.1:3000
POSTBOT_WEB_ORIGIN=http://127.0.0.1:5173

# apps/web/.env
POSTBOT_API_ORIGIN=http://127.0.0.1:3000
```

Open the dashboard at `http://127.0.0.1:5173`, not `http://localhost:5173`.
This consistency is required because the Postbot session cookie is host-bound.
The same arrangement can use `[::1]` consistently instead of `127.0.0.1`.

The **Client metadata URL** field must be left empty in this mode. A 404 from
`/oauth/bluesky/client-metadata.json` is expected: loopback clients do not
publish a web metadata document.

### Public HTTPS deployment

Select **Public HTTPS** when the dashboard is deployed for remote access. Enter
a stable HTTPS URL for the client metadata document, and make the API callback
reachable at the public HTTPS origin registered with the AT Protocol
authorization server. The metadata URL must remain fetchable at that exact
URL, and its redirect URI must match the deployed callback exactly.

This mode requires a public DNS name and HTTPS for the web OAuth boundary. It
does not require a separate proxy service: the Postbot API serves the metadata
route itself. A reverse proxy or tunnel is only one way to make that API
origin reachable; it is not a Postbot runtime dependency.

Analytics through Bluesky's public API does not require OAuth or either of these
web deployment profiles. Only account authorization and authenticated
publishing do.

## Other providers

Provider setup remains provider-specific:

- LinkedIn and X use provider applications with client identifiers and secrets,
  plus the exact callback URLs required by each provider. A production OAuth
  deployment will normally use HTTPS, while local provider rules must be
  checked against the provider's current application policy.
- DEV.to uses an API key entered when connecting its project channel and does
  not use the Bluesky metadata or callback model.
- Providers with per-instance or token-based flows may need only the instance
  origin or token and do not automatically inherit Bluesky's public HTTPS
  requirement.

When a new provider is added, its adapter must document its own callback,
credential, destination, and reachability requirements. Adding that provider
must not silently turn DNS or HTTPS into a global requirement for Postbot.
