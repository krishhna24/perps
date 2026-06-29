import { create } from "zustand";
import type { DepthLevel } from "@/lib/types";

export interface MarkPrice {
  mark: string;
  index: string;
}

interface MarketState {
  connected: boolean;
  bids: DepthLevel[];
  asks: DepthLevel[];
  lastTrade: { p: string; q: string } | null;
  markBySymbol: Record<string, MarkPrice>;

  setConnected: (v: boolean) => void;
  applyDepth: (bids: DepthLevel[], asks: DepthLevel[]) => void;
  applyTrade: (p: string, q: string) => void;
  applyPrices: (symbol: string, mark: string, index: string) => void;
}

const normSymbol = (s: string) => s.toUpperCase();

export const useMarketStore = create<MarketState>((set) => ({
  connected: false,
  bids: [],
  asks: [],
  lastTrade: null,
  markBySymbol: {},

  setConnected: (v) => set({ connected: v }),
  applyDepth: (bids, asks) => set({ bids, asks }),
  applyTrade: (p, q) => set({ lastTrade: { p, q } }),
  applyPrices: (symbol, mark, index) =>
    set((s) => ({
      markBySymbol: {
        ...s.markBySymbol,
        [normSymbol(symbol)]: { mark, index },
      },
    })),
}));

export function useMarkPrice(
  symbol: string | null | undefined
): MarkPrice | null {
  return useMarketStore((s) =>
    symbol ? s.markBySymbol[normSymbol(symbol)] ?? null : null
  );
}
