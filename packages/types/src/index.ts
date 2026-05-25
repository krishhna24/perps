import { z } from "zod";
import type { TradeSide, OrderType } from "@repo/db";
import { isValidDecimalString, toDecimal } from "./decimal.js";

export * from "./decimal.js";

export const MONEY_DECIMAL_PLACES = 8;

export const positiveDecimalString = z
  .string()
  .refine(isValidDecimalString, { message: "Invalid number" })
  .refine((v) => toDecimal(v).greaterThan(0), {
    message: "Must be greater than 0",
  })
  .refine((v) => toDecimal(v).decimalPlaces() <= MONEY_DECIMAL_PLACES, {
    message: `Must have at most ${MONEY_DECIMAL_PLACES} decimal places`,
  });

export const registerSchema = z.object({
  username: z.string().min(3).max(32),
  email: z.string().email(),
  password: z.string().min(8),
});

export type RegisterBody = z.infer<typeof registerSchema>;

export const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export type LoginBody = z.infer<typeof loginSchema>;

export const depositSchema = z.object({
  amount: positiveDecimalString,
});

export type DepositBody = z.infer<typeof depositSchema>;

export const withdrawSchema = z.object({
  amount: positiveDecimalString,
});

export type WithdrawBody = z.infer<typeof withdrawSchema>;

export const tradeSideSchema = z.enum(["LONG", "SHORT"]) satisfies z.ZodType<TradeSide>;
export const orderTypeSchema = z.enum(["MARKET", "LIMIT"]) satisfies z.ZodType<OrderType>;

export const createOrderSchema = z
  .object({
    marketId: z.string().min(1),
    side: tradeSideSchema,
    orderType: orderTypeSchema,
    quantity: positiveDecimalString,
    price: positiveDecimalString.optional(),
    leverage: z.number().int().min(1).max(125),
  })
  .refine((o) => o.orderType === "MARKET" || o.price !== undefined, {
    message: "price is required for LIMIT orders",
    path: ["price"],
  });

export type CreateOrderBody = z.infer<typeof createOrderSchema>;

export type Side = "LONG" | "SHORT";

export enum RejectReason {
  INSUFFICIENT_MARGIN = "INSUFFICIENT_MARGIN",
  NOT_FOUND_OR_NOT_RESTING = "NOT_FOUND_OR_NOT_RESTING",
  SELF_TRADE = "SELF_TRADE",
  OFF_GRID_PRICE = "OFF_GRID_PRICE",
  DUPLICATE_COMMAND = "DUPLICATE_COMMAND",
}

export type Command =
  | {
    type: "PLACE_LIMIT";
    commandId: string;
    userId: string;
    marketId: string;
    side: Side;
    priceTicks: bigint;
    qtyLots: bigint;
    leverage: number;
  }
  | {
    type: "PLACE_MARKET";
    commandId: string;
    userId: string;
    marketId: string;
    side: Side;
    qtyLots: bigint;
    leverage: number;
  }
  | {
    type: "CANCEL";
    commandId: string;
    orderId: string;
    userId: string;
  }
  | {
    type: "LIQUIDATE";
    commandId: string;
    userId: string;
    marketId: string;
  }
  | {
    type: "APPLY_FUNDING";
    commandId: string;
    marketId: string;
    fundingRateMicros: bigint;
  };

export interface RestingOrder {
  id: string;
  userId: string;

  side: Side;

  priceTicks: bigint;

  qtyLots: bigint;
  filledLots: bigint;

  leverage: number;

  seq: bigint;
}

export interface Trade {
  makerOrderId: string;
  takerOrderId: string;

  makerUserId: string;
  takerUserId: string;

  priceTicks: bigint;
  qtyLots: bigint;

  makerSide: Side;

  seq: bigint;
}

export interface Level {
  priceTicks: bigint;
  qtyLots: bigint;
}

export interface PriceLevel {
  priceTicks: bigint;
  qtyLots: bigint;
}

export interface PositionView {
  userId: string;
  marketId: string;

  side: Side | null;

  qtyLots: bigint;

  entryPriceTicks: bigint;

  leverage: number;

  unrealizedPnlMicros: bigint;
}

export type EngineEvent =
  | ({
    type: "OrderAccepted";
    orderId: string;
    userId: string;
  } & BaseEvent)
  | ({
    type: "OrderRejected";
    userId: string;
    reason: RejectReason;
  } & BaseEvent)
  | ({
    type: "OrderResting";
    orderId: string;
  } & BaseEvent)
  | ({
    type: "Traded";
    trade: Trade;
  } & BaseEvent)
  | ({
    type: "OrderStatus";
    orderId: string;
    status: string;
  } & BaseEvent)
  | ({
    type: "BalanceChanged";
    userId: string;
    balanceMicros: bigint;
  } & BaseEvent)
  | ({
    type: "PositionChanged";
    position: PositionView;
  } & BaseEvent)
  | ({
    type: "DepthChanged";
    bids: PriceLevel[];
    asks: PriceLevel[];
  } & BaseEvent)
  | ({
    type: "FundingApplied";
    marketId: string;
    fundingRateMicros: bigint;
  } & BaseEvent)
  | ({
    type: "Liquidated";
    userId: string;
    marketId: string;
  } & BaseEvent);

interface BaseEvent {
  seq: number;
}
