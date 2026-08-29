FROM oven/bun:1.4.0 AS build

WORKDIR /app

COPY package.json bun.lock turbo.json tsconfig.json bunfig.toml ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/auth/package.json packages/auth/package.json
COPY packages/client/package.json packages/client/package.json
COPY packages/core/package.json packages/core/package.json
COPY packages/db/package.json packages/db/package.json
COPY packages/linkedin/package.json packages/linkedin/package.json
COPY packages/oauth/package.json packages/oauth/package.json

RUN HUSKY=0 bun install --frozen-lockfile

COPY . .

RUN bun run build
RUN mkdir -p /out/migrations /out/public
RUN cp apps/api/dist/index.js /out/herald.js
RUN cp -R packages/db/drizzle/. /out/migrations/
RUN cp -R apps/web/dist/. /out/public/

FROM oven/bun:1.4.0-slim

WORKDIR /app

COPY --from=build --chown=bun:bun /out/herald.js ./herald.js
COPY --from=build --chown=bun:bun /out/migrations ./migrations
COPY --from=build --chown=bun:bun /out/public ./public

RUN mkdir -p /data && chown bun:bun /data

ENV NODE_ENV=production
ENV PORT=3000
ENV DB_FILE_NAME=/data/herald.sqlite
ENV HERALD_MIGRATIONS_DIR=/app/migrations
ENV HERALD_WEB_ASSETS_DIR=/app/public

USER bun

VOLUME ["/data"]
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 CMD ["bun", "-e", "if (!(await fetch('http://127.0.0.1:3000/health')).ok) process.exit(1)"]

ENTRYPOINT ["bun", "/app/herald.js"]
