"use client";

import { useMarkets } from "@/hooks/queries";

export function useActiveMarket() {
  const { data: markets, isLoading } = useMarkets();
  const preferred = process.env.NEXT_PUBLIC_MARKET_ID;
  const market =
    (preferred && markets?.find((m) => m.id === preferred)) ||
    markets?.[0] ||
    undefined;
  return { market, isLoading };
}
