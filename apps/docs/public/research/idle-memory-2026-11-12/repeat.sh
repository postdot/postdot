#!/usr/bin/env bash
# Repeated idle-footprint runs for Postiz (official compose) and Postdot (SQLite, local files).
# usage: repeat.sh <work-dir>   (work-dir holds postiz/docker-compose.yaml and postiz/dynamicconfig/)
set -u
W=$1; HERE=$(cd "$(dirname "$0")" && pwd); mkdir -p "$W/out"; cd "$W/postiz"
POSTDOT_IMG=ghcr.io/postdot/postdot@sha256:83d27b3d17fcdde437b9821441c2277dd16b55cba316f0e1399f7e11acf3474f
for run in 1 2 3; do
  # Postiz: fresh stack, 240 s settle after all health checks pass, then 16 samples at 15 s
  docker compose -p postizmeasure up -d --wait --wait-timeout 420 >/dev/null 2>&1
  echo "postiz run $run healthy $(date -u +%T)" >> "$W/out/repeat.log"
  sleep 240
  "$HERE/sample.sh" postizmeasure 16 15 "$W/out/rep-postiz-$run.csv"
  docker compose -p postizmeasure down -v >/dev/null 2>&1
  # Postdot: fresh volume and container, 60 s settle after /ready, then 16 samples at 15 s
  docker volume create postdotmeasure-data >/dev/null
  docker run -d --name postdotmeasure --init --label com.docker.compose.project=postdotmeasure \
    -p 127.0.0.1:3917:3000 -v postdotmeasure-data:/data -e NODE_ENV=production -e PORT=3000 \
    -e DB_FILE_NAME=/data/postdot.sqlite -e POSTDOT_MIGRATIONS_DIR=/app/migrations \
    -e POSTDOT_WEB_ASSETS_DIR=/app/public -e POSTDOT_MEDIA_DIRECTORY=/data/media -e LOG_PRETTY=false \
    -e LOG_LEVEL=error -e POSTDOT_HTTP_PORT=3000 -e BETTER_AUTH_URL=http://127.0.0.1:3917 \
    -e POSTDOT_WEB_ORIGIN=http://127.0.0.1:3917 -e BETTER_AUTH_SECRET="$(openssl rand -hex 32)" \
    -e POSTDOT_MEDIA_PUBLIC_URL_SECRET="$(openssl rand -hex 32)" \
    -e POSTDOT_PUBLISHER_ENCRYPTION_KEY="$(openssl rand -hex 32)" -e POSTDOT_PUBLISHER_ENCRYPTION_KEY_ID=v1 \
    -e POSTDOT_MEDIA_STORE=local -e POSTDOT_MEDIA_STORE_ID=local-default "$POSTDOT_IMG" >/dev/null
  until curl -sf http://127.0.0.1:3917/ready >/dev/null; do sleep 1; done
  echo "postdot run $run ready $(date -u +%T)" >> "$W/out/repeat.log"
  sleep 60
  "$HERE/sample.sh" postdotmeasure 16 15 "$W/out/rep-postdot-$run.csv"
  docker rm -f postdotmeasure >/dev/null; docker volume rm postdotmeasure-data >/dev/null
done
echo "done $(date -u +%T)" >> "$W/out/repeat.log"
