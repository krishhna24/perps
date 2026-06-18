#!/usr/bin/env sh






set -e

API="${API_URL:-http://localhost:3000}"
MARKET_ID="${MARKET_ID:-cmqgd206q00002bxy0wavuaff}"
STAMP="$(date +%s)"
PRICE="50000"
QTY="0.01"
LEV=5

json_field() { sed -n "s/.*\"$1\":\"\\([^\"]*\\)\".*/\\1/p"; }

register() {

  curl -s -X POST "$API/api/auth/register" \
    -H "Content-Type: application/json" \
    -d "{\"username\":\"demo_$1_$STAMP\",\"email\":\"demo_$1_$STAMP@example.com\",\"password\":\"password123\"}" \
    | json_field token
}

deposit() {
  curl -s -X POST "$API/api/balance/deposit" \
    -H "Content-Type: application/json" -H "Authorization: Bearer $1" \
    -d "{\"amount\":\"$2\"}" >/dev/null
}

order() {
  curl -s -X POST "$API/api/orders" \
    -H "Content-Type: application/json" -H "Authorization: Bearer $1" \
    -d "{\"marketId\":\"$MARKET_ID\",\"side\":\"$2\",\"orderType\":\"LIMIT\",\"quantity\":\"$QTY\",\"price\":\"$PRICE\",\"leverage\":$LEV}"
}

show() {
  echo "--- $1 balance ---";   curl -s "$API/api/balance"   -H "Authorization: Bearer $2"
  echo "
--- $1 positions ---"; curl -s "$API/api/positions" -H "Authorization: Bearer $2"
  echo
}

echo "[demo] API=$API  MARKET_ID=$MARKET_ID"

echo "[demo] health:"; curl -s "$API/health"; echo

echo "[demo] registering two traders..."
TOKEN_A="$(register a)"; TOKEN_B="$(register b)"
[ -n "$TOKEN_A" ] && [ -n "$TOKEN_B" ] || { echo "registration failed"; exit 1; }

echo "[demo] funding both with 100000..."
deposit "$TOKEN_A" 100000
deposit "$TOKEN_B" 100000
sleep 2

echo "[demo] trader A places LIMIT SHORT (maker):"; order "$TOKEN_A" SHORT; echo
sleep 1
echo "[demo] trader B places LIMIT LONG (taker, crosses):"; order "$TOKEN_B" LONG; echo
sleep 2

echo "[demo] resulting state:"
show "A" "$TOKEN_A"
show "B" "$TOKEN_B"

echo "[demo] order book depth:"
curl -s "$API/api/depth/$MARKET_ID"; echo
echo "[demo] done. A should be SHORT and B LONG ${QTY} @ ${PRICE}."
