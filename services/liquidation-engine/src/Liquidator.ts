import { SubscriptionManager } from "@repo/pubsub";
import { liquidationQueue } from "@repo/queue";
import { Decimal } from "@repo/types";
import { computeLiquidationQty, type Position } from "./computeLiquidationQty.js";

export class Liquidator {
  private latestMarkPrice: Decimal | null = null;
  private userPositions = new Map<string, Position>();

  constructor() {
    const sub = SubscriptionManager.getInstance();

    sub.subscribe("markPrice:update", (raw: unknown) => {
      this.latestMarkPrice = new Decimal(raw as string);
      this.checkAllPositions();
    });

    sub.subscribe("position:update", (raw: unknown) => {
      const payload = raw as { data: Position[] };
      this.userPositions.clear();
      for (const position of payload.data) {
        this.userPositions.set(position.userId, position);
      }
      this.checkAllPositions();
    });
  }

  private checkAllPositions(): void {
    if (this.latestMarkPrice === null) return;
    for (const [userId, position] of this.userPositions.entries()) {
      if (position.side === "UNINITIALIZED") continue;
      const liquidationQty = computeLiquidationQty(position, this.latestMarkPrice);
      if (liquidationQty !== null && liquidationQty.greaterThan(0)) {
        this.enqueueLiquidation(userId, position, liquidationQty);
      }
    }
  }

  private enqueueLiquidation(userId: string, position: Position, liquidationQty: Decimal): void {






    void liquidationQueue.add(
      "liquidate_order",
      {
        ...position,
        userId,

        liquidationQty: liquidationQty.toFixed(8),
      },
      {
        jobId: userId,
        removeOnComplete: true,








        removeOnFail: true,





        attempts: 5,
        backoff: { type: "exponential", delay: 1000 },
      },
    );
  }
}
