use rust_decimal::Decimal;
use serde::Deserialize;

// ---- Tax Facts DTOs ----

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct TaxFactsInputFile {
    pub metadata: Option<serde_json::Value>,
    pub input: TaxFactsDto,
    pub expected: Option<serde_json::Value>,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct TaxFactsDto {
    pub tax_year: u16,
    pub filing_status: String,
    pub primary_filer: FilerInfoDto,
    pub spouse: Option<FilerInfoDto>,
    pub dependents: Option<Vec<DependentDto>>,
    pub w2_income: Option<Vec<W2IncomeDto>>,
    pub interest_income: Option<Vec<InterestIncomeDto>>,
    pub dividend_income: Option<Vec<DividendIncomeDto>>,
    pub social_security_income: Option<Vec<SocialSecurityIncomeDto>>,
    pub adjustments: Option<AdjustmentsDto>,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct DependentDto {
    pub first_name: String,
    pub last_name: String,
    pub ssn: String,
    pub date_of_birth: String,
    pub relationship: String,
    pub months_lived_in_home: u8,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct FilerInfoDto {
    pub first_name: String,
    pub last_name: String,
    pub ssn: String,
    pub date_of_birth: String,
    pub is_blind: bool,
    pub is_dependent: bool,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct W2IncomeDto {
    pub recipient: String,
    pub employer_name: String,
    pub employer_ein: String,
    pub wages: Decimal,
    pub federal_tax_withheld: Decimal,
    pub state_tax_withheld: Decimal,
    pub social_security_wages: Decimal,
    pub social_security_tax_withheld: Decimal,
    pub medicare_wages: Decimal,
    pub medicare_tax_withheld: Decimal,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct InterestIncomeDto {
    pub recipient: String,
    #[serde(default)]
    pub payer_name: String,
    pub taxable_interest: Decimal,
    pub tax_exempt_interest: Decimal,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct DividendIncomeDto {
    pub recipient: String,
    #[serde(default)]
    pub payer_name: String,
    pub ordinary_dividends: Decimal,
    pub qualified_dividends: Decimal,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SocialSecurityIncomeDto {
    pub recipient: String,
    pub total_benefits: Decimal,
    pub voluntary_withholding: Decimal,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct AdjustmentsDto {
    #[serde(default)]
    pub traditional_ira_deduction: Decimal,
    #[serde(default)]
    pub hsa_deduction: Decimal,
    #[serde(default)]
    pub student_loan_interest_paid: Decimal,
}

// ---- Rule Pack DTOs ----

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RulePackDto {
    pub meta: RulePackMetaDto,
    pub standard_deduction: StandardDeductionDto,
    pub student_loan_interest: StudentLoanInterestDto,
    pub qualified_dividends: QualifiedDividendsDto,
    pub child_tax_credit: ChildTaxCreditDto,
    pub tax_brackets: TaxBracketsDto,
    pub social_security: SocialSecurityDto,
    pub medicare: MedicareDto,
    pub age_threshold: String,
    pub test_vectors: Option<Vec<TestVectorDto>>,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RulePackMetaDto {
    pub tax_year: u16,
    pub jurisdiction: String,
    pub version: String,
    pub effective_date: String,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct StandardDeductionDto {
    pub single: Decimal,
    pub married_filing_jointly: Decimal,
    pub head_of_household: Decimal,
    pub additional_age_or_blind_single: Decimal,
    pub additional_age_or_blind_married: Decimal,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct QualifiedDividendsDto {
    pub zero_rate_threshold_single: Decimal,
    pub zero_rate_threshold_married_filing_jointly: Decimal,
    pub zero_rate_threshold_head_of_household: Decimal,
    pub fifteen_rate_threshold_single: Decimal,
    pub fifteen_rate_threshold_married_filing_jointly: Decimal,
    pub fifteen_rate_threshold_head_of_household: Decimal,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct StudentLoanInterestDto {
    pub max_deduction: Decimal,
    pub phaseout_start_single: Decimal,
    pub phaseout_end_single: Decimal,
    pub phaseout_start_married_filing_jointly: Decimal,
    pub phaseout_end_married_filing_jointly: Decimal,
    pub phaseout_start_head_of_household: Decimal,
    pub phaseout_end_head_of_household: Decimal,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ChildTaxCreditDto {
    pub qualifying_child_credit: Decimal,
    pub other_dependent_credit: Decimal,
    pub refundable_credit_per_child: Decimal,
    pub phaseout_threshold_married_filing_jointly: Decimal,
    pub phaseout_threshold_other: Decimal,
    pub phaseout_increment: Decimal,
    pub phaseout_rate: Decimal,
    pub refundable_earned_income_threshold: Decimal,
    pub refundable_withholding_floor: Decimal,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct TaxBracketsDto {
    pub single: Vec<TaxBracketDto>,
    pub married_filing_jointly: Vec<TaxBracketDto>,
    pub head_of_household: Vec<TaxBracketDto>,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct TaxBracketDto {
    pub min: Decimal,
    pub max: Option<Decimal>,
    pub rate: Decimal,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SocialSecurityDto {
    pub wage_base: Decimal,
    pub tax_rate: Decimal,
    pub benefits_50_threshold_single: Decimal,
    pub benefits_50_threshold_married_filing_jointly: Decimal,
    pub benefits_50_threshold_head_of_household: Decimal,
    pub benefits_85_threshold_single: Decimal,
    pub benefits_85_threshold_married_filing_jointly: Decimal,
    pub benefits_85_threshold_head_of_household: Decimal,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct MedicareDto {
    pub tax_rate: Decimal,
    pub additional_rate: Decimal,
    pub additional_threshold_single: Decimal,
    pub additional_threshold_mfj: Decimal,
    pub additional_threshold_hoh: Decimal,
    pub employer_withholding_threshold: Decimal,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct TestVectorDto {
    pub description: String,
    pub filing_status: String,
    pub total_wages: Decimal,
    pub federal_withholding: Decimal,
    pub expected_agi: Decimal,
    pub expected_taxable_income: Decimal,
    pub expected_tax: Decimal,
}
