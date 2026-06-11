import type { Response } from "express";
import type { AuthRequest } from "../middlewares/auth.middleware.js";
import type { Position } from "@repo/db";
import { prisma } from "@repo/db";
import { addToQueue } from "@repo/queue";

const toPositionDTO = (p: Position) => ({
  id: p.id,
  userId: p.userId,
  marketId: p.marketId,
  size: p.size.toString(),
  entryPrice: p.entryPrice.toString(),
  liquidationPrice: p.liquidationPrice.toString(),
  leverage: p.leverage,
  margin: p.margin.toString(),
  unrealizedPnl: p.unrealizedPnl.toString(),
  realizedPnl: p.realizedPnl.toString(),
  status: p.status,
  createdAt: p.createdAt,
  updatedAt: p.updatedAt,
});

export const getPositions = async (
  req: AuthRequest,
  res: Response
): Promise<void> => {
  try {
    const userId = req.userId!;
    const positions = await prisma.position.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
    });
    res.status(200).json({ positions: positions.map(toPositionDTO) });
  } catch (error) {
    console.error("getPositions failed:", error);
    res.status(500).json({ message: "Internal server error" });
  }
};

export const closePosition = async (
  req: AuthRequest & { params: { positionId: string } },
  res: Response
): Promise<void> => {
  try {
    const userId = req.userId!;
    const { positionId } = req.params;
    if (!positionId) {
      res.status(400).json({ message: "positionId is required" });
      return;
    }

    const position = await prisma.position.findFirst({
      where: { id: positionId, userId },
    });
    if (!position) {
      res.status(404).json({ message: "Position not found" });
      return;
    }
    if (position.size.isZero()) {
      res.status(409).json({ message: "Position is already flat" });
      return;
    }

    const closingSide = position.size.greaterThan(0) ? "SHORT" : "LONG";
    const order = await prisma.order.create({
      data: {
        userId,
        marketId: position.marketId,
        side: closingSide,
        orderType: "MARKET",
        quantity: position.size.abs(),
        leverage: position.leverage,
      },
    });

    await addToQueue(order, "MARKET-CREATE");

    res.status(202).json({
      message: "Closing order submitted",
      positionId,
      orderId: order.id,
    });
  } catch (error) {
    console.error("closePosition failed:", error);
    res.status(500).json({ message: "Internal server error" });
  }
};
