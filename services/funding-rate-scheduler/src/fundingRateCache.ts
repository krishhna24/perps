import { SubscriptionManager } from "@repo/pubsub";

export interface FundingSnapshot {

  fundingRate: string;
  markPrice: string;
}

let latest: FundingSnapshot | null = null;

export function getLatestFunding(): FundingSnapshot | null {
  return latest;
}

SubscriptionManager.getInstance().subscribe("fundingRate:update", (raw: unknown) => {
  latest = raw as FundingSnapshot;
});
