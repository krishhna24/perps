import { Decimal } from "@repo/types";

export type PositionSide = "LONG" | "SHORT" | "UNINITIALIZED";


export interface Position {
  userId: string;
  side: PositionSide;
  quantity: string;
  entryPrice: string;
  margin: string;
  unrealizedPnl: string;
  liquidatedPrice: string;
  market: string;
  leverage?: number;
}

export const MAINTENANCE_MARGIN = new Decimal("0.05");


export function computeLiquidationQty(position: Position, markPrice: Decimal): Decimal | null {
  const quantity = new Decimal(position.quantity);
  const entryPrice = new Decimal(position.entryPrice);
  const margin = new Decimal(position.margin);

  const notional = entryPrice.times(quantity);
  const pnl =
    position.side === "LONG"
      ? markPrice.minus(entryPrice).times(quantity)
      : entryPrice.minus(markPrice).times(quantity);

  const equity = margin.plus(pnl);
  const maintenanceRequired = MAINTENANCE_MARGIN.times(notional);
  const shortfall = maintenanceRequired.minus(equity);

  if (shortfall.lessThanOrEqualTo(0)) return null;


  if (equity.lessThanOrEqualTo(0)) return quantity;






  const leverage = position.leverage;
  if (!leverage || leverage <= 0) return quantity;

  const invLev = new Decimal(1).div(leverage);
  const denominator =
    position.side === "LONG"
      ? entryPrice.times(new Decimal(1).plus(MAINTENANCE_MARGIN).minus(invLev)).minus(markPrice)
      : markPrice.minus(entryPrice.times(new Decimal(1).plus(invLev).minus(MAINTENANCE_MARGIN)));




  if (denominator.lessThanOrEqualTo(0)) return quantity;

  const liquidationQty = shortfall.div(denominator);
  if (liquidationQty.lessThanOrEqualTo(0) || liquidationQty.greaterThanOrEqualTo(quantity)) {
    return quantity;
  }
  return liquidationQty;
}
