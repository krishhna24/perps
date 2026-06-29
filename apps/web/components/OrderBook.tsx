"use client";

import { memo, useMemo } from "react";
import { useMarketStore, useMarkPrice } from "@/store/marketStore";
import type { Market, DepthLevel } from "@/lib/types";
import { decimalsOf, fmtPrice, toDec, Decimal } from "@/lib/format";
import { Panel, PanelHeader } from "@/components/ui";

const ROWS = 12;

function withCumulative(levels: DepthLevel[]) {
  let cum = new Decimal(0);
  return levels.map(([price, qty]) => {
    cum = cum.plus(toDec(qty));
    return { price, qty, cum };
  });
}

export function OrderBook({
  market,
  onPickPrice,
}: {
  market: Market | undefined;
  onPickPrice?: (price: string) => void;
}) {
  const bids = useMarketStore((s) => s.bids);
  const asks = useMarketStore((s) => s.asks);
  const lastTrade = useMarketStore((s) => s.lastTrade);
  const markPrice = useMarkPrice(market?.symbol)?.mark ?? null;

  const priceDp = decimalsOf(market?.tickSize);
  const qtyDp = decimalsOf(market?.lotSize);

  const { topAsks, topBids, maxCum } = useMemo(() => {
    const sortedAsks = [...asks]
      .sort((a, b) => toDec(a[0]).comparedTo(toDec(b[0])))
      .slice(0, ROWS);
    const sortedBids = [...bids]
      .sort((a, b) => toDec(b[0]).comparedTo(toDec(a[0])))
      .slice(0, ROWS);
    const a = withCumulative(sortedAsks);
    const b = withCumulative(sortedBids);
    const max = Decimal.max(a.at(-1)?.cum ?? 0, b.at(-1)?.cum ?? 0, 1);
    return { topAsks: a, topBids: b, maxCum: max };
  }, [asks, bids]);

  return (
    <Panel className="flex h-full flex-col">
      <PanelHeader>Order Book</PanelHeader>
      <div className="grid grid-cols-3 px-3 py-1 text-xs text-dim">
        <span>Price</span>
        <span className="text-right">Size</span>
        <span className="text-right">Total</span>
      </div>

      <div className="scroll-thin flex flex-1 flex-col justify-end overflow-hidden">
        {topAsks
          .slice()
          .reverse()
          .map((lvl) => (
            <Row
              key={`a-${lvl.price}`}
              price={lvl.price}
              qty={lvl.qty}
              cum={lvl.cum}
              maxCum={maxCum}
              priceDp={priceDp}
              qtyDp={qtyDp}
              side="ask"
              onClick={onPickPrice}
            />
          ))}
      </div>

      <div className="flex items-center justify-between border-y border-border px-3 py-1.5">
        <span
          className={`tabular text-sm font-semibold ${
            lastTrade ? "text-text" : "text-dim"
          }`}
        >
          {lastTrade ? fmtPrice(lastTrade.p, priceDp) : "—"}
        </span>
        <span className="tabular text-xs text-dim">
          Mark {markPrice ? fmtPrice(markPrice, priceDp) : "—"}
        </span>
      </div>

      <div className="scroll-thin flex flex-1 flex-col overflow-hidden">
        {topBids.map((lvl) => (
          <Row
            key={`b-${lvl.price}`}
            price={lvl.price}
            qty={lvl.qty}
            cum={lvl.cum}
            maxCum={maxCum}
            priceDp={priceDp}
            qtyDp={qtyDp}
            side="bid"
            onClick={onPickPrice}
          />
        ))}
        {topBids.length === 0 && topAsks.length === 0 ? (
          <div className="py-6 text-center text-xs text-dim">No liquidity</div>
        ) : null}
      </div>
    </Panel>
  );
}

const Row = memo(function Row({
  price,
  qty,
  cum,
  maxCum,
  priceDp,
  qtyDp,
  side,
  onClick,
}: {
  price: string;
  qty: string;
  cum: Decimal;
  maxCum: Decimal;
  priceDp: number;
  qtyDp: number;
  side: "ask" | "bid";
  onClick?: (price: string) => void;
}) {
  const pct = Math.min(100, cum.div(maxCum).times(100).toNumber());
  const barColor = side === "ask" ? "bg-down/15" : "bg-up/15";
  const textColor = side === "ask" ? "text-down" : "text-up";
  return (
    <button
      onClick={() => onClick?.(price)}
      className="relative grid grid-cols-3 px-3 py-0.5 text-xs hover:bg-panel2"
    >
      <span
        className={`absolute inset-y-0 right-0 ${barColor}`}
        style={{ width: `${pct}%` }}
      />
      <span className={`tabular relative z-10 text-left ${textColor}`}>
        {fmtPrice(price, priceDp)}
      </span>
      <span className="tabular relative z-10 text-right">
        {toDec(qty).toFixed(qtyDp)}
      </span>
      <span className="tabular relative z-10 text-right text-dim">
        {cum.toFixed(qtyDp)}
      </span>
    </button>
  );
});
