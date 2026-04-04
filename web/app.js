import init, { compute_tax } from "./pkg/taxvault_wasm.js";

const SSN_PATTERN = /^\d{3}-\d{2}-\d{4}$/;
const EIN_PATTERN = /^\d{2}-\d{7}$/;
const currencyFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const state = {
  safetyAcknowledged: false,
  wasmReady: false,
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
  w2Container: document.getElementById("w2Container"),
  addW2Btn: document.getElementById("addW2Btn"),
  socialSecurityContainer: document.getElementById("socialSecurityContainer"),
  addSocialSecurityBtn: document.getElementById("addSocialSecurityBtn"),
  interestContainer: document.getElementById("interestContainer"),
  addInterestBtn: document.getElementById("addInterestBtn"),
  dividendContainer: document.getElementById("dividendContainer"),
  addDividendBtn: document.getElementById("addDividendBtn"),
  computeBtn: document.getElementById("computeBtn"),
  linesToggle: document.getElementById("linesToggle"),
  linesArrow: document.getElementById("linesArrow"),
  linesContainer: document.getElementById("linesContainer"),
  resultHero: document.getElementById("resultHero"),
  breakdownContent: document.getElementById("breakdownContent"),
};

bindStaticEvents();
start();

async function start() {
  try {
    await init();
    state.wasmReady = true;
    els.loading.classList.add("hidden");
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
  els.computeBtn.addEventListener("click", computeReturn);
  els.linesToggle.addEventListener("click", toggleLines);

  bindSsnFields(document);
  updateDependentSubtitle(false);
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

function selectStatus(status) {
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

  if (isHoh && els.dependentContainer.children.length === 0) {
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
    const spouse = readFilerInputs("s");

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

    if (
      SSN_PATTERN.test(primary.ssn) &&
      SSN_PATTERN.test(spouse.ssn) &&
      primary.ssn === spouse.ssn
    ) {
      errors.push("Primary filer and spouse must have different SSNs.");
    }
  }

  collectDependents(errors, { requireAtLeastOne: state.filingStatus === "head_of_household" });

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

function addW2() {
  state.w2Count += 1;
  const idPrefix = `w2-${state.w2Count}`;
  const card = document.createElement("section");
  card.className = "w2-card";
  card.dataset.index = String(state.w2Count);
  card.innerHTML = `
    <div class="w2-card-header">
      <h3>W-2 #${state.w2Count}</h3>
      <button class="btn-ghost remove-w2-btn" type="button">Remove</button>
    </div>
    <div class="w2-essential">
      <div class="row">
        <div class="field">
          <label for="${idPrefix}-employer">Employer Name</label>
          <input id="${idPrefix}-employer" class="w2-employer" placeholder="Company Inc.">
        </div>
        <div class="field">
          <label for="${idPrefix}-recipient">Recipient</label>
          <select id="${idPrefix}-recipient" class="w2-recipient income-recipient">
            <option value="primary">Primary Filer</option>
            ${state.filingStatus === "married_filing_jointly" ? '<option value="spouse">Spouse</option>' : ""}
          </select>
        </div>
      </div>
      <div class="row">
        <div class="field">
          <label for="${idPrefix}-ein">Employer EIN</label>
          <input id="${idPrefix}-ein" class="w2-ein" inputmode="numeric" maxlength="10" placeholder="12-3456789">
        </div>
        <div class="field">
          <label for="${idPrefix}-fed-wh">Federal Tax Withheld (Box 2)</label>
          <input id="${idPrefix}-fed-wh" type="number" class="w2-fed-wh" min="0" placeholder="0.00" step="0.01">
        </div>
      </div>
      <div class="row">
        <div class="field">
          <label for="${idPrefix}-wages">Wages (Box 1)</label>
          <input id="${idPrefix}-wages" type="number" class="w2-wages" min="0" placeholder="0.00" step="0.01">
        </div>
        <div class="field">
          <label for="${idPrefix}-state-wh">State Tax Withheld (Box 17)</label>
          <input id="${idPrefix}-state-wh" type="number" class="w2-state-wh" min="0" placeholder="0.00" step="0.01">
        </div>
      </div>
    </div>
    <div class="w2-advanced">
      <button class="w2-advanced-toggle" type="button" aria-expanded="false">
        <span class="arrow" aria-hidden="true">&#9654;</span>
        Additional W-2 fields
      </button>
      <div class="w2-advanced-fields">
        <div class="row">
          <div class="field">
            <label for="${idPrefix}-ss-wages">SS Wages (Box 3)</label>
            <input id="${idPrefix}-ss-wages" type="number" class="w2-ss-wages" min="0" placeholder="Same as wages" step="0.01">
          </div>
          <div class="field">
            <label for="${idPrefix}-ss-wh">SS Tax Withheld (Box 4)</label>
            <input id="${idPrefix}-ss-wh" type="number" class="w2-ss-wh" min="0" placeholder="0.00" step="0.01">
          </div>
        </div>
        <div class="row">
          <div class="field">
            <label for="${idPrefix}-med-wages">Medicare Wages (Box 5)</label>
            <input id="${idPrefix}-med-wages" type="number" class="w2-med-wages" min="0" placeholder="Same as wages" step="0.01">
          </div>
          <div class="field">
            <label for="${idPrefix}-med-wh">Medicare Tax (Box 6)</label>
            <input id="${idPrefix}-med-wh" type="number" class="w2-med-wh" min="0" placeholder="0.00" step="0.01">
          </div>
        </div>
      </div>
    </div>
  `;

  card.querySelector(".remove-w2-btn").addEventListener("click", () => removeW2(card));
  card.querySelector(".w2-advanced-toggle").addEventListener("click", () => toggleAdvanced(card));
  card.querySelector(".w2-ein").addEventListener("input", (event) => {
    event.target.value = formatDigits(event.target.value, [2, 7]);
  });

  const uploadZone = createUploadZone("W-2");
  card.insertBefore(uploadZone, card.querySelector(".w2-essential"));

  els.w2Container.append(card);
  updateRemoveButtons();
}

function addSocialSecurity() {
  state.socialSecurityCount += 1;
  const idPrefix = `ssa-${state.socialSecurityCount}`;
  const card = document.createElement("section");
  card.className = "w2-card ssa-card";
  card.dataset.index = String(state.socialSecurityCount);
  card.innerHTML = `
    <div class="w2-card-header">
      <h3>SSA-1099 #${state.socialSecurityCount}</h3>
      <button class="btn-ghost remove-ssa-btn" type="button">Remove</button>
    </div>
    <div class="row">
      <div class="field">
        <label for="${idPrefix}-recipient">Recipient</label>
        <select id="${idPrefix}-recipient" class="income-recipient ssa-recipient">
          <option value="primary">Primary Filer</option>
          ${state.filingStatus === "married_filing_jointly" ? '<option value="spouse">Spouse</option>' : ""}
        </select>
      </div>
      <div class="field">
        <label for="${idPrefix}-benefits">Total Benefits (Box 5)</label>
        <input id="${idPrefix}-benefits" type="number" class="ssa-benefits" min="0" placeholder="0.00" step="0.01">
      </div>
    </div>
    <div class="row">
      <div class="field">
        <label for="${idPrefix}-withholding">Voluntary Federal Tax Withheld (Box 6)</label>
        <input id="${idPrefix}-withholding" type="number" class="ssa-withholding" min="0" placeholder="0.00" step="0.01">
      </div>
    </div>
  `;

  card.querySelector(".remove-ssa-btn").addEventListener("click", () => removeSocialSecurity(card));

  const ssaUpload = createUploadZone("SSA-1099");
  card.insertBefore(ssaUpload, card.querySelector(".row"));

  els.socialSecurityContainer.append(card);
  updateSocialSecurityRemoveButtons();
}

function addInterest() {
  state.interestCount += 1;
  const idPrefix = `int-${state.interestCount}`;
  const card = document.createElement("section");
  card.className = "w2-card";
  card.dataset.index = String(state.interestCount);
  card.innerHTML = `
    <div class="w2-card-header">
      <h3>1099-INT #${state.interestCount}</h3>
      <button class="btn-ghost remove-interest-btn" type="button">Remove</button>
    </div>
    <div class="row">
      <div class="field">
        <label for="${idPrefix}-payer">Institution Name (Optional)</label>
        <input id="${idPrefix}-payer" class="interest-payer" placeholder="Summit Bank">
      </div>
      <div class="field">
        <label for="${idPrefix}-recipient">Recipient</label>
        <select id="${idPrefix}-recipient" class="income-recipient interest-recipient">
          <option value="primary">Primary Filer</option>
          ${state.filingStatus === "married_filing_jointly" ? '<option value="spouse">Spouse</option>' : ""}
        </select>
      </div>
    </div>
    <div class="row">
      <div class="field">
        <label for="${idPrefix}-taxable">Taxable Interest (Box 1)</label>
        <input id="${idPrefix}-taxable" type="number" class="interest-taxable" min="0" placeholder="0.00" step="0.01">
      </div>
      <div class="field">
        <label for="${idPrefix}-tax-exempt">Tax-Exempt Interest (Box 8)</label>
        <input id="${idPrefix}-tax-exempt" type="number" class="interest-tax-exempt" min="0" placeholder="0.00" step="0.01">
      </div>
    </div>
  `;

  card
    .querySelector(".remove-interest-btn")
    .addEventListener("click", () => removeInterest(card));

  const intUpload = createUploadZone("1099-INT");
  card.insertBefore(intUpload, card.querySelector(".row"));

  els.interestContainer.append(card);
  updateInterestRemoveButtons();
}

function addDividend() {
  state.dividendCount += 1;
  const idPrefix = `div-${state.dividendCount}`;
  const card = document.createElement("section");
  card.className = "w2-card";
  card.dataset.index = String(state.dividendCount);
  card.innerHTML = `
    <div class="w2-card-header">
      <h3>1099-DIV #${state.dividendCount}</h3>
      <button class="btn-ghost remove-dividend-btn" type="button">Remove</button>
    </div>
    <div class="row">
      <div class="field">
        <label for="${idPrefix}-payer">Institution Name (Optional)</label>
        <input id="${idPrefix}-payer" class="dividend-payer" placeholder="North Brokerage">
      </div>
      <div class="field">
        <label for="${idPrefix}-recipient">Recipient</label>
        <select id="${idPrefix}-recipient" class="income-recipient dividend-recipient">
          <option value="primary">Primary Filer</option>
          ${state.filingStatus === "married_filing_jointly" ? '<option value="spouse">Spouse</option>' : ""}
        </select>
      </div>
    </div>
    <div class="row">
      <div class="field">
        <label for="${idPrefix}-ordinary">Ordinary Dividends (Box 1a)</label>
        <input id="${idPrefix}-ordinary" type="number" class="dividend-ordinary" min="0" placeholder="0.00" step="0.01">
      </div>
      <div class="field">
        <label for="${idPrefix}-qualified">Qualified Dividends (Box 1b)</label>
        <input id="${idPrefix}-qualified" type="number" class="dividend-qualified" min="0" placeholder="0.00" step="0.01">
      </div>
    </div>
  `;

  card
    .querySelector(".remove-dividend-btn")
    .addEventListener("click", () => removeDividend(card));

  const divUpload = createUploadZone("1099-DIV");
  card.insertBefore(divUpload, card.querySelector(".row"));

  els.dividendContainer.append(card);
  updateDividendRemoveButtons();
}

function addDependent() {
  state.dependentCount += 1;
  const idPrefix = `dep-${state.dependentCount}`;
  const card = document.createElement("section");
  card.className = "w2-card dependent-card";
  card.dataset.index = String(state.dependentCount);
  card.innerHTML = `
    <div class="w2-card-header">
      <h3>Dependent #${state.dependentCount}</h3>
      <button class="btn-ghost remove-dependent-btn" type="button">Remove</button>
    </div>
    <div class="row">
      <div class="field">
        <label for="${idPrefix}-first">First Name</label>
        <input id="${idPrefix}-first" class="dep-first" placeholder="Jamie">
      </div>
      <div class="field">
        <label for="${idPrefix}-last">Last Name</label>
        <input id="${idPrefix}-last" class="dep-last" placeholder="Doe">
      </div>
    </div>
    <div class="row">
      <div class="field">
        <label for="${idPrefix}-ssn">Social Security Number</label>
        <div class="ssn-field">
          <input
            id="${idPrefix}-ssn"
            class="dep-ssn ssn-input"
            type="password"
            autocomplete="off"
            inputmode="numeric"
            maxlength="11"
            placeholder="123-45-6789"
          >
          <button class="ssn-toggle" type="button" aria-controls="${idPrefix}-ssn" aria-pressed="false">
            Show
          </button>
        </div>
      </div>
      <div class="field">
        <label for="${idPrefix}-dob">Date of Birth</label>
        <input id="${idPrefix}-dob" type="date" class="dep-dob">
      </div>
    </div>
    <div class="row">
      <div class="field">
        <label for="${idPrefix}-relationship">Relationship</label>
        <select id="${idPrefix}-relationship" class="dep-relationship">
          <option value="">Select relationship</option>
          <option value="son">Son</option>
          <option value="daughter">Daughter</option>
          <option value="stepchild">Stepchild</option>
          <option value="foster_child">Foster child</option>
          <option value="sibling">Sibling</option>
          <option value="step_sibling">Step-sibling</option>
          <option value="half_sibling">Half-sibling</option>
          <option value="grandchild">Grandchild</option>
          <option value="niece">Niece</option>
          <option value="nephew">Nephew</option>
          <option value="parent">Parent</option>
          <option value="grandparent">Grandparent</option>
          <option value="other">Other</option>
        </select>
      </div>
      <div class="field">
        <label for="${idPrefix}-months">Months Lived in Home</label>
        <input
          id="${idPrefix}-months"
          type="number"
          class="dep-months"
          min="0"
          max="12"
          step="1"
          placeholder="12"
        >
      </div>
    </div>
  `;

  card.querySelector(".remove-dependent-btn").addEventListener("click", () => removeDependent(card));
  bindSsnFields(card);

  els.dependentContainer.append(card);
  updateDependentRemoveButtons();
}

function removeW2(card) {
  card.remove();
  updateRemoveButtons();
}

function removeInterest(card) {
  card.remove();
  updateInterestRemoveButtons();
}

function removeSocialSecurity(card) {
  card.remove();
  updateSocialSecurityRemoveButtons();
}

function removeDividend(card) {
  card.remove();
  updateDividendRemoveButtons();
}

function removeDependent(card) {
  card.remove();
  updateDependentRemoveButtons();
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
    els.computeBtn.disabled = false;
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
  const w2s = collectW2Cards(errors);
  const socialSecurityIncome = collectSocialSecurityCards(errors);
  const interestIncome = collectInterestCards(errors);
  const dividendIncome = collectDividendCards(errors);

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
        tax_year: 2025,
        filing_status: state.filingStatus,
        primary_filer: filerPayload(primary),
        spouse: spouse ? filerPayload(spouse) : null,
        dependents,
        w2_income: w2s,
        interest_income: interestIncome,
        dividend_income: dividendIncome,
        social_security_income: socialSecurityIncome,
      },
    },
    errors,
  };
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
  renderBreakdown(data.summary);
  renderLines(data.form?.lines || {});

  els.linesContainer.classList.remove("open");
  els.linesArrow.classList.remove("open");
  els.linesToggle.setAttribute("aria-expanded", "false");
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

function parseMoney(rawValue, defaultValue = Number.NaN) {
  if (rawValue === "") {
    return defaultValue;
  }

  const value = Number(rawValue);
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

function clearAllData() {
  if (!window.confirm("Clear all entered personal data, tax inputs, and results from this page?")) {
    return;
  }

  hideError();
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

  els.w2Container.replaceChildren();
  els.socialSecurityContainer.replaceChildren();
  els.interestContainer.replaceChildren();
  els.dividendContainer.replaceChildren();
  els.dependentContainer.replaceChildren();
  els.resultHero.replaceChildren();
  els.breakdownContent.replaceChildren();
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
  showDisclaimerGate();
}

function createElement(tagName, { className = "", text = "" } = {}) {
  const element = document.createElement(tagName);

  if (className) {
    element.className = className;
  }

  if (text) {
    element.textContent = text;
  }

  return element;
}

/* ── Document Upload ── */

const ACCEPTED_TYPES = ".pdf,.png,.jpg,.jpeg,.heic,.webp";

function createUploadZone(formLabel) {
  const wrapper = document.createElement("div");
  wrapper.className = "upload-zone-wrapper";

  const zone = document.createElement("div");
  zone.className = "upload-zone";
  zone.setAttribute("role", "button");
  zone.setAttribute("aria-label", `Upload ${formLabel} document`);
  zone.setAttribute("tabindex", "0");
  zone.innerHTML = `
    <svg class="upload-zone-icon" width="28" height="28" viewBox="0 0 24 24" fill="none"
         stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"
         aria-hidden="true">
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
      <polyline points="17 8 12 3 7 8"/>
      <line x1="12" y1="3" x2="12" y2="15"/>
    </svg>
    <div class="upload-zone-text">
      Drop your <strong>${formLabel}</strong> here or tap to browse
    </div>
    <div class="upload-zone-hint">PDF, PNG, JPG, HEIC, or WEBP</div>
  `;

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

  const blobUrl = URL.createObjectURL(file);
  const isPdf = /\.pdf$/i.test(file.name);

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
    URL.revokeObjectURL(blobUrl);
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
