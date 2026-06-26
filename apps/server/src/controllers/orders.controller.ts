import type { Response } from "express";
import type { AuthRequest } from "../middlewares/auth.middleware.js";
import type { InternalAuthRequest } from "../middlewares/internalAuth.middleware.js";
import type { Order } from "@repo/db";
import { prisma, Prisma } from "@repo/db";
import { createOrderSchema, mul, div, sub, gt, gte, toFixedString, Decimal, type DecimalInput } from "@repo/types";
import { toEngineOrder, type EngineOrderAction } from "@repo/queue";

const MARKET_NOT_FOUND = "MARKET_NOT_FOUND";
const INSUFFICIENT_MARGIN = "INSUFFICIENT_MARGIN";
const NO_DEPTH_AVAILABLE = "NO_DEPTH_AVAILABLE";
const ORDER_NOT_FOUND = "ORDER_NOT_FOUND";
const NOT_CANCELLABLE = "NOT_CANCELLABLE";
const CONSTRAINT_VIOLATION = "CONSTRAINT_VIOLATION";

interface MarketConstraints {
  minQty: bigint;
  lotSize: { toString: () => string };
  tickSize: { toString: () => string };
  maxLeverage: number;
}

const assertMarketConstraints = (
  market: MarketConstraints,
  order: { orderType: "MARKET" | "LIMIT"; quantity: string; price?: string; leverage: number },
): void => {
  if (order.leverage > market.maxLeverage) {
    throw new Error(`${CONSTRAINT_VIOLATION}:leverage exceeds market maximum of ${market.maxLeverage}`);
  }
  if (gt(market.minQty.toString(), order.quantity)) {
    throw new Error(`${CONSTRAINT_VIOLATION}:quantity is below the market minimum of ${market.minQty}`);
  }
  const lotSize = market.lotSize.toString();
  if (gt(lotSize, 0) && !new Decimal(order.quantity).mod(lotSize).isZero()) {
    throw new Error(`${CONSTRAINT_VIOLATION}:quantity must be a multiple of the lot size ${lotSize}`);
  }
  const tickSize = market.tickSize.toString();
  if (order.orderType === "LIMIT" && order.price !== undefined && gt(tickSize, 0) && !new Decimal(order.price).mod(tickSize).isZero()) {
    throw new Error(`${CONSTRAINT_VIOLATION}:price must be a multiple of the tick size ${tickSize}`);
  }
};

const computeMarginRequirement = (
  positionSide: "LONG" | "SHORT" | "UNINITIALIZED",
  positionQuantity: DecimalInput,
  price: DecimalInput,
  quantity: DecimalInput,
  leverage: DecimalInput,
  side: "LONG" | "SHORT",
): Decimal => {
  const isOpposite =
    (side === "LONG" && positionSide === "SHORT") ||
    (side === "SHORT" && positionSide === "LONG");

  if (isOpposite) {
    if (gte(positionQuantity, quantity)) return new Decimal(0);
    return div(mul(price, sub(quantity, positionQuantity)), leverage);
  }

  return div(mul(price, quantity), leverage);
};

const toOrderDTO = (order: Order) => ({
  id: order.id,
  userId: order.userId,
  marketId: order.marketId,
  side: order.side,
  orderType: order.orderType,
  price: order.price?.toString() ?? null,
  quantity: order.quantity.toString(),
  filledQuantity: order.filledQuantity.toString(),
  leverage: order.leverage,
  status: order.status,
  createdAt: order.createdAt,
  updatedAt: order.updatedAt,
});

export const getOrders = async (
  req: AuthRequest,
  res: Response
) => {
  try {
    const userId = req.userId!;
    const orders = await prisma.order.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
    });
    res.status(200).json({ orders: orders.map(toOrderDTO) });
  } catch (error) {
    console.error("getOrders failed:", error);
    res.status(500).json({ message: "Internal server error" });
  }
};

export const createOrder = async (
  req: InternalAuthRequest,
  res: Response
) => {
  const parsed = createOrderSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      message: "Validation failed",
      errors: parsed.error.issues.map((issue) => ({
        path: issue.path.join("."),
        message: issue.message,
      })),
    });
    return;
  }
  try {
    const userId = req.userId!;
    const { marketId, side, orderType, quantity, price, leverage } = parsed.data;

    const action: EngineOrderAction = req.isInternalLiquidation
      ? "MARKET-LIQUIDATE"
      : orderType === "MARKET"
        ? "MARKET-CREATE"
        : "LIMIT-CREATE";

    const order = await prisma.$transaction(async (tx) => {
      const market = await tx.market.findUnique({
        where: { id: marketId },
        select: { id: true, minQty: true, lotSize: true, tickSize: true, maxLeverage: true },
      });
      if (!market) throw new Error(MARKET_NOT_FOUND);

      assertMarketConstraints(market, { orderType, quantity, price, leverage });

      let fillPrice = price;

      if (orderType === "MARKET") {
        const depth = await tx.depth.findUnique({ where: { id: marketId } });
        const bids = (depth?.bids ?? []) as [string, string][];
        const asks = (depth?.asks ?? []) as [string, string][];
        const bestPrice = side === "LONG" ? asks[0]?.[0] : bids[0]?.[0];
        if (!bestPrice) throw new Error(NO_DEPTH_AVAILABLE);
        fillPrice = bestPrice;
      }

      if (fillPrice !== undefined) {

        const position = await tx.position.findUnique({
          where: { userId_marketId: { userId, marketId } },
        });
        const positionSide: "LONG" | "SHORT" | "UNINITIALIZED" =
          !position || position.size.isZero()
            ? "UNINITIALIZED"
            : position.size.greaterThan(0)
              ? "LONG"
              : "SHORT";
        const positionQuantity = position ? position.size.abs().toString() : "0";

        const required = computeMarginRequirement(
          positionSide,
          positionQuantity,
          fillPrice,
          quantity,
          leverage,
          side,
        );
        if (gt(required, 0)) {

          const requiredMargin = toFixedString(required);
          const balance = await tx.balance.findUnique({ where: { userId } });
          if (!balance || !gte(balance.availableMargin.toString(), requiredMargin)) {
            throw new Error(INSUFFICIENT_MARGIN);
          }
        }
      }

      const created = await tx.order.create({
        data: { userId, marketId, side, orderType, price: fillPrice, quantity, leverage },
      });

      await tx.commandOutbox.create({
        data: {
          commandId: `${created.id}__${action}`,
          marketId: created.marketId,
          type: action,
          payload: toEngineOrder(created, action) as unknown as Prisma.InputJsonValue,
        },
      });
      return created;
    });

    res.status(201).json({ order: toOrderDTO(order) });
  } catch (error) {
    if (error instanceof Error && error.message === MARKET_NOT_FOUND) {
      res.status(404).json({ message: "Market not found" });
      return;
    }
    if (error instanceof Error && error.message === INSUFFICIENT_MARGIN) {
      res.status(400).json({ message: "Insufficient available margin" });
      return;
    }
    if (error instanceof Error && error.message === NO_DEPTH_AVAILABLE) {
      res.status(400).json({ message: "No liquidity available for market order" });
      return;
    }
    if (error instanceof Error && error.message.startsWith(CONSTRAINT_VIOLATION)) {
      res.status(400).json({ message: error.message.slice(CONSTRAINT_VIOLATION.length + 1) });
      return;
    }
    console.error("createOrder failed:", error);
    res.status(500).json({ message: "Internal server error" });
  }
};

export const cancelOrder = async (
  req: AuthRequest & { params: { orderId: string } },
  res: Response
) => {
  try {
    const userId = req.userId!;
    const { orderId } = req.params;
    if (!orderId) {
      res.status(400).json({ message: "orderId is required" });
      return;
    }

    const { refundedMargin } = await prisma.$transaction(async (tx) => {
      const order = await tx.order.findFirst({ where: { id: orderId, userId } });
      if (!order) throw new Error(ORDER_NOT_FOUND);

      const updated = await tx.order.updateMany({
        where: {
          id: orderId,
          userId,
          status: { in: ["PENDING", "PARTIALLY_FILLED"] },
        },
        data: { status: "CANCELLED" },
      });
      if (updated.count === 0) throw new Error(NOT_CANCELLABLE);

      await tx.commandOutbox.create({
        data: {
          commandId: `${order.id}__LIMIT-CANCEL`,
          marketId: order.marketId,
          type: "LIMIT-CANCEL",
          payload: toEngineOrder(order, "LIMIT-CANCEL") as unknown as Prisma.InputJsonValue,
        },
      });

      if (order.price !== null) {
        const remaining = sub(
          order.quantity.toString(),
          order.filledQuantity.toString()
        );

        const position = await tx.position.findUnique({
          where: { userId_marketId: { userId, marketId: order.marketId } },
        });
        const positionSide: "LONG" | "SHORT" | "UNINITIALIZED" =
          !position || position.size.isZero()
            ? "UNINITIALIZED"
            : position.size.greaterThan(0)
              ? "LONG"
              : "SHORT";
        const positionQuantity = position ? position.size.abs().toString() : "0";

        const refund = toFixedString(
          computeMarginRequirement(
            positionSide,
            positionQuantity,
            order.price.toString(),
            remaining,
            order.leverage,
            order.side,
          )
        );

        return { order, refundedMargin: refund };
      }
      return { order, refundedMargin: "0" };
    });

    res.status(200).json({ message: "Order cancelled", orderId, refundedMargin });
  } catch (error) {
    if (error instanceof Error && error.message === ORDER_NOT_FOUND) {
      res.status(404).json({ message: "Order not found" });
      return;
    }
    if (error instanceof Error && error.message === NOT_CANCELLABLE) {
      res.status(409).json({ message: "Order is not cancellable" });
      return;
    }
    console.error("cancelOrder failed:", error);
    res.status(500).json({ message: "Internal server error" });
  }
};
