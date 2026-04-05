import init, { compute_tax, review_tax_input } from "./pkg/taxvault_wasm.js";

const SSN_PATTERN = /^\d{3}-\d{2}-\d{4}$/;
const EIN_PATTERN = /^\d{2}-\d{7}$/;
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
const SUPPORT_REVIEW_DEFAULT_SUMMARY =
  "Add at least one supported income form to see whether this draft fits TaxVault's current estimate slice.";
const SUPPORTED_TAX_YEAR = 2025;
const DRAFT_STORAGE_VERSION = 1;
const SESSION_DRAFT_STORAGE_KEY = `taxvault:draft:session:${SUPPORTED_TAX_YEAR}`;
const LOCAL_DRAFT_STORAGE_KEY = `taxvault:draft:local:${SUPPORTED_TAX_YEAR}`;
const LOCAL_DRAFT_PREFERENCE_KEY = `taxvault:draft:remember:${SUPPORTED_TAX_YEAR}`;
const MAX_W2_FORMS = 25;
const MAX_INTEREST_FORMS = 25;
const MAX_SOCIAL_SECURITY_FORMS = 10;
const MAX_DIVIDEND_FORMS = 25;
const MAX_DEPENDENTS = 15;
const MAX_TEXT_FIELD_LENGTH = 200;
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
  filingStatus: "single",
};

const els = {
  disclaimerGate: document.getElementById("disclaimerGate"),
  gateAcknowledge: document.getElementById("gateAcknowledge"),
  gateContinueBtn: document.getElementById("gateContinueBtn"),
  loading: document.getElementById("loading"),
  app: document.getElementById("app"),
  error: document.getElementById("error"),
  spouseCard: document.getElementById("spouseCard"),
  dependentSection: document.getElementById("dependentSection"),
  dependentSubtitle: document.getElementById("dependentSubtitle"),
  dependentContainer: document.getElementById("dependentContainer"),
  addDependentBtn: document.getElementById("addDependentBtn"),
  clearAllBtn: document.getElementById("clearAllBtn"),
  rememberDraftToggle: document.getElementById("rememberDraftToggle"),
  storageStatus: document.getElementById("storageStatus"),
  uiStatus: document.getElementById("uiStatus"),
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
  computeBtn: document.getElementById("computeBtn"),
  supportReviewCard: document.getElementById("supportReviewCard"),
  supportReviewBadge: document.getElementById("supportReviewBadge"),
  supportReviewSummary: document.getElementById("supportReviewSummary"),
  supportReviewIssuesSection: document.getElementById("supportReviewIssuesSection"),
  supportReviewIssues: document.getElementById("supportReviewIssues"),
  supportReviewCautionsSection: document.getElementById("supportReviewCautionsSection"),
  supportReviewCautions: document.getElementById("supportReviewCautions"),
  printDraftBtn: document.getElementById("printDraftBtn"),
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

  document.getElementById("step1ContinueBtn").addEventListener("click", () => goToStep(2));
  document.getElementById("step2BackBtn").addEventListener("click", () => goToStep(1));
  document.getElementById("editReturnBtn").addEventListener("click", () => goToStep(1));
  els.gateAcknowledge.addEventListener("change", updateGateButtonState);
  els.gateContinueBtn.addEventListener("click", acknowledgeSafetyGate);
  els.addW2Btn.addEventListener("click", addW2);
  els.addSocialSecurityBtn.addEventListener("click", addSocialSecurity);
  els.addInterestBtn.addEventListener("click", addInterest);
  els.addDividendBtn.addEventListener("click", addDividend);
  els.addDependentBtn.addEventListener("click", addDependent);
  els.clearAllBtn.addEventListener("click", clearAllData);
  els.rememberDraftToggle.addEventListener("change", handleRememberDraftToggle);
  els.computeBtn.addEventListener("click", computeReturn);
  els.printDraftBtn.addEventListener("click", printDraftReturn);
  els.linesToggle.addEventListener("click", toggleLines);
  els.traceToggle.addEventListener("click", toggleTrace);
  els.app.addEventListener("input", handleAppFieldMutation);
  els.app.addEventListener("change", handleAppFieldMutation);

  bindSsnFields(document);
  bindMoneyFields(document);
  updateDependentSubtitle(false);
  resetSupportReview();
  resetDraftPreview();
  refreshStorageStatus();
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
    target.focus({ preventScroll: true });
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

function storageFor(kind) {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    const storage = kind === "local" ? window.localStorage : window.sessionStorage;
    const probeKey = "__taxvault_probe__";
    storage.setItem(probeKey, "1");
    storage.removeItem(probeKey);
    return storage;
  } catch {
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

function rememberDraftEnabled() {
  return Boolean(els.rememberDraftToggle?.checked);
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
    readStoredValue(localStorageRef, LOCAL_DRAFT_PREFERENCE_KEY) === "true";
}

function handleRememberDraftToggle() {
  const localStorageRef = storageFor("local");

  if (rememberDraftEnabled()) {
    writeStoredValue(localStorageRef, LOCAL_DRAFT_PREFERENCE_KEY, "true");
    persistDraftSnapshot();
    refreshStorageStatus("Draft will also stay on this device until you clear it.");
    announceUiStatus("Draft persistence enabled for this device.");
    return;
  }

  removeStoredValue(localStorageRef, LOCAL_DRAFT_PREFERENCE_KEY);
  removeStoredValue(localStorageRef, LOCAL_DRAFT_STORAGE_KEY);
  persistDraftSnapshot();
  refreshStorageStatus("Draft will clear when this tab closes unless you enable device storage again.");
  announceUiStatus("Device draft persistence disabled.");
}

function refreshStorageStatus(message = "") {
  if (!els.storageStatus) {
    return;
  }

  if (message) {
    els.storageStatus.textContent = message;
    return;
  }

  els.storageStatus.textContent = rememberDraftEnabled()
    ? "Draft autosaves in this tab and stays on this device until you clear it."
    : "Draft autosaves in this tab and clears when the tab closes.";
}

function scheduleDraftSave() {
  if (draftRestoreInProgress) {
    return;
  }

  window.clearTimeout(draftSaveTimer);
  draftSaveTimer = window.setTimeout(() => {
    persistDraftSnapshot();
  }, 120);
}

function snapshotHasUserData(snapshot) {
  const hasText = (value) => typeof value === "string" && value.trim() !== "";
  const hasTruthyValue = (value) => hasText(value) || value === true;
  const hasObjectValue = (value) =>
    value && typeof value === "object" && Object.values(value).some(hasTruthyValue);

  return (
    snapshot.filingStatus !== "single" ||
    hasObjectValue(snapshot.primaryFiler) ||
    hasObjectValue(snapshot.spouse) ||
    hasObjectValue(snapshot.adjustments) ||
    snapshot.dependents.length > 0 ||
    snapshot.w2s.length > 0 ||
    snapshot.interestIncome.length > 0 ||
    snapshot.socialSecurityIncome.length > 0 ||
    snapshot.dividendIncome.length > 0
  );
}

function captureDraftSnapshot() {
  return {
    version: DRAFT_STORAGE_VERSION,
    savedAt: new Date().toISOString(),
    filingStatus: state.filingStatus,
    currentStep: Math.min(state.currentStep, 2),
    hadResults: state.currentStep === 3,
    primaryFiler: readFilerInputs("p"),
    spouse: readFilerInputs("s"),
    adjustments: {
      traditionalIraDeduction: els.traditionalIraDeduction.value.trim(),
      hsaDeduction: els.hsaDeduction.value.trim(),
      studentLoanInterestPaid: els.studentLoanInterestPaid.value.trim(),
    },
    dependents: Array.from(els.dependentContainer.querySelectorAll(".dependent-card")).map((card) => ({
      firstName: card.querySelector(".dep-first").value.trim(),
      lastName: card.querySelector(".dep-last").value.trim(),
      ssn: card.querySelector(".dep-ssn").value.trim(),
      dob: card.querySelector(".dep-dob").value,
      relationship: card.querySelector(".dep-relationship").value,
      monthsLivedInHome: card.querySelector(".dep-months").value.trim(),
    })),
    w2s: Array.from(els.w2Container.querySelectorAll(".w2-card")).map((card) => ({
      employerName: card.querySelector(".w2-employer").value.trim(),
      recipient: card.querySelector(".w2-recipient").value,
      employerEin: card.querySelector(".w2-ein").value.trim(),
      federalTaxWithheld: card.querySelector(".w2-fed-wh").value.trim(),
      wages: card.querySelector(".w2-wages").value.trim(),
      stateTaxWithheld: card.querySelector(".w2-state-wh").value.trim(),
      socialSecurityWages: card.querySelector(".w2-ss-wages").value.trim(),
      socialSecurityTaxWithheld: card.querySelector(".w2-ss-wh").value.trim(),
      medicareWages: card.querySelector(".w2-med-wages").value.trim(),
      medicareTaxWithheld: card.querySelector(".w2-med-wh").value.trim(),
      advancedOpen: card.querySelector(".w2-advanced-fields").classList.contains("open"),
    })),
    socialSecurityIncome: Array.from(els.socialSecurityContainer.querySelectorAll(".ssa-card")).map(
      (card) => ({
        recipient: card.querySelector(".ssa-recipient").value,
        totalBenefits: card.querySelector(".ssa-benefits").value.trim(),
        voluntaryWithholding: card.querySelector(".ssa-withholding").value.trim(),
      })
    ),
    interestIncome: Array.from(els.interestContainer.querySelectorAll(".w2-card")).map((card) => ({
      payerName: card.querySelector(".interest-payer").value.trim(),
      recipient: card.querySelector(".interest-recipient").value,
      taxableInterest: card.querySelector(".interest-taxable").value.trim(),
      taxExemptInterest: card.querySelector(".interest-tax-exempt").value.trim(),
    })),
    dividendIncome: Array.from(els.dividendContainer.querySelectorAll(".w2-card")).map((card) => ({
      payerName: card.querySelector(".dividend-payer").value.trim(),
      recipient: card.querySelector(".dividend-recipient").value,
      ordinaryDividends: card.querySelector(".dividend-ordinary").value.trim(),
      qualifiedDividends: card.querySelector(".dividend-qualified").value.trim(),
    })),
  };
}

function persistDraftSnapshot() {
  const sessionStorageRef = storageFor("session");
  const localStorageRef = storageFor("local");
  const snapshot = captureDraftSnapshot();

  if (!snapshotHasUserData(snapshot)) {
    removeStoredValue(sessionStorageRef, SESSION_DRAFT_STORAGE_KEY);
    removeStoredValue(localStorageRef, LOCAL_DRAFT_STORAGE_KEY);
    refreshStorageStatus();
    return;
  }

  const serialized = JSON.stringify(snapshot);
  writeStoredValue(sessionStorageRef, SESSION_DRAFT_STORAGE_KEY, serialized);

  if (rememberDraftEnabled()) {
    writeStoredValue(localStorageRef, LOCAL_DRAFT_PREFERENCE_KEY, "true");
    writeStoredValue(localStorageRef, LOCAL_DRAFT_STORAGE_KEY, serialized);
  } else {
    removeStoredValue(localStorageRef, LOCAL_DRAFT_STORAGE_KEY);
  }

  refreshStorageStatus();
}

function restoreDraftSnapshot() {
  const localStorageRef = storageFor("local");
  const sessionStorageRef = storageFor("session");
  const rawSnapshot =
    (rememberDraftEnabled() && readStoredValue(localStorageRef, LOCAL_DRAFT_STORAGE_KEY)) ||
    readStoredValue(sessionStorageRef, SESSION_DRAFT_STORAGE_KEY);

  if (!rawSnapshot) {
    return false;
  }

  let snapshot;
  try {
    snapshot = JSON.parse(rawSnapshot);
  } catch {
    removeStoredValue(sessionStorageRef, SESSION_DRAFT_STORAGE_KEY);
    removeStoredValue(localStorageRef, LOCAL_DRAFT_STORAGE_KEY);
    refreshStorageStatus();
    return false;
  }

  if (snapshot?.version !== DRAFT_STORAGE_VERSION) {
    removeStoredValue(sessionStorageRef, SESSION_DRAFT_STORAGE_KEY);
    removeStoredValue(localStorageRef, LOCAL_DRAFT_STORAGE_KEY);
    refreshStorageStatus();
    return false;
  }

  applyDraftSnapshot(snapshot);
  const restoredMessage = snapshot.hadResults
    ? "Draft restored. Recalculate to refresh the estimate results."
    : "Draft restored. Continue where you left off.";
  refreshStorageStatus(restoredMessage);
  announceUiStatus("Saved draft restored.");
  return true;
}

function applyDraftSnapshot(snapshot) {
  draftRestoreInProgress = true;

  try {
    selectStatus(snapshot.filingStatus || "single", { autoSeedDependent: false });
    applyFilerInputs("p", snapshot.primaryFiler);
    applyFilerInputs("s", snapshot.spouse);
    applyAdjustmentInputs(snapshot.adjustments);
    restoreDependents(snapshot.dependents || []);
    restoreW2Cards(snapshot.w2s || []);
    restoreSocialSecurityCards(snapshot.socialSecurityIncome || []);
    restoreInterestCards(snapshot.interestIncome || []);
    restoreDividendCards(snapshot.dividendIncome || []);
  } finally {
    draftRestoreInProgress = false;
  }

  const nextStep = snapshot.currentStep === 2 && validateStep1().length === 0 ? 2 : 1;
  goToStep(nextStep);
  hideError();
}

function applyFilerInputs(prefix, filer = {}) {
  document.getElementById(`${prefix}First`).value = filer.firstName || "";
  document.getElementById(`${prefix}Last`).value = filer.lastName || "";
  document.getElementById(`${prefix}Ssn`).value = filer.ssn || "";
  document.getElementById(`${prefix}Dob`).value = filer.dob || "";
  document.getElementById(`${prefix}Blind`).checked = Boolean(filer.isBlind);
}

function applyAdjustmentInputs(adjustments = {}) {
  els.traditionalIraDeduction.value = adjustments.traditionalIraDeduction || "";
  els.hsaDeduction.value = adjustments.hsaDeduction || "";
  els.studentLoanInterestPaid.value = adjustments.studentLoanInterestPaid || "";
  bindMoneyFields(document);
}

function restoreDependents(dependents) {
  dependents.forEach((dependent) => {
    const card = addDependent({ focusNewCard: false });
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
    const card = addW2({ focusNewCard: false });
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
    bindMoneyFields(card);
  });
}

function restoreSocialSecurityCards(items) {
  items.forEach((item) => {
    const card = addSocialSecurity({ focusNewCard: false });
    if (!card) {
      return;
    }

    card.querySelector(".ssa-recipient").value = item.recipient || "primary";
    card.querySelector(".ssa-benefits").value = item.totalBenefits || "";
    card.querySelector(".ssa-withholding").value = item.voluntaryWithholding || "";
    bindMoneyFields(card);
  });
}

function restoreInterestCards(items) {
  items.forEach((item) => {
    const card = addInterest({ focusNewCard: false });
    if (!card) {
      return;
    }

    card.querySelector(".interest-payer").value = item.payerName || "";
    card.querySelector(".interest-recipient").value = item.recipient || "primary";
    card.querySelector(".interest-taxable").value = item.taxableInterest || "";
    card.querySelector(".interest-tax-exempt").value = item.taxExemptInterest || "";
    bindMoneyFields(card);
  });
}

function restoreDividendCards(items) {
  items.forEach((item) => {
    const card = addDividend({ focusNewCard: false });
    if (!card) {
      return;
    }

    card.querySelector(".dividend-payer").value = item.payerName || "";
    card.querySelector(".dividend-recipient").value = item.recipient || "primary";
    card.querySelector(".dividend-ordinary").value = item.ordinaryDividends || "";
    card.querySelector(".dividend-qualified").value = item.qualifiedDividends || "";
    bindMoneyFields(card);
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
  els.disclaimerGate.classList.remove("hidden");
  document.body.classList.add("gate-open");
  updateGateButtonState();
}

function hideDisclaimerGate() {
  els.disclaimerGate.classList.add("hidden");
  document.body.classList.remove("gate-open");
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

function selectStatus(status, { autoSeedDependent = true } = {}) {
  state.filingStatus = status;

  document.querySelectorAll(".status-option").forEach((button) => {
    const selected = button.dataset.status === status;
    button.classList.toggle("selected", selected);
    button.setAttribute("aria-pressed", String(selected));
  });

  const isMfj = status === "married_filing_jointly";
  const isHoh = status === "head_of_household";
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
    ? "Head of Household requires at least one dependent. Child-related credits only apply to qualifying children under age 17, and TaxVault does not verify every IRS dependency or custody rule."
    : "Add any dependents you plan to claim. Dependents entered here may affect the Child Tax Credit or Credit for Other Dependents, but TaxVault does not verify every IRS dependency or custody rule.";
}

function goToStep(step) {
  if (step === 2 && state.currentStep === 1) {
    const errors = validateStep1();
    if (errors.length > 0) {
      showError(errors);
      return;
    }
  }

  hideError();
  state.currentStep = step;

  document.querySelectorAll(".step-section").forEach((section) => {
    section.classList.toggle("active", section.id === `step${step}`);
  });

  updateStepIndicator();

  if (step === 2) {
    refreshSupportReview();
  }

  scheduleDraftSave();

  if (typeof window.scrollTo === "function") {
    window.scrollTo({ top: 0, behavior: "smooth" });
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
    label.toggleAttribute("aria-current", isActive);
    dot.textContent = isDone ? "✓" : String(i);
  }

  document.getElementById("line1").classList.toggle("done", state.currentStep > 1);
  document.getElementById("line2").classList.toggle("done", state.currentStep > 2);
}

function validateStep1() {
  const errors = [];
  const primary = readFilerInputs("p");
  let spouse = null;

  if (!primary.firstName) {
    errors.push("First name is required.");
  }
  if (!primary.lastName) {
    errors.push("Last name is required.");
  }
  if (!primary.ssn) {
    errors.push("SSN is required.");
  } else if (!SSN_PATTERN.test(primary.ssn)) {
    errors.push("SSN must use the format 123-45-6789.");
  }
  if (!primary.dob) {
    errors.push("Date of birth is required.");
  } else if (!isPastOrToday(primary.dob)) {
    errors.push("Date of birth must be a real date in the past.");
  }

  if (state.filingStatus === "married_filing_jointly") {
    spouse = readFilerInputs("s");

    if (!spouse.firstName) {
      errors.push("Spouse first name is required.");
    }
    if (!spouse.lastName) {
      errors.push("Spouse last name is required.");
    }
    if (!spouse.ssn) {
      errors.push("Spouse SSN is required.");
    } else if (!SSN_PATTERN.test(spouse.ssn)) {
      errors.push("Spouse SSN must use the format 123-45-6789.");
    }
    if (!spouse.dob) {
      errors.push("Spouse date of birth is required.");
    } else if (!isPastOrToday(spouse.dob)) {
      errors.push("Spouse date of birth must be a real date in the past.");
    }
  }

  const dependents = collectDependents(errors, {
    requireAtLeastOne: state.filingStatus === "head_of_household",
  });
  validateUniqueSsnEntries(errors, primary, spouse, dependents);

  return errors;
}

function readFilerInputs(prefix) {
  return {
    firstName: document.getElementById(`${prefix}First`).value.trim(),
    lastName: document.getElementById(`${prefix}Last`).value.trim(),
    ssn: document.getElementById(`${prefix}Ssn`).value.trim(),
    dob: document.getElementById(`${prefix}Dob`).value,
    isBlind: document.getElementById(`${prefix}Blind`).checked,
  };
}

function showError(messages) {
  const content = Array.isArray(messages) ? messages.join("\n") : String(messages);
  els.error.textContent = content;
  els.error.hidden = false;
  els.error.scrollIntoView({ behavior: "smooth", block: "center" });
}

function hideError() {
  els.error.hidden = true;
  els.error.textContent = "";
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

function createCardHeader(title, removeButtonClass) {
  const header = createElement("div", { className: "w2-card-header" });
  header.append(
    createElement("h3", { text: title }),
    createButtonElement({ className: `btn-ghost ${removeButtonClass}`, text: "Remove" })
  );
  return header;
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

function addW2({ focusNewCard = true } = {}) {
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
    createCardHeader(`W-2 #${state.w2Count}`, "remove-w2-btn"),
    createReferenceZone("W-2"),
    essential,
    advanced
  );

  card.querySelector(".remove-w2-btn").addEventListener("click", () => removeW2(card));
  card.querySelector(".w2-advanced-toggle").addEventListener("click", () => toggleAdvanced(card));
  card.querySelector(".w2-ein").addEventListener("input", (event) => {
    event.target.value = formatDigits(event.target.value, [2, 7]);
  });
  bindMoneyFields(card);

  els.w2Container.append(card);
  updateRemoveButtons();
  scheduleSupportReview();
  scheduleDraftSave();
  announceUiStatus(`Added W-2 #${els.w2Container.children.length}.`);
  if (focusNewCard) {
    focusFirstField(card, ".w2-employer");
  }

  return card;
}

function addSocialSecurity({ focusNewCard = true } = {}) {
  if (!canAddCard(els.socialSecurityContainer, MAX_SOCIAL_SECURITY_FORMS, "SSA-1099 forms")) {
    return null;
  }

  state.socialSecurityCount += 1;
  const idPrefix = `ssa-${state.socialSecurityCount}`;
  const card = createCardSection("w2-card ssa-card", state.socialSecurityCount);
  card.append(
    createCardHeader(`SSA-1099 #${state.socialSecurityCount}`, "remove-ssa-btn"),
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
  bindMoneyFields(card);

  els.socialSecurityContainer.append(card);
  updateSocialSecurityRemoveButtons();
  scheduleSupportReview();
  scheduleDraftSave();
  announceUiStatus(`Added SSA-1099 #${els.socialSecurityContainer.children.length}.`);
  if (focusNewCard) {
    focusFirstField(card, ".ssa-benefits");
  }

  return card;
}

function addInterest({ focusNewCard = true } = {}) {
  if (!canAddCard(els.interestContainer, MAX_INTEREST_FORMS, "1099-INT forms")) {
    return null;
  }

  state.interestCount += 1;
  const idPrefix = `int-${state.interestCount}`;
  const card = createCardSection("w2-card", state.interestCount);
  card.append(
    createCardHeader(`1099-INT #${state.interestCount}`, "remove-interest-btn"),
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
  bindMoneyFields(card);

  els.interestContainer.append(card);
  updateInterestRemoveButtons();
  scheduleSupportReview();
  scheduleDraftSave();
  announceUiStatus(`Added 1099-INT #${els.interestContainer.children.length}.`);
  if (focusNewCard) {
    focusFirstField(card, ".interest-taxable");
  }

  return card;
}

function addDividend({ focusNewCard = true } = {}) {
  if (!canAddCard(els.dividendContainer, MAX_DIVIDEND_FORMS, "1099-DIV forms")) {
    return null;
  }

  state.dividendCount += 1;
  const idPrefix = `div-${state.dividendCount}`;
  const card = createCardSection("w2-card", state.dividendCount);
  card.append(
    createCardHeader(`1099-DIV #${state.dividendCount}`, "remove-dividend-btn"),
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
  bindMoneyFields(card);

  els.dividendContainer.append(card);
  updateDividendRemoveButtons();
  scheduleSupportReview();
  scheduleDraftSave();
  announceUiStatus(`Added 1099-DIV #${els.dividendContainer.children.length}.`);
  if (focusNewCard) {
    focusFirstField(card, ".dividend-ordinary");
  }

  return card;
}

function addDependent({ focusNewCard = true } = {}) {
  if (!canAddCard(els.dependentContainer, MAX_DEPENDENTS, "dependents")) {
    return null;
  }

  state.dependentCount += 1;
  const idPrefix = `dep-${state.dependentCount}`;
  const card = createCardSection("w2-card dependent-card", state.dependentCount);
  card.append(
    createCardHeader(`Dependent #${state.dependentCount}`, "remove-dependent-btn"),
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
  bindSsnFields(card);

  els.dependentContainer.append(card);
  updateDependentRemoveButtons();
  scheduleDraftSave();
  announceUiStatus(`Added dependent #${els.dependentContainer.children.length}.`);
  if (focusNewCard) {
    focusFirstField(card, ".dep-first");
  }

  return card;
}

function removeW2(card) {
  const focusTarget = nextFocusTargetAfterRemoval(card, els.addW2Btn);
  cleanupReferencePreviews(card);
  card.remove();
  updateRemoveButtons();
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
  scheduleSupportReview();
  scheduleDraftSave();
  focusElement(focusTarget);
  announceUiStatus("Removed 1099-DIV form.");
}

function removeDependent(card) {
  const focusTarget = nextFocusTargetAfterRemoval(card, els.addDependentBtn);
  card.remove();
  updateDependentRemoveButtons();
  scheduleDraftSave();
  focusElement(focusTarget);
  announceUiStatus("Removed dependent.");
}

function updateRemoveButtons() {
  const cards = Array.from(els.w2Container.querySelectorAll(".w2-card"));

  cards.forEach((card) => {
    const button = card.querySelector(".remove-w2-btn");
    button.disabled = false;
    button.setAttribute("aria-disabled", "false");
  });
}

function updateInterestRemoveButtons() {
  const cards = Array.from(els.interestContainer.querySelectorAll(".w2-card"));
  cards.forEach((card) => {
    const button = card.querySelector(".remove-interest-btn");
    button.disabled = false;
    button.setAttribute("aria-disabled", "false");
  });
}

function updateSocialSecurityRemoveButtons() {
  const cards = Array.from(els.socialSecurityContainer.querySelectorAll(".w2-card"));
  cards.forEach((card) => {
    const button = card.querySelector(".remove-ssa-btn");
    button.disabled = false;
    button.setAttribute("aria-disabled", "false");
  });
}

function updateDividendRemoveButtons() {
  const cards = Array.from(els.dividendContainer.querySelectorAll(".w2-card"));
  cards.forEach((card) => {
    const button = card.querySelector(".remove-dividend-btn");
    button.disabled = false;
    button.setAttribute("aria-disabled", "false");
  });
}

function updateDependentRemoveButtons() {
  const cards = Array.from(els.dependentContainer.querySelectorAll(".dependent-card"));
  const disableRemove = cards.length <= 1 && state.filingStatus === "head_of_household";

  cards.forEach((card) => {
    const button = card.querySelector(".remove-dependent-btn");
    button.disabled = disableRemove;
    button.setAttribute("aria-disabled", String(disableRemove));
  });
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
  supportReviewTimer = window.setTimeout(() => {
    refreshSupportReview();
  }, 120);
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
}

function renderSupportReviewPending(summary) {
  state.supportReviewReadyForEstimate = false;
  els.supportReviewCard.dataset.status = "pending";
  els.supportReviewSummary.textContent = summary;
  els.supportReviewBadge.className = "support-review-badge pending";
  els.supportReviewBadge.textContent = "In Progress";
  setSupportReviewItems(els.supportReviewIssuesSection, els.supportReviewIssues, []);
  setSupportReviewItems(els.supportReviewCautionsSection, els.supportReviewCautions, []);
  syncComputeButtonState();
}

function renderSupportReview(review) {
  const status = ["ready", "attention", "unsupported"].includes(review?.status)
    ? review.status
    : "attention";
  state.supportReviewReadyForEstimate = Boolean(review?.ready_for_estimate) && status === "ready";

  els.supportReviewCard.dataset.status = status;
  els.supportReviewSummary.textContent =
    review?.summary || "TaxVault reviewed this draft, but the status message was unavailable.";
  els.supportReviewBadge.className = `support-review-badge ${status}`;
  els.supportReviewBadge.textContent = supportReviewBadgeLabel(status);
  setSupportReviewItems(
    els.supportReviewIssuesSection,
    els.supportReviewIssues,
    dedupeMessages(review?.blocking_issues || [])
  );
  setSupportReviewItems(
    els.supportReviewCautionsSection,
    els.supportReviewCautions,
    dedupeMessages(review?.cautions || [])
  );
  syncComputeButtonState();
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
  return Array.from(new Set(messages.map((message) => String(message))));
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

  const step1Errors = validateStep1();
  if (step1Errors.length > 0) {
    goToStep(1);
    showError(step1Errors);
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
  els.computeBtn.disabled = true;
  els.computeBtn.textContent = "Calculating...";

  try {
    const resultJson = compute_tax(JSON.stringify(payload));
    const data = JSON.parse(resultJson);

    if (!data.success) {
      showError(data.error || "Unable to compute this return.");
      return;
    }

    renderResults(data);
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
        tax_year: SUPPORTED_TAX_YEAR,
        filing_status: state.filingStatus,
        primary_filer: filerPayload(primary),
        spouse: spouse ? filerPayload(spouse) : null,
        dependents,
        w2_income: w2s,
        interest_income: interestIncome,
        dividend_income: dividendIncome,
        social_security_income: socialSecurityIncome,
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

  return adjustments;
}

function filerPayload(filer) {
  return {
    first_name: filer.firstName,
    last_name: filer.lastName,
    ssn: filer.ssn,
    date_of_birth: filer.dob,
    is_blind: filer.isBlind,
    is_dependent: false,
  };
}

function collectDependents(errors, { requireAtLeastOne = false } = {}) {
  const dependents = [];
  const cards = Array.from(els.dependentContainer.querySelectorAll(".dependent-card"));

  cards.forEach((card, index) => {
    const firstName = card.querySelector(".dep-first").value.trim();
    const lastName = card.querySelector(".dep-last").value.trim();
    const ssn = card.querySelector(".dep-ssn").value.trim();
    const dob = card.querySelector(".dep-dob").value;
    const relationship = card.querySelector(".dep-relationship").value;
    const rawMonths = card.querySelector(".dep-months").value.trim();
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
  const cards = Array.from(els.interestContainer.querySelectorAll(".w2-card"));

  cards.forEach((card, index) => {
    const payerName = card.querySelector(".interest-payer").value.trim();
    const rawTaxable = card.querySelector(".interest-taxable").value.trim();
    const rawTaxExempt = card.querySelector(".interest-tax-exempt").value.trim();
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
      recipient: card.querySelector(".interest-recipient").value,
      payer_name: payerName,
      taxable_interest: taxableInterest,
      tax_exempt_interest: taxExemptInterest,
    });
  });

  return interestIncome;
}

function collectSocialSecurityCards(errors) {
  const socialSecurityIncome = [];
  const cards = Array.from(els.socialSecurityContainer.querySelectorAll(".w2-card"));

  cards.forEach((card, index) => {
    const rawBenefits = card.querySelector(".ssa-benefits").value.trim();
    const rawWithholding = card.querySelector(".ssa-withholding").value.trim();
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
      recipient: card.querySelector(".ssa-recipient").value,
      total_benefits: totalBenefits,
      voluntary_withholding: voluntaryWithholding,
    });
  });

  return socialSecurityIncome;
}

function collectDividendCards(errors) {
  const dividendIncome = [];
  const cards = Array.from(els.dividendContainer.querySelectorAll(".w2-card"));

  cards.forEach((card, index) => {
    const payerName = card.querySelector(".dividend-payer").value.trim();
    const rawOrdinary = card.querySelector(".dividend-ordinary").value.trim();
    const rawQualified = card.querySelector(".dividend-qualified").value.trim();
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
      recipient: card.querySelector(".dividend-recipient").value,
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
    const employerName = card.querySelector(".w2-employer").value.trim();
    const employerEin = card.querySelector(".w2-ein").value.trim();
    const rawWages = card.querySelector(".w2-wages").value.trim();
    const rawFedWh = card.querySelector(".w2-fed-wh").value.trim();
    const rawStateWh = card.querySelector(".w2-state-wh").value.trim();
    const rawSsWages = card.querySelector(".w2-ss-wages").value.trim();
    const rawSsWh = card.querySelector(".w2-ss-wh").value.trim();
    const rawMedWages = card.querySelector(".w2-med-wages").value.trim();
    const rawMedWh = card.querySelector(".w2-med-wh").value.trim();
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
      recipient: card.querySelector(".w2-recipient").value,
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

function renderResults(data) {
  renderHero(data.summary);
  renderDraftPreview(data);
  renderMeta(data.meta);
  renderBreakdown(data.summary);
  renderTrace(data.trace);
  renderLines(data.form?.lines || {});

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
        text: `Estimate only for ${summary.tax_year}. Do not use this refund number to file a return.`,
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
        text: `Estimate only for ${summary.tax_year}. Do not use this balance-due number to file a return.`,
      })
    );
    return;
  }

  els.resultHero.append(
    createElement("div", { className: "result-label", text: "Estimated Tax Status" }),
    createElement("div", { className: "amount neutral", text: fmtCurrency("0") }),
    createElement("div", {
      className: "result-sub",
      text: "Estimate only. A zero balance here does not mean your return is filing-ready.",
    })
  );
}

function renderBreakdown(summary) {
  const rows = [
    { section: "Income" },
    { label: "Total Wages", value: fmtCurrency(summary.total_wages) },
    { label: "Taxable Interest", value: fmtCurrency(summary.total_taxable_interest) },
    { label: "Tax-Exempt Interest", value: fmtCurrency(summary.total_tax_exempt_interest) },
    { label: "Ordinary Dividends", value: fmtCurrency(summary.total_ordinary_dividends) },
    { label: "Qualified Dividends", value: fmtCurrency(summary.total_qualified_dividends) },
    {
      label: "Social Security Benefits",
      value: fmtCurrency(summary.total_social_security_benefits),
    },
    {
      label: "Taxable Social Security Benefits",
      value: fmtCurrency(summary.taxable_social_security_benefits),
    },
    { label: "Total Income", value: fmtCurrency(summary.total_income), highlight: true },
    { section: "Adjustments" },
    {
      label: "Traditional IRA Deduction",
      value: fmtCurrency(summary.traditional_ira_deduction),
    },
    { label: "HSA Deduction", value: fmtCurrency(summary.hsa_deduction) },
    {
      label: "Student Loan Interest Deduction",
      value: fmtCurrency(summary.student_loan_interest_deduction),
    },
    { label: "Total Adjustments", value: fmtCurrency(summary.total_adjustments), highlight: true },
    { label: "Adjusted Gross Income", value: fmtCurrency(summary.adjusted_gross_income), highlight: true },
    { section: "Deductions" },
    { label: "Standard Deduction", value: fmtCurrency(summary.standard_deduction) },
    { label: "Taxable Income", value: fmtCurrency(summary.taxable_income), highlight: true },
    { section: "Credits" },
    { label: "Child/Dependent Credit", value: fmtCurrency(summary.child_dependent_credit), highlight: true },
    { section: "Tax" },
    { label: "Income Tax Before Credits", value: fmtCurrency(summary.income_tax) },
    { label: "Total Tax", value: fmtCurrency(summary.total_tax), highlight: true },
    { section: "Payments" },
    { label: "W-2 Federal Withholding", value: fmtCurrency(summary.total_w2_federal_withholding) },
    {
      label: "SSA-1099 Voluntary Withholding",
      value: fmtCurrency(summary.total_social_security_withholding),
    },
    { label: "Total Federal Withholding", value: fmtCurrency(summary.total_federal_withholding) },
    { label: "Additional Child Tax Credit", value: fmtCurrency(summary.additional_child_tax_credit) },
    { label: "Total Payments", value: fmtCurrency(summary.total_payments), highlight: true },
  ];

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
      createElement("span", { className: "value", text: row.value })
    );
    els.breakdownContent.append(breakdownRow);
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

  const keys = Object.keys(lines).sort((left, right) => {
    const leftNumber = parseFloat(left);
    const rightNumber = parseFloat(right);

    if (!Number.isNaN(leftNumber) && !Number.isNaN(rightNumber) && leftNumber !== rightNumber) {
      return leftNumber - rightNumber;
    }

    return left.localeCompare(right, undefined, { numeric: true });
  });

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
  document.getElementById("pFirst").value = "";
  document.getElementById("pLast").value = "";
  document.getElementById("pSsn").value = "";
  document.getElementById("pDob").value = "";
  document.getElementById("pBlind").checked = false;

  document.getElementById("sFirst").value = "";
  document.getElementById("sLast").value = "";
  document.getElementById("sSsn").value = "";
  document.getElementById("sDob").value = "";
  document.getElementById("sBlind").checked = false;
  els.traditionalIraDeduction.value = "";
  els.hsaDeduction.value = "";
  els.studentLoanInterestPaid.value = "";

  els.w2Container.replaceChildren();
  els.socialSecurityContainer.replaceChildren();
  els.interestContainer.replaceChildren();
  els.dividendContainer.replaceChildren();
  els.dependentContainer.replaceChildren();
  els.resultHero.replaceChildren();
  els.resultMeta.replaceChildren();
  els.scopeList.replaceChildren();
  resetDraftPreview();
  els.breakdownContent.replaceChildren();
  els.traceContainer.textContent = "";
  els.traceContainer.classList.remove("open");
  els.traceArrow.classList.remove("open");
  els.traceToggle.setAttribute("aria-expanded", "false");
  els.linesContainer.replaceChildren();
  els.linesContainer.classList.remove("open");
  els.linesArrow.classList.remove("open");
  els.linesToggle.setAttribute("aria-expanded", "false");

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
  els.gateAcknowledge.checked = false;
  updateGateButtonState();
  els.app.classList.add("hidden");
  removeStoredValue(storageFor("session"), SESSION_DRAFT_STORAGE_KEY);
  removeStoredValue(storageFor("local"), LOCAL_DRAFT_STORAGE_KEY);
  refreshStorageStatus("Saved draft cleared from this tab and this device.");
  announceUiStatus("All draft data cleared.");
  showDisclaimerGate();
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

const ACCEPTED_TYPES = ".pdf,.png,.jpg,.jpeg,.heic,.webp";

function releasePreviewBlobUrl(previewContainer) {
  const blobUrl = previewContainer.dataset.blobUrl;
  if (blobUrl) {
    URL.revokeObjectURL(blobUrl);
    delete previewContainer.dataset.blobUrl;
  }
}

function cleanupReferencePreviews(root) {
  root.querySelectorAll(".upload-preview-container").forEach((previewContainer) => {
    releasePreviewBlobUrl(previewContainer);
  });
}

function createReferenceZone(formLabel) {
  const wrapper = document.createElement("div");
  wrapper.className = "upload-zone-wrapper";

  const zone = document.createElement("div");
  zone.className = "upload-zone";
  zone.setAttribute("role", "button");
  zone.setAttribute("aria-label", `Choose a local ${formLabel} file to preview on screen`);
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
  zoneText.append("Preview a local ");
  const emphasizedLabel = document.createElement("strong");
  emphasizedLabel.textContent = formLabel;
  zoneText.append(emphasizedLabel, " copy here (optional)");

  const zoneHint = createElement("div", {
    className: "upload-zone-hint",
    text: "On-screen reference only. TaxVault does not read or import fields from files.",
  });

  zone.append(icon, zoneText, zoneHint);

  const fileInput = document.createElement("input");
  fileInput.type = "file";
  fileInput.accept = ACCEPTED_TYPES;
  fileInput.setAttribute("aria-hidden", "true");
  zone.appendChild(fileInput);

  const preview = document.createElement("div");
  preview.className = "upload-preview-container hidden";

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
      handleUpload(e.dataTransfer.files[0], zone, preview);
    }
  });

  fileInput.addEventListener("change", () => {
    if (fileInput.files.length > 0) {
      handleUpload(fileInput.files[0], zone, preview);
      fileInput.value = "";
    }
  });

  wrapper.append(zone, preview);
  return wrapper;
}

function handleUpload(file, zone, previewContainer) {
  const isValid = /\.(pdf|png|jpe?g|heic|webp)$/i.test(file.name);
  if (!isValid) {
    return;
  }

  releasePreviewBlobUrl(previewContainer);
  const blobUrl = URL.createObjectURL(file);
  const isPdf = /\.pdf$/i.test(file.name);
  previewContainer.dataset.blobUrl = blobUrl;

  previewContainer.innerHTML = "";

  const header = document.createElement("div");
  header.className = "upload-preview-header";

  const name = document.createElement("span");
  name.className = "upload-preview-name";
  name.textContent = file.name;

  const removeBtn = document.createElement("button");
  removeBtn.className = "upload-preview-remove";
  removeBtn.textContent = "Remove";
  removeBtn.type = "button";
  removeBtn.addEventListener("click", () => {
    releasePreviewBlobUrl(previewContainer);
    previewContainer.classList.add("hidden");
    previewContainer.innerHTML = "";
    zone.classList.remove("hidden");
  });

  header.append(name, removeBtn);

  const body = document.createElement("div");
  body.className = "upload-preview-body";

  if (isPdf) {
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

  previewContainer.append(header, body);
  previewContainer.classList.remove("hidden");
  zone.classList.add("hidden");
}

if (typeof window !== "undefined") {
  window.__taxvaultTesting = Object.freeze({
    goToStep,
    renderResults,
  });
}
