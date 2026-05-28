import { v4 as uuidv4 } from "uuid";
import { Decimal } from "@repo/types";
import { logger } from "@repo/logger";
import type {
  DepthLevel,
  Fill,
  MarketDepth,
  MatchResult,
  Order,
  OrderSide,
  OrderbookSnapshot,
} from "./types.js";

export class Orderbook {
  constructor(
    public bids: Order[] = [],
    public asks: Order[] = [],
    public market: string = "BTCUSDT",
  ) {
    this.bids = bids;
    this.asks = asks;
    this.market = market;

    this.sortOrders();
  }

  getSnapshot(): OrderbookSnapshot {
    return {
      bids: this.bids,
      asks: this.asks,
      market: this.market,
    };
  }

  private sortOrders() {
    this.bids.sort((a, b) => b.entryPrice - a.entryPrice);
    this.asks.sort((a, b) => a.entryPrice - b.entryPrice);
  }


  addOrder(order: Order, allowResting = true): MatchResult {
    if (order.side === "LONG") {
      const { executedQty, fills, updatedOrders } = this.matchBid(order);
      if (allowResting && executedQty < order.quantity) {
        this.bids.push({ ...order, filled: executedQty });
        this.sortOrders();
      }
      return { executedQty, fills, updatedOrders };
    } else {
      const { executedQty, fills, updatedOrders } = this.matchAsk(order);
      if (allowResting && executedQty < order.quantity) {
        this.asks.push({ ...order, filled: executedQty });
        this.sortOrders();
      }
      return { executedQty, fills, updatedOrders };
    }
  }

  matchAsk(order: Order): MatchResult {
    let executedQty = 0;
    const fills: Fill[] = [];
    const updatedOrders: Order[] = [];

    for (const bid of this.bids) {
      if (executedQty >= order.quantity) break;
      if (order.entryPrice > bid.entryPrice) continue;
      if (order.userId === bid.userId) continue;





      const remaining = bid.quantity - bid.filled;
      if (remaining <= 0) continue;
      const traded = Math.min(remaining, order.quantity - executedQty);
      executedQty += traded;
      bid.filled += traded;
      updatedOrders.push(bid);

      fills.push({
        fillId: uuidv4(),
        orderId: order.id!,
        userId: order.userId,
        otherUserId: bid.userId,
        otherOrderId: bid.id!,
        price: bid.entryPrice,
        quantity: traded,
        otherLeverage: bid.leverage,
      });
    }
    this.bids = this.bids.filter((bid) => bid.filled < bid.quantity);
    return { executedQty, fills, updatedOrders };
  }

  matchBid(order: Order): MatchResult {
    let executedQty = 0;
    const fills: Fill[] = [];
    const updatedOrders: Order[] = [];

    for (const ask of this.asks) {
      if (executedQty >= order.quantity) break;
      if (order.entryPrice < ask.entryPrice) continue;
      if (order.userId === ask.userId) continue;




      const remaining = ask.quantity - ask.filled;
      if (remaining <= 0) continue;
      const traded = Math.min(remaining, order.quantity - executedQty);
      executedQty += traded;
      ask.filled += traded;
      updatedOrders.push(ask);

      fills.push({
        fillId: uuidv4(),
        orderId: order.id!,
        userId: order.userId,
        otherUserId: ask.userId,
        otherOrderId: ask.id!,
        price: ask.entryPrice,
        quantity: traded,
        otherLeverage: ask.leverage,
      });
    }
    this.asks = this.asks.filter((ask) => ask.filled < ask.quantity);
    return { executedQty, fills, updatedOrders };
  }

  getMarketDepth(): MarketDepth {
    return {
      asks: this.aggregateByPrice(this.asks, false),
      bids: this.aggregateByPrice(this.bids, true),
    };
  }

  private aggregateByPrice(orders: Order[], descending = true): DepthLevel[] {
    const priceMap = new Map<number, number>();

    orders.forEach((order) => {



      const remaining = order.quantity - order.filled;
      if (remaining > 0) {
        priceMap.set(order.entryPrice, (priceMap.get(order.entryPrice) ?? 0) + remaining);
      }
    });

    const entries: DepthLevel[] = Array.from(priceMap.entries()).map(([price, quantity]) => [
      price.toString(),
      quantity.toString(),
    ]);



    return descending
      ? entries.sort((a, b) => new Decimal(b[0]).comparedTo(a[0]))
      : entries.sort((a, b) => new Decimal(a[0]).comparedTo(b[0]));
  }

  getOpenOrders(userId: string): Order[] {
    const userBids = this.bids.filter((bid) => bid.userId === userId);
    const userAsks = this.asks.filter((ask) => ask.userId === userId);

    return [...userAsks, ...userBids];
  }

  cancelOrder(orderId: string, userId: string): void {
    const bidIndex = this.bids.findIndex((bid) => bid.userId === userId && bid.id === orderId);
    if (bidIndex !== -1) {
      this.bids.splice(bidIndex, 1);
      logger.debug("order cancelled");
    }
    const askIndex = this.asks.findIndex((ask) => ask.userId === userId && ask.id === orderId);
    if (askIndex !== -1) {
      this.asks.splice(askIndex, 1);
      logger.debug("order cancelled");
    }
  }


  getBestOppositePrice(side: OrderSide, quantity: number): number | undefined {
    const levels = side === "LONG" ? this.asks : this.bids;
    let bestPrice: number | undefined;
    let fillQuantity = 0;
    for (const level of levels) {

      const remaining = level.quantity - level.filled;
      if (remaining <= 0) continue;
      bestPrice = level.entryPrice;
      fillQuantity += remaining;
      if (fillQuantity >= quantity) break;
    }
    return bestPrice;
  }
}
