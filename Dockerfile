# cspell:words ffplay ffprobe avcodec avformat avfilter swscale demuxer mjpeg muxer buffersink hflip vflip
# Isolated from application sources so normal Postdot builds reuse this layer.
FROM oven/bun:1.4.4-slim AS poster
USER root
RUN apt-get update && apt-get install -y --no-install-recommends build-essential xz-utils curl ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /src
RUN curl --fail --location --max-time 120 https://ffmpeg.org/releases/ffmpeg-9.0.2.tar.xz -o source.tar.xz \
    && echo '8c3850283eb25fa026482078a04051e0be17347b09ef81a0849bec15a96e002e  source.tar.xz' | sha256sum -c - \
    && tar -xf source.tar.xz
WORKDIR /src/ffmpeg-9.0.2
RUN ./configure --disable-everything --disable-autodetect --disable-doc --disable-debug --disable-network --disable-asm --disable-ffplay --disable-ffprobe \
    --enable-ffmpeg --enable-avcodec --enable-avformat --enable-avfilter --enable-swscale --enable-protocol=file,pipe \
    --enable-demuxer=mov --enable-decoder=h264 --enable-parser=h264 --enable-encoder=mjpeg --enable-muxer=image2pipe \
    --enable-filter=scale,format,buffer,buffersink,transpose,hflip,vflip --enable-small \
    && make -j4

FROM oven/bun:1.4.4 AS build

WORKDIR /app

COPY package.json bun.lock turbo.json tsconfig.json bunfig.toml ./
COPY apps/api/package.json apps/api/package.json
COPY apps/docs/package.json apps/docs/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/auth/package.json packages/auth/package.json
COPY packages/client/package.json packages/client/package.json
COPY packages/core/package.json packages/core/package.json
COPY packages/custom-http/package.json packages/custom-http/package.json
COPY packages/db/package.json packages/db/package.json
COPY packages/devto/package.json packages/devto/package.json
COPY packages/discord/package.json packages/discord/package.json
COPY packages/telegram/package.json packages/telegram/package.json
COPY packages/facebook/package.json packages/facebook/package.json
COPY packages/instagram/package.json packages/instagram/package.json
COPY packages/email/package.json packages/email/package.json
COPY packages/bluesky/package.json packages/bluesky/package.json
COPY packages/linkedin/package.json packages/linkedin/package.json
COPY packages/mastodon/package.json packages/mastodon/package.json
COPY packages/media/package.json packages/media/package.json
COPY packages/oauth/package.json packages/oauth/package.json
COPY packages/ui/package.json packages/ui/package.json
COPY packages/x/package.json packages/x/package.json

RUN HUSKY=0 bun install --frozen-lockfile

COPY . .

RUN bunx --no-install turbo run build --filter=@postdot/api --filter=@postdot/web
RUN mkdir -p /out/migrations /out/public
RUN cp apps/api/dist/index.js /out/postbot.js
RUN cp -R packages/db/drizzle/. /out/migrations/
RUN cp -R apps/web/dist/. /out/public/

FROM oven/bun:1.4.4-slim

WORKDIR /app

COPY --from=poster /src/ffmpeg-9.0.2/ffmpeg /usr/local/bin/postbot-poster
COPY --from=poster /src/ffmpeg-9.0.2/COPYING.LGPLv2.1 ./licenses/FFmpeg.LICENSE
COPY --from=build --chown=bun:bun /app/LICENSE ./LICENSE
COPY --from=build --chown=bun:bun /app/THIRD_PARTY_NOTICES.md ./THIRD_PARTY_NOTICES.md
COPY --from=build --chown=bun:bun /out/postbot.js ./postbot.js
COPY --from=build --chown=bun:bun /out/migrations ./migrations
COPY --from=build --chown=bun:bun /out/public ./public
COPY --from=build --chown=bun:bun /app/docs/licenses/ ./licenses/

RUN mkdir -p /data && chown bun:bun /data

ENV NODE_ENV=production
ENV PORT=3000
ENV DB_FILE_NAME=/data/postbot.sqlite
ENV POSTBOT_MIGRATIONS_DIR=/app/migrations
ENV POSTBOT_WEB_ASSETS_DIR=/app/public

USER bun

STOPSIGNAL SIGTERM

VOLUME ["/data"]
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 CMD ["bun", "-e", "if (!(await fetch('http://127.0.0.1:3000/health')).ok) process.exit(1)"]

ENTRYPOINT ["bun", "/app/postbot.js"]
