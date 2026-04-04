use rust_decimal::Decimal;
use taxvault_core::{DateYmd, FilerInfo, FilerRole, FilingStatus, Ssn, TaxFacts, W2Income};
use taxvault_engine::{
    compute, ChildTaxCreditRules, ComputeOptions, MedicareRules, QualifiedDividendRules, RulePack,
    RulePackMeta, SocialSecurityRules, StandardDeductionRules, TaxBracket, TaxBrackets, TestVector,
};

use crate::dto::RulePackDto;
use crate::error::LoaderError;
use crate::parse::{parse_date, parse_filing_status};
use crate::tax_table_loader::load_tax_table;

/// Load and assemble a complete RulePack from TOML rule content and CSV tax table content.
/// Runs self-validation (test vectors through engine) on assembly.
pub fn load_rule_pack(toml_content: &str, csv_content: &str) -> Result<RulePack, LoaderError> {
    let dto: RulePackDto = toml::from_str(toml_content)?;
    let (tax_table, table_verified) = load_tax_table(csv_content)?;

    let age_threshold = parse_date(&dto.age_threshold)?;

    let convert_bracket = |b: crate::dto::TaxBracketDto| TaxBracket {
        min: b.min,
        max: b.max,
        rate: b.rate,
    };
    let tax_brackets = TaxBrackets {
        single: dto
            .tax_brackets
            .single
            .into_iter()
            .map(convert_bracket)
            .collect(),
        married_filing_jointly: dto
            .tax_brackets
            .married_filing_jointly
            .into_iter()
            .map(convert_bracket)
            .collect(),
        head_of_household: dto
            .tax_brackets
            .head_of_household
            .into_iter()
            .map(convert_bracket)
            .collect(),
    };

    let test_vectors: Vec<TestVector> = dto
        .test_vectors
        .unwrap_or_default()
        .into_iter()
        .map(|v| {
            Ok(TestVector {
                description: v.description,
                filing_status: parse_filing_status(&v.filing_status)?,
                total_wages: v.total_wages,
                federal_withholding: v.federal_withholding,
                expected_agi: v.expected_agi,
                expected_taxable_income: v.expected_taxable_income,
                expected_tax: v.expected_tax,
            })
        })
        .collect::<Result<Vec<_>, LoaderError>>()?;

    let rule_pack = RulePack {
        meta: RulePackMeta {
            tax_year: dto.meta.tax_year,
            jurisdiction: dto.meta.jurisdiction,
            version: dto.meta.version,
            effective_date: dto.meta.effective_date,
            table_verified,
        },
        standard_deduction: StandardDeductionRules {
            single: dto.standard_deduction.single,
            married_filing_jointly: dto.standard_deduction.married_filing_jointly,
            head_of_household: dto.standard_deduction.head_of_household,
            additional_age_or_blind_single: dto.standard_deduction.additional_age_or_blind_single,
            additional_age_or_blind_married: dto.standard_deduction.additional_age_or_blind_married,
        },
        qualified_dividends: QualifiedDividendRules {
            zero_rate_threshold_single: dto.qualified_dividends.zero_rate_threshold_single,
            zero_rate_threshold_married_filing_jointly: dto
                .qualified_dividends
                .zero_rate_threshold_married_filing_jointly,
            zero_rate_threshold_head_of_household: dto
                .qualified_dividends
                .zero_rate_threshold_head_of_household,
            fifteen_rate_threshold_single: dto.qualified_dividends.fifteen_rate_threshold_single,
            fifteen_rate_threshold_married_filing_jointly: dto
                .qualified_dividends
                .fifteen_rate_threshold_married_filing_jointly,
            fifteen_rate_threshold_head_of_household: dto
                .qualified_dividends
                .fifteen_rate_threshold_head_of_household,
        },
        child_tax_credit: ChildTaxCreditRules {
            qualifying_child_credit: dto.child_tax_credit.qualifying_child_credit,
            other_dependent_credit: dto.child_tax_credit.other_dependent_credit,
            refundable_credit_per_child: dto.child_tax_credit.refundable_credit_per_child,
            phaseout_threshold_married_filing_jointly: dto
                .child_tax_credit
                .phaseout_threshold_married_filing_jointly,
            phaseout_threshold_other: dto.child_tax_credit.phaseout_threshold_other,
            phaseout_increment: dto.child_tax_credit.phaseout_increment,
            phaseout_rate: dto.child_tax_credit.phaseout_rate,
            refundable_earned_income_threshold: dto
                .child_tax_credit
                .refundable_earned_income_threshold,
            refundable_withholding_floor: dto.child_tax_credit.refundable_withholding_floor,
        },
        tax_brackets,
        tax_table,
        social_security: SocialSecurityRules {
            wage_base: dto.social_security.wage_base,
            tax_rate: dto.social_security.tax_rate,
            benefits_50_threshold_single: dto.social_security.benefits_50_threshold_single,
            benefits_50_threshold_married_filing_jointly: dto
                .social_security
                .benefits_50_threshold_married_filing_jointly,
            benefits_85_threshold_single: dto.social_security.benefits_85_threshold_single,
            benefits_85_threshold_married_filing_jointly: dto
                .social_security
                .benefits_85_threshold_married_filing_jointly,
        },
        medicare: MedicareRules {
            tax_rate: dto.medicare.tax_rate,
            additional_rate: dto.medicare.additional_rate,
            additional_threshold_single: dto.medicare.additional_threshold_single,
            additional_threshold_mfj: dto.medicare.additional_threshold_mfj,
            employer_withholding_threshold: dto.medicare.employer_withholding_threshold,
        },
        age_threshold,
        test_vectors,
    };

    validate_rule_pack(&rule_pack)?;

    // Self-validate test vectors
    run_self_validation(&rule_pack)?;

    Ok(rule_pack)
}

fn run_self_validation(rules: &RulePack) -> Result<(), LoaderError> {
    let options = ComputeOptions {
        allow_unverified_table: true,
    };

    for (i, vector) in rules.test_vectors.iter().enumerate() {
        let facts = build_facts_from_vector(vector, rules.meta.tax_year);
        let result = compute(&facts, rules, &options)
            .map_err(|e| LoaderError::Validation(format!("test vector {i} compute failed: {e}")))?;

        check_field(
            i,
            &vector.description,
            "agi",
            vector.expected_agi,
            result.adjusted_gross_income,
        )?;
        check_field(
            i,
            &vector.description,
            "taxable_income",
            vector.expected_taxable_income,
            result.taxable_income,
        )?;
        check_field(
            i,
            &vector.description,
            "tax",
            vector.expected_tax,
            result.income_tax,
        )?;
    }

    Ok(())
}

fn validate_rule_pack(rule_pack: &RulePack) -> Result<(), LoaderError> {
    validate_non_negative(
        "standard_deduction.single",
        rule_pack.standard_deduction.single,
    )?;
    validate_non_negative(
        "standard_deduction.married_filing_jointly",
        rule_pack.standard_deduction.married_filing_jointly,
    )?;
    validate_non_negative(
        "standard_deduction.head_of_household",
        rule_pack.standard_deduction.head_of_household,
    )?;
    validate_non_negative(
        "standard_deduction.additional_age_or_blind_single",
        rule_pack.standard_deduction.additional_age_or_blind_single,
    )?;
    validate_non_negative(
        "standard_deduction.additional_age_or_blind_married",
        rule_pack.standard_deduction.additional_age_or_blind_married,
    )?;
    validate_non_negative(
        "qualified_dividends.zero_rate_threshold_single",
        rule_pack.qualified_dividends.zero_rate_threshold_single,
    )?;
    validate_non_negative(
        "qualified_dividends.zero_rate_threshold_married_filing_jointly",
        rule_pack
            .qualified_dividends
            .zero_rate_threshold_married_filing_jointly,
    )?;
    validate_non_negative(
        "qualified_dividends.zero_rate_threshold_head_of_household",
        rule_pack
            .qualified_dividends
            .zero_rate_threshold_head_of_household,
    )?;
    validate_non_negative(
        "qualified_dividends.fifteen_rate_threshold_single",
        rule_pack.qualified_dividends.fifteen_rate_threshold_single,
    )?;
    validate_non_negative(
        "qualified_dividends.fifteen_rate_threshold_married_filing_jointly",
        rule_pack
            .qualified_dividends
            .fifteen_rate_threshold_married_filing_jointly,
    )?;
    validate_non_negative(
        "qualified_dividends.fifteen_rate_threshold_head_of_household",
        rule_pack
            .qualified_dividends
            .fifteen_rate_threshold_head_of_household,
    )?;
    validate_non_negative(
        "child_tax_credit.qualifying_child_credit",
        rule_pack.child_tax_credit.qualifying_child_credit,
    )?;
    validate_non_negative(
        "child_tax_credit.other_dependent_credit",
        rule_pack.child_tax_credit.other_dependent_credit,
    )?;
    validate_non_negative(
        "child_tax_credit.refundable_credit_per_child",
        rule_pack.child_tax_credit.refundable_credit_per_child,
    )?;
    validate_non_negative(
        "child_tax_credit.phaseout_threshold_married_filing_jointly",
        rule_pack
            .child_tax_credit
            .phaseout_threshold_married_filing_jointly,
    )?;
    validate_non_negative(
        "child_tax_credit.phaseout_threshold_other",
        rule_pack.child_tax_credit.phaseout_threshold_other,
    )?;
    validate_non_negative(
        "child_tax_credit.phaseout_increment",
        rule_pack.child_tax_credit.phaseout_increment,
    )?;
    validate_rate(
        "child_tax_credit.phaseout_rate",
        rule_pack.child_tax_credit.phaseout_rate,
    )?;
    validate_non_negative(
        "child_tax_credit.refundable_earned_income_threshold",
        rule_pack
            .child_tax_credit
            .refundable_earned_income_threshold,
    )?;
    validate_non_negative(
        "child_tax_credit.refundable_withholding_floor",
        rule_pack.child_tax_credit.refundable_withholding_floor,
    )?;
    validate_rate(
        "social_security.tax_rate",
        rule_pack.social_security.tax_rate,
    )?;
    validate_non_negative(
        "social_security.wage_base",
        rule_pack.social_security.wage_base,
    )?;
    validate_non_negative(
        "social_security.benefits_50_threshold_single",
        rule_pack.social_security.benefits_50_threshold_single,
    )?;
    validate_non_negative(
        "social_security.benefits_50_threshold_married_filing_jointly",
        rule_pack
            .social_security
            .benefits_50_threshold_married_filing_jointly,
    )?;
    validate_non_negative(
        "social_security.benefits_85_threshold_single",
        rule_pack.social_security.benefits_85_threshold_single,
    )?;
    validate_non_negative(
        "social_security.benefits_85_threshold_married_filing_jointly",
        rule_pack
            .social_security
            .benefits_85_threshold_married_filing_jointly,
    )?;
    if rule_pack.social_security.benefits_85_threshold_single
        < rule_pack.social_security.benefits_50_threshold_single
    {
        return Err(LoaderError::Validation(
            "social_security single 85% threshold must be greater than or equal to the 50% threshold"
                .into(),
        ));
    }
    if rule_pack
        .social_security
        .benefits_85_threshold_married_filing_jointly
        < rule_pack
            .social_security
            .benefits_50_threshold_married_filing_jointly
    {
        return Err(LoaderError::Validation(
            "social_security MFJ 85% threshold must be greater than or equal to the 50% threshold"
                .into(),
        ));
    }
    validate_rate("medicare.tax_rate", rule_pack.medicare.tax_rate)?;
    validate_rate(
        "medicare.additional_rate",
        rule_pack.medicare.additional_rate,
    )?;
    validate_non_negative(
        "medicare.additional_threshold_single",
        rule_pack.medicare.additional_threshold_single,
    )?;
    validate_non_negative(
        "medicare.additional_threshold_mfj",
        rule_pack.medicare.additional_threshold_mfj,
    )?;
    validate_non_negative(
        "medicare.employer_withholding_threshold",
        rule_pack.medicare.employer_withholding_threshold,
    )?;
    validate_brackets("single", &rule_pack.tax_brackets.single)?;
    validate_brackets(
        "married_filing_jointly",
        &rule_pack.tax_brackets.married_filing_jointly,
    )?;
    validate_brackets(
        "head_of_household",
        &rule_pack.tax_brackets.head_of_household,
    )?;

    Ok(())
}

fn validate_non_negative(name: &str, value: Decimal) -> Result<(), LoaderError> {
    if value < Decimal::ZERO {
        return Err(LoaderError::Validation(format!(
            "{name} must be non-negative, got {value}"
        )));
    }
    Ok(())
}

fn validate_rate(name: &str, value: Decimal) -> Result<(), LoaderError> {
    if !(Decimal::ZERO..=Decimal::ONE).contains(&value) {
        return Err(LoaderError::Validation(format!(
            "{name} must be between 0 and 1 inclusive, got {value}"
        )));
    }
    Ok(())
}

fn validate_brackets(label: &str, brackets: &[TaxBracket]) -> Result<(), LoaderError> {
    if brackets.is_empty() {
        return Err(LoaderError::Validation(format!(
            "tax_brackets.{label} must define at least one bracket"
        )));
    }

    let mut expected_start = Decimal::ZERO;
    let last_index = brackets.len() - 1;

    for (index, bracket) in brackets.iter().enumerate() {
        if bracket.min != expected_start {
            return Err(LoaderError::Validation(format!(
                "tax_brackets.{label}[{index}] starts at {} but expected {}",
                bracket.min, expected_start
            )));
        }

        validate_rate(&format!("tax_brackets.{label}[{index}].rate"), bracket.rate)?;

        match bracket.max {
            Some(max) => {
                if max <= bracket.min {
                    return Err(LoaderError::Validation(format!(
                        "tax_brackets.{label}[{index}] has non-positive width: {}..{}",
                        bracket.min, max
                    )));
                }
                if index == last_index {
                    return Err(LoaderError::Validation(format!(
                        "tax_brackets.{label} must end with an open-ended top bracket"
                    )));
                }
                expected_start = max;
            }
            None => {
                if index != last_index {
                    return Err(LoaderError::Validation(format!(
                        "tax_brackets.{label}[{index}] is open-ended but not last"
                    )));
                }
            }
        }
    }

    Ok(())
}

fn check_field(
    index: usize,
    description: &str,
    field: &str,
    expected: Decimal,
    actual: Decimal,
) -> Result<(), LoaderError> {
    if expected != actual {
        return Err(LoaderError::TestVectorFailed {
            index,
            description: description.to_string(),
            field: field.to_string(),
            expected: expected.to_string(),
            actual: actual.to_string(),
        });
    }
    Ok(())
}

fn build_facts_from_vector(vector: &TestVector, tax_year: u16) -> TaxFacts {
    let primary_filer = FilerInfo {
        first_name: "Vector".into(),
        last_name: "Test".into(),
        ssn: Ssn::parse("400-01-0001").unwrap(),
        date_of_birth: DateYmd::new(1990, 1, 1).unwrap(),
        is_blind: false,
        is_dependent: false,
    };

    let spouse = match vector.filing_status {
        FilingStatus::MarriedFilingJointly => Some(FilerInfo {
            first_name: "Spouse".into(),
            last_name: "Test".into(),
            ssn: Ssn::parse("400-02-0002").unwrap(),
            date_of_birth: DateYmd::new(1990, 1, 1).unwrap(),
            is_blind: false,
            is_dependent: false,
        }),
        _ => None,
    };

    // For MFJ vectors, split wages equally between primary and spouse
    let w2_income = match vector.filing_status {
        FilingStatus::MarriedFilingJointly => {
            let half = vector.total_wages / Decimal::from(2);
            let half_wh = vector.federal_withholding / Decimal::from(2);
            vec![
                make_w2(FilerRole::Primary, half, half_wh),
                make_w2(
                    FilerRole::Spouse,
                    vector.total_wages - half,
                    vector.federal_withholding - half_wh,
                ),
            ]
        }
        _ => vec![make_w2(
            FilerRole::Primary,
            vector.total_wages,
            vector.federal_withholding,
        )],
    };

    TaxFacts {
        tax_year,
        filing_status: vector.filing_status,
        primary_filer,
        spouse,
        dependents: vec![],
        w2_income,
        interest_income: vec![],
        dividend_income: vec![],
        social_security_income: vec![],
    }
}

fn make_w2(role: FilerRole, wages: Decimal, withholding: Decimal) -> W2Income {
    W2Income {
        recipient: role,
        employer_name: "Vector Test Corp".into(),
        employer_ein: "99-9999999".into(),
        wages,
        federal_tax_withheld: withholding,
        state_tax_withheld: Decimal::ZERO,
        social_security_wages: wages,
        social_security_tax_withheld: Decimal::ZERO,
        medicare_wages: wages,
        medicare_tax_withheld: Decimal::ZERO,
    }
}
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_invalid_bracket_configuration() {
        let toml = r#"
        age_threshold = "1961-01-02"

        [meta]
        tax_year = 2025
        jurisdiction = "federal"
        version = "1.0.0"
        effective_date = "2025-01-01"

        [standard_deduction]
        single = 15750
        married_filing_jointly = 31500
        head_of_household = 23625
        additional_age_or_blind_single = 2000
        additional_age_or_blind_married = 1600

        [qualified_dividends]
        zero_rate_threshold_single = 48350
        zero_rate_threshold_married_filing_jointly = 96700
        zero_rate_threshold_head_of_household = 64750
        fifteen_rate_threshold_single = 533400
        fifteen_rate_threshold_married_filing_jointly = 600050
        fifteen_rate_threshold_head_of_household = 566700

        [child_tax_credit]
        qualifying_child_credit = 2200
        other_dependent_credit = 500
        refundable_credit_per_child = 1700
        phaseout_threshold_married_filing_jointly = 400000
        phaseout_threshold_other = 200000
        phaseout_increment = 1000
        phaseout_rate = 0.05
        refundable_earned_income_threshold = 2500
        refundable_withholding_floor = 5100

        [social_security]
        wage_base = 176100
        tax_rate = 0.062
        benefits_50_threshold_single = 25000
        benefits_50_threshold_married_filing_jointly = 32000
        benefits_85_threshold_single = 34000
        benefits_85_threshold_married_filing_jointly = 44000

        [medicare]
        tax_rate = 0.0145
        additional_rate = 0.009
        additional_threshold_single = 200000
        additional_threshold_mfj = 250000
        employer_withholding_threshold = 200000

        [[tax_brackets.single]]
        min = 100
        max = 11925
        rate = 0.10

        [[tax_brackets.single]]
        min = 11925
        rate = 0.12

        [[tax_brackets.married_filing_jointly]]
        min = 0
        max = 23850
        rate = 0.10

        [[tax_brackets.married_filing_jointly]]
        min = 23850
        rate = 0.12

        [[tax_brackets.head_of_household]]
        min = 0
        max = 17000
        rate = 0.10

        [[tax_brackets.head_of_household]]
        min = 17000
        rate = 0.12
        "#;

        let csv = "income_at_least,income_less_than,tax_single,tax_mfj,tax_hoh\n0,100000,0,0,0\n";
        let error = match load_rule_pack(toml, csv) {
            Ok(_) => panic!("unexpectedly accepted invalid bracket configuration"),
            Err(error) => error,
        };
        assert!(matches!(error, LoaderError::Validation(_)));
    }

    #[test]
    fn rejects_negative_additional_standard_deduction() {
        let toml = r#"
        age_threshold = "1961-01-02"

        [meta]
        tax_year = 2025
        jurisdiction = "federal"
        version = "1.0.0"
        effective_date = "2025-01-01"

        [standard_deduction]
        single = 15750
        married_filing_jointly = 31500
        head_of_household = 23625
        additional_age_or_blind_single = -1
        additional_age_or_blind_married = 1600

        [qualified_dividends]
        zero_rate_threshold_single = 48350
        zero_rate_threshold_married_filing_jointly = 96700
        zero_rate_threshold_head_of_household = 64750
        fifteen_rate_threshold_single = 533400
        fifteen_rate_threshold_married_filing_jointly = 600050
        fifteen_rate_threshold_head_of_household = 566700

        [child_tax_credit]
        qualifying_child_credit = 2200
        other_dependent_credit = 500
        refundable_credit_per_child = 1700
        phaseout_threshold_married_filing_jointly = 400000
        phaseout_threshold_other = 200000
        phaseout_increment = 1000
        phaseout_rate = 0.05
        refundable_earned_income_threshold = 2500
        refundable_withholding_floor = 5100

        [social_security]
        wage_base = 176100
        tax_rate = 0.062
        benefits_50_threshold_single = 25000
        benefits_50_threshold_married_filing_jointly = 32000
        benefits_85_threshold_single = 34000
        benefits_85_threshold_married_filing_jointly = 44000

        [medicare]
        tax_rate = 0.0145
        additional_rate = 0.009
        additional_threshold_single = 200000
        additional_threshold_mfj = 250000
        employer_withholding_threshold = 200000

        [[tax_brackets.single]]
        min = 0
        rate = 0.10

        [[tax_brackets.married_filing_jointly]]
        min = 0
        rate = 0.10

        [[tax_brackets.head_of_household]]
        min = 0
        rate = 0.10
        "#;

        let csv = "income_at_least,income_less_than,tax_single,tax_mfj,tax_hoh\n0,100000,0,0,0\n";
        let error = match load_rule_pack(toml, csv) {
            Ok(_) => panic!("unexpectedly accepted negative additional deduction"),
            Err(error) => error,
        };
        assert!(matches!(error, LoaderError::Validation(_)));
    }
}
