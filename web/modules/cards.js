export function createCardModule({
  els,
  state,
  constants,
  helpers,
}) {
  const {
    DATE_INPUT_MIN,
    DEPENDENT_RELATIONSHIP_OPTIONS,
    MAX_DEPENDENTS,
    MAX_DIVIDEND_FORMS,
    MAX_INTEREST_FORMS,
    MAX_REFERENCE_FILE_SIZE,
    MAX_SOCIAL_SECURITY_FORMS,
    MAX_TEXT_FIELD_LENGTH,
    MAX_W2_FORMS,
  } = constants;
  const {
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
  } = helpers;

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

  function buildDynamicCardChildren(cardConfig, idPrefix, count) {
    const sections = cardConfig.buildSections(idPrefix, count);
    return cardConfig.referenceLabel
      ? [createReferenceZone(cardConfig.referenceLabel), ...sections]
      : sections;
  }

  function applyDynamicCardMutation(cardConfig, { batched = false, announceMessage = "" } = {}) {
    cardConfig.updateRemoveButtons();
    cardConfig.afterStructureChange?.();

    if (batched) {
      return;
    }

    resetComputedEstimate();
    scheduleSupportReview();
    scheduleDraftSave();

    if (announceMessage) {
      announceUiStatus(announceMessage);
    }
  }

  function createDynamicCard(cardConfig, { focusNewCard = true, batched = false } = {}) {
    if (!canAddCard(cardConfig.container, cardConfig.maxCount, cardConfig.limitLabel)) {
      return null;
    }

    state[cardConfig.countKey] += 1;
    const count = state[cardConfig.countKey];
    const idPrefix = `${cardConfig.idPrefix}-${count}`;
    const card = createCardSection(cardConfig.cardClassName, count);
    card.dataset.cardType = cardConfig.cardType;

    card.append(
      createCardHeader(`${cardConfig.titleLabel} #${count}`, {
        clearButtonClass: cardConfig.clearButtonClass,
        removeButtonClass: cardConfig.removeButtonClass,
      }),
      ...buildDynamicCardChildren(cardConfig, idPrefix, count)
    );

    cardConfig.initializeCard?.(card);
    cardConfig.container.append(card);
    applyDynamicCardMutation(cardConfig, {
      batched,
      announceMessage: cardConfig.addAnnouncement(count),
    });
    if (focusNewCard && !batched) {
      focusFirstField(card, cardConfig.focusSelector);
    }

    return card;
  }

  function removeDynamicCard(card, cardConfig) {
    const focusTarget = nextFocusTargetAfterRemoval(card, cardConfig.addButton);
    if (cardConfig.cleanupReferences) {
      cleanupReferencePreviews(card);
    }

    card.remove();
    applyDynamicCardMutation(cardConfig, {
      announceMessage: cardConfig.removeAnnouncement,
    });
    focusElement(focusTarget);
  }

  function restoreConfiguredCards(items, addCard, applySnapshot) {
    items.forEach((item) => {
      const card = addCard({ focusNewCard: false, batched: true });
      if (!card) {
        return;
      }

      applySnapshot(card, item);
    });
  }

  function buildW2CardSections(idPrefix) {
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

    return [essential, advanced];
  }

  function applyW2CardSnapshot(card, w2) {
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
  }

  function buildSocialSecurityCardSections(idPrefix) {
    return [
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
      ),
    ];
  }

  function applySocialSecurityCardSnapshot(card, item) {
    card.querySelector(".ssa-recipient").value = item.recipient || "primary";
    card.querySelector(".ssa-benefits").value = item.totalBenefits || "";
    card.querySelector(".ssa-withholding").value = item.voluntaryWithholding || "";
  }

  function buildInterestCardSections(idPrefix) {
    return [
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
      ),
    ];
  }

  function applyInterestCardSnapshot(card, item) {
    card.querySelector(".interest-payer").value = item.payerName || "";
    card.querySelector(".interest-recipient").value = item.recipient || "primary";
    card.querySelector(".interest-taxable").value = item.taxableInterest || "";
    card.querySelector(".interest-tax-exempt").value = item.taxExemptInterest || "";
  }

  function buildDividendCardSections(idPrefix) {
    return [
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
      ),
    ];
  }

  function applyDividendCardSnapshot(card, item) {
    card.querySelector(".dividend-payer").value = item.payerName || "";
    card.querySelector(".dividend-recipient").value = item.recipient || "primary";
    card.querySelector(".dividend-ordinary").value = item.ordinaryDividends || "";
    card.querySelector(".dividend-qualified").value = item.qualifiedDividends || "";
  }

  function buildDependentCardSections(idPrefix) {
    return [
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
      ),
    ];
  }

  function applyDependentCardSnapshot(card, dependent) {
    card.querySelector(".dep-first").value = dependent.firstName || "";
    card.querySelector(".dep-last").value = dependent.lastName || "";
    card.querySelector(".dep-ssn").value = dependent.ssn || "";
    card.querySelector(".dep-dob").value = dependent.dob || "";
    card.querySelector(".dep-relationship").value = dependent.relationship || "";
    card.querySelector(".dep-months").value = dependent.monthsLivedInHome || "";
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

  const W2_CARD_CONFIG = {
    cardType: "w2",
    container: els.w2Container,
    addButton: els.addW2Btn,
    maxCount: MAX_W2_FORMS,
    limitLabel: "W-2 forms",
    countKey: "w2Count",
    idPrefix: "w2",
    cardClassName: "w2-card",
    titleLabel: "W-2",
    referenceLabel: "W-2",
    clearButtonClass: "clear-w2-btn",
    removeButtonClass: "remove-w2-btn",
    clearOptions: {
      label: "W-2",
      focusSelector: ".w2-employer",
      closeAdvanced: true,
    },
    focusSelector: ".w2-employer",
    buildSections: buildW2CardSections,
    updateRemoveButtons,
    addAnnouncement: (count) => `Added W-2 #${count}.`,
    removeAnnouncement: "Removed W-2 form.",
    cleanupReferences: true,
    afterStructureChange: renderIncomeSummaryChips,
  };

  const SOCIAL_SECURITY_CARD_CONFIG = {
    cardType: "socialSecurity",
    container: els.socialSecurityContainer,
    addButton: els.addSocialSecurityBtn,
    maxCount: MAX_SOCIAL_SECURITY_FORMS,
    limitLabel: "SSA-1099 forms",
    countKey: "socialSecurityCount",
    idPrefix: "ssa",
    cardClassName: "w2-card ssa-card",
    titleLabel: "SSA-1099",
    referenceLabel: "SSA-1099",
    clearButtonClass: "clear-ssa-btn",
    removeButtonClass: "remove-ssa-btn",
    clearOptions: {
      label: "SSA-1099",
      focusSelector: ".ssa-benefits",
    },
    focusSelector: ".ssa-benefits",
    buildSections: buildSocialSecurityCardSections,
    updateRemoveButtons: updateSocialSecurityRemoveButtons,
    addAnnouncement: (count) => `Added SSA-1099 #${count}.`,
    removeAnnouncement: "Removed SSA-1099 form.",
    cleanupReferences: true,
    afterStructureChange: renderIncomeSummaryChips,
  };

  const INTEREST_CARD_CONFIG = {
    cardType: "interest",
    container: els.interestContainer,
    addButton: els.addInterestBtn,
    maxCount: MAX_INTEREST_FORMS,
    limitLabel: "1099-INT forms",
    countKey: "interestCount",
    idPrefix: "int",
    cardClassName: "w2-card interest-card",
    titleLabel: "1099-INT",
    referenceLabel: "1099-INT",
    clearButtonClass: "clear-interest-btn",
    removeButtonClass: "remove-interest-btn",
    clearOptions: {
      label: "1099-INT",
      focusSelector: ".interest-taxable",
    },
    focusSelector: ".interest-taxable",
    buildSections: buildInterestCardSections,
    updateRemoveButtons: updateInterestRemoveButtons,
    addAnnouncement: (count) => `Added 1099-INT #${count}.`,
    removeAnnouncement: "Removed 1099-INT form.",
    cleanupReferences: true,
    afterStructureChange: renderIncomeSummaryChips,
  };

  const DIVIDEND_CARD_CONFIG = {
    cardType: "dividend",
    container: els.dividendContainer,
    addButton: els.addDividendBtn,
    maxCount: MAX_DIVIDEND_FORMS,
    limitLabel: "1099-DIV forms",
    countKey: "dividendCount",
    idPrefix: "div",
    cardClassName: "w2-card dividend-card",
    titleLabel: "1099-DIV",
    referenceLabel: "1099-DIV",
    clearButtonClass: "clear-dividend-btn",
    removeButtonClass: "remove-dividend-btn",
    clearOptions: {
      label: "1099-DIV",
      focusSelector: ".dividend-ordinary",
    },
    focusSelector: ".dividend-ordinary",
    buildSections: buildDividendCardSections,
    updateRemoveButtons: updateDividendRemoveButtons,
    addAnnouncement: (count) => `Added 1099-DIV #${count}.`,
    removeAnnouncement: "Removed 1099-DIV form.",
    cleanupReferences: true,
    afterStructureChange: renderIncomeSummaryChips,
  };

  const DEPENDENT_CARD_CONFIG = {
    cardType: "dependent",
    container: els.dependentContainer,
    addButton: els.addDependentBtn,
    maxCount: MAX_DEPENDENTS,
    limitLabel: "dependents",
    countKey: "dependentCount",
    idPrefix: "dep",
    cardClassName: "dependent-card",
    titleLabel: "Dependent",
    clearButtonClass: "clear-dependent-btn",
    removeButtonClass: "remove-dependent-btn",
    clearOptions: {
      label: "dependent",
      focusSelector: ".dep-first",
    },
    focusSelector: ".dep-first",
    buildSections: buildDependentCardSections,
    initializeCard: (card) => {
      initializeSsnFields(card);
      applyDateConstraints(card);
    },
    updateRemoveButtons: updateDependentRemoveButtons,
    addAnnouncement: (count) => `Added dependent #${count}.`,
    removeAnnouncement: "Removed dependent.",
  };

  const DYNAMIC_CARD_CONFIGS = [
    W2_CARD_CONFIG,
    SOCIAL_SECURITY_CARD_CONFIG,
    INTEREST_CARD_CONFIG,
    DIVIDEND_CARD_CONFIG,
    DEPENDENT_CARD_CONFIG,
  ];

  const DYNAMIC_CARD_CONFIG_BY_TYPE = Object.fromEntries(
    DYNAMIC_CARD_CONFIGS.map((config) => [config.cardType, config])
  );

  function getDynamicCardContext(target) {
    const card = target.closest("[data-card-type]");
    if (!(card instanceof HTMLElement)) {
      return { card: null, config: null };
    }

    return {
      card,
      config: DYNAMIC_CARD_CONFIG_BY_TYPE[card.dataset.cardType] || null,
    };
  }

  function addW2(options = {}) {
    return createDynamicCard(W2_CARD_CONFIG, options);
  }

  function addSocialSecurity(options = {}) {
    return createDynamicCard(SOCIAL_SECURITY_CARD_CONFIG, options);
  }

  function addInterest(options = {}) {
    return createDynamicCard(INTEREST_CARD_CONFIG, options);
  }

  function addDividend(options = {}) {
    return createDynamicCard(DIVIDEND_CARD_CONFIG, options);
  }

  function addDependent({ focusNewCard = true, batched = false } = {}) {
    return createDynamicCard(DEPENDENT_CARD_CONFIG, { focusNewCard, batched });
  }

  function restoreDependents(dependents) {
    restoreConfiguredCards(dependents, addDependent, applyDependentCardSnapshot);
  }

  function restoreW2Cards(w2s) {
    restoreConfiguredCards(w2s, addW2, applyW2CardSnapshot);
  }

  function restoreSocialSecurityCards(items) {
    restoreConfiguredCards(items, addSocialSecurity, applySocialSecurityCardSnapshot);
  }

  function restoreInterestCards(items) {
    restoreConfiguredCards(items, addInterest, applyInterestCardSnapshot);
  }

  function restoreDividendCards(items) {
    restoreConfiguredCards(items, addDividend, applyDividendCardSnapshot);
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

  function handleCardButtonClick(button) {
    const { card, config } = getDynamicCardContext(button);
    if (!(card instanceof HTMLElement) || !config) {
      return false;
    }

    if (button.classList.contains("w2-advanced-toggle")) {
      toggleAdvanced(card);
      return true;
    }

    if (button.classList.contains(config.clearButtonClass)) {
      clearCardFields(card, config.clearOptions);
      return true;
    }

    if (button.classList.contains(config.removeButtonClass)) {
      removeDynamicCard(card, config);
      return true;
    }

    return false;
  }

  const ACCEPTED_TYPES = ".pdf,.png,.jpg,.jpeg,.gif,.heic,.heif,.webp,.avif";
  const PDF_SIGNATURE = [0x25, 0x50, 0x44, 0x46];
  const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  const JPEG_SIGNATURE = [0xff, 0xd8, 0xff];
  const GIF87A_SIGNATURE = [0x47, 0x49, 0x46, 0x38, 0x37, 0x61];
  const GIF89A_SIGNATURE = [0x47, 0x49, 0x46, 0x38, 0x39, 0x61];
  const WEBP_RIFF_SIGNATURE = [0x52, 0x49, 0x46, 0x46];
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
    return bytes.length >= 12 &&
      asciiFromBytes(bytes, 4, 4) === "ftyp" &&
      ISO_BMFF_IMAGE_BRANDS.has(asciiFromBytes(bytes, 8, 4));
  }

  function isRecognizedImageSignature(bytes) {
    return (
      bytesStartWith(bytes, PNG_SIGNATURE) ||
      bytesStartWith(bytes, JPEG_SIGNATURE) ||
      bytesStartWith(bytes, GIF87A_SIGNATURE) ||
      bytesStartWith(bytes, GIF89A_SIGNATURE) ||
      (
        bytesStartWith(bytes, WEBP_RIFF_SIGNATURE) &&
        asciiFromBytes(bytes, 8, 4) === "WEBP"
      ) ||
      isIsoBmffImage(bytes)
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

  function createReferencePreviewCard(
    file,
    previewKind,
    fileKey,
    previewSection,
    previewList,
    formLabel,
    feedback
  ) {
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
    const previewList = createElement("div", { className: "upload-preview-list" });
    clearBtn.addEventListener("click", () => {
      clearReferencePreviews(preview, previewList, formLabel, feedback);
    });
    previewToolbar.append(previewCount, clearBtn);

    preview.append(previewToolbar, previewList);

    zone.addEventListener("click", () => fileInput.click());
    zone.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        fileInput.click();
      }
    });

    zone.addEventListener("dragover", (event) => {
      event.preventDefault();
      zone.classList.add("dragover");
    });
    zone.addEventListener("dragleave", () => zone.classList.remove("dragover"));
    zone.addEventListener("drop", (event) => {
      event.preventDefault();
      zone.classList.remove("dragover");
      if (event.dataTransfer.files.length > 0) {
        void addReferencePreviews(
          Array.from(event.dataTransfer.files),
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

  return {
    addDependent,
    addDividend,
    addInterest,
    addSocialSecurity,
    addW2,
    cleanupReferencePreviews,
    clearRestorableCards,
    countEnteredFormCards,
    handleCardButtonClick,
    renderIncomeSummaryChips,
    restoreDependents,
    restoreDividendCards,
    restoreInterestCards,
    restoreSocialSecurityCards,
    restoreW2Cards,
    updateDependentRemoveButtons,
    updateDividendRemoveButtons,
    updateInterestRemoveButtons,
    updateRemoveButtons,
    updateSocialSecurityRemoveButtons,
  };
}
