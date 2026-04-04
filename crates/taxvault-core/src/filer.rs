use crate::date::DateYmd;
use crate::ssn::Ssn;
use rust_decimal::Decimal;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum FilerRole {
    Primary,
    Spouse,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum FilingStatus {
    Single,
    MarriedFilingJointly,
    HeadOfHousehold,
}

pub struct FilerInfo {
    pub first_name: String,
    pub last_name: String,
    pub ssn: Ssn,
    pub date_of_birth: DateYmd,
    pub is_blind: bool,
    pub is_dependent: bool,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum DependentRelationship {
    Son,
    Daughter,
    Stepchild,
    FosterChild,
    Sibling,
    StepSibling,
    HalfSibling,
    Grandchild,
    Niece,
    Nephew,
    Parent,
    Grandparent,
    Other,
}

pub struct Dependent {
    pub first_name: String,
    pub last_name: String,
    pub ssn: Ssn,
    pub date_of_birth: DateYmd,
    pub relationship: DependentRelationship,
    pub months_lived_in_home: u8,
}

pub struct W2Income {
    pub recipient: FilerRole,
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

pub struct InterestIncome {
    pub recipient: FilerRole,
    pub payer_name: String,
    pub taxable_interest: Decimal,
    pub tax_exempt_interest: Decimal,
}

pub struct DividendIncome {
    pub recipient: FilerRole,
    pub payer_name: String,
    pub ordinary_dividends: Decimal,
    pub qualified_dividends: Decimal,
}

pub struct SocialSecurityIncome {
    pub recipient: FilerRole,
    pub total_benefits: Decimal,
    pub voluntary_withholding: Decimal,
}
