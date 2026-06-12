import type { Request, Response } from "express";
import { prisma } from "@repo/db";

export const getDepth = async (
  req: Request<{ marketId: string }>,
  res: Response
): Promise<void> => {
  try {
    const { marketId } = req.params;
    if (!marketId) {
      res.status(400).json({ message: "marketId is required" });
      return;
    }
    const depth = await prisma.depth.findUnique({ where: { id: marketId } });


    res.status(200).json({
      marketId,
      bids: Array.isArray(depth?.bids) ? depth.bids : [],
      asks: Array.isArray(depth?.asks) ? depth.asks : [],
    });
  } catch (error) {
    console.error("getDepth failed:", error);
    res.status(500).json({ message: "Internal server error" });
  }
};
