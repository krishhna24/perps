import onMarketDataUpdate from "./priceBus.js";
import { RedisManager } from "@repo/pubsub";
import { Decimal } from "@repo/types";

const FUNDING_CLAMP = new Decimal("0.05");
const INTERVAL_SCALE = new Decimal(8).div(24);

const DEVIATION_BAND = new Decimal("0.005");

const PREMIUM_WINDOW_MS = 5 * 60 * 1000;

interface PremiumSample {
  t: number;
  basis: Decimal;
}

const premiumWindow: PremiumSample[] = [];

let lastPublishedAt = 0;

const MARK_STALE_AFTER_MS = 30_000;

export function markPriceFresh(): boolean {
  return lastPublishedAt > 0 && Date.now() - lastPublishedAt < MARK_STALE_AFTER_MS;
}

onMarketDataUpdate(({ top, index }) => {
  try {
    const idx = new Decimal(index);
    const ask = new Decimal(top.a[0]);
    const bid = new Decimal(top.b[0]);

    const hasBook = ask.greaterThan(0) && bid.greaterThan(0);
    if (!hasBook && idx.lessThanOrEqualTo(0)) return;

    const markPrice = hasBook
      ? medianOfThree(clampToBand(ask, idx), clampToBand(bid, idx), idx)
      : idx;

    const basis = idx.isZero() ? new Decimal(0) : markPrice.minus(idx).div(idx);
    const premium = updatePremiumIndex(Date.now(), basis);
    const fundingRate = computeFundingRate(premium);

    RedisManager.getInstance().publishToChannel("markPrice:update", markPrice.toString());
    RedisManager.getInstance().publishToChannel("fundingRate:update", {
      fundingRate: fundingRate.toString(),
      markPrice: markPrice.toString(),
    });
    lastPublishedAt = Date.now();
  } catch (error) {
    console.error("Error processing market data update:", error);
  }
});

function clampToBand(price: Decimal, index: Decimal): Decimal {
  if (index.lessThanOrEqualTo(0)) return price;
  const lower = index.times(new Decimal(1).minus(DEVIATION_BAND));
  const upper = index.times(new Decimal(1).plus(DEVIATION_BAND));
  return Decimal.max(lower, Decimal.min(price, upper));
}

function medianOfThree(a: Decimal, b: Decimal, c: Decimal): Decimal {
  const mn = Decimal.min(a, b, c);
  const mx = Decimal.max(a, b, c);
  return a.plus(b).plus(c).minus(mn).minus(mx);
}

function updatePremiumIndex(now: number, basis: Decimal): Decimal {
  premiumWindow.push({ t: now, basis });

  const cutoff = now - PREMIUM_WINDOW_MS;
  while (premiumWindow.length > 1 && premiumWindow[0]!.t < cutoff) {
    premiumWindow.shift();
  }

  if (premiumWindow.length === 1) return premiumWindow[0]!.basis;

  let weightedSum = new Decimal(0);
  let totalWeight = new Decimal(0);
  for (let i = 0; i < premiumWindow.length; i++) {
    const cur = premiumWindow[i]!;
    const nextT = i + 1 < premiumWindow.length ? premiumWindow[i + 1]!.t : now;
    const dt = new Decimal(nextT - cur.t);
    weightedSum = weightedSum.plus(cur.basis.times(dt));
    totalWeight = totalWeight.plus(dt);
  }

  if (totalWeight.isZero()) return basis;
  return weightedSum.div(totalWeight);
}

function computeFundingRate(premium: Decimal): Decimal {
  const clampedRate = Decimal.max(Decimal.min(premium, FUNDING_CLAMP), FUNDING_CLAMP.negated());
  return clampedRate.times(INTERVAL_SCALE);
}
