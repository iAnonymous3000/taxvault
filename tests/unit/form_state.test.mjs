import { describe, expect, it } from "vitest";

import { cloneSnapshot } from "../../web/modules/form_state.js";

describe("cloneSnapshot", () => {
  it("deep-clones the draft collections and nested records", () => {
    const original = {
      primaryFiler: { firstName: "Alex", ssn: "400-01-0001" },
      spouse: { firstName: "Jamie" },
      adjustments: { hsaDeduction: "500" },
      dependents: [{ firstName: "Mia" }],
      w2s: [{ employerName: "Northwind Co" }],
      socialSecurityIncome: [{ totalBenefits: "12000" }],
      interestIncome: [{ payerName: "Credit Union" }],
      dividendIncome: [{ payerName: "Brokerage" }],
    };

    const clone = cloneSnapshot(original);
    clone.primaryFiler.firstName = "Jordan";
    clone.dependents[0].firstName = "Avery";
    clone.w2s.push({ employerName: "Tailspin" });

    expect(original.primaryFiler.firstName).toBe("Alex");
    expect(original.dependents[0].firstName).toBe("Mia");
    expect(original.w2s).toHaveLength(1);
  });
});
