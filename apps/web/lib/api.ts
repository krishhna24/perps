import { useAuthStore } from "@/store/authStore";
import type {
  Balance,
  DepthSnapshot,
  Market,
  Order,
  Position,
} from "@/lib/types";

const BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3000";
const REQUEST_TIMEOUT_MS = 15000;

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
    this.name = "ApiError";
  }
}

let refreshInFlight: Promise<boolean> | null = null;

async function tryRefresh(): Promise<boolean> {
  if (!refreshInFlight) {
    refreshInFlight = (async () => {
      try {
        const res = await fetch(`${BASE}/api/auth/refresh`, {
          method: "POST",
          credentials: "include",
        });
        if (!res.ok) return false;
        const data = (await res.json()) as { token?: string };
        if (!data.token) return false;
        useAuthStore.getState().login(data.token);
        return true;
      } catch {
        return false;
      }
    })();
    refreshInFlight.finally(() => {
      refreshInFlight = null;
    });
  }
  return refreshInFlight;
}

async function request<T>(
  path: string,
  options: RequestInit = {},
  allowRefresh = true
): Promise<T> {
  const token = useAuthStore.getState().token;
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...((options.headers as Record<string, string>) ?? {}),
  };
  if (token) headers.Authorization = `Bearer ${token}`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(`${BASE}/api${path}`, {
      ...options,
      headers,
      credentials: "include",
      signal: controller.signal,
    });
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") {
      throw new ApiError(408, "Request timed out. Please try again.");
    }
    throw new ApiError(0, "Network error. Please check your connection.");
  } finally {
    clearTimeout(timeout);
  }

  if (res.status === 401) {
    if (allowRefresh && path !== "/auth/refresh") {
      const refreshed = await tryRefresh();
      if (refreshed) return request<T>(path, options, false);
    }
    useAuthStore.getState().logout();
    throw new ApiError(401, "Session expired. Please sign in again.");
  }

  const text = await res.text();
  let body: unknown = null;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      throw new ApiError(
        res.status,
        res.ok ? "Malformed response from server" : res.statusText
      );
    }
  }

  if (!res.ok) {
    const message =
      (body && typeof body === "object" && "message" in body
        ? String((body as { message: unknown }).message)
        : null) ?? res.statusText;
    throw new ApiError(res.status, message);
  }

  return body as T;
}

export interface CreateOrderInput {
  marketId: string;
  side: "LONG" | "SHORT";
  orderType: "MARKET" | "LIMIT";
  quantity: string;
  price?: string;
  leverage: number;
}

export const api = {
  register: (body: { username: string; email: string; password: string }) =>
    request<{ token: string }>("/auth/register", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  login: (body: { email: string; password: string }) =>
    request<{ token: string }>("/auth/login", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  logout: async () => {
    try {
      await request<{ success: boolean }>("/auth/logout", { method: "POST" });
    } finally {
      useAuthStore.getState().logout();
    }
  },
  getWsTicket: () =>
    request<{ ticket: string }>("/ws-ticket", { method: "POST" }),

  listMarkets: () => request<{ markets: Market[] }>("/markets"),
  getDepth: (marketId: string) =>
    request<DepthSnapshot>(`/depth/${marketId}`),

  getBalance: () => request<Balance>("/balance"),
  deposit: (amount: string) =>
    request<{ message: string; ledgerId: string }>("/balance/deposit", {
      method: "POST",
      body: JSON.stringify({ amount }),
    }),
  withdraw: (amount: string) =>
    request<{ message: string; ledgerId: string }>("/balance/withdraw", {
      method: "POST",
      body: JSON.stringify({ amount }),
    }),

  getPositions: () => request<{ positions: Position[] }>("/positions"),
  closePosition: (positionId: string) =>
    request<{ message: string; positionId: string; orderId: string }>(
      `/positions/${positionId}`,
      { method: "DELETE" }
    ),

  getOrders: () => request<{ orders: Order[] }>("/orders"),
  createOrder: (input: CreateOrderInput) =>
    request<{ order: Order }>("/orders", {
      method: "POST",
      body: JSON.stringify(input),
    }),
  cancelOrder: (orderId: string) =>
    request<{ message: string; orderId: string; refundedMargin: string }>(
      `/orders/${orderId}`,
      { method: "DELETE" }
    ),
};
