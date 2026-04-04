use rust_decimal::Decimal;
use std::collections::HashSet;

use crate::error::ValidationError;
use crate::filer::{
    DividendIncome, FilerRole, FilingStatus, InterestIncome, SocialSecurityIncome, W2Income,
};
use crate::tax_facts::TaxFacts;

impl TaxFacts {
    /// Validates structural correctness that does not depend on any specific tax year's rules.
    pub fn validate_structure(&self) -> Result<(), Vec<ValidationError>> {
        let mut errors = Vec::new();

        // Filing status / spouse / dependent consistency
        match self.filing_status {
            FilingStatus::MarriedFilingJointly => {
                if self.spouse.is_none() {
                    errors.push(ValidationError::MfjMissingSpouse);
                }
            }
            FilingStatus::Single => {
                if self.spouse.is_some() {
                    errors.push(ValidationError::SingleHasSpouse);
                }
            }
            FilingStatus::HeadOfHousehold => {
                if self.spouse.is_some() {
                    errors.push(ValidationError::HohHasSpouse);
                }
                if self.dependents.is_empty() {
                    errors.push(ValidationError::HohMissingDependent);
                }
            }
        }

        validate_required_text(
            "primary filer first name",
            &self.primary_filer.first_name,
            &mut errors,
        );
        validate_required_text(
            "primary filer last name",
            &self.primary_filer.last_name,
            &mut errors,
        );

        if let Some(spouse) = &self.spouse {
            validate_required_text("spouse first name", &spouse.first_name, &mut errors);
            validate_required_text("spouse last name", &spouse.last_name, &mut errors);
        }

        // Validate dependents
        for (i, dep) in self.dependents.iter().enumerate() {
            validate_required_text(
                &format!("dependent {} first name", i + 1),
                &dep.first_name,
                &mut errors,
            );
            validate_required_text(
                &format!("dependent {} last name", i + 1),
                &dep.last_name,
                &mut errors,
            );
            if dep.months_lived_in_home > 12 {
                errors.push(ValidationError::InvalidMonthsLived {
                    name: format!("{} {}", dep.first_name, dep.last_name),
                });
            }
        }

        // SSN uniqueness across all filers and dependents
        validate_ssn_uniqueness(self, &mut errors);

        // At least one supported income source
        if self.w2_income.is_empty()
            && self.interest_income.is_empty()
            && self.dividend_income.is_empty()
            && self.social_security_income.is_empty()
        {
            errors.push(ValidationError::NoSupportedIncome);
        }

        // W-2 recipient consistency
        for w2 in &self.w2_income {
            match self.filing_status {
                FilingStatus::Single | FilingStatus::HeadOfHousehold => {
                    if w2.recipient == FilerRole::Spouse {
                        errors.push(ValidationError::SingleFilerSpouseW2);
                    }
                }
                FilingStatus::MarriedFilingJointly => {}
            }

            validate_required_text("W-2 employer name", &w2.employer_name, &mut errors);
            validate_w2_amounts(w2, &mut errors);
            validate_ein(&w2.employer_ein, &mut errors);
        }

        for interest in &self.interest_income {
            match self.filing_status {
                FilingStatus::Single | FilingStatus::HeadOfHousehold => {
                    if interest.recipient == FilerRole::Spouse {
                        errors.push(ValidationError::SpouseIncomeNotAllowed {
                            income_source: "1099-INT".into(),
                        });
                    }
                }
                FilingStatus::MarriedFilingJointly => {}
            }

            validate_interest_amounts(interest, &mut errors);
        }

        for dividend in &self.dividend_income {
            match self.filing_status {
                FilingStatus::Single | FilingStatus::HeadOfHousehold => {
                    if dividend.recipient == FilerRole::Spouse {
                        errors.push(ValidationError::SpouseIncomeNotAllowed {
                            income_source: "1099-DIV".into(),
                        });
                    }
                }
                FilingStatus::MarriedFilingJointly => {}
            }

            validate_dividend_amounts(dividend, &mut errors);
        }

        for benefit in &self.social_security_income {
            match self.filing_status {
                FilingStatus::Single | FilingStatus::HeadOfHousehold => {
                    if benefit.recipient == FilerRole::Spouse {
                        errors.push(ValidationError::SpouseIncomeNotAllowed {
                            income_source: "SSA-1099".into(),
                        });
                    }
                }
                FilingStatus::MarriedFilingJointly => {}
            }

            validate_social_security_amounts(benefit, &mut errors);
        }

        if errors.is_empty() {
            Ok(())
        } else {
            Err(errors)
        }
    }
}

fn validate_ssn_uniqueness(facts: &TaxFacts, errors: &mut Vec<ValidationError>) {
    let mut seen: HashSet<_> = HashSet::new();
    let mut has_dup = false;

    seen.insert(&facts.primary_filer.ssn);

    if let Some(spouse) = &facts.spouse {
        if !seen.insert(&spouse.ssn) {
            has_dup = true;
        }
    }

    for dep in &facts.dependents {
        if !seen.insert(&dep.ssn) {
            has_dup = true;
        }
    }

    if has_dup {
        errors.push(ValidationError::DuplicateSsn);
    }
}

fn validate_required_text(field: &str, value: &str, errors: &mut Vec<ValidationError>) {
    if value.trim().is_empty() {
        errors.push(ValidationError::EmptyRequiredField {
            field: field.to_string(),
        });
    }
}

fn validate_w2_amounts(w2: &W2Income, errors: &mut Vec<ValidationError>) {
    let fields: &[(&str, &Decimal)] = &[
        ("wages", &w2.wages),
        ("federal_tax_withheld", &w2.federal_tax_withheld),
        ("state_tax_withheld", &w2.state_tax_withheld),
        ("social_security_wages", &w2.social_security_wages),
        (
            "social_security_tax_withheld",
            &w2.social_security_tax_withheld,
        ),
        ("medicare_wages", &w2.medicare_wages),
        ("medicare_tax_withheld", &w2.medicare_tax_withheld),
    ];

    for (name, value) in fields {
        if *value < &Decimal::ZERO {
            errors.push(ValidationError::NegativeAmount {
                field: format!("W2({}).{}", w2.employer_name, name),
                value: value.to_string(),
            });
        }
    }

    // Federal withholding must not exceed wages
    if w2.federal_tax_withheld > w2.wages {
        errors.push(ValidationError::WithholdingExceedsWages {
            employer: w2.employer_name.clone(),
            wages: w2.wages.to_string(),
            withholding: w2.federal_tax_withheld.to_string(),
        });
    }

    if w2.social_security_tax_withheld > w2.social_security_wages {
        errors.push(ValidationError::SocialSecurityWithholdingExceedsWages {
            employer: w2.employer_name.clone(),
            wages: w2.social_security_wages.to_string(),
            withholding: w2.social_security_tax_withheld.to_string(),
        });
    }

    if w2.medicare_tax_withheld > w2.medicare_wages {
        errors.push(ValidationError::MedicareWithholdingExceedsWages {
            employer: w2.employer_name.clone(),
            wages: w2.medicare_wages.to_string(),
            withholding: w2.medicare_tax_withheld.to_string(),
        });
    }
}

fn validate_interest_amounts(interest: &InterestIncome, errors: &mut Vec<ValidationError>) {
    let fields: &[(&str, &Decimal)] = &[
        ("taxable_interest", &interest.taxable_interest),
        ("tax_exempt_interest", &interest.tax_exempt_interest),
    ];

    for (name, value) in fields {
        if *value < &Decimal::ZERO {
            errors.push(ValidationError::NegativeAmount {
                field: format!("1099-INT({}).{}", interest.payer_name, name),
                value: value.to_string(),
            });
        }
    }
}

fn validate_dividend_amounts(dividend: &DividendIncome, errors: &mut Vec<ValidationError>) {
    let fields: &[(&str, &Decimal)] = &[
        ("ordinary_dividends", &dividend.ordinary_dividends),
        ("qualified_dividends", &dividend.qualified_dividends),
    ];

    for (name, value) in fields {
        if *value < &Decimal::ZERO {
            errors.push(ValidationError::NegativeAmount {
                field: format!("1099-DIV({}).{}", dividend.payer_name, name),
                value: value.to_string(),
            });
        }
    }

    if dividend.qualified_dividends > dividend.ordinary_dividends {
        errors.push(ValidationError::QualifiedDividendsExceedOrdinaryDividends {
            payer: dividend.payer_name.clone(),
            ordinary: dividend.ordinary_dividends.to_string(),
            qualified: dividend.qualified_dividends.to_string(),
        });
    }
}

fn validate_social_security_amounts(
    benefit: &SocialSecurityIncome,
    errors: &mut Vec<ValidationError>,
) {
    let fields: &[(&str, &Decimal)] = &[
        ("total_benefits", &benefit.total_benefits),
        ("voluntary_withholding", &benefit.voluntary_withholding),
    ];

    for (name, value) in fields {
        if *value < &Decimal::ZERO {
            errors.push(ValidationError::NegativeAmount {
                field: format!("SSA-1099({:?}).{}", benefit.recipient, name),
                value: value.to_string(),
            });
        }
    }

    if benefit.voluntary_withholding > benefit.total_benefits {
        errors.push(
            ValidationError::SocialSecurityVoluntaryWithholdingExceedsBenefits {
                recipient: format!("{:?}", benefit.recipient),
                benefits: benefit.total_benefits.to_string(),
                withholding: benefit.voluntary_withholding.to_string(),
            },
        );
    }
}

fn validate_ein(ein: &str, errors: &mut Vec<ValidationError>) {
    // EIN format: ##-#######. Validate on raw bytes so malformed UTF-8
    // boundaries cannot panic string slicing.
    let valid = matches!(
        ein.as_bytes(),
        [a, b, b'-', c, d, e, f, g, h, i]
            if [a, b, c, d, e, f, g, h, i]
                .iter()
                .all(|byte| byte.is_ascii_digit())
    );

    if !valid {
        errors.push(ValidationError::InvalidEin {
            ein: ein.to_string(),
        });
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::date::DateYmd;
    use crate::filer::{DividendIncome, FilerInfo, InterestIncome, SocialSecurityIncome, W2Income};
    use crate::ssn::Ssn;
    use rust_decimal::Decimal;

    fn test_filer() -> FilerInfo {
        FilerInfo {
            first_name: "Test".into(),
            last_name: "Filer".into(),
            ssn: Ssn::parse("400-01-0001").unwrap(),
            date_of_birth: DateYmd::new(1990, 6, 15).unwrap(),
            is_blind: false,
            is_dependent: false,
        }
    }

    fn spouse_filer() -> FilerInfo {
        FilerInfo {
            first_name: "Test".into(),
            last_name: "Spouse".into(),
            ssn: Ssn::parse("400-02-0002").unwrap(),
            date_of_birth: DateYmd::new(1990, 6, 15).unwrap(),
            is_blind: false,
            is_dependent: false,
        }
    }

    fn test_w2(recipient: FilerRole) -> W2Income {
        W2Income {
            recipient,
            employer_name: "Test Corp".into(),
            employer_ein: "12-3456789".into(),
            wages: Decimal::from(60000),
            federal_tax_withheld: Decimal::from(8000),
            state_tax_withheld: Decimal::from(3000),
            social_security_wages: Decimal::from(60000),
            social_security_tax_withheld: Decimal::from(3720),
            medicare_wages: Decimal::from(60000),
            medicare_tax_withheld: Decimal::from(870),
        }
    }

    fn test_interest(recipient: FilerRole) -> InterestIncome {
        InterestIncome {
            recipient,
            payer_name: "Test Bank".into(),
            taxable_interest: Decimal::from(125),
            tax_exempt_interest: Decimal::from(25),
        }
    }

    fn test_dividend(recipient: FilerRole) -> DividendIncome {
        DividendIncome {
            recipient,
            payer_name: "Test Brokerage".into(),
            ordinary_dividends: Decimal::from(300),
            qualified_dividends: Decimal::from(200),
        }
    }

    fn test_social_security(recipient: FilerRole) -> SocialSecurityIncome {
        SocialSecurityIncome {
            recipient,
            total_benefits: Decimal::from(24000),
            voluntary_withholding: Decimal::from(1200),
        }
    }

    fn facts_with_w2s(
        filing_status: FilingStatus,
        spouse: Option<FilerInfo>,
        w2_income: Vec<W2Income>,
    ) -> TaxFacts {
        TaxFacts {
            tax_year: 2025,
            filing_status,
            primary_filer: test_filer(),
            spouse,
            dependents: vec![],
            w2_income,
            interest_income: vec![],
            dividend_income: vec![],
            social_security_income: vec![],
        }
    }

    #[test]
    fn valid_single_filer() {
        let facts = facts_with_w2s(
            FilingStatus::Single,
            None,
            vec![test_w2(FilerRole::Primary)],
        );
        assert!(facts.validate_structure().is_ok());
    }

    #[test]
    fn valid_mfj_filer() {
        let facts = facts_with_w2s(
            FilingStatus::MarriedFilingJointly,
            Some(spouse_filer()),
            vec![test_w2(FilerRole::Primary), test_w2(FilerRole::Spouse)],
        );
        assert!(facts.validate_structure().is_ok());
    }

    #[test]
    fn mfj_missing_spouse() {
        let facts = facts_with_w2s(
            FilingStatus::MarriedFilingJointly,
            None,
            vec![test_w2(FilerRole::Primary)],
        );
        let errs = facts.validate_structure().unwrap_err();
        assert!(errs
            .iter()
            .any(|e| matches!(e, ValidationError::MfjMissingSpouse)));
    }

    #[test]
    fn single_has_spouse() {
        let facts = facts_with_w2s(
            FilingStatus::Single,
            Some(test_filer()),
            vec![test_w2(FilerRole::Primary)],
        );
        let errs = facts.validate_structure().unwrap_err();
        assert!(errs
            .iter()
            .any(|e| matches!(e, ValidationError::SingleHasSpouse)));
    }

    #[test]
    fn no_supported_income() {
        let facts = TaxFacts {
            tax_year: 2025,
            filing_status: FilingStatus::Single,
            primary_filer: test_filer(),
            spouse: None,
            dependents: vec![],
            w2_income: vec![],
            interest_income: vec![],
            dividend_income: vec![],
            social_security_income: vec![],
        };
        let errs = facts.validate_structure().unwrap_err();
        assert!(errs
            .iter()
            .any(|e| matches!(e, ValidationError::NoSupportedIncome)));
    }

    #[test]
    fn supported_interest_only_case_is_allowed() {
        let facts = TaxFacts {
            tax_year: 2025,
            filing_status: FilingStatus::Single,
            primary_filer: test_filer(),
            spouse: None,
            dependents: vec![],
            w2_income: vec![],
            interest_income: vec![test_interest(FilerRole::Primary)],
            dividend_income: vec![],
            social_security_income: vec![],
        };

        assert!(facts.validate_structure().is_ok());
    }

    #[test]
    fn supported_social_security_only_case_is_allowed() {
        let facts = TaxFacts {
            tax_year: 2025,
            filing_status: FilingStatus::Single,
            primary_filer: test_filer(),
            spouse: None,
            dependents: vec![],
            w2_income: vec![],
            interest_income: vec![],
            dividend_income: vec![],
            social_security_income: vec![test_social_security(FilerRole::Primary)],
        };

        assert!(facts.validate_structure().is_ok());
    }

    #[test]
    fn distinct_ssns_with_same_last_four_are_not_rejected() {
        let facts = TaxFacts {
            spouse: Some(FilerInfo {
                first_name: "Other".into(),
                last_name: "Person".into(),
                ssn: Ssn::parse("401-01-0001").unwrap(),
                date_of_birth: DateYmd::new(1991, 6, 15).unwrap(),
                is_blind: false,
                is_dependent: false,
            }),
            ..facts_with_w2s(
                FilingStatus::MarriedFilingJointly,
                None,
                vec![test_w2(FilerRole::Primary), test_w2(FilerRole::Spouse)],
            )
        };

        assert!(facts.validate_structure().is_ok());
    }

    #[test]
    fn single_with_spouse_w2() {
        let facts = facts_with_w2s(FilingStatus::Single, None, vec![test_w2(FilerRole::Spouse)]);
        let errs = facts.validate_structure().unwrap_err();
        assert!(errs
            .iter()
            .any(|e| matches!(e, ValidationError::SingleFilerSpouseW2)));
    }

    #[test]
    fn negative_wages() {
        let mut w2 = test_w2(FilerRole::Primary);
        w2.wages = Decimal::from(-1000);
        let facts = facts_with_w2s(FilingStatus::Single, None, vec![w2]);
        let errs = facts.validate_structure().unwrap_err();
        assert!(errs
            .iter()
            .any(|e| matches!(e, ValidationError::NegativeAmount { .. })));
    }

    #[test]
    fn withholding_exceeds_wages() {
        let mut w2 = test_w2(FilerRole::Primary);
        w2.federal_tax_withheld = Decimal::from(70000);
        let facts = facts_with_w2s(FilingStatus::Single, None, vec![w2]);
        let errs = facts.validate_structure().unwrap_err();
        assert!(errs
            .iter()
            .any(|e| matches!(e, ValidationError::WithholdingExceedsWages { .. })));
    }

    #[test]
    fn invalid_ein() {
        let mut w2 = test_w2(FilerRole::Primary);
        w2.employer_ein = "1234567890".into();
        let facts = facts_with_w2s(FilingStatus::Single, None, vec![w2]);
        let errs = facts.validate_structure().unwrap_err();
        assert!(errs
            .iter()
            .any(|e| matches!(e, ValidationError::InvalidEin { .. })));
    }

    #[test]
    fn duplicate_spouse_ssn_rejected() {
        let facts = facts_with_w2s(
            FilingStatus::MarriedFilingJointly,
            Some(test_filer()),
            vec![test_w2(FilerRole::Primary)],
        );
        let errs = facts.validate_structure().unwrap_err();
        assert!(errs
            .iter()
            .any(|e| matches!(e, ValidationError::DuplicateSsn)));
    }

    #[test]
    fn blank_primary_name_rejected() {
        let mut filer = test_filer();
        filer.first_name = "   ".into();
        let facts = TaxFacts {
            primary_filer: filer,
            ..facts_with_w2s(
                FilingStatus::Single,
                None,
                vec![test_w2(FilerRole::Primary)],
            )
        };
        let errs = facts.validate_structure().unwrap_err();
        assert!(errs
            .iter()
            .any(|e| matches!(e, ValidationError::EmptyRequiredField { field } if field == "primary filer first name")));
    }

    #[test]
    fn blank_employer_name_rejected() {
        let mut w2 = test_w2(FilerRole::Primary);
        w2.employer_name = "   ".into();
        let facts = facts_with_w2s(FilingStatus::Single, None, vec![w2]);
        let errs = facts.validate_structure().unwrap_err();
        assert!(errs
            .iter()
            .any(|e| matches!(e, ValidationError::EmptyRequiredField { field } if field == "W-2 employer name")));
    }

    #[test]
    fn social_security_withholding_exceeds_social_security_wages() {
        let mut w2 = test_w2(FilerRole::Primary);
        w2.social_security_wages = Decimal::from(100);
        w2.social_security_tax_withheld = Decimal::from(101);
        let facts = facts_with_w2s(FilingStatus::Single, None, vec![w2]);
        let errs = facts.validate_structure().unwrap_err();
        assert!(errs.iter().any(|e| matches!(
            e,
            ValidationError::SocialSecurityWithholdingExceedsWages { .. }
        )));
    }

    #[test]
    fn medicare_withholding_exceeds_medicare_wages() {
        let mut w2 = test_w2(FilerRole::Primary);
        w2.medicare_wages = Decimal::from(100);
        w2.medicare_tax_withheld = Decimal::from(101);
        let facts = facts_with_w2s(FilingStatus::Single, None, vec![w2]);
        let errs = facts.validate_structure().unwrap_err();
        assert!(errs
            .iter()
            .any(|e| matches!(e, ValidationError::MedicareWithholdingExceedsWages { .. })));
    }

    #[test]
    fn invalid_utf8_boundary_ein_is_rejected_safely() {
        let mut w2 = test_w2(FilerRole::Primary);
        w2.employer_ein = "1é-345678".into();
        let facts = facts_with_w2s(FilingStatus::Single, None, vec![w2]);
        let errs = facts.validate_structure().unwrap_err();
        assert!(errs
            .iter()
            .any(|e| matches!(e, ValidationError::InvalidEin { .. })));
    }

    #[test]
    fn spouse_interest_rejected_for_single() {
        let facts = TaxFacts {
            tax_year: 2025,
            filing_status: FilingStatus::Single,
            primary_filer: test_filer(),
            spouse: None,
            dependents: vec![],
            w2_income: vec![],
            interest_income: vec![test_interest(FilerRole::Spouse)],
            dividend_income: vec![],
            social_security_income: vec![],
        };
        let errs = facts.validate_structure().unwrap_err();
        assert!(errs.iter().any(|e| matches!(
            e,
            ValidationError::SpouseIncomeNotAllowed { income_source }
            if income_source == "1099-INT"
        )));
    }

    #[test]
    fn qualified_dividends_cannot_exceed_ordinary_dividends() {
        let mut dividend = test_dividend(FilerRole::Primary);
        dividend.qualified_dividends = Decimal::from(350);
        let facts = TaxFacts {
            tax_year: 2025,
            filing_status: FilingStatus::Single,
            primary_filer: test_filer(),
            spouse: None,
            dependents: vec![],
            w2_income: vec![],
            interest_income: vec![],
            dividend_income: vec![dividend],
            social_security_income: vec![],
        };

        let errs = facts.validate_structure().unwrap_err();
        assert!(errs.iter().any(|e| matches!(
            e,
            ValidationError::QualifiedDividendsExceedOrdinaryDividends { .. }
        )));
    }

    #[test]
    fn spouse_social_security_rejected_for_single() {
        let facts = TaxFacts {
            tax_year: 2025,
            filing_status: FilingStatus::Single,
            primary_filer: test_filer(),
            spouse: None,
            dependents: vec![],
            w2_income: vec![],
            interest_income: vec![],
            dividend_income: vec![],
            social_security_income: vec![test_social_security(FilerRole::Spouse)],
        };
        let errs = facts.validate_structure().unwrap_err();
        assert!(errs.iter().any(|e| matches!(
            e,
            ValidationError::SpouseIncomeNotAllowed { income_source }
            if income_source == "SSA-1099"
        )));
    }

    #[test]
    fn social_security_withholding_cannot_exceed_total_benefits() {
        let mut benefit = test_social_security(FilerRole::Primary);
        benefit.total_benefits = Decimal::from(100);
        benefit.voluntary_withholding = Decimal::from(101);
        let facts = TaxFacts {
            tax_year: 2025,
            filing_status: FilingStatus::Single,
            primary_filer: test_filer(),
            spouse: None,
            dependents: vec![],
            w2_income: vec![],
            interest_income: vec![],
            dividend_income: vec![],
            social_security_income: vec![benefit],
        };

        let errs = facts.validate_structure().unwrap_err();
        assert!(errs.iter().any(|e| matches!(
            e,
            ValidationError::SocialSecurityVoluntaryWithholdingExceedsBenefits { .. }
        )));
    }
}
