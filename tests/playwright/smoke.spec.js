const fs = require("node:fs");
const path = require("node:path");

const { test, expect } = require("@playwright/test");

const ROOT = path.resolve(__dirname, "..", "..");
const WASM_BUNDLE_PATH = path.join(ROOT, "web", "pkg", "taxvault_wasm.js");

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
    privacy: "Runs entirely in your browser.",
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

test.beforeAll(() => {
  if (!fs.existsSync(WASM_BUNDLE_PATH)) {
    throw new Error("web/pkg is missing. Rebuild the WASM bundle before running browser smoke tests.");
  }
});

async function waitForAppToLoad(page) {
  await page.goto("/index.html");
  await expect(page.locator("#loading")).toHaveClass(/hidden/);
}

async function openApp(page) {
  await waitForAppToLoad(page);
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
  expect(storedSnapshot).not.toContain("400-01-0001");
  expect(storedSnapshot).not.toContain("12-3456789");
  expect(storedSnapshot).toContain("Northwind Co");
});
