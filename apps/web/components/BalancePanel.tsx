"use client";

import { useState } from "react";
import { depositSchema } from "@/lib/schemas";
import { useBalance, useDeposit, useWithdraw } from "@/hooks/queries";
import { fmtUsd } from "@/lib/format";
import { ApiError } from "@/lib/api";
import { toast } from "@/store/toastStore";
import { Button, Input, Panel, PanelHeader } from "@/components/ui";

export function BalancePanel() {
  const { data: balance } = useBalance();
  const deposit = useDeposit();
  const withdraw = useWithdraw();
  const [amount, setAmount] = useState("");

  const validate = (): string | null => {
    const parsed = depositSchema.safeParse({ amount });
    return parsed.success ? null : parsed.error.issues[0]?.message ?? "Invalid amount";
  };

  const run = (kind: "deposit" | "withdraw") => {
    const err = validate();
    if (err) {
      toast.error(err);
      return;
    }
    const mut = kind === "deposit" ? deposit : withdraw;
    mut.mutate(amount, {
      onSuccess: () => {
        toast.success(
          `${kind === "deposit" ? "Deposit" : "Withdrawal"} accepted (settling…)`
        );
        setAmount("");
      },
      onError: (e) =>
        toast.error(e instanceof ApiError ? e.message : `${kind} failed`),
    });
  };

  const pending = deposit.isPending || withdraw.isPending;

  return (
    <Panel className="flex flex-col">
      <PanelHeader>Wallet</PanelHeader>
      <div className="space-y-3 p-3">
        <div className="flex justify-between text-sm">
          <span className="text-dim">Available</span>
          <span className="tabular">{fmtUsd(balance?.availableMargin ?? "0")}</span>
        </div>
        <div className="flex justify-between text-sm">
          <span className="text-dim">Locked</span>
          <span className="tabular">{fmtUsd(balance?.lockedMargin ?? "0")}</span>
        </div>
        <Input
          inputMode="decimal"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          placeholder="Amount (USDT)"
        />
        <div className="grid grid-cols-2 gap-2">
          <Button
            variant="up"
            disabled={pending}
            onClick={() => run("deposit")}
          >
            Deposit
          </Button>
          <Button
            variant="ghost"
            disabled={pending}
            onClick={() => run("withdraw")}
          >
            Withdraw
          </Button>
        </div>
      </div>
    </Panel>
  );
}
