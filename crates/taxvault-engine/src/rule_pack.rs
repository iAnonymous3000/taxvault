use rust_decimal::Decimal;
use taxvault_core::{DateYmd, FilingStatus};

use crate::tax_table::TaxTable;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum TaxTableVerificationStatus {
    Unverified,
    MachineChecked,
    HumanVerified,
}

impl TaxTableVerificationStatus {
    pub fn allows_estimate_compute(self) -> bool {
        matches!(
            self,
            TaxTableVerificationStatus::MachineChecked | TaxTableVerificationStatus::HumanVerified
        )
    }

    pub fn is_human_verified(self) -> bool {
        matches!(self, TaxTableVerificationStatus::HumanVerified)
    }

    pub fn as_str(self) -> &'static str {
        match self {
            TaxTableVerificationStatus::Unverified => "unverified",
            TaxTableVerificationStatus::MachineChecked => "machine_checked",
            TaxTableVerificationStatus::HumanVerified => "human_verified",
        }
    }
}

pub struct RulePack {
    pub meta: RulePackMeta,
    pub standard_deduction: StandardDeductionRules,
    pub student_loan_interest: StudentLoanInterestRules,
    pub qualified_dividends: QualifiedDividendRules,
    pub child_tax_credit: ChildTaxCreditRules,
    pub tax_brackets: TaxBrackets,
    pub tax_table: TaxTable,
    pub social_security: SocialSecurityRules,
    pub medicare: MedicareRules,
    pub age_threshold: DateYmd,
    pub test_vectors: Vec<TestVector>,
}

pub struct RulePackMeta {
    pub tax_year: u16,
    pub jurisdiction: String,
    pub version: String,
    pub effective_date: String,
    pub table_verification_status: TaxTableVerificationStatus,
}

pub struct StudentLoanInterestRules {
    pub max_deduction: Decimal,
    pub phaseout_start_single: Decimal,
    pub phaseout_end_single: Decimal,
    pub phaseout_start_married_filing_jointly: Decimal,
    pub phaseout_end_married_filing_jointly: Decimal,
    pub phaseout_start_head_of_household: Decimal,
    pub phaseout_end_head_of_household: Decimal,
}

impl StudentLoanInterestRules {
    pub fn phaseout_range(&self, status: &FilingStatus) -> (Decimal, Decimal) {
        match status {
            FilingStatus::Single => (self.phaseout_start_single, self.phaseout_end_single),
            FilingStatus::MarriedFilingJointly => (
                self.phaseout_start_married_filing_jointly,
                self.phaseout_end_married_filing_jointly,
            ),
            FilingStatus::HeadOfHousehold => (
                self.phaseout_start_head_of_household,
                self.phaseout_end_head_of_household,
            ),
        }
    }
}

pub struct StandardDeductionRules {
    pub single: Decimal,
    pub married_filing_jointly: Decimal,
    pub head_of_household: Decimal,
    pub additional_age_or_blind_single: Decimal,
    pub additional_age_or_blind_married: Decimal,
}

impl StandardDeductionRules {
    pub fn base_for_status(&self, status: &FilingStatus) -> Decimal {
        match status {
            FilingStatus::Single => self.single,
            FilingStatus::MarriedFilingJointly => self.married_filing_jointly,
            FilingStatus::HeadOfHousehold => self.head_of_household,
        }
    }

    pub fn additional_per_qualifier(&self, status: &FilingStatus) -> Decimal {
        match status {
            FilingStatus::Single | FilingStatus::HeadOfHousehold => {
                self.additional_age_or_blind_single
            }
            FilingStatus::MarriedFilingJointly => self.additional_age_or_blind_married,
        }
    }
}

pub struct QualifiedDividendRules {
    pub zero_rate_threshold_single: Decimal,
    pub zero_rate_threshold_married_filing_jointly: Decimal,
    pub zero_rate_threshold_head_of_household: Decimal,
    pub fifteen_rate_threshold_single: Decimal,
    pub fifteen_rate_threshold_married_filing_jointly: Decimal,
    pub fifteen_rate_threshold_head_of_household: Decimal,
}

impl QualifiedDividendRules {
    pub fn zero_rate_threshold(&self, status: &FilingStatus) -> Decimal {
        match status {
            FilingStatus::Single => self.zero_rate_threshold_single,
            FilingStatus::MarriedFilingJointly => self.zero_rate_threshold_married_filing_jointly,
            FilingStatus::HeadOfHousehold => self.zero_rate_threshold_head_of_household,
        }
    }

    pub fn fifteen_rate_threshold(&self, status: &FilingStatus) -> Decimal {
        match status {
            FilingStatus::Single => self.fifteen_rate_threshold_single,
            FilingStatus::MarriedFilingJointly => {
                self.fifteen_rate_threshold_married_filing_jointly
            }
            FilingStatus::HeadOfHousehold => self.fifteen_rate_threshold_head_of_household,
        }
    }
}

pub struct ChildTaxCreditRules {
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

impl ChildTaxCreditRules {
    pub fn phaseout_threshold(&self, status: &FilingStatus) -> Decimal {
        match status {
            FilingStatus::MarriedFilingJointly => self.phaseout_threshold_married_filing_jointly,
            FilingStatus::Single | FilingStatus::HeadOfHousehold => self.phaseout_threshold_other,
        }
    }
}

#[derive(Clone, Debug)]
pub struct TaxBracket {
    pub min: Decimal,
    pub max: Option<Decimal>,
    pub rate: Decimal,
}

pub struct TaxBrackets {
    pub single: Vec<TaxBracket>,
    pub married_filing_jointly: Vec<TaxBracket>,
    pub head_of_household: Vec<TaxBracket>,
}

impl TaxBrackets {
    pub fn for_status(&self, status: &FilingStatus) -> &[TaxBracket] {
        match status {
            FilingStatus::Single => &self.single,
            FilingStatus::MarriedFilingJointly => &self.married_filing_jointly,
            FilingStatus::HeadOfHousehold => &self.head_of_household,
        }
    }
}

pub struct SocialSecurityRules {
    pub wage_base: Decimal,
    pub tax_rate: Decimal,
    pub benefits_50_threshold_single: Decimal,
    pub benefits_50_threshold_married_filing_jointly: Decimal,
    pub benefits_50_threshold_head_of_household: Decimal,
    pub benefits_85_threshold_single: Decimal,
    pub benefits_85_threshold_married_filing_jointly: Decimal,
    pub benefits_85_threshold_head_of_household: Decimal,
}

impl SocialSecurityRules {
    pub fn benefits_50_threshold(&self, status: &FilingStatus) -> Decimal {
        match status {
            FilingStatus::Single => self.benefits_50_threshold_single,
            FilingStatus::MarriedFilingJointly => self.benefits_50_threshold_married_filing_jointly,
            FilingStatus::HeadOfHousehold => self.benefits_50_threshold_head_of_household,
        }
    }

    pub fn benefits_85_threshold(&self, status: &FilingStatus) -> Decimal {
        match status {
            FilingStatus::Single => self.benefits_85_threshold_single,
            FilingStatus::MarriedFilingJointly => self.benefits_85_threshold_married_filing_jointly,
            FilingStatus::HeadOfHousehold => self.benefits_85_threshold_head_of_household,
        }
    }
}

pub struct MedicareRules {
    pub tax_rate: Decimal,
    pub additional_rate: Decimal,
    pub additional_threshold_single: Decimal,
    pub additional_threshold_mfj: Decimal,
    pub additional_threshold_hoh: Decimal,
    pub employer_withholding_threshold: Decimal,
}

impl MedicareRules {
    pub fn threshold_for_status(&self, status: &FilingStatus) -> Decimal {
        match status {
            FilingStatus::Single => self.additional_threshold_single,
            FilingStatus::MarriedFilingJointly => self.additional_threshold_mfj,
            FilingStatus::HeadOfHousehold => self.additional_threshold_hoh,
        }
    }
}

pub struct TestVector {
    pub description: String,
    pub filing_status: FilingStatus,
    pub total_wages: Decimal,
    pub federal_withholding: Decimal,
    pub expected_agi: Decimal,
    pub expected_taxable_income: Decimal,
    pub expected_tax: Decimal,
}
