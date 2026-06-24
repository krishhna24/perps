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
