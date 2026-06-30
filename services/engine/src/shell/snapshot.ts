import { Decimal } from "@repo/types";
import type {
  OrderbookSnapshot,
  PositionSide,
  UserBalance,
  UserPosition,
} from "../domain/types.js";



interface SerializedBalance {
  availableBalance: string;
  lockedBalance: string;
}

interface SerializedPosition {
  side: PositionSide;
  quantity: string;
  entryPrice: string;
  margin: string;
  unrealizedPnl: string;
  liquidatedPrice: string;
  market: string;
  leverage?: number;
}

export interface EngineSnapshot {
  orderbook: OrderbookSnapshot;
  userBalance: [string, SerializedBalance][];
  userPosition: [string, SerializedPosition][];

  lastSeq: string;

  lastFundingSeq?: string;
}

export function serializeSnapshot(
  orderbook: OrderbookSnapshot,
  userBalance: Map<string, UserBalance>,
  userPosition: Map<string, UserPosition>,
  lastSeq: bigint,
  lastFundingSeq: bigint,
): EngineSnapshot {
  return {
    orderbook,
    lastSeq: lastSeq.toString(),
    lastFundingSeq: lastFundingSeq.toString(),
    userBalance: Array.from(userBalance.entries()).map(([userId, b]) => [
      userId,
      {
        availableBalance: b.availableBalance.toString(),
        lockedBalance: b.lockedBalance.toString(),
      },
    ]),
    userPosition: Array.from(userPosition.entries()).map(([userId, p]) => [
      userId,
      {
        side: p.side,
        quantity: p.quantity.toString(),
        entryPrice: p.entryPrice.toString(),
        margin: p.margin.toString(),
        unrealizedPnl: p.unrealizedPnl.toString(),
        liquidatedPrice: p.liquidatedPrice.toString(),
        market: p.market,
        leverage: p.leverage,
      },
    ]),
  };
}

export function deserializeBalances(
  entries: EngineSnapshot["userBalance"],
): Map<string, UserBalance> {
  return new Map(
    entries.map(([userId, b]) => [
      userId,
      {
        availableBalance: new Decimal(b.availableBalance),
        lockedBalance: new Decimal(b.lockedBalance),
      },
    ]),
  );
}

export function deserializePositions(
  entries: EngineSnapshot["userPosition"],
): Map<string, UserPosition> {
  return new Map(
    entries.map(([userId, p]) => [
      userId,
      {
        side: p.side,
        quantity: new Decimal(p.quantity),
        entryPrice: new Decimal(p.entryPrice),
        margin: new Decimal(p.margin),
        unrealizedPnl: new Decimal(p.unrealizedPnl),
        liquidatedPrice: new Decimal(p.liquidatedPrice),
        market: p.market,
        leverage: p.leverage,
      },
    ]),
  );
}
