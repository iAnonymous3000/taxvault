use std::sync::OnceLock;

use rust_decimal::Decimal;
use serde::Serialize;
use taxvault_core::{Dependent, DependentRelationship, FilingStatus, TaxFacts};
use wasm_bindgen::prelude::*;

use taxvault_engine::{
    compute, validate_supported_slice, ComputeOptions, RulePack, TaxTableVerificationStatus,
};
use taxvault_forms::{compile_1040, FormLineMap};
use taxvault_loader::{load_rule_pack, load_tax_facts};

const RULES_TOML: &str = include_str!("../../../rules/federal_2025.toml");
const TAX_TABLE_CSV: &str = include_str!("../../../tax-table/federal_2025_table.csv");
static EMBEDDED_RULE_PACK: OnceLock<Result<RulePack, String>> = OnceLock::new();

#[derive(Serialize)]
struct WasmResult {
    success: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    summary: Option<TaxSummary>,
    #[serde(skip_serializing_if = "Option::is_none")]
    form: Option<FormLineMap>,
    #[serde(skip_serializing_if = "Option::is_none")]
    meta: Option<EstimateMeta>,
    #[serde(skip_serializing_if = "Option::is_none")]
    trace: Option<String>,
}

#[derive(Serialize)]
struct TaxSummary {
    tax_year: u16,
    filing_status: String,
    total_wages: String,
    total_taxable_interest: String,
    total_tax_exempt_interest: String,
    total_ordinary_dividends: String,
    total_qualified_dividends: String,
    total_social_security_benefits: String,
    taxable_social_security_benefits: String,
    total_income: String,
    traditional_ira_deduction: String,
    hsa_deduction: String,
    student_loan_interest_deduction: String,
    total_adjustments: String,
    adjusted_gross_income: String,
    standard_deduction: String,
    total_deductions: String,
    taxable_income: String,
    income_tax: String,
    child_dependent_credit: String,
    additional_child_tax_credit: String,
    total_w2_federal_withholding: String,
    total_social_security_withholding: String,
    total_tax: String,
    total_federal_withholding: String,
    total_payments: String,
    balance_due: String,
    overpayment: String,
}

#[derive(Serialize)]
struct EstimateMeta {
    rule_pack_version: String,
    tax_table_verification_status: String,
    tax_table_local_estimate_ready: bool,
    tax_table_human_verified: bool,
    estimate_scope: String,
    privacy: String,
    scope_limits: Vec<String>,
}

#[derive(Debug, Serialize)]
struct InputReview {
    ready_for_estimate: bool,
    status: String,
    summary: String,
    blocking_issues: Vec<String>,
    cautions: Vec<String>,
}

fn decimal_str(d: Decimal) -> String {
    d.round_dp(2).to_string()
}

#[wasm_bindgen]
pub fn compute_tax(json_input: &str) -> String {
    let result = compute_tax_inner(json_input);
    serialize_response(&result)
}

#[wasm_bindgen]
pub fn review_tax_input(json_input: &str) -> String {
    let review = review_tax_input_inner(json_input);
    serialize_response(&review)
}

fn compute_tax_inner(json_input: &str) -> WasmResult {
    // Load rule pack (embedded)
    let rules = match embedded_rule_pack() {
        Ok(rules) => rules,
        Err(error) => {
            return WasmResult {
                success: false,
                error: Some(format!("Rule pack error: {error}")),
                summary: None,
                form: None,
                meta: None,
                trace: None,
            }
        }
    };

    // Parse input
    let facts = match load_tax_facts(json_input) {
        Ok(f) => f,
        Err(e) => {
            return WasmResult {
                success: false,
                error: Some(format!("Input error: {e}")),
                summary: None,
                form: None,
                meta: None,
                trace: None,
            }
        }
    };

    // Structural validation
    if let Err(errs) = facts.validate_structure() {
        let msgs: Vec<String> = errs.iter().map(|e| e.to_string()).collect();
        return WasmResult {
            success: false,
            error: Some(format_error_list("Please fix these input issues:", &msgs)),
            summary: None,
            form: None,
            meta: None,
            trace: None,
        };
    }

    // Policy validation
    if let Err(errs) = validate_supported_slice(&facts, rules) {
        let msgs: Vec<String> = errs.iter().map(|e| e.to_string()).collect();
        return WasmResult {
            success: false,
            error: Some(format_error_list(
                "This return is outside TaxVault's supported estimate slice:",
                &msgs,
            )),
            summary: None,
            form: None,
            meta: None,
            trace: None,
        };
    }

    if !rules
        .meta
        .table_verification_status
        .allows_estimate_compute()
    {
        return WasmResult {
            success: false,
            error: Some(
                "TaxVault is locked because the embedded 2025 federal tax table is still unverified. Mark it machine_checked for local/private estimates or human_verified for public-release signoff."
                    .into(),
            ),
            summary: None,
            form: None,
            meta: None,
            trace: None,
        };
    }

    // Fail closed if a future embedded tax table is neither machine-checked nor human-verified.
    let options = ComputeOptions::default();
    let result = match compute(&facts, rules, &options) {
        Ok(r) => r,
        Err(e) => {
            return WasmResult {
                success: false,
                error: Some(format!("Computation error: {e}")),
                summary: None,
                form: None,
                meta: None,
                trace: None,
            }
        }
    };

    // Form compilation
    let form = compile_1040(&result);
    let trace = result.trace.display_tree();

    let summary = TaxSummary {
        tax_year: result.tax_year,
        filing_status: format!("{:?}", result.filing_status),
        total_wages: decimal_str(result.total_wages),
        total_taxable_interest: decimal_str(result.total_taxable_interest),
        total_tax_exempt_interest: decimal_str(result.total_tax_exempt_interest),
        total_ordinary_dividends: decimal_str(result.total_ordinary_dividends),
        total_qualified_dividends: decimal_str(result.total_qualified_dividends),
        total_social_security_benefits: decimal_str(result.total_social_security_benefits),
        taxable_social_security_benefits: decimal_str(result.taxable_social_security_benefits),
        total_income: decimal_str(result.total_income),
        traditional_ira_deduction: decimal_str(result.traditional_ira_deduction),
        hsa_deduction: decimal_str(result.hsa_deduction),
        student_loan_interest_deduction: decimal_str(result.student_loan_interest_deduction),
        total_adjustments: decimal_str(result.total_adjustments),
        adjusted_gross_income: decimal_str(result.adjusted_gross_income),
        standard_deduction: decimal_str(result.standard_deduction),
        total_deductions: decimal_str(result.total_deductions),
        taxable_income: decimal_str(result.taxable_income),
        income_tax: decimal_str(result.income_tax),
        child_dependent_credit: decimal_str(result.child_dependent_credit),
        additional_child_tax_credit: decimal_str(result.additional_child_tax_credit),
        total_w2_federal_withholding: decimal_str(result.total_w2_federal_withholding),
        total_social_security_withholding: decimal_str(result.total_social_security_withholding),
        total_tax: decimal_str(result.total_tax),
        total_federal_withholding: decimal_str(result.total_federal_withholding),
        total_payments: decimal_str(result.total_payments),
        balance_due: decimal_str(result.balance_due),
        overpayment: decimal_str(result.overpayment),
    };
    let mut scope_limits = vec![
        "Not a filing product, signed return, or payment recommendation.".into(),
        "Does not support EIC, itemized deductions, pensions, IRA distributions, Schedule C, capital gains schedules, ACA credits, or most other federal schedules."
            .into(),
        "Traditional IRA and HSA deductions are applied exactly as entered. TaxVault does not verify employer-plan coverage, HDHP eligibility, annual limits, or excess contributions.".into(),
        "Head of Household and dependency qualification rules are not fully verified by the app.".into(),
    ];

    if !rules.meta.table_verification_status.is_human_verified() {
        scope_limits.push(
            "The embedded 2025 federal tax table is machine-checked, not human-verified. Treat this build as local/private estimate software only."
                .into(),
        );
    }

    let meta = EstimateMeta {
        rule_pack_version: result.rule_pack_version.clone(),
        tax_table_verification_status: rules.meta.table_verification_status.as_str().into(),
        tax_table_local_estimate_ready: rules.meta.table_verification_status.allows_estimate_compute(),
        tax_table_human_verified: rules.meta.table_verification_status.is_human_verified(),
        estimate_scope:
            "Narrow 2025 federal estimate for supported W-2, SSA-1099, 1099-INT, 1099-DIV, and limited above-the-line deduction scenarios only."
                .into(),
        privacy: "Runs entirely in your browser. Entered tax data stays on this page unless you choose to share it elsewhere."
            .into(),
        scope_limits,
    };

    WasmResult {
        success: true,
        error: None,
        summary: Some(summary),
        form: Some(form),
        meta: Some(meta),
        trace: Some(trace),
    }
}

fn format_error_list(prefix: &str, messages: &[String]) -> String {
    if messages.is_empty() {
        prefix.to_string()
    } else {
        format!("{prefix}\n- {}", messages.join("\n- "))
    }
}

fn review_tax_input_inner(json_input: &str) -> InputReview {
    let rules = match embedded_rule_pack() {
        Ok(rules) => rules,
        Err(error) => {
            return InputReview {
                ready_for_estimate: false,
                status: "attention".into(),
                summary: "TaxVault could not load its embedded 2025 rules.".into(),
                blocking_issues: vec![format!("Rule pack error: {error}")],
                cautions: vec![],
            };
        }
    };

    let facts = match load_tax_facts(json_input) {
        Ok(facts) => facts,
        Err(error) => {
            return InputReview {
                ready_for_estimate: false,
                status: "attention".into(),
                summary: "Finish the required fields so TaxVault can review this draft.".into(),
                blocking_issues: vec![format!("Input error: {error}")],
                cautions: vec![],
            };
        }
    };

    let mut cautions = collect_input_cautions(&facts);

    if let Err(errors) = facts.validate_structure() {
        return InputReview {
            ready_for_estimate: false,
            status: "attention".into(),
            summary: "Finish the items below before calculating.".into(),
            blocking_issues: errors.iter().map(ToString::to_string).collect(),
            cautions,
        };
    }

    if let Err(errors) = validate_supported_slice(&facts, rules) {
        return InputReview {
            ready_for_estimate: false,
            status: "unsupported".into(),
            summary: "This draft is outside TaxVault's current supported estimate slice.".into(),
            blocking_issues: errors.iter().map(ToString::to_string).collect(),
            cautions,
        };
    }

    if !rules
        .meta
        .table_verification_status
        .allows_estimate_compute()
    {
        return InputReview {
            ready_for_estimate: false,
            status: "attention".into(),
            summary:
                "TaxVault reviewed the draft, but estimate calculations stay locked until the embedded 2025 tax table is at least machine-checked."
                    .into(),
            blocking_issues: vec![
                "Embedded 2025 federal tax table is still marked unverified. Mark it machine_checked for local/private estimates or human_verified before any public release."
                    .into(),
            ],
            cautions,
        };
    }

    if rules.meta.table_verification_status == TaxTableVerificationStatus::MachineChecked {
        push_unique(
            &mut cautions,
            "The embedded 2025 federal tax table is machine-checked, not human-verified. This build is suitable for local/private estimates, not public-release signoff.",
        );
    }

    let summary = if rules.meta.table_verification_status
        == TaxTableVerificationStatus::MachineChecked
    {
        "This draft fits TaxVault's current supported estimate slice. The embedded tax table is machine-checked for local/private estimate use.".into()
    } else if cautions.is_empty() {
        "This draft fits TaxVault's current supported estimate slice.".into()
    } else {
        "This draft fits the supported slice, but it still needs the manual checks below.".into()
    };

    InputReview {
        ready_for_estimate: true,
        status: "ready".into(),
        summary,
        blocking_issues: vec![],
        cautions,
    }
}

fn collect_input_cautions(facts: &TaxFacts) -> Vec<String> {
    let mut cautions = Vec::new();

    if facts.filing_status == FilingStatus::HeadOfHousehold {
        push_unique(
            &mut cautions,
            "Head of Household is still a manual determination. TaxVault does not verify keeping-up-a-home, residency, or qualifying person rules.",
        );
    }

    if facts
        .dependents
        .iter()
        .any(|dependent| dependent.months_lived_in_home <= 6)
    {
        push_unique(
            &mut cautions,
            "A dependent who lived in the home 6 months or less will not be treated as a qualifying child for the Child Tax Credit in this estimate.",
        );
    }

    if facts
        .dependents
        .iter()
        .any(|dependent| !is_potential_child_tax_credit_child(dependent, facts.tax_year))
    {
        push_unique(
            &mut cautions,
            "One or more dependents may only qualify for the $500 Credit for Other Dependents, or may require manual eligibility review before relying on this estimate.",
        );
    }

    if facts.filing_status == FilingStatus::HeadOfHousehold
        && facts.dependents.iter().any(|dependent| {
            matches!(
                dependent.relationship,
                DependentRelationship::Parent
                    | DependentRelationship::Grandparent
                    | DependentRelationship::Other
            )
        })
    {
        push_unique(
            &mut cautions,
            "A parent, grandparent, or 'other' dependent does not automatically establish Head of Household. Support and household rules still need manual review.",
        );
    }

    if facts.adjustments.traditional_ira_deduction > Decimal::ZERO
        || facts.adjustments.hsa_deduction > Decimal::ZERO
    {
        push_unique(
            &mut cautions,
            "Traditional IRA and HSA deductions are applied exactly as entered. TaxVault does not verify employer-plan coverage, HDHP eligibility, annual limits, or excess contributions.",
        );
    }

    cautions
}

fn is_potential_child_tax_credit_child(dependent: &Dependent, tax_year: u16) -> bool {
    matches!(
        dependent.relationship,
        DependentRelationship::Son
            | DependentRelationship::Daughter
            | DependentRelationship::Stepchild
            | DependentRelationship::FosterChild
            | DependentRelationship::Sibling
            | DependentRelationship::StepSibling
            | DependentRelationship::HalfSibling
            | DependentRelationship::Grandchild
            | DependentRelationship::Niece
            | DependentRelationship::Nephew
    ) && dependent.months_lived_in_home > 6
        && (
            dependent.date_of_birth.year(),
            dependent.date_of_birth.month(),
            dependent.date_of_birth.day(),
        ) > (tax_year.saturating_sub(17), 12, 31)
}

fn push_unique(items: &mut Vec<String>, message: &str) {
    if !items.iter().any(|item| item == message) {
        items.push(message.to_string());
    }
}

fn serialize_response<T: Serialize>(value: &T) -> String {
    serde_json::to_string(value).unwrap_or_else(|error| serialize_fallback_error(&error))
}

fn serialize_fallback_error(error: &serde_json::Error) -> String {
    serde_json::json!({
        "success": false,
        "error": format!("serialization error: {error}"),
    })
    .to_string()
}

fn embedded_rule_pack() -> Result<&'static RulePack, String> {
    match EMBEDDED_RULE_PACK
        .get_or_init(|| load_rule_pack(RULES_TOML, TAX_TABLE_CSV).map_err(|e| e.to_string()))
    {
        Ok(rule_pack) => Ok(rule_pack),
        Err(error) => Err(error.clone()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn compute_tax_succeeds_when_embedded_table_allows_local_estimates() {
        let json = include_str!("../../../tests/golden_vectors/single_w2_60k.json");
        let result = compute_tax_inner(json);

        assert!(result.success);
        assert!(result.error.is_none());
        assert!(result.summary.is_some());
        assert!(result.form.is_some());
        assert!(result.meta.is_some());
        assert!(result.trace.is_some());
    }

    #[test]
    fn embedded_rule_pack_allows_local_estimates() {
        let rules = embedded_rule_pack().expect("embedded rule pack should load");
        assert!(rules
            .meta
            .table_verification_status
            .allows_estimate_compute());
    }

    #[test]
    fn review_tax_input_reports_ready_for_supported_case_when_table_allows_local_use() {
        let json = include_str!("../../../tests/golden_vectors/single_w2_60k.json");

        let review = review_tax_input_inner(json);
        assert!(review.ready_for_estimate);
        assert_eq!(review.status, "ready");
        assert!(review.blocking_issues.is_empty());
    }

    #[test]
    fn compute_tax_reports_validation_errors() {
        let json = r#"
        {
          "input": {
            "tax_year": 2025,
            "filing_status": "single",
            "primary_filer": {
              "first_name": "   ",
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

        let result = compute_tax_inner(json);
        assert!(!result.success);
        assert!(result
            .error
            .as_deref()
            .is_some_and(|error| error.contains("primary filer first name is required")));
    }

    #[test]
    fn fallback_serialization_error_is_valid_json() {
        let error = serde_json::from_str::<serde_json::Value>("not json").unwrap_err();
        let payload = serialize_fallback_error(&error);
        let parsed: serde_json::Value =
            serde_json::from_str(&payload).expect("fallback should stay valid JSON");

        assert_eq!(parsed["success"], serde_json::Value::Bool(false));
        assert!(parsed["error"]
            .as_str()
            .is_some_and(|message| message.contains("serialization error")));
    }

    #[test]
    fn review_tax_input_reports_unsupported_case() {
        let json = r#"
        {
          "input": {
            "tax_year": 2025,
            "filing_status": "single",
            "primary_filer": {
              "first_name": "Alex",
              "last_name": "Filer",
              "ssn": "400-01-0001",
              "date_of_birth": "1990-06-15",
              "is_blind": false,
              "is_dependent": false
            },
            "spouse": null,
            "w2_income": [{
              "recipient": "primary",
              "employer_name": "Northwind Co",
              "employer_ein": "12-3456789",
              "wages": 210000,
              "federal_tax_withheld": 42000,
              "state_tax_withheld": 0,
              "social_security_wages": 176100,
              "social_security_tax_withheld": 10918.2,
              "medicare_wages": 210000,
              "medicare_tax_withheld": 3045
            }]
          }
        }
        "#;

        let review = review_tax_input_inner(json);
        assert!(!review.ready_for_estimate);
        assert_eq!(review.status, "unsupported");
        assert!(review
            .blocking_issues
            .iter()
            .any(|issue| issue.contains("Additional Medicare Tax")));
    }

    #[test]
    fn review_tax_input_surfaces_hoh_and_dependent_cautions_when_estimates_are_allowed() {
        let json = r#"
        {
          "input": {
            "tax_year": 2025,
            "filing_status": "head_of_household",
            "primary_filer": {
              "first_name": "Alex",
              "last_name": "Filer",
              "ssn": "400-01-0001",
              "date_of_birth": "1990-06-15",
              "is_blind": false,
              "is_dependent": false
            },
            "spouse": null,
            "dependents": [{
              "first_name": "Pat",
              "last_name": "Filer",
              "ssn": "400-02-0002",
              "date_of_birth": "1950-06-15",
              "relationship": "parent",
              "months_lived_in_home": 12
            }],
            "w2_income": [{
              "recipient": "primary",
              "employer_name": "Northwind Co",
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

        let review = review_tax_input_inner(json);
        assert!(review.ready_for_estimate);
        assert_eq!(review.status, "ready");
        assert!(review
            .cautions
            .iter()
            .any(|caution| caution.contains("Head of Household is still a manual determination")));
        assert!(review
            .cautions
            .iter()
            .any(|caution| caution.contains("does not automatically establish Head of Household")));
    }

    #[test]
    fn compute_tax_still_accepts_blank_optional_1099_payer_names_before_compute() {
        let json = r#"
        {
          "input": {
            "tax_year": 2025,
            "filing_status": "single",
            "primary_filer": {
              "first_name": "Alex",
              "last_name": "Filer",
              "ssn": "400-01-0001",
              "date_of_birth": "1990-06-15",
              "is_blind": false,
              "is_dependent": false
            },
            "spouse": null,
            "w2_income": [{
              "recipient": "primary",
              "employer_name": "Northwind Co",
              "employer_ein": "12-3456789",
              "wages": 150000,
              "federal_tax_withheld": 26000,
              "state_tax_withheld": 0,
              "social_security_wages": 150000,
              "social_security_tax_withheld": 9300,
              "medicare_wages": 150000,
              "medicare_tax_withheld": 2175
            }],
            "interest_income": [{
              "recipient": "primary",
              "payer_name": "   ",
              "taxable_interest": 125,
              "tax_exempt_interest": 0
            }],
            "dividend_income": [{
              "recipient": "primary",
              "payer_name": "",
              "ordinary_dividends": 200,
              "qualified_dividends": 100
            }]
          }
        }
        "#;

        let result = compute_tax_inner(json);
        assert!(result.success);
        assert!(result.error.is_none());
        assert!(result.summary.is_some());
    }
}
