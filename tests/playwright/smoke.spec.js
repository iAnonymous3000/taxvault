const fs = require("node:fs");
const path = require("node:path");

const { test, expect } = require("@playwright/test");

const ROOT = path.resolve(__dirname, "..", "..");
const WASM_BUNDLE_PATH = path.join(ROOT, "web", "pkg", "taxvault_wasm.js");
const TESTING_QUERY = "?taxvaultTesting=1";

const mockResult = {
  summary: {
    tax_year: 2025,
    filing_status: "Single",
    total_wages: "60000",
    total_taxable_interest: "125",
    total_tax_exempt_interest: "50",
    total_ordinary_dividends: "400",
    total_qualified_dividends: "250",
    total_social_security_benefits: "0",
    taxable_social_security_benefits: "0",
    total_income: "60525",
    traditional_ira_deduction: "1200",
    hsa_deduction: "800",
    student_loan_interest_deduction: "250",
    total_adjustments: "2250",
    adjusted_gross_income: "58275",
    standard_deduction: "15750",
    total_deductions: "15750",
    taxable_income: "42525",
    income_tax: "4681",
    child_dependent_credit: "0",
    additional_child_tax_credit: "0",
    total_w2_federal_withholding: "8000",
    total_social_security_withholding: "0",
    total_tax: "4681",
    total_federal_withholding: "8000",
    total_payments: "8000",
    balance_due: "0",
    overpayment: "3319",
  },
  meta: {
    rule_pack_version: "1.0.0",
    tax_table_verification_status: "machine_checked",
    tax_table_local_estimate_ready: true,
    tax_table_human_verified: false,
    estimate_scope: "Narrow supported-slice estimate",
    privacy:
      "Runs entirely in your browser. Drafts autosave in this tab by default, and device storage stays opt-in.",
    scope_limits: ["Estimate only."],
  },
  trace: "mock trace",
  form: {
    form_id: "1040",
    tax_year: 2025,
    lines: {
      "1a": { Currency: "60000" },
      "1z": { Currency: "60000" },
      "2a": { Currency: "50" },
      "2b": { Currency: "125" },
      "3a": { Currency: "250" },
      "3b": { Currency: "400" },
      "6a": { Currency: "0" },
      "6b": { Currency: "0" },
      "9": { Currency: "60525" },
      "10": { Currency: "2250" },
      "11b": { Currency: "58275" },
      "12d": { Checkbox: false },
      "12e": { Currency: "15750" },
      "14": { Currency: "15750" },
      "15": { Currency: "42525" },
      "16": { Currency: "4681" },
      "19": { Currency: "0" },
      "21": { Currency: "0" },
      "22": { Currency: "4681" },
      "24": { Currency: "4681" },
      "25a": { Currency: "8000" },
      "25b": { Currency: "0" },
      "25d": { Currency: "8000" },
      "28": { Currency: "0" },
      "33": { Currency: "8000" },
      "34": { Currency: "3319" },
      "37": { Currency: "0" },
    },
  },
};

const legacySnapshot = {
  version: 1,
  savedAt: "2026-04-05T12:00:00.000Z",
  filingStatus: "single",
  currentStep: 2,
  hadResults: false,
  primaryFiler: {
    firstName: "Alex",
    lastName: "Filer",
    ssn: "400-01-0001",
    dob: "1990-06-15",
    isBlind: false,
  },
  spouse: {
    firstName: "",
    lastName: "",
    ssn: "",
    dob: "",
    isBlind: false,
  },
  adjustments: {
    traditionalIraDeduction: "",
    hsaDeduction: "",
    studentLoanInterestPaid: "",
  },
  dependents: [],
  w2s: [
    {
      employerName: "Northwind Co",
      recipient: "primary",
      employerEin: "12-3456789",
      federalTaxWithheld: "8000",
      wages: "60000",
      stateTaxWithheld: "0",
      socialSecurityWages: "60000",
      socialSecurityTaxWithheld: "3720",
      medicareWages: "60000",
      medicareTaxWithheld: "870",
      advancedOpen: false,
    },
  ],
  socialSecurityIncome: [],
  interestIncome: [],
  dividendIncome: [],
};

const richImportEnvelope = {
  type: "taxvault-draft",
  version: 2,
  appVersion: "0.1.0",
  taxYear: 2025,
  piiRedacted: true,
  createdAt: "2026-04-05T12:00:00.000Z",
  updatedAt: "2026-04-05T12:05:00.000Z",
  draft: {
    savedAt: "2026-04-05T12:05:00.000Z",
    filingStatus: "single",
    currentStep: 2,
    hadResults: false,
    primaryFiler: {
      firstName: "Jordan",
      lastName: "Importer",
      ssn: "",
      dob: "1990-06-15",
      isBlind: false,
    },
    spouse: {
      firstName: "",
      lastName: "",
      ssn: "",
      dob: "",
      isBlind: false,
    },
    adjustments: {
      traditionalIraDeduction: "",
      hsaDeduction: "",
      studentLoanInterestPaid: "",
    },
    dependents: [
      {
        firstName: "Mia",
        lastName: "Importer",
        ssn: "",
        dob: "2018-04-11",
        relationship: "daughter",
        monthsLivedInHome: "12",
      },
    ],
    w2s: [
      {
        employerName: "Imported W2 Corp",
        recipient: "primary",
        employerEin: "",
        federalTaxWithheld: "4500",
        wages: "40000",
        stateTaxWithheld: "0",
        socialSecurityWages: "40000",
        socialSecurityTaxWithheld: "2480",
        medicareWages: "40000",
        medicareTaxWithheld: "580",
        advancedOpen: false,
      },
    ],
    socialSecurityIncome: [
      {
        recipient: "primary",
        totalBenefits: "12000",
        voluntaryWithholding: "600",
      },
    ],
    interestIncome: [
      {
        payerName: "Imported Credit Union",
        recipient: "primary",
        taxableInterest: "125",
        taxExemptInterest: "50",
      },
    ],
    dividendIncome: [
      {
        payerName: "Imported Brokerage",
        recipient: "primary",
        ordinaryDividends: "300",
        qualifiedDividends: "150",
      },
    ],
  },
};

test.beforeAll(() => {
  if (!fs.existsSync(WASM_BUNDLE_PATH)) {
    throw new Error("web/pkg is missing. Rebuild the WASM bundle before running browser smoke tests.");
  }
});

test("testing hooks stay hidden unless explicitly enabled on loopback", async ({ page }) => {
  await waitForAppToLoad(page, { enableTestingHooks: false });
  expect(
    await page.evaluate(() => Object.prototype.hasOwnProperty.call(window, "__taxvaultTesting"))
  ).toBe(false);

  await waitForAppToLoad(page, { enableTestingHooks: true });
  expect(await page.evaluate(() => Boolean(window.__taxvaultTesting))).toBe(true);
});

async function waitForAppToLoad(page, { enableTestingHooks = true } = {}) {
  await page.goto(enableTestingHooks ? `/index.html${TESTING_QUERY}` : "/index.html");
  await expect(page.locator("#loading")).toHaveClass(/hidden/);
}

async function openApp(page, options) {
  await waitForAppToLoad(page, options);
  await page.locator("#gateAcknowledge").check();
  await expect(page.locator("#gateContinueBtn")).toBeEnabled();
  await page.locator("#gateContinueBtn").click();
  await expect(page.locator("#app")).not.toHaveClass(/hidden/);
}

async function fillStep1Single(page) {
  await page.locator("#pFirst").fill("Alex");
  await page.locator("#pLast").fill("Filer");
  await page.locator("#pSsn").fill("400-01-0001");
  await page.locator("#pDob").fill("1990-06-15");
  await page.locator("#step1ContinueBtn").click();
  await expect(page.locator("#step2")).toHaveClass(/active/);
}

async function addSupportedW2(page, wages = "60000") {
  const w2Card = page.locator("#w2Container > .w2-card").first();
  await page.locator("#addW2Btn").click();
  await page.locator("#w2-1-employer").fill("Northwind Co");
  await page.locator("#w2-1-ein").fill("12-3456789");
  await page.locator("#w2-1-wages").fill(wages);
  await page.locator("#w2-1-fed-wh").fill("8000");
  await page.locator("#w2-1-state-wh").fill("0");
  await w2Card.locator(".w2-advanced-toggle").click();
  await expect(page.locator("#w2-1-ss-wages")).toBeVisible();
  await page.locator("#w2-1-ss-wages").fill(wages);
  await page.locator("#w2-1-ss-wh").fill("3720");
  await page.locator("#w2-1-med-wages").fill(wages);
  await page.locator("#w2-1-med-wh").fill("870");
}

async function waitForReadyReview(page) {
  await expect(page.locator("#supportReviewBadge")).toHaveText("Ready");
  await expect(page.locator("#computeBtn")).toBeEnabled();
}

async function renderMockResult(page) {
  const rendered = await page.evaluate((result) => {
    if (!window.__taxvaultTesting) {
      return false;
    }

    window.__taxvaultTesting.renderResults(result);
    window.__taxvaultTesting.goToStep(3);
    return true;
  }, mockResult);

  expect(rendered).toBe(true);
  await expect(page.locator("#step3")).toHaveClass(/active/);
}

test("supported return becomes ready when the tax table allows local estimates", async ({ page }) => {
  await openApp(page);
  await fillStep1Single(page);
  await addSupportedW2(page);

  await waitForReadyReview(page);
  await expect(page.locator("#supportReviewSummary")).toContainText(
    "machine-checked for local/private estimate use"
  );
  const cautions = await page.locator("#supportReviewCautions li").allTextContents();
  expect(cautions.some((item) => item.includes("machine-checked"))).toBe(true);
});

test("landing page surfaces the public GitHub repo and privacy controls", async ({ page }) => {
  await openApp(page);

  const githubLink = page.getByRole("link", { name: "Open source on GitHub" });
  await expect(githubLink).toBeVisible();
  await expect(githubLink).toHaveAttribute("href", "https://github.com/iAnonymous3000/taxvault");
  await expect(page.locator("#trustTitle")).toContainText("privacy and security");
  await expect(page.getByText("Security headers in place")).toBeVisible();
  await expect(page.getByText("Open source and auditable")).toBeVisible();
});

test("estimate year selector reflects the embedded runtime config", async ({ page }) => {
  await openApp(page);

  await expect(page.locator("#taxYearSelect")).toHaveValue("2025");
  await expect(page.locator("#taxYearSelect")).toBeDisabled();

  const runtimeConfig = await page.evaluate(() => {
    if (!window.__taxvaultTesting) {
      return null;
    }

    return window.__taxvaultTesting.getRuntimeConfig();
  });
  expect(runtimeConfig).not.toBeNull();
  expect(runtimeConfig.selectedTaxYear).toBe(2025);
  expect(runtimeConfig.supportedTaxYears).toHaveLength(1);
  expect(runtimeConfig.supportedTaxYears[0].taxYear).toBe(2025);
  expect(runtimeConfig.supportedTaxYears[0].available).toBe(true);
});

test("step indicator marks the active step with aria-current=step", async ({ page }) => {
  await openApp(page);

  await expect(page.locator("#lbl1")).toHaveAttribute("aria-current", "step");

  await fillStep1Single(page);

  expect(await page.locator("#lbl1").getAttribute("aria-current")).toBeNull();
  await expect(page.locator("#lbl2")).toHaveAttribute("aria-current", "step");
});

test("unsupported return shows a blocking issue before compute", async ({ page }) => {
  await openApp(page);
  await fillStep1Single(page);

  const w2Card = page.locator("#w2Container > .w2-card").first();
  await page.locator("#addW2Btn").click();
  await page.locator("#w2-1-employer").fill("Northwind Co");
  await page.locator("#w2-1-ein").fill("12-3456789");
  await page.locator("#w2-1-wages").fill("210000");
  await page.locator("#w2-1-fed-wh").fill("42000");
  await page.locator("#w2-1-state-wh").fill("0");
  await w2Card.locator(".w2-advanced-toggle").click();
  await expect(page.locator("#w2-1-ss-wages")).toBeVisible();
  await page.locator("#w2-1-ss-wages").fill("176100");
  await page.locator("#w2-1-ss-wh").fill("10918.2");
  await page.locator("#w2-1-med-wages").fill("210000");
  await page.locator("#w2-1-med-wh").fill("3045");

  await expect(page.locator("#supportReviewBadge")).toHaveText("Unsupported");
  const issues = await page.locator("#supportReviewIssues li").allTextContents();
  expect(issues.some((item) => item.includes("Additional Medicare Tax"))).toBe(true);
  await expect(page.locator("#computeBtn")).toBeDisabled();
});

test("Head of Household parent case surfaces manual review caution", async ({ page }) => {
  await openApp(page);
  await page.locator('.status-option[data-status="head_of_household"]').click();
  await page.locator("#pFirst").fill("Alex");
  await page.locator("#pLast").fill("Filer");
  await page.locator("#pSsn").fill("400-01-0001");
  await page.locator("#pDob").fill("1990-06-15");
  await page.locator("#dep-1-first").fill("Pat");
  await page.locator("#dep-1-last").fill("Filer");
  await page.locator("#dep-1-ssn").fill("400-02-0002");
  await page.locator("#dep-1-dob").fill("1950-06-15");
  await page.locator("#dep-1-relationship").selectOption("parent");
  await page.locator("#dep-1-months").fill("12");
  await page.locator("#step1ContinueBtn").click();
  await expect(page.locator("#step2")).toHaveClass(/active/);

  await addSupportedW2(page);
  await waitForReadyReview(page);

  const cautions = await page.locator("#supportReviewCautions li").allTextContents();
  expect(cautions.some((item) => item.includes("Head of Household is still a manual determination"))).toBe(
    true
  );
  expect(cautions.some((item) => item.includes("does not automatically establish Head of Household"))).toBe(
    true
  );
  expect(cautions.some((item) => item.includes("machine-checked"))).toBe(true);
});

test("draft 1040 preview renders printable mock results", async ({ page }) => {
  await openApp(page);
  await fillStep1Single(page);
  await renderMockResult(page);

  await expect(page.locator("#printDraftBtn")).toBeEnabled();
  await expect(page.locator(".draft-form-title")).toHaveText("U.S. Individual Income Tax Return");
  const summaryValues = await page.locator("#draftSummaryGrid .draft-summary-value").allTextContents();
  expect(summaryValues.some((item) => item.includes("Alex Filer"))).toBe(true);
  await expect(page.locator("#draftSections")).toContainText("Line 1a");
  await expect(page.locator("#draftSections")).toContainText("Wages, salaries, tips");
  await expect(page.locator("#draftSections")).toContainText("Estimated refund");
});

test("audit trail export captures sanitized input, review status, and computed output", async ({ page }) => {
  await openApp(page);
  await fillStep1Single(page);
  await addSupportedW2(page);

  await waitForReadyReview(page);
  await page.locator("#computeBtn").click();
  await expect(page.locator("#step3")).toHaveClass(/active/);
  await expect(page.locator("#exportAuditBtn")).toBeEnabled();

  const auditTrail = await page.evaluate(() => {
    if (!window.__taxvaultTesting) {
      return null;
    }

    return window.__taxvaultTesting.exportCurrentAuditTrail();
  });
  expect(auditTrail).not.toBeNull();
  expect(auditTrail.type).toBe("taxvault-audit-trail");
  expect(auditTrail.version).toBe(1);
  expect(auditTrail.taxYear).toBe(2025);
  expect(auditTrail.draftEnvelope.type).toBe("taxvault-draft");
  expect(auditTrail.draftEnvelope.piiRedacted).toBe(true);
  expect(auditTrail.supportReview.status).toBe("ready");
  expect(auditTrail.supportReview.readyForEstimate).toBe(true);
  expect(auditTrail.estimate.form.formId).toBe("1040");
  expect(auditTrail.estimate.form.taxYear).toBe(2025);
  expect(auditTrail.estimate.form.lines["1a"]).toBeDefined();
  expect(
    auditTrail.estimate.breakdown.some(
      (row) => row.label === "Total Wages" && row.formattedValue === "$60,000.00"
    )
  ).toBe(true);
  expect(auditTrail.estimate.trace.length).toBeGreaterThan(0);

  const auditRaw = JSON.stringify(auditTrail);
  expect(auditRaw).not.toContain("400-01-0001");
  expect(auditRaw).not.toContain("12-3456789");
});

test("support snapshot export redacts names, birth dates, and issuer identities", async ({ page }) => {
  await openApp(page);
  await fillStep1Single(page);
  await addSupportedW2(page);
  await page.locator("#addInterestBtn").click();
  await page.locator("#int-1-payer").fill("Redwood Credit Union");
  await page.locator("#int-1-taxable").fill("125");
  await page.locator("#int-1-tax-exempt").fill("50");

  await waitForReadyReview(page);
  await page.locator("#computeBtn").click();
  await expect(page.locator("#step3")).toHaveClass(/active/);
  await expect(page.locator("#exportSupportSnapshotBtn")).toBeEnabled();

  const supportSnapshot = await page.evaluate(() => {
    if (!window.__taxvaultTesting) {
      return null;
    }

    return window.__taxvaultTesting.exportCurrentSupportSnapshot();
  });
  expect(supportSnapshot).not.toBeNull();
  expect(supportSnapshot.type).toBe("taxvault-support-snapshot");
  expect(supportSnapshot.version).toBe(1);
  expect(supportSnapshot.taxYear).toBe(2025);
  expect(supportSnapshot.suitableForSharing).toBe(true);
  expect(supportSnapshot.inputSnapshot.primaryFiler.firstName).toBe("");
  expect(supportSnapshot.inputSnapshot.primaryFiler.lastName).toBe("");
  expect(supportSnapshot.inputSnapshot.primaryFiler.dob).toBe("");
  expect(supportSnapshot.inputSnapshot.primaryFiler.ageOnTaxYearEnd).toBe(35);
  expect(supportSnapshot.inputSnapshot.w2s[0].employerName).toBe("");
  expect(supportSnapshot.inputSnapshot.interestIncome[0].payerName).toBe("");
  expect(supportSnapshot.estimate.form.formId).toBe("1040");

  const supportRaw = JSON.stringify(supportSnapshot);
  expect(supportRaw).not.toContain("Alex");
  expect(supportRaw).not.toContain("Filer");
  expect(supportRaw).not.toContain("1990-06-15");
  expect(supportRaw).not.toContain("Northwind Co");
  expect(supportRaw).not.toContain("Redwood Credit Union");
  expect(supportRaw).not.toContain("400-01-0001");
  expect(supportRaw).not.toContain("12-3456789");
});

test("review packet export renders a readable redacted HTML packet", async ({ page }) => {
  await openApp(page);
  await fillStep1Single(page);
  await addSupportedW2(page);

  await waitForReadyReview(page);
  await page.locator("#computeBtn").click();
  await expect(page.locator("#step3")).toHaveClass(/active/);
  await expect(page.locator("#exportReviewPacketBtn")).toBeEnabled();

  const reviewPacketHtml = await page.evaluate(() => {
    if (!window.__taxvaultTesting) {
      return null;
    }

    return window.__taxvaultTesting.exportCurrentReviewPacketHtml();
  });
  expect(reviewPacketHtml).not.toBeNull();
  expect(reviewPacketHtml).toContain("TaxVault Review Packet");
  expect(reviewPacketHtml).toContain("Estimated Federal Refund");
  expect(reviewPacketHtml).toContain("Alex Filer");
  expect(reviewPacketHtml).toContain("Northwind Co");
  expect(reviewPacketHtml).toContain("Calculation Trace");
  expect(reviewPacketHtml).toContain("Draft Form 1040 Lines");
  expect(reviewPacketHtml).not.toContain("400-01-0001");
  expect(reviewPacketHtml).not.toContain("12-3456789");
});

test("draft export and import round-trip through the versioned envelope", async ({ page }) => {
  await openApp(page);
  await fillStep1Single(page);
  await addSupportedW2(page);

  await expect(page.locator("#exportDraftBtn")).toHaveCount(1);
  const exportedDraft = await page.evaluate(() => {
    if (!window.__taxvaultTesting) {
      return null;
    }

    return window.__taxvaultTesting.exportCurrentDraftEnvelope();
  });
  expect(exportedDraft).not.toBeNull();
  const exportedRaw = JSON.stringify(exportedDraft);
  expect(exportedDraft.type).toBe("taxvault-draft");
  expect(exportedDraft.version).toBe(2);
  expect(exportedDraft.taxYear).toBe(2025);
  expect(exportedDraft.piiRedacted).toBe(true);
  expect(exportedDraft.draft.primaryFiler.firstName).toBe("Alex");
  expect(exportedRaw).not.toContain("400-01-0001");
  expect(exportedRaw).not.toContain("12-3456789");

  await page.evaluate(() => {
    window.localStorage.clear();
    window.sessionStorage.clear();
  });
  await page.reload();
  await expect(page.locator("#loading")).toHaveClass(/hidden/);

  await page.locator("#gateAcknowledge").check();
  await expect(page.locator("#gateContinueBtn")).toBeEnabled();
  await page.locator("#gateContinueBtn").click();
  await expect(page.locator("#app")).not.toHaveClass(/hidden/);

  await page.locator("#importDraftInput").setInputFiles({
    name: "taxvault-export.json",
    mimeType: "application/json",
    buffer: Buffer.from(exportedRaw),
  });

  await expect(page.locator("#pFirst")).toHaveValue("Alex");
  await expect(page.locator("#pSsn")).toHaveValue("");
  await expect(page.locator("#w2-1-employer")).toHaveValue("Northwind Co");
  await expect(page.locator("#w2-1-ein")).toHaveValue("");
  await expect(page.locator("#storageStatus")).toContainText("Draft imported.");

  const storedSnapshot = await page.evaluate(() => window.sessionStorage.getItem("taxvault:draft:session:2025"));
  expect(storedSnapshot).not.toBeNull();
  const storedDraft = JSON.parse(storedSnapshot);
  expect(storedDraft.type).toBe("taxvault-draft");
  expect(storedDraft.version).toBe(2);
  expect(storedDraft.taxYear).toBe(2025);
});

test("draft import replaces existing cards instead of duplicating them", async ({ page }) => {
  await openApp(page);
  await page.locator("#pFirst").fill("Alex");
  await page.locator("#pLast").fill("Filer");
  await page.locator("#pSsn").fill("400-01-0001");
  await page.locator("#pDob").fill("1990-06-15");
  await page.locator("#addDependentBtn").click();
  await page.locator("#dep-1-first").fill("Casey");
  await page.locator("#dep-1-last").fill("Filer");
  await page.locator("#dep-1-ssn").fill("400-02-0002");
  await page.locator("#dep-1-dob").fill("2017-05-20");
  await page.locator("#dep-1-relationship").selectOption("daughter");
  await page.locator("#dep-1-months").fill("12");
  await page.locator("#step1ContinueBtn").click();
  await expect(page.locator("#step2")).toHaveClass(/active/);

  await addSupportedW2(page, "61000");
  await page.locator("#addSocialSecurityBtn").click();
  await page.locator("#ssa-1-benefits").fill("18000");
  await page.locator("#ssa-1-withholding").fill("500");
  await page.locator("#addInterestBtn").click();
  await page.locator("#int-1-payer").fill("Existing Bank");
  await page.locator("#int-1-taxable").fill("25");
  await page.locator("#addDividendBtn").click();
  await page.locator("#div-1-payer").fill("Existing Brokerage");
  await page.locator("#div-1-ordinary").fill("40");
  await page.locator("#div-1-qualified").fill("20");

  const imported = await page.evaluate((envelope) => {
    if (!window.__taxvaultTesting) {
      return false;
    }

    return window.__taxvaultTesting.importDraftValue(envelope).ok;
  }, richImportEnvelope);
  expect(imported).toBe(true);

  await expect(page.locator("#dependentContainer > .dependent-card")).toHaveCount(1);
  await expect(page.locator("#w2Container > .w2-card")).toHaveCount(1);
  await expect(page.locator("#socialSecurityContainer > .ssa-card")).toHaveCount(1);
  await expect(page.locator("#interestContainer > .interest-card")).toHaveCount(1);
  await expect(page.locator("#dividendContainer > .dividend-card")).toHaveCount(1);
  await expect(page.locator("#pFirst")).toHaveValue("Jordan");
  await expect(page.locator("#dep-1-first")).toHaveValue("Mia");
  await expect(page.locator("#w2-1-employer")).toHaveValue("Imported W2 Corp");
  await expect(page.locator("#ssa-1-benefits")).toHaveValue("12000");
  await expect(page.locator("#int-1-payer")).toHaveValue("Imported Credit Union");
  await expect(page.locator("#div-1-payer")).toHaveValue("Imported Brokerage");
});

test("legacy saved draft restores without SSNs or EINs", async ({ page }) => {
  await waitForAppToLoad(page);
  await page.evaluate((snapshot) => {
    window.localStorage.clear();
    window.sessionStorage.clear();
    window.localStorage.setItem("taxvault:draft:remember:2025", "true");
    window.localStorage.setItem("taxvault:draft:local:2025", JSON.stringify(snapshot));
  }, legacySnapshot);

  await page.reload();
  await expect(page.locator("#loading")).toHaveClass(/hidden/);
  await expect(page.locator("#pFirst")).toHaveValue("Alex");
  await expect(page.locator("#pSsn")).toHaveValue("");
  await expect(page.locator("#w2-1-ein")).toHaveValue("");
  await expect(page.locator("#w2-1-employer")).toHaveValue("Northwind Co");
  await expect(page.locator("#storageStatus")).toContainText("must be re-entered");

  const storedSnapshot = await page.evaluate(() => window.localStorage.getItem("taxvault:draft:local:2025"));
  expect(storedSnapshot).not.toBeNull();
  const storedDraft = JSON.parse(storedSnapshot);
  expect(storedDraft.type).toBe("taxvault-draft");
  expect(storedDraft.version).toBe(2);
  expect(storedDraft.taxYear).toBe(2025);
  expect(storedSnapshot).not.toContain("400-01-0001");
  expect(storedSnapshot).not.toContain("12-3456789");
  expect(storedSnapshot).toContain("Northwind Co");
});
