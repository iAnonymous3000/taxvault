use taxvault_core::*;

use crate::dto::{
    DependentDto, DividendIncomeDto, FilerInfoDto, InterestIncomeDto, SocialSecurityIncomeDto,
    TaxFactsDto, TaxFactsInputFile, W2IncomeDto,
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
}
