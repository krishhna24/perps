# syntax=docker/dockerfile:1

FROM oven/bun:1.3.14 AS build
WORKDIR /app

ENV DATABASE_URL=postgresql://placeholder:placeholder@localhost:5432/placeholder

ARG NEXT_PUBLIC_API_URL=http://localhost:3000
ARG NEXT_PUBLIC_WS_URL=ws://localhost:8080
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
ENV NEXT_PUBLIC_WS_URL=$NEXT_PUBLIC_WS_URL

COPY . .
RUN bun install --frozen-lockfile
RUN bun run build

FROM oven/bun:1.3.14 AS backend-deps
WORKDIR /app
ENV DATABASE_URL=postgresql://placeholder:placeholder@localhost:5432/placeholder
COPY . .
RUN rm -rf apps/web && bun install --omit=dev
COPY --from=build /app/packages/db/generated ./packages/db/generated

FROM oven/bun:1.3.14-slim AS backend
ENV NODE_ENV=production
WORKDIR /app

COPY --from=backend-deps --chown=bun:bun /app /app

USER bun

CMD ["bun", "apps/server/src/index.ts"]

FROM build AS migrate
WORKDIR /app
USER bun
CMD ["sh", "scripts/init.sh"]

FROM oven/bun:1.3.14-slim AS web
ENV NODE_ENV=production
WORKDIR /app

COPY --from=build --chown=bun:bun /app/apps/web/.next/standalone ./
COPY --from=build --chown=bun:bun /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=build --chown=bun:bun /app/apps/web/public ./apps/web/public

USER bun
ENV PORT=3001
ENV HOSTNAME=0.0.0.0
EXPOSE 3001
CMD ["bun", "apps/web/server.js"]
