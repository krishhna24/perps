import onMarketDataUpdate from "./priceBus.js";
import { RedisManager } from "@repo/pubsub";
import { Decimal } from "@repo/types";


const FUNDING_CLAMP = new Decimal("0.05");
const INTERVAL_SCALE = new Decimal(8).div(24);

onMarketDataUpdate(({ top, index }) => {
  try {
    const ask = new Decimal(top.a[0]);
    const bid = new Decimal(top.b[0]);
    const idx = new Decimal(index);

    const markPrice = medianOfThree(ask, bid, idx);
    const fundingRate = computeFundingRate(idx, markPrice);



    RedisManager.getInstance().publishToChannel("markPrice:update", markPrice.toString());
    RedisManager.getInstance().publishToChannel("fundingRate:update", {
      fundingRate: fundingRate.toString(),
      markPrice: markPrice.toString(),
    });
  } catch (error) {
    console.error("Error processing market data update:", error);
  }
});

function medianOfThree(a: Decimal, b: Decimal, c: Decimal): Decimal {
  const mn = Decimal.min(a, b, c);
  const mx = Decimal.max(a, b, c);
  return a.plus(b).plus(c).minus(mn).minus(mx);
}

function computeFundingRate(index: Decimal, mark: Decimal): Decimal {
  if (index.isZero()) return new Decimal(0);
  const initialRate = mark.minus(index).div(index);
  const clampedRate = Decimal.max(Decimal.min(initialRate, FUNDING_CLAMP), FUNDING_CLAMP.negated());
  return clampedRate.times(INTERVAL_SCALE);
}
