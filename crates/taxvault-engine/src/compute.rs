use rust_decimal::{Decimal, RoundingStrategy};
use taxvault_core::{Dependent, DependentRelationship, FilingStatus, TaxFacts};

use crate::bracket::compute_bracket_tax;
use crate::error::ComputeError;
use crate::rule_pack::RulePack;
use crate::trace::{CalculationTrace, TraceBuilder};

#[derive(Default)]
pub struct ComputeOptions {
    pub allow_unverified_table: bool,
}

#[derive(Debug)]
pub struct ComputedReturn {
    pub tax_year: u16,
    pub filing_status: FilingStatus,
    pub num_dependents: usize,
    pub num_qualifying_children: usize,
    pub num_other_dependents: usize,
    pub age_or_blind_qualifier_count: u32,
    pub total_wages: Decimal,
    pub total_taxable_interest: Decimal,
    pub total_tax_exempt_interest: Decimal,
    pub total_ordinary_dividends: Decimal,
    pub total_qualified_dividends: Decimal,
    pub total_social_security_benefits: Decimal,
    pub taxable_social_security_benefits: Decimal,
    pub total_income: Decimal,
    pub traditional_ira_deduction: Decimal,
    pub hsa_deduction: Decimal,
    pub student_loan_interest_deduction: Decimal,
    pub total_adjustments: Decimal,
    pub adjusted_gross_income: Decimal,
    pub standard_deduction: Decimal,
    pub total_deductions: Decimal,
    pub taxable_income: Decimal,
    pub income_tax: Decimal,
    pub child_dependent_credit: Decimal,
    pub additional_child_tax_credit: Decimal,
    pub total_w2_federal_withholding: Decimal,
    pub total_social_security_withholding: Decimal,
    pub total_tax: Decimal,
    pub total_federal_withholding: Decimal,
    pub total_payments: Decimal,
    pub balance_due: Decimal,
    pub overpayment: Decimal,
    pub trace: CalculationTrace,
    pub rule_pack_version: String,
}

/// Main computation entry point. Caller should have already validated with
/// `validate_supported_slice()`.
pub fn compute(
    facts: &TaxFacts,
    rules: &RulePack,
    options: &ComputeOptions,
) -> Result<ComputedReturn, ComputeError> {
    let mut tb = TraceBuilder::new();

    let total_wages: Decimal = facts.w2_income.iter().map(|w| w.wages).sum();
    let total_taxable_interest: Decimal = facts
        .interest_income
        .iter()
        .map(|interest| interest.taxable_interest)
        .sum();
    let total_tax_exempt_interest: Decimal = facts
        .interest_income
        .iter()
        .map(|interest| interest.tax_exempt_interest)
        .sum();
    let total_ordinary_dividends: Decimal = facts
        .dividend_income
        .iter()
        .map(|dividend| dividend.ordinary_dividends)
        .sum();
    let total_qualified_dividends: Decimal = facts
        .dividend_income
        .iter()
        .map(|dividend| dividend.qualified_dividends)
        .sum();
    let total_social_security_benefits: Decimal = facts
        .social_security_income
        .iter()
        .map(|benefit| benefit.total_benefits)
        .sum();
    let total_social_security_withholding: Decimal = facts
        .social_security_income
        .iter()
        .map(|benefit| benefit.voluntary_withholding)
        .sum();
    let traditional_ira_deduction = facts.adjustments.traditional_ira_deduction;
    let hsa_deduction = facts.adjustments.hsa_deduction;

    let wages_id = tb.add("Total Wages", total_wages, "sum of W-2 box 1", vec![]);
    let taxable_interest_id = tb.add(
        "Taxable Interest",
        total_taxable_interest,
        "sum of 1099-INT taxable interest",
        vec![],
    );
    let tax_exempt_interest_id = tb.add(
        "Tax-Exempt Interest",
        total_tax_exempt_interest,
        "sum of 1099-INT tax-exempt interest",
        vec![],
    );
    let ordinary_dividends_id = tb.add(
        "Ordinary Dividends",
        total_ordinary_dividends,
        "sum of 1099-DIV ordinary dividends",
        vec![],
    );
    let social_security_benefits_id = tb.add(
        "Social Security Benefits",
        total_social_security_benefits,
        "sum of SSA-1099 box 5",
        vec![],
    );
    let ira_deduction_id = tb.add(
        "Traditional IRA Deduction",
        traditional_ira_deduction,
        "Deductible traditional IRA amount entered by the user",
        vec![],
    );
    let hsa_deduction_id = tb.add(
        "HSA Deduction",
        hsa_deduction,
        "Deductible HSA amount entered by the user",
        vec![],
    );

    let supported_income_before_social_security =
        total_wages + total_taxable_interest + total_ordinary_dividends;
    let social_security_income_base =
        supported_income_before_social_security - traditional_ira_deduction - hsa_deduction;
    let combined_income = social_security_combined_income(
        social_security_income_base,
        total_tax_exempt_interest,
        total_social_security_benefits,
    );
    let combined_income_id = tb.add(
        "Combined Income for Social Security Worksheet",
        combined_income,
        "Supported income before Social Security, minus IRA/HSA deductions, plus tax-exempt interest and half of benefits",
        vec![
            wages_id,
            taxable_interest_id,
            tax_exempt_interest_id,
            ordinary_dividends_id,
            social_security_benefits_id,
            ira_deduction_id,
            hsa_deduction_id,
        ],
    );
    let taxable_social_security_benefits = compute_taxable_social_security_benefits(
        social_security_income_base,
        total_tax_exempt_interest,
        total_social_security_benefits,
        &facts.filing_status,
        rules,
    );
    let taxable_social_security_id = tb.add(
        "Taxable Social Security Benefits",
        taxable_social_security_benefits,
        social_security_taxability_description(
            social_security_income_base,
            total_tax_exempt_interest,
            total_social_security_benefits,
            &facts.filing_status,
            rules,
        ),
        vec![combined_income_id, social_security_benefits_id],
    );

    let total_income = supported_income_before_social_security + taxable_social_security_benefits;
    let total_income_id = tb.add(
        "Total Income",
        total_income,
        "Line 9 = wages + taxable interest + ordinary dividends + taxable Social Security benefits",
        vec![
            wages_id,
            taxable_interest_id,
            ordinary_dividends_id,
            taxable_social_security_id,
        ],
    );

    let student_loan_magi = total_income - traditional_ira_deduction - hsa_deduction;
    let student_loan_magi_id = tb.add(
        "MAGI for Student Loan Interest Phaseout",
        student_loan_magi,
        "AGI before the student loan interest deduction",
        vec![total_income_id, ira_deduction_id, hsa_deduction_id],
    );
    let student_loan_interest_deduction = compute_student_loan_interest_deduction(
        facts.adjustments.student_loan_interest_paid,
        student_loan_magi,
        &facts.filing_status,
        rules,
    );
    let student_loan_interest_id = tb.add(
        "Student Loan Interest Deduction",
        student_loan_interest_deduction,
        student_loan_interest_description(
            facts.adjustments.student_loan_interest_paid,
            student_loan_magi,
            &facts.filing_status,
            rules,
        ),
        vec![student_loan_magi_id],
    );
    let total_adjustments =
        traditional_ira_deduction + hsa_deduction + student_loan_interest_deduction;
    let total_adjustments_id = tb.add(
        "Total Adjustments",
        total_adjustments,
        "Line 10 = IRA deduction + HSA deduction + deductible student loan interest",
        vec![ira_deduction_id, hsa_deduction_id, student_loan_interest_id],
    );

    let agi = total_income - total_adjustments;
    let agi_id = tb.add(
        "AGI",
        agi,
        "Line 11 = Line 9 minus adjustments",
        vec![total_income_id, total_adjustments_id],
    );

    // Standard deduction (base + age 65+ / blind adjustments)
    let base_ded = rules
        .standard_deduction
        .base_for_status(&facts.filing_status);
    let additional_per = rules
        .standard_deduction
        .additional_per_qualifier(&facts.filing_status);

    let mut additional_count: u32 = 0;
    // Primary filer: 65+?
    if facts
        .primary_filer
        .date_of_birth
        .is_before(&rules.age_threshold)
    {
        additional_count += 1;
    }
    // Primary filer: blind?
    if facts.primary_filer.is_blind {
        additional_count += 1;
    }
    // Spouse (MFJ only)
    if let Some(spouse) = &facts.spouse {
        if spouse.date_of_birth.is_before(&rules.age_threshold) {
            additional_count += 1;
        }
        if spouse.is_blind {
            additional_count += 1;
        }
    }

    let additional_ded = additional_per * Decimal::from(additional_count);
    let std_ded = base_ded + additional_ded;

    let std_ded_id = if additional_count > 0 {
        let base_id = tb.add(
            "Base Standard Deduction",
            base_ded,
            format!("base for {:?}", facts.filing_status),
            vec![],
        );
        let adj_id = tb.add(
            "Age/Blind Adjustment",
            additional_ded,
            format!("{additional_count} qualifier(s) x {additional_per}"),
            vec![],
        );
        tb.add(
            "Standard Deduction",
            std_ded,
            "base + age/blind adjustments",
            vec![base_id, adj_id],
        )
    } else {
        tb.add(
            "Standard Deduction",
            std_ded,
            format!("standard deduction for {:?}", facts.filing_status),
            vec![],
        )
    };

    let total_deductions = std_ded;
    let ded_id = tb.add(
        "Total Deductions",
        total_deductions,
        "Line 14 = Line 12e (no QBI, no Sched 1-A)",
        vec![std_ded_id],
    );

    let taxable_income = (agi - total_deductions).max(Decimal::ZERO);
    let ti_id = tb.add(
        "Taxable Income",
        taxable_income,
        "Line 15 = max(0, AGI - deductions)",
        vec![agi_id, ded_id],
    );

    let income_tax = compute_line_16_tax(
        taxable_income,
        total_qualified_dividends,
        &facts.filing_status,
        rules,
        options,
    )?;
    let tax_id = tb.add(
        "Income Tax (Line 16)",
        income_tax,
        if total_qualified_dividends > Decimal::ZERO {
            "Qualified Dividends and Capital Gain Tax Worksheet"
        } else if taxable_income < Decimal::from(100_000) {
            "Tax Table lookup"
        } else {
            "Tax Computation Worksheet"
        },
        vec![ti_id],
    );

    let child_credit = compute_child_tax_credit(facts, total_wages, agi, income_tax, rules);
    let child_credit_id = tb.add(
        "Child/Dependent Credit (Line 19)",
        child_credit.nonrefundable_credit,
        format!(
            "{} qualifying child(ren), {} other dependent(s)",
            child_credit.qualifying_children, child_credit.other_dependents
        ),
        vec![tax_id],
    );

    let total_tax = (income_tax - child_credit.nonrefundable_credit).max(Decimal::ZERO);
    let total_tax_id = tb.add(
        "Total Tax (Line 24)",
        total_tax,
        "Line 24 = Line 22 (after child/dependent credit, no Schedule 2)",
        vec![tax_id, child_credit_id],
    );

    let total_w2_federal_withholding: Decimal =
        facts.w2_income.iter().map(|w| w.federal_tax_withheld).sum();
    let w2_withholding_id = tb.add(
        "W-2 Federal Withholding",
        total_w2_federal_withholding,
        "sum of W-2 box 2",
        vec![],
    );
    let social_security_withholding_id = tb.add(
        "SSA-1099 Voluntary Withholding",
        total_social_security_withholding,
        "sum of SSA-1099 box 6",
        vec![],
    );
    let total_federal_withholding =
        total_w2_federal_withholding + total_social_security_withholding;
    let withholding_id = tb.add(
        "Federal Withholding",
        total_federal_withholding,
        "sum of W-2 box 2 and SSA-1099 box 6",
        vec![w2_withholding_id, social_security_withholding_id],
    );

    let actc_id = tb.add(
        "Additional Child Tax Credit (Line 28)",
        child_credit.additional_child_tax_credit,
        "Schedule 8812 refundable credit",
        vec![child_credit_id],
    );

    let total_payments = total_federal_withholding + child_credit.additional_child_tax_credit;
    let payments_id = tb.add(
        "Total Payments (Line 33)",
        total_payments,
        "Line 33 = withholding + refundable child tax credit",
        vec![withholding_id, actc_id],
    );

    let (balance_due, overpayment) = if total_tax > total_payments {
        (total_tax - total_payments, Decimal::ZERO)
    } else {
        (Decimal::ZERO, total_payments - total_tax)
    };

    let root_id = tb.add(
        "Result",
        if overpayment > Decimal::ZERO {
            overpayment
        } else {
            balance_due
        },
        if overpayment > Decimal::ZERO {
            "Overpayment (refund)"
        } else if balance_due > Decimal::ZERO {
            "Balance due"
        } else {
            "Perfectly settled"
        },
        vec![total_tax_id, payments_id],
    );

    let trace = tb.build(root_id);

    Ok(ComputedReturn {
        tax_year: facts.tax_year,
        filing_status: facts.filing_status,
        num_dependents: facts.dependents.len(),
        num_qualifying_children: child_credit.qualifying_children,
        num_other_dependents: child_credit.other_dependents,
        age_or_blind_qualifier_count: additional_count,
        total_wages,
        total_taxable_interest,
        total_tax_exempt_interest,
        total_ordinary_dividends,
        total_qualified_dividends,
        total_social_security_benefits,
        taxable_social_security_benefits,
        total_income,
        traditional_ira_deduction,
        hsa_deduction,
        student_loan_interest_deduction,
        total_adjustments,
        adjusted_gross_income: agi,
        standard_deduction: std_ded,
        total_deductions,
        taxable_income,
        income_tax,
        child_dependent_credit: child_credit.nonrefundable_credit,
        additional_child_tax_credit: child_credit.additional_child_tax_credit,
        total_w2_federal_withholding,
        total_social_security_withholding,
        total_tax,
        total_federal_withholding,
        total_payments,
        balance_due,
        overpayment,
        trace,
        rule_pack_version: rules.meta.version.clone(),
    })
}

#[derive(Debug)]
struct ChildTaxCreditBreakdown {
    qualifying_children: usize,
    other_dependents: usize,
    nonrefundable_credit: Decimal,
    additional_child_tax_credit: Decimal,
}

fn compute_line_16_tax(
    taxable_income: Decimal,
    qualified_dividends: Decimal,
    filing_status: &FilingStatus,
    rules: &RulePack,
    options: &ComputeOptions,
) -> Result<Decimal, ComputeError> {
    if taxable_income == Decimal::ZERO {
        return Ok(Decimal::ZERO);
    }

    if qualified_dividends > Decimal::ZERO {
        return compute_qualified_dividend_tax(
            taxable_income,
            qualified_dividends,
            filing_status,
            rules,
            options,
        );
    }

    compute_ordinary_income_tax(taxable_income, filing_status, rules, options)
}

fn compute_ordinary_income_tax(
    taxable_income: Decimal,
    filing_status: &FilingStatus,
    rules: &RulePack,
    options: &ComputeOptions,
) -> Result<Decimal, ComputeError> {
    if taxable_income < Decimal::from(100_000) {
        if !rules
            .meta
            .table_verification_status
            .allows_estimate_compute()
            && !options.allow_unverified_table
        {
            return Err(ComputeError::UnverifiedTaxTable);
        }
        rules
            .tax_table
            .lookup(taxable_income, filing_status)
            .ok_or(ComputeError::TaxTableLookupFailed { taxable_income })
    } else {
        compute_bracket_tax(taxable_income, filing_status, &rules.tax_brackets)
    }
}

fn compute_student_loan_interest_deduction(
    interest_paid: Decimal,
    modified_adjusted_gross_income: Decimal,
    filing_status: &FilingStatus,
    rules: &RulePack,
) -> Decimal {
    if interest_paid <= Decimal::ZERO {
        return Decimal::ZERO;
    }

    let deduction = interest_paid.min(rules.student_loan_interest.max_deduction);
    let (phaseout_start, phaseout_end) = rules.student_loan_interest.phaseout_range(filing_status);

    if modified_adjusted_gross_income <= phaseout_start {
        deduction
    } else if modified_adjusted_gross_income >= phaseout_end {
        Decimal::ZERO
    } else {
        let remaining_phaseout = phaseout_end - modified_adjusted_gross_income;
        let phaseout_span = phaseout_end - phaseout_start;
        (deduction * remaining_phaseout / phaseout_span).round_dp(2)
    }
}

fn student_loan_interest_description(
    interest_paid: Decimal,
    modified_adjusted_gross_income: Decimal,
    filing_status: &FilingStatus,
    rules: &RulePack,
) -> String {
    let (phaseout_start, phaseout_end) = rules.student_loan_interest.phaseout_range(filing_status);

    if interest_paid <= Decimal::ZERO {
        "No student loan interest entered".into()
    } else if modified_adjusted_gross_income <= phaseout_start {
        format!(
            "Full deduction allowed because MAGI {modified_adjusted_gross_income} is at or below the phaseout start {phaseout_start}"
        )
    } else if modified_adjusted_gross_income >= phaseout_end {
        format!(
            "No deduction allowed because MAGI {modified_adjusted_gross_income} is at or above the phaseout end {phaseout_end}"
        )
    } else {
        format!(
            "Deduction reduced because MAGI {modified_adjusted_gross_income} falls inside the phaseout range {phaseout_start}-{phaseout_end}"
        )
    }
}

fn compute_qualified_dividend_tax(
    taxable_income: Decimal,
    qualified_dividends: Decimal,
    filing_status: &FilingStatus,
    rules: &RulePack,
    options: &ComputeOptions,
) -> Result<Decimal, ComputeError> {
    let zero_rate_threshold = rules.qualified_dividends.zero_rate_threshold(filing_status);
    let fifteen_rate_threshold = rules
        .qualified_dividends
        .fifteen_rate_threshold(filing_status);

    let line4 = qualified_dividends.min(taxable_income);
    let line5 = (taxable_income - line4).max(Decimal::ZERO);
    let line7 = taxable_income.min(zero_rate_threshold);
    let line8 = line5.min(line7);
    let line9 = line7 - line8;
    let line10 = taxable_income.min(line4);
    let line12 = (line10 - line9).max(Decimal::ZERO);
    let line14 = taxable_income.min(fifteen_rate_threshold);
    let line15 = line5 + line9;
    let line16 = (line14 - line15).max(Decimal::ZERO);
    let line17 = line12.min(line16);
    let line18 = line17 * Decimal::new(15, 2);
    let line20 = (line10 - (line9 + line17)).max(Decimal::ZERO);
    let line21 = line20 * Decimal::new(20, 2);
    let line22 = compute_ordinary_income_tax(line5, filing_status, rules, options)?;
    let line23 = line18 + line21 + line22;
    let line24 = compute_ordinary_income_tax(taxable_income, filing_status, rules, options)?;

    Ok(line23.min(line24))
}

fn social_security_combined_income(
    supported_income_before_social_security: Decimal,
    tax_exempt_interest: Decimal,
    total_benefits: Decimal,
) -> Decimal {
    supported_income_before_social_security
        + tax_exempt_interest
        + (total_benefits * Decimal::new(5, 1))
}

fn compute_taxable_social_security_benefits(
    supported_income_before_social_security: Decimal,
    tax_exempt_interest: Decimal,
    total_benefits: Decimal,
    filing_status: &FilingStatus,
    rules: &RulePack,
) -> Decimal {
    if total_benefits <= Decimal::ZERO {
        return Decimal::ZERO;
    }

    let lower_threshold = rules.social_security.benefits_50_threshold(filing_status);
    let upper_threshold = rules.social_security.benefits_85_threshold(filing_status);
    let combined_income = social_security_combined_income(
        supported_income_before_social_security,
        tax_exempt_interest,
        total_benefits,
    );
    let half_benefits = total_benefits * Decimal::new(5, 1);
    let max_taxable = total_benefits * Decimal::new(85, 2);

    if combined_income <= lower_threshold {
        Decimal::ZERO
    } else if combined_income <= upper_threshold {
        ((combined_income - lower_threshold) * Decimal::new(5, 1)).min(half_benefits)
    } else {
        let lower_band_cap =
            ((upper_threshold - lower_threshold) * Decimal::new(5, 1)).min(half_benefits);
        (((combined_income - upper_threshold) * Decimal::new(85, 2)) + lower_band_cap)
            .min(max_taxable)
    }
}

fn social_security_taxability_description(
    supported_income_before_social_security: Decimal,
    tax_exempt_interest: Decimal,
    total_benefits: Decimal,
    filing_status: &FilingStatus,
    rules: &RulePack,
) -> String {
    let combined_income = social_security_combined_income(
        supported_income_before_social_security,
        tax_exempt_interest,
        total_benefits,
    );
    let lower_threshold = rules.social_security.benefits_50_threshold(filing_status);
    let upper_threshold = rules.social_security.benefits_85_threshold(filing_status);

    if combined_income <= lower_threshold {
        format!(
            "Combined income {combined_income} is at or below the 0% Social Security threshold {lower_threshold}"
        )
    } else if combined_income <= upper_threshold {
        format!(
            "Combined income {combined_income} is between the 50% threshold {lower_threshold} and 85% threshold {upper_threshold}"
        )
    } else {
        format!(
            "Combined income {combined_income} exceeds the 85% Social Security threshold {upper_threshold}"
        )
    }
}

fn compute_child_tax_credit(
    facts: &TaxFacts,
    total_wages: Decimal,
    adjusted_gross_income: Decimal,
    income_tax: Decimal,
    rules: &RulePack,
) -> ChildTaxCreditBreakdown {
    let qualifying_children = facts
        .dependents
        .iter()
        .filter(|dep| is_qualifying_child(dep, facts.tax_year))
        .count();
    let other_dependents = facts.dependents.len().saturating_sub(qualifying_children);

    let child_credit =
        Decimal::from(qualifying_children as u32) * rules.child_tax_credit.qualifying_child_credit;
    let other_credit =
        Decimal::from(other_dependents as u32) * rules.child_tax_credit.other_dependent_credit;
    let mut total_credit = child_credit + other_credit;

    let phaseout_threshold = rules
        .child_tax_credit
        .phaseout_threshold(&facts.filing_status);
    if adjusted_gross_income > phaseout_threshold {
        let excess_agi = adjusted_gross_income - phaseout_threshold;
        let rounded_excess = (excess_agi / rules.child_tax_credit.phaseout_increment)
            .round_dp_with_strategy(0, RoundingStrategy::ToPositiveInfinity)
            * rules.child_tax_credit.phaseout_increment;
        let phaseout = rounded_excess * rules.child_tax_credit.phaseout_rate;
        total_credit = (total_credit - phaseout).max(Decimal::ZERO);
    }

    let nonrefundable_credit = total_credit.min(income_tax);
    let line16a = (total_credit - nonrefundable_credit).max(Decimal::ZERO);
    let line16b = Decimal::from(qualifying_children as u32)
        * rules.child_tax_credit.refundable_credit_per_child;
    let line17 = line16a.min(line16b);
    let additional_child_tax_credit = if line17 == Decimal::ZERO || qualifying_children == 0 {
        Decimal::ZERO
    } else {
        let line20 = ((total_wages - rules.child_tax_credit.refundable_earned_income_threshold)
            .max(Decimal::ZERO))
            * Decimal::new(15, 2);

        if line16b < rules.child_tax_credit.refundable_withholding_floor {
            line17.min(line20)
        } else if line20 >= line17 {
            line17
        } else {
            let line21: Decimal = facts
                .w2_income
                .iter()
                .map(|w2| w2.social_security_tax_withheld + w2.medicare_tax_withheld)
                .sum();
            let line26 = line20.max(line21);
            line17.min(line26)
        }
    };

    ChildTaxCreditBreakdown {
        qualifying_children,
        other_dependents,
        nonrefundable_credit,
        additional_child_tax_credit,
    }
}

fn is_qualifying_child(dependent: &Dependent, tax_year: u16) -> bool {
    matches!(
        dependent.relationship,
        DependentRelationship::Son
            | DependentRelationship::Daughter
            | DependentRelationship::Stepchild
            | DependentRelationship::FosterChild
            | DependentRelationship::Sibling
            | DependentRelationship::StepSibling
            | DependentRelationship::HalfSibling
            | DependentRelationship::Grandchild
            | DependentRelationship::Niece
            | DependentRelationship::Nephew
    ) && dependent.months_lived_in_home > 6
        && (
            dependent.date_of_birth.year(),
            dependent.date_of_birth.month(),
            dependent.date_of_birth.day(),
        ) > (tax_year.saturating_sub(17), 12, 31)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn unverified_table_refused() {
        use crate::rule_pack::*;
        use crate::tax_table::{TaxTable, TaxTableRow};
        use taxvault_core::*;

        let rules = RulePack {
            meta: RulePackMeta {
                tax_year: 2025,
                jurisdiction: "federal".into(),
                version: "1.0.0".into(),
                effective_date: "2025-01-01".into(),
                table_verification_status: TaxTableVerificationStatus::Unverified,
            },
            standard_deduction: StandardDeductionRules {
                single: Decimal::from(15750),
                married_filing_jointly: Decimal::from(31500),
                head_of_household: Decimal::from(23625),
                additional_age_or_blind_single: Decimal::from(2000),
                additional_age_or_blind_married: Decimal::from(1600),
            },
            student_loan_interest: StudentLoanInterestRules {
                max_deduction: Decimal::from(2500),
                phaseout_start_single: Decimal::from(85000),
                phaseout_end_single: Decimal::from(100000),
                phaseout_start_married_filing_jointly: Decimal::from(170000),
                phaseout_end_married_filing_jointly: Decimal::from(200000),
                phaseout_start_head_of_household: Decimal::from(85000),
                phaseout_end_head_of_household: Decimal::from(100000),
            },
            qualified_dividends: QualifiedDividendRules {
                zero_rate_threshold_single: Decimal::from(48350),
                zero_rate_threshold_married_filing_jointly: Decimal::from(96700),
                zero_rate_threshold_head_of_household: Decimal::from(64750),
                fifteen_rate_threshold_single: Decimal::from(533400),
                fifteen_rate_threshold_married_filing_jointly: Decimal::from(600050),
                fifteen_rate_threshold_head_of_household: Decimal::from(566700),
            },
            child_tax_credit: ChildTaxCreditRules {
                qualifying_child_credit: Decimal::from(2200),
                other_dependent_credit: Decimal::from(500),
                refundable_credit_per_child: Decimal::from(1700),
                phaseout_threshold_married_filing_jointly: Decimal::from(400000),
                phaseout_threshold_other: Decimal::from(200000),
                phaseout_increment: Decimal::from(1000),
                phaseout_rate: Decimal::new(5, 2),
                refundable_earned_income_threshold: Decimal::from(2500),
                refundable_withholding_floor: Decimal::from(5100),
            },
            tax_brackets: TaxBrackets {
                single: vec![],
                married_filing_jointly: vec![],
                head_of_household: vec![],
            },
            tax_table: TaxTable {
                rows: vec![TaxTableRow {
                    income_at_least: Decimal::from(44250),
                    income_less_than: Decimal::from(44300),
                    tax_single: Decimal::from(5075),
                    tax_mfj: Decimal::from(4810),
                    tax_hoh: Decimal::from(4943),
                }],
            },
            social_security: SocialSecurityRules {
                wage_base: Decimal::from(176100),
                tax_rate: Decimal::new(62, 3),
                benefits_50_threshold_single: Decimal::from(25000),
                benefits_50_threshold_married_filing_jointly: Decimal::from(32000),
                benefits_85_threshold_single: Decimal::from(34000),
                benefits_85_threshold_married_filing_jointly: Decimal::from(44000),
            },
            medicare: MedicareRules {
                tax_rate: Decimal::new(145, 4),
                additional_rate: Decimal::new(9, 3),
                additional_threshold_single: Decimal::from(200000),
                additional_threshold_mfj: Decimal::from(250000),
                employer_withholding_threshold: Decimal::from(200000),
            },
            age_threshold: DateYmd::new(1961, 1, 2).unwrap(),
            test_vectors: vec![],
        };

        let facts = TaxFacts {
            tax_year: 2025,
            filing_status: FilingStatus::Single,
            primary_filer: FilerInfo {
                first_name: "Test".into(),
                last_name: "Filer".into(),
                ssn: Ssn::parse("400-01-0001").unwrap(),
                date_of_birth: DateYmd::new(1990, 6, 15).unwrap(),
                is_blind: false,
                is_dependent: false,
            },
            spouse: None,
            dependents: vec![],
            w2_income: vec![W2Income {
                recipient: FilerRole::Primary,
                employer_name: "Test Corp".into(),
                employer_ein: "12-3456789".into(),
                wages: Decimal::from(60000),
                federal_tax_withheld: Decimal::from(8000),
                state_tax_withheld: Decimal::from(3000),
                social_security_wages: Decimal::from(60000),
                social_security_tax_withheld: Decimal::from(3720),
                medicare_wages: Decimal::from(60000),
                medicare_tax_withheld: Decimal::from(870),
            }],
            interest_income: vec![],
            dividend_income: vec![],
            social_security_income: vec![],
            adjustments: IncomeAdjustments::default(),
        };

        // Without override -> refused
        let opts = ComputeOptions {
            allow_unverified_table: false,
        };
        let result = compute(&facts, &rules, &opts);
        assert!(matches!(result, Err(ComputeError::UnverifiedTaxTable)));

        // With override -> succeeds
        let opts = ComputeOptions {
            allow_unverified_table: true,
        };
        let result = compute(&facts, &rules, &opts);
        assert!(result.is_ok());
        let ret = result.unwrap();
        assert_eq!(ret.income_tax, Decimal::from(5075));
    }

    #[test]
    fn social_security_taxability_uses_lower_threshold_band() {
        use crate::rule_pack::SocialSecurityRules;

        let rules = SocialSecurityRules {
            wage_base: Decimal::from(176100),
            tax_rate: Decimal::new(62, 3),
            benefits_50_threshold_single: Decimal::from(25000),
            benefits_50_threshold_married_filing_jointly: Decimal::from(32000),
            benefits_85_threshold_single: Decimal::from(34000),
            benefits_85_threshold_married_filing_jointly: Decimal::from(44000),
        };

        let taxable = compute_taxable_social_security_benefits(
            Decimal::from(29000),
            Decimal::ZERO,
            Decimal::from(8000),
            &FilingStatus::Single,
            &RulePack {
                meta: crate::rule_pack::RulePackMeta {
                    tax_year: 2025,
                    jurisdiction: "federal".into(),
                    version: "1.0.0".into(),
                    effective_date: "2025-01-01".into(),
                    table_verification_status:
                        crate::rule_pack::TaxTableVerificationStatus::HumanVerified,
                },
                standard_deduction: crate::rule_pack::StandardDeductionRules {
                    single: Decimal::ZERO,
                    married_filing_jointly: Decimal::ZERO,
                    head_of_household: Decimal::ZERO,
                    additional_age_or_blind_single: Decimal::ZERO,
                    additional_age_or_blind_married: Decimal::ZERO,
                },
                student_loan_interest: crate::rule_pack::StudentLoanInterestRules {
                    max_deduction: Decimal::from(2500),
                    phaseout_start_single: Decimal::from(85000),
                    phaseout_end_single: Decimal::from(100000),
                    phaseout_start_married_filing_jointly: Decimal::from(170000),
                    phaseout_end_married_filing_jointly: Decimal::from(200000),
                    phaseout_start_head_of_household: Decimal::from(85000),
                    phaseout_end_head_of_household: Decimal::from(100000),
                },
                qualified_dividends: crate::rule_pack::QualifiedDividendRules {
                    zero_rate_threshold_single: Decimal::ZERO,
                    zero_rate_threshold_married_filing_jointly: Decimal::ZERO,
                    zero_rate_threshold_head_of_household: Decimal::ZERO,
                    fifteen_rate_threshold_single: Decimal::ZERO,
                    fifteen_rate_threshold_married_filing_jointly: Decimal::ZERO,
                    fifteen_rate_threshold_head_of_household: Decimal::ZERO,
                },
                child_tax_credit: crate::rule_pack::ChildTaxCreditRules {
                    qualifying_child_credit: Decimal::ZERO,
                    other_dependent_credit: Decimal::ZERO,
                    refundable_credit_per_child: Decimal::ZERO,
                    phaseout_threshold_married_filing_jointly: Decimal::ZERO,
                    phaseout_threshold_other: Decimal::ZERO,
                    phaseout_increment: Decimal::ONE,
                    phaseout_rate: Decimal::ZERO,
                    refundable_earned_income_threshold: Decimal::ZERO,
                    refundable_withholding_floor: Decimal::ZERO,
                },
                tax_brackets: crate::rule_pack::TaxBrackets {
                    single: vec![],
                    married_filing_jointly: vec![],
                    head_of_household: vec![],
                },
                tax_table: crate::tax_table::TaxTable { rows: vec![] },
                social_security: rules,
                medicare: crate::rule_pack::MedicareRules {
                    tax_rate: Decimal::ZERO,
                    additional_rate: Decimal::ZERO,
                    additional_threshold_single: Decimal::ZERO,
                    additional_threshold_mfj: Decimal::ZERO,
                    employer_withholding_threshold: Decimal::ZERO,
                },
                age_threshold: taxvault_core::DateYmd::new(1961, 1, 2).unwrap(),
                test_vectors: vec![],
            },
        );

        assert_eq!(taxable, Decimal::from(4000));
    }

    #[test]
    fn social_security_taxability_caps_at_eighty_five_percent() {
        use crate::rule_pack::SocialSecurityRules;

        let rules = SocialSecurityRules {
            wage_base: Decimal::from(176100),
            tax_rate: Decimal::new(62, 3),
            benefits_50_threshold_single: Decimal::from(25000),
            benefits_50_threshold_married_filing_jointly: Decimal::from(32000),
            benefits_85_threshold_single: Decimal::from(34000),
            benefits_85_threshold_married_filing_jointly: Decimal::from(44000),
        };

        let taxable = compute_taxable_social_security_benefits(
            Decimal::from(34000),
            Decimal::ZERO,
            Decimal::from(10000),
            &FilingStatus::Single,
            &RulePack {
                meta: crate::rule_pack::RulePackMeta {
                    tax_year: 2025,
                    jurisdiction: "federal".into(),
                    version: "1.0.0".into(),
                    effective_date: "2025-01-01".into(),
                    table_verification_status:
                        crate::rule_pack::TaxTableVerificationStatus::HumanVerified,
                },
                standard_deduction: crate::rule_pack::StandardDeductionRules {
                    single: Decimal::ZERO,
                    married_filing_jointly: Decimal::ZERO,
                    head_of_household: Decimal::ZERO,
                    additional_age_or_blind_single: Decimal::ZERO,
                    additional_age_or_blind_married: Decimal::ZERO,
                },
                student_loan_interest: crate::rule_pack::StudentLoanInterestRules {
                    max_deduction: Decimal::from(2500),
                    phaseout_start_single: Decimal::from(85000),
                    phaseout_end_single: Decimal::from(100000),
                    phaseout_start_married_filing_jointly: Decimal::from(170000),
                    phaseout_end_married_filing_jointly: Decimal::from(200000),
                    phaseout_start_head_of_household: Decimal::from(85000),
                    phaseout_end_head_of_household: Decimal::from(100000),
                },
                qualified_dividends: crate::rule_pack::QualifiedDividendRules {
                    zero_rate_threshold_single: Decimal::ZERO,
                    zero_rate_threshold_married_filing_jointly: Decimal::ZERO,
                    zero_rate_threshold_head_of_household: Decimal::ZERO,
                    fifteen_rate_threshold_single: Decimal::ZERO,
                    fifteen_rate_threshold_married_filing_jointly: Decimal::ZERO,
                    fifteen_rate_threshold_head_of_household: Decimal::ZERO,
                },
                child_tax_credit: crate::rule_pack::ChildTaxCreditRules {
                    qualifying_child_credit: Decimal::ZERO,
                    other_dependent_credit: Decimal::ZERO,
                    refundable_credit_per_child: Decimal::ZERO,
                    phaseout_threshold_married_filing_jointly: Decimal::ZERO,
                    phaseout_threshold_other: Decimal::ZERO,
                    phaseout_increment: Decimal::ONE,
                    phaseout_rate: Decimal::ZERO,
                    refundable_earned_income_threshold: Decimal::ZERO,
                    refundable_withholding_floor: Decimal::ZERO,
                },
                tax_brackets: crate::rule_pack::TaxBrackets {
                    single: vec![],
                    married_filing_jointly: vec![],
                    head_of_household: vec![],
                },
                tax_table: crate::tax_table::TaxTable { rows: vec![] },
                social_security: rules,
                medicare: crate::rule_pack::MedicareRules {
                    tax_rate: Decimal::ZERO,
                    additional_rate: Decimal::ZERO,
                    additional_threshold_single: Decimal::ZERO,
                    additional_threshold_mfj: Decimal::ZERO,
                    employer_withholding_threshold: Decimal::ZERO,
                },
                age_threshold: taxvault_core::DateYmd::new(1961, 1, 2).unwrap(),
                test_vectors: vec![],
            },
        );

        assert_eq!(taxable, Decimal::from(8500));
    }

    #[test]
    fn student_loan_interest_deduction_phases_out() {
        use crate::rule_pack::StudentLoanInterestRules;

        let rules = RulePack {
            meta: crate::rule_pack::RulePackMeta {
                tax_year: 2025,
                jurisdiction: "federal".into(),
                version: "1.0.0".into(),
                effective_date: "2025-01-01".into(),
                table_verification_status:
                    crate::rule_pack::TaxTableVerificationStatus::HumanVerified,
            },
            standard_deduction: crate::rule_pack::StandardDeductionRules {
                single: Decimal::ZERO,
                married_filing_jointly: Decimal::ZERO,
                head_of_household: Decimal::ZERO,
                additional_age_or_blind_single: Decimal::ZERO,
                additional_age_or_blind_married: Decimal::ZERO,
            },
            student_loan_interest: StudentLoanInterestRules {
                max_deduction: Decimal::from(2500),
                phaseout_start_single: Decimal::from(85000),
                phaseout_end_single: Decimal::from(100000),
                phaseout_start_married_filing_jointly: Decimal::from(170000),
                phaseout_end_married_filing_jointly: Decimal::from(200000),
                phaseout_start_head_of_household: Decimal::from(85000),
                phaseout_end_head_of_household: Decimal::from(100000),
            },
            qualified_dividends: crate::rule_pack::QualifiedDividendRules {
                zero_rate_threshold_single: Decimal::ZERO,
                zero_rate_threshold_married_filing_jointly: Decimal::ZERO,
                zero_rate_threshold_head_of_household: Decimal::ZERO,
                fifteen_rate_threshold_single: Decimal::ZERO,
                fifteen_rate_threshold_married_filing_jointly: Decimal::ZERO,
                fifteen_rate_threshold_head_of_household: Decimal::ZERO,
            },
            child_tax_credit: crate::rule_pack::ChildTaxCreditRules {
                qualifying_child_credit: Decimal::ZERO,
                other_dependent_credit: Decimal::ZERO,
                refundable_credit_per_child: Decimal::ZERO,
                phaseout_threshold_married_filing_jointly: Decimal::ZERO,
                phaseout_threshold_other: Decimal::ZERO,
                phaseout_increment: Decimal::ONE,
                phaseout_rate: Decimal::ZERO,
                refundable_earned_income_threshold: Decimal::ZERO,
                refundable_withholding_floor: Decimal::ZERO,
            },
            tax_brackets: crate::rule_pack::TaxBrackets {
                single: vec![],
                married_filing_jointly: vec![],
                head_of_household: vec![],
            },
            tax_table: crate::tax_table::TaxTable { rows: vec![] },
            social_security: crate::rule_pack::SocialSecurityRules {
                wage_base: Decimal::ZERO,
                tax_rate: Decimal::ZERO,
                benefits_50_threshold_single: Decimal::ZERO,
                benefits_50_threshold_married_filing_jointly: Decimal::ZERO,
                benefits_85_threshold_single: Decimal::ZERO,
                benefits_85_threshold_married_filing_jointly: Decimal::ZERO,
            },
            medicare: crate::rule_pack::MedicareRules {
                tax_rate: Decimal::ZERO,
                additional_rate: Decimal::ZERO,
                additional_threshold_single: Decimal::ZERO,
                additional_threshold_mfj: Decimal::ZERO,
                employer_withholding_threshold: Decimal::ZERO,
            },
            age_threshold: taxvault_core::DateYmd::new(1961, 1, 2).unwrap(),
            test_vectors: vec![],
        };

        let deduction = compute_student_loan_interest_deduction(
            Decimal::from(2500),
            Decimal::from(92500),
            &FilingStatus::Single,
            &rules,
        );

        assert_eq!(deduction, Decimal::from(1250));
    }
}
