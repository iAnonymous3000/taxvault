use std::sync::OnceLock;

use rust_decimal::Decimal;
use serde::Serialize;
use taxvault_core::{DependentRelationship, FilingStatus, TaxFacts};
use wasm_bindgen::prelude::*;

use taxvault_engine::{
    compute, is_qualifying_child_for_child_tax_credit, validate_supported_slice, ComputeOptions,
    RulePack, TaxTableVerificationStatus,
};
use taxvault_forms::{compile_1040, FormLineMap};
use taxvault_loader::{load_rule_pack, load_tax_facts};

struct EmbeddedRulePackSource {
    tax_year: u16,
    rules_toml: &'static str,
    tax_table_csv: &'static str,
}

struct LoadedEmbeddedRulePack {
    tax_year: u16,
    load_result: Result<RulePack, String>,
}

const EMBEDDED_RULE_PACK_SOURCES: &[EmbeddedRulePackSource] = &[EmbeddedRulePackSource {
    tax_year: 2025,
    rules_toml: include_str!("../../../rules/federal_2025.toml"),
    tax_table_csv: include_str!("../../../tax-table/federal_2025_table.csv"),
}];

static EMBEDDED_RULE_PACKS: OnceLock<Vec<LoadedEmbeddedRulePack>> = OnceLock::new();

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

impl WasmResult {
    fn err(message: impl Into<String>) -> Self {
        Self {
            success: false,
            error: Some(message.into()),
            summary: None,
            form: None,
            meta: None,
            trace: None,
        }
    }
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
    estimated_tax_payments: String,
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

#[derive(Serialize)]
struct AppConfig {
    default_tax_year: u16,
    supported_tax_years: Vec<SupportedTaxYearConfig>,
}

#[derive(Serialize)]
struct SupportedTaxYearConfig {
    tax_year: u16,
    available: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    rule_pack_version: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    tax_table_verification_status: Option<String>,
    tax_table_local_estimate_ready: bool,
    tax_table_human_verified: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    load_error: Option<String>,
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

#[wasm_bindgen]
pub fn get_app_config() -> String {
    serialize_response(&build_app_config())
}

fn compute_tax_inner(json_input: &str) -> WasmResult {
    let facts = match load_tax_facts(json_input) {
        Ok(f) => f,
        Err(e) => {
            return WasmResult::err(format!("Input error: {e}"));
        }
    };

    let rules = match embedded_rule_pack_for_year(facts.tax_year) {
        Ok(rules) => rules,
        Err(error) => {
            return WasmResult::err(format!("Rule pack error: {error}"));
        }
    };

    // Structural validation
    if let Err(errs) = facts.validate_structure() {
        let msgs: Vec<String> = errs.iter().map(|e| e.to_string()).collect();
        return WasmResult::err(format_error_list("Please fix these input issues:", &msgs));
    }

    // Policy validation
    if let Err(errs) = validate_supported_slice(&facts, rules) {
        let msgs: Vec<String> = errs.iter().map(|e| e.to_string()).collect();
        return WasmResult::err(format_error_list(
            "This return is outside TaxVault's supported estimate slice:",
            &msgs,
        ));
    }

    if !rules
        .meta
        .table_verification_status
        .allows_estimate_compute()
    {
        return WasmResult::err(format!(
                "TaxVault is locked because the embedded {} federal tax table is still unverified. Mark it machine_checked for local/private estimates or human_verified for public-release signoff.",
                rules.meta.tax_year
            ));
    }

    // Fail closed if a future embedded tax table is neither machine-checked nor human-verified.
    let options = ComputeOptions::default();
    let result = match compute(&facts, rules, &options) {
        Ok(r) => r,
        Err(e) => {
            return WasmResult::err(format!("Computation error: {e}"));
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
        estimated_tax_payments: decimal_str(result.estimated_tax_payments),
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
        "Traditional IRA and HSA deductions are outside the supported estimate slice because TaxVault does not collect employer-plan coverage, HDHP eligibility, annual limits, or excess-contribution details.".into(),
        "Student loan interest is only supported after you confirm the interest was paid on a qualified education loan you were legally obligated to pay.".into(),
        "Head of Household and dependency qualification rules are not fully verified by the app. Parent-based and 'other' dependent HOH cases are blocked outside the supported slice.".into(),
    ];

    if !rules.meta.table_verification_status.is_human_verified() {
        scope_limits.push(format!(
            "The embedded {} federal tax table is machine-checked, not human-verified. Treat this build as local/private estimate software only.",
            rules.meta.tax_year
        ));
    }

    let meta = EstimateMeta {
        rule_pack_version: result.rule_pack_version.clone(),
        tax_table_verification_status: rules.meta.table_verification_status.as_str().into(),
        tax_table_local_estimate_ready: rules.meta.table_verification_status.allows_estimate_compute(),
        tax_table_human_verified: rules.meta.table_verification_status.is_human_verified(),
        estimate_scope: format!(
            "Narrow {} federal estimate for supported W-2, SSA-1099, 1099-INT, 1099-DIV, estimated tax payment, and student loan interest scenarios only.",
            rules.meta.tax_year
        ),
        privacy:
            "Runs entirely in your browser. Drafts autosave in this tab by default, and device storage stays opt-in."
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

    let rules = match embedded_rule_pack_for_year(facts.tax_year) {
        Ok(rules) => rules,
        Err(error) => {
            return InputReview {
                ready_for_estimate: false,
                status: "unsupported".into(),
                summary: format!(
                    "TaxVault does not include an embedded federal rule pack for tax year {} in this build.",
                    facts.tax_year
                ),
                blocking_issues: vec![format!("Rule pack error: {error}")],
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
            summary: format!(
                "TaxVault reviewed the draft, but estimate calculations stay locked until the embedded {} tax table is at least machine-checked.",
                rules.meta.tax_year
            ),
            blocking_issues: vec![format!(
                "Embedded {} federal tax table is still marked unverified. Mark it machine_checked for local/private estimates or human_verified before any public release.",
                rules.meta.tax_year
            )],
            cautions,
        };
    }

    if rules.meta.table_verification_status == TaxTableVerificationStatus::MachineChecked {
        push_unique(
            &mut cautions,
            &format!(
                "The embedded {} federal tax table is machine-checked, not human-verified. This build is suitable for local/private estimates, not public-release signoff.",
                rules.meta.tax_year
            ),
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
        .any(|dependent| !is_qualifying_child_for_child_tax_credit(dependent, facts.tax_year))
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
                DependentRelationship::Parent | DependentRelationship::Other
            )
        })
    {
        push_unique(
            &mut cautions,
            "A parent or 'other' dependent does not automatically establish Head of Household. Support and household rules still need manual review.",
        );
    }
    cautions
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

fn build_app_config() -> AppConfig {
    let supported_tax_years: Vec<SupportedTaxYearConfig> = embedded_rule_pack_entries()
        .iter()
        .map(|entry| match &entry.load_result {
            Ok(rule_pack) => SupportedTaxYearConfig {
                tax_year: entry.tax_year,
                available: true,
                rule_pack_version: Some(rule_pack.meta.version.clone()),
                tax_table_verification_status: Some(
                    rule_pack.meta.table_verification_status.as_str().into(),
                ),
                tax_table_local_estimate_ready: rule_pack
                    .meta
                    .table_verification_status
                    .allows_estimate_compute(),
                tax_table_human_verified: rule_pack
                    .meta
                    .table_verification_status
                    .is_human_verified(),
                load_error: None,
            },
            Err(error) => SupportedTaxYearConfig {
                tax_year: entry.tax_year,
                available: false,
                rule_pack_version: None,
                tax_table_verification_status: None,
                tax_table_local_estimate_ready: false,
                tax_table_human_verified: false,
                load_error: Some(error.clone()),
            },
        })
        .collect();

    let default_tax_year = supported_tax_years
        .iter()
        .filter(|year| year.available)
        .map(|year| year.tax_year)
        .max()
        .or_else(|| supported_tax_years.iter().map(|year| year.tax_year).max())
        .unwrap_or(2025);

    AppConfig {
        default_tax_year,
        supported_tax_years,
    }
}

fn embedded_rule_pack_entries() -> &'static [LoadedEmbeddedRulePack] {
    EMBEDDED_RULE_PACKS
        .get_or_init(|| {
            EMBEDDED_RULE_PACK_SOURCES
                .iter()
                .map(|source| LoadedEmbeddedRulePack {
                    tax_year: source.tax_year,
                    load_result: load_rule_pack(source.rules_toml, source.tax_table_csv)
                        .map_err(|error| error.to_string()),
                })
                .collect()
        })
        .as_slice()
}

fn embedded_rule_pack_for_year(tax_year: u16) -> Result<&'static RulePack, String> {
    let Some(entry) = embedded_rule_pack_entries()
        .iter()
        .find(|entry| entry.tax_year == tax_year)
    else {
        return Err(unsupported_tax_year_error(tax_year));
    };

    match &entry.load_result {
        Ok(rule_pack) => Ok(rule_pack),
        Err(error) => Err(error.clone()),
    }
}

fn unsupported_tax_year_error(tax_year: u16) -> String {
    let supported_years: Vec<String> = embedded_rule_pack_entries()
        .iter()
        .filter(|entry| entry.load_result.is_ok())
        .map(|entry| entry.tax_year.to_string())
        .collect();

    if supported_years.is_empty() {
        format!(
            "TaxVault does not have any embedded federal rule packs available in this build, so tax year {} cannot be loaded.",
            tax_year
        )
    } else {
        format!(
            "TaxVault does not have embedded federal rules for tax year {} in this build. Available embedded years: {}.",
            tax_year,
            supported_years.join(", ")
        )
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
        let rules = embedded_rule_pack_for_year(2025);
        assert!(rules.is_ok());
        assert!(rules.as_ref().is_ok_and(|rule_pack| rule_pack
            .meta
            .table_verification_status
            .allows_estimate_compute()));
    }

    #[test]
    fn app_config_lists_embedded_tax_years() {
        let config = build_app_config();

        assert_eq!(config.default_tax_year, 2025);
        assert_eq!(config.supported_tax_years.len(), 1);
        assert_eq!(config.supported_tax_years[0].tax_year, 2025);
        assert!(config.supported_tax_years[0].available);
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
    fn compute_tax_reports_unsupported_tax_year_when_no_embedded_pack_exists() {
        let json = include_str!("../../../tests/golden_vectors/single_w2_60k.json")
            .replace("\"tax_year\": 2025", "\"tax_year\": 2024");
        let result = compute_tax_inner(&json);

        assert!(!result.success);
        assert!(result
            .error
            .as_deref()
            .is_some_and(|error| error.contains("tax year 2024")));
        assert!(result
            .error
            .as_deref()
            .is_some_and(|error| error.contains("2025")));
    }

    #[test]
    fn review_tax_input_reports_unsupported_tax_year_when_no_embedded_pack_exists() {
        let json = include_str!("../../../tests/golden_vectors/single_w2_60k.json")
            .replace("\"tax_year\": 2025", "\"tax_year\": 2024");
        let review = review_tax_input_inner(&json);

        assert!(!review.ready_for_estimate);
        assert_eq!(review.status, "unsupported");
        assert!(review.summary.contains("tax year 2024"));
        assert!(review
            .blocking_issues
            .iter()
            .any(|issue| issue.contains("2025")));
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
    fn review_tax_input_reports_unsupported_parent_based_hoh_case() {
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
        assert!(!review.ready_for_estimate);
        assert_eq!(review.status, "unsupported");
        assert!(review
            .blocking_issues
            .iter()
            .any(|issue| issue.contains("dependent parent")));
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
    fn review_tax_input_surfaces_hoh_caution_for_supported_child_case() {
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
              "date_of_birth": "2016-06-15",
              "relationship": "daughter",
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
            .any(|caution| caution.contains("machine-checked")));
    }

    #[test]
    fn review_tax_input_reports_unsupported_traditional_ira_deduction() {
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
              "wages": 60000,
              "federal_tax_withheld": 8000,
              "state_tax_withheld": 0,
              "social_security_wages": 60000,
              "social_security_tax_withheld": 3720,
              "medicare_wages": 60000,
              "medicare_tax_withheld": 870
            }],
            "adjustments": {
              "traditional_ira_deduction": 1000,
              "hsa_deduction": 0,
              "student_loan_interest_paid": 0
            }
          }
        }
        "#;

        let review = review_tax_input_inner(json);
        assert!(!review.ready_for_estimate);
        assert_eq!(review.status, "unsupported");
        assert!(review
            .blocking_issues
            .iter()
            .any(|issue| issue.contains("Traditional IRA deduction estimates are not supported")));
    }

    #[test]
    fn review_tax_input_rejects_student_loan_interest_without_attestations() {
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
              "wages": 60000,
              "federal_tax_withheld": 8000,
              "state_tax_withheld": 0,
              "social_security_wages": 60000,
              "social_security_tax_withheld": 3720,
              "medicare_wages": 60000,
              "medicare_tax_withheld": 870
            }],
            "adjustments": {
              "traditional_ira_deduction": 0,
              "hsa_deduction": 0,
              "student_loan_interest_paid": 2500
            }
          }
        }
        "#;

        let review = review_tax_input_inner(json);
        assert!(!review.ready_for_estimate);
        assert_eq!(review.status, "unsupported");
        assert!(review
            .blocking_issues
            .iter()
            .any(|issue| issue.contains("qualified education loan")));
        assert!(review
            .blocking_issues
            .iter()
            .any(|issue| issue.contains("legally obligated")));
    }

    #[test]
    fn review_tax_input_allows_student_loan_interest_after_attestations() {
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
              "wages": 60000,
              "federal_tax_withheld": 8000,
              "state_tax_withheld": 0,
              "social_security_wages": 60000,
              "social_security_tax_withheld": 3720,
              "medicare_wages": 60000,
              "medicare_tax_withheld": 870
            }],
            "adjustments": {
              "traditional_ira_deduction": 0,
              "hsa_deduction": 0,
              "student_loan_interest_paid": 2500,
              "student_loan_interest_is_qualified_loan": true,
              "student_loan_interest_is_legally_obligated": true
            }
          }
        }
        "#;

        let review = review_tax_input_inner(json);
        assert!(review.ready_for_estimate);
        assert_eq!(review.status, "ready");
        assert!(review.blocking_issues.is_empty());
        assert!(!review
            .cautions
            .iter()
            .any(|caution| caution.contains("Student loan interest")));
    }

    #[test]
    fn review_tax_input_reports_dependent_filer_as_unsupported() {
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
              "is_dependent": true
            },
            "spouse": null,
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
        assert!(!review.ready_for_estimate);
        assert_eq!(review.status, "unsupported");
        assert!(review
            .blocking_issues
            .iter()
            .any(|issue| issue.contains("claimed as dependents")));
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
