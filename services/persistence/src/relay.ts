import { prisma } from "@repo/db";
import { enqueueRelayedCommand, type EngineCommand } from "@repo/queue";

const RELAY_INTERVAL_MS = 200;
const BATCH_SIZE = 200;

const GAP_TIMEOUT_MS = 5_000;

export function startRelay(): { stop: () => void } {
  let running = true;
  let inFlight = false;

  let lastRelayedSeq: bigint | null = null;

  let gapAt: bigint | null = null;
  let gapSince = 0;

  const loadWatermark = async (): Promise<bigint> => {
    if (lastRelayedSeq !== null) return lastRelayedSeq;
    const newest = await prisma.commandOutbox.findFirst({
      where: { status: "RELAYED" },
      orderBy: { seq: "desc" },
      select: { seq: true },
    });
    lastRelayedSeq = newest ? newest.seq : 0n;
    return lastRelayedSeq;
  };

  const tick = async (): Promise<void> => {
    if (!running || inFlight) return;
    inFlight = true;
    try {
      await loadWatermark();

      const rows = await prisma.commandOutbox.findMany({
        where: { status: "PENDING" },
        orderBy: { seq: "asc" },
        take: BATCH_SIZE,
      });
      if (rows.length === 0) {
        gapAt = null;
        return;
      }

      for (const row of rows) {
        const expected = lastRelayedSeq! + 1n;

        if (row.seq > expected) {
          const now = Date.now();
          if (gapAt !== expected) {
            gapAt = expected;
            gapSince = now;
          }
          if (now - gapSince < GAP_TIMEOUT_MS) return;

          console.warn(
            `outbox relay: seq ${expected}..${row.seq - 1n} did not commit within ` +
              `${GAP_TIMEOUT_MS}ms (rolled back) — skipping to ${row.seq}`,
          );
          lastRelayedSeq = row.seq - 1n;
        }

        gapAt = null;

        const command = {
          ...(row.payload as object),
          seq: row.seq.toString(),
        } as EngineCommand;
        await enqueueRelayedCommand(command, row.commandId);
        await prisma.commandOutbox.update({
          where: { seq: row.seq },
          data: { status: "RELAYED", relayedAt: new Date() },
        });
        lastRelayedSeq = row.seq;
      }
    } catch (error) {
      console.error("relay error:", error);
    } finally {
      inFlight = false;
    }
  };

  const timer = setInterval(() => void tick(), RELAY_INTERVAL_MS);
  console.log("outbox relay started — CommandOutbox → ORDER_QUEUE");
  return {
    stop: (): void => {
      running = false;
      clearInterval(timer);
    },
  };
}
