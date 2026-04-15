export function buildSupportSnapshotRedactions(snapshot) {
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

export function createDraftHelpers({
  constants,
  currentTaxYear,
  normalizeTaxYear,
  isSupportedTaxYear,
  supportedTaxYearEntries,
  normalizeFilingStatus,
  normalizeIncomeRecipient,
  normalizeDependentRelationship,
  normalizeDraftStep,
  isPlainObject,
}) {
  const {
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
  } = constants;

  function snapshotHasUserData(snapshot) {
    const hasText = (value) => typeof value === "string" && value.trim() !== "";
    const hasTruthyValue = (value) => hasText(value) || value === true;
    const hasObjectValue = (value) =>
      isPlainObject(value) && Object.values(value).some(hasTruthyValue);
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
              typeof dependent?.monthsLivedInHome === "string"
                ? dependent.monthsLivedInHome
                : "",
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
        Object.entries(value).map(([key, entryValue]) => [
          key,
          redactStructuredValue(entryValue, replacements),
        ])
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

  function buildStoredDraftEnvelope(
    snapshot,
    { createdAt, taxYear, draftEnvelopeCreatedAt } = {}
  ) {
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
        : draftEnvelopeCreatedAt || updatedAt;

    return buildDraftEnvelope(sanitizedSnapshot, {
      createdAt: envelopeCreatedAt,
      updatedAt,
      piiRedacted: true,
      taxYear,
    });
  }

  function truncateDraftField(value, maxLen) {
    if (typeof value !== "string") {
      return "";
    }

    return value.length > maxLen ? value.slice(0, maxLen) : value;
  }

  function sanitizeDraftSnapshotForRestore(snapshot) {
    if (!isPlainObject(snapshot)) {
      return null;
    }

    const filingStatus = normalizeFilingStatus(snapshot.filingStatus);
    const currentStep = normalizeDraftStep(snapshot.currentStep);
    const hadResults = Boolean(snapshot.hadResults);
    const savedAt =
      typeof snapshot.savedAt === "string" ? snapshot.savedAt : new Date().toISOString();

    const rawPrimary = snapshot.primaryFiler;
    const rawSpouse = snapshot.spouse;
    const primaryFiler =
      isPlainObject(rawPrimary)
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
      isPlainObject(rawSpouse)
        ? {
            firstName: truncateDraftField(rawSpouse.firstName, MAX_TEXT_FIELD_LENGTH),
            lastName: truncateDraftField(rawSpouse.lastName, MAX_TEXT_FIELD_LENGTH),
            ssn: "",
            dob:
              typeof rawSpouse.dob === "string" && ISO_DATE_RE.test(rawSpouse.dob)
                ? rawSpouse.dob
                : "",
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
      isPlainObject(rawAdj)
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
      ? snapshot.dependents.slice(0, MAX_DEPENDENTS).map((dependent) => {
          if (!isPlainObject(dependent)) {
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
            dependent.monthsLivedInHome === "" ||
            dependent.monthsLivedInHome === null ||
            dependent.monthsLivedInHome === undefined
              ? ""
              : String(dependent.monthsLivedInHome);
          const monthsNum = monthsRaw === "" ? Number.NaN : Number(monthsRaw);
          const monthsOk =
            Number.isInteger(monthsNum) && monthsNum >= 0 && monthsNum <= 12
              ? String(monthsNum)
              : "";

          return {
            firstName: truncateDraftField(dependent.firstName, MAX_TEXT_FIELD_LENGTH),
            lastName: truncateDraftField(dependent.lastName, MAX_TEXT_FIELD_LENGTH),
            ssn: "",
            dob:
              typeof dependent.dob === "string" && ISO_DATE_RE.test(dependent.dob)
                ? dependent.dob
                : "",
            relationship: normalizeDependentRelationship(dependent.relationship),
            monthsLivedInHome: monthsOk,
          };
        })
      : [];

    const w2s = Array.isArray(snapshot.w2s)
      ? snapshot.w2s.slice(0, MAX_W2_FORMS).map((w2) => {
          if (!isPlainObject(w2)) {
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
          if (!isPlainObject(item)) {
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
          if (!isPlainObject(item)) {
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
          if (!isPlainObject(item)) {
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

  function buildEmptyDraftSnapshot() {
    return sanitizeDraftSnapshotForRestore({});
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

  return {
    buildAnonymizedSupportInputSnapshot,
    buildDraftEnvelope,
    buildEmptyDraftSnapshot,
    buildStoredDraftEnvelope,
    draftRestoreMessage,
    looksLikeDraftEnvelope,
    looksLikeLegacyDraftSnapshot,
    prepareDraftEnvelopeForRestore,
    redactSupportSnapshotEnvelope,
    sanitizeDraftSnapshotForRestore,
    snapshotHasUserData,
    stripPiiFromSnapshot,
  };
}
