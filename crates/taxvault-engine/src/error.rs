use rust_decimal::Decimal;
use thiserror::Error;

#[derive(Debug, Error)]
pub enum PolicyError {
    #[error("tax year mismatch: input has {input}, rule pack has {expected}")]
    TaxYearMismatch { input: u16, expected: u16 },

    #[error("filers who can be claimed as dependents on another return are not yet supported")]
    DependentFilersNotSupported,

    #[error("excess Social Security withholding (Schedule 3) not supported: {role} SS withholding {total_withheld} exceeds supported maximum {max_supported}")]
    ExcessSocialSecurityNotSupported {
        role: String,
        total_withheld: Decimal,
        max_supported: Decimal,
    },

    #[error("Additional Medicare Tax (Form 8959) not supported: {reason}")]
    AdditionalMedicareTaxNotSupported { reason: String },

    #[error("Head of Household scenario not supported for automated estimates: {reason}")]
    HeadOfHouseholdNotSupported { reason: String },

    #[error("Student loan interest deduction not supported for automated estimates: {reason}")]
    StudentLoanInterestNotSupported { reason: String },

    #[error("Traditional IRA deduction estimates are not supported: TaxVault does not collect employer-plan coverage, spousal coverage, or annual contribution-limit details")]
    TraditionalIraDeductionNotSupported,

    #[error("HSA deduction estimates are not supported: TaxVault does not collect HDHP coverage, employer contributions, or excess-contribution details")]
    HsaDeductionNotSupported,
}

#[derive(Debug, Error)]
pub enum ComputeError {
    #[error("Tax Table lookup failed for taxable income {taxable_income}")]
    TaxTableLookupFailed { taxable_income: Decimal },

    #[error("Tax Table is not machine-checked or human-verified; pass allow_unverified_table to override")]
    UnverifiedTaxTable,

    #[error("no tax brackets defined for filing status")]
    NoBracketsForStatus,
}
