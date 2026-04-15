import { describe, expect, it } from "vitest";

import {
  buildSupportSnapshotRedactions,
  createDraftHelpers,
} from "../../web/modules/draft_helpers.js";

function createHelpers() {
  return createDraftHelpers({
    constants: {},
    currentTaxYear: () => 2025,
    normalizeTaxYear: (value) => Number(value || 2025),
    isSupportedTaxYear: () => true,
    supportedTaxYearEntries: () => [],
    normalizeFilingStatus: (value) => value || "single",
    normalizeIncomeRecipient: (value) => (value === "spouse" ? "spouse" : "primary"),
    normalizeDependentRelationship: (value) => value || "other",
    normalizeDraftStep: (value) => Number(value || 1),
    isPlainObject: (value) => Boolean(value) && typeof value === "object" && !Array.isArray(value),
  });
}

describe("buildSupportSnapshotRedactions", () => {
  it("builds stable replacements for names, identifiers, and issuer labels", () => {
    const replacements = buildSupportSnapshotRedactions({
      primaryFiler: {
        firstName: "Alex",
        lastName: "Filer",
        ssn: "400-01-0001",
        dob: "1990-06-15",
      },
      dependents: [
        {
          firstName: "Mia",
          lastName: "Filer",
          ssn: "400-01-0002",
          dob: "2018-04-11",
        },
      ],
      w2s: [{ employerName: "Northwind Co", employerEin: "12-3456789" }],
      interestIncome: [{ payerName: "Contoso Bank" }],
    });

    expect(replacements).toEqual(
      expect.arrayContaining([
        { text: "Alex Filer", replacement: "Primary filer" },
        { text: "400-01-0001", replacement: "[redacted ssn]" },
        { text: "1990-06-15", replacement: "[redacted dob]" },
        { text: "Mia Filer", replacement: "Dependent 1" },
        { text: "Northwind Co", replacement: "W-2 #1 employer" },
        { text: "12-3456789", replacement: "[redacted ein]" },
        { text: "Contoso Bank", replacement: "1099-INT #1 payer" },
      ])
    );
  });
});

describe("redactSupportSnapshotEnvelope", () => {
  it("redacts nested envelope content without mutating the original payload", () => {
    const helpers = createHelpers();
    const snapshot = {
      primaryFiler: {
        firstName: "Alex",
        lastName: "Filer",
        ssn: "400-01-0001",
        dob: "1990-06-15",
      },
      w2s: [{ employerName: "Northwind Co", employerEin: "12-3456789" }],
    };
    const envelope = {
      summary: "Alex Filer uploaded Northwind Co with SSN 400-01-0001.",
      entries: [{ note: "DOB 1990-06-15 and EIN 12-3456789" }],
    };

    const redacted = helpers.redactSupportSnapshotEnvelope(envelope, snapshot);

    expect(redacted).toEqual({
      summary: "Primary filer uploaded W-2 #1 employer with SSN [redacted ssn].",
      entries: [{ note: "DOB [redacted dob] and EIN [redacted ein]" }],
    });
    expect(envelope.summary).toBe("Alex Filer uploaded Northwind Co with SSN 400-01-0001.");
  });
});
