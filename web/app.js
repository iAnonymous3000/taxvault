import init, { compute_tax, get_app_config, review_tax_input } from "./pkg/taxvault_wasm.js";

const SSN_PATTERN = /^\d{3}-\d{2}-\d{4}$/;
const EIN_PATTERN = /^\d{2}-\d{7}$/;
const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
const DATE_INPUT_MIN = "1900-01-01";
const currencyFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
const draftTimestampFormatter = new Intl.DateTimeFormat("en-US", {
  dateStyle: "long",
  timeStyle: "short",
});
const isoDateFormatter = new Intl.DateTimeFormat("en-CA", {
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});
const SUPPORT_REVIEW_DEFAULT_SUMMARY =
  "Start with the forms you actually have. TaxVault will tell you whether this draft fits the supported estimate scope.";
const APP_VERSION = "0.1.0";
const DEFAULT_TAX_YEAR = 2025;
const LEGACY_DRAFT_STORAGE_VERSION = 1;
const DRAFT_ENVELOPE_VERSION = 2;
const DRAFT_FILE_TYPE = "taxvault-draft";
const AUDIT_TRAIL_VERSION = 1;
const AUDIT_TRAIL_FILE_TYPE = "taxvault-audit-trail";
const SUPPORT_SNAPSHOT_VERSION = 1;
const SUPPORT_SNAPSHOT_FILE_TYPE = "taxvault-support-snapshot";
const TESTING_HOOKS_QUERY_PARAM = "taxvaultTesting";
const TAXVAULT_STORAGE_KEY_PREFIX = "taxvault:";
const ACTIVE_TAX_YEAR_STORAGE_KEY = "taxvault:active-tax-year";
const MAX_W2_FORMS = 25;
const MAX_INTEREST_FORMS = 25;
const MAX_SOCIAL_SECURITY_FORMS = 10;
const MAX_DIVIDEND_FORMS = 25;
const MAX_DEPENDENTS = 15;
const MAX_TEXT_FIELD_LENGTH = 200;
const DOWNLOAD_BLOB_URL_REVOKE_DELAY_MS = 2000;
const MAX_DRAFT_IMPORT_FILE_SIZE = 5 * 1024 * 1024; // 5 MB per file
const MAX_REFERENCE_FILE_SIZE = 50 * 1024 * 1024; // 50 MB per file
const DEPENDENT_RELATIONSHIP_OPTIONS = [
  { value: "", label: "Select relationship" },
  { value: "son", label: "Son" },
  { value: "daughter", label: "Daughter" },
  { value: "stepchild", label: "Stepchild" },
  { value: "foster_child", label: "Foster child" },
  { value: "sibling", label: "Sibling" },
  { value: "step_sibling", label: "Step-sibling" },
  { value: "half_sibling", label: "Half-sibling" },
  { value: "grandchild", label: "Grandchild" },
  { value: "niece", label: "Niece" },
  { value: "nephew", label: "Nephew" },
  { value: "parent", label: "Parent" },
  { value: "grandparent", label: "Grandparent" },
  { value: "other", label: "Other" },
];
const FILING_STATUS_LABELS = {
  single: "Single",
  married_filing_jointly: "Married Filing Jointly",
  head_of_household: "Head of Household",
};
const FILING_STATUS_KEYS = new Set(Object.keys(FILING_STATUS_LABELS));
const ALLOWED_INCOME_RECIPIENTS = new Set(["primary", "spouse"]);
const ALLOWED_DEPENDENT_RELATIONSHIPS = new Set(
  DEPENDENT_RELATIONSHIP_OPTIONS.map((opt) => opt.value).filter(Boolean)
);
const SUPPORTED_HOH_QUALIFYING_RELATIONSHIPS = new Set([
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
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const DRAFT_1040_SECTIONS = [
  {
    title: "Income",
    subtitle: "Core 1040 income lines compiled from the forms TaxVault currently supports.",
    rows: [
      { line: "1a", label: "Wages, salaries, tips" },
      { line: "1z", label: "Total wages" },
      { line: "2a", label: "Tax-exempt interest" },
      { line: "2b", label: "Taxable interest" },
      { line: "3a", label: "Qualified dividends" },
      { line: "3b", label: "Ordinary dividends" },
      { line: "6a", label: "Social Security benefits" },
      { line: "6b", label: "Taxable Social Security benefits" },
      { line: "9", label: "Total income", emphasis: true },
      { line: "10", label: "Adjustments to income" },
      { line: "11b", label: "Adjusted gross income", emphasis: true },
    ],
  },
  {
    title: "Deductions & Tax",
    subtitle: "How the supported deductions and credits flow into total tax.",
    rows: [
      { line: "12d", label: "Additional age 65+ or blind checkbox" },
      { line: "12e", label: "Standard deduction" },
      { line: "14", label: "Total deductions" },
      { line: "15", label: "Taxable income", emphasis: true },
      { line: "16", label: "Tax" },
      { line: "19", label: "Child/dependent credit" },
      { line: "21", label: "Credits from Schedule 3 equivalent" },
      { line: "22", label: "Tax after credits" },
      { line: "24", label: "Total tax", emphasis: true },
    ],
  },
  {
    title: "Payments & Result",
    subtitle: "Withholding, refundable credits, and the resulting refund or balance due.",
    rows: [
      { line: "25a", label: "W-2 federal income tax withheld" },
      { line: "25b", label: "SSA-1099 withholding" },
      { line: "25d", label: "Total federal income tax withheld" },
      { line: "26", label: "Estimated tax payments" },
      { line: "28", label: "Additional child tax credit" },
      { line: "33", label: "Total payments", emphasis: true },
      { line: "34", label: "Estimated refund", emphasis: true },
      { line: "37", label: "Estimated amount you owe", emphasis: true },
    ],
  },
];
let supportReviewTimer = 0;
let draftSaveTimer = 0;
let draftRestoreInProgress = false;
let lastGateFocusedElement = null;
const storageRefCache = {
  local: undefined,
  session: undefined,
};

const state = {
  safetyAcknowledged: false,
  wasmReady: false,
  supportReviewReadyForEstimate: false,
  currentStep: 1,
  w2Count: 0,
  socialSecurityCount: 0,
  interestCount: 0,
  dividendCount: 0,
  dependentCount: 0,
  defaultTaxYear: DEFAULT_TAX_YEAR,
  selectedTaxYear: DEFAULT_TAX_YEAR,
  supportedTaxYears: [],
  filingStatus: "single",
  draftEnvelopeCreatedAt: null,
  lastDraftSavedAt: null,
  lastSupportReview: null,
  lastComputedResult: null,
  lastComputedDraftEnvelope: null,
  lastComputedSupportReview: null,
};

const els = {
  disclaimerGate: document.getElementById("disclaimerGate"),
  gateAcknowledge: document.getElementById("gateAcknowledge"),
  gateContinueBtn: document.getElementById("gateContinueBtn"),
  filingStatusOptions: document.getElementById("filingStatusOptions"),
  loading: document.getElementById("loading"),
  mainContent: document.getElementById("mainContent"),
  app: document.getElementById("app"),
  error: document.getElementById("error"),
  taxYearSelect: document.getElementById("taxYearSelect"),
  taxYearHint: document.getElementById("taxYearHint"),
  spouseCard: document.getElementById("spouseCard"),
  pDependent: document.getElementById("pDependent"),
  sDependent: document.getElementById("sDependent"),
  dependentSection: document.getElementById("dependentSection"),
  dependentSubtitle: document.getElementById("dependentSubtitle"),
  dependentContainer: document.getElementById("dependentContainer"),
  addDependentBtn: document.getElementById("addDependentBtn"),
  clearAllBtn: document.getElementById("clearAllBtn"),
  exportDraftBtn: document.getElementById("exportDraftBtn"),
  importDraftBtn: document.getElementById("importDraftBtn"),
  importDraftInput: document.getElementById("importDraftInput"),
  rememberDraftToggle: document.getElementById("rememberDraftToggle"),
  storageStatus: document.getElementById("storageStatus"),
  storageStatusText: document.getElementById("storageStatusText"),
  storageStatusTimestamp: document.getElementById("storageStatusTimestamp"),
  storageTrustCopy: document.getElementById("storageTrustCopy"),
  uiStatus: document.getElementById("uiStatus"),
  incomeSummaryChips: document.getElementById("incomeSummaryChips"),
  w2Container: document.getElementById("w2Container"),
  addW2Btn: document.getElementById("addW2Btn"),
  socialSecurityContainer: document.getElementById("socialSecurityContainer"),
  addSocialSecurityBtn: document.getElementById("addSocialSecurityBtn"),
  interestContainer: document.getElementById("interestContainer"),
  addInterestBtn: document.getElementById("addInterestBtn"),
  dividendContainer: document.getElementById("dividendContainer"),
  addDividendBtn: document.getElementById("addDividendBtn"),
  traditionalIraDeduction: document.getElementById("traditionalIraDeduction"),
  hsaDeduction: document.getElementById("hsaDeduction"),
  studentLoanInterestPaid: document.getElementById("studentLoanInterestPaid"),
  studentLoanQualifiedLoan: document.getElementById("studentLoanQualifiedLoan"),
  studentLoanLegallyObligated: document.getElementById("studentLoanLegallyObligated"),
  estimatedTaxPayments: document.getElementById("estimatedTaxPayments"),
  computeBtn: document.getElementById("computeBtn"),
  computeHelp: document.getElementById("computeHelp"),
  supportReviewCard: document.getElementById("supportReviewCard"),
  supportReviewBadge: document.getElementById("supportReviewBadge"),
  supportReviewSummary: document.getElementById("supportReviewSummary"),
  supportReviewIssuesSection: document.getElementById("supportReviewIssuesSection"),
  supportReviewIssues: document.getElementById("supportReviewIssues"),
  supportReviewCautionsSection: document.getElementById("supportReviewCautionsSection"),
  supportReviewCautions: document.getElementById("supportReviewCautions"),
  exportReviewPacketBtn: document.getElementById("exportReviewPacketBtn"),
  exportSupportSnapshotBtn: document.getElementById("exportSupportSnapshotBtn"),
  printDraftBtn: document.getElementById("printDraftBtn"),
  exportAuditBtn: document.getElementById("exportAuditBtn"),
  draftSummaryGrid: document.getElementById("draftSummaryGrid"),
  draftSections: document.getElementById("draftSections"),
  linesToggle: document.getElementById("linesToggle"),
  linesArrow: document.getElementById("linesArrow"),
  linesContainer: document.getElementById("linesContainer"),
  traceToggle: document.getElementById("traceToggle"),
  traceArrow: document.getElementById("traceArrow"),
  traceContainer: document.getElementById("traceContainer"),
  resultHero: document.getElementById("resultHero"),
  resultMeta: document.getElementById("resultMeta"),
  scopeList: document.getElementById("scopeList"),
  breakdownContent: document.getElementById("breakdownContent"),
};

bindStaticEvents();
start();

async function start() {
  try {
    await init();
    applyRuntimeConfig(loadRuntimeConfig());
    state.wasmReady = true;
    restoreDraftPreference();
    restoreDraftSnapshot();
    els.loading.classList.add("hidden");
    syncComputeButtonState();
    showDisclaimerGate();
  } catch (error) {
    renderLoadingError(
      `Failed to load the tax engine. Refresh the page and try again.\n\n${safeMessage(error)}`
    );
  }
}

function bindStaticEvents() {
  document.querySelectorAll(".status-option").forEach((button) => {
    button.addEventListener("click", () => selectStatus(button.dataset.status));
  });
  els.filingStatusOptions?.addEventListener("keydown", handleStatusOptionKeydown);

  document.getElementById("step1ContinueBtn").addEventListener("click", () => goToStep(2));
  document.getElementById("step2BackBtn").addEventListener("click", () => goToStep(1));
  document.getElementById("editReturnBtn").addEventListener("click", () => goToStep(1));
  els.taxYearSelect?.addEventListener("change", handleTaxYearSelectionChange);
  els.gateAcknowledge.addEventListener("change", updateGateButtonState);
  els.gateContinueBtn.addEventListener("click", acknowledgeSafetyGate);
  els.addW2Btn.addEventListener("click", addW2);
  els.addSocialSecurityBtn.addEventListener("click", addSocialSecurity);
  els.addInterestBtn.addEventListener("click", addInterest);
  els.addDividendBtn.addEventListener("click", addDividend);
  els.addDependentBtn.addEventListener("click", addDependent);
  els.clearAllBtn.addEventListener("click", clearAllData);
  els.exportDraftBtn?.addEventListener("click", exportDraftToFile);
  els.importDraftBtn?.addEventListener("click", openDraftImportPicker);
  els.importDraftInput?.addEventListener("change", handleImportDraftFileSelection);
  els.rememberDraftToggle.addEventListener("change", handleRememberDraftToggle);
  els.computeBtn.addEventListener("click", computeReturn);
  els.exportReviewPacketBtn?.addEventListener("click", exportReviewPacketToFile);
  els.exportSupportSnapshotBtn?.addEventListener("click", exportSupportSnapshotToFile);
  els.printDraftBtn.addEventListener("click", printDraftReturn);
  els.exportAuditBtn?.addEventListener("click", exportAuditTrailToFile);
  els.linesToggle.addEventListener("click", toggleLines);
  els.traceToggle.addEventListener("click", toggleTrace);
  els.app.addEventListener("input", handleAppFieldMutation);
  els.app.addEventListener("change", handleAppFieldMutation);
  els.app.addEventListener("focusout", handleAppFieldBlur);
  document.addEventListener("keydown", handleDocumentKeydown);

  bindSsnFields(document);
  bindMoneyFields(document);
  applyDateConstraints(document);
  updateDependentSubtitle(false);
  resetSupportReview();
  resetDraftPreview();
  syncResultExportButtons();
  refreshStorageStatus();
  renderIncomeSummaryChips();
  syncComputeButtonState();
}

function announceUiStatus(message) {
  if (!els.uiStatus || draftRestoreInProgress) {
    return;
  }

  els.uiStatus.textContent = "";
  window.setTimeout(() => {
    els.uiStatus.textContent = message;
  }, 0);
}

function focusElement(target) {
  if (!(target instanceof HTMLElement) || draftRestoreInProgress) {
    return;
  }

  window.requestAnimationFrame(() => {
    target.focus();
  });
}

function focusFirstField(root, selector) {
  if (!(root instanceof HTMLElement)) {
    return;
  }

  const target = root.querySelector(selector);
  focusElement(target);
}

function nextFocusTargetAfterRemoval(card, fallback) {
  return (
    card.nextElementSibling?.querySelector("input, select, button") ||
    card.previousElementSibling?.querySelector("input, select, button") ||
    fallback
  );
}

function getFocusableElements(root) {
  if (!(root instanceof HTMLElement)) {
    return [];
  }

  return Array.from(root.querySelectorAll(FOCUSABLE_SELECTOR)).filter(
    (element) =>
      element instanceof HTMLElement &&
      !element.hasAttribute("disabled") &&
      !element.closest(".hidden") &&
      element.offsetParent !== null
  );
}

function handleDocumentKeydown(event) {
  if (!els.disclaimerGate.classList.contains("hidden")) {
    if (event.key === "Tab") {
      trapGateFocus(event);
      return;
    }

    if (event.key === "Escape") {
      event.preventDefault();
      announceUiStatus("Review and acknowledge the estimate warning before continuing.");
      focusElement(els.gateAcknowledge);
    }

    return;
  }

  if (isComputeShortcut(event)) {
    event.preventDefault();
    triggerComputeShortcut();
  }
}

function isComputeShortcut(event) {
  if (event.defaultPrevented || event.isComposing) {
    return false;
  }

  if (state.currentStep !== 2 || event.key !== "Enter") {
    return false;
  }

  if (!(event.ctrlKey || event.metaKey) || event.altKey || event.shiftKey) {
    return false;
  }

  const target = event.target instanceof Node ? event.target : document.activeElement;
  return target === document.body || els.app.contains(target);
}

function triggerComputeShortcut() {
  if (!els.computeBtn) {
    return;
  }

  if (els.computeBtn.disabled) {
    announceUiStatus(els.computeHelp?.textContent || "TaxVault is not ready to calculate this draft yet.");
    return;
  }

  computeReturn();
}

function trapGateFocus(event) {
  const focusable = getFocusableElements(els.disclaimerGate);
  if (focusable.length === 0) {
    return;
  }

  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  const active = document.activeElement;

  if (event.shiftKey) {
    if (active === first || !els.disclaimerGate.contains(active)) {
      event.preventDefault();
      last.focus();
    }
    return;
  }

  if (active === last || !els.disclaimerGate.contains(active)) {
    event.preventDefault();
    first.focus();
  }
}

function bindMoneyFields(root) {
  root.querySelectorAll(".money-input").forEach((input) => {
    if (input.dataset.moneyBound === "true") {
      return;
    }

    input.addEventListener("blur", () => {
      normalizeMoneyField(input);
    });

    input.addEventListener("paste", () => {
      window.setTimeout(() => {
        normalizeMoneyField(input);
      }, 0);
    });

    input.dataset.moneyBound = "true";
  });
}

function normalizeMoneyField(input) {
  const normalized = normalizeMoneyValue(input.value);
  const isValid = input.value.trim() === "" || normalized !== null;

  input.setAttribute("aria-invalid", String(!isValid));

  if (normalized !== null) {
    input.value = normalized;
  }
}

function currentTaxYear() {
  return Number.isInteger(state.selectedTaxYear) ? state.selectedTaxYear : state.defaultTaxYear;
}

function supportedTaxYearEntries() {
  return state.supportedTaxYears;
}

function isSupportedTaxYear(taxYear) {
  return supportedTaxYearEntries().some((entry) => entry.taxYear === Number(taxYear));
}

function normalizeTaxYear(taxYear) {
  const candidate = Number(taxYear);
  if (isSupportedTaxYear(candidate)) {
    return candidate;
  }

  return state.defaultTaxYear || DEFAULT_TAX_YEAR;
}

function draftSessionStorageKey(taxYear = currentTaxYear()) {
  return `taxvault:draft:session:${taxYear}`;
}

function draftLocalStorageKey(taxYear = currentTaxYear()) {
  return `taxvault:draft:local:${taxYear}`;
}

function draftPreferenceStorageKey(taxYear = currentTaxYear()) {
  return `taxvault:draft:remember:${taxYear}`;
}

function isLoopbackHost(hostname) {
  const normalized = String(hostname || "").trim().toLowerCase();
  return (
    normalized === "127.0.0.1" ||
    normalized === "localhost" ||
    normalized === "::1" ||
    normalized === "[::1]" ||
    normalized.endsWith(".localhost")
  );
}

function testingHooksEnabled() {
  if (typeof window === "undefined" || !window.location) {
    return false;
  }

  if (!isLoopbackHost(window.location.hostname)) {
    return false;
  }

  try {
    return new URLSearchParams(window.location.search).get(TESTING_HOOKS_QUERY_PARAM) === "1";
  } catch {
    return false;
  }
}

function readStoredActiveTaxYear() {
  return Number(readStoredValue(storageFor("session"), ACTIVE_TAX_YEAR_STORAGE_KEY));
}

function writeStoredActiveTaxYear(taxYear) {
  writeStoredValue(storageFor("session"), ACTIVE_TAX_YEAR_STORAGE_KEY, String(taxYear));
}

function normalizeRuntimeConfig(rawConfig) {
  const entries = Array.isArray(rawConfig?.supported_tax_years)
    ? rawConfig.supported_tax_years
        .map((entry) => {
          const taxYear = Number(entry?.tax_year);
          if (!Number.isInteger(taxYear)) {
            return null;
          }

          return {
            taxYear,
            available: Boolean(entry?.available),
            rulePackVersion:
              typeof entry?.rule_pack_version === "string" ? entry.rule_pack_version : null,
            taxTableVerificationStatus:
              typeof entry?.tax_table_verification_status === "string"
                ? entry.tax_table_verification_status
                : null,
            taxTableLocalEstimateReady: Boolean(entry?.tax_table_local_estimate_ready),
            taxTableHumanVerified: Boolean(entry?.tax_table_human_verified),
            loadError: typeof entry?.load_error === "string" ? entry.load_error : null,
          };
        })
        .filter(Boolean)
        .sort((left, right) => right.taxYear - left.taxYear)
    : [];

  const availableEntries = entries.filter((entry) => entry.available);
  const defaultTaxYear = Number(rawConfig?.default_tax_year);
  const fallbackTaxYear =
    availableEntries[0]?.taxYear || entries[0]?.taxYear || DEFAULT_TAX_YEAR;

  return {
    defaultTaxYear:
      Number.isInteger(defaultTaxYear) && availableEntries.some((entry) => entry.taxYear === defaultTaxYear)
        ? defaultTaxYear
        : fallbackTaxYear,
    supportedTaxYears:
      entries.length > 0
        ? entries
        : [
            {
              taxYear: DEFAULT_TAX_YEAR,
              available: true,
              rulePackVersion: null,
              taxTableVerificationStatus: null,
              taxTableLocalEstimateReady: false,
              taxTableHumanVerified: false,
              loadError: null,
            },
          ],
  };
}

function loadRuntimeConfig() {
  try {
    return normalizeRuntimeConfig(JSON.parse(get_app_config()));
  } catch {
    return normalizeRuntimeConfig(null);
  }
}

function applyRuntimeConfig(config) {
  state.supportedTaxYears = config.supportedTaxYears;
  state.defaultTaxYear = config.defaultTaxYear;

  const storedActiveTaxYear = readStoredActiveTaxYear();
  state.selectedTaxYear = normalizeTaxYear(
    Number.isInteger(storedActiveTaxYear) ? storedActiveTaxYear : config.defaultTaxYear
  );
  writeStoredActiveTaxYear(state.selectedTaxYear);
  renderTaxYearSelector();
}

function renderTaxYearSelector() {
  if (!els.taxYearSelect) {
    return;
  }

  const supportedEntries = supportedTaxYearEntries();
  els.taxYearSelect.replaceChildren();

  supportedEntries.forEach((entry) => {
    const option = new Option(String(entry.taxYear), String(entry.taxYear));
    option.selected = entry.taxYear === currentTaxYear();
    option.disabled = !entry.available;
    els.taxYearSelect.add(option);
  });

  const availableCount = supportedEntries.filter((entry) => entry.available).length;
  els.taxYearSelect.disabled = availableCount <= 1;

  if (!els.taxYearHint) {
    return;
  }

  if (availableCount <= 1) {
    els.taxYearHint.textContent =
      "This build includes one embedded federal rule pack, but drafts and exports already stay keyed to that tax year.";
    return;
  }

  els.taxYearHint.textContent =
    "Switching years opens that year's separate local draft and reloads the page into the matching rule pack.";
}

function handleTaxYearSelectionChange(event) {
  const nextTaxYear = normalizeTaxYear(event.target.value);
  if (nextTaxYear === currentTaxYear()) {
    renderTaxYearSelector();
    return;
  }

  const hasDraftData = Boolean(buildStoredDraftEnvelope(captureDraftSnapshot())) || state.currentStep === 3;
  if (
    hasDraftData &&
    !window.confirm(
      `Switch to tax year ${nextTaxYear}? TaxVault keeps a separate local draft for each supported year and will reload this page into that year.`
    )
  ) {
    renderTaxYearSelector();
    return;
  }

  if (hasDraftData) {
    flushPendingDraftSave();
  }

  writeStoredActiveTaxYear(nextTaxYear);
  window.location.reload();
}

function storageFor(kind) {
  if (typeof window === "undefined") {
    return null;
  }

  if (storageRefCache[kind] !== undefined) {
    return storageRefCache[kind];
  }

  try {
    const storage = kind === "local" ? window.localStorage : window.sessionStorage;
    const probeKey = "__taxvault_probe__";
    storage.setItem(probeKey, "1");
    storage.removeItem(probeKey);
    storageRefCache[kind] = storage;
    return storage;
  } catch {
    storageRefCache[kind] = null;
    return null;
  }
}

function readStoredValue(storage, key) {
  if (!storage) {
    return null;
  }

  try {
    return storage.getItem(key);
  } catch {
    return null;
  }
}

function writeStoredValue(storage, key, value) {
  if (!storage) {
    return false;
  }

  try {
    storage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

function removeStoredValue(storage, key) {
  if (!storage) {
    return;
  }

  try {
    storage.removeItem(key);
  } catch {
    // Ignore storage cleanup failures in private-browsing or restricted modes.
  }
}

function removeStoredValuesByPrefix(storage, prefix) {
  if (!storage) {
    return;
  }

  const keysToRemove = [];
  try {
    for (let index = 0; index < storage.length; index += 1) {
      const key = storage.key(index);
      if (typeof key === "string" && key.startsWith(prefix)) {
        keysToRemove.push(key);
      }
    }
  } catch {
    return;
  }

  keysToRemove.forEach((key) => {
    removeStoredValue(storage, key);
  });
}

function clearAllStoredTaxVaultData() {
  removeStoredValuesByPrefix(storageFor("session"), TAXVAULT_STORAGE_KEY_PREFIX);
  removeStoredValuesByPrefix(storageFor("local"), TAXVAULT_STORAGE_KEY_PREFIX);
}

function rememberDraftEnabled() {
  return Boolean(els.rememberDraftToggle?.checked);
}

function setStorageStatusText(message) {
  if (els.storageStatusText) {
    els.storageStatusText.textContent = message;
    return;
  }

  if (els.storageStatus) {
    els.storageStatus.textContent = message;
  }
}

function formatDraftSavedAtLabel(savedAt) {
  const timestamp = typeof savedAt === "string" ? Date.parse(savedAt) : Number.NaN;
  if (!Number.isFinite(timestamp)) {
    return "";
  }

  return `Last saved ${draftTimestampFormatter.format(new Date(timestamp))}.`;
}

function updateStorageStatusTimestamp() {
  if (!els.storageStatusTimestamp) {
    return;
  }

  const label = formatDraftSavedAtLabel(state.lastDraftSavedAt);
  els.storageStatusTimestamp.textContent = label;
  els.storageStatusTimestamp.classList.toggle("hidden", label === "");
}

function restoreDraftPreference() {
  if (!els.rememberDraftToggle) {
    return;
  }

  const localStorageRef = storageFor("local");
  if (!localStorageRef) {
    els.rememberDraftToggle.checked = false;
    els.rememberDraftToggle.disabled = true;
    refreshStorageStatus("Draft autosaves only in this tab. Device storage is unavailable in this browser mode.");
    return;
  }

  els.rememberDraftToggle.checked =
    readStoredValue(localStorageRef, draftPreferenceStorageKey()) === "true";
  refreshStorageStatus();
}

function handleRememberDraftToggle() {
  const localStorageRef = storageFor("local");

  if (rememberDraftEnabled()) {
    writeStoredValue(localStorageRef, draftPreferenceStorageKey(), "true");
    persistDraftSnapshot();
    refreshStorageStatus("Draft will also stay on this device until you clear it.");
    announceUiStatus("Draft persistence enabled for this device.");
    return;
  }

  removeStoredValue(localStorageRef, draftPreferenceStorageKey());
  removeStoredValue(localStorageRef, draftLocalStorageKey());
  persistDraftSnapshot();
  refreshStorageStatus("Draft will clear when this tab closes unless you enable device storage again.");
  announceUiStatus("Device draft persistence disabled.");
}

function refreshStorageStatus(message = "") {
  if (!els.storageStatus) {
    return;
  }

  if (message) {
    setStorageStatusText(message);
    updateStorageStatusTimestamp();
    updateStorageTrustCopy();
    return;
  }

  setStorageStatusText(
    rememberDraftEnabled()
    ? `Tax year ${currentTaxYear()} draft autosaves in this tab and stays on this device until you clear it.`
    : `Tax year ${currentTaxYear()} draft autosaves in this tab and clears when the tab closes.`
  );
  updateStorageStatusTimestamp();
  updateStorageTrustCopy();
}

function updateStorageTrustCopy() {
  if (!els.storageTrustCopy) {
    return;
  }

  const localStorageRef = storageFor("local");
  if (!localStorageRef) {
    els.storageTrustCopy.textContent =
      "This browser mode only allows tab-only autosave, so nothing stays on the device after the tab closes.";
    return;
  }

  els.storageTrustCopy.textContent = rememberDraftEnabled()
    ? `Your tax year ${currentTaxYear()} draft autosaves in this tab and stays on this device until you clear it.`
    : `By default your tax year ${currentTaxYear()} draft autosaves only in this tab and clears when the tab closes.`;
}

function renderIncomeSummaryChips() {
  if (!els.incomeSummaryChips) {
    return;
  }

  const counts = [
    { label: "W-2", count: els.w2Container.children.length },
    { label: "SSA-1099", count: els.socialSecurityContainer.children.length },
    { label: "1099-INT", count: els.interestContainer.children.length },
    { label: "1099-DIV", count: els.dividendContainer.children.length },
  ];
  const totalForms = counts.reduce((sum, item) => sum + item.count, 0);

  els.incomeSummaryChips.replaceChildren(
    createElement("span", {
      className: "summary-chip lead",
      text:
        totalForms === 0
          ? "Most people can start with W-2 and ignore the rest."
          : `${totalForms} income card${totalForms === 1 ? "" : "s"} started.`,
    })
  );

  counts.forEach(({ label, count }) => {
    els.incomeSummaryChips.append(
      createElement("span", {
        className: `summary-chip${count > 0 ? " active" : ""}`,
        text: `${label}: ${count}`,
      })
    );
  });

  els.incomeSummaryChips.append(
    createElement("span", {
      className: "summary-chip subtle",
      text: "Adjustments are optional.",
    })
  );
}

function countEnteredFormCards() {
  return (
    els.w2Container.children.length +
    els.socialSecurityContainer.children.length +
    els.interestContainer.children.length +
    els.dividendContainer.children.length
  );
}

function setComputeHelp(message, tone = "pending") {
  if (!els.computeHelp) {
    return;
  }

  els.computeHelp.textContent = message;
  els.computeHelp.className = `compute-help ${tone}`;
  els.computeBtn?.setAttribute("title", message);
}

function updateComputeHelpText() {
  if (!els.computeHelp) {
    return;
  }

  if (!state.wasmReady) {
    setComputeHelp("Loading the tax engine so TaxVault can review and calculate your draft.", "pending");
    return;
  }

  if (state.supportReviewReadyForEstimate) {
    setComputeHelp(
      "Ready to calculate. Press Ctrl+Enter or Cmd+Enter when you're ready to continue.",
      "ready"
    );
    return;
  }

  if (countEnteredFormCards() === 0) {
    setComputeHelp("Add at least one W-2, SSA-1099, 1099-INT, or 1099-DIV to unlock calculation.", "pending");
    return;
  }

  switch (els.supportReviewCard?.dataset.status) {
    case "unsupported":
      setComputeHelp("TaxVault cannot calculate this draft until the blocking issues above are resolved.", "attention");
      break;
    case "attention":
      setComputeHelp("Finish the blocking issues above before calculating this estimate.", "attention");
      break;
    default:
      setComputeHelp("TaxVault is checking whether this draft fits the supported estimate scope.", "pending");
      break;
  }
}

function applyDateConstraints(root) {
  if (!(root instanceof HTMLElement || root instanceof Document)) {
    return;
  }

  root.querySelectorAll('input[type="date"][data-date-kind="dob"]').forEach((input) => {
    input.setAttribute("min", DATE_INPUT_MIN);
    input.setAttribute("max", todayIsoDate());
  });
}

function scheduleDraftSave() {
  if (draftRestoreInProgress) {
    return;
  }

  window.clearTimeout(draftSaveTimer);
  draftSaveTimer = window.setTimeout(() => {
    draftSaveTimer = 0;
    if (draftRestoreInProgress) {
      return;
    }
    persistDraftSnapshot();
  }, 120);
}

function flushPendingDraftSave() {
  if (draftRestoreInProgress) {
    return;
  }

  window.clearTimeout(draftSaveTimer);
  draftSaveTimer = 0;
  persistDraftSnapshot();
}

function snapshotHasUserData(snapshot) {
  const hasText = (value) => typeof value === "string" && value.trim() !== "";
  const hasTruthyValue = (value) => hasText(value) || value === true;
  const hasObjectValue = (value) =>
    value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.values(value).some(hasTruthyValue);
  const hasMeaningfulEntries = (items) => Array.isArray(items) && items.some(hasObjectValue);

  return (
    snapshot?.filingStatus !== "single" ||
    hasObjectValue(snapshot?.primaryFiler) ||
    hasObjectValue(snapshot?.spouse) ||
    hasObjectValue(snapshot?.adjustments) ||
    hasText(snapshot?.estimatedTaxPayments) ||
    hasMeaningfulEntries(snapshot?.dependents) ||
    hasMeaningfulEntries(snapshot?.w2s) ||
    hasMeaningfulEntries(snapshot?.interestIncome) ||
    hasMeaningfulEntries(snapshot?.socialSecurityIncome) ||
    hasMeaningfulEntries(snapshot?.dividendIncome)
  );
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function readControlValue(control) {
  return typeof control?.value === "string" ? control.value : "";
}

function readTrimmedControlValue(control) {
  return readControlValue(control).trim();
}

function readQueryValue(root, selector) {
  const control =
    root && typeof root.querySelector === "function" ? root.querySelector(selector) : null;
  return readControlValue(control);
}

function readTrimmedQueryValue(root, selector) {
  return readQueryValue(root, selector).trim();
}

function captureDraftSnapshot() {
  return {
    savedAt: new Date().toISOString(),
    filingStatus: state.filingStatus,
    currentStep: Math.min(state.currentStep, 2),
    hadResults: state.currentStep === 3,
    primaryFiler: readFilerInputs("p"),
    spouse: readFilerInputs("s"),
    adjustments: {
      traditionalIraDeduction: readTrimmedControlValue(els.traditionalIraDeduction),
      hsaDeduction: readTrimmedControlValue(els.hsaDeduction),
      studentLoanInterestPaid: readTrimmedControlValue(els.studentLoanInterestPaid),
      studentLoanQualifiedLoan: Boolean(els.studentLoanQualifiedLoan?.checked),
      studentLoanLegallyObligated: Boolean(els.studentLoanLegallyObligated?.checked),
    },
    estimatedTaxPayments: readTrimmedControlValue(els.estimatedTaxPayments),
    dependents: Array.from(els.dependentContainer.querySelectorAll(".dependent-card")).map((card) => ({
      firstName: readTrimmedQueryValue(card, ".dep-first"),
      lastName: readTrimmedQueryValue(card, ".dep-last"),
      ssn: readTrimmedQueryValue(card, ".dep-ssn"),
      dob: readQueryValue(card, ".dep-dob"),
      relationship: readQueryValue(card, ".dep-relationship"),
      monthsLivedInHome: readTrimmedQueryValue(card, ".dep-months"),
    })),
    w2s: Array.from(els.w2Container.querySelectorAll(".w2-card")).map((card) => ({
      employerName: readTrimmedQueryValue(card, ".w2-employer"),
      recipient: readQueryValue(card, ".w2-recipient"),
      employerEin: readTrimmedQueryValue(card, ".w2-ein"),
      federalTaxWithheld: readTrimmedQueryValue(card, ".w2-fed-wh"),
      wages: readTrimmedQueryValue(card, ".w2-wages"),
      stateTaxWithheld: readTrimmedQueryValue(card, ".w2-state-wh"),
      socialSecurityWages: readTrimmedQueryValue(card, ".w2-ss-wages"),
      socialSecurityTaxWithheld: readTrimmedQueryValue(card, ".w2-ss-wh"),
      medicareWages: readTrimmedQueryValue(card, ".w2-med-wages"),
      medicareTaxWithheld: readTrimmedQueryValue(card, ".w2-med-wh"),
      advancedOpen: card.querySelector(".w2-advanced-fields")?.classList.contains("open") ?? false,
    })),
    socialSecurityIncome: Array.from(els.socialSecurityContainer.querySelectorAll(".ssa-card")).map(
      (card) => ({
        recipient: readQueryValue(card, ".ssa-recipient"),
        totalBenefits: readTrimmedQueryValue(card, ".ssa-benefits"),
        voluntaryWithholding: readTrimmedQueryValue(card, ".ssa-withholding"),
      })
    ),
    interestIncome: Array.from(els.interestContainer.querySelectorAll(".interest-card")).map((card) => ({
      payerName: readTrimmedQueryValue(card, ".interest-payer"),
      recipient: readQueryValue(card, ".interest-recipient"),
      taxableInterest: readTrimmedQueryValue(card, ".interest-taxable"),
      taxExemptInterest: readTrimmedQueryValue(card, ".interest-tax-exempt"),
    })),
    dividendIncome: Array.from(els.dividendContainer.querySelectorAll(".dividend-card")).map((card) => ({
      payerName: readTrimmedQueryValue(card, ".dividend-payer"),
      recipient: readQueryValue(card, ".dividend-recipient"),
      ordinaryDividends: readTrimmedQueryValue(card, ".dividend-ordinary"),
      qualifiedDividends: readTrimmedQueryValue(card, ".dividend-qualified"),
    })),
  };
}

function stripPiiFromSnapshot(snapshot) {
  const redactSnapshotRecord = (value, fields) => {
    if (!isPlainObject(value)) {
      return value;
    }

    const copy = { ...value };
    fields.forEach((field) => delete copy[field]);
    return copy;
  };

  return {
    ...snapshot,
    primaryFiler: redactSnapshotRecord(snapshot.primaryFiler, ["ssn"]),
    spouse: redactSnapshotRecord(snapshot.spouse, ["ssn"]),
    dependents: Array.isArray(snapshot.dependents)
      ? snapshot.dependents
          .map((dep) => redactSnapshotRecord(dep, ["ssn"]))
          .filter(isPlainObject)
      : [],
    w2s: Array.isArray(snapshot.w2s)
      ? snapshot.w2s
          .map((w2) => redactSnapshotRecord(w2, ["employerEin"]))
          .filter(isPlainObject)
      : [],
  };
}

function ageOnTaxYearEnd(dob, taxYear) {
  if (typeof dob !== "string" || !ISO_DATE_RE.test(dob)) {
    return null;
  }

  const birthYear = Number(dob.slice(0, 4));
  if (!Number.isInteger(birthYear)) {
    return null;
  }

  const age = Number(taxYear) - birthYear;
  return age >= 0 && age <= 125 ? age : null;
}

function redactSupportPerson(filer, { label, taxYear } = {}) {
  const firstName = typeof filer?.firstName === "string" ? filer.firstName : "";
  const lastName = typeof filer?.lastName === "string" ? filer.lastName : "";
  const ssn = typeof filer?.ssn === "string" ? filer.ssn : "";
  const entered =
    firstName.trim() !== "" ||
    lastName.trim() !== "" ||
    ssn.trim() !== "" ||
    (typeof filer?.dob === "string" && filer.dob.trim() !== "") ||
    Boolean(filer?.isBlind) ||
    Boolean(filer?.isDependent);

  return {
    label: label || "Person",
    entered,
    firstName: "",
    lastName: "",
    ssn: "",
    dob: "",
    ageOnTaxYearEnd: ageOnTaxYearEnd(filer?.dob, taxYear),
    isBlind: Boolean(filer?.isBlind),
    isDependent: Boolean(filer?.isDependent),
  };
}

function buildAnonymizedSupportInputSnapshot(snapshot, taxYear) {
  if (!isPlainObject(snapshot)) {
    return null;
  }

  return {
    savedAt:
      typeof snapshot.savedAt === "string" && snapshot.savedAt
        ? snapshot.savedAt
        : new Date().toISOString(),
    filingStatus: normalizeFilingStatus(snapshot.filingStatus),
    currentStep: normalizeDraftStep(snapshot.currentStep),
    hadResults: Boolean(snapshot.hadResults),
    primaryFiler: redactSupportPerson(snapshot.primaryFiler, {
      label: "Primary filer",
      taxYear,
    }),
    spouse: redactSupportPerson(snapshot.spouse, {
      label: "Spouse",
      taxYear,
    }),
    adjustments: {
      traditionalIraDeduction: snapshot.adjustments?.traditionalIraDeduction || "",
      hsaDeduction: snapshot.adjustments?.hsaDeduction || "",
      studentLoanInterestPaid: snapshot.adjustments?.studentLoanInterestPaid || "",
      studentLoanQualifiedLoan: Boolean(snapshot.adjustments?.studentLoanQualifiedLoan),
      studentLoanLegallyObligated: Boolean(snapshot.adjustments?.studentLoanLegallyObligated),
    },
    estimatedTaxPayments: snapshot.estimatedTaxPayments || "",
    dependents: Array.isArray(snapshot.dependents)
      ? snapshot.dependents.map((dependent, index) => ({
          label: `Dependent ${index + 1}`,
          firstName: "",
          lastName: "",
          ssn: "",
          dob: "",
          ageOnTaxYearEnd: ageOnTaxYearEnd(dependent?.dob, taxYear),
          relationship: normalizeDependentRelationship(dependent?.relationship),
          monthsLivedInHome:
            typeof dependent?.monthsLivedInHome === "string" ? dependent.monthsLivedInHome : "",
        }))
      : [],
    w2s: Array.isArray(snapshot.w2s)
      ? snapshot.w2s.map((w2, index) => ({
          label: `W-2 #${index + 1}`,
          employerName: "",
          recipient: normalizeIncomeRecipient(w2?.recipient),
          employerEin: "",
          federalTaxWithheld: w2?.federalTaxWithheld || "",
          wages: w2?.wages || "",
          stateTaxWithheld: w2?.stateTaxWithheld || "",
          socialSecurityWages: w2?.socialSecurityWages || "",
          socialSecurityTaxWithheld: w2?.socialSecurityTaxWithheld || "",
          medicareWages: w2?.medicareWages || "",
          medicareTaxWithheld: w2?.medicareTaxWithheld || "",
          advancedOpen: Boolean(w2?.advancedOpen),
        }))
      : [],
    socialSecurityIncome: Array.isArray(snapshot.socialSecurityIncome)
      ? snapshot.socialSecurityIncome.map((item, index) => ({
          label: `SSA-1099 #${index + 1}`,
          recipient: normalizeIncomeRecipient(item?.recipient),
          totalBenefits: item?.totalBenefits || "",
          voluntaryWithholding: item?.voluntaryWithholding || "",
        }))
      : [],
    interestIncome: Array.isArray(snapshot.interestIncome)
      ? snapshot.interestIncome.map((item, index) => ({
          label: `1099-INT #${index + 1}`,
          payerName: "",
          recipient: normalizeIncomeRecipient(item?.recipient),
          taxableInterest: item?.taxableInterest || "",
          taxExemptInterest: item?.taxExemptInterest || "",
        }))
      : [],
    dividendIncome: Array.isArray(snapshot.dividendIncome)
      ? snapshot.dividendIncome.map((item, index) => ({
          label: `1099-DIV #${index + 1}`,
          payerName: "",
          recipient: normalizeIncomeRecipient(item?.recipient),
          ordinaryDividends: item?.ordinaryDividends || "",
          qualifiedDividends: item?.qualifiedDividends || "",
        }))
      : [],
  };
}

function buildSupportSnapshotRedactions(snapshot) {
  const replacements = [];
  const addReplacement = (value, replacement) => {
    const text = typeof value === "string" ? value.trim() : "";
    if (!text) {
      return;
    }
    replacements.push({ text, replacement });
  };
  const fullName = (person) =>
    [person?.firstName, person?.lastName]
      .filter((value) => typeof value === "string" && value.trim() !== "")
      .join(" ")
      .trim();

  addReplacement(fullName(snapshot?.primaryFiler), "Primary filer");
  addReplacement(snapshot?.primaryFiler?.ssn, "[redacted ssn]");
  addReplacement(snapshot?.primaryFiler?.dob, "[redacted dob]");

  addReplacement(fullName(snapshot?.spouse), "Spouse");
  addReplacement(snapshot?.spouse?.ssn, "[redacted ssn]");
  addReplacement(snapshot?.spouse?.dob, "[redacted dob]");

  if (Array.isArray(snapshot?.dependents)) {
    snapshot.dependents.forEach((dependent, index) => {
      const label = `dependent ${index + 1}`;
      const name = fullName(dependent);
      if (name) {
        addReplacement(`${label} (${name})`, label);
        addReplacement(name, `Dependent ${index + 1}`);
      }
      addReplacement(dependent?.ssn, "[redacted ssn]");
      addReplacement(dependent?.dob, "[redacted dob]");
    });
  }

  if (Array.isArray(snapshot?.w2s)) {
    snapshot.w2s.forEach((w2, index) => {
      addReplacement(w2?.employerName, `W-2 #${index + 1} employer`);
      addReplacement(w2?.employerEin, "[redacted ein]");
    });
  }

  if (Array.isArray(snapshot?.interestIncome)) {
    snapshot.interestIncome.forEach((item, index) => {
      addReplacement(item?.payerName, `1099-INT #${index + 1} payer`);
    });
  }

  if (Array.isArray(snapshot?.dividendIncome)) {
    snapshot.dividendIncome.forEach((item, index) => {
      addReplacement(item?.payerName, `1099-DIV #${index + 1} payer`);
    });
  }

  return Array.from(
    new Map(replacements.map((entry) => [entry.text, entry.replacement])).entries(),
    ([text, replacement]) => ({ text, replacement })
  ).sort((left, right) => right.text.length - left.text.length);
}

function redactSensitiveText(value, replacements) {
  return replacements.reduce(
    (current, entry) => current.split(entry.text).join(entry.replacement),
    String(value ?? "")
  );
}

function redactStructuredValue(value, replacements) {
  if (typeof value === "string") {
    return redactSensitiveText(value, replacements);
  }

  if (Array.isArray(value)) {
    return value.map((item) => redactStructuredValue(item, replacements));
  }

  if (isPlainObject(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, entryValue]) => [key, redactStructuredValue(entryValue, replacements)])
    );
  }

  return value;
}

function redactSupportSnapshotEnvelope(envelope, rawSnapshot) {
  const replacements = buildSupportSnapshotRedactions(rawSnapshot);
  if (replacements.length === 0) {
    return envelope;
  }

  return redactStructuredValue(envelope, replacements);
}

function buildDraftEnvelope(snapshot, { createdAt, updatedAt, piiRedacted = true, taxYear } = {}) {
  const normalizedUpdatedAt =
    typeof updatedAt === "string" && updatedAt ? updatedAt : new Date().toISOString();
  const normalizedCreatedAt =
    typeof createdAt === "string" && createdAt ? createdAt : normalizedUpdatedAt;
  const normalizedTaxYear = normalizeTaxYear(taxYear ?? currentTaxYear());

  return {
    type: DRAFT_FILE_TYPE,
    version: DRAFT_ENVELOPE_VERSION,
    appVersion: APP_VERSION,
    taxYear: normalizedTaxYear,
    piiRedacted: Boolean(piiRedacted),
    createdAt: normalizedCreatedAt,
    updatedAt: normalizedUpdatedAt,
    draft: {
      ...snapshot,
      savedAt: normalizedUpdatedAt,
    },
  };
}

function looksLikeDraftEnvelope(value) {
  return isPlainObject(value) && value.type === DRAFT_FILE_TYPE;
}

function looksLikeLegacyDraftSnapshot(value) {
  return isPlainObject(value) && value.version === LEGACY_DRAFT_STORAGE_VERSION;
}

function buildStoredDraftEnvelope(snapshot, { createdAt, taxYear } = {}) {
  const sanitizedSnapshot = stripPiiFromSnapshot(snapshot);

  if (!snapshotHasUserData(sanitizedSnapshot)) {
    return null;
  }

  const updatedAt =
    typeof sanitizedSnapshot.savedAt === "string" && sanitizedSnapshot.savedAt
      ? sanitizedSnapshot.savedAt
      : new Date().toISOString();
  const envelopeCreatedAt =
    typeof createdAt === "string" && createdAt
      ? createdAt
      : state.draftEnvelopeCreatedAt || updatedAt;

  return buildDraftEnvelope(sanitizedSnapshot, {
    createdAt: envelopeCreatedAt,
    updatedAt,
    piiRedacted: true,
    taxYear,
  });
}

function clearStoredDraftData({ refreshStatus = true, taxYear = currentTaxYear() } = {}) {
  const sessionStorageRef = storageFor("session");
  const localStorageRef = storageFor("local");
  removeStoredValue(sessionStorageRef, draftSessionStorageKey(taxYear));
  removeStoredValue(localStorageRef, draftLocalStorageKey(taxYear));
  state.draftEnvelopeCreatedAt = null;
  state.lastDraftSavedAt = null;

  if (refreshStatus) {
    refreshStorageStatus();
  }
}

function storeDraftEnvelope(envelope, { refreshStatus = true } = {}) {
  const sessionStorageRef = storageFor("session");
  const localStorageRef = storageFor("local");
  const serialized = JSON.stringify(envelope);
  const taxYear = normalizeTaxYear(envelope?.taxYear);

  writeStoredValue(sessionStorageRef, draftSessionStorageKey(taxYear), serialized);

  if (rememberDraftEnabled()) {
    writeStoredValue(localStorageRef, draftPreferenceStorageKey(taxYear), "true");
    writeStoredValue(localStorageRef, draftLocalStorageKey(taxYear), serialized);
  } else {
    removeStoredValue(localStorageRef, draftLocalStorageKey(taxYear));
  }

  state.draftEnvelopeCreatedAt =
    typeof envelope.createdAt === "string" && envelope.createdAt ? envelope.createdAt : null;
  state.lastDraftSavedAt =
    typeof envelope.updatedAt === "string" && envelope.updatedAt ? envelope.updatedAt : null;

  if (refreshStatus) {
    refreshStorageStatus();
  }

  return envelope;
}

function storeDraftSnapshot(snapshot, { refreshStatus = true, createdAt, taxYear } = {}) {
  const envelope = buildStoredDraftEnvelope(snapshot, { createdAt, taxYear });

  if (!envelope) {
    clearStoredDraftData({ refreshStatus });
    return null;
  }

  return storeDraftEnvelope(envelope, { refreshStatus });
}

function persistDraftSnapshot() {
  storeDraftSnapshot(captureDraftSnapshot());
}

function normalizeFilingStatus(status) {
  return FILING_STATUS_KEYS.has(status) ? status : "single";
}

function truncateDraftField(value, maxLen) {
  if (typeof value !== "string") {
    return "";
  }

  return value.length > maxLen ? value.slice(0, maxLen) : value;
}

function normalizeIncomeRecipient(value) {
  return ALLOWED_INCOME_RECIPIENTS.has(value) ? value : "primary";
}

function normalizeDependentRelationship(value) {
  return ALLOWED_DEPENDENT_RELATIONSHIPS.has(value) ? value : "";
}

function normalizeDraftStep(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) {
    return 1;
  }

  return Math.min(3, Math.max(1, Math.floor(n)));
}

function sanitizeDraftSnapshotForRestore(snapshot) {
  if (!isPlainObject(snapshot)) {
    return null;
  }

  const filingStatus = normalizeFilingStatus(snapshot.filingStatus);
  const currentStep = normalizeDraftStep(snapshot.currentStep);
  const hadResults = Boolean(snapshot.hadResults);
  const savedAt = typeof snapshot.savedAt === "string" ? snapshot.savedAt : new Date().toISOString();

  const rawPrimary = snapshot.primaryFiler;
  const rawSpouse = snapshot.spouse;
  const primaryFiler =
    rawPrimary && typeof rawPrimary === "object" && !Array.isArray(rawPrimary)
      ? {
          firstName: truncateDraftField(rawPrimary.firstName, MAX_TEXT_FIELD_LENGTH),
          lastName: truncateDraftField(rawPrimary.lastName, MAX_TEXT_FIELD_LENGTH),
          ssn: "",
          dob:
            typeof rawPrimary.dob === "string" && ISO_DATE_RE.test(rawPrimary.dob)
              ? rawPrimary.dob
              : "",
          isBlind: Boolean(rawPrimary.isBlind),
          isDependent: Boolean(rawPrimary.isDependent),
        }
      : {
          firstName: "",
          lastName: "",
          ssn: "",
          dob: "",
          isBlind: false,
          isDependent: false,
        };

  const spouse =
    rawSpouse && typeof rawSpouse === "object" && !Array.isArray(rawSpouse)
      ? {
          firstName: truncateDraftField(rawSpouse.firstName, MAX_TEXT_FIELD_LENGTH),
          lastName: truncateDraftField(rawSpouse.lastName, MAX_TEXT_FIELD_LENGTH),
          ssn: "",
          dob:
            typeof rawSpouse.dob === "string" && ISO_DATE_RE.test(rawSpouse.dob) ? rawSpouse.dob : "",
          isBlind: Boolean(rawSpouse.isBlind),
          isDependent: Boolean(rawSpouse.isDependent),
        }
      : {
          firstName: "",
          lastName: "",
          ssn: "",
          dob: "",
          isBlind: false,
          isDependent: false,
        };

  const rawAdj = snapshot.adjustments;
  const adjustments =
    rawAdj && typeof rawAdj === "object" && !Array.isArray(rawAdj)
      ? {
          traditionalIraDeduction: truncateDraftField(rawAdj.traditionalIraDeduction, 32),
          hsaDeduction: truncateDraftField(rawAdj.hsaDeduction, 32),
          studentLoanInterestPaid: truncateDraftField(rawAdj.studentLoanInterestPaid, 32),
          studentLoanQualifiedLoan: Boolean(rawAdj.studentLoanQualifiedLoan),
          studentLoanLegallyObligated: Boolean(rawAdj.studentLoanLegallyObligated),
        }
      : {
          traditionalIraDeduction: "",
          hsaDeduction: "",
          studentLoanInterestPaid: "",
          studentLoanQualifiedLoan: false,
          studentLoanLegallyObligated: false,
        };
  const estimatedTaxPayments = truncateDraftField(snapshot.estimatedTaxPayments, 32);

  const dependents = Array.isArray(snapshot.dependents)
    ? snapshot.dependents.slice(0, MAX_DEPENDENTS).map((dep) => {
        if (!dep || typeof dep !== "object" || Array.isArray(dep)) {
          return {
            firstName: "",
            lastName: "",
            ssn: "",
            dob: "",
            relationship: "",
            monthsLivedInHome: "",
          };
        }

        const monthsRaw =
          dep.monthsLivedInHome === "" || dep.monthsLivedInHome === null || dep.monthsLivedInHome === undefined
            ? ""
            : String(dep.monthsLivedInHome);
        const monthsNum = monthsRaw === "" ? Number.NaN : Number(monthsRaw);
        const monthsOk =
          Number.isInteger(monthsNum) && monthsNum >= 0 && monthsNum <= 12 ? String(monthsNum) : "";

        return {
          firstName: truncateDraftField(dep.firstName, MAX_TEXT_FIELD_LENGTH),
          lastName: truncateDraftField(dep.lastName, MAX_TEXT_FIELD_LENGTH),
          ssn: "",
          dob: typeof dep.dob === "string" && ISO_DATE_RE.test(dep.dob) ? dep.dob : "",
          relationship: normalizeDependentRelationship(dep.relationship),
          monthsLivedInHome: monthsOk,
        };
      })
    : [];

  const w2s = Array.isArray(snapshot.w2s)
    ? snapshot.w2s.slice(0, MAX_W2_FORMS).map((w2) => {
        if (!w2 || typeof w2 !== "object" || Array.isArray(w2)) {
          return {
            employerName: "",
            recipient: "primary",
            employerEin: "",
            federalTaxWithheld: "",
            wages: "",
            stateTaxWithheld: "",
            socialSecurityWages: "",
            socialSecurityTaxWithheld: "",
            medicareWages: "",
            medicareTaxWithheld: "",
            advancedOpen: false,
          };
        }

        return {
          employerName: truncateDraftField(w2.employerName, MAX_TEXT_FIELD_LENGTH),
          recipient: normalizeIncomeRecipient(w2.recipient),
          employerEin: "",
          federalTaxWithheld: truncateDraftField(w2.federalTaxWithheld, 32),
          wages: truncateDraftField(w2.wages, 32),
          stateTaxWithheld: truncateDraftField(w2.stateTaxWithheld, 32),
          socialSecurityWages: truncateDraftField(w2.socialSecurityWages, 32),
          socialSecurityTaxWithheld: truncateDraftField(w2.socialSecurityTaxWithheld, 32),
          medicareWages: truncateDraftField(w2.medicareWages, 32),
          medicareTaxWithheld: truncateDraftField(w2.medicareTaxWithheld, 32),
          advancedOpen: Boolean(w2.advancedOpen),
        };
      })
    : [];

  const socialSecurityIncome = Array.isArray(snapshot.socialSecurityIncome)
    ? snapshot.socialSecurityIncome.slice(0, MAX_SOCIAL_SECURITY_FORMS).map((item) => {
        if (!item || typeof item !== "object" || Array.isArray(item)) {
          return {
            recipient: "primary",
            totalBenefits: "",
            voluntaryWithholding: "",
          };
        }

        return {
          recipient: normalizeIncomeRecipient(item.recipient),
          totalBenefits: truncateDraftField(item.totalBenefits, 32),
          voluntaryWithholding: truncateDraftField(item.voluntaryWithholding, 32),
        };
      })
    : [];

  const interestIncome = Array.isArray(snapshot.interestIncome)
    ? snapshot.interestIncome.slice(0, MAX_INTEREST_FORMS).map((item) => {
        if (!item || typeof item !== "object" || Array.isArray(item)) {
          return {
            payerName: "",
            recipient: "primary",
            taxableInterest: "",
            taxExemptInterest: "",
          };
        }

        return {
          payerName: truncateDraftField(item.payerName, MAX_TEXT_FIELD_LENGTH),
          recipient: normalizeIncomeRecipient(item.recipient),
          taxableInterest: truncateDraftField(item.taxableInterest, 32),
          taxExemptInterest: truncateDraftField(item.taxExemptInterest, 32),
        };
      })
    : [];

  const dividendIncome = Array.isArray(snapshot.dividendIncome)
    ? snapshot.dividendIncome.slice(0, MAX_DIVIDEND_FORMS).map((item) => {
        if (!item || typeof item !== "object" || Array.isArray(item)) {
          return {
            payerName: "",
            recipient: "primary",
            ordinaryDividends: "",
            qualifiedDividends: "",
          };
        }

        return {
          payerName: truncateDraftField(item.payerName, MAX_TEXT_FIELD_LENGTH),
          recipient: normalizeIncomeRecipient(item.recipient),
          ordinaryDividends: truncateDraftField(item.ordinaryDividends, 32),
          qualifiedDividends: truncateDraftField(item.qualifiedDividends, 32),
        };
      })
    : [];

  return {
    savedAt,
    filingStatus,
    currentStep,
    hadResults,
    primaryFiler,
    spouse,
    adjustments,
    estimatedTaxPayments,
    dependents,
    w2s,
    socialSecurityIncome,
    interestIncome,
    dividendIncome,
  };
}

function prepareDraftEnvelopeForRestore(rawDraft) {
  if (looksLikeDraftEnvelope(rawDraft)) {
    if (rawDraft.version !== DRAFT_ENVELOPE_VERSION) {
      return {
        ok: false,
        message: `This draft uses TaxVault draft format v${rawDraft.version}. This build supports v${DRAFT_ENVELOPE_VERSION}.`,
      };
    }

    const draftTaxYear = Number(rawDraft.taxYear);
    if (!Number.isInteger(draftTaxYear) || !isSupportedTaxYear(draftTaxYear)) {
      const availableYears = supportedTaxYearEntries().map((entry) => entry.taxYear).join(", ");
      return {
        ok: false,
        message: `This draft is for tax year ${rawDraft.taxYear}. This TaxVault build currently supports: ${availableYears || "no embedded tax years"}.`,
      };
    }

    const sanitizedSnapshot = sanitizeDraftSnapshotForRestore(rawDraft.draft);
    if (!sanitizedSnapshot || !snapshotHasUserData(sanitizedSnapshot)) {
      return {
        ok: false,
        message: "This TaxVault draft file did not include any restorable draft data.",
      };
    }

    return {
      ok: true,
      migratedLegacy: false,
      envelope: buildDraftEnvelope(sanitizedSnapshot, {
        createdAt:
          typeof rawDraft.createdAt === "string" && rawDraft.createdAt
            ? rawDraft.createdAt
            : sanitizedSnapshot.savedAt,
        updatedAt:
          typeof rawDraft.updatedAt === "string" && rawDraft.updatedAt
            ? rawDraft.updatedAt
            : sanitizedSnapshot.savedAt,
        piiRedacted: true,
        taxYear: draftTaxYear,
      }),
    };
  }

  if (looksLikeLegacyDraftSnapshot(rawDraft)) {
    const sanitizedSnapshot = sanitizeDraftSnapshotForRestore(rawDraft);
    if (!sanitizedSnapshot || !snapshotHasUserData(sanitizedSnapshot)) {
      return {
        ok: false,
        message: "This legacy TaxVault draft did not include any restorable draft data.",
      };
    }

    return {
      ok: true,
      migratedLegacy: true,
      envelope: buildDraftEnvelope(sanitizedSnapshot, {
        createdAt: sanitizedSnapshot.savedAt,
        updatedAt: sanitizedSnapshot.savedAt,
        piiRedacted: true,
        taxYear: currentTaxYear(),
      }),
    };
  }

  return {
    ok: false,
    message: "This file is not a supported TaxVault draft export.",
  };
}

function draftRestoreMessage(hadResults, action = "restored") {
  const prefix = action === "imported" ? "Draft imported." : "Draft restored.";
  return hadResults
    ? `${prefix} SSNs and EINs must be re-entered (not stored for your protection). Recalculate to refresh the estimate results.`
    : `${prefix} SSNs and EINs must be re-entered (not stored for your protection).`;
}

function importDraftValue(rawDraft, { announce = true } = {}) {
  const prepared = prepareDraftEnvelopeForRestore(rawDraft);
  if (!prepared.ok) {
    return prepared;
  }

  const importedTaxYear = normalizeTaxYear(prepared.envelope.taxYear);
  if (importedTaxYear !== currentTaxYear()) {
    state.selectedTaxYear = importedTaxYear;
    writeStoredActiveTaxYear(importedTaxYear);
    restoreDraftPreference();
    renderTaxYearSelector();
  }

  const storedEnvelope = storeDraftEnvelope(prepared.envelope, { refreshStatus: false });
  applyDraftSnapshot(storedEnvelope.draft);

  const restoredMessage = draftRestoreMessage(storedEnvelope.draft.hadResults, "imported");
  refreshStorageStatus(restoredMessage);
  hideError();

  if (announce) {
    announceUiStatus("Draft imported.");
  }

  return {
    ok: true,
    migratedLegacy: prepared.migratedLegacy,
    envelope: storedEnvelope,
    message: restoredMessage,
  };
}

function restoreDraftSnapshot() {
  const localStorageRef = storageFor("local");
  const sessionStorageRef = storageFor("session");
  const rawDraft =
    (rememberDraftEnabled() && readStoredValue(localStorageRef, draftLocalStorageKey())) ||
    readStoredValue(sessionStorageRef, draftSessionStorageKey());

  if (!rawDraft) {
    return false;
  }

  let parsedDraft;
  try {
    parsedDraft = JSON.parse(rawDraft);
  } catch {
    clearStoredDraftData({ refreshStatus: true });
    return false;
  }

  const prepared = prepareDraftEnvelopeForRestore(parsedDraft);
  if (!prepared.ok) {
    clearStoredDraftData({ refreshStatus: true });
    return false;
  }

  const storedEnvelope = storeDraftEnvelope(prepared.envelope, { refreshStatus: false });
  applyDraftSnapshot(storedEnvelope.draft);
  refreshStorageStatus(draftRestoreMessage(storedEnvelope.draft.hadResults));
  announceUiStatus("Saved draft restored.");
  return true;
}

function applyDraftSnapshot(snapshot) {
  draftRestoreInProgress = true;

  try {
    resetComputedEstimate();
    clearRestorableCards();
    selectStatus(snapshot.filingStatus || "single", { autoSeedDependent: false });
    applyFilerInputs("p", snapshot.primaryFiler);
    applyFilerInputs("s", snapshot.spouse);
    applyAdjustmentInputs(snapshot.adjustments, snapshot.estimatedTaxPayments);
    restoreDependents(Array.isArray(snapshot.dependents) ? snapshot.dependents : []);
    restoreW2Cards(Array.isArray(snapshot.w2s) ? snapshot.w2s : []);
    restoreSocialSecurityCards(
      Array.isArray(snapshot.socialSecurityIncome) ? snapshot.socialSecurityIncome : []
    );
    restoreInterestCards(Array.isArray(snapshot.interestIncome) ? snapshot.interestIncome : []);
    restoreDividendCards(Array.isArray(snapshot.dividendIncome) ? snapshot.dividendIncome : []);
    renderIncomeSummaryChips();
    const step1Validation = validateStep1();
    const nextStep = snapshot.currentStep === 2 && step1Validation.messages.length === 0 ? 2 : 1;
    goToStep(nextStep);
    hideError();
  } finally {
    draftRestoreInProgress = false;
  }
}

function clearRestorableCards() {
  cleanupReferencePreviews(els.w2Container);
  cleanupReferencePreviews(els.socialSecurityContainer);
  cleanupReferencePreviews(els.interestContainer);
  cleanupReferencePreviews(els.dividendContainer);

  els.w2Container.replaceChildren();
  els.socialSecurityContainer.replaceChildren();
  els.interestContainer.replaceChildren();
  els.dividendContainer.replaceChildren();
  els.dependentContainer.replaceChildren();

  state.w2Count = 0;
  state.socialSecurityCount = 0;
  state.interestCount = 0;
  state.dividendCount = 0;
  state.dependentCount = 0;

  updateRemoveButtons();
  updateSocialSecurityRemoveButtons();
  updateInterestRemoveButtons();
  updateDividendRemoveButtons();
  updateDependentRemoveButtons();
  renderIncomeSummaryChips();
}

function applyFilerInputs(prefix, filer = {}) {
  document.getElementById(`${prefix}First`).value = filer.firstName || "";
  document.getElementById(`${prefix}Last`).value = filer.lastName || "";
  document.getElementById(`${prefix}Ssn`).value = filer.ssn || "";
  document.getElementById(`${prefix}Dob`).value = filer.dob || "";
  document.getElementById(`${prefix}Blind`).checked = Boolean(filer.isBlind);
  const dependentCheckbox = document.getElementById(`${prefix}Dependent`);
  if (dependentCheckbox) {
    dependentCheckbox.checked = Boolean(filer.isDependent);
  }
}

function applyAdjustmentInputs(adjustments = {}, estimatedTaxPayments = "") {
  els.traditionalIraDeduction.value = adjustments.traditionalIraDeduction || "";
  els.hsaDeduction.value = adjustments.hsaDeduction || "";
  els.studentLoanInterestPaid.value = adjustments.studentLoanInterestPaid || "";
  if (els.studentLoanQualifiedLoan) {
    els.studentLoanQualifiedLoan.checked = Boolean(adjustments.studentLoanQualifiedLoan);
  }
  if (els.studentLoanLegallyObligated) {
    els.studentLoanLegallyObligated.checked = Boolean(adjustments.studentLoanLegallyObligated);
  }
  els.estimatedTaxPayments.value = estimatedTaxPayments || "";
  bindMoneyFields(document);
}

function restoreDependents(dependents) {
  dependents.forEach((dependent) => {
    const card = addDependent({ focusNewCard: false, batched: true });
    if (!card) {
      return;
    }

    card.querySelector(".dep-first").value = dependent.firstName || "";
    card.querySelector(".dep-last").value = dependent.lastName || "";
    card.querySelector(".dep-ssn").value = dependent.ssn || "";
    card.querySelector(".dep-dob").value = dependent.dob || "";
    card.querySelector(".dep-relationship").value = dependent.relationship || "";
    card.querySelector(".dep-months").value = dependent.monthsLivedInHome || "";
  });
}

function restoreW2Cards(w2s) {
  w2s.forEach((w2) => {
    const card = addW2({ focusNewCard: false, batched: true });
    if (!card) {
      return;
    }

    card.querySelector(".w2-employer").value = w2.employerName || "";
    card.querySelector(".w2-recipient").value = w2.recipient || "primary";
    card.querySelector(".w2-ein").value = w2.employerEin || "";
    card.querySelector(".w2-fed-wh").value = w2.federalTaxWithheld || "";
    card.querySelector(".w2-wages").value = w2.wages || "";
    card.querySelector(".w2-state-wh").value = w2.stateTaxWithheld || "";
    card.querySelector(".w2-ss-wages").value = w2.socialSecurityWages || "";
    card.querySelector(".w2-ss-wh").value = w2.socialSecurityTaxWithheld || "";
    card.querySelector(".w2-med-wages").value = w2.medicareWages || "";
    card.querySelector(".w2-med-wh").value = w2.medicareTaxWithheld || "";
    if (w2.advancedOpen) {
      toggleAdvanced(card);
    }
  });
}

function restoreSocialSecurityCards(items) {
  items.forEach((item) => {
    const card = addSocialSecurity({ focusNewCard: false, batched: true });
    if (!card) {
      return;
    }

    card.querySelector(".ssa-recipient").value = item.recipient || "primary";
    card.querySelector(".ssa-benefits").value = item.totalBenefits || "";
    card.querySelector(".ssa-withholding").value = item.voluntaryWithholding || "";
  });
}

function restoreInterestCards(items) {
  items.forEach((item) => {
    const card = addInterest({ focusNewCard: false, batched: true });
    if (!card) {
      return;
    }

    card.querySelector(".interest-payer").value = item.payerName || "";
    card.querySelector(".interest-recipient").value = item.recipient || "primary";
    card.querySelector(".interest-taxable").value = item.taxableInterest || "";
    card.querySelector(".interest-tax-exempt").value = item.taxExemptInterest || "";
  });
}

function restoreDividendCards(items) {
  items.forEach((item) => {
    const card = addDividend({ focusNewCard: false, batched: true });
    if (!card) {
      return;
    }

    card.querySelector(".dividend-payer").value = item.payerName || "";
    card.querySelector(".dividend-recipient").value = item.recipient || "primary";
    card.querySelector(".dividend-ordinary").value = item.ordinaryDividends || "";
    card.querySelector(".dividend-qualified").value = item.qualifiedDividends || "";
  });
}

function bindSsnFields(root) {
  root.querySelectorAll(".ssn-field").forEach((field) => {
    if (field.dataset.bound === "true") {
      return;
    }

    const input = field.querySelector(".ssn-input");
    const toggle = field.querySelector(".ssn-toggle");

    input.addEventListener("input", (event) => {
      event.target.value = formatDigits(event.target.value, [3, 2, 4]);
    });

    toggle.addEventListener("click", () => {
      const nextVisible = input.type === "password";
      setSsnVisibility(input, toggle, nextVisible);
      input.focus({ preventScroll: true });
      input.setSelectionRange(input.value.length, input.value.length);
    });

    setSsnVisibility(input, toggle, false);
    field.dataset.bound = "true";
  });
}

function setSsnVisibility(input, toggle, visible) {
  input.type = visible ? "text" : "password";
  toggle.textContent = visible ? "Hide" : "Show";
  toggle.setAttribute("aria-pressed", String(visible));
  toggle.setAttribute("aria-label", `${visible ? "Hide" : "Show"} Social Security number`);
}

function showDisclaimerGate() {
  if (els.disclaimerGate.classList.contains("hidden")) {
    lastGateFocusedElement =
      document.activeElement instanceof HTMLElement &&
      document.activeElement !== document.body &&
      !els.disclaimerGate.contains(document.activeElement)
        ? document.activeElement
        : null;
  }

  els.disclaimerGate.classList.remove("hidden");
  document.body.classList.add("gate-open");
  updateGateButtonState();
  focusElement(els.gateAcknowledge);
}

function hideDisclaimerGate() {
  els.disclaimerGate.classList.add("hidden");
  document.body.classList.remove("gate-open");
  const focusTarget = lastGateFocusedElement || document.getElementById("pFirst");
  lastGateFocusedElement = null;
  focusElement(focusTarget);
}

function updateGateButtonState() {
  els.gateContinueBtn.disabled = !els.gateAcknowledge.checked;
}

function acknowledgeSafetyGate() {
  if (!els.gateAcknowledge.checked) {
    return;
  }

  state.safetyAcknowledged = true;
  hideDisclaimerGate();
  els.app.classList.remove("hidden");
}

function handleStatusOptionKeydown(event) {
  const target = event.target.closest(".status-option");
  if (!(target instanceof HTMLElement)) {
    return;
  }

  const buttons = Array.from(document.querySelectorAll(".status-option"));
  const index = buttons.indexOf(target);
  if (index < 0) {
    return;
  }

  let nextIndex = index;
  switch (event.key) {
    case "ArrowRight":
    case "ArrowDown":
      nextIndex = (index + 1) % buttons.length;
      break;
    case "ArrowLeft":
    case "ArrowUp":
      nextIndex = (index - 1 + buttons.length) % buttons.length;
      break;
    case "Home":
      nextIndex = 0;
      break;
    case "End":
      nextIndex = buttons.length - 1;
      break;
    case " ":
    case "Enter":
      event.preventDefault();
      selectStatus(target.dataset.status, { focusSelected: true });
      return;
    default:
      return;
  }

  event.preventDefault();
  selectStatus(buttons[nextIndex].dataset.status, { focusSelected: true });
}

function selectStatus(status, { autoSeedDependent = true, focusSelected = false } = {}) {
  const normalized = normalizeFilingStatus(status);
  state.filingStatus = normalized;
  resetComputedEstimate();

  document.querySelectorAll(".status-option").forEach((button) => {
    const selected = button.dataset.status === normalized;
    button.classList.toggle("selected", selected);
    button.setAttribute("aria-checked", String(selected));
    button.tabIndex = selected ? 0 : -1;

    if (selected && focusSelected) {
      focusElement(button);
    }
  });

  const isMfj = normalized === "married_filing_jointly";
  const isHoh = normalized === "head_of_household";
  els.spouseCard.classList.toggle("hidden", !isMfj);
  updateDependentSubtitle(isHoh);

  if (autoSeedDependent && isHoh && els.dependentContainer.children.length === 0) {
    addDependent();
  }

  document.querySelectorAll(".income-recipient").forEach((select) => {
    const spouseOption = Array.from(select.options).find((option) => option.value === "spouse");

    if (isMfj && !spouseOption) {
      select.add(new Option("Spouse", "spouse"));
    }

    if (!isMfj && spouseOption) {
      spouseOption.remove();
      if (select.value === "spouse") {
        select.value = "primary";
      }
    }
  });

  updateDependentRemoveButtons();
  scheduleDraftSave();
}

function updateDependentSubtitle(isHoh) {
  els.dependentSubtitle.textContent = isHoh
    ? "Head of Household requires at least one dependent. TaxVault only supports resident qualifying-person cases it can screen from these inputs, so parent-based and 'other' dependent scenarios are blocked before income entry. Child-related credits only apply to qualifying children under age 17, and TaxVault does not verify every IRS dependency or custody rule."
    : "Add any dependents you plan to claim. Dependents entered here may affect the Child Tax Credit or Credit for Other Dependents, but TaxVault does not verify every IRS dependency or custody rule.";
}

function goToStep(step) {
  if (step === 2 && state.currentStep === 1) {
    const validation = validateStep1();
    if (validation.messages.length > 0) {
      showError(validation.messages, validation.fieldErrors);
      return;
    }
  }

  hideError();
  state.currentStep = step;

  document.querySelectorAll(".step-section").forEach((section) => {
    section.classList.toggle("active", section.id === `step${step}`);
  });

  const showOnboarding = step === 1;
  document.querySelectorAll(".welcome-panel, .notice-card, .trust-panel").forEach((panel) => {
    panel.classList.toggle("hidden", !showOnboarding);
  });

  updateStepIndicator();

  if (step === 2) {
    refreshSupportReview();
  }

  scheduleDraftSave();

  if (typeof window.scrollTo === "function") {
    const motion = window.matchMedia("(prefers-reduced-motion: reduce)").matches
      ? "instant"
      : "smooth";
    window.scrollTo({ top: 0, behavior: motion });
  }
}

function updateStepIndicator() {
  for (let i = 1; i <= 3; i += 1) {
    const dot = document.getElementById(`dot${i}`);
    const label = document.getElementById(`lbl${i}`);
    const isDone = i < state.currentStep;
    const isActive = i === state.currentStep;

    dot.classList.toggle("done", isDone);
    dot.classList.toggle("active", isActive);
    label.classList.toggle("done", isDone);
    label.classList.toggle("active", isActive);
    if (isActive) {
      label.setAttribute("aria-current", "step");
    } else {
      label.removeAttribute("aria-current");
    }
    dot.textContent = isDone ? "✓" : String(i);
  }

  document.getElementById("line1").classList.toggle("done", state.currentStep > 1);
  document.getElementById("line2").classList.toggle("done", state.currentStep > 2);
}

function validateStep1() {
  const messages = [];
  const fieldErrors = [];
  const primary = readFilerInputs("p");
  let spouse = null;

  if (!primary.firstName) {
    messages.push("First name is required.");
    fieldErrors.push({ id: "pFirst", msg: "Required" });
  }
  if (!primary.lastName) {
    messages.push("Last name is required.");
    fieldErrors.push({ id: "pLast", msg: "Required" });
  }
  if (!primary.ssn) {
    messages.push("SSN is required.");
    fieldErrors.push({ id: "pSsn", msg: "Required" });
  } else if (!SSN_PATTERN.test(primary.ssn)) {
    messages.push("SSN must use the format 123-45-6789.");
    fieldErrors.push({ id: "pSsn", msg: "Format: 123-45-6789" });
  }
  if (!primary.dob) {
    messages.push("Date of birth is required.");
    fieldErrors.push({ id: "pDob", msg: "Required" });
  } else if (!isPastOrToday(primary.dob)) {
    messages.push("Date of birth must be a real date in the past.");
    fieldErrors.push({ id: "pDob", msg: "Must be a past date" });
  }

  if (state.filingStatus === "married_filing_jointly") {
    spouse = readFilerInputs("s");

    if (!spouse.firstName) {
      messages.push("Spouse first name is required.");
      fieldErrors.push({ id: "sFirst", msg: "Required" });
    }
    if (!spouse.lastName) {
      messages.push("Spouse last name is required.");
      fieldErrors.push({ id: "sLast", msg: "Required" });
    }
    if (!spouse.ssn) {
      messages.push("Spouse SSN is required.");
      fieldErrors.push({ id: "sSsn", msg: "Required" });
    } else if (!SSN_PATTERN.test(spouse.ssn)) {
      messages.push("Spouse SSN must use the format 123-45-6789.");
      fieldErrors.push({ id: "sSsn", msg: "Format: 123-45-6789" });
    }
    if (!spouse.dob) {
      messages.push("Spouse date of birth is required.");
      fieldErrors.push({ id: "sDob", msg: "Required" });
    } else if (!isPastOrToday(spouse.dob)) {
      messages.push("Spouse date of birth must be a real date in the past.");
      fieldErrors.push({ id: "sDob", msg: "Must be a past date" });
    }
  }

  const dependents = collectDependents(messages, {
    requireAtLeastOne: state.filingStatus === "head_of_household",
  });
  validateUniqueSsnEntries(messages, primary, spouse, dependents);

  if (messages.length === 0) {
    if (primary.isDependent || spouse?.isDependent) {
      messages.push(
        "TaxVault does not support filers who can be claimed as dependents on another return."
      );
    }

    if (state.filingStatus === "head_of_household") {
      messages.push(...collectHeadOfHouseholdStep1Issues(dependents));
    }
  }

  return { messages: dedupeMessages(messages), fieldErrors };
}

function readFilerInputs(prefix) {
  return {
    firstName: readTrimmedControlValue(document.getElementById(`${prefix}First`)),
    lastName: readTrimmedControlValue(document.getElementById(`${prefix}Last`)),
    ssn: readTrimmedControlValue(document.getElementById(`${prefix}Ssn`)),
    dob: readControlValue(document.getElementById(`${prefix}Dob`)),
    isBlind: Boolean(document.getElementById(`${prefix}Blind`)?.checked),
    isDependent: Boolean(document.getElementById(`${prefix}Dependent`)?.checked),
  };
}

function isSupportedHohQualifyingPersonCandidate(dependent) {
  const monthsLivedInHome = Number(
    dependent?.months_lived_in_home ?? dependent?.monthsLivedInHome ?? Number.NaN
  );

  return (
    Number.isFinite(monthsLivedInHome) &&
    monthsLivedInHome > 6 &&
    SUPPORTED_HOH_QUALIFYING_RELATIONSHIPS.has(dependent?.relationship)
  );
}

function collectHeadOfHouseholdStep1Issues(dependents) {
  if (!Array.isArray(dependents) || dependents.length === 0) {
    return [];
  }

  if (dependents.some(isSupportedHohQualifyingPersonCandidate)) {
    return [];
  }

  if (dependents.some((dependent) => dependent.relationship === "parent")) {
    return [
      "Head of Household with only a dependent parent is outside TaxVault's supported estimate slice. TaxVault does not collect the parent-home support facts needed to screen it.",
    ];
  }

  if (dependents.some((dependent) => dependent.relationship === "other")) {
    return [
      "Head of Household with only an 'other' dependent is outside TaxVault's supported estimate slice because TaxVault cannot determine a qualifying person from that relationship alone.",
    ];
  }

  return [
    "Head of Household requires a dependent TaxVault can screen who lived with you more than half the year.",
  ];
}

function showError(messages, fieldErrors = []) {
  const content = Array.isArray(messages) ? messages.join("\n") : String(messages);
  els.error.textContent = content;
  els.error.hidden = false;
  const motion = window.matchMedia("(prefers-reduced-motion: reduce)").matches
    ? "instant"
    : "smooth";

  clearFieldErrors();

  let firstInvalid = null;

  if (Array.isArray(fieldErrors) && fieldErrors.length > 0) {
    for (const { id, msg } of fieldErrors) {
      const input = document.getElementById(id);
      if (!input) {
        continue;
      }
      input.setAttribute("aria-invalid", "true");
      const hint = document.createElement("span");
      hint.className = "field-error-inline";
      hint.textContent = msg;
      const errorId = `${id}-error`;
      hint.id = errorId;
      input.setAttribute("aria-describedby", errorId);
      input.closest(".field")?.appendChild(hint);
      if (!firstInvalid) {
        firstInvalid = input;
      }
    }
  }

  if (firstInvalid) {
    firstInvalid.focus();
    firstInvalid.scrollIntoView({ behavior: motion, block: "center" });
  } else {
    els.error.scrollIntoView({ behavior: motion, block: "center" });
  }
}

function hideError() {
  els.error.hidden = true;
  els.error.textContent = "";
  clearFieldErrors();
}

function clearFieldErrors() {
  document.querySelectorAll(".field-error-inline").forEach((el) => el.remove());
  document.querySelectorAll('[aria-invalid="true"]').forEach((el) => {
    el.removeAttribute("aria-invalid");
    el.removeAttribute("aria-describedby");
  });
}

function fieldErrorId(control) {
  return control instanceof HTMLElement && control.id ? `${control.id}-error` : "";
}

function clearInlineErrorForControl(control) {
  if (!(control instanceof HTMLElement)) {
    return;
  }

  const errorId = fieldErrorId(control);
  if (!errorId) {
    return;
  }

  const error = document.getElementById(errorId);
  if (error?.classList.contains("field-error-inline")) {
    error.remove();
  }

  if (control.getAttribute("aria-describedby") === errorId) {
    control.removeAttribute("aria-describedby");
  }

  control.removeAttribute("aria-invalid");
}

function setInlineErrorForControl(control, message) {
  if (!(control instanceof HTMLElement)) {
    return;
  }

  clearInlineErrorForControl(control);

  if (!message) {
    return;
  }

  const field = control.closest(".field");
  const errorId = fieldErrorId(control);
  if (!field || !errorId) {
    return;
  }

  const hint = document.createElement("span");
  hint.className = "field-error-inline";
  hint.textContent = message;
  hint.id = errorId;
  field.appendChild(hint);
  control.setAttribute("aria-invalid", "true");
  control.setAttribute("aria-describedby", errorId);
}

function isBlankCard(card, selectors) {
  return selectors.every((selector) => readTrimmedQueryValue(card, selector) === "");
}

function isBlankW2Card(card) {
  return isBlankCard(card, [
    ".w2-employer",
    ".w2-ein",
    ".w2-wages",
    ".w2-fed-wh",
    ".w2-state-wh",
    ".w2-ss-wages",
    ".w2-ss-wh",
    ".w2-med-wages",
    ".w2-med-wh",
  ]);
}

function isBlankDependentCard(card) {
  return isBlankCard(card, [
    ".dep-first",
    ".dep-last",
    ".dep-ssn",
    ".dep-dob",
    ".dep-relationship",
    ".dep-months",
  ]);
}

function isBlankInterestCard(card) {
  return isBlankCard(card, [".interest-payer", ".interest-taxable", ".interest-tax-exempt"]);
}

function isBlankSocialSecurityCard(card) {
  return isBlankCard(card, [".ssa-benefits", ".ssa-withholding"]);
}

function isBlankDividendCard(card) {
  return isBlankCard(card, [".dividend-payer", ".dividend-ordinary", ".dividend-qualified"]);
}

function validateRequiredTextValue(value) {
  return value ? "" : "Required";
}

function validateSsnValue(value) {
  if (!value) {
    return "Required";
  }

  return SSN_PATTERN.test(value) ? "" : "Format: 123-45-6789";
}

function validateDateValue(value) {
  if (!value) {
    return "Required";
  }

  return isPastOrToday(value) ? "" : "Must be a past date";
}

function validateNonNegativeMoneyValue(rawValue) {
  const value = parseMoney(rawValue, 0);
  return Number.isFinite(value) && value >= 0 ? "" : "Must be 0 or greater";
}

function validatePositiveMoneyValue(rawValue) {
  const value = parseMoney(rawValue);
  return Number.isFinite(value) && value > 0 ? "" : "Must be greater than 0";
}

function getInlineFieldValidationMessage(control) {
  if (
    !(control instanceof HTMLInputElement || control instanceof HTMLSelectElement || control instanceof HTMLTextAreaElement)
    || control.disabled
    || control.type === "hidden"
    || control.type === "file"
  ) {
    return "";
  }

  const value = readTrimmedControlValue(control);
  const id = control.id;

  switch (id) {
    case "pFirst":
    case "pLast":
      return validateRequiredTextValue(value);
    case "pSsn":
      return validateSsnValue(value);
    case "pDob":
      return validateDateValue(readControlValue(control));
    case "sFirst":
    case "sLast":
      return state.filingStatus === "married_filing_jointly" ? validateRequiredTextValue(value) : "";
    case "sSsn":
      return state.filingStatus === "married_filing_jointly" ? validateSsnValue(value) : "";
    case "sDob":
      return state.filingStatus === "married_filing_jointly" ? validateDateValue(readControlValue(control)) : "";
    case "traditionalIraDeduction":
    case "hsaDeduction":
    case "studentLoanInterestPaid":
    case "estimatedTaxPayments":
      return validateNonNegativeMoneyValue(value);
    default:
      break;
  }

  const card = control.closest(".w2-card, .ssa-card, .interest-card, .dividend-card, .dependent-card");
  const isActualW2Card = Boolean(
    card?.classList.contains("w2-card")
    && !card.classList.contains("ssa-card")
    && !card.classList.contains("interest-card")
    && !card.classList.contains("dividend-card")
  );

  if (card?.classList.contains("dependent-card")) {
    if (isBlankDependentCard(card)) {
      return "";
    }

    if (control.classList.contains("dep-first") || control.classList.contains("dep-last")) {
      return validateRequiredTextValue(value);
    }

    if (control.classList.contains("dep-ssn")) {
      return validateSsnValue(value);
    }

    if (control.classList.contains("dep-dob")) {
      return validateDateValue(readControlValue(control));
    }

    if (control.classList.contains("dep-relationship")) {
      return value ? "" : "Required";
    }

    if (control.classList.contains("dep-months")) {
      const months = value === "" ? Number.NaN : Number(value);
      return Number.isInteger(months) && months >= 0 && months <= 12
        ? ""
        : "Enter 0-12";
    }
  }

  if (isActualW2Card) {
    if (isBlankW2Card(card)) {
      return "";
    }

    if (control.classList.contains("w2-employer")) {
      return validateRequiredTextValue(value);
    }

    if (control.classList.contains("w2-ein")) {
      if (!value) {
        return "Required";
      }
      return EIN_PATTERN.test(value) ? "" : "Format: 12-3456789";
    }

    if (control.classList.contains("w2-wages")) {
      return validatePositiveMoneyValue(value);
    }

    if (
      control.classList.contains("w2-fed-wh")
      || control.classList.contains("w2-state-wh")
      || control.classList.contains("w2-ss-wh")
      || control.classList.contains("w2-med-wh")
    ) {
      const baseError = validateNonNegativeMoneyValue(value);
      if (baseError) {
        return baseError;
      }
    }

    if (control.classList.contains("w2-ss-wages") || control.classList.contains("w2-med-wages")) {
      if (value === "") {
        return "";
      }
      const baseError = validateNonNegativeMoneyValue(value);
      if (baseError) {
        return baseError;
      }
    }

    const wages = parseMoney(readTrimmedQueryValue(card, ".w2-wages"));
    const federalTaxWithheld = parseMoney(readTrimmedQueryValue(card, ".w2-fed-wh"), 0);
    const socialSecurityWagesRaw = readTrimmedQueryValue(card, ".w2-ss-wages");
    const socialSecurityWages =
      socialSecurityWagesRaw === "" ? wages : parseMoney(socialSecurityWagesRaw);
    const socialSecurityTaxWithheld = parseMoney(readTrimmedQueryValue(card, ".w2-ss-wh"), 0);
    const medicareWagesRaw = readTrimmedQueryValue(card, ".w2-med-wages");
    const medicareWages = medicareWagesRaw === "" ? wages : parseMoney(medicareWagesRaw);
    const medicareTaxWithheld = parseMoney(readTrimmedQueryValue(card, ".w2-med-wh"), 0);

    if (
      control.classList.contains("w2-fed-wh")
      && Number.isFinite(wages)
      && Number.isFinite(federalTaxWithheld)
      && federalTaxWithheld > wages
    ) {
      return "Cannot exceed wages";
    }

    if (
      (control.classList.contains("w2-ss-wages") || control.classList.contains("w2-ss-wh"))
      && Number.isFinite(socialSecurityWages)
      && Number.isFinite(socialSecurityTaxWithheld)
      && socialSecurityTaxWithheld > socialSecurityWages
    ) {
      return "Withholding cannot exceed SS wages";
    }

    if (
      (control.classList.contains("w2-med-wages") || control.classList.contains("w2-med-wh"))
      && Number.isFinite(medicareWages)
      && Number.isFinite(medicareTaxWithheld)
      && medicareTaxWithheld > medicareWages
    ) {
      return "Withholding cannot exceed Medicare wages";
    }
  }

  if (card?.classList.contains("interest-card")) {
    if (isBlankInterestCard(card)) {
      return "";
    }

    if (control.classList.contains("interest-taxable") || control.classList.contains("interest-tax-exempt")) {
      const baseError = validateNonNegativeMoneyValue(value);
      if (baseError) {
        return baseError;
      }

      const taxableInterest = parseMoney(readTrimmedQueryValue(card, ".interest-taxable"), 0);
      const taxExemptInterest = parseMoney(readTrimmedQueryValue(card, ".interest-tax-exempt"), 0);
      if (Number.isFinite(taxableInterest) && Number.isFinite(taxExemptInterest) && taxableInterest === 0 && taxExemptInterest === 0) {
        return "Enter taxable or tax-exempt interest";
      }
    }
  }

  if (card?.classList.contains("ssa-card")) {
    if (isBlankSocialSecurityCard(card)) {
      return "";
    }

    if (control.classList.contains("ssa-benefits")) {
      const baseError = validatePositiveMoneyValue(value);
      if (baseError) {
        return baseError;
      }
    }

    if (control.classList.contains("ssa-withholding")) {
      const baseError = validateNonNegativeMoneyValue(value);
      if (baseError) {
        return baseError;
      }
    }

    const totalBenefits = parseMoney(readTrimmedQueryValue(card, ".ssa-benefits"));
    const voluntaryWithholding = parseMoney(readTrimmedQueryValue(card, ".ssa-withholding"), 0);
    if (
      control.classList.contains("ssa-withholding")
      && Number.isFinite(totalBenefits)
      && Number.isFinite(voluntaryWithholding)
      && voluntaryWithholding > totalBenefits
    ) {
      return "Cannot exceed total benefits";
    }
  }

  if (card?.classList.contains("dividend-card")) {
    if (isBlankDividendCard(card)) {
      return "";
    }

    if (control.classList.contains("dividend-ordinary") || control.classList.contains("dividend-qualified")) {
      const baseError = validateNonNegativeMoneyValue(value);
      if (baseError) {
        return baseError;
      }

      const ordinaryDividends = parseMoney(readTrimmedQueryValue(card, ".dividend-ordinary"), 0);
      const qualifiedDividends = parseMoney(readTrimmedQueryValue(card, ".dividend-qualified"), 0);

      if (
        Number.isFinite(ordinaryDividends)
        && Number.isFinite(qualifiedDividends)
        && ordinaryDividends === 0
        && qualifiedDividends === 0
      ) {
        return "Enter ordinary or qualified dividends";
      }

      if (
        control.classList.contains("dividend-qualified")
        && Number.isFinite(ordinaryDividends)
        && Number.isFinite(qualifiedDividends)
        && qualifiedDividends > ordinaryDividends
      ) {
        return "Cannot exceed ordinary dividends";
      }
    }
  }

  return "";
}

function handleAppFieldBlur(event) {
  const target = event.target;
  if (!(target instanceof HTMLElement) || !els.app.contains(target)) {
    return;
  }

  const message = getInlineFieldValidationMessage(target);
  setInlineErrorForControl(target, message);
}

function renderLoadingError(message) {
  els.loading.replaceChildren(
    createElement("div", { className: "error-banner", text: message })
  );
}

function canAddCard(container, maxCount, label) {
  if (container.children.length < maxCount) {
    return true;
  }

  showError(`TaxVault currently supports up to ${maxCount} ${label} per draft.`);
  announceUiStatus(`Maximum reached for ${label}.`);
  return false;
}

function createCardSection(className, index) {
  const card = document.createElement("section");
  card.className = className;
  card.dataset.index = String(index);
  return card;
}

function createButtonElement({
  className = "",
  text = "",
  type = "button",
  attributes = {},
} = {}) {
  return createElement("button", {
    className,
    text,
    attributes: { type, ...attributes },
  });
}

function appendSelectOptions(select, options) {
  options.forEach(({ value, label }) => {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = label;
    select.append(option);
  });

  return select;
}

function createInputControl({
  id,
  className = "",
  type = "text",
  placeholder = "",
  inputmode,
  autocomplete,
  maxlength,
  min,
  max,
  step,
  attributes = {},
} = {}) {
  return createElement("input", {
    className,
    attributes: {
      id,
      type,
      placeholder,
      inputmode,
      autocomplete,
      maxlength,
      min,
      max,
      step,
      ...attributes,
    },
  });
}

function createSelectControl({ id, className = "", options = [] } = {}) {
  const select = createElement("select", {
    className,
    attributes: { id },
  });
  return appendSelectOptions(select, options);
}

function createRow(...children) {
  const row = createElement("div", { className: "row" });
  row.append(...children);
  return row;
}

function createField(labelText, control, { controlId = control.id } = {}) {
  const field = createElement("div", { className: "field" });
  const label = createElement("label", { text: labelText });

  if (controlId) {
    label.htmlFor = controlId;
  }

  field.append(label, control);
  return field;
}

function createRecipientOptions() {
  const options = [{ value: "primary", label: "Primary Filer" }];

  if (state.filingStatus === "married_filing_jointly") {
    options.push({ value: "spouse", label: "Spouse" });
  }

  return options;
}

function createRecipientSelect(id, className) {
  return createSelectControl({
    id,
    className,
    options: createRecipientOptions(),
  });
}

function createMoneyInput({ id, className, placeholder }) {
  return createInputControl({
    id,
    className,
    type: "text",
    inputmode: "decimal",
    autocomplete: "off",
    placeholder,
  });
}

function createCardHeader(title, { clearButtonClass = "", removeButtonClass } = {}) {
  const header = createElement("div", { className: "w2-card-header" });
  const actions = createElement("div", { className: "w2-card-actions" });

  if (clearButtonClass) {
    actions.append(
      createButtonElement({
        className: `btn-ghost btn-ghost-neutral ${clearButtonClass}`,
        text: "Clear fields",
      })
    );
  }

  actions.append(
    createButtonElement({
      className: `btn-ghost btn-ghost-danger ${removeButtonClass}`,
      text: "Remove",
    })
  );
  header.append(createElement("h3", { text: title }), actions);
  return header;
}

function clearCardFieldErrors(root) {
  if (!(root instanceof HTMLElement)) {
    return;
  }

  root.querySelectorAll(".field-error-inline").forEach((el) => el.remove());
  root.querySelectorAll('[aria-invalid="true"]').forEach((el) => {
    el.removeAttribute("aria-invalid");
    el.removeAttribute("aria-describedby");
  });
}

function resetCardControls(card) {
  if (!(card instanceof HTMLElement)) {
    return;
  }

  clearCardFieldErrors(card);

  card.querySelectorAll('input:not([type="file"]), select, textarea').forEach((control) => {
    if (!(control instanceof HTMLInputElement || control instanceof HTMLSelectElement || control instanceof HTMLTextAreaElement)) {
      return;
    }

    if (control.closest(".upload-zone-wrapper")) {
      return;
    }

    if (control instanceof HTMLInputElement && (control.type === "checkbox" || control.type === "radio")) {
      control.checked = false;
      return;
    }

    if (control instanceof HTMLSelectElement) {
      control.selectedIndex = 0;
      return;
    }

    control.value = "";
  });
}

function clearCardFields(card, { label, focusSelector, closeAdvanced = false } = {}) {
  if (!(card instanceof HTMLElement)) {
    return;
  }

  resetCardControls(card);
  hideError();

  if (closeAdvanced && card.querySelector(".w2-advanced-fields")?.classList.contains("open")) {
    toggleAdvanced(card);
  }

  resetComputedEstimate();
  scheduleSupportReview();
  scheduleDraftSave();
  announceUiStatus(`Cleared ${label} fields.`);
  focusFirstField(card, focusSelector);
}

function createSsnField(inputId, inputClass) {
  const wrapper = createElement("div", { className: "ssn-field" });
  const input = createInputControl({
    id: inputId,
    className: inputClass,
    type: "password",
    inputmode: "numeric",
    autocomplete: "off",
    maxlength: 11,
    placeholder: "123-45-6789",
  });
  const toggle = createButtonElement({
    className: "ssn-toggle",
    text: "Show",
    attributes: {
      "aria-controls": inputId,
      "aria-pressed": "false",
    },
  });

  wrapper.append(input, toggle);
  return wrapper;
}

function addW2({ focusNewCard = true, batched = false } = {}) {
  if (!canAddCard(els.w2Container, MAX_W2_FORMS, "W-2 forms")) {
    return null;
  }

  state.w2Count += 1;
  const idPrefix = `w2-${state.w2Count}`;
  const card = createCardSection("w2-card", state.w2Count);
  const essential = createElement("div", { className: "w2-essential" });
  essential.append(
    createRow(
      createField(
        "Employer Name",
        createInputControl({
          id: `${idPrefix}-employer`,
          className: "w2-employer",
          placeholder: "Company Inc.",
          maxlength: MAX_TEXT_FIELD_LENGTH,
        })
      ),
      createField(
        "Recipient",
        createRecipientSelect(`${idPrefix}-recipient`, "w2-recipient income-recipient")
      )
    ),
    createRow(
      createField(
        "Employer EIN",
        createInputControl({
          id: `${idPrefix}-ein`,
          className: "w2-ein",
          inputmode: "numeric",
          maxlength: 10,
          placeholder: "12-3456789",
        })
      ),
      createField(
        "Federal Tax Withheld (Box 2)",
        createMoneyInput({
          id: `${idPrefix}-fed-wh`,
          className: "w2-fed-wh money-input",
          placeholder: "0.00",
        })
      )
    ),
    createRow(
      createField(
        "Wages (Box 1)",
        createMoneyInput({
          id: `${idPrefix}-wages`,
          className: "w2-wages money-input",
          placeholder: "0.00",
        })
      ),
      createField(
        "State Tax Withheld (Box 17)",
        createMoneyInput({
          id: `${idPrefix}-state-wh`,
          className: "w2-state-wh money-input",
          placeholder: "0.00",
        })
      )
    )
  );

  const advancedToggle = createButtonElement({
    className: "w2-advanced-toggle",
    attributes: { "aria-expanded": "false" },
  });
  const arrow = createElement("span", {
    className: "arrow",
    attributes: { "aria-hidden": "true" },
  });
  arrow.textContent = String.fromCharCode(9654);
  advancedToggle.append(arrow, document.createTextNode(" Additional W-2 fields"));

  const advancedFields = createElement("div", { className: "w2-advanced-fields" });
  advancedFields.append(
    createRow(
      createField(
        "SS Wages (Box 3)",
        createMoneyInput({
          id: `${idPrefix}-ss-wages`,
          className: "w2-ss-wages money-input",
          placeholder: "Same as wages",
        })
      ),
      createField(
        "SS Tax Withheld (Box 4)",
        createMoneyInput({
          id: `${idPrefix}-ss-wh`,
          className: "w2-ss-wh money-input",
          placeholder: "0.00",
        })
      )
    ),
    createRow(
      createField(
        "Medicare Wages (Box 5)",
        createMoneyInput({
          id: `${idPrefix}-med-wages`,
          className: "w2-med-wages money-input",
          placeholder: "Same as wages",
        })
      ),
      createField(
        "Medicare Tax (Box 6)",
        createMoneyInput({
          id: `${idPrefix}-med-wh`,
          className: "w2-med-wh money-input",
          placeholder: "0.00",
        })
      )
    )
  );

  const advanced = createElement("div", { className: "w2-advanced" });
  advanced.append(advancedToggle, advancedFields);

  card.append(
    createCardHeader(`W-2 #${state.w2Count}`, {
      clearButtonClass: "clear-w2-btn",
      removeButtonClass: "remove-w2-btn",
    }),
    createReferenceZone("W-2"),
    essential,
    advanced
  );

  card.querySelector(".remove-w2-btn").addEventListener("click", () => removeW2(card));
  card
    .querySelector(".clear-w2-btn")
    .addEventListener("click", () =>
      clearCardFields(card, {
        label: "W-2",
        focusSelector: ".w2-employer",
        closeAdvanced: true,
      })
    );
  card.querySelector(".w2-advanced-toggle").addEventListener("click", () => toggleAdvanced(card));
  card.querySelector(".w2-ein").addEventListener("input", (event) => {
    event.target.value = formatDigits(event.target.value, [2, 7]);
  });
  bindMoneyFields(card);

  els.w2Container.append(card);
  updateRemoveButtons();
  if (!batched) {
    renderIncomeSummaryChips();
    resetComputedEstimate();
    scheduleSupportReview();
    scheduleDraftSave();
    announceUiStatus(`Added W-2 #${state.w2Count}.`);
  }
  if (focusNewCard && !batched) {
    focusFirstField(card, ".w2-employer");
  }

  return card;
}

function addSocialSecurity({ focusNewCard = true, batched = false } = {}) {
  if (!canAddCard(els.socialSecurityContainer, MAX_SOCIAL_SECURITY_FORMS, "SSA-1099 forms")) {
    return null;
  }

  state.socialSecurityCount += 1;
  const idPrefix = `ssa-${state.socialSecurityCount}`;
  const card = createCardSection("w2-card ssa-card", state.socialSecurityCount);
  card.append(
    createCardHeader(`SSA-1099 #${state.socialSecurityCount}`, {
      clearButtonClass: "clear-ssa-btn",
      removeButtonClass: "remove-ssa-btn",
    }),
    createReferenceZone("SSA-1099"),
    createRow(
      createField(
        "Recipient",
        createRecipientSelect(`${idPrefix}-recipient`, "income-recipient ssa-recipient")
      ),
      createField(
        "Total Benefits (Box 5)",
        createMoneyInput({
          id: `${idPrefix}-benefits`,
          className: "ssa-benefits money-input",
          placeholder: "0.00",
        })
      )
    ),
    createRow(
      createField(
        "Voluntary Federal Tax Withheld (Box 6)",
        createMoneyInput({
          id: `${idPrefix}-withholding`,
          className: "ssa-withholding money-input",
          placeholder: "0.00",
        })
      )
    )
  );

  card.querySelector(".remove-ssa-btn").addEventListener("click", () => removeSocialSecurity(card));
  card
    .querySelector(".clear-ssa-btn")
    .addEventListener("click", () =>
      clearCardFields(card, {
        label: "SSA-1099",
        focusSelector: ".ssa-benefits",
      })
    );
  bindMoneyFields(card);

  els.socialSecurityContainer.append(card);
  updateSocialSecurityRemoveButtons();
  if (!batched) {
    renderIncomeSummaryChips();
    resetComputedEstimate();
    scheduleSupportReview();
    scheduleDraftSave();
    announceUiStatus(`Added SSA-1099 #${state.socialSecurityCount}.`);
  }
  if (focusNewCard && !batched) {
    focusFirstField(card, ".ssa-benefits");
  }

  return card;
}

function addInterest({ focusNewCard = true, batched = false } = {}) {
  if (!canAddCard(els.interestContainer, MAX_INTEREST_FORMS, "1099-INT forms")) {
    return null;
  }

  state.interestCount += 1;
  const idPrefix = `int-${state.interestCount}`;
  const card = createCardSection("w2-card interest-card", state.interestCount);
  card.append(
    createCardHeader(`1099-INT #${state.interestCount}`, {
      clearButtonClass: "clear-interest-btn",
      removeButtonClass: "remove-interest-btn",
    }),
    createReferenceZone("1099-INT"),
    createRow(
      createField(
        "Institution Name (Optional)",
        createInputControl({
          id: `${idPrefix}-payer`,
          className: "interest-payer",
          placeholder: "Summit Bank",
          maxlength: MAX_TEXT_FIELD_LENGTH,
        })
      ),
      createField(
        "Recipient",
        createRecipientSelect(`${idPrefix}-recipient`, "income-recipient interest-recipient")
      )
    ),
    createRow(
      createField(
        "Taxable Interest (Box 1)",
        createMoneyInput({
          id: `${idPrefix}-taxable`,
          className: "interest-taxable money-input",
          placeholder: "0.00",
        })
      ),
      createField(
        "Tax-Exempt Interest (Box 8)",
        createMoneyInput({
          id: `${idPrefix}-tax-exempt`,
          className: "interest-tax-exempt money-input",
          placeholder: "0.00",
        })
      )
    )
  );

  card
    .querySelector(".remove-interest-btn")
    .addEventListener("click", () => removeInterest(card));
  card
    .querySelector(".clear-interest-btn")
    .addEventListener("click", () =>
      clearCardFields(card, {
        label: "1099-INT",
        focusSelector: ".interest-taxable",
      })
    );
  bindMoneyFields(card);

  els.interestContainer.append(card);
  updateInterestRemoveButtons();
  if (!batched) {
    renderIncomeSummaryChips();
    resetComputedEstimate();
    scheduleSupportReview();
    scheduleDraftSave();
    announceUiStatus(`Added 1099-INT #${state.interestCount}.`);
  }
  if (focusNewCard && !batched) {
    focusFirstField(card, ".interest-taxable");
  }

  return card;
}

function addDividend({ focusNewCard = true, batched = false } = {}) {
  if (!canAddCard(els.dividendContainer, MAX_DIVIDEND_FORMS, "1099-DIV forms")) {
    return null;
  }

  state.dividendCount += 1;
  const idPrefix = `div-${state.dividendCount}`;
  const card = createCardSection("w2-card dividend-card", state.dividendCount);
  card.append(
    createCardHeader(`1099-DIV #${state.dividendCount}`, {
      clearButtonClass: "clear-dividend-btn",
      removeButtonClass: "remove-dividend-btn",
    }),
    createReferenceZone("1099-DIV"),
    createRow(
      createField(
        "Institution Name (Optional)",
        createInputControl({
          id: `${idPrefix}-payer`,
          className: "dividend-payer",
          placeholder: "North Brokerage",
          maxlength: MAX_TEXT_FIELD_LENGTH,
        })
      ),
      createField(
        "Recipient",
        createRecipientSelect(`${idPrefix}-recipient`, "income-recipient dividend-recipient")
      )
    ),
    createRow(
      createField(
        "Ordinary Dividends (Box 1a)",
        createMoneyInput({
          id: `${idPrefix}-ordinary`,
          className: "dividend-ordinary money-input",
          placeholder: "0.00",
        })
      ),
      createField(
        "Qualified Dividends (Box 1b)",
        createMoneyInput({
          id: `${idPrefix}-qualified`,
          className: "dividend-qualified money-input",
          placeholder: "0.00",
        })
      )
    )
  );

  card
    .querySelector(".remove-dividend-btn")
    .addEventListener("click", () => removeDividend(card));
  card
    .querySelector(".clear-dividend-btn")
    .addEventListener("click", () =>
      clearCardFields(card, {
        label: "1099-DIV",
        focusSelector: ".dividend-ordinary",
      })
    );
  bindMoneyFields(card);

  els.dividendContainer.append(card);
  updateDividendRemoveButtons();
  if (!batched) {
    renderIncomeSummaryChips();
    resetComputedEstimate();
    scheduleSupportReview();
    scheduleDraftSave();
    announceUiStatus(`Added 1099-DIV #${state.dividendCount}.`);
  }
  if (focusNewCard && !batched) {
    focusFirstField(card, ".dividend-ordinary");
  }

  return card;
}

function addDependent({ focusNewCard = true, batched = false } = {}) {
  if (!canAddCard(els.dependentContainer, MAX_DEPENDENTS, "dependents")) {
    return null;
  }

  state.dependentCount += 1;
  const idPrefix = `dep-${state.dependentCount}`;
  const card = createCardSection("dependent-card", state.dependentCount);
  card.append(
    createCardHeader(`Dependent #${state.dependentCount}`, {
      clearButtonClass: "clear-dependent-btn",
      removeButtonClass: "remove-dependent-btn",
    }),
    createRow(
      createField(
        "First Name",
        createInputControl({
          id: `${idPrefix}-first`,
          className: "dep-first",
          placeholder: "Jamie",
          maxlength: MAX_TEXT_FIELD_LENGTH,
        })
      ),
      createField(
        "Last Name",
        createInputControl({
          id: `${idPrefix}-last`,
          className: "dep-last",
          placeholder: "Doe",
          maxlength: MAX_TEXT_FIELD_LENGTH,
        })
      )
    ),
    createRow(
      createField(
        "Social Security Number",
        createSsnField(`${idPrefix}-ssn`, "dep-ssn ssn-input"),
        { controlId: `${idPrefix}-ssn` }
      ),
      createField(
        "Date of Birth",
        createInputControl({
          id: `${idPrefix}-dob`,
          className: "dep-dob",
          type: "date",
          min: DATE_INPUT_MIN,
          max: todayIsoDate(),
          attributes: { "data-date-kind": "dob" },
        })
      )
    ),
    createRow(
      createField(
        "Relationship",
        createSelectControl({
          id: `${idPrefix}-relationship`,
          className: "dep-relationship",
          options: DEPENDENT_RELATIONSHIP_OPTIONS,
        })
      ),
      createField(
        "Months Lived in Home",
        createInputControl({
          id: `${idPrefix}-months`,
          className: "dep-months",
          type: "number",
          min: 0,
          max: 12,
          step: 1,
          placeholder: "12",
        })
      )
    )
  );

  card.querySelector(".remove-dependent-btn").addEventListener("click", () => removeDependent(card));
  card
    .querySelector(".clear-dependent-btn")
    .addEventListener("click", () =>
      clearCardFields(card, {
        label: "dependent",
        focusSelector: ".dep-first",
      })
    );
  bindSsnFields(card);
  applyDateConstraints(card);

  els.dependentContainer.append(card);
  updateDependentRemoveButtons();
  if (!batched) {
    resetComputedEstimate();
    scheduleDraftSave();
    announceUiStatus(`Added dependent #${state.dependentCount}.`);
  }
  if (focusNewCard && !batched) {
    focusFirstField(card, ".dep-first");
  }

  return card;
}

function removeW2(card) {
  const focusTarget = nextFocusTargetAfterRemoval(card, els.addW2Btn);
  cleanupReferencePreviews(card);
  card.remove();
  updateRemoveButtons();
  renderIncomeSummaryChips();
  resetComputedEstimate();
  scheduleSupportReview();
  scheduleDraftSave();
  focusElement(focusTarget);
  announceUiStatus("Removed W-2 form.");
}

function removeInterest(card) {
  const focusTarget = nextFocusTargetAfterRemoval(card, els.addInterestBtn);
  cleanupReferencePreviews(card);
  card.remove();
  updateInterestRemoveButtons();
  renderIncomeSummaryChips();
  resetComputedEstimate();
  scheduleSupportReview();
  scheduleDraftSave();
  focusElement(focusTarget);
  announceUiStatus("Removed 1099-INT form.");
}

function removeSocialSecurity(card) {
  const focusTarget = nextFocusTargetAfterRemoval(card, els.addSocialSecurityBtn);
  cleanupReferencePreviews(card);
  card.remove();
  updateSocialSecurityRemoveButtons();
  renderIncomeSummaryChips();
  resetComputedEstimate();
  scheduleSupportReview();
  scheduleDraftSave();
  focusElement(focusTarget);
  announceUiStatus("Removed SSA-1099 form.");
}

function removeDividend(card) {
  const focusTarget = nextFocusTargetAfterRemoval(card, els.addDividendBtn);
  cleanupReferencePreviews(card);
  card.remove();
  updateDividendRemoveButtons();
  renderIncomeSummaryChips();
  resetComputedEstimate();
  scheduleSupportReview();
  scheduleDraftSave();
  focusElement(focusTarget);
  announceUiStatus("Removed 1099-DIV form.");
}

function removeDependent(card) {
  const focusTarget = nextFocusTargetAfterRemoval(card, els.addDependentBtn);
  card.remove();
  updateDependentRemoveButtons();
  resetComputedEstimate();
  scheduleDraftSave();
  focusElement(focusTarget);
  announceUiStatus("Removed dependent.");
}

function setRemoveButtonsState(container, cardSelector, buttonSelector, disabled = false) {
  container.querySelectorAll(cardSelector).forEach((card) => {
    const button = card.querySelector(buttonSelector);
    if (!button) {
      return;
    }

    button.disabled = disabled;
    button.setAttribute("aria-disabled", String(disabled));
  });
}

function updateRemoveButtons() {
  setRemoveButtonsState(els.w2Container, ".w2-card", ".remove-w2-btn");
}

function updateInterestRemoveButtons() {
  setRemoveButtonsState(els.interestContainer, ".interest-card", ".remove-interest-btn");
}

function updateSocialSecurityRemoveButtons() {
  setRemoveButtonsState(els.socialSecurityContainer, ".ssa-card", ".remove-ssa-btn");
}

function updateDividendRemoveButtons() {
  setRemoveButtonsState(els.dividendContainer, ".dividend-card", ".remove-dividend-btn");
}

function updateDependentRemoveButtons() {
  const disableRemove =
    els.dependentContainer.querySelectorAll(".dependent-card").length <= 1 &&
    state.filingStatus === "head_of_household";

  setRemoveButtonsState(
    els.dependentContainer,
    ".dependent-card",
    ".remove-dependent-btn",
    disableRemove
  );
}

function toggleAdvanced(card) {
  const button = card.querySelector(".w2-advanced-toggle");
  const fields = card.querySelector(".w2-advanced-fields");
  const arrow = card.querySelector(".w2-advanced-toggle .arrow");
  const nextState = !fields.classList.contains("open");

  fields.classList.toggle("open", nextState);
  arrow.classList.toggle("open", nextState);
  button.setAttribute("aria-expanded", String(nextState));
}

function toggleLines() {
  const open = !els.linesContainer.classList.contains("open");
  els.linesContainer.classList.toggle("open", open);
  els.linesArrow.classList.toggle("open", open);
  els.linesToggle.setAttribute("aria-expanded", String(open));
}

function toggleTrace() {
  const open = !els.traceContainer.classList.contains("open");
  els.traceContainer.classList.toggle("open", open);
  els.traceArrow.classList.toggle("open", open);
  els.traceToggle.setAttribute("aria-expanded", String(open));
}

function handleAppFieldMutation(event) {
  if (!(event.target instanceof HTMLElement)) {
    return;
  }

  clearInlineErrorForControl(event.target);

  if (event.target.closest("#step1, #step2")) {
    resetComputedEstimate();
  }

  if (event.target.classList.contains("money-input")) {
    event.target.setAttribute("aria-invalid", "false");
  }

  scheduleDraftSave();

  if (state.currentStep !== 2 || !event.target.closest("#step2")) {
    return;
  }

  scheduleSupportReview();
}

function scheduleSupportReview() {
  if (state.currentStep !== 2) {
    return;
  }

  window.clearTimeout(supportReviewTimer);
  els.supportReviewCard.setAttribute("aria-busy", "true");
  supportReviewTimer = window.setTimeout(() => {
    refreshSupportReview();
    els.supportReviewCard.removeAttribute("aria-busy");
  }, 800);
}

function refreshSupportReview() {
  if (state.currentStep !== 2) {
    return;
  }

  if (!state.wasmReady) {
    renderSupportReviewPending("Loading the tax engine so TaxVault can review this draft.");
    return;
  }

  const { payload, errors } = buildPayload();
  const blockingIssues = dedupeMessages(errors);

  if (blockingIssues.length > 0) {
    if (
      blockingIssues.length === 1 &&
      blockingIssues[0] === "Add at least one W-2, SSA-1099, 1099-INT, or 1099-DIV before calculating."
    ) {
      renderSupportReviewPending(SUPPORT_REVIEW_DEFAULT_SUMMARY);
      return;
    }

    renderSupportReview({
      status: "attention",
      summary: "Finish the items below before calculating.",
      blocking_issues: blockingIssues,
      cautions: [],
    });
    return;
  }

  try {
    const review = JSON.parse(review_tax_input(JSON.stringify(payload)));
    if (!review || typeof review !== "object" || Array.isArray(review)) {
      throw new Error("Support review returned an unexpected payload shape.");
    }

    renderSupportReview(review);
  } catch (error) {
    renderSupportReview({
      status: "attention",
      summary: "TaxVault could not review this draft right now.",
      blocking_issues: [`Support review error: ${safeMessage(error)}`],
      cautions: [],
    });
  }
}

function resetSupportReview() {
  window.clearTimeout(supportReviewTimer);
  renderSupportReviewPending(SUPPORT_REVIEW_DEFAULT_SUMMARY);
}

function syncComputeButtonState() {
  els.computeBtn.disabled = !(state.wasmReady && state.supportReviewReadyForEstimate);
  els.computeBtn.setAttribute("aria-disabled", String(els.computeBtn.disabled));
  updateComputeHelpText();
}

function renderSupportReviewPending(summary) {
  const normalizedReview = normalizeSupportReviewSnapshot({
    status: "pending",
    readyForEstimate: false,
    summary,
    blockingIssues: [],
    cautions: [],
  });

  state.supportReviewReadyForEstimate = false;
  state.lastSupportReview = normalizedReview;
  els.supportReviewCard.dataset.status = "pending";
  els.supportReviewSummary.textContent = normalizedReview.summary;
  els.supportReviewBadge.className = "support-review-badge pending";
  els.supportReviewBadge.textContent = "In Progress";
  setSupportReviewItems(els.supportReviewIssuesSection, els.supportReviewIssues, []);
  setSupportReviewItems(els.supportReviewCautionsSection, els.supportReviewCautions, []);
  syncComputeButtonState();
}

function renderSupportReview(review) {
  const normalizedReview = normalizeSupportReviewSnapshot(review);
  const status = normalizedReview.status;

  state.supportReviewReadyForEstimate = normalizedReview.readyForEstimate;
  state.lastSupportReview = normalizedReview;

  els.supportReviewCard.dataset.status = status;
  els.supportReviewSummary.textContent = normalizedReview.summary;
  els.supportReviewBadge.className = `support-review-badge ${status}`;
  els.supportReviewBadge.textContent = supportReviewBadgeLabel(status);
  setSupportReviewItems(
    els.supportReviewIssuesSection,
    els.supportReviewIssues,
    normalizedReview.blockingIssues
  );
  setSupportReviewItems(
    els.supportReviewCautionsSection,
    els.supportReviewCautions,
    normalizedReview.cautions
  );
  syncComputeButtonState();
}

function normalizeSupportReviewSnapshot(review) {
  const status = ["ready", "attention", "unsupported", "pending"].includes(review?.status)
    ? review.status
    : "attention";
  const blockingIssues = dedupeMessages(
    coalesceStringList(review?.blockingIssues ?? review?.blocking_issues)
  );
  const cautions = dedupeMessages(coalesceStringList(review?.cautions));

  return {
    status,
    readyForEstimate:
      (Boolean(review?.readyForEstimate) || Boolean(review?.ready_for_estimate)) &&
      status === "ready",
    summary:
      review?.summary || "TaxVault reviewed this draft, but the status message was unavailable.",
    blockingIssues,
    cautions,
  };
}

function supportReviewBadgeLabel(status) {
  switch (status) {
    case "ready":
      return "Ready";
    case "unsupported":
      return "Unsupported";
    default:
      return "Needs Attention";
  }
}

function setSupportReviewItems(section, list, items) {
  list.replaceChildren();

  items.forEach((item) => {
    const li = document.createElement("li");
    li.textContent = item;
    list.append(li);
  });

  section.classList.toggle("hidden", items.length === 0);
}

function dedupeMessages(messages) {
  return [...new Set(messages)];
}

function coalesceStringList(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.map((item) => String(item));
}

function computeReturn() {
  if (!state.safetyAcknowledged) {
    showDisclaimerGate();
    return;
  }

  if (!state.wasmReady) {
    showError("The tax engine is still loading. Please wait a moment and try again.");
    return;
  }

  const step1Validation = validateStep1();
  if (step1Validation.messages.length > 0) {
    goToStep(1);
    showError(step1Validation.messages, step1Validation.fieldErrors);
    return;
  }

  const { payload, errors } = buildPayload();
  if (errors.length > 0) {
    showError(errors);
    return;
  }

  if (!state.supportReviewReadyForEstimate) {
    showError("Support Review must show Ready before TaxVault can calculate this draft.");
    return;
  }

  hideError();
  const originalLabel = els.computeBtn.textContent;
  const draftEnvelope = buildStoredDraftEnvelope(captureDraftSnapshot());
  const supportReview = normalizeSupportReviewSnapshot(state.lastSupportReview);
  els.computeBtn.disabled = true;
  els.computeBtn.setAttribute("aria-disabled", "true");
  els.computeBtn.textContent = "Calculating...";
  setComputeHelp("Calculating locally in your browser...", "pending");

  try {
    const resultJson = compute_tax(JSON.stringify(payload));
    const data = JSON.parse(resultJson);

    if (!data.success) {
      showError(data.error || "Unable to compute this return.");
      return;
    }

    if (!data.summary || typeof data.summary !== "object" || Array.isArray(data.summary)) {
      showError("Unexpected response from the tax engine. Try calculating again.");
      return;
    }

    renderResults(data, { draftEnvelope, supportReview });
    goToStep(3);
  } catch (error) {
    showError(`Computation error: ${safeMessage(error)}`);
  } finally {
    syncComputeButtonState();
    els.computeBtn.textContent = originalLabel;
  }
}

function buildPayload() {
  const errors = [];
  const primary = readFilerInputs("p");
  const spouse = state.filingStatus === "married_filing_jointly" ? readFilerInputs("s") : null;
  const dependents = collectDependents(errors, {
    requireAtLeastOne: state.filingStatus === "head_of_household",
  });
  validateUniqueSsnEntries(errors, primary, spouse, dependents);
  const w2s = collectW2Cards(errors);
  const socialSecurityIncome = collectSocialSecurityCards(errors);
  const interestIncome = collectInterestCards(errors);
  const dividendIncome = collectDividendCards(errors);
  const adjustments = collectAdjustments(errors);
  const estimatedTaxPayments = collectEstimatedTaxPayments(errors);

  enforceCollectionLimit(errors, "W-2 forms", w2s.length, MAX_W2_FORMS);
  enforceCollectionLimit(
    errors,
    "SSA-1099 forms",
    socialSecurityIncome.length,
    MAX_SOCIAL_SECURITY_FORMS
  );
  enforceCollectionLimit(errors, "1099-INT forms", interestIncome.length, MAX_INTEREST_FORMS);
  enforceCollectionLimit(errors, "1099-DIV forms", dividendIncome.length, MAX_DIVIDEND_FORMS);
  enforceCollectionLimit(errors, "dependents", dependents.length, MAX_DEPENDENTS);

  if (
    w2s.length === 0 &&
    socialSecurityIncome.length === 0 &&
    interestIncome.length === 0 &&
    dividendIncome.length === 0
  ) {
    errors.push("Add at least one W-2, SSA-1099, 1099-INT, or 1099-DIV before calculating.");
  }

  if (errors.length > 0) {
    return { payload: null, errors };
  }

  return {
    payload: {
      input: {
        tax_year: currentTaxYear(),
        filing_status: state.filingStatus,
        primary_filer: filerPayload(primary),
        spouse: spouse ? filerPayload(spouse) : null,
        dependents,
        w2_income: w2s,
        interest_income: interestIncome,
        dividend_income: dividendIncome,
        social_security_income: socialSecurityIncome,
        estimated_tax_payments: estimatedTaxPayments,
        adjustments,
      },
    },
    errors,
  };
}

function enforceCollectionLimit(errors, label, count, maxCount) {
  if (count > maxCount) {
    errors.push(`TaxVault supports up to ${maxCount} ${label} per draft.`);
  }
}

function collectAdjustments(errors) {
  const adjustments = {
    traditional_ira_deduction: 0,
    hsa_deduction: 0,
    student_loan_interest_paid: 0,
    student_loan_interest_is_qualified_loan: Boolean(els.studentLoanQualifiedLoan?.checked),
    student_loan_interest_is_legally_obligated: Boolean(
      els.studentLoanLegallyObligated?.checked
    ),
  };

  const fields = [
    {
      key: "traditional_ira_deduction",
      label: "Traditional IRA deduction",
      rawValue: els.traditionalIraDeduction.value.trim(),
    },
    {
      key: "hsa_deduction",
      label: "HSA deduction",
      rawValue: els.hsaDeduction.value.trim(),
    },
    {
      key: "student_loan_interest_paid",
      label: "Student loan interest paid",
      rawValue: els.studentLoanInterestPaid.value.trim(),
    },
  ];

  fields.forEach(({ key, label, rawValue }) => {
    const value = parseMoney(rawValue, 0);
    if (!Number.isFinite(value) || value < 0) {
      errors.push(`${label} must be 0 or greater.`);
      return;
    }

    adjustments[key] = value;
  });

  if (adjustments.student_loan_interest_paid > 0) {
    if (!adjustments.student_loan_interest_is_qualified_loan) {
      errors.push(
        "Confirm the student loan interest was paid on a qualified student loan before calculating."
      );
    }

    if (!adjustments.student_loan_interest_is_legally_obligated) {
      errors.push(
        "Confirm you were legally obligated to pay that student loan before calculating."
      );
    }
  }

  return adjustments;
}

function collectEstimatedTaxPayments(errors) {
  const value = parseMoney(readTrimmedControlValue(els.estimatedTaxPayments), 0);
  if (!Number.isFinite(value) || value < 0) {
    errors.push("Estimated tax payments must be 0 or greater.");
    return 0;
  }

  return value;
}

function filerPayload(filer) {
  return {
    first_name: filer.firstName,
    last_name: filer.lastName,
    ssn: filer.ssn,
    date_of_birth: filer.dob,
    is_blind: filer.isBlind,
    is_dependent: filer.isDependent,
  };
}

function collectDependents(errors, { requireAtLeastOne = false } = {}) {
  const dependents = [];
  const cards = Array.from(els.dependentContainer.querySelectorAll(".dependent-card"));

  cards.forEach((card, index) => {
    const firstName = readTrimmedQueryValue(card, ".dep-first");
    const lastName = readTrimmedQueryValue(card, ".dep-last");
    const ssn = readTrimmedQueryValue(card, ".dep-ssn");
    const dob = readQueryValue(card, ".dep-dob");
    const relationship = readQueryValue(card, ".dep-relationship");
    const rawMonths = readTrimmedQueryValue(card, ".dep-months");
    const label = `Dependent #${index + 1}`;

    const isBlank =
      firstName === "" &&
      lastName === "" &&
      ssn === "" &&
      dob === "" &&
      relationship === "" &&
      rawMonths === "";

    if (isBlank) {
      return;
    }

    const priorErrorCount = errors.length;

    if (!firstName) {
      errors.push(`${label}: first name is required.`);
    }
    if (!lastName) {
      errors.push(`${label}: last name is required.`);
    }
    if (!ssn) {
      errors.push(`${label}: SSN is required.`);
    } else if (!SSN_PATTERN.test(ssn)) {
      errors.push(`${label}: SSN must use the format 123-45-6789.`);
    }
    if (!dob) {
      errors.push(`${label}: date of birth is required.`);
    } else if (!isPastOrToday(dob)) {
      errors.push(`${label}: date of birth must be a real date in the past.`);
    }
    if (!relationship) {
      errors.push(`${label}: relationship is required.`);
    }

    const monthsLivedInHome = rawMonths === "" ? Number.NaN : Number(rawMonths);
    if (
      !Number.isInteger(monthsLivedInHome) ||
      monthsLivedInHome < 0 ||
      monthsLivedInHome > 12
    ) {
      errors.push(`${label}: months lived in home must be a whole number from 0 to 12.`);
    }

    if (errors.length > priorErrorCount) {
      return;
    }

    dependents.push({
      first_name: firstName,
      last_name: lastName,
      ssn,
      date_of_birth: dob,
      relationship,
      months_lived_in_home: monthsLivedInHome,
    });
  });

  if (requireAtLeastOne && dependents.length === 0) {
    errors.push("Head of Household requires at least one dependent.");
  }

  return dependents;
}

function collectInterestCards(errors) {
  const interestIncome = [];
  const cards = Array.from(els.interestContainer.querySelectorAll(".interest-card"));

  cards.forEach((card, index) => {
    const payerName = readTrimmedQueryValue(card, ".interest-payer");
    const rawTaxable = readTrimmedQueryValue(card, ".interest-taxable");
    const rawTaxExempt = readTrimmedQueryValue(card, ".interest-tax-exempt");
    const label = `1099-INT #${index + 1}`;
    const isBlank = payerName === "" && rawTaxable === "" && rawTaxExempt === "";

    if (isBlank) {
      return;
    }

    const priorErrorCount = errors.length;
    const taxableInterest = parseMoney(rawTaxable, 0);
    const taxExemptInterest = parseMoney(rawTaxExempt, 0);

    if (!Number.isFinite(taxableInterest) || taxableInterest < 0) {
      errors.push(`${label}: taxable interest must be 0 or greater.`);
    }
    if (!Number.isFinite(taxExemptInterest) || taxExemptInterest < 0) {
      errors.push(`${label}: tax-exempt interest must be 0 or greater.`);
    }
    if (
      Number.isFinite(taxableInterest) &&
      Number.isFinite(taxExemptInterest) &&
      taxableInterest === 0 &&
      taxExemptInterest === 0
    ) {
      errors.push(`${label}: enter taxable interest, tax-exempt interest, or remove the card.`);
    }

    if (errors.length > priorErrorCount) {
      return;
    }

    interestIncome.push({
      recipient: readQueryValue(card, ".interest-recipient"),
      payer_name: payerName,
      taxable_interest: taxableInterest,
      tax_exempt_interest: taxExemptInterest,
    });
  });

  return interestIncome;
}

function collectSocialSecurityCards(errors) {
  const socialSecurityIncome = [];
  const cards = Array.from(els.socialSecurityContainer.querySelectorAll(".ssa-card"));

  cards.forEach((card, index) => {
    const rawBenefits = readTrimmedQueryValue(card, ".ssa-benefits");
    const rawWithholding = readTrimmedQueryValue(card, ".ssa-withholding");
    const label = `SSA-1099 #${index + 1}`;
    const isBlank = rawBenefits === "" && rawWithholding === "";

    if (isBlank) {
      return;
    }

    const priorErrorCount = errors.length;
    const totalBenefits = parseMoney(rawBenefits);
    const voluntaryWithholding = parseMoney(rawWithholding, 0);

    if (!Number.isFinite(totalBenefits) || totalBenefits <= 0) {
      errors.push(`${label}: total benefits must be greater than 0.`);
    }
    if (!Number.isFinite(voluntaryWithholding) || voluntaryWithholding < 0) {
      errors.push(`${label}: voluntary federal tax withheld must be 0 or greater.`);
    }
    if (
      Number.isFinite(totalBenefits) &&
      Number.isFinite(voluntaryWithholding) &&
      voluntaryWithholding > totalBenefits
    ) {
      errors.push(`${label}: voluntary withholding cannot exceed total benefits.`);
    }

    if (errors.length > priorErrorCount) {
      return;
    }

    socialSecurityIncome.push({
      recipient: readQueryValue(card, ".ssa-recipient"),
      total_benefits: totalBenefits,
      voluntary_withholding: voluntaryWithholding,
    });
  });

  return socialSecurityIncome;
}

function collectDividendCards(errors) {
  const dividendIncome = [];
  const cards = Array.from(els.dividendContainer.querySelectorAll(".dividend-card"));

  cards.forEach((card, index) => {
    const payerName = readTrimmedQueryValue(card, ".dividend-payer");
    const rawOrdinary = readTrimmedQueryValue(card, ".dividend-ordinary");
    const rawQualified = readTrimmedQueryValue(card, ".dividend-qualified");
    const label = `1099-DIV #${index + 1}`;
    const isBlank = payerName === "" && rawOrdinary === "" && rawQualified === "";

    if (isBlank) {
      return;
    }

    const priorErrorCount = errors.length;
    const ordinaryDividends = parseMoney(rawOrdinary, 0);
    const qualifiedDividends = parseMoney(rawQualified, 0);

    if (!Number.isFinite(ordinaryDividends) || ordinaryDividends < 0) {
      errors.push(`${label}: ordinary dividends must be 0 or greater.`);
    }
    if (!Number.isFinite(qualifiedDividends) || qualifiedDividends < 0) {
      errors.push(`${label}: qualified dividends must be 0 or greater.`);
    }
    if (
      Number.isFinite(ordinaryDividends) &&
      Number.isFinite(qualifiedDividends) &&
      ordinaryDividends === 0 &&
      qualifiedDividends === 0
    ) {
      errors.push(`${label}: enter ordinary dividends, qualified dividends, or remove the card.`);
    }
    if (
      Number.isFinite(ordinaryDividends) &&
      Number.isFinite(qualifiedDividends) &&
      qualifiedDividends > ordinaryDividends
    ) {
      errors.push(`${label}: qualified dividends cannot exceed ordinary dividends.`);
    }

    if (errors.length > priorErrorCount) {
      return;
    }

    dividendIncome.push({
      recipient: readQueryValue(card, ".dividend-recipient"),
      payer_name: payerName,
      ordinary_dividends: ordinaryDividends,
      qualified_dividends: qualifiedDividends,
    });
  });

  return dividendIncome;
}

function collectW2Cards(errors) {
  const w2s = [];
  const cards = Array.from(els.w2Container.querySelectorAll(".w2-card"));

  cards.forEach((card, index) => {
    const employerName = readTrimmedQueryValue(card, ".w2-employer");
    const employerEin = readTrimmedQueryValue(card, ".w2-ein");
    const rawWages = readTrimmedQueryValue(card, ".w2-wages");
    const rawFedWh = readTrimmedQueryValue(card, ".w2-fed-wh");
    const rawStateWh = readTrimmedQueryValue(card, ".w2-state-wh");
    const rawSsWages = readTrimmedQueryValue(card, ".w2-ss-wages");
    const rawSsWh = readTrimmedQueryValue(card, ".w2-ss-wh");
    const rawMedWages = readTrimmedQueryValue(card, ".w2-med-wages");
    const rawMedWh = readTrimmedQueryValue(card, ".w2-med-wh");
    const label = `W-2 #${index + 1}`;

    const isBlank =
      employerName === "" &&
      employerEin === "" &&
      rawWages === "" &&
      rawFedWh === "" &&
      rawStateWh === "" &&
      rawSsWages === "" &&
      rawSsWh === "" &&
      rawMedWages === "" &&
      rawMedWh === "";

    if (isBlank) {
      return;
    }

    const priorErrorCount = errors.length;

    if (!employerName) {
      errors.push(`${label}: employer name is required.`);
    }

    if (!employerEin) {
      errors.push(`${label}: employer EIN is required.`);
    } else if (!EIN_PATTERN.test(employerEin)) {
      errors.push(`${label}: employer EIN must use the format 12-3456789.`);
    }

    const wages = parseMoney(rawWages);
    const federalTaxWithheld = parseMoney(rawFedWh, 0);
    const stateTaxWithheld = parseMoney(rawStateWh, 0);
    const socialSecurityWages = rawSsWages === "" ? wages : parseMoney(rawSsWages);
    const socialSecurityTaxWithheld = parseMoney(rawSsWh, 0);
    const medicareWages = rawMedWages === "" ? wages : parseMoney(rawMedWages);
    const medicareTaxWithheld = parseMoney(rawMedWh, 0);

    if (!Number.isFinite(wages) || wages <= 0) {
      errors.push(`${label}: wages must be greater than 0.`);
    }

    [
      ["federal withholding", federalTaxWithheld],
      ["state withholding", stateTaxWithheld],
      ["Social Security wages", socialSecurityWages],
      ["Social Security withholding", socialSecurityTaxWithheld],
      ["Medicare wages", medicareWages],
      ["Medicare withholding", medicareTaxWithheld],
    ].forEach(([fieldLabel, value]) => {
      if (!Number.isFinite(value) || value < 0) {
        errors.push(`${label}: ${fieldLabel} must be 0 or greater.`);
      }
    });

    if (Number.isFinite(federalTaxWithheld) && Number.isFinite(wages) && federalTaxWithheld > wages) {
      errors.push(`${label}: federal withholding cannot exceed wages.`);
    }

    if (
      Number.isFinite(socialSecurityTaxWithheld) &&
      Number.isFinite(socialSecurityWages) &&
      socialSecurityTaxWithheld > socialSecurityWages
    ) {
      errors.push(`${label}: Social Security withholding cannot exceed Social Security wages.`);
    }

    if (
      Number.isFinite(medicareTaxWithheld) &&
      Number.isFinite(medicareWages) &&
      medicareTaxWithheld > medicareWages
    ) {
      errors.push(`${label}: Medicare withholding cannot exceed Medicare wages.`);
    }

    if (errors.length > priorErrorCount) {
      return;
    }

    w2s.push({
      recipient: readQueryValue(card, ".w2-recipient"),
      employer_name: employerName,
      employer_ein: employerEin,
      wages,
      federal_tax_withheld: federalTaxWithheld,
      state_tax_withheld: stateTaxWithheld,
      social_security_wages: socialSecurityWages,
      social_security_tax_withheld: socialSecurityTaxWithheld,
      medicare_wages: medicareWages,
      medicare_tax_withheld: medicareTaxWithheld,
    });
  });

  return w2s;
}

function renderResults(data, { draftEnvelope = null, supportReview = null } = {}) {
  state.lastComputedResult = data;
  state.lastComputedDraftEnvelope = draftEnvelope || buildStoredDraftEnvelope(captureDraftSnapshot());
  state.lastComputedSupportReview = normalizeSupportReviewSnapshot(
    supportReview || state.lastSupportReview
  );
  renderHero(data.summary);
  renderDraftPreview(data);
  renderMeta(data.meta);
  renderBreakdown(data.summary);
  renderTrace(data.trace);
  renderLines(data.form?.lines || {});
  syncResultExportButtons();

  els.linesContainer.classList.remove("open");
  els.linesArrow.classList.remove("open");
  els.linesToggle.setAttribute("aria-expanded", "false");
  els.traceContainer.classList.remove("open");
  els.traceArrow.classList.remove("open");
  els.traceToggle.setAttribute("aria-expanded", "false");
}

function renderHero(summary) {
  const overpayment = Number(summary.overpayment);
  const balanceDue = Number(summary.balance_due);
  els.resultHero.replaceChildren();

  if (overpayment > 0) {
    els.resultHero.append(
      createElement("div", { className: "result-label", text: "Estimated Federal Refund" }),
      createElement("div", { className: "amount refund", text: fmtCurrency(summary.overpayment) }),
      createElement("div", {
        className: "result-sub",
        text: `Calculated locally in your browser for ${summary.tax_year}. Do not use this refund number to file a return.`,
      })
    );
    return;
  }

  if (balanceDue > 0) {
    els.resultHero.append(
      createElement("div", { className: "result-label", text: "Estimated Amount Owed" }),
      createElement("div", { className: "amount owe", text: fmtCurrency(summary.balance_due) }),
      createElement("div", {
        className: "result-sub",
        text: `Calculated locally in your browser for ${summary.tax_year}. Do not use this balance-due number to file a return.`,
      })
    );
    return;
  }

  els.resultHero.append(
    createElement("div", { className: "result-label", text: "Estimated Tax Status" }),
    createElement("div", { className: "amount neutral", text: fmtCurrency("0") }),
    createElement("div", {
      className: "result-sub",
      text: "Calculated locally in your browser. A zero balance here does not mean your return is filing-ready.",
    })
  );
}

function renderBreakdown(summary) {
  const rows = buildBreakdownRows(summary);

  els.breakdownContent.replaceChildren();

  rows.forEach((row) => {
    if (row.section) {
      els.breakdownContent.append(
        createElement("div", { className: "breakdown-section", text: row.section })
      );
      return;
    }

    const breakdownRow = createElement("div", {
      className: `breakdown-row${row.highlight ? " highlight" : ""}`,
    });
    breakdownRow.append(
      createElement("span", { className: "label", text: row.label }),
      createElement("span", { className: "value", text: row.formattedValue })
    );
    els.breakdownContent.append(breakdownRow);
  });
}

function buildBreakdownRows(summary) {
  const descriptors = [
    { section: "Income" },
    { key: "total_wages", label: "Total Wages" },
    { key: "total_taxable_interest", label: "Taxable Interest" },
    { key: "total_tax_exempt_interest", label: "Tax-Exempt Interest" },
    { key: "total_ordinary_dividends", label: "Ordinary Dividends" },
    { key: "total_qualified_dividends", label: "Qualified Dividends" },
    { key: "total_social_security_benefits", label: "Social Security Benefits" },
    {
      key: "taxable_social_security_benefits",
      label: "Taxable Social Security Benefits",
    },
    { key: "total_income", label: "Total Income", highlight: true },
    { section: "Adjustments" },
    { key: "traditional_ira_deduction", label: "Traditional IRA Deduction" },
    { key: "hsa_deduction", label: "HSA Deduction" },
    {
      key: "student_loan_interest_deduction",
      label: "Student Loan Interest Deduction",
    },
    { key: "total_adjustments", label: "Total Adjustments", highlight: true },
    { key: "adjusted_gross_income", label: "Adjusted Gross Income", highlight: true },
    { section: "Deductions" },
    { key: "standard_deduction", label: "Standard Deduction" },
    { key: "taxable_income", label: "Taxable Income", highlight: true },
    { section: "Credits" },
    {
      key: "child_dependent_credit",
      label: "Child/Dependent Credit",
      highlight: true,
    },
    { section: "Tax" },
    { key: "income_tax", label: "Income Tax Before Credits" },
    { key: "total_tax", label: "Total Tax", highlight: true },
    { section: "Payments" },
    { key: "total_w2_federal_withholding", label: "W-2 Federal Withholding" },
    {
      key: "total_social_security_withholding",
      label: "SSA-1099 Voluntary Withholding",
    },
    { key: "total_federal_withholding", label: "Total Federal Withholding" },
    { key: "estimated_tax_payments", label: "Estimated Tax Payments" },
    {
      key: "additional_child_tax_credit",
      label: "Additional Child Tax Credit",
    },
    { key: "total_payments", label: "Total Payments", highlight: true },
  ];

  return descriptors.map((descriptor) => {
    if (descriptor.section) {
      return { section: descriptor.section };
    }

    const amount = Number(summary?.[descriptor.key]);
    const normalizedAmount = Number.isFinite(amount) ? amount : 0;

    return {
      key: descriptor.key,
      label: descriptor.label,
      amount: normalizedAmount,
      formattedValue: fmtCurrency(normalizedAmount),
      highlight: Boolean(descriptor.highlight),
    };
  });
}

function renderMeta(meta) {
  els.resultMeta.replaceChildren();
  els.scopeList.replaceChildren();

  if (!meta) {
    return;
  }

  const rows = [
    { label: "Estimate Scope", value: meta.estimate_scope },
    {
      label: "Tax Table Status",
      value: formatTaxTableStatus(meta),
    },
    { label: "Rule Pack", value: `Federal rules version ${meta.rule_pack_version}` },
    { label: "Privacy", value: meta.privacy },
  ];

  rows.forEach((row) => {
    const card = createElement("div", { className: "meta-item" });
    card.append(
      createElement("div", { className: "meta-label", text: row.label }),
      createElement("div", { className: "meta-value", text: row.value })
    );
    els.resultMeta.append(card);
  });

  (meta.scope_limits || []).forEach((item) => {
    const li = document.createElement("li");
    li.textContent = item;
    els.scopeList.append(li);
  });
}

function formatTaxTableStatus(meta) {
  switch (meta?.tax_table_verification_status) {
    case "human_verified":
      return "Human-verified. Eligible for public estimate releases once the other release gates pass.";
    case "machine_checked":
      return "Machine-checked. Local/private estimates are enabled, but no human reviewer signoff is recorded for public release.";
    default:
      return meta?.tax_table_local_estimate_ready
        ? "Machine-checked or better. Local estimates are enabled."
        : "Unverified. Estimate calculations should remain locked.";
  }
}

function renderDraftPreview(data) {
  const form = data?.form || {};
  const lines = form.lines || {};
  const summary = data?.summary || {};
  const meta = data?.meta || {};
  const primary = readFilerInputs("p");
  const spouse = state.filingStatus === "married_filing_jointly" ? readFilerInputs("s") : null;

  const summaryItems = [
    {
      label: "Tax Year",
      value: String(form.tax_year || summary.tax_year || "Unavailable"),
    },
    {
      label: "Return Type",
      value: `${form.form_id || "1040"} local draft`,
    },
    {
      label: "Filing Status",
      value: formatFilingStatusLabel(summary.filing_status || state.filingStatus),
    },
    {
      label: "Primary Filer",
      value: formatDraftPerson(primary),
    },
  ];

  if (spouse) {
    summaryItems.push({
      label: "Spouse",
      value: formatDraftPerson(spouse),
    });
  }

  summaryItems.push(
    {
      label: "Generated",
      value: draftTimestampFormatter.format(new Date()),
    },
    {
      label: "Rule Pack",
      value: meta.rule_pack_version
        ? `Federal rules ${meta.rule_pack_version}`
        : "Unavailable in this preview",
    },
    {
      label: "Privacy",
      value: "Generated locally in this browser session",
    }
  );

  els.draftSummaryGrid.replaceChildren();
  summaryItems.forEach((item) => {
    const card = createElement("div", { className: "draft-summary-item" });
    card.append(
      createElement("div", { className: "draft-summary-label", text: item.label }),
      createElement("div", { className: "draft-summary-value", text: item.value })
    );
    els.draftSummaryGrid.append(card);
  });

  els.draftSections.replaceChildren();
  DRAFT_1040_SECTIONS.forEach((section) => {
    const sectionEl = createElement("section", { className: "draft-section" });
    sectionEl.append(
      createElement("div", { className: "draft-section-title", text: section.title }),
      createElement("div", { className: "draft-section-subtitle", text: section.subtitle })
    );

    section.rows.forEach((row) => {
      sectionEl.append(createDraftLineRow(row, lines));
    });

    els.draftSections.append(sectionEl);
  });

  els.printDraftBtn.disabled = Object.keys(lines).length === 0;
}

function createDraftLineRow(row, lines) {
  const rowEl = createElement("div", {
    className: `draft-line-row${row.emphasis ? " emphasis" : ""}`,
  });
  const value = Object.prototype.hasOwnProperty.call(lines, row.line) ? lines[row.line] : null;
  rowEl.append(
    createElement("span", { className: "draft-line-code", text: `Line ${row.line}` }),
    createElement("span", { className: "draft-line-label", text: row.label }),
    createElement("span", {
      className: "draft-line-value",
      text: formatDraftLineValue(value),
    })
  );
  return rowEl;
}

function formatDraftLineValue(value) {
  if (value == null) {
    return "Not mapped";
  }

  if (value && typeof value === "object" && "Checkbox" in value) {
    return value.Checkbox ? "Checked" : "Blank";
  }

  return formatLineValue(value);
}

function formatDraftPerson(filer) {
  const fullName = [filer?.firstName, filer?.lastName].filter(Boolean).join(" ").trim();
  const maskedSsn =
    filer?.ssn && SSN_PATTERN.test(filer.ssn) ? `SSN ending ${filer.ssn.slice(-4)}` : null;

  if (fullName && maskedSsn) {
    return `${fullName} • ${maskedSsn}`;
  }

  return fullName || maskedSsn || "Not entered";
}

function formatFilingStatusLabel(status) {
  const raw = String(status || "").trim();
  if (!raw) {
    return "Unavailable";
  }

  if (FILING_STATUS_LABELS[raw]) {
    return FILING_STATUS_LABELS[raw];
  }

  const normalized = raw
    .replace(/([a-z])([A-Z])/g, "$1_$2")
    .replace(/\s+/g, "_")
    .toLowerCase();

  if (FILING_STATUS_LABELS[normalized]) {
    return FILING_STATUS_LABELS[normalized];
  }

  return normalized
    .split("_")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function resetDraftPreview() {
  els.draftSummaryGrid.replaceChildren();
  els.draftSections.replaceChildren();
  els.printDraftBtn.disabled = true;
}

function resetComputedEstimate() {
  if (
    !state.lastComputedResult &&
    !state.lastComputedDraftEnvelope &&
    !state.lastComputedSupportReview
  ) {
    syncResultExportButtons();
    return;
  }

  state.lastComputedResult = null;
  state.lastComputedDraftEnvelope = null;
  state.lastComputedSupportReview = null;
  els.resultHero.replaceChildren();
  els.resultMeta.replaceChildren();
  els.scopeList.replaceChildren();
  els.breakdownContent.replaceChildren();
  els.traceContainer.textContent = "";
  els.traceContainer.classList.remove("open");
  els.traceArrow.classList.remove("open");
  els.traceToggle.setAttribute("aria-expanded", "false");
  els.linesContainer.replaceChildren();
  els.linesContainer.classList.remove("open");
  els.linesArrow.classList.remove("open");
  els.linesToggle.setAttribute("aria-expanded", "false");
  resetDraftPreview();
  syncResultExportButtons();
}

function renderTrace(trace) {
  els.traceContainer.textContent = trace || "Trace unavailable.";
  els.traceContainer.scrollTop = 0;
}

function validateUniqueSsnEntries(errors, primary, spouse, dependents) {
  const seen = new Map();
  const entries = [
    {
      label: "Primary filer",
      ssn: primary?.ssn?.trim() || "",
      valid: SSN_PATTERN.test(primary?.ssn?.trim() || ""),
    },
  ];

  if (state.filingStatus === "married_filing_jointly") {
    entries.push({
      label: "Spouse",
      ssn: spouse?.ssn?.trim() || "",
      valid: SSN_PATTERN.test(spouse?.ssn?.trim() || ""),
    });
  }

  dependents.forEach((dependent, index) => {
    entries.push({
      label: `Dependent #${index + 1}`,
      ssn: dependent.ssn,
      valid: SSN_PATTERN.test(dependent.ssn),
    });
  });

  entries.forEach((entry) => {
    if (!entry.valid) {
      return;
    }

    const existingLabel = seen.get(entry.ssn);
    if (existingLabel) {
      errors.push(`${existingLabel} and ${entry.label} must have different SSNs.`);
      return;
    }

    seen.set(entry.ssn, entry.label);
  });
}

function renderLines(lines) {
  els.linesContainer.replaceChildren();

  const keys = sortedLineKeys(lines);

  keys.forEach((key) => {
    const row = createElement("div", { className: "line-row" });
    row.append(
      createElement("span", { className: "ln", text: `Line ${key}` }),
      createElement("span", { className: "lv", text: formatLineValue(lines[key]) })
    );
    els.linesContainer.append(row);
  });
}

function formatLineValue(value) {
  if (value && typeof value === "object") {
    if ("Currency" in value) {
      return fmtCurrency(value.Currency);
    }
    if ("Checkbox" in value) {
      return value.Checkbox ? "[X]" : "[ ]";
    }
    if ("Text" in value) {
      return String(value.Text);
    }
    return JSON.stringify(value);
  }

  if (value === "Redacted") {
    return "***";
  }

  return String(value);
}

function normalizeMoneyValue(rawValue) {
  const trimmed = String(rawValue || "").trim();

  if (trimmed === "") {
    return "";
  }

  const hasParens = trimmed.startsWith("(") && trimmed.endsWith(")");
  let normalized = trimmed.replace(/[$,\s]/g, "");

  if (hasParens) {
    normalized = `-${normalized.slice(1, -1)}`;
  }

  if (!/^-?(?:\d+(?:\.\d{0,2})?|\.\d{1,2})$/.test(normalized)) {
    return null;
  }

  if (normalized.startsWith(".")) {
    normalized = `0${normalized}`;
  } else if (normalized.startsWith("-.")) {
    normalized = normalized.replace("-.", "-0.");
  }

  const [wholePart, fractionPart = ""] = normalized.split(".");
  const compactWholePart = wholePart.replace(/^(-?)0+(?=\d)/, "$1") || "0";
  const compactFractionPart = fractionPart.replace(/0+$/, "");

  return compactFractionPart ? `${compactWholePart}.${compactFractionPart}` : compactWholePart;
}

function parseMoney(rawValue, defaultValue = Number.NaN) {
  const trimmed = String(rawValue || "").trim();

  if (trimmed === "") {
    return defaultValue;
  }

  const normalized = normalizeMoneyValue(trimmed);
  if (normalized === null || normalized === "") {
    return Number.NaN;
  }

  const value = Number(normalized);
  return Number.isFinite(value) ? value : Number.NaN;
}

function fmtCurrency(value) {
  const amount = Number(value);
  return currencyFormatter.format(Number.isFinite(amount) ? amount : 0);
}

function formatDigits(value, groups) {
  const digits = value.replace(/\D/g, "").slice(0, groups.reduce((sum, size) => sum + size, 0));
  const parts = [];
  let cursor = 0;

  groups.forEach((size) => {
    const chunk = digits.slice(cursor, cursor + size);
    if (chunk) {
      parts.push(chunk);
      cursor += size;
    }
  });

  return parts.join("-");
}

function isPastOrToday(dateString) {
  const date = new Date(`${dateString}T00:00:00`);
  if (Number.isNaN(date.getTime())) {
    return false;
  }

  const today = new Date();
  const cutoff = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  return date <= cutoff;
}

function safeMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

function makeExportFilename(prefix, envelope, ext, { stampKey = "exportedAt" } = {}) {
  const stampSource =
    typeof envelope?.[stampKey] === "string" && envelope[stampKey]
      ? envelope[stampKey]
      : new Date().toISOString();
  const safeStamp = stampSource.replace(/[:.]/g, "-");
  return `taxvault-${normalizeTaxYear(envelope?.taxYear)}-${prefix}-${safeStamp}.${ext}`;
}

function draftExportFilename(envelope) {
  return makeExportFilename("draft", envelope, "json", { stampKey: "updatedAt" });
}

function auditTrailExportFilename(envelope) {
  return makeExportFilename("audit-trail", envelope, "json");
}

function supportSnapshotExportFilename(envelope) {
  return makeExportFilename("support-snapshot", envelope, "json");
}

function reviewPacketExportFilename(envelope) {
  return makeExportFilename("review-packet", envelope, "html");
}

function downloadFile(contents, fileName, mimeType) {
  let blobUrl = "";
  const link = document.createElement("a");

  try {
    const blob = new Blob([contents], { type: mimeType });
    blobUrl = URL.createObjectURL(blob);
    link.href = blobUrl;
    link.download = fileName;
    link.rel = "noopener";
    document.body.append(link);
    link.click();
  } finally {
    link.remove();
    if (blobUrl) {
      window.setTimeout(() => {
        URL.revokeObjectURL(blobUrl);
      }, DOWNLOAD_BLOB_URL_REVOKE_DELAY_MS);
    }
  }
}

function downloadJsonFile(contents, fileName) {
  downloadFile(contents, fileName, "application/json");
}

function tryDownloadFile(contents, fileName, mimeType, label) {
  try {
    downloadFile(contents, fileName, mimeType);
    return true;
  } catch (error) {
    showError(`Could not start the ${label} download. ${safeMessage(error)}`);
    announceUiStatus(`${label} download failed.`);
    return false;
  }
}

function tryDownloadJsonFile(contents, fileName, label) {
  return tryDownloadFile(contents, fileName, "application/json", label);
}

function exportDraftToFile() {
  hideError();
  const envelope = buildStoredDraftEnvelope(captureDraftSnapshot());
  if (!envelope) {
    showError("Add some draft data before exporting a TaxVault draft file.");
    return;
  }

  storeDraftEnvelope(envelope, { refreshStatus: false });
  if (
    !tryDownloadJsonFile(
      JSON.stringify(envelope, null, 2),
      draftExportFilename(envelope),
      "draft export"
    )
  ) {
    return;
  }
  refreshStorageStatus("Draft exported. SSNs and EINs are never included in TaxVault draft files.");
  announceUiStatus("Draft exported.");
}

function buildEstimateExportSnapshot(result) {
  if (!isPlainObject(result)) {
    return null;
  }

  const summary = isPlainObject(result.summary) ? { ...result.summary } : {};
  const meta = isPlainObject(result.meta) ? { ...result.meta } : {};
  const form = isPlainObject(result.form) ? result.form : {};
  const lines = isPlainObject(form.lines) ? { ...form.lines } : {};
  const taxYear = Number(summary.tax_year || form.tax_year || currentTaxYear());

  return {
    summary,
    meta,
    breakdown: buildBreakdownRows(summary),
    form: {
      formId:
        typeof form.form_id === "string" && form.form_id.trim() ? form.form_id.trim() : "1040",
      taxYear: Number.isInteger(taxYear) ? taxYear : currentTaxYear(),
      lines,
    },
    trace: typeof result.trace === "string" ? result.trace : "",
  };
}

function buildAuditTrailEnvelope(result, { draftEnvelope = null, supportReview = null } = {}) {
  const estimate = buildEstimateExportSnapshot(result);
  if (!estimate) {
    return null;
  }

  const normalizedSupportReview = supportReview ? normalizeSupportReviewSnapshot(supportReview) : null;

  return {
    type: AUDIT_TRAIL_FILE_TYPE,
    version: AUDIT_TRAIL_VERSION,
    appVersion: APP_VERSION,
    taxYear: estimate.form.taxYear,
    exportedAt: new Date().toISOString(),
    draftEnvelope,
    supportReview: normalizedSupportReview,
    estimate,
  };
}

function buildCurrentAuditTrailEnvelope() {
  return buildAuditTrailEnvelope(state.lastComputedResult, {
    draftEnvelope: state.lastComputedDraftEnvelope,
    supportReview: state.lastComputedSupportReview,
  });
}

function buildSupportSnapshotEnvelope(result, { rawDraftSnapshot = null, supportReview = null } = {}) {
  const estimate = buildEstimateExportSnapshot(result);
  if (!estimate) {
    return null;
  }

  const normalizedSupportReview = supportReview ? normalizeSupportReviewSnapshot(supportReview) : null;
  const normalizedDraftSnapshot = sanitizeDraftSnapshotForRestore(rawDraftSnapshot);

  return redactSupportSnapshotEnvelope(
    {
      type: SUPPORT_SNAPSHOT_FILE_TYPE,
      version: SUPPORT_SNAPSHOT_VERSION,
      appVersion: APP_VERSION,
      taxYear: estimate.form.taxYear,
      exportedAt: new Date().toISOString(),
      suitableForSharing: true,
      redaction: {
        removed: ["names", "dates_of_birth", "ssns", "eins", "employer_names", "payer_names"],
      },
      inputSnapshot: buildAnonymizedSupportInputSnapshot(normalizedDraftSnapshot, estimate.form.taxYear),
      supportReview: normalizedSupportReview,
      estimate,
    },
    rawDraftSnapshot
  );
}

function buildCurrentSupportSnapshotEnvelope() {
  if (!state.lastComputedResult) {
    return null;
  }

  return buildSupportSnapshotEnvelope(state.lastComputedResult, {
    rawDraftSnapshot: captureDraftSnapshot(),
    supportReview: state.lastComputedSupportReview,
  });
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function formatReviewPacketTimestamp(value) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return "Unavailable";
  }

  return draftTimestampFormatter.format(parsed);
}

function formatIncomeRecipientLabel(value) {
  return value === "spouse" ? "Spouse" : "Primary filer";
}

function formatDependentRelationshipLabel(value) {
  const option = DEPENDENT_RELATIONSHIP_OPTIONS.find((entry) => entry.value === value);
  return option?.label || "Unspecified";
}

function summarizeEstimateHeadline(summary) {
  const overpayment = Number(summary?.overpayment);
  const balanceDue = Number(summary?.balance_due);

  if (overpayment > 0) {
    return {
      label: "Estimated Federal Refund",
      amount: fmtCurrency(overpayment),
      note: "Review only. Do not use this number to file a return.",
    };
  }

  if (balanceDue > 0) {
    return {
      label: "Estimated Amount Owed",
      amount: fmtCurrency(balanceDue),
      note: "Review only. Do not use this number to file a return.",
    };
  }

  return {
    label: "Estimated Tax Status",
    amount: fmtCurrency(0),
    note: "A zero balance does not mean the return is filing-ready.",
  };
}

function sortedLineKeys(lines) {
  return Object.keys(lines).sort((left, right) => {
    const leftNumber = parseFloat(left);
    const rightNumber = parseFloat(right);

    if (!Number.isNaN(leftNumber) && !Number.isNaN(rightNumber) && leftNumber !== rightNumber) {
      return leftNumber - rightNumber;
    }

    return left.localeCompare(right, undefined, { numeric: true });
  });
}

function renderReviewPacketList(items) {
  if (!Array.isArray(items) || items.length === 0) {
    return '<p class="empty-state">None.</p>';
  }

  return `<ul>${items.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>`;
}

function renderReviewPacketTable(headers, rows) {
  if (!Array.isArray(rows) || rows.length === 0) {
    return '<p class="empty-state">None.</p>';
  }

  const thead = `<thead><tr>${headers
    .map((header) => `<th>${escapeHtml(header)}</th>`)
    .join("")}</tr></thead>`;
  const tbody = `<tbody>${rows
    .map(
      (row) =>
        `<tr>${row
          .map((cell) => `<td>${escapeHtml(cell)}</td>`)
          .join("")}</tr>`
    )
    .join("")}</tbody>`;

  return `<table>${thead}${tbody}</table>`;
}

function buildReviewPacketHtml(envelope) {
  if (!isPlainObject(envelope)) {
    return "";
  }

  const draft = envelope.draftEnvelope?.draft || {};
  const supportReview = envelope.supportReview || null;
  const estimate = envelope.estimate || {};
  const summary = estimate.summary || {};
  const meta = estimate.meta || {};
  const form = estimate.form || {};
  const lines = form.lines || {};
  const breakdownRows = Array.isArray(estimate.breakdown) ? estimate.breakdown : [];
  const headline = summarizeEstimateHeadline(summary);
  const primaryName = formatDraftPerson(draft.primaryFiler);
  const spouseName = formatDraftPerson(draft.spouse);

  const summaryCards = [
    ["Tax Year", String(envelope.taxYear || "Unavailable")],
    ["Filing Status", formatFilingStatusLabel(summary.filing_status || draft.filingStatus)],
    ["Primary Filer", primaryName],
    ["Spouse", spouseName],
    ["Generated", formatReviewPacketTimestamp(envelope.exportedAt)],
    [
      "Rule Pack",
      meta.rule_pack_version ? `Federal rules ${meta.rule_pack_version}` : "Unavailable",
    ],
  ];

  const inputRows = [
    ["W-2 forms", String(Array.isArray(draft.w2s) ? draft.w2s.length : 0)],
    ["SSA-1099 forms", String(Array.isArray(draft.socialSecurityIncome) ? draft.socialSecurityIncome.length : 0)],
    ["1099-INT forms", String(Array.isArray(draft.interestIncome) ? draft.interestIncome.length : 0)],
    ["1099-DIV forms", String(Array.isArray(draft.dividendIncome) ? draft.dividendIncome.length : 0)],
    ["Dependents", String(Array.isArray(draft.dependents) ? draft.dependents.length : 0)],
    [
      "Adjustments/payments entered",
      [
        draft.adjustments?.traditionalIraDeduction,
        draft.adjustments?.hsaDeduction,
        draft.adjustments?.studentLoanInterestPaid,
        draft.estimatedTaxPayments,
      ]
        .filter((value) => String(value || "").trim() !== "")
        .length > 0
        ? "Yes"
        : "No",
    ],
  ];

  const adjustmentRows = [
    ["Traditional IRA Deduction", draft.adjustments?.traditionalIraDeduction || "0"],
    ["HSA Deduction", draft.adjustments?.hsaDeduction || "0"],
    ["Student Loan Interest Paid", draft.adjustments?.studentLoanInterestPaid || "0"],
    ["Estimated Tax Payments", draft.estimatedTaxPayments || "0"],
  ];

  const dependentRows = Array.isArray(draft.dependents)
    ? draft.dependents.map((dependent) => [
        [dependent.firstName, dependent.lastName].filter(Boolean).join(" ").trim() || "Not entered",
        dependent.dob || "Not entered",
        formatDependentRelationshipLabel(dependent.relationship),
        dependent.monthsLivedInHome || "0",
      ])
    : [];

  const w2Rows = Array.isArray(draft.w2s)
    ? draft.w2s.map((w2) => [
        w2.employerName || "Employer not entered",
        formatIncomeRecipientLabel(w2.recipient),
        w2.wages || "0",
        w2.federalTaxWithheld || "0",
      ])
    : [];

  const interestRows = Array.isArray(draft.interestIncome)
    ? draft.interestIncome.map((item) => [
        item.payerName || "Institution not entered",
        formatIncomeRecipientLabel(item.recipient),
        item.taxableInterest || "0",
        item.taxExemptInterest || "0",
      ])
    : [];

  const dividendRows = Array.isArray(draft.dividendIncome)
    ? draft.dividendIncome.map((item) => [
        item.payerName || "Institution not entered",
        formatIncomeRecipientLabel(item.recipient),
        item.ordinaryDividends || "0",
        item.qualifiedDividends || "0",
      ])
    : [];

  const socialSecurityRows = Array.isArray(draft.socialSecurityIncome)
    ? draft.socialSecurityIncome.map((item) => [
        formatIncomeRecipientLabel(item.recipient),
        item.totalBenefits || "0",
        item.voluntaryWithholding || "0",
      ])
    : [];

  const breakdownTableRows = breakdownRows
    .filter((row) => row && !row.section)
    .map((row) => [row.label || "Unlabeled row", row.formattedValue || "0.00"]);

  const lineRows = sortedLineKeys(lines).map((line) => [
    `Line ${line}`,
    formatLineValue(lines[line]),
  ]);

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>TaxVault Review Packet</title>
<style>
  :root {
    color-scheme: light;
    --ink: #0f172a;
    --muted: #475569;
    --line: #cbd5e1;
    --panel: #ffffff;
    --soft: #f8fafc;
    --accent: #0f766e;
    --warning: #b45309;
    --danger: #b91c1c;
  }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    padding: 2rem;
    font-family: "Iowan Old Style", "Palatino Linotype", "Book Antiqua", Georgia, serif;
    color: var(--ink);
    background: linear-gradient(180deg, #f8fafc 0%, #eef2ff 100%);
  }
  main {
    max-width: 960px;
    margin: 0 auto;
  }
  .hero, section {
    background: rgba(255, 255, 255, 0.96);
    border: 1px solid rgba(148, 163, 184, 0.28);
    border-radius: 18px;
    padding: 1.4rem 1.5rem;
    box-shadow: 0 12px 30px rgba(15, 23, 42, 0.06);
    margin-bottom: 1rem;
  }
  .eyebrow {
    font: 700 0.78rem/1.2 "IBM Plex Sans", "Avenir Next", Helvetica, sans-serif;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: var(--accent);
  }
  h1, h2, h3 {
    margin: 0;
    line-height: 1.1;
  }
  h1 { font-size: 2.2rem; margin-top: 0.35rem; }
  h2 { font-size: 1.15rem; margin-bottom: 0.9rem; }
  p, li, td, th, div { font-size: 0.98rem; }
  .hero-note, .muted, .empty-state { color: var(--muted); }
  .amount {
    margin: 0.6rem 0 0.35rem;
    font-size: 2.1rem;
    font-weight: 700;
    color: var(--accent);
  }
  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
    gap: 0.8rem;
  }
  .card {
    background: var(--soft);
    border: 1px solid var(--line);
    border-radius: 14px;
    padding: 0.9rem 1rem;
  }
  .label {
    font: 700 0.75rem/1.2 "IBM Plex Sans", "Avenir Next", Helvetica, sans-serif;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--muted);
    margin-bottom: 0.35rem;
  }
  ul {
    margin: 0.45rem 0 0;
    padding-left: 1.15rem;
  }
  table {
    width: 100%;
    border-collapse: collapse;
    font-size: 0.94rem;
  }
  th, td {
    text-align: left;
    padding: 0.55rem 0.45rem;
    border-bottom: 1px solid var(--line);
    vertical-align: top;
  }
  th {
    font: 700 0.78rem/1.2 "IBM Plex Sans", "Avenir Next", Helvetica, sans-serif;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--muted);
  }
  .section-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
    gap: 1rem;
  }
  .status-pill {
    display: inline-block;
    padding: 0.28rem 0.6rem;
    border-radius: 999px;
    background: #ecfeff;
    border: 1px solid #99f6e4;
    color: #115e59;
    font: 700 0.8rem/1 "IBM Plex Sans", "Avenir Next", Helvetica, sans-serif;
    text-transform: uppercase;
    letter-spacing: 0.08em;
  }
  pre {
    margin: 0;
    padding: 1rem;
    background: #0f172a;
    color: #e2e8f0;
    border-radius: 14px;
    overflow: auto;
    white-space: pre-wrap;
    word-break: break-word;
    font: 0.84rem/1.45 "SFMono-Regular", Menlo, Consolas, monospace;
  }
  @media print {
    body {
      background: #fff;
      padding: 0;
    }
    .hero, section {
      box-shadow: none;
      break-inside: avoid;
    }
  }
</style>
</head>
<body>
<main>
  <section class="hero">
    <div class="eyebrow">TaxVault Review Packet</div>
    <h1>${escapeHtml(headline.label)}</h1>
    <div class="amount">${escapeHtml(headline.amount)}</div>
    <p class="hero-note">${escapeHtml(headline.note)}</p>
    <p class="muted">Generated locally on ${escapeHtml(formatReviewPacketTimestamp(envelope.exportedAt))}. This packet is for review only and is not a filing-ready return.</p>
  </section>

  <section>
    <h2>Estimate Summary</h2>
    <div class="grid">
      ${summaryCards
        .map(
          ([label, value]) => `<div class="card"><div class="label">${escapeHtml(label)}</div><div>${escapeHtml(value)}</div></div>`
        )
        .join("")}
    </div>
  </section>

  <section>
    <h2>Estimate Readiness</h2>
    <div class="section-grid">
      <div class="card">
        <div class="label">Status</div>
        <div class="status-pill">${escapeHtml(
          supportReview ? supportReviewBadgeLabel(supportReview.status) : "Unavailable"
        )}</div>
        <p>${escapeHtml(supportReview?.summary || "TaxVault did not capture a support review summary for this export.")}</p>
      </div>
      <div class="card">
        <div class="label">Blocking Issues</div>
        ${renderReviewPacketList(supportReview?.blockingIssues)}
      </div>
      <div class="card">
        <div class="label">Cautions</div>
        ${renderReviewPacketList(supportReview?.cautions)}
      </div>
    </div>
  </section>

  <section>
    <h2>Scope and Metadata</h2>
    ${renderReviewPacketTable(
      ["Field", "Value"],
      [
        ["Estimate Scope", meta.estimate_scope || "Unavailable"],
        ["Tax Table Status", meta ? formatTaxTableStatus(meta) : "Unavailable"],
        ["Rule Pack", meta.rule_pack_version ? `Federal rules version ${meta.rule_pack_version}` : "Unavailable"],
        ["Privacy", meta.privacy || "Unavailable"],
      ]
    )}
    <div class="card" style="margin-top: 0.9rem;">
      <div class="label">Scope Limits</div>
      ${renderReviewPacketList(meta.scope_limits)}
    </div>
  </section>

  <section>
    <h2>Entered Inputs</h2>
    <div class="section-grid">
      <div class="card">
        <div class="label">Input Counts</div>
        ${renderReviewPacketTable(["Field", "Value"], inputRows)}
      </div>
      <div class="card">
        <div class="label">Adjustments &amp; Payments</div>
        ${renderReviewPacketTable(["Entry", "Entered Amount"], adjustmentRows)}
      </div>
    </div>
    <div class="section-grid" style="margin-top: 1rem;">
      <div class="card">
        <div class="label">Dependents</div>
        ${renderReviewPacketTable(["Name", "DOB", "Relationship", "Months in Home"], dependentRows)}
      </div>
      <div class="card">
        <div class="label">W-2 Forms</div>
        ${renderReviewPacketTable(["Employer", "Recipient", "Wages", "Federal Withholding"], w2Rows)}
      </div>
    </div>
    <div class="section-grid" style="margin-top: 1rem;">
      <div class="card">
        <div class="label">1099-INT Forms</div>
        ${renderReviewPacketTable(["Institution", "Recipient", "Taxable Interest", "Tax-Exempt Interest"], interestRows)}
      </div>
      <div class="card">
        <div class="label">1099-DIV Forms</div>
        ${renderReviewPacketTable(["Institution", "Recipient", "Ordinary Dividends", "Qualified Dividends"], dividendRows)}
      </div>
    </div>
    <div class="card" style="margin-top: 1rem;">
      <div class="label">SSA-1099 Forms</div>
      ${renderReviewPacketTable(["Recipient", "Total Benefits", "Voluntary Withholding"], socialSecurityRows)}
    </div>
  </section>

  <section>
    <h2>Tax Breakdown</h2>
    ${renderReviewPacketTable(["Line Item", "Amount"], breakdownTableRows)}
  </section>

  <section>
    <h2>Draft Form 1040 Lines</h2>
    ${renderReviewPacketTable(["Form Line", "Value"], lineRows)}
  </section>

  <section>
    <h2>Calculation Trace</h2>
    <pre>${escapeHtml(estimate.trace || "Trace unavailable.")}</pre>
  </section>
</main>
</body>
</html>`;
}

function syncResultExportButtons() {
  const disabled = !state.lastComputedResult;

  if (els.exportAuditBtn) {
    els.exportAuditBtn.disabled = disabled;
    els.exportAuditBtn.setAttribute("aria-disabled", String(disabled));
  }

  if (els.exportReviewPacketBtn) {
    els.exportReviewPacketBtn.disabled = disabled;
    els.exportReviewPacketBtn.setAttribute("aria-disabled", String(disabled));
  }

  if (els.exportSupportSnapshotBtn) {
    els.exportSupportSnapshotBtn.disabled = disabled;
    els.exportSupportSnapshotBtn.setAttribute("aria-disabled", String(disabled));
  }
}

function exportAuditTrailToFile() {
  hideError();
  const envelope = buildCurrentAuditTrailEnvelope();
  if (!envelope) {
    showError("Calculate a supported return before exporting an audit trail.");
    return;
  }

  if (
    !tryDownloadJsonFile(
      JSON.stringify(envelope, null, 2),
      auditTrailExportFilename(envelope),
      "audit trail export"
    )
  ) {
    return;
  }
  announceUiStatus("Audit trail exported.");
}

function exportSupportSnapshotToFile() {
  hideError();
  const envelope = buildCurrentSupportSnapshotEnvelope();
  if (!envelope) {
    showError("Calculate a supported return before exporting a support snapshot.");
    return;
  }

  if (
    !tryDownloadJsonFile(
      JSON.stringify(envelope, null, 2),
      supportSnapshotExportFilename(envelope),
      "support snapshot export"
    )
  ) {
    return;
  }
  announceUiStatus("Support snapshot exported.");
}

function exportReviewPacketToFile() {
  hideError();
  const envelope = buildCurrentAuditTrailEnvelope();
  if (!envelope) {
    showError("Calculate a supported return before exporting a review packet.");
    return;
  }

  const html = buildReviewPacketHtml(envelope);
  if (
    !tryDownloadFile(
      html,
      reviewPacketExportFilename(envelope),
      "text/html",
      "review packet export"
    )
  ) {
    return;
  }
  announceUiStatus("Review packet exported.");
}

function openDraftImportPicker() {
  hideError();
  if (!els.importDraftInput) {
    return;
  }

  els.importDraftInput.value = "";
  els.importDraftInput.click();
}

function readTextFromFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Could not read the selected draft file."));
    reader.onload = () => resolve(typeof reader.result === "string" ? reader.result : "");
    reader.readAsText(file);
  });
}

async function handleImportDraftFileSelection(event) {
  const input = event.target;
  const [file] = Array.from(input?.files || []);
  if (!file) {
    return;
  }

  hideError();

  try {
    if (file.size > MAX_DRAFT_IMPORT_FILE_SIZE) {
      showError(`Draft files over 5 MB cannot be imported. Choose a smaller TaxVault draft JSON file.`);
      return;
    }

    const rawText = await readTextFromFile(file);
    let parsedDraft;
    try {
      parsedDraft = JSON.parse(rawText);
    } catch {
      showError(`Could not read ${file.name}. Choose a valid TaxVault draft JSON file.`);
      return;
    }

    const result = importDraftValue(parsedDraft);
    if (!result.ok) {
      showError(result.message);
    }
  } catch (error) {
    showError(`Unable to import ${file.name}: ${safeMessage(error)}`);
  } finally {
    if (input) {
      input.value = "";
    }
  }
}

function printDraftReturn() {
  if (els.printDraftBtn.disabled) {
    showError("Calculate a supported return before printing a draft preview.");
    return;
  }

  if (typeof window.print !== "function") {
    showError("Printing is not available in this browser.");
    return;
  }

  hideError();
  window.print();
}

function clearAllData() {
  if (!window.confirm("Clear all entered personal data, tax inputs, and results from this page?")) {
    return;
  }

  window.clearTimeout(draftSaveTimer);
  hideError();
  resetSupportReview();
  resetComputedEstimate();
  cleanupReferencePreviews(els.app);
  document.getElementById("pFirst").value = "";
  document.getElementById("pLast").value = "";
  document.getElementById("pSsn").value = "";
  document.getElementById("pDob").value = "";
  document.getElementById("pBlind").checked = false;
  if (els.pDependent) {
    els.pDependent.checked = false;
  }

  document.getElementById("sFirst").value = "";
  document.getElementById("sLast").value = "";
  document.getElementById("sSsn").value = "";
  document.getElementById("sDob").value = "";
  document.getElementById("sBlind").checked = false;
  if (els.sDependent) {
    els.sDependent.checked = false;
  }
  els.traditionalIraDeduction.value = "";
  els.hsaDeduction.value = "";
  els.studentLoanInterestPaid.value = "";
  if (els.studentLoanQualifiedLoan) {
    els.studentLoanQualifiedLoan.checked = false;
  }
  if (els.studentLoanLegallyObligated) {
    els.studentLoanLegallyObligated.checked = false;
  }
  els.estimatedTaxPayments.value = "";

  els.w2Container.replaceChildren();
  els.socialSecurityContainer.replaceChildren();
  els.interestContainer.replaceChildren();
  els.dividendContainer.replaceChildren();
  els.dependentContainer.replaceChildren();
  renderIncomeSummaryChips();

  state.currentStep = 1;
  state.w2Count = 0;
  state.socialSecurityCount = 0;
  state.interestCount = 0;
  state.dividendCount = 0;
  state.dependentCount = 0;

  selectStatus("single");
  goToStep(1);

  document.querySelectorAll(".ssn-field").forEach((field) => {
    const input = field.querySelector(".ssn-input");
    const toggle = field.querySelector(".ssn-toggle");
    setSsnVisibility(input, toggle, false);
  });

  state.safetyAcknowledged = false;
  state.draftEnvelopeCreatedAt = null;
  state.lastDraftSavedAt = null;
  els.gateAcknowledge.checked = false;
  updateGateButtonState();
  els.app.classList.add("hidden");
  clearAllStoredTaxVaultData();
  if (els.rememberDraftToggle) {
    els.rememberDraftToggle.checked = false;
  }
  refreshStorageStatus("Saved draft cleared from this tab and this device.");
  announceUiStatus("All draft data cleared.");
  showDisclaimerGate();
}

function todayIsoDate() {
  return isoDateFormatter.format(new Date());
}

function createElement(tagName, { className = "", text = "", attributes = {} } = {}) {
  const element = document.createElement(tagName);

  if (className) {
    element.className = className;
  }

  Object.entries(attributes).forEach(([name, value]) => {
    if (value !== undefined && value !== null && value !== "") {
      element.setAttribute(name, String(value));
    }
  });

  if (text) {
    element.textContent = text;
  }

  return element;
}

function createSvgElement(tagName, attributes = {}) {
  const element = document.createElementNS("http://www.w3.org/2000/svg", tagName);

  Object.entries(attributes).forEach(([name, value]) => {
    element.setAttribute(name, String(value));
  });

  return element;
}

/* ── Local Form Preview ── */

const ACCEPTED_TYPES = ".pdf,.png,.jpg,.jpeg,.gif,.heic,.heif,.webp,.avif";
const PDF_SIGNATURE = [0x25, 0x50, 0x44, 0x46];
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const JPEG_SIGNATURE = [0xff, 0xd8, 0xff];
const GIF87A_SIGNATURE = [0x47, 0x49, 0x46, 0x38, 0x37, 0x61];
const GIF89A_SIGNATURE = [0x47, 0x49, 0x46, 0x38, 0x39, 0x61];
const WEBP_RIFF_SIGNATURE = [0x52, 0x49, 0x46, 0x46];
const WEBP_FORMAT_SIGNATURE = [0x57, 0x45, 0x42, 0x50];
const ISO_BMFF_IMAGE_BRANDS = new Set([
  "avif",
  "avis",
  "heic",
  "heix",
  "hevc",
  "hevx",
  "heif",
  "mif1",
  "msf1",
]);

function releasePreviewBlobUrl(target) {
  const blobUrl = target?.dataset?.blobUrl;
  if (blobUrl) {
    URL.revokeObjectURL(blobUrl);
    delete target.dataset.blobUrl;
  }
}

function cleanupReferencePreviews(root) {
  root.querySelectorAll("[data-blob-url]").forEach((previewItem) => releasePreviewBlobUrl(previewItem));
}

function getReferencePreviewKind(file) {
  const lowerName = file.name.toLowerCase();

  if (file.type === "application/pdf" || lowerName.endsWith(".pdf")) {
    return "pdf";
  }

  if (
    (typeof file.type === "string" && file.type.startsWith("image/")) ||
    /\.(png|jpe?g|gif|heic|heif|webp|avif)$/i.test(lowerName)
  ) {
    return "image";
  }

  return null;
}

function getReferenceFileKey(file) {
  return [file.name, file.size, file.lastModified].join(":");
}

function bytesStartWith(bytes, signature) {
  return signature.every((value, index) => bytes[index] === value);
}

function asciiFromBytes(bytes, start, length) {
  return Array.from(bytes.slice(start, start + length))
    .map((value) => String.fromCharCode(value))
    .join("");
}

function isIsoBmffImage(bytes) {
  return bytes.length >= 12
    && asciiFromBytes(bytes, 4, 4) === "ftyp"
    && ISO_BMFF_IMAGE_BRANDS.has(asciiFromBytes(bytes, 8, 4));
}

function isRecognizedImageSignature(bytes) {
  return (
    bytesStartWith(bytes, PNG_SIGNATURE)
    || bytesStartWith(bytes, JPEG_SIGNATURE)
    || bytesStartWith(bytes, GIF87A_SIGNATURE)
    || bytesStartWith(bytes, GIF89A_SIGNATURE)
    || (
      bytesStartWith(bytes, WEBP_RIFF_SIGNATURE)
      && asciiFromBytes(bytes, 8, 4) === "WEBP"
    )
    || isIsoBmffImage(bytes)
  );
}

async function readReferenceFileHeader(file, length = 32) {
  try {
    return new Uint8Array(await file.slice(0, length).arrayBuffer());
  } catch {
    return new Uint8Array();
  }
}

async function validateReferenceFile(file) {
  if (file.size > MAX_REFERENCE_FILE_SIZE) {
    return { ok: false, reason: "oversized" };
  }

  const previewKind = getReferencePreviewKind(file);
  if (!previewKind) {
    return { ok: false, reason: "invalid-type" };
  }

  const header = await readReferenceFileHeader(file);
  const contentLooksValid =
    previewKind === "pdf"
      ? bytesStartWith(header, PDF_SIGNATURE)
      : isRecognizedImageSignature(header);

  if (!contentLooksValid) {
    return { ok: false, reason: "invalid-content" };
  }

  return { ok: true, previewKind };
}

function pluralize(count, singular, plural = `${singular}s`) {
  return count === 1 ? singular : plural;
}

function setReferenceFeedback(feedback, message = "", tone = "info") {
  if (!message) {
    feedback.textContent = "";
    feedback.className = "upload-feedback hidden";
    return;
  }

  feedback.textContent = message;
  feedback.className = `upload-feedback ${tone}`;
}

function syncReferencePreviewState(previewSection, previewList, formLabel) {
  const count = previewList.childElementCount;
  const countLabel = previewSection.querySelector(".upload-preview-count");
  const clearButton = previewSection.querySelector(".upload-preview-clear");

  if (count === 0) {
    previewSection.classList.add("hidden");
    countLabel.textContent = "";
    clearButton.hidden = true;
    return;
  }

  countLabel.textContent = `${count} ${formLabel} ${pluralize(count, "reference")} ready on screen.`;
  clearButton.hidden = false;
  previewSection.classList.remove("hidden");
}

function removeReferencePreview(previewItem, previewSection, previewList, formLabel, feedback) {
  const fileName = previewItem.querySelector(".upload-preview-name")?.textContent || "file";
  releasePreviewBlobUrl(previewItem);
  previewItem.remove();
  syncReferencePreviewState(previewSection, previewList, formLabel);
  setReferenceFeedback(feedback);
  announceUiStatus(`Removed ${fileName} from the ${formLabel} reference tray.`);
}

function clearReferencePreviews(previewSection, previewList, formLabel, feedback) {
  const previewItems = Array.from(previewList.children);
  if (!previewItems.length) {
    return;
  }

  previewItems.forEach((previewItem) => {
    releasePreviewBlobUrl(previewItem);
    previewItem.remove();
  });

  syncReferencePreviewState(previewSection, previewList, formLabel);
  setReferenceFeedback(feedback);
  announceUiStatus(`Cleared all local ${formLabel} reference files.`);
}

function createReferencePreviewCard(file, previewKind, fileKey, previewSection, previewList, formLabel, feedback) {
  const blobUrl = URL.createObjectURL(file);
  const previewCard = createElement("div", { className: "upload-preview-card" });
  previewCard.dataset.blobUrl = blobUrl;
  previewCard.dataset.fileKey = fileKey;

  const header = createElement("div", { className: "upload-preview-header" });
  const meta = createElement("div", { className: "upload-preview-meta" });
  const typeBadge = createElement("span", {
    className: `upload-preview-type upload-preview-type-${previewKind}`,
    text: previewKind === "pdf" ? "PDF" : "Image",
  });
  const name = createElement("span", {
    className: "upload-preview-name",
    text: file.name,
  });

  const removeBtn = createButtonElement({
    className: "upload-preview-remove",
    text: "Remove",
  });
  removeBtn.addEventListener("click", () => {
    removeReferencePreview(previewCard, previewSection, previewList, formLabel, feedback);
  });

  meta.append(typeBadge, name);
  header.append(meta, removeBtn);

  const body = createElement("div", { className: "upload-preview-body" });

  if (previewKind === "pdf") {
    const obj = document.createElement("object");
    obj.data = blobUrl;
    obj.type = "application/pdf";
    obj.textContent = "PDF preview not available in this browser.";
    body.appendChild(obj);
  } else {
    const img = document.createElement("img");
    img.src = blobUrl;
    img.alt = `Preview of ${file.name}`;
    body.appendChild(img);
  }

  previewCard.append(header, body);
  return previewCard;
}

async function addReferencePreviews(files, previewSection, previewList, formLabel, feedback) {
  if (!files.length) {
    return;
  }

  const existingKeys = new Set(
    Array.from(previewList.children).map((previewItem) => previewItem.dataset.fileKey)
  );
  const invalidNames = [];
  const invalidContentNames = [];
  const oversizedNames = [];
  let duplicateCount = 0;
  let addedCount = 0;

  for (const file of files) {
    const validation = await validateReferenceFile(file);
    if (!validation.ok) {
      if (validation.reason === "oversized") {
        oversizedNames.push(file.name);
      } else if (validation.reason === "invalid-content") {
        invalidContentNames.push(file.name);
      } else {
        invalidNames.push(file.name);
      }
      continue;
    }

    const fileKey = getReferenceFileKey(file);
    if (existingKeys.has(fileKey)) {
      duplicateCount += 1;
      continue;
    }

    existingKeys.add(fileKey);
    previewList.appendChild(
      createReferencePreviewCard(
        file,
        validation.previewKind,
        fileKey,
        previewSection,
        previewList,
        formLabel,
        feedback
      )
    );
    addedCount += 1;
  }

  syncReferencePreviewState(previewSection, previewList, formLabel);

  if (addedCount > 0) {
    announceUiStatus(
      `Added ${addedCount} ${formLabel} reference ${pluralize(addedCount, "file")} for on-screen review.`
    );
  }

  const feedbackMessages = [];
  let feedbackTone = "info";

  if (invalidNames.length > 0) {
    feedbackTone = "error";
    feedbackMessages.push(
      `Only PDF and image files can be previewed here. Skipped: ${invalidNames.join(", ")}.`
    );
  }

  if (oversizedNames.length > 0) {
    feedbackTone = "error";
    feedbackMessages.push(
      `Files over 50 MB cannot be previewed. Skipped: ${oversizedNames.join(", ")}.`
    );
  }

  if (invalidContentNames.length > 0) {
    feedbackTone = "error";
    feedbackMessages.push(
      `Some files did not match a supported PDF or image signature and were skipped: ${invalidContentNames.join(", ")}.`
    );
  }

  if (duplicateCount > 0) {
    feedbackMessages.push(
      `Skipped ${duplicateCount} duplicate ${pluralize(duplicateCount, "file")} already in this tray.`
    );
  }

  setReferenceFeedback(feedback, feedbackMessages.join(" "), feedbackTone);
}

function createReferenceZone(formLabel) {
  const wrapper = document.createElement("div");
  wrapper.className = "upload-zone-wrapper";

  const zone = document.createElement("div");
  zone.className = "upload-zone";
  zone.setAttribute("role", "button");
  zone.setAttribute(
    "aria-label",
    `Choose one or more local ${formLabel} PDFs or images to preview on screen`
  );
  zone.setAttribute("tabindex", "0");
  const icon = createSvgElement("svg", {
    class: "upload-zone-icon",
    width: 28,
    height: 28,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    "stroke-width": 2,
    "stroke-linecap": "round",
    "stroke-linejoin": "round",
    "aria-hidden": "true",
  });
  icon.append(
    createSvgElement("path", { d: "M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" }),
    createSvgElement("polyline", { points: "17 8 12 3 7 8" }),
    createSvgElement("line", { x1: 12, y1: 3, x2: 12, y2: 15 })
  );

  const zoneText = createElement("div", { className: "upload-zone-text" });
  zoneText.append("Add local ");
  const emphasizedLabel = document.createElement("strong");
  emphasizedLabel.textContent = formLabel;
  zoneText.append(emphasizedLabel, " PDFs or images (optional)");

  const zoneHint = createElement("div", {
    className: "upload-zone-hint",
    text: "Multiple files supported. On-screen reference only. TaxVault does not read or import fields from files.",
  });

  zone.append(icon, zoneText, zoneHint);

  const fileInput = document.createElement("input");
  fileInput.type = "file";
  fileInput.accept = ACCEPTED_TYPES;
  fileInput.multiple = true;
  fileInput.setAttribute("aria-hidden", "true");
  zone.appendChild(fileInput);

  const feedback = createElement("div", {
    className: "upload-feedback hidden",
    attributes: { "aria-live": "polite" },
  });

  const preview = createElement("div", { className: "upload-preview-container hidden" });
  const previewToolbar = createElement("div", { className: "upload-preview-toolbar" });
  const previewCount = createElement("div", { className: "upload-preview-count" });
  const clearBtn = createButtonElement({
    className: "upload-preview-clear",
    text: "Remove all",
  });
  clearBtn.hidden = true;
  clearBtn.addEventListener("click", () => {
    clearReferencePreviews(preview, previewList, formLabel, feedback);
  });
  previewToolbar.append(previewCount, clearBtn);

  const previewList = createElement("div", { className: "upload-preview-list" });
  preview.append(previewToolbar, previewList);

  zone.addEventListener("click", () => fileInput.click());
  zone.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      fileInput.click();
    }
  });

  zone.addEventListener("dragover", (e) => {
    e.preventDefault();
    zone.classList.add("dragover");
  });
  zone.addEventListener("dragleave", () => zone.classList.remove("dragover"));
  zone.addEventListener("drop", (e) => {
    e.preventDefault();
    zone.classList.remove("dragover");
    if (e.dataTransfer.files.length > 0) {
      void addReferencePreviews(
        Array.from(e.dataTransfer.files),
        preview,
        previewList,
        formLabel,
        feedback
      );
    }
  });

  fileInput.addEventListener("change", () => {
    if (fileInput.files.length > 0) {
      void addReferencePreviews(
        Array.from(fileInput.files),
        preview,
        previewList,
        formLabel,
        feedback
      );
      fileInput.value = "";
    }
  });

  wrapper.append(zone, feedback, preview);
  return wrapper;
}

if (typeof window !== "undefined" && testingHooksEnabled()) {
  window.__taxvaultTesting = Object.freeze({
    goToStep,
    importDraftValue,
    renderResults,
    getRuntimeConfig: () => ({
      selectedTaxYear: currentTaxYear(),
      supportedTaxYears: state.supportedTaxYears.map((entry) => ({ ...entry })),
    }),
    exportCurrentDraftEnvelope: () => buildStoredDraftEnvelope(captureDraftSnapshot()),
    exportCurrentAuditTrail: () => buildCurrentAuditTrailEnvelope(),
    exportCurrentSupportSnapshot: () => buildCurrentSupportSnapshotEnvelope(),
    exportCurrentReviewPacketHtml: () => buildReviewPacketHtml(buildCurrentAuditTrailEnvelope()),
  });
}
