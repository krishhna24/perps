"use client";

import { useEffect, useMemo, useState } from "react";
import { createOrderSchema } from "@/lib/schemas";
import type { Market, OrderType, Side } from "@/lib/types";
import { Decimal, fmtUsd } from "@/lib/format";
import { useMarkPrice } from "@/store/marketStore";
import { useBalance } from "@/hooks/queries";
import { usePlaceOrder } from "@/hooks/queries";
import { ApiError } from "@/lib/api";
import { toast } from "@/store/toastStore";
import { Button, Input, Panel, PanelHeader } from "@/components/ui";

export function OrderTicket({
  market,
  prefill,
}: {
  market: Market | undefined;
  prefill?: { price: string; n: number } | null;
}) {
  const [side, setSide] = useState<Side>("LONG");
  const [orderType, setOrderType] = useState<OrderType>("LIMIT");
  const [price, setPrice] = useState("");
  const [quantity, setQuantity] = useState("");
  const [leverage, setLeverage] = useState(10);
  const [error, setError] = useState<string | null>(null);

  const markPrice = useMarkPrice(market?.symbol)?.mark ?? null;
  const { data: balance } = useBalance();
  const placeOrder = usePlaceOrder();

  const maxLev = market?.maxLeverage ?? 125;

  useEffect(() => {
    if (prefill?.price) {
      setOrderType("LIMIT");
      setPrice(prefill.price);
    }
  }, [prefill?.price, prefill?.n]);

  useEffect(() => {
    if (leverage > maxLev) setLeverage(maxLev);
  }, [maxLev, leverage]);

  const refPrice = orderType === "LIMIT" ? price : markPrice ?? "";

  const estMargin = useMemo(() => {
    try {
      if (!refPrice || !quantity) return null;
      const notional = new Decimal(refPrice).mul(quantity);
      if (notional.isZero()) return null;
      return notional.div(leverage || 1);
    } catch {
      return null;
    }
  }, [refPrice, quantity, leverage]);

  const submit = () => {
    setError(null);
    if (!market) {
      setError("No market selected");
      return;
    }
    const input = {
      marketId: market.id,
      side,
      orderType,
      quantity,
      ...(orderType === "LIMIT" ? { price } : {}),
      leverage,
    };
    const parsed = createOrderSchema.safeParse(input);
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Invalid order");
      return;
    }
    placeOrder.mutate(parsed.data, {
      onSuccess: () => {
        toast.success(`${side} ${orderType} order placed`);
        setQuantity("");
      },
      onError: (e) =>
        setError(e instanceof ApiError ? e.message : "Order failed"),
    });
  };

  return (
    <Panel className="flex flex-col">
      <PanelHeader>Place Order</PanelHeader>
      <div className="space-y-3 p-3">
        <div className="grid grid-cols-2 gap-2">
          <Toggle active={side === "LONG"} variant="up" onClick={() => setSide("LONG")}>
            Long / Buy
          </Toggle>
          <Toggle
            active={side === "SHORT"}
            variant="down"
            onClick={() => setSide("SHORT")}
          >
            Short / Sell
          </Toggle>
        </div>

        <div className="flex gap-3 text-sm">
          {(["LIMIT", "MARKET"] as OrderType[]).map((t) => (
            <button
              key={t}
              onClick={() => setOrderType(t)}
              className={`pb-1 ${
                orderType === t
                  ? "border-b-2 border-accent text-text"
                  : "text-dim"
              }`}
            >
              {t === "LIMIT" ? "Limit" : "Market"}
            </button>
          ))}
        </div>

        {orderType === "LIMIT" ? (
          <label className="block">
            <span className="mb-1 block text-xs text-dim">
              Price ({market?.quoteAsset ?? "USD"})
            </span>
            <Input
              inputMode="decimal"
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              placeholder="0.00"
            />
          </label>
        ) : null}

        <label className="block">
          <span className="mb-1 block text-xs text-dim">
            Quantity ({market?.baseAsset ?? ""})
          </span>
          <Input
            inputMode="decimal"
            value={quantity}
            onChange={(e) => setQuantity(e.target.value)}
            placeholder="0.000"
          />
        </label>

        <div>
          <div className="mb-1 flex justify-between text-xs text-dim">
            <span>Leverage</span>
            <span className="tabular text-text">{leverage}×</span>
          </div>
          <input
            type="range"
            min={1}
            max={maxLev}
            value={leverage}
            onChange={(e) => setLeverage(Number(e.target.value))}
            className="w-full accent-[var(--accent)]"
          />
        </div>

        <div className="flex justify-between text-xs text-dim">
          <span>Est. margin</span>
          <span className="tabular text-text">
            {estMargin ? fmtUsd(estMargin.toString()) : "—"}
          </span>
        </div>
        <div className="flex justify-between text-xs text-dim">
          <span>Available</span>
          <span className="tabular text-text">
            {fmtUsd(balance?.availableMargin ?? "0")}
          </span>
        </div>

        {error ? <p className="text-xs text-down">{error}</p> : null}

        <Button
          variant={side === "LONG" ? "up" : "down"}
          className="w-full"
          disabled={placeOrder.isPending}
          onClick={submit}
        >
          {placeOrder.isPending
            ? "Submitting…"
            : `${side === "LONG" ? "Buy / Long" : "Sell / Short"}`}
        </Button>
      </div>
    </Panel>
  );
}

function Toggle({
  active,
  variant,
  onClick,
  children,
}: {
  active: boolean;
  variant: "up" | "down";
  onClick: () => void;
  children: React.ReactNode;
}) {
  const base = "rounded-md py-2 text-sm font-semibold transition";
  const color =
    variant === "up"
      ? active
        ? "bg-up text-black"
        : "bg-panel2 text-up"
      : active
        ? "bg-down text-white"
        : "bg-panel2 text-down";
  return (
    <button onClick={onClick} className={`${base} ${color}`}>
      {children}
    </button>
  );
}
