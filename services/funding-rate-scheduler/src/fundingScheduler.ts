import cron from "node-cron";
import { fundingQueue } from "@repo/queue";
import { getLatestFunding } from "./fundingRateCache.js";

const SETTLEMENT_CRON = "0 0,8,16 * * *";
const FUNDING_INTERVAL_MS = 8 * 60 * 60 * 1000;

export function startFundingScheduler(): cron.ScheduledTask {
  const task = cron.schedule(
    SETTLEMENT_CRON,
    () => {
      const snapshot = getLatestFunding();
      if (!snapshot) {
        console.warn("funding settlement skipped: no fundingRate:update received yet");
        return;
      }

      const windowId = Math.floor(Date.now() / FUNDING_INTERVAL_MS);
      const settlementSeq = windowId.toString();
      void fundingQueue.add(
        "apply_funding",
        { ...snapshot, settlementSeq },
        { jobId: `funding__${windowId}` },
      );
      console.log("funding settlement enqueued:", { ...snapshot, settlementSeq });
    },
    { timezone: "UTC" },
  );
  console.log("funding scheduler armed — next settlement at", SETTLEMENT_CRON, "UTC");
  return task;
}
