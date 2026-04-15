import { describe, expect, it } from "vitest";

import { normalizeMoneyValue } from "../../web/modules/money.js";

describe("normalizeMoneyValue", () => {
  it("normalizes currency symbols, separators, and trailing zeros", () => {
    expect(normalizeMoneyValue(" $001,200.50 ")).toBe("1200.5");
    expect(normalizeMoneyValue(".75")).toBe("0.75");
  });

  it("supports accounting-style negatives", () => {
    expect(normalizeMoneyValue("(1,250.00)")).toBe("-1250");
    expect(normalizeMoneyValue("-.5")).toBe("-0.5");
  });

  it("rejects invalid money shapes", () => {
    expect(normalizeMoneyValue("12.345")).toBeNull();
    expect(normalizeMoneyValue("abc")).toBeNull();
  });

  it("preserves blanks as blank", () => {
    expect(normalizeMoneyValue("   ")).toBe("");
  });
});
