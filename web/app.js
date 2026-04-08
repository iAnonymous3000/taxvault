import init, { compute_tax, get_app_config, review_tax_input } from "./pkg/taxvault_wasm.js";
import { createCardModule } from "./modules/cards.js";
import { createDraftHelpers } from "./modules/draft_helpers.js";
import { createExportModule } from "./modules/exports.js";
import { createDraftFormState } from "./modules/form_state.js";
import { buildPayloadFromSnapshot, validateStep1Snapshot } from "./modules/tax_input.js";
import {
  buildSupportReviewSnapshot as buildSupportReviewSnapshotFromModule,
  dedupeMessages as dedupeMessagesFromModule,
  normalizeSupportReviewSnapshot as normalizeSupportReviewSnapshotFromModule,
  supportReviewBadgeLabel as supportReviewBadgeLabelFromModule,
} from "./modules/support_review.js";

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
  lastDraftSessionSaveSucceeded: true,
  lastDraftLocalSaveSucceeded: true,
  lastDraftAttemptedLocalSave: false,
  draftSnapshotDirty: true,
  lastCapturedDraftSnapshot: null,
  lastSupportReview: null,
  supportReviewStale: false,
  lastBuiltPayloadResult: null,
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

const draftFormState = createDraftFormState({
  state,
  els,
  readFilerInputs,
  readTrimmedControlValue,
  readControlValue,
  readQueryValue,
  readTrimmedQueryValue,
});

const draftHelpers = createDraftHelpers({
  constants: {
    APP_VERSION,
    DRAFT_ENVELOPE_VERSION,
    DRAFT_FILE_TYPE,
    ISO_DATE_RE,
    LEGACY_DRAFT_STORAGE_VERSION,
    MAX_DEPENDENTS,
    MAX_DIVIDEND_FORMS,
    MAX_INTEREST_FORMS,
    MAX_SOCIAL_SECURITY_FORMS,
    MAX_TEXT_FIELD_LENGTH,
    MAX_W2_FORMS,
  },
  currentTaxYear,
  normalizeTaxYear,
  isSupportedTaxYear,
  supportedTaxYearEntries,
  normalizeFilingStatus,
  normalizeIncomeRecipient,
  normalizeDependentRelationship,
  normalizeDraftStep,
  isPlainObject,
});

const cardModule = createCardModule({
  els,
  state,
  constants: {
    DATE_INPUT_MIN,
    DEPENDENT_RELATIONSHIP_OPTIONS,
    MAX_DEPENDENTS,
    MAX_DIVIDEND_FORMS,
    MAX_INTEREST_FORMS,
    MAX_REFERENCE_FILE_SIZE,
    MAX_SOCIAL_SECURITY_FORMS,
    MAX_TEXT_FIELD_LENGTH,
    MAX_W2_FORMS,
  },
  helpers: {
    announceUiStatus,
    applyDateConstraints,
    createElement,
    createSvgElement,
    focusElement,
    focusFirstField,
    hideError,
    initializeSsnFields,
    nextFocusTargetAfterRemoval,
    resetComputedEstimate,
    scheduleDraftSave,
    scheduleSupportReview,
    setSsnVisibility,
    showError,
    todayIsoDate,
  },
});

const exportModule = createExportModule({
  constants: {
    APP_VERSION,
    AUDIT_TRAIL_FILE_TYPE,
    AUDIT_TRAIL_VERSION,
    DOWNLOAD_BLOB_URL_REVOKE_DELAY_MS,
    SUPPORT_SNAPSHOT_FILE_TYPE,
    SUPPORT_SNAPSHOT_VERSION,
  },
  currentTaxYear,
  normalizeTaxYear,
  buildBreakdownRows,
  normalizeSupportReviewSnapshot,
  sanitizeDraftSnapshotForRestore,
  buildAnonymizedSupportInputSnapshot,
  redactSupportSnapshotEnvelope,
  isPlainObject,
  reviewPacketHelpers: {
    escapeHtml,
    formatDependentRelationshipLabel,
    formatDraftPerson,
    formatFilingStatusLabel,
    formatIncomeRecipientLabel,
    formatLineValue,
    formatReviewPacketTimestamp,
    formatTaxTableStatus,
    isPlainObject,
    sortedLineKeys,
    summarizeEstimateHeadline,
    supportReviewBadgeLabel,
  },
});

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
  els.app.addEventListener("click", handleAppClick);
  els.app.addEventListener("input", handleAppFieldMutation);
  els.app.addEventListener("change", handleAppFieldMutation);
  els.app.addEventListener("paste", handleAppFieldPaste);
  els.app.addEventListener("focusout", handleAppFieldBlur);
  document.addEventListener("keydown", handleDocumentKeydown);

  initializeSsnFields(document);
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

function setDraftSaveOutcome({
  sessionSaved = true,
  localSaved = true,
  attemptedLocal = false,
} = {}) {
  state.lastDraftSessionSaveSucceeded = Boolean(sessionSaved);
  state.lastDraftLocalSaveSucceeded = Boolean(localSaved);
  state.lastDraftAttemptedLocalSave = Boolean(attemptedLocal);
}

function resetDraftSaveOutcome() {
  setDraftSaveOutcome();
}

function currentDraftStatusMessage() {
  const taxYear = currentTaxYear();
  const sessionSaved = state.lastDraftSessionSaveSucceeded;
  const attemptedLocal = state.lastDraftAttemptedLocalSave;
  const localSaved = state.lastDraftLocalSaveSucceeded;

  if (!sessionSaved && (!attemptedLocal || !localSaved)) {
    return "TaxVault couldn't save the current draft in browser storage. Keep this tab open or export a draft file.";
  }

  if (rememberDraftEnabled()) {
    if (sessionSaved && localSaved) {
      return `Tax year ${taxYear} draft autosaves in this tab and stays on this device until you clear it.`;
    }

    if (sessionSaved && !localSaved) {
      return `Tax year ${taxYear} draft autosaves in this tab, but TaxVault couldn't keep it on this device. Export a draft file if you need a backup.`;
    }

    if (!sessionSaved && localSaved) {
      return `Tax year ${taxYear} draft stays on this device, but this browser session could not keep a tab autosave copy.`;
    }
  }

  return `Tax year ${taxYear} draft autosaves in this tab and clears when the tab closes.`;
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
    persistDraftSnapshot();
    refreshStorageStatus();
    announceUiStatus(
      state.lastDraftLocalSaveSucceeded
        ? "Draft persistence enabled for this device."
        : "TaxVault could not keep this draft on the device right now."
    );
    return;
  }

  removeStoredValue(localStorageRef, draftPreferenceStorageKey());
  removeStoredValue(localStorageRef, draftLocalStorageKey());
  persistDraftSnapshot();
  refreshStorageStatus();
  announceUiStatus(
    state.lastDraftSessionSaveSucceeded
      ? "Device draft persistence disabled."
      : "Device draft persistence disabled, but this browser session could not autosave the current draft."
  );
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

  setStorageStatusText(currentDraftStatusMessage());
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

  if (!state.lastDraftSessionSaveSucceeded && (!state.lastDraftAttemptedLocalSave || !state.lastDraftLocalSaveSucceeded)) {
    els.storageTrustCopy.textContent =
      "This browser could not save the current draft in storage. Export a draft file if you need a backup.";
    return;
  }

  if (rememberDraftEnabled() && state.lastDraftAttemptedLocalSave && !state.lastDraftLocalSaveSucceeded) {
    els.storageTrustCopy.textContent =
      "TaxVault is keeping this draft only in the current tab right now because device storage failed.";
    return;
  }

  if (rememberDraftEnabled() && !state.lastDraftSessionSaveSucceeded && state.lastDraftLocalSaveSucceeded) {
    els.storageTrustCopy.textContent =
      "TaxVault kept this draft on the device, but tab-only autosave failed in this browser session.";
    return;
  }

  els.storageTrustCopy.textContent = rememberDraftEnabled()
    ? `Your tax year ${currentTaxYear()} draft autosaves in this tab and stays on this device until you clear it.`
    : `By default your tax year ${currentTaxYear()} draft autosaves only in this tab and clears when the tab closes.`;
}

function renderIncomeSummaryChips() {
  return cardModule.renderIncomeSummaryChips();
}

function countEnteredFormCards() {
  return cardModule.countEnteredFormCards();
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
  return draftHelpers.snapshotHasUserData(snapshot);
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
  return draftFormState.captureDraftSnapshot();
}

function stripPiiFromSnapshot(snapshot) {
  return draftHelpers.stripPiiFromSnapshot(snapshot);
}

function buildAnonymizedSupportInputSnapshot(snapshot, taxYear) {
  return draftHelpers.buildAnonymizedSupportInputSnapshot(snapshot, taxYear);
}

function redactSupportSnapshotEnvelope(envelope, rawSnapshot) {
  return draftHelpers.redactSupportSnapshotEnvelope(envelope, rawSnapshot);
}

function buildDraftEnvelope(snapshot, { createdAt, updatedAt, piiRedacted = true, taxYear } = {}) {
  return draftHelpers.buildDraftEnvelope(snapshot, { createdAt, updatedAt, piiRedacted, taxYear });
}

function looksLikeDraftEnvelope(value) {
  return draftHelpers.looksLikeDraftEnvelope(value);
}

function looksLikeLegacyDraftSnapshot(value) {
  return draftHelpers.looksLikeLegacyDraftSnapshot(value);
}

function buildStoredDraftEnvelope(snapshot, { createdAt, taxYear } = {}) {
  return draftHelpers.buildStoredDraftEnvelope(snapshot, {
    createdAt,
    taxYear,
    draftEnvelopeCreatedAt: state.draftEnvelopeCreatedAt,
  });
}

function clearStoredDraftData({ refreshStatus = true, taxYear = currentTaxYear() } = {}) {
  const sessionStorageRef = storageFor("session");
  const localStorageRef = storageFor("local");
  removeStoredValue(sessionStorageRef, draftSessionStorageKey(taxYear));
  removeStoredValue(localStorageRef, draftLocalStorageKey(taxYear));
  state.draftEnvelopeCreatedAt = null;
  state.lastDraftSavedAt = null;
  resetDraftSaveOutcome();

  if (refreshStatus) {
    refreshStorageStatus();
  }
}

function storeDraftEnvelope(envelope, { refreshStatus = true } = {}) {
  const sessionStorageRef = storageFor("session");
  const localStorageRef = storageFor("local");
  const serialized = JSON.stringify(envelope);
  const taxYear = normalizeTaxYear(envelope?.taxYear);
  const sessionKey = draftSessionStorageKey(taxYear);
  const localKey = draftLocalStorageKey(taxYear);
  const preferenceKey = draftPreferenceStorageKey(taxYear);
  const attemptedLocalSave = rememberDraftEnabled();
  const sessionSaved = writeStoredValue(sessionStorageRef, sessionKey, serialized);
  let localSaved = true;

  if (!sessionSaved) {
    removeStoredValue(sessionStorageRef, sessionKey);
  }

  if (attemptedLocalSave) {
    const preferenceSaved = writeStoredValue(localStorageRef, preferenceKey, "true");
    const draftSaved = writeStoredValue(localStorageRef, localKey, serialized);
    localSaved = preferenceSaved && draftSaved;
    if (!localSaved) {
      removeStoredValue(localStorageRef, localKey);
    }
  } else {
    removeStoredValue(localStorageRef, localKey);
  }

  setDraftSaveOutcome({
    sessionSaved,
    localSaved,
    attemptedLocal: attemptedLocalSave,
  });

  state.draftEnvelopeCreatedAt =
    typeof envelope.createdAt === "string" && envelope.createdAt ? envelope.createdAt : null;
  state.lastDraftSavedAt =
    (sessionSaved || (attemptedLocalSave && localSaved)) &&
    typeof envelope.updatedAt === "string" &&
    envelope.updatedAt
      ? envelope.updatedAt
      : null;

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
  return draftHelpers.sanitizeDraftSnapshotForRestore(snapshot);
}

function buildEmptyDraftSnapshot() {
  return draftHelpers.buildEmptyDraftSnapshot();
}

function prepareDraftEnvelopeForRestore(rawDraft) {
  return draftHelpers.prepareDraftEnvelopeForRestore(rawDraft);
}

function draftRestoreMessage(hadResults, action = "restored") {
  return draftHelpers.draftRestoreMessage(hadResults, action);
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
    draftFormState.syncFromDom();
    const step1Validation = validateStep1();
    const nextStep = snapshot.currentStep === 2 && step1Validation.messages.length === 0 ? 2 : 1;
    goToStep(nextStep);
    hideError();
  } finally {
    draftRestoreInProgress = false;
  }
}

function clearRestorableCards() {
  cardModule.clearRestorableCards();
  draftFormState.syncFromDom();
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
}

function restoreDependents(dependents) {
  cardModule.restoreDependents(dependents);
}

function restoreW2Cards(w2s) {
  cardModule.restoreW2Cards(w2s);
}

function restoreSocialSecurityCards(items) {
  cardModule.restoreSocialSecurityCards(items);
}

function restoreInterestCards(items) {
  cardModule.restoreInterestCards(items);
}

function restoreDividendCards(items) {
  cardModule.restoreDividendCards(items);
}

function initializeSsnFields(root) {
  root.querySelectorAll(".ssn-field").forEach((field) => {
    const input = field.querySelector(".ssn-input");
    const toggle = field.querySelector(".ssn-toggle");
    if (!(input instanceof HTMLInputElement) || !(toggle instanceof HTMLButtonElement)) {
      return;
    }

    setSsnVisibility(input, toggle, false);
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
    addDependent({ focusNewCard: false });
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
  draftFormState.syncFromDom();
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
  return validateStep1Snapshot({
    snapshot: captureDraftSnapshot(),
    filingStatus: state.filingStatus,
    ssnPattern: SSN_PATTERN,
    supportedHohRelationships: SUPPORTED_HOH_QUALIFYING_RELATIONSHIPS,
  });
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

function getInlineBaseFieldValidationMessage(control, value) {
  switch (control.id) {
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
      return null;
  }
}

function isW2IncomeCard(card) {
  return Boolean(
    card?.classList.contains("w2-card")
    && !card.classList.contains("ssa-card")
    && !card.classList.contains("interest-card")
    && !card.classList.contains("dividend-card")
  );
}

function getDependentInlineValidationMessage(control, card, value) {
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
    return Number.isInteger(months) && months >= 0 && months <= 12 ? "" : "Enter 0-12";
  }

  return "";
}

function getW2InlineValidationMessage(control, card, value) {
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

  return "";
}

function getInterestInlineValidationMessage(control, card, value) {
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
    if (
      Number.isFinite(taxableInterest)
      && Number.isFinite(taxExemptInterest)
      && taxableInterest === 0
      && taxExemptInterest === 0
    ) {
      return "Enter taxable or tax-exempt interest";
    }
  }

  return "";
}

function getSocialSecurityInlineValidationMessage(control, card, value) {
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

  return "";
}

function getDividendInlineValidationMessage(control, card, value) {
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

  return "";
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
  const baseFieldMessage = getInlineBaseFieldValidationMessage(control, value);
  if (baseFieldMessage !== null) {
    return baseFieldMessage;
  }

  const card = control.closest(".w2-card, .ssa-card, .interest-card, .dividend-card, .dependent-card");

  if (card?.classList.contains("dependent-card")) {
    return getDependentInlineValidationMessage(control, card, value);
  }

  if (isW2IncomeCard(card)) {
    return getW2InlineValidationMessage(control, card, value);
  }

  if (card?.classList.contains("interest-card")) {
    return getInterestInlineValidationMessage(control, card, value);
  }

  if (card?.classList.contains("ssa-card")) {
    return getSocialSecurityInlineValidationMessage(control, card, value);
  }

  if (card?.classList.contains("dividend-card")) {
    return getDividendInlineValidationMessage(control, card, value);
  }

  return "";
}

function handleAppFieldBlur(event) {
  const target = event.target;
  if (!(target instanceof HTMLElement) || !els.app.contains(target)) {
    return;
  }

  if (target instanceof HTMLInputElement && target.classList.contains("money-input")) {
    normalizeMoneyField(target);
    draftFormState.handleFieldMutation(target);
  }

  const message = getInlineFieldValidationMessage(target);
  setInlineErrorForControl(target, message);
}

function renderLoadingError(message) {
  els.loading.replaceChildren(
    createElement("div", { className: "error-banner", text: message })
  );
}

function addW2(options = {}) {
  const card = cardModule.addW2(options);
  if (card) {
    draftFormState.syncFromDom();
  }
  return card;
}

function addSocialSecurity(options = {}) {
  const card = cardModule.addSocialSecurity(options);
  if (card) {
    draftFormState.syncFromDom();
  }
  return card;
}

function addInterest(options = {}) {
  const card = cardModule.addInterest(options);
  if (card) {
    draftFormState.syncFromDom();
  }
  return card;
}

function addDividend(options = {}) {
  const card = cardModule.addDividend(options);
  if (card) {
    draftFormState.syncFromDom();
  }
  return card;
}

function addDependent({ focusNewCard = true, batched = false } = {}) {
  const card = cardModule.addDependent({ focusNewCard, batched });
  if (card) {
    draftFormState.syncFromDom();
  }
  return card;
}

function updateRemoveButtons() {
  return cardModule.updateRemoveButtons();
}

function updateInterestRemoveButtons() {
  return cardModule.updateInterestRemoveButtons();
}

function updateSocialSecurityRemoveButtons() {
  return cardModule.updateSocialSecurityRemoveButtons();
}

function updateDividendRemoveButtons() {
  return cardModule.updateDividendRemoveButtons();
}

function updateDependentRemoveButtons() {
  return cardModule.updateDependentRemoveButtons();
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

function handleAppClick(event) {
  const button = event.target instanceof Element ? event.target.closest("button") : null;
  if (!(button instanceof HTMLButtonElement) || !els.app.contains(button)) {
    return;
  }

  if (button.classList.contains("ssn-toggle")) {
    const field = button.closest(".ssn-field");
    const input = field?.querySelector(".ssn-input");
    if (!(input instanceof HTMLInputElement)) {
      return;
    }

    const nextVisible = input.type === "password";
    setSsnVisibility(input, button, nextVisible);
    input.focus({ preventScroll: true });
    input.setSelectionRange(input.value.length, input.value.length);
    return;
  }

  if (cardModule.handleCardButtonClick(button)) {
    draftFormState.syncFromDom();
  }
}

function handleAppFieldMutation(event) {
  if (!(event.target instanceof HTMLElement)) {
    return;
  }

  if (event.target instanceof HTMLInputElement && event.target.type === "file") {
    return;
  }

  if (event.type === "input") {
    if (event.target.classList.contains("ssn-input")) {
      event.target.value = formatDigits(event.target.value, [3, 2, 4]);
    }

    if (event.target.classList.contains("w2-ein")) {
      event.target.value = formatDigits(event.target.value, [2, 7]);
    }
  }

  draftFormState.handleFieldMutation(event.target);
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

function handleAppFieldPaste(event) {
  if (!(event.target instanceof HTMLInputElement) || !event.target.classList.contains("money-input")) {
    return;
  }

  window.setTimeout(() => {
    normalizeMoneyField(event.target);
    draftFormState.handleFieldMutation(event.target);
  }, 0);
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

function invalidatePayloadResult() {
  state.lastBuiltPayloadResult = null;
}

function buildPayloadAndCache() {
  const result = buildPayload();
  state.lastBuiltPayloadResult = result;
  return result;
}

function buildSupportReviewSnapshot({ payload, errors }) {
  return buildSupportReviewSnapshotFromModule({
    payload,
    errors,
    reviewInput: review_tax_input,
    safeMessage,
    defaultSummary: SUPPORT_REVIEW_DEFAULT_SUMMARY,
  });
}

function refreshSupportReview() {
  if (state.currentStep !== 2) {
    return;
  }

  if (!state.wasmReady) {
    renderSupportReviewPending("Loading the tax engine so TaxVault can review this draft.");
    return;
  }

  renderSupportReview(buildSupportReviewSnapshot(buildPayloadAndCache()));
}

function resetSupportReview() {
  window.clearTimeout(supportReviewTimer);
  invalidatePayloadResult();
  renderSupportReviewPending(SUPPORT_REVIEW_DEFAULT_SUMMARY);
}

function syncComputeButtonState() {
  els.computeBtn.disabled = !(state.wasmReady && state.supportReviewReadyForEstimate);
  els.computeBtn.setAttribute("aria-disabled", String(els.computeBtn.disabled));
  updateComputeHelpText();
}

function renderSupportReviewPending(summary) {
  renderSupportReview({
    status: "pending",
    readyForEstimate: false,
    summary,
    blockingIssues: [],
    cautions: [],
  });
}

function renderSupportReview(review) {
  const normalizedReview = normalizeSupportReviewSnapshot(review);
  const status = normalizedReview.status;

  state.supportReviewReadyForEstimate = normalizedReview.readyForEstimate;
  state.lastSupportReview = normalizedReview;
  state.supportReviewStale = false;

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
  return normalizeSupportReviewSnapshotFromModule(review);
}

function supportReviewBadgeLabel(status) {
  return supportReviewBadgeLabelFromModule(status);
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
  return dedupeMessagesFromModule(messages);
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

  window.clearTimeout(supportReviewTimer);
  els.supportReviewCard.removeAttribute("aria-busy");

  const payloadResult = state.lastBuiltPayloadResult || buildPayloadAndCache();
  const { payload, errors } = payloadResult;
  if (errors.length > 0) {
    showError(errors);
    return;
  }

  const shouldRefreshSupportReview = state.supportReviewStale || !state.lastSupportReview;
  const supportReview = shouldRefreshSupportReview
    ? buildSupportReviewSnapshot(payloadResult)
    : normalizeSupportReviewSnapshot(state.lastSupportReview);

  if (shouldRefreshSupportReview) {
    renderSupportReview(supportReview);
  }

  if (!supportReview.readyForEstimate) {
    showError("Support Review must show Ready before TaxVault can calculate this draft.");
    return;
  }

  hideError();
  const originalLabel = els.computeBtn.textContent;
  const draftEnvelope = buildStoredDraftEnvelope(captureDraftSnapshot());
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
  return buildPayloadFromSnapshot({
    snapshot: captureDraftSnapshot(),
    filingStatus: state.filingStatus,
    taxYear: currentTaxYear(),
    maxCounts: {
      w2: MAX_W2_FORMS,
      socialSecurity: MAX_SOCIAL_SECURITY_FORMS,
      interest: MAX_INTEREST_FORMS,
      dividend: MAX_DIVIDEND_FORMS,
      dependents: MAX_DEPENDENTS,
    },
    ssnPattern: SSN_PATTERN,
    einPattern: EIN_PATTERN,
    parseMoney,
  });
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
  invalidatePayloadResult();
  state.supportReviewStale = state.currentStep === 2;

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
  return exportModule.makeExportFilename(prefix, envelope, ext, { stampKey });
}

function draftExportFilename(envelope) {
  return exportModule.draftExportFilename(envelope);
}

function auditTrailExportFilename(envelope) {
  return exportModule.auditTrailExportFilename(envelope);
}

function supportSnapshotExportFilename(envelope) {
  return exportModule.supportSnapshotExportFilename(envelope);
}

function reviewPacketExportFilename(envelope) {
  return exportModule.reviewPacketExportFilename(envelope);
}

function downloadFile(contents, fileName, mimeType) {
  return exportModule.downloadFile(contents, fileName, mimeType);
}

function downloadJsonFile(contents, fileName) {
  return exportModule.downloadJsonFile(contents, fileName);
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
  return exportModule.buildEstimateExportSnapshot(result);
}

function buildAuditTrailEnvelope(result, { draftEnvelope = null, supportReview = null } = {}) {
  return exportModule.buildAuditTrailEnvelope(result, { draftEnvelope, supportReview });
}

function buildCurrentAuditTrailEnvelope() {
  return buildAuditTrailEnvelope(state.lastComputedResult, {
    draftEnvelope: state.lastComputedDraftEnvelope,
    supportReview: state.lastComputedSupportReview,
  });
}

function buildSupportSnapshotEnvelope(result, { rawDraftSnapshot = null, supportReview = null } = {}) {
  return exportModule.buildSupportSnapshotEnvelope(result, { rawDraftSnapshot, supportReview });
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

function buildReviewPacketHtml(envelope) {
  return exportModule.buildReviewPacketHtml(envelope);
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
  cleanupReferencePreviews(els.app);
  applyDraftSnapshot(buildEmptyDraftSnapshot());

  document.querySelectorAll(".ssn-field").forEach((field) => {
    const input = field.querySelector(".ssn-input");
    const toggle = field.querySelector(".ssn-toggle");
    setSsnVisibility(input, toggle, false);
  });

  state.safetyAcknowledged = false;
  state.draftEnvelopeCreatedAt = null;
  state.lastDraftSavedAt = null;
  resetDraftSaveOutcome();
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

function cleanupReferencePreviews(root) {
  return cardModule.cleanupReferencePreviews(root);
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
