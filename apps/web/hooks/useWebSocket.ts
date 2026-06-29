"use client";

import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Decimal } from "decimal.js";
import { useAuthStore } from "@/store/authStore";
import { useMarketStore } from "@/store/marketStore";
import { api } from "@/lib/api";
import { qk } from "@/lib/queryKeys";
import { toast } from "@/store/toastStore";
import type {
  Balance,
  Market,
  Order,
  Position,
  WsBalance,
  WsDepth,
  WsEnvelope,
  WsOrderCancelled,
  WsOrderRejected,
  WsPosition,
  WsPrices,
  WsTrade,
} from "@/lib/types";

const WS_URL = process.env.NEXT_PUBLIC_WS_URL ?? "ws://localhost:8080";

function inner(d: unknown): unknown {
  return d && typeof d === "object" && "data" in (d as Record<string, unknown>)
    ? (d as { data: unknown }).data
    : d;
}

export function useWebSocket() {
  const token = useAuthStore((s) => s.token);
  const userId = useAuthStore((s) => s.userId);
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!token) {
      useMarketStore.getState().setConnected(false);
      return;
    }

    let cancelled = false;
    let ws: WebSocket | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let attempt = 0;

    const scheduleReconnect = () => {
      if (cancelled) return;
      const delay = Math.min(1000 * 2 ** attempt, 10000);
      attempt += 1;
      reconnectTimer = setTimeout(connect, delay);
    };

    const connect = async () => {
      if (cancelled) return;

      let ticket: string;
      try {
        ticket = (await api.getWsTicket()).ticket;
      } catch {
        scheduleReconnect();
        return;
      }
      if (cancelled) return;

      const socket = new WebSocket(
        `${WS_URL}?ticket=${encodeURIComponent(ticket)}`
      );
      ws = socket;

      socket.onopen = () => {
        if (cancelled) return;
        attempt = 0;
        useMarketStore.getState().setConnected(true);
        queryClient.invalidateQueries({ queryKey: qk.balance });
        queryClient.invalidateQueries({ queryKey: qk.positions });
        queryClient.invalidateQueries({ queryKey: qk.orders });
        queryClient.invalidateQueries({ queryKey: ["depth"] });
      };

      socket.onmessage = (event) => {
        if (cancelled) return;
        let envelope: WsEnvelope;
        try {
          envelope = JSON.parse(event.data as string) as WsEnvelope;
        } catch {
          return;
        }
        handleMessage(envelope, userId, queryClient);
      };

      socket.onclose = (event) => {
        if (cancelled) return;
        useMarketStore.getState().setConnected(false);
        if (event.code === 4001) {
          cancelled = true;
          useAuthStore.getState().logout();
          return;
        }
        scheduleReconnect();
      };

      socket.onerror = () => {
        socket.close();
      };
    };

    connect();

    return () => {
      cancelled = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      ws?.close();
      ws = null;
      useMarketStore.getState().setConnected(false);
    };
  }, [token, userId, queryClient]);
}

function handleMessage(
  envelope: WsEnvelope,
  userId: string | null,
  queryClient: ReturnType<typeof useQueryClient>
) {
  const { channel } = envelope;
  const payload = inner(envelope.data);
  const market = useMarketStore.getState();

  if (channel === "trade:update") {
    const d = payload as WsTrade;
    if (d?.p != null && d.p !== "") {
      market.applyTrade(String(d.p), String(d.q));
    }
    return;
  }

  if (channel === "depth:update") {
    const d = payload as WsDepth;
    market.applyDepth(d?.b ?? [], d?.a ?? []);
    return;
  }

  if (channel === "prices:update") {
    const d = payload as WsPrices;
    if (d?.s != null && d.s !== "" && d.m != null && d.m !== "") {
      market.applyPrices(String(d.s), String(d.m), String(d.i ?? d.m));
    }
    return;
  }

  if (channel === "order:cancelled") {
    const d = payload as WsOrderCancelled;
    queryClient.setQueryData<Order[]>(qk.orders, (prev) =>
      prev
        ? prev.map((o) =>
            o.id === d.orderId ? { ...o, status: "CANCELLED" } : o
          )
        : prev
    );
    return;
  }

  if (channel.startsWith("balance@")) {
    const d = payload as WsBalance;
    queryClient.setQueryData<Balance>(qk.balance, (prev) =>
      prev
        ? { ...prev, availableMargin: d.a, lockedMargin: d.l }
        : userId
          ? { userId, availableMargin: d.a, lockedMargin: d.l }
          : prev
    );
    return;
  }

  if (channel === "position:update") {
    const list = (Array.isArray(payload) ? payload : []) as WsPosition[];
    if (!list.length) return;

    const markets = queryClient.getQueryData<Market[]>(qk.markets) ?? [];
    const symbolToId = new Map(markets.map((m) => [m.symbol, m.id]));

    const byMarketId = new Map<string, WsPosition>();
    let mappedAll = true;
    for (const p of list) {
      const id = symbolToId.get(p.market);
      if (id) byMarketId.set(id, p);
      else mappedAll = false;
    }

    if (byMarketId.size === 0) {
      if (!mappedAll) queryClient.invalidateQueries({ queryKey: qk.positions });
      return;
    }

    queryClient.setQueryData<Position[]>(qk.positions, (prev) => {
      if (!prev) return prev;
      return prev.map((pos) => {
        const w = byMarketId.get(pos.marketId);
        if (!w) return pos;
        const signedSize =
          w.side === "SHORT"
            ? new Decimal(w.quantity).negated().toString()
            : w.quantity;
        return {
          ...pos,
          size: signedSize,
          entryPrice: w.entryPrice,
          margin: w.margin,
          unrealizedPnl: w.unrealizedPnl,
          liquidationPrice: w.liquidatedPrice,
          leverage: w.leverage,
        };
      });
    });
    return;
  }

  if (channel.startsWith("order:rejected@")) {
    const d = payload as WsOrderRejected;
    toast.error(`Order rejected: ${d.reason}`);
    queryClient.invalidateQueries({ queryKey: qk.orders });
    queryClient.invalidateQueries({ queryKey: qk.balance });
    return;
  }
}
