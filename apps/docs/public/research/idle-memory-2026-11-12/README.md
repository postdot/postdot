# Idle-memory measurements, November 12, 2026

[Read the article](/blog/postdot-postiz-idle-memory/) or [download the complete source bundle](/research/idle-memory-2026-11-12/source.zip).

The report records the host, pinned application image digests and measured results.
The six November 12 CSV files contain three fresh runs per product, with 16 sampling
rounds per run. Each row records a container's working-set memory and CPU reading.

## Inspect the results

Run `python3 summarize.py <csv-file>` to inspect a run. The article reports the mean
of the three run means, rounded to whole MiB. MiB is 1,048,576 bytes.

## Run the experiment

Use a disposable Docker host. Copy the retained `postiz/` directory into a separate
working directory, generate a fresh JWT secret with `openssl rand -hex 32`, and
export it as `POSTIZ_MEASUREMENT_JWT`. Run `bash repeat.sh <absolute-work-directory>`
from this bundle. The working directory must contain the `postiz/` folder.

The script starts Postiz, waits for health checks and a 240-second settling period,
then samples its containers. It then starts Postdot with SQLite and local media,
waits for readiness and 60 seconds, and samples that container. It repeats this
sequence three times, using fresh volumes. Results are written to `out/` in the
working directory.

Read the script before running it: it deletes its test containers and volumes
between runs. Use a host without containers or volumes named `postizmeasure`,
`postdotmeasure` or `postdotmeasure-data`. The sampler sleeps 15 seconds between
commands; execution adds time, so the timestamps are not on an exact 15-second grid.

## Configuration and license

The Postiz configuration comes from [gitroomhq/postiz-docker-compose](https://github.com/gitroomhq/postiz-docker-compose).
Its application image is pinned to the measured digest and its generated JWT has
been replaced with an environment variable. The upstream license is retained in
`postiz/LICENSE`. Database passwords are the upstream local-test defaults; this is
an isolated measurement setup, not a public deployment configuration.

Both application images are pinned by digest. Supporting services retain version
tags; their historical digests were not recorded.
