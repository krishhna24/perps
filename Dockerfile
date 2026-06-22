FROM oven/bun:1.3.14 AS build
WORKDIR /app
COPY . .

ENV DATABASE_URL=postgresql://placeholder:placeholder@localhost:5432/placeholder

RUN bun install --frozen-lockfile
RUN bun run build --filter=!web

FROM oven/bun:1.3.14 AS runtime
WORKDIR /app
ENV NODE_ENV=production
RUN apt-get update && apt-get install -y --no-install-recommends curl procps \
  && rm -rf /var/lib/apt/lists/*
COPY --from=build /app /app

CMD ["bun", "apps/server/src/index.ts"]
