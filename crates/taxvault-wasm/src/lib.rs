use std::sync::OnceLock;

use rust_decimal::Decimal;
use serde::Serialize;
use wasm_bindgen::prelude::*;

use taxvault_engine::{compute, validate_supported_slice, ComputeOptions, RulePack};
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

fn decimal_str(d: Decimal) -> String {
    d.round_dp(2).to_string()
}

#[wasm_bindgen]
pub fn compute_tax(json_input: &str) -> String {
    let result = compute_tax_inner(json_input);
    serde_json::to_string(&result).unwrap_or_else(|e| {
        format!(
            r#"{{"success":false,"error":"serialization error: {}"}}"#,
            e
        )
    })
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
            }
        }
    };

    // Structural validation
    if let Err(errs) = facts.validate_structure() {
        let msgs: Vec<String> = errs.iter().map(|e| e.to_string()).collect();
        return WasmResult {
            success: false,
            error: Some(format!("Validation errors: {}", msgs.join("; "))),
            summary: None,
            form: None,
        };
    }

    // Policy validation
    if let Err(errs) = validate_supported_slice(&facts, rules) {
        let msgs: Vec<String> = errs.iter().map(|e| e.to_string()).collect();
        return WasmResult {
            success: false,
            error: Some(format!("Unsupported: {}", msgs.join("; "))),
            summary: None,
            form: None,
        };
    }

    // Compute (allow unverified table since we embed a placeholder)
    let options = ComputeOptions {
        allow_unverified_table: true,
    };
    let result = match compute(&facts, rules, &options) {
        Ok(r) => r,
        Err(e) => {
            return WasmResult {
                success: false,
                error: Some(format!("Computation error: {e}")),
                summary: None,
                form: None,
            }
        }
    };

    // Form compilation
    let form = compile_1040(&result);

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

    WasmResult {
        success: true,
        error: None,
        summary: Some(summary),
        form: Some(form),
    }
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
    fn compute_tax_succeeds_for_valid_vector() {
        let json = include_str!("../../../tests/golden_vectors/single_w2_60k.json");
        let result = compute_tax_inner(json);

        assert!(result.success);
        assert!(result.error.is_none());
        assert_eq!(
            result.summary.as_ref().map(|summary| summary.tax_year),
            Some(2025)
        );
        assert!(result.form.is_some());
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
}
