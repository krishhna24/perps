import { Decimal } from "@repo/types";
import type { UserPosition } from "./types.js";

export const DEFAULT_MAINTENANCE_MARGIN_RATE = new Decimal("0.05");

const BPS_PER_UNIT = new Decimal(10_000);

export function maintenanceMarginRateFromBps(bps: bigint): Decimal {
  return new Decimal(bps.toString()).div(BPS_PER_UNIT);
}

export function computeLiquidationPrice(
  position: Pick<UserPosition, "side" | "quantity" | "entryPrice" | "margin">,
  maintenanceMarginRate: Decimal,
): Decimal {
  const { side, quantity, entryPrice, margin } = position;
  if (side === "UNINITIALIZED" || quantity.lessThanOrEqualTo(0)) return new Decimal(0);

  const maintenance = maintenanceMarginRate.times(entryPrice).times(quantity);
  const gap = maintenance.minus(margin).div(quantity);

  const price = side === "LONG" ? entryPrice.plus(gap) : entryPrice.minus(gap);

  return price.lessThan(0) ? new Decimal(0) : price;
}
