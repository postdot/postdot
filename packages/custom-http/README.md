# Herald Custom HTTP

`@herald/custom-http` executes automatic delivery for runtime-defined Herald
channels. It accepts a versioned declarative contract and never evaluates code
from a channel profile.

## Delivery modes

### `herald_webhook`

The default mode sends one `POST` request to the connection origin. The JSON
envelope contains the immutable delivery identity, publication timing, channel
identity, validated target content, and media metadata. Storage locators and
secrets are excluded.

The request is authenticated with the connection secret:

```text
x-herald-timestamp: <unix timestamp in seconds>
x-herald-signature: sha256=<hex HMAC-SHA256(secret, timestamp + "." + body)>
```

Receivers should verify the signature against the exact request bytes and reject
timestamps outside their replay window. A successful `2xx` response completes the
delivery. `429` is retryable, other `4xx` responses are rejected, and transport
errors, timeouts, and unclassified responses remain ambiguous.

### `mapped_http`

This mode sends one `POST`, `PUT`, or `PATCH` request. The profile may map bounded
JSON Pointer values from target content and execution context into:

- path segments and query parameters;
- non-reserved headers;
- JSON, URL-encoded form, or multipart bodies;
- bounded arrays and objects;
- short-lived signed media URLs supplied by the application or streamed multipart
  media. Herald's application layer owns the URL authority; this package never
  constructs a storage URL.

The connection owns the fixed origin and authentication secret. A mapped profile
may select `none`, bearer, or one connection-owned header authentication, but it
cannot read secrets from content or redefine the connection origin. A mapped
profile may also use one dedicated `{ "kind": "secret" }` path segment when the
connection selects `path` authentication; the segment is encoded as one URL
component at delivery time. It cannot be used in a query, header, or body, and
path authentication is not available for `herald_webhook`. Response status
classes and optional remote identifiers are declared by the profile.

For example, a path-authenticated profile can use:

```json
{
    "method": "POST",
    "path": ["hooks", { "kind": "secret" }, "publish"],
    "response": {
        "successStatuses": [200, 202],
        "retryableStatuses": [429],
        "rejectedStatuses": [400, 401, 403],
        "ambiguousStatuses": [500]
    }
}
```

The connection still stores only the origin in `endpointUrl`; the secret remains
in the encrypted publisher credential. The exact encoded request URL is never
included in Herald envelopes, mapped content, errors, or logs.

## Network boundary

Public HTTPS endpoints are allowed by default. Public plain HTTP, private
addresses, infrastructure metadata addresses, redirects, URL credentials, and
non-HTTP schemes are rejected. An instance operator may explicitly allow an exact
private hostname or a bounded private CIDR with a port and scheme. DNS is resolved
and checked for every attempt, and the validated address is pinned for the
request.

Code-owned per-instance providers can use the same boundary through
`createNetworkControlledFetcher`. The application composition root supplies the
operator's private-destination rules; provider packages do not read environment
variables or decide whether a network address is trusted. The shared policy is
configured by `HERALD_OUTBOUND_PRIVATE_DESTINATIONS` in the API process.

All request and response sizes are bounded. Request construction is structural;
scripts, arbitrary functions, filesystem access, environment access, and
multi-request protocols are outside this package. Such integrations belong in a
separately governed built-in channel or connector.
