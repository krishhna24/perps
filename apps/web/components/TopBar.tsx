"use client";

import { useRouter } from "next/navigation";
import { useAuthStore } from "@/store/authStore";
import { useMarketStore, useMarkPrice } from "@/store/marketStore";
import { useBalance } from "@/hooks/queries";
import { useActiveMarket } from "@/hooks/useActiveMarket";
import { fmtPrice, fmtUsd } from "@/lib/format";
import { Button } from "@/components/ui";

export function TopBar() {
  const router = useRouter();
  const logout = useAuthStore((s) => s.logout);
  const connected = useMarketStore((s) => s.connected);
  const { market } = useActiveMarket();
  const prices = useMarkPrice(market?.symbol);
  const markPrice = prices?.mark ?? null;
  const indexPrice = prices?.index ?? null;
  const { data: balance } = useBalance();

  return (
    <header className="flex items-center justify-between border-b border-border bg-panel px-4 py-2">
      <div className="flex items-center gap-6">
        <span className="text-lg font-bold">
          Perps<span className="text-accent">.</span>
        </span>
        <div className="flex items-center gap-2">
          <span className="font-semibold">{market?.symbol ?? "—"}</span>
          <span
            className={`h-2 w-2 rounded-full ${connected ? "bg-up" : "bg-down"}`}
            title={connected ? "Live" : "Disconnected"}
          />
        </div>
        <div className="hidden gap-6 sm:flex">
          <Metric label="Mark" value={markPrice ? fmtPrice(markPrice) : "—"} />
          <Metric label="Index" value={indexPrice ? fmtPrice(indexPrice) : "—"} />
        </div>
      </div>

      <div className="flex items-center gap-4">
        <div className="hidden text-right sm:block">
          <div className="text-xs text-dim">Available</div>
          <div className="tabular text-sm">
            {fmtUsd(balance?.availableMargin ?? "0")}
          </div>
        </div>
        <div className="hidden text-right sm:block">
          <div className="text-xs text-dim">Locked</div>
          <div className="tabular text-sm">
            {fmtUsd(balance?.lockedMargin ?? "0")}
          </div>
        </div>
        <Button
          variant="ghost"
          onClick={() => {
            logout();
            router.replace("/login");
          }}
        >
          Logout
        </Button>
      </div>
    </header>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs text-dim">{label}</div>
      <div className="tabular text-sm">{value}</div>
    </div>
  );
}
