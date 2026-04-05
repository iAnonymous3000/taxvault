use rust_decimal::Decimal;
use taxvault_core::*;

use crate::dto::{
    AdjustmentsDto, DependentDto, DividendIncomeDto, FilerInfoDto, InterestIncomeDto,
    SocialSecurityIncomeDto, TaxFactsDto, TaxFactsInputFile, W2IncomeDto,
};
use crate::error::LoaderError;
use crate::parse::{parse_date, parse_filing_status};

/// Parse a JSON string into TaxFacts.
pub fn load_tax_facts(json: &str) -> Result<TaxFacts, LoaderError> {
    let input_file: TaxFactsInputFile = serde_json::from_str(json)?;
    convert_tax_facts(input_file.input)
}

fn convert_tax_facts(dto: TaxFactsDto) -> Result<TaxFacts, LoaderError> {
    let filing_status = parse_filing_status(&dto.filing_status)?;
    let primary_filer = convert_filer_info(dto.primary_filer)?;
    let spouse = dto.spouse.map(convert_filer_info).transpose()?;
    let dependents = dto
        .dependents
        .unwrap_or_default()
        .into_iter()
        .map(convert_dependent)
        .collect::<Result<Vec<_>, _>>()?;
    let w2_income = dto
        .w2_income
        .unwrap_or_default()
        .into_iter()
        .map(convert_w2)
        .collect::<Result<Vec<_>, _>>()?;
    let interest_income = dto
        .interest_income
        .unwrap_or_default()
        .into_iter()
        .map(convert_interest)
        .collect::<Result<Vec<_>, _>>()?;
    let dividend_income = dto
        .dividend_income
        .unwrap_or_default()
        .into_iter()
        .map(convert_dividend)
        .collect::<Result<Vec<_>, _>>()?;
    let social_security_income = dto
        .social_security_income
        .unwrap_or_default()
        .into_iter()
        .map(convert_social_security)
        .collect::<Result<Vec<_>, _>>()?;
    let adjustments = convert_adjustments(dto.adjustments.unwrap_or(AdjustmentsDto {
        traditional_ira_deduction: Decimal::ZERO,
        hsa_deduction: Decimal::ZERO,
        student_loan_interest_paid: Decimal::ZERO,
    }));

    Ok(TaxFacts {
        tax_year: dto.tax_year,
        filing_status,
        primary_filer,
        spouse,
        dependents,
        w2_income,
        interest_income,
        dividend_income,
        social_security_income,
        adjustments,
    })
}

fn convert_dependent(dto: DependentDto) -> Result<Dependent, LoaderError> {
    let ssn = Ssn::parse(&dto.ssn).map_err(|e| LoaderError::Conversion(e.to_string()))?;
    let date_of_birth = parse_date(&dto.date_of_birth)?;
    let relationship = parse_relationship(&dto.relationship)?;

    Ok(Dependent {
        first_name: dto.first_name,
        last_name: dto.last_name,
        ssn,
        date_of_birth,
        relationship,
        months_lived_in_home: dto.months_lived_in_home,
    })
}

fn parse_relationship(s: &str) -> Result<DependentRelationship, LoaderError> {
    match s {
        "son" => Ok(DependentRelationship::Son),
        "daughter" => Ok(DependentRelationship::Daughter),
        "stepchild" => Ok(DependentRelationship::Stepchild),
        "foster_child" => Ok(DependentRelationship::FosterChild),
        "sibling" => Ok(DependentRelationship::Sibling),
        "step_sibling" => Ok(DependentRelationship::StepSibling),
        "half_sibling" => Ok(DependentRelationship::HalfSibling),
        "grandchild" => Ok(DependentRelationship::Grandchild),
        "niece" => Ok(DependentRelationship::Niece),
        "nephew" => Ok(DependentRelationship::Nephew),
        "parent" => Ok(DependentRelationship::Parent),
        "grandparent" => Ok(DependentRelationship::Grandparent),
        "other" => Ok(DependentRelationship::Other),
        other => Err(LoaderError::Conversion(format!(
            "unknown dependent relationship: {other}"
        ))),
    }
}

fn convert_filer_info(dto: FilerInfoDto) -> Result<FilerInfo, LoaderError> {
    let ssn = Ssn::parse(&dto.ssn).map_err(|e| LoaderError::Conversion(e.to_string()))?;
    let date_of_birth = parse_date(&dto.date_of_birth)?;

    Ok(FilerInfo {
        first_name: dto.first_name,
        last_name: dto.last_name,
        ssn,
        date_of_birth,
        is_blind: dto.is_blind,
        is_dependent: dto.is_dependent,
    })
}

fn convert_w2(dto: W2IncomeDto) -> Result<W2Income, LoaderError> {
    let recipient = parse_recipient(&dto.recipient, "W-2")?;

    Ok(W2Income {
        recipient,
        employer_name: dto.employer_name,
        employer_ein: dto.employer_ein,
        wages: dto.wages,
        federal_tax_withheld: dto.federal_tax_withheld,
        state_tax_withheld: dto.state_tax_withheld,
        social_security_wages: dto.social_security_wages,
        social_security_tax_withheld: dto.social_security_tax_withheld,
        medicare_wages: dto.medicare_wages,
        medicare_tax_withheld: dto.medicare_tax_withheld,
    })
}

fn convert_interest(dto: InterestIncomeDto) -> Result<InterestIncome, LoaderError> {
    let recipient = parse_recipient(&dto.recipient, "1099-INT")?;

    Ok(InterestIncome {
        recipient,
        payer_name: dto.payer_name,
        taxable_interest: dto.taxable_interest,
        tax_exempt_interest: dto.tax_exempt_interest,
    })
}

fn convert_dividend(dto: DividendIncomeDto) -> Result<DividendIncome, LoaderError> {
    let recipient = parse_recipient(&dto.recipient, "1099-DIV")?;

    Ok(DividendIncome {
        recipient,
        payer_name: dto.payer_name,
        ordinary_dividends: dto.ordinary_dividends,
        qualified_dividends: dto.qualified_dividends,
    })
}

fn convert_social_security(
    dto: SocialSecurityIncomeDto,
) -> Result<SocialSecurityIncome, LoaderError> {
    let recipient = parse_recipient(&dto.recipient, "SSA-1099")?;

    Ok(SocialSecurityIncome {
        recipient,
        total_benefits: dto.total_benefits,
        voluntary_withholding: dto.voluntary_withholding,
    })
}

fn convert_adjustments(dto: AdjustmentsDto) -> IncomeAdjustments {
    IncomeAdjustments {
        traditional_ira_deduction: dto.traditional_ira_deduction,
        hsa_deduction: dto.hsa_deduction,
        student_loan_interest_paid: dto.student_loan_interest_paid,
    }
}

fn parse_recipient(input: &str, source: &str) -> Result<FilerRole, LoaderError> {
    match input {
        "primary" => Ok(FilerRole::Primary),
        "spouse" => Ok(FilerRole::Spouse),
        other => Err(LoaderError::Conversion(format!(
            "invalid {source} recipient: {other}"
        ))),
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    use rust_decimal::Decimal;

    #[test]
    fn rejects_unknown_input_fields() {
        let json = r#"
        {
          "input": {
            "tax_year": 2025,
            "filing_status": "single",
            "primary_filer": {
              "first_name": "Test",
              "last_name": "Filer",
              "ssn": "400-01-0001",
              "date_of_birth": "1990-06-15",
              "is_blind": false,
              "is_dependent": false,
              "middle_name": "Unexpected"
            },
            "spouse": null,
            "w2_income": []
          }
        }
        "#;

        let error = match load_tax_facts(json) {
            Ok(_) => panic!("unexpectedly accepted unknown input field"),
            Err(error) => error,
        };
        assert!(matches!(error, LoaderError::JsonParse(_)));
    }

    #[test]
    fn accepts_omitted_w2_income() {
        let json = r#"
        {
          "input": {
            "tax_year": 2025,
            "filing_status": "single",
            "primary_filer": {
              "first_name": "Test",
              "last_name": "Filer",
              "ssn": "400-01-0001",
              "date_of_birth": "1990-06-15",
              "is_blind": false,
              "is_dependent": false
            },
            "spouse": null,
            "interest_income": [{
              "recipient": "primary",
              "payer_name": "Test Bank",
              "taxable_interest": 100,
              "tax_exempt_interest": 0
            }]
          }
        }
        "#;

        let facts = load_tax_facts(json).expect("should accept input without w2_income");
        assert!(facts.w2_income.is_empty());
        assert_eq!(facts.interest_income.len(), 1);
    }

    #[test]
    fn accepts_omitted_interest_payer_name() {
        let json = r#"
        {
          "input": {
            "tax_year": 2025,
            "filing_status": "single",
            "primary_filer": {
              "first_name": "Test",
              "last_name": "Filer",
              "ssn": "400-01-0001",
              "date_of_birth": "1990-06-15",
              "is_blind": false,
              "is_dependent": false
            },
            "spouse": null,
            "interest_income": [{
              "recipient": "primary",
              "taxable_interest": 100,
              "tax_exempt_interest": 0
            }]
          }
        }
        "#;

        let facts = load_tax_facts(json).expect("should accept interest input without payer_name");
        assert_eq!(facts.interest_income.len(), 1);
        assert!(facts.interest_income[0].payer_name.is_empty());
    }

    #[test]
    fn accepts_omitted_dividend_payer_name() {
        let json = r#"
        {
          "input": {
            "tax_year": 2025,
            "filing_status": "single",
            "primary_filer": {
              "first_name": "Test",
              "last_name": "Filer",
              "ssn": "400-01-0001",
              "date_of_birth": "1990-06-15",
              "is_blind": false,
              "is_dependent": false
            },
            "spouse": null,
            "dividend_income": [{
              "recipient": "primary",
              "ordinary_dividends": 100,
              "qualified_dividends": 50
            }]
          }
        }
        "#;

        let facts = load_tax_facts(json).expect("should accept dividend input without payer_name");
        assert_eq!(facts.dividend_income.len(), 1);
        assert!(facts.dividend_income[0].payer_name.is_empty());
    }

    #[test]
    fn accepts_omitted_adjustments() {
        let json = r#"
        {
          "input": {
            "tax_year": 2025,
            "filing_status": "single",
            "primary_filer": {
              "first_name": "Test",
              "last_name": "Filer",
              "ssn": "400-01-0001",
              "date_of_birth": "1990-06-15",
              "is_blind": false,
              "is_dependent": false
            },
            "spouse": null,
            "w2_income": [{
              "recipient": "primary",
              "employer_name": "Test Corp",
              "employer_ein": "12-3456789",
              "wages": 60000,
              "federal_tax_withheld": 8000,
              "state_tax_withheld": 0,
              "social_security_wages": 60000,
              "social_security_tax_withheld": 3720,
              "medicare_wages": 60000,
              "medicare_tax_withheld": 870
            }]
          }
        }
        "#;

        let facts = load_tax_facts(json).expect("should accept input without adjustments");
        assert_eq!(facts.adjustments.traditional_ira_deduction, Decimal::ZERO);
        assert_eq!(facts.adjustments.hsa_deduction, Decimal::ZERO);
        assert_eq!(facts.adjustments.student_loan_interest_paid, Decimal::ZERO);
    }
}
