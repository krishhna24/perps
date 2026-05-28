import type { Decimal } from "@repo/types";

export type OrderSide = "LONG" | "SHORT";


export type PositionSide = OrderSide | "UNINITIALIZED";


export type OrderAction =
  | "LIMIT-CREATE"
  | "LIMIT-CANCEL"
  | "MARKET-CREATE"
  | "MARKET-LIQUIDATE";

export interface Order {
  id?: string;
  type?: OrderAction;

  seq?: string;
  userId: string;
  side: OrderSide;
  entryPrice: number;
  quantity: number;
  leverage: number;
  filled: number;
}


export type BalanceAction = "BALANCE-DEPOSIT" | "BALANCE-WITHDRAW";

export interface BalanceCommand {
  id: string;
  type: BalanceAction;

  seq?: string;
  userId: string;

  amount: string;
}

export interface Fill {
  fillId: string;
  orderId: string;
  userId: string;
  otherUserId: string;
  otherOrderId: string;
  price: number;
  quantity: number;
  otherLeverage: number;
}


export interface UserBalance {
  availableBalance: Decimal;
  lockedBalance: Decimal;
}

export interface UserPosition {
  side: PositionSide;
  quantity: Decimal;
  entryPrice: Decimal;
  margin: Decimal;
  unrealizedPnl: Decimal;
  liquidatedPrice: Decimal;
  market: string;
  leverage?: number;
}


export type DepthLevel = [string, string];

export interface MarketDepth {
  bids: DepthLevel[];
  asks: DepthLevel[];
}

export interface MatchResult {
  executedQty: number;
  fills: Fill[];

  updatedOrders: Order[];
}

export interface OrderbookSnapshot {
  bids: Order[];
  asks: Order[];
  market: string;
}
