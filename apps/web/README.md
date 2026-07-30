# `web` — trading terminal

Next.js 16 (App Router, React 19) front end for the `perps` exchange: authentication, an
order ticket, a live order book and price chart, and tables for open orders and positions.

Market data arrives over the WebSocket gateway; everything else goes through the HTTP API.
See the [root README](../../README.md) for the system architecture.

## Running it

The terminal needs the backend running. From the repository root:

```bash
docker compose up -d          # API on :3000, WebSocket gateway on :8080
cp apps/web/.env.example apps/web/.env
bun run dev --filter=web      # terminal on :3001
```

Open http://localhost:3001, register a user, then fund it and cross a trade — or run
`sh scripts/demo.sh` from the root to seed two traders and a filled order.

## Environment

| Variable | Required | Purpose |
|---|---|---|
| `NEXT_PUBLIC_API_URL` | yes | HTTP API base URL (default `http://localhost:3000`) |
| `NEXT_PUBLIC_WS_URL` | yes | WebSocket gateway URL (default `ws://localhost:8080`) |
| `NEXT_PUBLIC_MARKET_ID` | no | Pin a market; otherwise the first result from `GET /api/markets` is used |

These are `NEXT_PUBLIC_*` and therefore inlined into the client bundle at build time. Never
put a secret in one.

## Structure

| Path | Contents |
|---|---|
| `app/(auth)/` | Login and register routes |
| `app/(app)/trade/` | The trading screen |
| `components/` | Order book, order ticket, price chart, positions and open-orders tables |
| `hooks/` | TanStack Query hooks and the WebSocket subscription hook |
| `lib/` | API client, zod schemas, formatting helpers, query keys |
| `store/` | Zustand stores for auth, active market and toasts |

## Notes

- **Authentication.** The access token is short-lived and refreshed via an httpOnly cookie.
  The WebSocket connection uses a separate short-lived ticket from `POST /api/ws-ticket` —
  a ticket is not an API credential, and the server rejects it if presented as one.
- **Money formatting.** Values arrive as decimal strings and are handled with `decimal.js`.
  Do not convert them to `number` for arithmetic; use the helpers in `lib/format.ts`.
- **Streams are lossy.** Redis pub/sub has no replay, so treat WebSocket messages as a fast
  path over authoritative REST state, never as the source of truth.
