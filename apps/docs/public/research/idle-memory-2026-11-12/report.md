# Idle memory footprint: Postiz v2.25.3 and Postdot 0.1.0-alpha.7

Observation on one workstation, 2026-11-11 and 2026-11-12. Not a benchmark: no workload, no
account, one host. It answers one question: what do these products hold in memory once
started and left alone, with nothing configured or published? Three fresh runs of each.

## Setup

- Host: AMD Ryzen 7 5800X (8 cores/16 threads), 32 GB, Docker 29.9.3. The repeated runs
  started on a host with no other containers (about 4.7 GB used by the system).
- Postiz: official `postiz-docker-compose` (main, fetched 2026-11-12), image
  `ghcr.io/gitroomhq/postiz-app` v2.25.3 (built 2026-10-24),
  `sha256:1e376ff2cb781022d528f171719cf174cf693a985a30cb40eefb13eae3ddda13`. Unmodified except
  the JWT secret and the image pin. All 8 services; local storage; no social credentials and
  no registered user.
- Postdot: released image 0.1.0-alpha.7,
  `sha256:83d27b3d17fcdde437b9821441c2277dd16b55cba316f0e1399f7e11acf3474f`, one container,
  SQLite and local files, `LOG_LEVEL=error`, no account created.
- Method: [repeat.sh](repeat.sh) starts each product fresh (new volumes), waits 240 s
  (Postiz, after all health checks pass) or 60 s (Postdot, after `/ready`), then takes 16
  `docker stats --no-stream` samples 15 s apart ([sample.sh](sample.sh),
  [summarize.py](summarize.py)). Memory is the container working set. Raw samples:
  `2026-11-12-*-run{1,2,3}.csv`.

## Results (MiB, mean of 16 samples per run)

| Component                                                               | Run 1 | Run 2 | Run 3 |     Mean |
| ----------------------------------------------------------------------- | ----: | ----: | ----: | -------: |
| Postiz application container                                            |  1333 |  1285 |  1291 | **1303** |
| Postiz PostgreSQL + Redis                                               |    46 |    45 |    45 |       45 |
| Temporal stack (server, its PostgreSQL, Elasticsearch, UI, admin tools) |   929 |   966 |   969 |      955 |
| **Postiz, complete compose stack (8 containers)**                       |  2308 |  2296 |  2304 | **2303** |
| **Postdot, one container (SQLite, local files)**                        |  83.9 |  82.9 |  83.1 |   **83** |

Within a run, samples varied by at most about 1 % for Postiz and 11 % for Postdot (80.6 to
90.0 MiB). Idle CPU: Postiz application about 5 % of one core, Postdot about 0.02 %.
Image sizes: Postiz 4.4 GB, Postdot 219 MB.

## Reading

- Postiz documents 2 GB as the all-in-one floor for a single host. Our measured
  complete stack held 2,303 MiB; this does not validate a minimum server size.
- Application containers: about 16:1. Complete deployments: about 28:1. Say which is meant.
- The PostgreSQL and Redis services held about 45 MiB; the Temporal services about 955 MiB.
- The earlier exploratory run (2026-11-11, same method but 8.8 min on a busier host) gave
  1308 MiB for the Postiz application, 2225 MiB for the stack (Temporal services still
  growing) and 85 MiB for Postdot. Kept as `2026-11-11-exploratory-*.csv`.
- Unknown: behaviour under load, after weeks of uptime, with many channels or media, other
  versions or configurations, and what each product is doing with its memory.
  Do not generalize beyond idle.
