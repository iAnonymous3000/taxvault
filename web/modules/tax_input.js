import { dedupeMessages, isPastOrToday } from "./common.js";

function isSupportedHohQualifyingPersonCandidate(dependent, supportedRelationships) {
  const monthsLivedInHome = Number(
    dependent?.months_lived_in_home ?? dependent?.monthsLivedInHome ?? Number.NaN
  );

  return (
    Number.isFinite(monthsLivedInHome) &&
    monthsLivedInHome > 6 &&
    supportedRelationships.has(dependent?.relationship)
  );
}

export function collectHeadOfHouseholdStep1Issues(dependents, supportedRelationships) {
  if (!Array.isArray(dependents) || dependents.length === 0) {
    return [];
  }

  if (dependents.some((dependent) => isSupportedHohQualifyingPersonCandidate(dependent, supportedRelationships))) {
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

export function validateUniqueSsnEntries(
  errors,
  filingStatus,
  primary,
  spouse,
  dependents,
  ssnPattern
) {
  const seen = new Map();
  const entries = [
    {
      label: "Primary filer",
      ssn: primary?.ssn?.trim() || "",
      valid: ssnPattern.test(primary?.ssn?.trim() || ""),
    },
  ];

  if (filingStatus === "married_filing_jointly") {
    entries.push({
      label: "Spouse",
      ssn: spouse?.ssn?.trim() || "",
      valid: ssnPattern.test(spouse?.ssn?.trim() || ""),
    });
  }

  dependents.forEach((dependent, index) => {
    entries.push({
      label: `Dependent #${index + 1}`,
      ssn: dependent.ssn,
      valid: ssnPattern.test(dependent.ssn),
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

export function validateStep1Snapshot({
  snapshot,
  filingStatus,
  ssnPattern,
  supportedHohRelationships,
}) {
  const messages = [];
  const fieldErrors = [];
  const primary = snapshot?.primaryFiler || {};
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
  } else if (!ssnPattern.test(primary.ssn)) {
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

  if (filingStatus === "married_filing_jointly") {
    spouse = snapshot?.spouse || {};

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
    } else if (!ssnPattern.test(spouse.ssn)) {
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

  const dependents = collectDependentEntries(
    snapshot?.dependents,
    messages,
    ssnPattern,
    { requireAtLeastOne: filingStatus === "head_of_household" }
  );
  validateUniqueSsnEntries(messages, filingStatus, primary, spouse, dependents, ssnPattern);

  if (messages.length === 0) {
    if (primary.isDependent || spouse?.isDependent) {
      messages.push(
        "TaxVault does not support filers who can be claimed as dependents on another return."
      );
    }

    if (filingStatus === "head_of_household") {
      messages.push(
        ...collectHeadOfHouseholdStep1Issues(dependents, supportedHohRelationships)
      );
    }
  }

  return { messages: dedupeMessages(messages), fieldErrors };
}

function enforceCollectionLimit(errors, label, count, maxCount) {
  if (count > maxCount) {
    errors.push(`TaxVault supports up to ${maxCount} ${label} per draft.`);
  }
}

function collectDependentEntries(
  items,
  errors,
  ssnPattern,
  { requireAtLeastOne = false } = {}
) {
  const dependents = [];
  const entries = Array.isArray(items) ? items : [];

  entries.forEach((dependent, index) => {
    const firstName = typeof dependent?.firstName === "string" ? dependent.firstName.trim() : "";
    const lastName = typeof dependent?.lastName === "string" ? dependent.lastName.trim() : "";
    const ssn = typeof dependent?.ssn === "string" ? dependent.ssn.trim() : "";
    const dob = typeof dependent?.dob === "string" ? dependent.dob : "";
    const relationship = typeof dependent?.relationship === "string" ? dependent.relationship : "";
    const rawMonths =
      dependent?.monthsLivedInHome === "" ||
      dependent?.monthsLivedInHome === null ||
      dependent?.monthsLivedInHome === undefined
        ? ""
        : String(dependent.monthsLivedInHome).trim();
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
    } else if (!ssnPattern.test(ssn)) {
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
    if (!Number.isInteger(monthsLivedInHome) || monthsLivedInHome < 0 || monthsLivedInHome > 12) {
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

function collectAdjustmentPayload(snapshot, errors, parseMoney) {
  const adjustmentsSnapshot = snapshot?.adjustments || {};
  const adjustments = {
    traditional_ira_deduction: 0,
    hsa_deduction: 0,
    student_loan_interest_paid: 0,
    student_loan_interest_is_qualified_loan: Boolean(adjustmentsSnapshot.studentLoanQualifiedLoan),
    student_loan_interest_is_legally_obligated: Boolean(
      adjustmentsSnapshot.studentLoanLegallyObligated
    ),
  };

  const fields = [
    {
      key: "traditional_ira_deduction",
      label: "Traditional IRA deduction",
      rawValue: adjustmentsSnapshot.traditionalIraDeduction,
    },
    {
      key: "hsa_deduction",
      label: "HSA deduction",
      rawValue: adjustmentsSnapshot.hsaDeduction,
    },
    {
      key: "student_loan_interest_paid",
      label: "Student loan interest paid",
      rawValue: adjustmentsSnapshot.studentLoanInterestPaid,
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

function collectEstimatedTaxPayments(snapshot, errors, parseMoney) {
  const value = parseMoney(snapshot?.estimatedTaxPayments, 0);
  if (!Number.isFinite(value) || value < 0) {
    errors.push("Estimated tax payments must be 0 or greater.");
    return 0;
  }

  return value;
}

function filerPayload(filer) {
  return {
    first_name: filer?.firstName || "",
    last_name: filer?.lastName || "",
    ssn: filer?.ssn || "",
    date_of_birth: filer?.dob || "",
    is_blind: Boolean(filer?.isBlind),
    is_dependent: Boolean(filer?.isDependent),
  };
}

function collectIncomeCards(items, collectConfig, errors) {
  const entries = [];

  (Array.isArray(items) ? items : []).forEach((item, index) => {
    const snapshot = collectConfig.readSnapshot(item);
    if (collectConfig.isBlank(snapshot)) {
      return;
    }

    const label = `${collectConfig.titleLabel} #${index + 1}`;
    const priorErrorCount = errors.length;
    collectConfig.validateSnapshot(snapshot, label, errors);

    if (errors.length > priorErrorCount) {
      return;
    }

    entries.push(collectConfig.buildEntry(snapshot));
  });

  return entries;
}

export function buildPayloadFromSnapshot({
  snapshot,
  filingStatus,
  taxYear,
  maxCounts,
  ssnPattern,
  einPattern,
  parseMoney,
}) {
  const errors = [];
  const primary = snapshot?.primaryFiler || {};
  const spouse = filingStatus === "married_filing_jointly" ? snapshot?.spouse || {} : null;
  const dependents = collectDependentEntries(
    snapshot?.dependents,
    errors,
    ssnPattern,
    { requireAtLeastOne: filingStatus === "head_of_household" }
  );
  validateUniqueSsnEntries(errors, filingStatus, primary, spouse, dependents, ssnPattern);
  const adjustments = collectAdjustmentPayload(snapshot, errors, parseMoney);
  const estimatedTaxPayments = collectEstimatedTaxPayments(snapshot, errors, parseMoney);

  const interestIncome = collectIncomeCards(
    snapshot?.interestIncome,
    {
      titleLabel: "1099-INT",
      readSnapshot: (item) => ({
        payerName: typeof item?.payerName === "string" ? item.payerName.trim() : "",
        recipient: item?.recipient || "primary",
        rawTaxable: typeof item?.taxableInterest === "string" ? item.taxableInterest.trim() : "",
        rawTaxExempt: typeof item?.taxExemptInterest === "string" ? item.taxExemptInterest.trim() : "",
      }),
      isBlank: (item) =>
        item.payerName === "" && item.rawTaxable === "" && item.rawTaxExempt === "",
      validateSnapshot: (item, label, itemErrors) => {
        item.taxableInterest = parseMoney(item.rawTaxable, 0);
        item.taxExemptInterest = parseMoney(item.rawTaxExempt, 0);

        if (!Number.isFinite(item.taxableInterest) || item.taxableInterest < 0) {
          itemErrors.push(`${label}: taxable interest must be 0 or greater.`);
        }
        if (!Number.isFinite(item.taxExemptInterest) || item.taxExemptInterest < 0) {
          itemErrors.push(`${label}: tax-exempt interest must be 0 or greater.`);
        }
        if (
          Number.isFinite(item.taxableInterest) &&
          Number.isFinite(item.taxExemptInterest) &&
          item.taxableInterest === 0 &&
          item.taxExemptInterest === 0
        ) {
          itemErrors.push(`${label}: enter taxable interest, tax-exempt interest, or remove the card.`);
        }
      },
      buildEntry: (item) => ({
        recipient: item.recipient,
        payer_name: item.payerName,
        taxable_interest: item.taxableInterest,
        tax_exempt_interest: item.taxExemptInterest,
      }),
    },
    errors
  );

  const socialSecurityIncome = collectIncomeCards(
    snapshot?.socialSecurityIncome,
    {
      titleLabel: "SSA-1099",
      readSnapshot: (item) => ({
        recipient: item?.recipient || "primary",
        rawBenefits: typeof item?.totalBenefits === "string" ? item.totalBenefits.trim() : "",
        rawWithholding:
          typeof item?.voluntaryWithholding === "string" ? item.voluntaryWithholding.trim() : "",
      }),
      isBlank: (item) => item.rawBenefits === "" && item.rawWithholding === "",
      validateSnapshot: (item, label, itemErrors) => {
        item.totalBenefits = parseMoney(item.rawBenefits);
        item.voluntaryWithholding = parseMoney(item.rawWithholding, 0);

        if (!Number.isFinite(item.totalBenefits) || item.totalBenefits <= 0) {
          itemErrors.push(`${label}: total benefits must be greater than 0.`);
        }
        if (!Number.isFinite(item.voluntaryWithholding) || item.voluntaryWithholding < 0) {
          itemErrors.push(`${label}: voluntary federal tax withheld must be 0 or greater.`);
        }
        if (
          Number.isFinite(item.totalBenefits) &&
          Number.isFinite(item.voluntaryWithholding) &&
          item.voluntaryWithholding > item.totalBenefits
        ) {
          itemErrors.push(`${label}: voluntary withholding cannot exceed total benefits.`);
        }
      },
      buildEntry: (item) => ({
        recipient: item.recipient,
        total_benefits: item.totalBenefits,
        voluntary_withholding: item.voluntaryWithholding,
      }),
    },
    errors
  );

  const dividendIncome = collectIncomeCards(
    snapshot?.dividendIncome,
    {
      titleLabel: "1099-DIV",
      readSnapshot: (item) => ({
        payerName: typeof item?.payerName === "string" ? item.payerName.trim() : "",
        recipient: item?.recipient || "primary",
        rawOrdinary:
          typeof item?.ordinaryDividends === "string" ? item.ordinaryDividends.trim() : "",
        rawQualified:
          typeof item?.qualifiedDividends === "string" ? item.qualifiedDividends.trim() : "",
      }),
      isBlank: (item) =>
        item.payerName === "" && item.rawOrdinary === "" && item.rawQualified === "",
      validateSnapshot: (item, label, itemErrors) => {
        item.ordinaryDividends = parseMoney(item.rawOrdinary, 0);
        item.qualifiedDividends = parseMoney(item.rawQualified, 0);

        if (!Number.isFinite(item.ordinaryDividends) || item.ordinaryDividends < 0) {
          itemErrors.push(`${label}: ordinary dividends must be 0 or greater.`);
        }
        if (!Number.isFinite(item.qualifiedDividends) || item.qualifiedDividends < 0) {
          itemErrors.push(`${label}: qualified dividends must be 0 or greater.`);
        }
        if (
          Number.isFinite(item.ordinaryDividends) &&
          Number.isFinite(item.qualifiedDividends) &&
          item.ordinaryDividends === 0 &&
          item.qualifiedDividends === 0
        ) {
          itemErrors.push(`${label}: enter ordinary dividends, qualified dividends, or remove the card.`);
        }
        if (
          Number.isFinite(item.ordinaryDividends) &&
          Number.isFinite(item.qualifiedDividends) &&
          item.qualifiedDividends > item.ordinaryDividends
        ) {
          itemErrors.push(`${label}: qualified dividends cannot exceed ordinary dividends.`);
        }
      },
      buildEntry: (item) => ({
        recipient: item.recipient,
        payer_name: item.payerName,
        ordinary_dividends: item.ordinaryDividends,
        qualified_dividends: item.qualifiedDividends,
      }),
    },
    errors
  );

  const w2Income = collectIncomeCards(
    snapshot?.w2s,
    {
      titleLabel: "W-2",
      readSnapshot: (item) => ({
        recipient: item?.recipient || "primary",
        employerName: typeof item?.employerName === "string" ? item.employerName.trim() : "",
        employerEin: typeof item?.employerEin === "string" ? item.employerEin.trim() : "",
        rawWages: typeof item?.wages === "string" ? item.wages.trim() : "",
        rawFedWh:
          typeof item?.federalTaxWithheld === "string" ? item.federalTaxWithheld.trim() : "",
        rawStateWh:
          typeof item?.stateTaxWithheld === "string" ? item.stateTaxWithheld.trim() : "",
        rawSsWages:
          typeof item?.socialSecurityWages === "string" ? item.socialSecurityWages.trim() : "",
        rawSsWh:
          typeof item?.socialSecurityTaxWithheld === "string"
            ? item.socialSecurityTaxWithheld.trim()
            : "",
        rawMedWages:
          typeof item?.medicareWages === "string" ? item.medicareWages.trim() : "",
        rawMedWh:
          typeof item?.medicareTaxWithheld === "string" ? item.medicareTaxWithheld.trim() : "",
      }),
      isBlank: (item) =>
        item.employerName === "" &&
        item.employerEin === "" &&
        item.rawWages === "" &&
        item.rawFedWh === "" &&
        item.rawStateWh === "" &&
        item.rawSsWages === "" &&
        item.rawSsWh === "" &&
        item.rawMedWages === "" &&
        item.rawMedWh === "",
      validateSnapshot: (item, label, itemErrors) => {
        if (!item.employerName) {
          itemErrors.push(`${label}: employer name is required.`);
        }

        if (!item.employerEin) {
          itemErrors.push(`${label}: employer EIN is required.`);
        } else if (!einPattern.test(item.employerEin)) {
          itemErrors.push(`${label}: employer EIN must use the format 12-3456789.`);
        }

        item.wages = parseMoney(item.rawWages);
        item.federalTaxWithheld = parseMoney(item.rawFedWh, 0);
        item.stateTaxWithheld = parseMoney(item.rawStateWh, 0);
        item.socialSecurityWages =
          item.rawSsWages === "" ? item.wages : parseMoney(item.rawSsWages);
        item.socialSecurityTaxWithheld = parseMoney(item.rawSsWh, 0);
        item.medicareWages =
          item.rawMedWages === "" ? item.wages : parseMoney(item.rawMedWages);
        item.medicareTaxWithheld = parseMoney(item.rawMedWh, 0);

        if (!Number.isFinite(item.wages) || item.wages <= 0) {
          itemErrors.push(`${label}: wages must be greater than 0.`);
        }

        [
          ["federal withholding", item.federalTaxWithheld],
          ["state withholding", item.stateTaxWithheld],
          ["Social Security wages", item.socialSecurityWages],
          ["Social Security withholding", item.socialSecurityTaxWithheld],
          ["Medicare wages", item.medicareWages],
          ["Medicare withholding", item.medicareTaxWithheld],
        ].forEach(([fieldLabel, value]) => {
          if (!Number.isFinite(value) || value < 0) {
            itemErrors.push(`${label}: ${fieldLabel} must be 0 or greater.`);
          }
        });

        if (
          Number.isFinite(item.federalTaxWithheld) &&
          Number.isFinite(item.wages) &&
          item.federalTaxWithheld > item.wages
        ) {
          itemErrors.push(`${label}: federal withholding cannot exceed wages.`);
        }

        if (
          Number.isFinite(item.socialSecurityTaxWithheld) &&
          Number.isFinite(item.socialSecurityWages) &&
          item.socialSecurityTaxWithheld > item.socialSecurityWages
        ) {
          itemErrors.push(
            `${label}: Social Security withholding cannot exceed Social Security wages.`
          );
        }

        if (
          Number.isFinite(item.medicareTaxWithheld) &&
          Number.isFinite(item.medicareWages) &&
          item.medicareTaxWithheld > item.medicareWages
        ) {
          itemErrors.push(`${label}: Medicare withholding cannot exceed Medicare wages.`);
        }
      },
      buildEntry: (item) => ({
        recipient: item.recipient,
        employer_name: item.employerName,
        employer_ein: item.employerEin,
        wages: item.wages,
        federal_tax_withheld: item.federalTaxWithheld,
        state_tax_withheld: item.stateTaxWithheld,
        social_security_wages: item.socialSecurityWages,
        social_security_tax_withheld: item.socialSecurityTaxWithheld,
        medicare_wages: item.medicareWages,
        medicare_tax_withheld: item.medicareTaxWithheld,
      }),
    },
    errors
  );

  enforceCollectionLimit(errors, "W-2 forms", w2Income.length, maxCounts.w2);
  enforceCollectionLimit(errors, "SSA-1099 forms", socialSecurityIncome.length, maxCounts.socialSecurity);
  enforceCollectionLimit(errors, "1099-INT forms", interestIncome.length, maxCounts.interest);
  enforceCollectionLimit(errors, "1099-DIV forms", dividendIncome.length, maxCounts.dividend);
  enforceCollectionLimit(errors, "dependents", dependents.length, maxCounts.dependents);

  if (
    w2Income.length === 0 &&
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
        tax_year: taxYear,
        filing_status: filingStatus,
        primary_filer: filerPayload(primary),
        spouse: spouse ? filerPayload(spouse) : null,
        dependents,
        w2_income: w2Income,
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
