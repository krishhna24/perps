import { Decimal } from "decimal.js";

export { Decimal };

export type DecimalInput = string | number | Decimal;

export function toDecimal(value: DecimalInput): Decimal {
  return new Decimal(value);
}

export function isValidDecimalString(value: string): boolean {
  try {
    const d = new Decimal(value);
    return d.isFinite();
  } catch {
    return false;
  }
}

export const add = (a: DecimalInput, b: DecimalInput): Decimal =>
  new Decimal(a).plus(b);

export const sub = (a: DecimalInput, b: DecimalInput): Decimal =>
  new Decimal(a).minus(b);

export const mul = (a: DecimalInput, b: DecimalInput): Decimal =>
  new Decimal(a).times(b);

export const div = (a: DecimalInput, b: DecimalInput): Decimal =>
  new Decimal(a).dividedBy(b);

export const gt = (a: DecimalInput, b: DecimalInput): boolean =>
  new Decimal(a).greaterThan(b);

export const gte = (a: DecimalInput, b: DecimalInput): boolean =>
  new Decimal(a).greaterThanOrEqualTo(b);

export const lt = (a: DecimalInput, b: DecimalInput): boolean =>
  new Decimal(a).lessThan(b);

export const lte = (a: DecimalInput, b: DecimalInput): boolean =>
  new Decimal(a).lessThanOrEqualTo(b);

export const eq = (a: DecimalInput, b: DecimalInput): boolean =>
  new Decimal(a).equals(b);

export const isPositive = (a: DecimalInput): boolean =>
  new Decimal(a).greaterThan(0);

export const isNonNegative = (a: DecimalInput): boolean =>
  new Decimal(a).greaterThanOrEqualTo(0);

export const toFixedString = (a: DecimalInput, decimals = 8): string =>
  new Decimal(a).toFixed(decimals);
