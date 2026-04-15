function cloneRecord(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? { ...value } : {};
}

function cloneList(items) {
  return Array.isArray(items) ? items.map((item) => cloneRecord(item)) : [];
}

export function cloneSnapshot(snapshot) {
  return {
    ...cloneRecord(snapshot),
    primaryFiler: cloneRecord(snapshot?.primaryFiler),
    spouse: cloneRecord(snapshot?.spouse),
    adjustments: cloneRecord(snapshot?.adjustments),
    dependents: cloneList(snapshot?.dependents),
    w2s: cloneList(snapshot?.w2s),
    socialSecurityIncome: cloneList(snapshot?.socialSecurityIncome),
    interestIncome: cloneList(snapshot?.interestIncome),
    dividendIncome: cloneList(snapshot?.dividendIncome),
  };
}

export function createDraftFormState({
  state,
  els,
  readFilerInputs,
  readTrimmedControlValue,
  readControlValue,
  readQueryValue,
  readTrimmedQueryValue,
}) {
  function cacheSnapshot(snapshot) {
    state.lastCapturedDraftSnapshot = cloneSnapshot(snapshot);
    state.draftSnapshotDirty = false;
  }

  function readDependentsFromDom() {
    return Array.from(els.dependentContainer.querySelectorAll(".dependent-card")).map((card) => ({
      firstName: readTrimmedQueryValue(card, ".dep-first"),
      lastName: readTrimmedQueryValue(card, ".dep-last"),
      ssn: readTrimmedQueryValue(card, ".dep-ssn"),
      dob: readQueryValue(card, ".dep-dob"),
      relationship: readQueryValue(card, ".dep-relationship"),
      monthsLivedInHome: readTrimmedQueryValue(card, ".dep-months"),
    }));
  }

  function readW2sFromDom() {
    return Array.from(els.w2Container.querySelectorAll(".w2-card")).map((card) => ({
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
    }));
  }

  function readSocialSecurityFromDom() {
    return Array.from(els.socialSecurityContainer.querySelectorAll(".ssa-card")).map((card) => ({
      recipient: readQueryValue(card, ".ssa-recipient"),
      totalBenefits: readTrimmedQueryValue(card, ".ssa-benefits"),
      voluntaryWithholding: readTrimmedQueryValue(card, ".ssa-withholding"),
    }));
  }

  function readInterestFromDom() {
    return Array.from(els.interestContainer.querySelectorAll(".interest-card")).map((card) => ({
      payerName: readTrimmedQueryValue(card, ".interest-payer"),
      recipient: readQueryValue(card, ".interest-recipient"),
      taxableInterest: readTrimmedQueryValue(card, ".interest-taxable"),
      taxExemptInterest: readTrimmedQueryValue(card, ".interest-tax-exempt"),
    }));
  }

  function readDividendsFromDom() {
    return Array.from(els.dividendContainer.querySelectorAll(".dividend-card")).map((card) => ({
      payerName: readTrimmedQueryValue(card, ".dividend-payer"),
      recipient: readQueryValue(card, ".dividend-recipient"),
      ordinaryDividends: readTrimmedQueryValue(card, ".dividend-ordinary"),
      qualifiedDividends: readTrimmedQueryValue(card, ".dividend-qualified"),
    }));
  }

  function readSnapshotFromDom() {
    return {
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
      dependents: readDependentsFromDom(),
      w2s: readW2sFromDom(),
      socialSecurityIncome: readSocialSecurityFromDom(),
      interestIncome: readInterestFromDom(),
      dividendIncome: readDividendsFromDom(),
    };
  }

  function markDirty() {
    state.draftSnapshotDirty = true;
  }

  function syncFromDom() {
    cacheSnapshot(readSnapshotFromDom());
    return cloneSnapshot(state.lastCapturedDraftSnapshot);
  }

  function ensureSnapshot() {
    if (state.draftSnapshotDirty || !state.lastCapturedDraftSnapshot) {
      syncFromDom();
    }
  }

  function updateSnapshotCollection(collectionKey, reader) {
    ensureSnapshot();
    const nextSnapshot = cloneSnapshot(state.lastCapturedDraftSnapshot);
    nextSnapshot[collectionKey] = reader();
    cacheSnapshot(nextSnapshot);
  }

  function updateStaticField(target) {
    ensureSnapshot();
    const nextSnapshot = cloneSnapshot(state.lastCapturedDraftSnapshot);
    const checked = Boolean(target instanceof HTMLInputElement && target.checked);
    const trimmedValue = readTrimmedControlValue(target);
    const rawValue = readControlValue(target);

    switch (target.id) {
      case "pFirst":
        nextSnapshot.primaryFiler.firstName = trimmedValue;
        break;
      case "pLast":
        nextSnapshot.primaryFiler.lastName = trimmedValue;
        break;
      case "pSsn":
        nextSnapshot.primaryFiler.ssn = trimmedValue;
        break;
      case "pDob":
        nextSnapshot.primaryFiler.dob = rawValue;
        break;
      case "pBlind":
        nextSnapshot.primaryFiler.isBlind = checked;
        break;
      case "pDependent":
        nextSnapshot.primaryFiler.isDependent = checked;
        break;
      case "sFirst":
        nextSnapshot.spouse.firstName = trimmedValue;
        break;
      case "sLast":
        nextSnapshot.spouse.lastName = trimmedValue;
        break;
      case "sSsn":
        nextSnapshot.spouse.ssn = trimmedValue;
        break;
      case "sDob":
        nextSnapshot.spouse.dob = rawValue;
        break;
      case "sBlind":
        nextSnapshot.spouse.isBlind = checked;
        break;
      case "sDependent":
        nextSnapshot.spouse.isDependent = checked;
        break;
      case "traditionalIraDeduction":
        nextSnapshot.adjustments.traditionalIraDeduction = trimmedValue;
        break;
      case "hsaDeduction":
        nextSnapshot.adjustments.hsaDeduction = trimmedValue;
        break;
      case "studentLoanInterestPaid":
        nextSnapshot.adjustments.studentLoanInterestPaid = trimmedValue;
        break;
      case "studentLoanQualifiedLoan":
        nextSnapshot.adjustments.studentLoanQualifiedLoan = checked;
        break;
      case "studentLoanLegallyObligated":
        nextSnapshot.adjustments.studentLoanLegallyObligated = checked;
        break;
      case "estimatedTaxPayments":
        nextSnapshot.estimatedTaxPayments = trimmedValue;
        break;
      default:
        return;
    }

    cacheSnapshot(nextSnapshot);
  }

  function handleFieldMutation(target) {
    if (!(target instanceof HTMLInputElement || target instanceof HTMLSelectElement || target instanceof HTMLTextAreaElement)) {
      return;
    }

    if (target.type === "file") {
      return;
    }

    if (target.closest(".ssa-card")) {
      updateSnapshotCollection("socialSecurityIncome", readSocialSecurityFromDom);
      return;
    }

    if (target.closest(".interest-card")) {
      updateSnapshotCollection("interestIncome", readInterestFromDom);
      return;
    }

    if (target.closest(".dividend-card")) {
      updateSnapshotCollection("dividendIncome", readDividendsFromDom);
      return;
    }

    if (target.closest(".dependent-card")) {
      updateSnapshotCollection("dependents", readDependentsFromDom);
      return;
    }

    if (target.closest(".w2-card")) {
      updateSnapshotCollection("w2s", readW2sFromDom);
      return;
    }

    updateStaticField(target);
  }

  function captureDraftSnapshot() {
    ensureSnapshot();

    return {
      ...cloneSnapshot(state.lastCapturedDraftSnapshot),
      filingStatus: state.filingStatus,
      currentStep: Math.min(state.currentStep, 2),
      hadResults: state.currentStep === 3,
      savedAt: new Date().toISOString(),
    };
  }

  return {
    captureDraftSnapshot,
    handleFieldMutation,
    markDirty,
    syncFromDom,
  };
}
