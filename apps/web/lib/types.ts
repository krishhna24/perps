export type Side = "LONG" | "SHORT";
export type OrderType = "MARKET" | "LIMIT";
export type OrderStatus =
  | "PENDING"
  | "PARTIALLY_FILLED"
  | "FILLED"
  | "CANCELLED";

export interface Market {
  id: string;
  symbol: string;
  baseAsset: string;
  quoteAsset: string;
  imageUrl: string | null;
  tickSize: string;
  lotSize: string;
  minQty: string;
  maxLeverage: number;
  maintenanceMarginRate: string;
  takerFeeBps: number;
  makerFeeBps: number;
}

export interface Order {
  id: string;
  userId: string;
  marketId: string;
  side: Side;
  orderType: OrderType;
  price: string | null;
  quantity: string;
  filledQuantity: string;
  leverage: number;
  status: OrderStatus;
  createdAt: string;
  updatedAt: string;
}

export interface Position {
  id: string;
  userId: string;
  marketId: string;
  size: string; // signed: + long, - short
  entryPrice: string;
  liquidationPrice: string;
  leverage: number;
  margin: string;
  unrealizedPnl: string;
  realizedPnl: string;
  status: string;
  createdAt: string;
  updatedAt: string;
}

export interface Balance {
  userId: string;
  availableMargin: string;
  lockedMargin: string;
}

export type DepthLevel = [string, string]; // [price, qty]

export interface DepthSnapshot {
  marketId: string;
  bids: DepthLevel[];
  asks: DepthLevel[];
}

export interface WsEnvelope {
  channel: string;
  data: unknown;
}

export interface WsTrade {
  p: string | number;
  q: string | number;
}
export interface WsDepth {
  a: DepthLevel[]; // asks
  b: DepthLevel[]; // bids
}
export interface WsPrices {
  s: string; // symbol
  m: string | number; // mark price
  i: string | number; // index price
}
export interface WsBalance {
  a: string; // available
  l: string; // locked
}
export interface WsOrderCancelled {
  orderId: string;
}
export interface WsOrderRejected {
  userId: string;
  orderId: string;
  reason: string;
}
export interface WsPosition {
  userId: string;
  side: Side;
  quantity: string;
  entryPrice: string;
  margin: string;
  unrealizedPnl: string;
  liquidatedPrice: string;
  market: string;
  leverage: number;
}
