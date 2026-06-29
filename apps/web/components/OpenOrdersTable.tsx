"use client";

import { useOrders, useCancelOrder } from "@/hooks/queries";
import { fmtPrice, toDec } from "@/lib/format";
import { ApiError } from "@/lib/api";
import { toast } from "@/store/toastStore";
import { Button } from "@/components/ui";

const OPEN_STATUSES = new Set(["PENDING", "PARTIALLY_FILLED"]);

function fmtTime(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : d.toISOString().slice(11, 19);
}

export function OpenOrdersTable() {
  const { data: orders, isLoading } = useOrders();
  const cancelOrder = useCancelOrder();

  const open = (orders ?? []).filter((o) => OPEN_STATUSES.has(o.status));

  return (
    <div className="scroll-thin overflow-auto">
      <table className="w-full text-xs">
        <thead className="text-dim">
          <tr className="border-b border-border text-left">
            <Th>Time</Th>
            <Th>Side</Th>
            <Th>Type</Th>
            <Th className="text-right">Price</Th>
            <Th className="text-right">Qty</Th>
            <Th className="text-right">Filled</Th>
            <Th>Status</Th>
            <Th className="text-right">Action</Th>
          </tr>
        </thead>
        <tbody>
          {open.map((o) => (
            <tr key={o.id} className="border-b border-border/50">
              <Td className="text-dim">{fmtTime(o.createdAt)}</Td>
              <Td className={o.side === "LONG" ? "text-up" : "text-down"}>
                {o.side}
              </Td>
              <Td>{o.orderType}</Td>
              <Td className="tabular text-right">
                {o.price ? fmtPrice(o.price) : "MKT"}
              </Td>
              <Td className="tabular text-right">{toDec(o.quantity).toFixed(4)}</Td>
              <Td className="tabular text-right">
                {toDec(o.filledQuantity).toFixed(4)}
              </Td>
              <Td className="text-dim">{o.status}</Td>
              <Td className="text-right">
                <Button
                  variant="ghost"
                  className="px-2 py-1 text-xs"
                  disabled={cancelOrder.isPending}
                  onClick={() =>
                    cancelOrder.mutate(o.id, {
                      onSuccess: () => toast.info("Order cancelled"),
                      onError: (e) =>
                        toast.error(
                          e instanceof ApiError ? e.message : "Cancel failed"
                        ),
                    })
                  }
                >
                  Cancel
                </Button>
              </Td>
            </tr>
          ))}
        </tbody>
      </table>
      {!isLoading && open.length === 0 ? <Empty>No open orders</Empty> : null}
      {isLoading ? <Empty>Loading…</Empty> : null}
    </div>
  );
}

function Th({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return <th className={`px-3 py-2 font-medium ${className}`}>{children}</th>;
}
function Td({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return <td className={`px-3 py-2 ${className}`}>{children}</td>;
}
function Empty({ children }: { children: React.ReactNode }) {
  return <div className="py-6 text-center text-xs text-dim">{children}</div>;
}
