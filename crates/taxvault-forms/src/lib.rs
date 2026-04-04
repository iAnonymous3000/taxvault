use std::collections::BTreeMap;

use rust_decimal::Decimal;
use serde::Serialize;
use taxvault_engine::ComputedReturn;

#[derive(Debug, Serialize)]
pub struct FormLineMap {
    pub form_id: String,
    pub tax_year: u16,
    pub lines: BTreeMap<String, FormLineValue>,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
pub enum FormLineValue {
    Currency(Decimal),
    Text(String),
    Checkbox(bool),
    Redacted,
}

/// Compile a ComputedReturn into the 2025 Form 1040 line map.
pub fn compile_1040(ret: &ComputedReturn) -> FormLineMap {
    let mut lines = BTreeMap::new();

    let zero = Decimal::ZERO;

    // Income
    currency(&mut lines, "1a", ret.total_wages);
    currency(&mut lines, "1z", ret.total_wages);
    currency(&mut lines, "2a", ret.total_tax_exempt_interest);
    currency(&mut lines, "2b", ret.total_taxable_interest);
    currency(&mut lines, "3a", ret.total_qualified_dividends);
    currency(&mut lines, "3b", ret.total_ordinary_dividends);
    currency(&mut lines, "4a", zero);
    currency(&mut lines, "4b", zero);
    currency(&mut lines, "5a", zero);
    currency(&mut lines, "5b", zero);
    currency(&mut lines, "6a", ret.total_social_security_benefits);
    currency(&mut lines, "6b", ret.taxable_social_security_benefits);
    currency(&mut lines, "7", zero);
    currency(&mut lines, "8", zero);
    currency(&mut lines, "9", ret.total_income); // total income
    currency(&mut lines, "10", zero); // adjustments
    currency(&mut lines, "11a", ret.adjusted_gross_income);
    currency(&mut lines, "11b", ret.adjusted_gross_income);

    // Line 12 checkboxes
    checkbox(&mut lines, "12a", false);
    checkbox(&mut lines, "12b", false);
    checkbox(&mut lines, "12c", false);
    checkbox(&mut lines, "12d", ret.age_or_blind_qualifier_count > 0);
    currency(&mut lines, "12e", ret.standard_deduction);

    currency(&mut lines, "13a", zero); // QBI
    currency(&mut lines, "13b", zero); // Sched 1-A
    currency(&mut lines, "14", ret.total_deductions);
    currency(&mut lines, "15", ret.taxable_income);
    currency(&mut lines, "16", ret.income_tax);
    currency(&mut lines, "17", zero); // Sched 2 Part I
    currency(&mut lines, "18", ret.income_tax); // 16 + 17
    currency(&mut lines, "19", ret.child_dependent_credit);
    currency(&mut lines, "20", zero);
    currency(&mut lines, "21", ret.child_dependent_credit);
    currency(&mut lines, "22", ret.total_tax); // 18 - 21
    currency(&mut lines, "23", zero); // no Schedule 2 other taxes
    currency(&mut lines, "24", ret.total_tax); // total tax

    // Payments
    currency(&mut lines, "25a", ret.total_w2_federal_withholding);
    currency(&mut lines, "25b", ret.total_social_security_withholding);
    currency(&mut lines, "25c", zero);
    currency(&mut lines, "25d", ret.total_federal_withholding);
    currency(&mut lines, "26", zero);
    currency(&mut lines, "27", zero);
    currency(&mut lines, "28", ret.additional_child_tax_credit);
    currency(&mut lines, "29", zero);
    currency(&mut lines, "30", zero);
    currency(&mut lines, "31", zero);
    currency(&mut lines, "32", zero);
    currency(&mut lines, "33", ret.total_payments);

    // Result
    currency(&mut lines, "34", ret.overpayment);
    currency(&mut lines, "37", ret.balance_due);

    FormLineMap {
        form_id: "1040".into(),
        tax_year: ret.tax_year,
        lines,
    }
}

fn currency(lines: &mut BTreeMap<String, FormLineValue>, line: &str, value: Decimal) {
    lines.insert(line.to_string(), FormLineValue::Currency(value));
}

fn checkbox(lines: &mut BTreeMap<String, FormLineValue>, line: &str, value: bool) {
    lines.insert(line.to_string(), FormLineValue::Checkbox(value));
}

#[cfg(test)]
mod tests {
    use super::*;
    use taxvault_core::FilingStatus;
    use taxvault_engine::trace::{CalculationTrace, TraceNode, TraceNodeId};

    fn mock_return() -> ComputedReturn {
        ComputedReturn {
            tax_year: 2025,
            filing_status: FilingStatus::Single,
            num_dependents: 0,
            num_qualifying_children: 0,
            num_other_dependents: 0,
            age_or_blind_qualifier_count: 0,
            total_wages: Decimal::from(60000),
            total_taxable_interest: Decimal::ZERO,
            total_tax_exempt_interest: Decimal::ZERO,
            total_ordinary_dividends: Decimal::ZERO,
            total_qualified_dividends: Decimal::ZERO,
            total_social_security_benefits: Decimal::ZERO,
            taxable_social_security_benefits: Decimal::ZERO,
            total_income: Decimal::from(60000),
            adjusted_gross_income: Decimal::from(60000),
            standard_deduction: Decimal::from(15750),
            total_deductions: Decimal::from(15750),
            taxable_income: Decimal::from(44250),
            income_tax: Decimal::from(5075),
            child_dependent_credit: Decimal::ZERO,
            additional_child_tax_credit: Decimal::ZERO,
            total_w2_federal_withholding: Decimal::from(8000),
            total_social_security_withholding: Decimal::ZERO,
            total_tax: Decimal::from(5075),
            total_federal_withholding: Decimal::from(8000),
            total_payments: Decimal::from(8000),
            balance_due: Decimal::ZERO,
            overpayment: Decimal::from(2925),
            trace: CalculationTrace::new(
                vec![TraceNode {
                    id: TraceNodeId(0),
                    label: "root".into(),
                    value: Decimal::ZERO,
                    rule_applied: "".into(),
                    input_ids: vec![],
                }],
                TraceNodeId(0),
            ),
            rule_pack_version: "1.0.0".into(),
        }
    }

    #[test]
    fn all_lines_emitted() {
        let form = compile_1040(&mock_return());
        assert_eq!(form.form_id, "1040");
        assert_eq!(form.tax_year, 2025);

        // Check key lines
        assert_eq!(
            form.lines["1a"],
            FormLineValue::Currency(Decimal::from(60000))
        );
        assert_eq!(
            form.lines["15"],
            FormLineValue::Currency(Decimal::from(44250))
        );
        assert_eq!(
            form.lines["16"],
            FormLineValue::Currency(Decimal::from(5075))
        );
        assert_eq!(
            form.lines["24"],
            FormLineValue::Currency(Decimal::from(5075))
        );
        assert_eq!(
            form.lines["22"],
            FormLineValue::Currency(Decimal::from(5075))
        );
        assert_eq!(form.lines["23"], FormLineValue::Currency(Decimal::ZERO));
        assert_eq!(
            form.lines["25a"],
            FormLineValue::Currency(Decimal::from(8000))
        );
        assert_eq!(
            form.lines["33"],
            FormLineValue::Currency(Decimal::from(8000))
        );
        assert_eq!(
            form.lines["34"],
            FormLineValue::Currency(Decimal::from(2925))
        );
        assert_eq!(form.lines["37"], FormLineValue::Currency(Decimal::ZERO));

        // Checkboxes
        assert_eq!(form.lines["12a"], FormLineValue::Checkbox(false));
        assert_eq!(form.lines["12d"], FormLineValue::Checkbox(false));

        // Zero lines
        assert_eq!(form.lines["2a"], FormLineValue::Currency(Decimal::ZERO));
        assert_eq!(form.lines["7"], FormLineValue::Currency(Decimal::ZERO));
    }

    #[test]
    fn maps_interest_dividends_and_child_credit_lines() {
        let mut ret = mock_return();
        ret.total_taxable_interest = Decimal::from(125);
        ret.total_tax_exempt_interest = Decimal::from(50);
        ret.total_ordinary_dividends = Decimal::from(400);
        ret.total_qualified_dividends = Decimal::from(250);
        ret.total_social_security_benefits = Decimal::from(12000);
        ret.taxable_social_security_benefits = Decimal::from(3000);
        ret.total_income = Decimal::from(60525);
        ret.adjusted_gross_income = Decimal::from(60525);
        ret.taxable_income = Decimal::from(44775);
        ret.income_tax = Decimal::from(5140);
        ret.child_dependent_credit = Decimal::from(2000);
        ret.additional_child_tax_credit = Decimal::from(300);
        ret.total_w2_federal_withholding = Decimal::from(8000);
        ret.total_social_security_withholding = Decimal::from(250);
        ret.total_federal_withholding = Decimal::from(8250);
        ret.total_tax = Decimal::from(3140);
        ret.total_payments = Decimal::from(8550);
        ret.overpayment = Decimal::from(5410);

        let form = compile_1040(&ret);
        assert_eq!(form.lines["2a"], FormLineValue::Currency(Decimal::from(50)));
        assert_eq!(
            form.lines["2b"],
            FormLineValue::Currency(Decimal::from(125))
        );
        assert_eq!(
            form.lines["3a"],
            FormLineValue::Currency(Decimal::from(250))
        );
        assert_eq!(
            form.lines["3b"],
            FormLineValue::Currency(Decimal::from(400))
        );
        assert_eq!(
            form.lines["6a"],
            FormLineValue::Currency(Decimal::from(12000))
        );
        assert_eq!(
            form.lines["6b"],
            FormLineValue::Currency(Decimal::from(3000))
        );
        assert_eq!(
            form.lines["19"],
            FormLineValue::Currency(Decimal::from(2000))
        );
        assert_eq!(
            form.lines["21"],
            FormLineValue::Currency(Decimal::from(2000))
        );
        assert_eq!(
            form.lines["22"],
            FormLineValue::Currency(Decimal::from(3140))
        );
        assert_eq!(
            form.lines["25a"],
            FormLineValue::Currency(Decimal::from(8000))
        );
        assert_eq!(
            form.lines["25b"],
            FormLineValue::Currency(Decimal::from(250))
        );
        assert_eq!(
            form.lines["28"],
            FormLineValue::Currency(Decimal::from(300))
        );
        assert_eq!(
            form.lines["33"],
            FormLineValue::Currency(Decimal::from(8550))
        );
    }

    #[test]
    fn age_or_blind_adjustment_sets_line_12d_checkbox() {
        let mut ret = mock_return();
        ret.age_or_blind_qualifier_count = 1;
        ret.standard_deduction = Decimal::from(17750);
        ret.total_deductions = Decimal::from(17750);

        let form = compile_1040(&ret);
        assert_eq!(form.lines["12d"], FormLineValue::Checkbox(true));
        assert_eq!(
            form.lines["12e"],
            FormLineValue::Currency(Decimal::from(17750))
        );
    }

    #[test]
    fn line_count() {
        let form = compile_1040(&mock_return());
        // Should have all lines from the mapping
        assert!(form.lines.len() >= 45);
    }
}
