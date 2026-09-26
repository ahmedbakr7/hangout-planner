export const AMOUNT_MINOR_MIN = 1;
export const AMOUNT_MINOR_MAX = 100_000_000_000;

export const CURRENCIES = [
  { code: "EGP", exponent: 2 },
  { code: "USD", exponent: 2 },
  { code: "SAR", exponent: 2 },
  { code: "AED", exponent: 2 },
] as const;

export type CurrencyCode = (typeof CURRENCIES)[number]["code"];

export type Money = {
  amountMinor: number;
  currency: CurrencyCode;
};

const CURRENCY_CODES: ReadonlySet<string> = new Set(
  CURRENCIES.map((currency) => currency.code),
);

export function isCurrencyCode(value: unknown): value is CurrencyCode {
  return typeof value === "string" && CURRENCY_CODES.has(value);
}

export function isAmountMinor(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= AMOUNT_MINOR_MIN &&
    value <= AMOUNT_MINOR_MAX
  );
}

export function parseMoney(value: unknown): Money | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }
  const record = value as { amount_minor?: unknown; currency?: unknown };
  if (!isAmountMinor(record.amount_minor) || !isCurrencyCode(record.currency)) {
    return null;
  }
  return { amountMinor: record.amount_minor, currency: record.currency };
}
