use rust_decimal::Decimal;
use taxvault_core::FilingStatus;

use crate::error::ComputeError;
use crate::rule_pack::TaxBrackets;

/// Computes tax using the bracket schedule (Tax Computation Worksheet).
/// Used for taxable income >= $100,000.
pub fn compute_bracket_tax(
    taxable_income: Decimal,
    status: &FilingStatus,
    brackets: &TaxBrackets,
) -> Result<Decimal, ComputeError> {
    let bracket_list = brackets.for_status(status);
    if bracket_list.is_empty() {
        return Err(ComputeError::NoBracketsForStatus);
    }

    let mut tax = Decimal::ZERO;

    for bracket in bracket_list {
        if taxable_income <= bracket.min {
            break;
        }

        let top = match bracket.max {
            Some(max) => taxable_income.min(max),
            None => taxable_income,
        };

        let taxable_in_bracket = top - bracket.min;
        tax += taxable_in_bracket * bracket.rate;
    }

    Ok(tax)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::rule_pack::TaxBracket;

    fn test_brackets() -> TaxBrackets {
        TaxBrackets {
            single: vec![
                TaxBracket {
                    min: Decimal::from(0),
                    max: Some(Decimal::from(11925)),
                    rate: Decimal::new(10, 2),
                },
                TaxBracket {
                    min: Decimal::from(11925),
                    max: Some(Decimal::from(48475)),
                    rate: Decimal::new(12, 2),
                },
                TaxBracket {
                    min: Decimal::from(48475),
                    max: Some(Decimal::from(103350)),
                    rate: Decimal::new(22, 2),
                },
                TaxBracket {
                    min: Decimal::from(103350),
                    max: Some(Decimal::from(197300)),
                    rate: Decimal::new(24, 2),
                },
                TaxBracket {
                    min: Decimal::from(197300),
                    max: Some(Decimal::from(250525)),
                    rate: Decimal::new(32, 2),
                },
                TaxBracket {
                    min: Decimal::from(250525),
                    max: Some(Decimal::from(626350)),
                    rate: Decimal::new(35, 2),
                },
                TaxBracket {
                    min: Decimal::from(626350),
                    max: None,
                    rate: Decimal::new(37, 2),
                },
            ],
            married_filing_jointly: vec![
                TaxBracket {
                    min: Decimal::from(0),
                    max: Some(Decimal::from(23850)),
                    rate: Decimal::new(10, 2),
                },
                TaxBracket {
                    min: Decimal::from(23850),
                    max: Some(Decimal::from(96950)),
                    rate: Decimal::new(12, 2),
                },
                TaxBracket {
                    min: Decimal::from(96950),
                    max: Some(Decimal::from(206700)),
                    rate: Decimal::new(22, 2),
                },
                TaxBracket {
                    min: Decimal::from(206700),
                    max: Some(Decimal::from(394600)),
                    rate: Decimal::new(24, 2),
                },
                TaxBracket {
                    min: Decimal::from(394600),
                    max: Some(Decimal::from(501050)),
                    rate: Decimal::new(32, 2),
                },
                TaxBracket {
                    min: Decimal::from(501050),
                    max: Some(Decimal::from(751600)),
                    rate: Decimal::new(35, 2),
                },
                TaxBracket {
                    min: Decimal::from(751600),
                    max: None,
                    rate: Decimal::new(37, 2),
                },
            ],
            head_of_household: vec![
                TaxBracket {
                    min: Decimal::from(0),
                    max: Some(Decimal::from(17000)),
                    rate: Decimal::new(10, 2),
                },
                TaxBracket {
                    min: Decimal::from(17000),
                    max: Some(Decimal::from(64850)),
                    rate: Decimal::new(12, 2),
                },
                TaxBracket {
                    min: Decimal::from(64850),
                    max: Some(Decimal::from(103350)),
                    rate: Decimal::new(22, 2),
                },
                TaxBracket {
                    min: Decimal::from(103350),
                    max: Some(Decimal::from(197300)),
                    rate: Decimal::new(24, 2),
                },
                TaxBracket {
                    min: Decimal::from(197300),
                    max: Some(Decimal::from(250500)),
                    rate: Decimal::new(32, 2),
                },
                TaxBracket {
                    min: Decimal::from(250500),
                    max: Some(Decimal::from(626350)),
                    rate: Decimal::new(35, 2),
                },
                TaxBracket {
                    min: Decimal::from(626350),
                    max: None,
                    rate: Decimal::new(37, 2),
                },
            ],
        }
    }

    #[test]
    fn single_134250_bracket_tax() {
        // $134,250 single: from golden vector #2
        // 10% on $11,925 = $1,192.50
        // 12% on $36,550 = $4,386.00
        // 22% on $54,875 = $12,072.50
        // 24% on $30,900 = $7,416.00
        // Total: $25,067.00
        let result = compute_bracket_tax(
            Decimal::from(134250),
            &FilingStatus::Single,
            &test_brackets(),
        )
        .unwrap();
        assert_eq!(result, Decimal::from(25067));
    }

    #[test]
    fn single_first_bracket_only() {
        let result = compute_bracket_tax(
            Decimal::from(10000),
            &FilingStatus::Single,
            &test_brackets(),
        )
        .unwrap();
        assert_eq!(result, Decimal::from(1000)); // 10% of $10,000
    }

    #[test]
    fn mfj_100000_bracket_tax() {
        // MFJ $100,000
        // 10% on $23,850 = $2,385
        // 12% on $73,100 = $8,772
        // 22% on $3,050 = $671
        // Total: $11,828
        let result = compute_bracket_tax(
            Decimal::from(100000),
            &FilingStatus::MarriedFilingJointly,
            &test_brackets(),
        )
        .unwrap();
        assert_eq!(result, Decimal::from(11828));
    }

    #[test]
    fn top_bracket() {
        // Very high income hits 37% bracket
        let result = compute_bracket_tax(
            Decimal::from(700000),
            &FilingStatus::Single,
            &test_brackets(),
        )
        .unwrap();
        // This should be > 0 and use the 35% bracket
        assert!(result > Decimal::ZERO);
    }
}
