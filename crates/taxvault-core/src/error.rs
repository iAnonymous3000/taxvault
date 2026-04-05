use thiserror::Error;

#[derive(Debug, Error, PartialEq)]
pub enum ValidationError {
    #[error("invalid date: year={year}, month={month}, day={day}")]
    InvalidDate { year: u16, month: u8, day: u8 },

    #[error("invalid SSN: {reason}")]
    InvalidSsn { reason: String },

    #[error("{field} is required")]
    EmptyRequiredField { field: String },

    #[error("negative monetary amount: {field} = {value}")]
    NegativeAmount { field: String, value: String },

    #[error("federal withholding ({withholding}) exceeds wages ({wages}) on W-2 from {employer}")]
    WithholdingExceedsWages {
        employer: String,
        wages: String,
        withholding: String,
    },

    #[error(
        "Social Security withholding ({withholding}) exceeds Social Security wages ({wages}) on W-2 from {employer}"
    )]
    SocialSecurityWithholdingExceedsWages {
        employer: String,
        wages: String,
        withholding: String,
    },

    #[error(
        "Medicare withholding ({withholding}) exceeds Medicare wages ({wages}) on W-2 from {employer}"
    )]
    MedicareWithholdingExceedsWages {
        employer: String,
        wages: String,
        withholding: String,
    },

    #[error("at least one supported income source is required")]
    NoSupportedIncome,

    #[error("MFJ filing status requires spouse information")]
    MfjMissingSpouse,

    #[error("Single filing status must not include spouse information")]
    SingleHasSpouse,

    #[error("Single filer has W-2 with recipient set to Spouse")]
    SingleFilerSpouseW2,

    #[error("{income_source} has recipient set to Spouse, but spouse income is only allowed for married filing jointly")]
    SpouseIncomeNotAllowed { income_source: String },

    #[error("primary filer and spouse must have different SSNs")]
    DuplicateFilerSsn,

    #[error("Head of Household requires at least one dependent")]
    HohMissingDependent,

    #[error("Head of Household filing status must not include spouse information")]
    HohHasSpouse,

    #[error("months_lived_in_home must be 0-12 for dependent {name}")]
    InvalidMonthsLived { name: String },

    #[error("duplicate SSN for {dependent}: {ssn} is already used by {existing_holder}")]
    DuplicateDependentSsn {
        dependent: String,
        ssn: String,
        existing_holder: String,
    },

    #[error("invalid EIN format: {ein} (expected ##-#######)")]
    InvalidEin { ein: String },

    #[error("{field} exceeds maximum length of {max_length} characters")]
    FieldTooLong { field: String, max_length: usize },

    #[error("qualified dividends ({qualified}) exceed ordinary dividends ({ordinary}) on 1099-DIV from {payer}")]
    QualifiedDividendsExceedOrdinaryDividends {
        payer: String,
        ordinary: String,
        qualified: String,
    },

    #[error(
        "voluntary withholding ({withholding}) exceeds total benefits ({benefits}) on SSA-1099 for {recipient}"
    )]
    SocialSecurityVoluntaryWithholdingExceedsBenefits {
        recipient: String,
        benefits: String,
        withholding: String,
    },
}
