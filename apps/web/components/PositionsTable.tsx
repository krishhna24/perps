"use client";

import { useMemo } from "react";
import { usePositions, useClosePosition, useMarkets } from "@/hooks/queries";
import { useMarketStore } from "@/store/marketStore";
import { toDec, fmtPrice, fmtUsd, pnlColorClass, fmtSigned } from "@/lib/format";
import { ApiError } from "@/lib/api";
import { toast } from "@/store/toastStore";
import { Button } from "@/components/ui";

export function PositionsTable() {
  const { data: positions, isLoading } = usePositions();
  const { data: markets } = useMarkets();
  const markBySymbol = useMarketStore((s) => s.markBySymbol);
  const closePosition = useClosePosition();

  const idToSymbol = useMemo(
    () => new Map((markets ?? []).map((m) => [m.id, m.symbol])),
    [markets]
  );

  const open = (positions ?? []).filter((p) => !toDec(p.size).isZero());

  return (
    <div className="scroll-thin overflow-auto">
      <table className="w-full text-xs">
        <thead className="text-dim">
          <tr className="border-b border-border text-left">
            <Th>Market</Th>
            <Th>Side</Th>
            <Th className="text-right">Size</Th>
            <Th className="text-right">Entry</Th>
            <Th className="text-right">Mark</Th>
            <Th className="text-right">Liq.</Th>
            <Th className="text-right">Margin</Th>
            <Th className="text-right">uPnL</Th>
            <Th className="text-right">Lev</Th>
            <Th className="text-right">Action</Th>
          </tr>
        </thead>
        <tbody>
          {open.map((p) => {
            const isLong = toDec(p.size).greaterThan(0);
            const symbol = idToSymbol.get(p.marketId);
            const mark = symbol ? markBySymbol[symbol]?.mark : undefined;
            return (
              <tr key={p.id} className="border-b border-border/50">
                <Td>{symbol ?? `${p.marketId.slice(0, 6)}…`}</Td>
                <Td className={isLong ? "text-up" : "text-down"}>
                  {isLong ? "LONG" : "SHORT"}
                </Td>
                <Td className="tabular text-right">{toDec(p.size).abs().toFixed(4)}</Td>
                <Td className="tabular text-right">{fmtPrice(p.entryPrice)}</Td>
                <Td className="tabular text-right">
                  {mark ? fmtPrice(mark) : "—"}
                </Td>
                <Td className="tabular text-right">{fmtPrice(p.liquidationPrice)}</Td>
                <Td className="tabular text-right">{fmtUsd(p.margin)}</Td>
                <Td className={`tabular text-right ${pnlColorClass(p.unrealizedPnl)}`}>
                  {fmtSigned(p.unrealizedPnl)}
                </Td>
                <Td className="tabular text-right">{p.leverage}×</Td>
                <Td className="text-right">
                  <Button
                    variant="ghost"
                    className="px-2 py-1 text-xs"
                    disabled={closePosition.isPending}
                    onClick={() =>
                      closePosition.mutate(p.id, {
                        onSuccess: () => toast.info("Closing order submitted"),
                        onError: (e) =>
                          toast.error(
                            e instanceof ApiError ? e.message : "Close failed"
                          ),
                      })
                    }
                  >
                    Close
                  </Button>
                </Td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {!isLoading && open.length === 0 ? (
        <Empty>No open positions</Empty>
      ) : null}
      {isLoading ? <Empty>Loading…</Empty> : null}
    </div>
  );
}

function Th({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return <th className={`px-3 py-2 font-medium ${className}`}>{children}</th>;
}
function Td({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return <td className={`px-3 py-2 ${className}`}>{children}</td>;
}
function Empty({ children }: { children: React.ReactNode }) {
  return <div className="py-6 text-center text-xs text-dim">{children}</div>;
}
