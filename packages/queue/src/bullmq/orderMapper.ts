import type { Order as PrismaOrder } from "@repo/db";


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
  entryPrice: number;
  quantity: number;
  leverage: number;
  filled: number;
}


export function toEngineOrder(order: PrismaOrder, action: EngineOrderAction): EngineQueueOrder {
  return {
    id: order.id,
    type: action,
    seq: order.seq != null ? order.seq.toString() : undefined,
    userId: order.userId,
    side: order.side,
    entryPrice: order.price ? order.price.toNumber() : 0,
    quantity: order.quantity.toNumber(),
    leverage: order.leverage,
    filled: order.filledQuantity.toNumber(),
  };
}
