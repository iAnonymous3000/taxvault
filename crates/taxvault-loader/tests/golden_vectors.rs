use rust_decimal::Decimal;
use taxvault_core::FilingStatus;
use taxvault_engine::{compute, validate_supported_slice, ComputeOptions};
use taxvault_loader::{load_rule_pack, load_tax_facts};

const RULES_TOML: &str = include_str!("../../../rules/federal_2025.toml");
const TAX_TABLE_CSV: &str = include_str!("../../../tax-table/federal_2025_table.csv");

fn load_rules() -> taxvault_engine::RulePack {
    load_rule_pack(RULES_TOML, TAX_TABLE_CSV).expect("rule pack should load")
}

fn run_vector(json: &str) -> (taxvault_engine::ComputedReturn, serde_json::Value) {
    let rules = load_rules();
    let facts = load_tax_facts(json).expect("facts should load");
    facts
        .validate_structure()
        .expect("structural validation should pass");
    validate_supported_slice(&facts, &rules).expect("policy validation should pass");

    let options = ComputeOptions {
        allow_unverified_table: true,
    };
    let result = compute(&facts, &rules, &options).expect("computation should succeed");

    let parsed: serde_json::Value = serde_json::from_str(json).unwrap();
    let expected = parsed["expected"].clone();

    (result, expected)
}

fn assert_field(expected: &serde_json::Value, field: &str, actual: Decimal) {
    let exp: Decimal = serde_json::from_value(expected[field].clone())
        .unwrap_or_else(|_| panic!("missing expected field: {field}"));
    assert_eq!(actual, exp, "field {field}: expected {exp}, got {actual}");
}

fn assert_optional_field(expected: &serde_json::Value, field: &str, actual: Decimal) {
    if expected.get(field).is_some() {
        assert_field(expected, field, actual);
    }
}

fn assert_basic_fields(expected: &serde_json::Value, result: &taxvault_engine::ComputedReturn) {
    assert_field(expected, "total_wages", result.total_wages);
    assert_optional_field(expected, "total_income", result.total_income);
    assert_field(
        expected,
        "adjusted_gross_income",
        result.adjusted_gross_income,
    );
    assert_field(expected, "standard_deduction", result.standard_deduction);
    assert_field(expected, "taxable_income", result.taxable_income);
    assert_field(expected, "income_tax", result.income_tax);
    assert_field(expected, "total_tax", result.total_tax);
    assert_field(
        expected,
        "total_federal_withholding",
        result.total_federal_withholding,
    );
    assert_field(expected, "total_payments", result.total_payments);
    assert_field(expected, "overpayment", result.overpayment);
    assert_field(expected, "balance_due", result.balance_due);
    assert_optional_field(
        expected,
        "total_social_security_benefits",
        result.total_social_security_benefits,
    );
    assert_optional_field(
        expected,
        "taxable_social_security_benefits",
        result.taxable_social_security_benefits,
    );
    assert_optional_field(
        expected,
        "total_w2_federal_withholding",
        result.total_w2_federal_withholding,
    );
    assert_optional_field(
        expected,
        "total_social_security_withholding",
        result.total_social_security_withholding,
    );
}

#[test]
fn single_w2_60k() {
    let json = include_str!("../../../tests/golden_vectors/single_w2_60k.json");
    let (result, expected) = run_vector(json);

    assert_field(&expected, "total_wages", result.total_wages);
    assert_field(
        &expected,
        "adjusted_gross_income",
        result.adjusted_gross_income,
    );
    assert_field(&expected, "standard_deduction", result.standard_deduction);
    assert_field(&expected, "taxable_income", result.taxable_income);
    assert_field(&expected, "income_tax", result.income_tax);
    assert_field(&expected, "total_tax", result.total_tax);
    assert_field(
        &expected,
        "total_federal_withholding",
        result.total_federal_withholding,
    );
    assert_field(&expected, "total_payments", result.total_payments);
    assert_field(&expected, "overpayment", result.overpayment);
    assert_field(&expected, "balance_due", result.balance_due);
}

#[test]
fn single_w2_150k() {
    let json = include_str!("../../../tests/golden_vectors/single_w2_150k.json");
    let (result, expected) = run_vector(json);

    assert_field(&expected, "total_wages", result.total_wages);
    assert_field(
        &expected,
        "adjusted_gross_income",
        result.adjusted_gross_income,
    );
    assert_field(&expected, "standard_deduction", result.standard_deduction);
    assert_field(&expected, "taxable_income", result.taxable_income);
    assert_field(&expected, "income_tax", result.income_tax);
    assert_field(&expected, "total_tax", result.total_tax);
    assert_field(
        &expected,
        "total_federal_withholding",
        result.total_federal_withholding,
    );
    assert_field(&expected, "total_payments", result.total_payments);
    assert_field(&expected, "overpayment", result.overpayment);
    assert_field(&expected, "balance_due", result.balance_due);
}

#[test]
fn mfj_two_w2s() {
    let json = include_str!("../../../tests/golden_vectors/mfj_two_w2s.json");
    let (result, expected) = run_vector(json);

    assert_field(&expected, "total_wages", result.total_wages);
    assert_field(
        &expected,
        "adjusted_gross_income",
        result.adjusted_gross_income,
    );
    assert_field(&expected, "standard_deduction", result.standard_deduction);
    assert_field(&expected, "taxable_income", result.taxable_income);
    assert_field(&expected, "income_tax", result.income_tax);
    assert_field(&expected, "total_tax", result.total_tax);
    assert_field(
        &expected,
        "total_federal_withholding",
        result.total_federal_withholding,
    );
    assert_field(&expected, "total_payments", result.total_payments);
    assert_field(&expected, "overpayment", result.overpayment);
    assert_field(&expected, "balance_due", result.balance_due);
}

#[test]
fn hoh_blind_w2_150k() {
    let json = include_str!("../../../tests/golden_vectors/hoh_blind_w2_150k.json");
    let (result, expected) = run_vector(json);

    assert_field(&expected, "total_wages", result.total_wages);
    assert_field(
        &expected,
        "adjusted_gross_income",
        result.adjusted_gross_income,
    );
    assert_field(&expected, "standard_deduction", result.standard_deduction);
    assert_field(&expected, "taxable_income", result.taxable_income);
    assert_field(&expected, "income_tax", result.income_tax);
    assert_field(&expected, "total_tax", result.total_tax);
    assert_field(
        &expected,
        "total_federal_withholding",
        result.total_federal_withholding,
    );
    assert_field(&expected, "total_payments", result.total_payments);
    assert_field(&expected, "overpayment", result.overpayment);
    assert_field(&expected, "balance_due", result.balance_due);

    let form = taxvault_forms::compile_1040(&result);
    assert_eq!(
        form.lines["12d"],
        taxvault_forms::FormLineValue::Checkbox(true)
    );
    assert_eq!(
        form.lines["19"],
        taxvault_forms::FormLineValue::Currency(Decimal::from(2200))
    );
}

#[test]
fn single_w2_interest_dividends_145500() {
    let json =
        include_str!("../../../tests/golden_vectors/single_w2_interest_dividends_145500.json");
    let (result, expected) = run_vector(json);

    assert_field(&expected, "total_wages", result.total_wages);
    assert_field(
        &expected,
        "adjusted_gross_income",
        result.adjusted_gross_income,
    );
    assert_field(&expected, "standard_deduction", result.standard_deduction);
    assert_field(&expected, "taxable_income", result.taxable_income);
    assert_field(&expected, "income_tax", result.income_tax);
    assert_field(&expected, "total_tax", result.total_tax);
    assert_field(
        &expected,
        "total_federal_withholding",
        result.total_federal_withholding,
    );
    assert_field(&expected, "total_payments", result.total_payments);
    assert_field(&expected, "overpayment", result.overpayment);
    assert_field(&expected, "balance_due", result.balance_due);

    let form = taxvault_forms::compile_1040(&result);
    assert_eq!(
        form.lines["2a"],
        taxvault_forms::FormLineValue::Currency(Decimal::from(300))
    );
    assert_eq!(
        form.lines["2b"],
        taxvault_forms::FormLineValue::Currency(Decimal::from(500))
    );
    assert_eq!(
        form.lines["3a"],
        taxvault_forms::FormLineValue::Currency(Decimal::from(5000))
    );
    assert_eq!(
        form.lines["3b"],
        taxvault_forms::FormLineValue::Currency(Decimal::from(5000))
    );
}

#[test]
fn mfj_two_w2s_two_children_70k() {
    let json = include_str!("../../../tests/golden_vectors/mfj_two_w2s_two_children_70k.json");
    let (result, expected) = run_vector(json);

    assert_field(&expected, "total_wages", result.total_wages);
    assert_field(
        &expected,
        "adjusted_gross_income",
        result.adjusted_gross_income,
    );
    assert_field(&expected, "standard_deduction", result.standard_deduction);
    assert_field(&expected, "taxable_income", result.taxable_income);
    assert_field(&expected, "income_tax", result.income_tax);
    assert_field(&expected, "total_tax", result.total_tax);
    assert_field(
        &expected,
        "total_federal_withholding",
        result.total_federal_withholding,
    );
    assert_field(&expected, "total_payments", result.total_payments);
    assert_field(&expected, "overpayment", result.overpayment);
    assert_field(&expected, "balance_due", result.balance_due);
    assert_eq!(result.num_qualifying_children, 2);

    let form = taxvault_forms::compile_1040(&result);
    assert_eq!(
        form.lines["19"],
        taxvault_forms::FormLineValue::Currency(Decimal::from(4146))
    );
    assert_eq!(
        form.lines["28"],
        taxvault_forms::FormLineValue::Currency(Decimal::from(254))
    );
}

#[test]
fn machine_checked_table_allows_sub_100k_without_override() {
    let json = include_str!("../../../tests/golden_vectors/single_w2_60k.json");
    let rules = load_rules();
    let facts = load_tax_facts(json).expect("facts should load");

    assert!(
        rules
            .meta
            .table_verification_status
            .allows_estimate_compute(),
        "embedded tax table should allow local estimates once machine-checked"
    );

    let options = ComputeOptions {
        allow_unverified_table: false,
    };
    let result = compute(&facts, &rules, &options);
    assert!(
        result.is_ok(),
        "should succeed without override once the embedded table is machine-checked"
    );
}

#[test]
fn opening_tax_table_rows_match_irs_reference_values() {
    let rules = load_rules();
    let table = &rules.tax_table;

    assert_eq!(
        table.lookup(Decimal::from(4), &FilingStatus::Single),
        Some(Decimal::ZERO)
    );
    assert_eq!(
        table.lookup(Decimal::from(10), &FilingStatus::Single),
        Some(Decimal::ONE)
    );
    assert_eq!(
        table.lookup(Decimal::from(20), &FilingStatus::Single),
        Some(Decimal::from(2))
    );
    assert_eq!(
        table.lookup(Decimal::from(30), &FilingStatus::Single),
        Some(Decimal::from(4))
    );
    assert_eq!(
        table.lookup(Decimal::from(60), &FilingStatus::Single),
        Some(Decimal::from(6))
    );
    assert_eq!(
        table.lookup(Decimal::from(25_325), &FilingStatus::MarriedFilingJointly),
        Some(Decimal::from(2562))
    );
    assert_eq!(
        table.lookup(Decimal::from(25_325), &FilingStatus::HeadOfHousehold),
        Some(Decimal::from(2699))
    );
}

#[test]
fn form_1040_compilation() {
    let json = include_str!("../../../tests/golden_vectors/single_w2_60k.json");
    let (result, _) = run_vector(json);

    let form = taxvault_forms::compile_1040(&result);
    assert_eq!(form.form_id, "1040");
    assert_eq!(form.tax_year, 2025);

    // Key lines should be present
    assert!(form.lines.contains_key("1a"));
    assert!(form.lines.contains_key("16"));
    assert!(form.lines.contains_key("24"));
    assert!(form.lines.contains_key("33"));
    assert!(form.lines.contains_key("34"));
    assert!(form.lines.contains_key("37"));
}

#[test]
fn single_w2_qualified_dividends_zero_rate_threshold() {
    let json = include_str!(
        "../../../tests/golden_vectors/single_w2_qualified_dividends_zero_rate_threshold.json"
    );
    let (result, expected) = run_vector(json);

    assert_basic_fields(&expected, &result);
    assert_field(
        &expected,
        "child_dependent_credit",
        result.child_dependent_credit,
    );
    assert_field(
        &expected,
        "additional_child_tax_credit",
        result.additional_child_tax_credit,
    );

    let form = taxvault_forms::compile_1040(&result);
    assert_eq!(
        form.lines["3a"],
        taxvault_forms::FormLineValue::Currency(Decimal::from(10000))
    );
    assert_eq!(
        form.lines["3b"],
        taxvault_forms::FormLineValue::Currency(Decimal::from(10000))
    );
}

#[test]
fn single_w2_qualified_dividends_twenty_rate_threshold() {
    let json = include_str!(
        "../../../tests/golden_vectors/single_w2_qualified_dividends_twenty_rate_threshold.json"
    );
    let (result, expected) = run_vector(json);

    assert_basic_fields(&expected, &result);
    assert_field(
        &expected,
        "child_dependent_credit",
        result.child_dependent_credit,
    );
    assert_field(
        &expected,
        "additional_child_tax_credit",
        result.additional_child_tax_credit,
    );

    let form = taxvault_forms::compile_1040(&result);
    assert_eq!(
        form.lines["3a"],
        taxvault_forms::FormLineValue::Currency(Decimal::from(400000))
    );
    assert_eq!(
        form.lines["3b"],
        taxvault_forms::FormLineValue::Currency(Decimal::from(400000))
    );
}

#[test]
fn hoh_one_child_ctc_phaseout_201000() {
    let json = include_str!("../../../tests/golden_vectors/hoh_one_child_ctc_phaseout_201000.json");
    let (result, expected) = run_vector(json);

    assert_basic_fields(&expected, &result);
    assert_field(
        &expected,
        "child_dependent_credit",
        result.child_dependent_credit,
    );
    assert_field(
        &expected,
        "additional_child_tax_credit",
        result.additional_child_tax_credit,
    );
    assert_eq!(result.num_qualifying_children, 1);

    let form = taxvault_forms::compile_1040(&result);
    assert_eq!(
        form.lines["19"],
        taxvault_forms::FormLineValue::Currency(Decimal::from(2150))
    );
    assert_eq!(
        form.lines["28"],
        taxvault_forms::FormLineValue::Currency(Decimal::ZERO)
    );
}

#[test]
fn mfj_two_w2s_two_children_ctc_phaseout_401500() {
    let json = include_str!(
        "../../../tests/golden_vectors/mfj_two_w2s_two_children_ctc_phaseout_401500.json"
    );
    let (result, expected) = run_vector(json);

    assert_basic_fields(&expected, &result);
    assert_field(
        &expected,
        "child_dependent_credit",
        result.child_dependent_credit,
    );
    assert_field(
        &expected,
        "additional_child_tax_credit",
        result.additional_child_tax_credit,
    );
    assert_eq!(result.num_qualifying_children, 2);

    let form = taxvault_forms::compile_1040(&result);
    assert_eq!(
        form.lines["19"],
        taxvault_forms::FormLineValue::Currency(Decimal::from(4300))
    );
    assert_eq!(
        form.lines["28"],
        taxvault_forms::FormLineValue::Currency(Decimal::ZERO)
    );
}

#[test]
fn hoh_one_child_actc_12500() {
    let json = include_str!("../../../tests/golden_vectors/hoh_one_child_actc_12500.json");
    let (result, expected) = run_vector(json);

    assert_basic_fields(&expected, &result);
    assert_field(
        &expected,
        "child_dependent_credit",
        result.child_dependent_credit,
    );
    assert_field(
        &expected,
        "additional_child_tax_credit",
        result.additional_child_tax_credit,
    );
    assert_eq!(result.num_qualifying_children, 1);

    let form = taxvault_forms::compile_1040(&result);
    assert_eq!(
        form.lines["19"],
        taxvault_forms::FormLineValue::Currency(Decimal::ZERO)
    );
    assert_eq!(
        form.lines["28"],
        taxvault_forms::FormLineValue::Currency(Decimal::from(1500))
    );
}

#[test]
fn hoh_one_child_w2_50k() {
    let json = include_str!("../../../tests/golden_vectors/hoh_one_child_w2_50k.json");
    let (result, expected) = run_vector(json);

    assert_basic_fields(&expected, &result);
    assert_field(
        &expected,
        "child_dependent_credit",
        result.child_dependent_credit,
    );
    assert_field(
        &expected,
        "additional_child_tax_credit",
        result.additional_child_tax_credit,
    );
    assert_eq!(result.num_qualifying_children, 1);

    let form = taxvault_forms::compile_1040(&result);
    assert_eq!(
        form.lines["19"],
        taxvault_forms::FormLineValue::Currency(Decimal::from(2200))
    );
    assert_eq!(
        form.lines["28"],
        taxvault_forms::FormLineValue::Currency(Decimal::ZERO)
    );
}

#[test]
fn single_65_plus_w2_40k() {
    let json = include_str!("../../../tests/golden_vectors/single_65_plus_w2_40k.json");
    let (result, expected) = run_vector(json);

    assert_basic_fields(&expected, &result);
    assert_field(
        &expected,
        "child_dependent_credit",
        result.child_dependent_credit,
    );
    assert_field(
        &expected,
        "additional_child_tax_credit",
        result.additional_child_tax_credit,
    );
    assert_eq!(result.age_or_blind_qualifier_count, 1);

    let form = taxvault_forms::compile_1040(&result);
    assert_eq!(
        form.lines["12d"],
        taxvault_forms::FormLineValue::Checkbox(true)
    );
}

#[test]
fn mfj_two_w2s_both_65_plus_one_blind_67800() {
    let json =
        include_str!("../../../tests/golden_vectors/mfj_two_w2s_both_65_plus_one_blind_67800.json");
    let (result, expected) = run_vector(json);

    assert_basic_fields(&expected, &result);
    assert_field(
        &expected,
        "child_dependent_credit",
        result.child_dependent_credit,
    );
    assert_field(
        &expected,
        "additional_child_tax_credit",
        result.additional_child_tax_credit,
    );
    assert_eq!(result.age_or_blind_qualifier_count, 3);

    let form = taxvault_forms::compile_1040(&result);
    assert_eq!(
        form.lines["12d"],
        taxvault_forms::FormLineValue::Checkbox(true)
    );
}

#[test]
fn single_w2_zero_income_withholding_only() {
    let json =
        include_str!("../../../tests/golden_vectors/single_w2_zero_income_withholding_only.json");
    let (result, expected) = run_vector(json);

    assert_basic_fields(&expected, &result);
    assert_field(
        &expected,
        "child_dependent_credit",
        result.child_dependent_credit,
    );
    assert_field(
        &expected,
        "additional_child_tax_credit",
        result.additional_child_tax_credit,
    );

    let form = taxvault_forms::compile_1040(&result);
    assert_eq!(
        form.lines["15"],
        taxvault_forms::FormLineValue::Currency(Decimal::ZERO)
    );
    assert_eq!(
        form.lines["16"],
        taxvault_forms::FormLineValue::Currency(Decimal::ZERO)
    );
    assert_eq!(
        form.lines["34"],
        taxvault_forms::FormLineValue::Currency(Decimal::from(750))
    );
}

#[test]
fn single_ssa1099_only_withholding() {
    let json = include_str!("../../../tests/golden_vectors/single_ssa1099_only_withholding.json");
    let (result, expected) = run_vector(json);

    assert_basic_fields(&expected, &result);
    assert_field(
        &expected,
        "child_dependent_credit",
        result.child_dependent_credit,
    );
    assert_field(
        &expected,
        "additional_child_tax_credit",
        result.additional_child_tax_credit,
    );

    let form = taxvault_forms::compile_1040(&result);
    assert_eq!(
        form.lines["6a"],
        taxvault_forms::FormLineValue::Currency(Decimal::from(36000))
    );
    assert_eq!(
        form.lines["6b"],
        taxvault_forms::FormLineValue::Currency(Decimal::ZERO)
    );
    assert_eq!(
        form.lines["25a"],
        taxvault_forms::FormLineValue::Currency(Decimal::ZERO)
    );
    assert_eq!(
        form.lines["25b"],
        taxvault_forms::FormLineValue::Currency(Decimal::from(1800))
    );
}

#[test]
fn single_ssa1099_plus_w2() {
    let json = include_str!("../../../tests/golden_vectors/single_ssa1099_plus_w2.json");
    let (result, expected) = run_vector(json);

    assert_basic_fields(&expected, &result);
    assert_field(
        &expected,
        "child_dependent_credit",
        result.child_dependent_credit,
    );
    assert_field(
        &expected,
        "additional_child_tax_credit",
        result.additional_child_tax_credit,
    );

    let form = taxvault_forms::compile_1040(&result);
    assert_eq!(
        form.lines["6a"],
        taxvault_forms::FormLineValue::Currency(Decimal::from(12000))
    );
    assert_eq!(
        form.lines["6b"],
        taxvault_forms::FormLineValue::Currency(Decimal::from(6200))
    );
    assert_eq!(
        form.lines["25a"],
        taxvault_forms::FormLineValue::Currency(Decimal::from(3500))
    );
    assert_eq!(
        form.lines["25b"],
        taxvault_forms::FormLineValue::Currency(Decimal::from(600))
    );
}

#[test]
fn single_ssa1099_below_taxable_threshold() {
    let json =
        include_str!("../../../tests/golden_vectors/single_ssa1099_below_taxable_threshold.json");
    let (result, expected) = run_vector(json);

    assert_basic_fields(&expected, &result);
    assert_field(
        &expected,
        "child_dependent_credit",
        result.child_dependent_credit,
    );
    assert_field(
        &expected,
        "additional_child_tax_credit",
        result.additional_child_tax_credit,
    );

    let form = taxvault_forms::compile_1040(&result);
    assert_eq!(
        form.lines["6a"],
        taxvault_forms::FormLineValue::Currency(Decimal::from(24000))
    );
    assert_eq!(
        form.lines["6b"],
        taxvault_forms::FormLineValue::Currency(Decimal::ZERO)
    );
}

#[test]
fn single_ssa1099_exactly_50_percent_taxable() {
    let json = include_str!(
        "../../../tests/golden_vectors/single_ssa1099_exactly_50_percent_taxable.json"
    );
    let (result, expected) = run_vector(json);

    assert_basic_fields(&expected, &result);
    assert_field(
        &expected,
        "child_dependent_credit",
        result.child_dependent_credit,
    );
    assert_field(
        &expected,
        "additional_child_tax_credit",
        result.additional_child_tax_credit,
    );

    let form = taxvault_forms::compile_1040(&result);
    assert_eq!(
        form.lines["6a"],
        taxvault_forms::FormLineValue::Currency(Decimal::from(8000))
    );
    assert_eq!(
        form.lines["6b"],
        taxvault_forms::FormLineValue::Currency(Decimal::from(4000))
    );
}

#[test]
fn single_ssa1099_exactly_85_percent_taxable() {
    let json = include_str!(
        "../../../tests/golden_vectors/single_ssa1099_exactly_85_percent_taxable.json"
    );
    let (result, expected) = run_vector(json);

    assert_basic_fields(&expected, &result);
    assert_field(
        &expected,
        "child_dependent_credit",
        result.child_dependent_credit,
    );
    assert_field(
        &expected,
        "additional_child_tax_credit",
        result.additional_child_tax_credit,
    );

    let form = taxvault_forms::compile_1040(&result);
    assert_eq!(
        form.lines["6a"],
        taxvault_forms::FormLineValue::Currency(Decimal::from(10000))
    );
    assert_eq!(
        form.lines["6b"],
        taxvault_forms::FormLineValue::Currency(Decimal::from(8500))
    );
}
