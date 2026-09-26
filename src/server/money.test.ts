import { describe, expect, it } from "vitest";
import {
  AMOUNT_MINOR_MAX,
  AMOUNT_MINOR_MIN,
  CURRENCIES,
  isAmountMinor,
  isCurrencyCode,
  parseMoney,
} from "./money";

describe("CURRENCIES", () => {
  it("is EGP, USD, SAR, and AED, each with exponent 2", () => {
    expect(CURRENCIES).toEqual([
      { code: "EGP", exponent: 2 },
      { code: "USD", exponent: 2 },
      { code: "SAR", exponent: 2 },
      { code: "AED", exponent: 2 },
    ]);
    expect(CURRENCIES.every((currency) => currency.exponent === 2)).toBe(true);
  });
});

describe("isAmountMinor", () => {
  it("accepts integers from 1 through 100000000000", () => {
    expect(AMOUNT_MINOR_MIN).toBe(1);
    expect(AMOUNT_MINOR_MAX).toBe(100_000_000_000);
    expect(isAmountMinor(1)).toBe(true);
    expect(isAmountMinor(50_000)).toBe(true);
    expect(isAmountMinor(100_000_000_000)).toBe(true);
  });

  it("rejects amounts outside 1 through 100000000000 and non-integers", () => {
    expect(isAmountMinor(0)).toBe(false);
    expect(isAmountMinor(-1)).toBe(false);
    expect(isAmountMinor(100_000_000_001)).toBe(false);
    expect(isAmountMinor(1.5)).toBe(false);
    expect(isAmountMinor(NaN)).toBe(false);
    expect(isAmountMinor(Infinity)).toBe(false);
    expect(isAmountMinor("1")).toBe(false);
    expect(isAmountMinor(null)).toBe(false);
    expect(isAmountMinor(undefined)).toBe(false);
  });
});

describe("isCurrencyCode", () => {
  it("accepts the listed codes and rejects anything else", () => {
    expect(isCurrencyCode("EGP")).toBe(true);
    expect(isCurrencyCode("USD")).toBe(true);
    expect(isCurrencyCode("SAR")).toBe(true);
    expect(isCurrencyCode("AED")).toBe(true);
    expect(isCurrencyCode("egp")).toBe(false);
    expect(isCurrencyCode("EUR")).toBe(false);
    expect(isCurrencyCode("")).toBe(false);
    expect(isCurrencyCode(2)).toBe(false);
  });
});

describe("parseMoney", () => {
  it("parses a wire money object in minor units", () => {
    expect(parseMoney({ amount_minor: 50_000, currency: "EGP" })).toEqual({
      amountMinor: 50_000,
      currency: "EGP",
    });
  });

  it("rejects invalid amount_minor or currency", () => {
    expect(parseMoney({ amount_minor: 0, currency: "EGP" })).toBeNull();
    expect(parseMoney({ amount_minor: 100_000_000_001, currency: "USD" })).toBeNull();
    expect(parseMoney({ amount_minor: 50_000, currency: "EUR" })).toBeNull();
    expect(parseMoney({ amount_minor: 50_000.5, currency: "EGP" })).toBeNull();
    expect(parseMoney({ currency: "EGP" })).toBeNull();
    expect(parseMoney({ amount_minor: 50_000 })).toBeNull();
    expect(parseMoney(null)).toBeNull();
    expect(parseMoney("EGP")).toBeNull();
  });
});
