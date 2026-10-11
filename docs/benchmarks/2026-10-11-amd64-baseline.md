# AMD64 production container baseline

Measured on 2026-10-11 from commit `da39d10636c3a71ac797e62e08c4972992b1539f`.
This is an idle footprint measurement, not a capacity or minimum-hardware promise.

## Image

- Local image ID: `sha256:4186a104ea63c9821b5b9741833fd0c86d5537f9240a97e12fd58b0a8c0f87dc`.
- Uncompressed Docker image size: **179.7 MiB**.
- Gzip-compressed Docker save archive: **71.5 MiB**.
  This estimates transfer scale; registry layers are compressed individually, so
  it is not an exact GHCR download size.
- Bun 1.4.2; bundled server 5,358,121 bytes; dashboard assets 5,584,772 bytes;
  poster decoder 2,666,080 bytes; license directory 644,295 bytes.
- Image size is storage, not RAM allocated at startup. Shared layers can reduce
  incremental storage; the build cache and persistent data are additional costs.

## Measurements

| Run | Startup to ready | Empty working set | Configured working set | Configured Bun RSS | Configured idle CPU |
| --- | --- | --- | --- | --- | --- |
| 1 | 1.29 s | 97.6 MiB | 100.3 MiB | 143.0 MiB | 0.146% |
| 2 | 0.87 s | 97.6 MiB | 101.2 MiB | 143.0 MiB | 0.149% |
| 3 | 0.85 s | 97.5 MiB | 100.4 MiB | 142.5 MiB | 0.152% |

Configured working-set median across runs: **100.4 MiB**.
Configured Bun RSS median: **143.0 MiB**.
Configured idle CPU median: **0.149% of one core**.

Working set follows Docker's Linux accounting: cgroup memory current minus
inactive file cache. RSS is process resident memory and includes shared pages;
the two numbers measure different things, not competing estimates of the same
quantity. Raw current-memory values and samples are in the adjacent JSON.

## Method and environment

Three fresh containers with independent temporary SQLite/media directories and
loopback-only ports. Empty state follows one dashboard-shell and anonymous-session
read. Configured state adds one administrator and one project. Each phase settles
for ten seconds, then samples once a second over twenty seconds. Read host process
and cgroup counters directly, avoiding measurement subprocesses inside the idle
container. Built-in Docker health checks and server maintenance remain active.

Startup includes container creation and first database migrations. Image download,
build time and cold host filesystem effects are excluded. No resource limits were
set. Host: AMD Ryzen 7 5800X 8-Core Processor, Linux `7.2.9-arch1-1`, Docker 29.9.0,
16 logical CPUs and approximately 31.3 GiB RAM, with ordinary host activity.
The fixture has no channels, media, publication jobs, browser sessions or SSE
connections. No provider calls, email deliveries or shared application data.
All three containers stopped with exit 0. Disposable resources were removed.

## Interpretation and next benchmark scope

The idle footprint is modest, but these short windows cannot establish long-term
memory stability, throughput, media-processing peaks or safe deployment limits.
Do not publish a 128/256 MiB minimum based on these results.

A later representative suite should cover dashboard/API reads, concurrent SSE,
SQLite writes, scheduled publication with simulated providers, image/poster
processing, and sustained operation. Measure tail latency, errors, queue delay,
peak memory and CPU under explicit limits and representative datasets. Start by
comparing 1 vCPU with 512 MiB and 1 GiB as experimental configurations, not declared
requirements. Use those results to choose minimum and recommended resources.

Reference: [Docker memory accounting](https://docs.docker.com/reference/cli/docker/container/stats/).
