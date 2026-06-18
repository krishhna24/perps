#!/usr/bin/env sh



set -e

ROOT="$(CDPATH= cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT/packages/db"

echo "[init] pushing Prisma schema to the database..."
bunx prisma db push

echo "[init] seeding demo market..."
bun prisma/seed.ts

echo "[init] done."
