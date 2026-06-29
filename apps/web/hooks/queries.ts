"use client";

import { useEffect } from "react";
import {
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { api, type CreateOrderInput } from "@/lib/api";
import { qk } from "@/lib/queryKeys";
import { useAuthStore } from "@/store/authStore";
import { useMarketStore } from "@/store/marketStore";

function useAuthed() {
  return useAuthStore((s) => Boolean(s.token));
}

export function useMarkets() {
  return useQuery({
    queryKey: qk.markets,
    queryFn: async () => (await api.listMarkets()).markets,
    staleTime: 60_000,
  });
}

export function useBalance() {
  const authed = useAuthed();
  return useQuery({
    queryKey: qk.balance,
    queryFn: api.getBalance,
    enabled: authed,
  });
}

export function usePositions() {
  const authed = useAuthed();
  return useQuery({
    queryKey: qk.positions,
    queryFn: async () => (await api.getPositions()).positions,
    enabled: authed,
    refetchInterval: 30_000,
  });
}

export function useOrders() {
  const authed = useAuthed();
  return useQuery({
    queryKey: qk.orders,
    queryFn: async () => (await api.getOrders()).orders,
    enabled: authed,
    refetchInterval: 30_000,
  });
}

export function useDepthSnapshot(marketId: string | undefined) {
  const applyDepth = useMarketStore((s) => s.applyDepth);
  const query = useQuery({
    queryKey: qk.depth(marketId ?? ""),
    queryFn: () => api.getDepth(marketId!),
    enabled: Boolean(marketId),
  });

  useEffect(() => {
    if (query.data) applyDepth(query.data.bids, query.data.asks);
  }, [query.data, applyDepth]);

  return query;
}

export function usePlaceOrder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateOrderInput) => api.createOrder(input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.orders });
      qc.invalidateQueries({ queryKey: qk.balance });
      qc.invalidateQueries({ queryKey: qk.positions });
    },
  });
}

export function useCancelOrder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (orderId: string) => api.cancelOrder(orderId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.orders });
      qc.invalidateQueries({ queryKey: qk.balance });
    },
  });
}

export function useClosePosition() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (positionId: string) => api.closePosition(positionId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.positions });
      qc.invalidateQueries({ queryKey: qk.orders });
    },
  });
}

export function useDeposit() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (amount: string) => api.deposit(amount),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.balance }),
  });
}

export function useWithdraw() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (amount: string) => api.withdraw(amount),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.balance }),
  });
}
