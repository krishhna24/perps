import type { LedgerEntry, Order as PrismaOrder } from "@repo/db";

export type EngineOrderAction = "LIMIT-CREATE" | "LIMIT-CANCEL" | "MARKET-CREATE" | "MARKET-LIQUIDATE";

export type BalanceAction = "BALANCE-DEPOSIT" | "BALANCE-WITHDRAW";

export interface EngineBalanceCommand {
  id: string;
  type: BalanceAction;

  seq?: string;
  userId: string;

  amount: string;
}

export type EngineCommand = EngineQueueOrder | EngineBalanceCommand;

export interface EngineQueueOrder {
  id?: string;
  type?: EngineOrderAction;

  seq?: string;
  userId: string;
  side: PrismaOrder["side"];
  entryPrice: string;
  quantity: string;
  leverage: number;
  filled: string;
}

export function toEngineOrder(order: PrismaOrder, action: EngineOrderAction): EngineQueueOrder {
  return {
    id: order.id,
    type: action,
    userId: order.userId,
    side: order.side,
    entryPrice: order.price ? order.price.toString() : "0",
    quantity: order.quantity.toString(),
    leverage: order.leverage,
    filled: order.filledQuantity.toString(),
  };
}

export function toEngineBalanceCommand(entry: LedgerEntry, action: BalanceAction): EngineBalanceCommand {
  return {
    id: entry.id,
    type: action,
    userId: entry.userId,
    amount: entry.amount.toString(),
  };
}
