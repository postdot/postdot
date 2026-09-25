# Prometheus metrics

Herald's Prometheus endpoint is opt-in and disabled by default. When enabled,
`GET /metrics` requires a dedicated bearer token; it does not accept a user API
key or browser session.

## Enable or disable

Generate a random token with at least 32 characters and provide both settings to
the API process through its environment or deployment secret manager:

```sh
HERALD_METRICS_ENABLED=true
HERALD_METRICS_TOKEN=<random-secret-token>
```

For example, `openssl rand -hex 32` generates a 64-character token. Do not put
the token in source control, a public URL, or a query parameter. Restart Herald
after changing these settings. If metrics are enabled without a valid token,
Herald refuses to start.

To disable metrics, set `HERALD_METRICS_ENABLED=false` and restart Herald. The
route is then absent and responds with `404`.

## Network boundary and scraping

The bearer token is defense in depth, not a reason to publish the scrape route
to the open internet. Keep the API port on a private network when possible. For
remote monitoring, use a VPN or a firewall/reverse-proxy allowlist and TLS; do
not route `/metrics` to arbitrary public clients. The scrape token should be
stored as a secret file readable by the Prometheus process.

Prometheus configuration for an API reachable as `herald-api:3000` on the
monitoring network:

```yaml
scrape_configs:
  - job_name: herald
    metrics_path: /metrics
    static_configs:
      - targets: ["herald-api:3000"]
    authorization:
      type: Bearer
      credentials_file: /run/secrets/herald-metrics-token
```

The file named by `credentials_file` contains the same token configured as
`HERALD_METRICS_TOKEN`. An unauthorized scrape receives `401`; a successful
scrape returns Prometheus text exposition.

## What Herald records

Metrics are held in process memory and reset when the API restarts. The current
bounded set covers:

- cumulative process CPU time, process memory by runtime category, and process
  uptime;
- the one-hot publication scheduler state;
- completed publication-worker runs and their durations, split by success or
  failure.

No user, workspace, project, channel, or provider identifiers are emitted.
These metrics can help reveal process resource growth or a slow/failing worker;
they do not measure HTTP request latency, database health, or function-level CPU
hotspots. Use application profiling when a code-level performance diagnosis is
needed. Scrape cadence, retention, dashboards, and alert thresholds belong to
the deployment operator.
