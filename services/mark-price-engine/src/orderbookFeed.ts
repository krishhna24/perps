import { SubscriptionManager } from "@repo/pubsub";
import { emitTopOfBook, type TopOfBook } from "./priceBus.js";

export function connectOrderbookFeed(): void {
  SubscriptionManager.getInstance().subscribe("topOfBook:update", (raw: unknown) => {
    const payload = raw as { data: TopOfBook };
    emitTopOfBook(payload.data);
  });
}
