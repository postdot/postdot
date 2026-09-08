# Provider deployment requirements

Herald does not impose one global DNS or HTTPS requirement. The requirement is
defined by the provider flow being used. The application can remain a simple
single-process self-hosted deployment while a particular provider may require a
public callback or a public client document.

## Common Herald requirements

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

## Bluesky / AT Protocol

Herald supports two OAuth deployment profiles:

### Local loopback development

Select **Local loopback** when the Herald API and browser run on the same
machine. This uses the AT Protocol's official native loopback client ID
(`http://localhost`) and a callback on a loopback IP. No tunnel, DNS record,
public metadata URL, or Bluesky developer application is required.

Use the same loopback literal for the API, Vite proxy, and dashboard. The
recommended setup is:

```dotenv
# apps/api/.env
BETTER_AUTH_URL=http://127.0.0.1:3000
HERALD_WEB_ORIGIN=http://127.0.0.1:5173

# apps/web/.env
HERALD_API_ORIGIN=http://127.0.0.1:3000
```

Open the dashboard at `http://127.0.0.1:5173`, not `http://localhost:5173`.
This consistency is required because the Herald session cookie is host-bound.
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
does not require a separate proxy service: the Herald API serves the metadata
route itself. A reverse proxy or tunnel is only one way to make that API
origin reachable; it is not a Herald runtime dependency.

Analytics through Bluesky's public API does not require OAuth or either of these
web deployment profiles. Only account authorization and authenticated
publishing do.

## Other providers

Provider setup remains provider-specific:

- LinkedIn and X use provider applications with client identifiers and secrets,
  plus the exact callback URLs required by each provider. A production OAuth
  deployment will normally use HTTPS, while local provider rules must be
  checked against the provider's current application policy.
- DEV.to uses an API token entered through Herald's runtime settings and does
  not use the Bluesky metadata or callback model.
- Providers with per-instance or token-based flows may need only the instance
  origin or token and do not automatically inherit Bluesky's public HTTPS
  requirement.

When a new provider is added, its adapter must document its own callback,
credential, destination, and reachability requirements. Adding that provider
must not silently turn DNS or HTTPS into a global requirement for Herald.
