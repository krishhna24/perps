"use client";

import { useState } from "react";
import { useActiveMarket } from "@/hooks/useActiveMarket";
import { useDepthSnapshot } from "@/hooks/queries";
import { PriceChart } from "@/components/PriceChart";
import { OrderBook } from "@/components/OrderBook";
import { OrderTicket } from "@/components/OrderTicket";
import { BalancePanel } from "@/components/BalancePanel";
import { PositionsTable } from "@/components/PositionsTable";
import { OpenOrdersTable } from "@/components/OpenOrdersTable";
import { Panel } from "@/components/ui";

type Tab = "positions" | "orders";

export default function TradePage() {
  const { market } = useActiveMarket();
  useDepthSnapshot(market?.id);
  const [prefill, setPrefill] = useState<{ price: string; n: number } | null>(
    null
  );
  const [tab, setTab] = useState<Tab>("positions");

  return (
    <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_300px_300px]">
      <div className="flex min-w-0 flex-col gap-3">
        <div className="h-[360px]">
          <PriceChart symbol={market?.symbol} />
        </div>

        <Panel className="flex flex-col">
          <div className="flex gap-4 border-b border-border px-3 text-sm">
            <TabButton active={tab === "positions"} onClick={() => setTab("positions")}>
              Positions
            </TabButton>
            <TabButton active={tab === "orders"} onClick={() => setTab("orders")}>
              Open Orders
            </TabButton>
          </div>
          <div className="max-h-[300px]">
            {tab === "positions" ? <PositionsTable /> : <OpenOrdersTable />}
          </div>
        </Panel>
      </div>

      <div className="h-[560px]">
        <OrderBook
          market={market}
          onPickPrice={(price) =>
            setPrefill((p) => ({ price, n: (p?.n ?? 0) + 1 }))
          }
        />
      </div>

      <div className="flex flex-col gap-3">
        <OrderTicket market={market} prefill={prefill} />
        <BalancePanel />
      </div>
    </div>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`py-2 ${
        active ? "border-b-2 border-accent text-text" : "text-dim"
      }`}
    >
      {children}
    </button>
  );
}
