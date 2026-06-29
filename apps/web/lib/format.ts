import { Decimal } from "decimal.js";

const toDec = (v: string | number | null | undefined): Decimal => {
  if (v === null || v === undefined || v === "") return new Decimal(0);
  try {
    return new Decimal(v);
  } catch {
    return new Decimal(0);
  }
};

export function fmtPrice(v: string | number | null | undefined, dp = 2): string {
  return toDec(v).toFixed(dp);
}

export function fmtUsd(v: string | number | null | undefined, dp = 2): string {
  const d = toDec(v);
  const sign = d.isNegative() ? "-" : "";
  return `${sign}$${d.abs().toFixed(dp)}`;
}

export function fmtSigned(v: string | number | null | undefined, dp = 2): string {
  const d = toDec(v);
  const sign = d.isNegative() ? "" : d.isZero() ? "" : "+";
  return `${sign}${d.toFixed(dp)}`;
}

export function pnlColorClass(v: string | number | null | undefined): string {
  const d = toDec(v);
  if (d.isZero()) return "text-dim";
  return d.isNegative() ? "text-down" : "text-up";
}

export function decimalsOf(step: string | null | undefined): number {
  if (!step) return 2;
  const d = toDec(step);
  return d.isZero() ? 2 : Math.max(0, d.decimalPlaces());
}

export { Decimal, toDec };
