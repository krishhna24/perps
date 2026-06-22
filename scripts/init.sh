#!/usr/bin/env sh



set -e

ROOT="$(CDPATH= cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT/packages/db"

echo "[init] applying Prisma migrations to the database..."
# Use the workspace-local Prisma via the package script (resolves node_modules/.bin
# with the Linux node). Avoid `bunx`, which on a WSL host can resolve to the Windows
# bunx on PATH and run the win32 Prisma CLI — that fails to load prisma.config.ts at
# the \\wsl.localhost UNC path.
# migrate deploy applies the reviewed migration history (a real trail), not a
# schema-drift push.
bun run db:migrate

echo "[init] seeding demo market..."
bun prisma/seed.ts

echo "[init] done."
