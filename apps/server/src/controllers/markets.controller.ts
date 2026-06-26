import type { Request, Response } from "express";
import type { Market } from "@repo/db";
import { prisma } from "@repo/db";

const toMarketDTO = (m: Market) => ({
  id: m.id,
  symbol: m.symbol,
  baseAsset: m.baseAsset,
  quoteAsset: m.quoteAsset,
  imageUrl: m.imageUrl,
  tickSize: m.tickSize.toString(),
  lotSize: m.lotSize.toString(),
  minQty: m.minQty.toString(),
  maxLeverage: m.maxLeverage,
  maintenanceMarginRate: m.maintenanceMarginRate.toString(),
  takerFeeBps: m.takerFeeBps,
  makerFeeBps: m.makerFeeBps,
});

export const listMarkets = async (
  _req: Request,
  res: Response
): Promise<void> => {
  try {
    const markets = await prisma.market.findMany({ orderBy: { symbol: "asc" } });
    res.status(200).json({ markets: markets.map(toMarketDTO) });
  } catch (error) {
    console.error("listMarkets failed:", error);
    res.status(500).json({ message: "Internal server error" });
  }
};

export const getMarket = async (
  req: Request<{ marketId: string }>,
  res: Response
): Promise<void> => {
  try {
    const { marketId } = req.params;
    const market = await prisma.market.findUnique({ where: { id: marketId } });
    if (!market) {
      res.status(404).json({ message: "Market not found" });
      return;
    }
    res.status(200).json({ market: toMarketDTO(market) });
  } catch (error) {
    console.error("getMarket failed:", error);
    res.status(500).json({ message: "Internal server error" });
  }
};
