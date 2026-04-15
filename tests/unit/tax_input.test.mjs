import { afterEach, describe, expect, it, vi } from "vitest";

import { validateStep1Snapshot } from "../../web/modules/tax_input.js";

const SSN_PATTERN = /^\d{3}-\d{2}-\d{4}$/;
const SUPPORTED_HOH_RELATIONSHIPS = new Set([
  "son",
  "daughter",
  "stepchild",
  "foster_child",
  "sibling",
  "step_sibling",
  "half_sibling",
  "grandchild",
  "niece",
  "nephew",
  "grandparent",
]);

afterEach(() => {
  vi.useRealTimers();
});

describe("validateStep1Snapshot", () => {
  it("reports field errors for invalid filer data", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-14T12:00:00Z"));

    const result = validateStep1Snapshot({
      snapshot: {
        primaryFiler: {
          firstName: "",
          lastName: "Filer",
          ssn: "400-01-0001",
          dob: "2026-04-15",
        },
        spouse: {},
        dependents: [],
      },
      filingStatus: "single",
      ssnPattern: SSN_PATTERN,
      supportedHohRelationships: SUPPORTED_HOH_RELATIONSHIPS,
    });

    expect(result.messages).toContain("First name is required.");
    expect(result.messages).toContain("Date of birth must be a real date in the past.");
    expect(result.fieldErrors).toEqual(
      expect.arrayContaining([
        { id: "pFirst", msg: "Required" },
        { id: "pDob", msg: "Must be a past date" },
      ])
    );
  });

  it("blocks duplicate SSNs before calculate", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-14T12:00:00Z"));

    const result = validateStep1Snapshot({
      snapshot: {
        primaryFiler: {
          firstName: "Alex",
          lastName: "Filer",
          ssn: "400-01-0001",
          dob: "1990-06-15",
          isDependent: false,
        },
        spouse: {},
        dependents: [
          {
            firstName: "Pat",
            lastName: "Parent",
            ssn: "400-01-0001",
            dob: "1960-05-01",
            relationship: "parent",
            monthsLivedInHome: "0",
          },
        ],
      },
      filingStatus: "head_of_household",
      ssnPattern: SSN_PATTERN,
      supportedHohRelationships: SUPPORTED_HOH_RELATIONSHIPS,
    });

    expect(result.messages).toContain("Primary filer and Dependent #1 must have different SSNs.");
  });

  it("flags unsupported head of household parent-only cases once identity checks pass", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-14T12:00:00Z"));

    const result = validateStep1Snapshot({
      snapshot: {
        primaryFiler: {
          firstName: "Alex",
          lastName: "Filer",
          ssn: "400-01-0001",
          dob: "1990-06-15",
          isDependent: false,
        },
        spouse: {},
        dependents: [
          {
            firstName: "Pat",
            lastName: "Parent",
            ssn: "400-01-0002",
            dob: "1960-05-01",
            relationship: "parent",
            monthsLivedInHome: "0",
          },
        ],
      },
      filingStatus: "head_of_household",
      ssnPattern: SSN_PATTERN,
      supportedHohRelationships: SUPPORTED_HOH_RELATIONSHIPS,
    });

    expect(result.messages).toContain(
      "Head of Household with only a dependent parent is outside TaxVault's supported estimate slice. TaxVault does not collect the parent-home support facts needed to screen it."
    );
  });
});
