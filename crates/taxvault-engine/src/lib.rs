mod bracket;
mod compute;
mod error;
mod policy;
mod rule_pack;
mod tax_table;
pub mod trace;

pub use compute::{
    compute, is_qualifying_child_for_child_tax_credit, ComputeOptions, ComputedReturn,
};
pub use error::{ComputeError, PolicyError};
pub use policy::validate_supported_slice;
pub use rule_pack::{
    ChildTaxCreditRules, MedicareRules, QualifiedDividendRules, RulePack, RulePackMeta,
    SocialSecurityRules, StandardDeductionRules, StudentLoanInterestRules, TaxBracket, TaxBrackets,
    TaxTableVerificationStatus, TestVector,
};
pub use tax_table::{TaxTable, TaxTableRow};
pub use trace::{CalculationTrace, TraceNode, TraceNodeId};
