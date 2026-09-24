# Prometheus metrics

Herald exposes `GET /metrics` in Prometheus text exposition format. It includes the process CPU time, memory, and uptime, plus publication scheduler state and worker run counts and durations. These metrics are held in memory and reset when the API process restarts.

Herald does not attach user, workspace, project, channel, or provider identifiers to metrics. This keeps the metric set bounded as application data grows.

The endpoint does not require Herald authentication so a scraper can collect metrics without an application account. Restrict access to it at the deployment network boundary: allow requests from the monitoring network and do not expose `/metrics` publicly. If the API is behind a reverse proxy, apply the restriction there.

A Prometheus server can scrape the API using its normal configuration:

```yaml
scrape_configs:
  - job_name: herald
    static_configs:
      - targets: ["herald-api:3000"]
```

Scrape cadence, retention, dashboards, and alert thresholds remain deployment-operator decisions.
