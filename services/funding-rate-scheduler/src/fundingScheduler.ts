import cron from "node-cron";
import { fundingQueue } from "@repo/queue";
import { getLatestFunding } from "./fundingRateCache.js";

const SETTLEMENT_CRON = "0 0,8,16 * * *";

export function startFundingScheduler(): cron.ScheduledTask {
  const task = cron.schedule(
    SETTLEMENT_CRON,
    () => {
      const snapshot = getLatestFunding();
      if (!snapshot) {
        console.warn("funding settlement skipped: no fundingRate:update received yet");
        return;
      }



      const settlementSeq = Date.now().toString();
      void fundingQueue.add(
        "apply_funding",
        { ...snapshot, settlementSeq },
        { jobId: `funding__${settlementSeq}` },
      );
      console.log("funding settlement enqueued:", { ...snapshot, settlementSeq });
    },
    { timezone: "UTC" },
  );
  console.log("funding scheduler armed — next settlement at", SETTLEMENT_CRON, "UTC");
  return task;
}
