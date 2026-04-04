use rust_decimal::Decimal;
use taxvault_core::{FilerRole, FilingStatus, TaxFacts};

use crate::error::PolicyError;
use crate::rule_pack::RulePack;

/// Checks whether the input falls within the currently supported estimate slice.
pub fn validate_supported_slice(
    facts: &TaxFacts,
    rules: &RulePack,
) -> Result<(), Vec<PolicyError>> {
    let mut errors = Vec::new();

    // 1. Tax year mismatch
    if facts.tax_year != rules.meta.tax_year {
        errors.push(PolicyError::TaxYearMismatch {
            input: facts.tax_year,
            expected: rules.meta.tax_year,
        });
    }

    // 2. Filer claimed as dependent (the filer themselves being claimed on another return)
    let primary_dep = facts.primary_filer.is_dependent;
    let spouse_dep = facts.spouse.as_ref().is_some_and(|s| s.is_dependent);
    if primary_dep || spouse_dep {
        errors.push(PolicyError::DependentFilersNotSupported);
    }

    // 3. Excess Social Security withholding
    for role in [FilerRole::Primary, FilerRole::Spouse] {
        let total_ss_withheld: Decimal = facts
            .w2s_for_role(role)
            .map(|w| w.social_security_tax_withheld)
            .sum();
        let max_supported = rules.social_security.wage_base * rules.social_security.tax_rate;

        if total_ss_withheld > max_supported {
            errors.push(PolicyError::ExcessSocialSecurityNotSupported {
                role: format!("{:?}", role),
                total_withheld: total_ss_withheld,
                max_supported,
            });
        }
    }

    // 6. Additional Medicare Tax
    let total_medicare_wages: Decimal = facts.w2_income.iter().map(|w| w.medicare_wages).sum();
    let threshold = rules.medicare.threshold_for_status(&facts.filing_status);

    if total_medicare_wages > threshold {
        errors.push(PolicyError::AdditionalMedicareTaxNotSupported {
            reason: format!(
                "total medicare wages {} exceed {} threshold {}",
                total_medicare_wages,
                match facts.filing_status {
                    FilingStatus::Single => "Single",
                    FilingStatus::MarriedFilingJointly => "MFJ",
                    FilingStatus::HeadOfHousehold => "HOH",
                },
                threshold
            ),
        });
    }

    // Employer withholding threshold: any single W-2 with medicare_wages > $200k
    for w2 in &facts.w2_income {
        if w2.medicare_wages > rules.medicare.employer_withholding_threshold {
            errors.push(PolicyError::AdditionalMedicareTaxNotSupported {
                reason: format!(
                    "W-2 from {} has medicare wages {} exceeding employer withholding threshold {}",
                    w2.employer_name,
                    w2.medicare_wages,
                    rules.medicare.employer_withholding_threshold
                ),
            });
        }
    }

    if errors.is_empty() {
        Ok(())
    } else {
        Err(errors)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::rule_pack::*;
    use crate::tax_table::TaxTable;
    use taxvault_core::*;

    fn test_rules() -> RulePack {
        RulePack {
            meta: RulePackMeta {
                tax_year: 2025,
                jurisdiction: "federal".into(),
                version: "1.0.0".into(),
                effective_date: "2025-01-01".into(),
                table_verified: false,
            },
            standard_deduction: StandardDeductionRules {
                single: Decimal::from(15750),
                married_filing_jointly: Decimal::from(31500),
                head_of_household: Decimal::from(23625),
                additional_age_or_blind_single: Decimal::from(2000),
                additional_age_or_blind_married: Decimal::from(1600),
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
            tax_table: TaxTable { rows: vec![] },
            social_security: SocialSecurityRules {
                wage_base: Decimal::from(176100),
                tax_rate: Decimal::new(62, 3), // 0.062
                benefits_50_threshold_single: Decimal::from(25000),
                benefits_50_threshold_married_filing_jointly: Decimal::from(32000),
                benefits_85_threshold_single: Decimal::from(34000),
                benefits_85_threshold_married_filing_jointly: Decimal::from(44000),
            },
            medicare: MedicareRules {
                tax_rate: Decimal::new(145, 4),      // 0.0145
                additional_rate: Decimal::new(9, 3), // 0.009
                additional_threshold_single: Decimal::from(200000),
                additional_threshold_mfj: Decimal::from(250000),
                employer_withholding_threshold: Decimal::from(200000),
            },
            age_threshold: DateYmd::new(1961, 1, 2).unwrap(),
            test_vectors: vec![],
        }
    }

    fn test_filer(dob_year: u16) -> FilerInfo {
        FilerInfo {
            first_name: "Test".into(),
            last_name: "Filer".into(),
            ssn: Ssn::parse("400-01-0001").unwrap(),
            date_of_birth: DateYmd::new(dob_year, 6, 15).unwrap(),
            is_blind: false,
            is_dependent: false,
        }
    }

    fn test_w2(role: FilerRole, wages: i64) -> W2Income {
        W2Income {
            recipient: role,
            employer_name: "Test Corp".into(),
            employer_ein: "12-3456789".into(),
            wages: Decimal::from(wages),
            federal_tax_withheld: Decimal::from(wages / 5),
            state_tax_withheld: Decimal::from(0),
            social_security_wages: Decimal::from(wages),
            social_security_tax_withheld: Decimal::from(0),
            medicare_wages: Decimal::from(wages),
            medicare_tax_withheld: Decimal::from(0),
        }
    }

    fn facts_with_w2s(
        tax_year: u16,
        filing_status: FilingStatus,
        primary_filer: FilerInfo,
        spouse: Option<FilerInfo>,
        w2_income: Vec<W2Income>,
    ) -> TaxFacts {
        TaxFacts {
            tax_year,
            filing_status,
            primary_filer,
            spouse,
            dependents: vec![],
            w2_income,
            interest_income: vec![],
            dividend_income: vec![],
            social_security_income: vec![],
        }
    }

    #[test]
    fn valid_simple_case() {
        let facts = facts_with_w2s(
            2025,
            FilingStatus::Single,
            test_filer(1990),
            None,
            vec![test_w2(FilerRole::Primary, 60000)],
        );
        assert!(validate_supported_slice(&facts, &test_rules()).is_ok());
    }

    #[test]
    fn tax_year_mismatch() {
        let facts = facts_with_w2s(
            2024,
            FilingStatus::Single,
            test_filer(1990),
            None,
            vec![test_w2(FilerRole::Primary, 60000)],
        );
        let errs = validate_supported_slice(&facts, &test_rules()).unwrap_err();
        assert!(errs
            .iter()
            .any(|e| matches!(e, PolicyError::TaxYearMismatch { .. })));
    }

    #[test]
    fn dependent_filer_rejected() {
        let mut filer = test_filer(1990);
        filer.is_dependent = true;
        let facts = facts_with_w2s(
            2025,
            FilingStatus::Single,
            filer,
            None,
            vec![test_w2(FilerRole::Primary, 60000)],
        );
        let errs = validate_supported_slice(&facts, &test_rules()).unwrap_err();
        assert!(errs
            .iter()
            .any(|e| matches!(e, PolicyError::DependentFilersNotSupported)));
    }

    #[test]
    fn senior_filer_now_accepted() {
        let facts = facts_with_w2s(
            2025,
            FilingStatus::Single,
            test_filer(1960),
            None,
            vec![test_w2(FilerRole::Primary, 60000)],
        );
        assert!(validate_supported_slice(&facts, &test_rules()).is_ok());
    }

    #[test]
    fn blind_filer_now_accepted() {
        let mut filer = test_filer(1990);
        filer.is_blind = true;
        let facts = facts_with_w2s(
            2025,
            FilingStatus::Single,
            filer,
            None,
            vec![test_w2(FilerRole::Primary, 60000)],
        );
        assert!(validate_supported_slice(&facts, &test_rules()).is_ok());
    }

    #[test]
    fn single_w2_over_wage_base_with_capped_ss_withholding_is_supported() {
        let mut w2 = test_w2(FilerRole::Primary, 180000);
        w2.social_security_tax_withheld =
            test_rules().social_security.wage_base * test_rules().social_security.tax_rate;

        let facts = facts_with_w2s(2025, FilingStatus::Single, test_filer(1990), None, vec![w2]);

        assert!(validate_supported_slice(&facts, &test_rules()).is_ok());
    }

    #[test]
    fn multiple_w2s_with_excess_ss_withholding_are_rejected() {
        let mut first = test_w2(FilerRole::Primary, 100000);
        first.social_security_tax_withheld = Decimal::from(6200);

        let mut second = test_w2(FilerRole::Primary, 100000);
        second.employer_name = "Other Corp".into();
        second.social_security_tax_withheld = Decimal::from(6200);

        let facts = facts_with_w2s(
            2025,
            FilingStatus::Single,
            test_filer(1990),
            None,
            vec![first, second],
        );

        let errs = validate_supported_slice(&facts, &test_rules()).unwrap_err();
        assert!(errs
            .iter()
            .any(|e| matches!(e, PolicyError::ExcessSocialSecurityNotSupported { .. })));
    }

    #[test]
    fn additional_medicare_threshold_single() {
        let facts = facts_with_w2s(
            2025,
            FilingStatus::Single,
            test_filer(1990),
            None,
            vec![test_w2(FilerRole::Primary, 176100)],
        );
        // 176100 < 200000, should be OK
        assert!(validate_supported_slice(&facts, &test_rules()).is_ok());
    }

    #[test]
    fn additional_medicare_employer_threshold() {
        // Single W-2 with medicare wages > $200k triggers employer withholding check
        let mut w2 = test_w2(FilerRole::Primary, 176100);
        w2.medicare_wages = Decimal::from(201000);
        w2.social_security_wages = Decimal::from(176100); // Keep under SS cap
        let facts = facts_with_w2s(
            2025,
            FilingStatus::MarriedFilingJointly,
            test_filer(1990),
            Some(test_filer(1990)),
            vec![w2],
        );
        let errs = validate_supported_slice(&facts, &test_rules()).unwrap_err();
        assert!(errs
            .iter()
            .any(|e| matches!(e, PolicyError::AdditionalMedicareTaxNotSupported { .. })));
    }
}
