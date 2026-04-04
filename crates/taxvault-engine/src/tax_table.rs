use rust_decimal::Decimal;
use taxvault_core::FilingStatus;

pub struct TaxTableRow {
    pub income_at_least: Decimal,
    pub income_less_than: Decimal,
    pub tax_single: Decimal,
    pub tax_mfj: Decimal,
    pub tax_hoh: Decimal,
}

pub struct TaxTable {
    pub rows: Vec<TaxTableRow>,
}

impl TaxTable {
    pub fn lookup(&self, taxable_income: Decimal, status: &FilingStatus) -> Option<Decimal> {
        // Binary search: rows are sorted and contiguous by income_at_least.
        let idx = self
            .rows
            .binary_search_by(|row| {
                if taxable_income < row.income_at_least {
                    std::cmp::Ordering::Greater
                } else if taxable_income >= row.income_less_than {
                    std::cmp::Ordering::Less
                } else {
                    std::cmp::Ordering::Equal
                }
            })
            .ok()?;

        let row = &self.rows[idx];
        Some(match status {
            FilingStatus::Single => row.tax_single,
            FilingStatus::MarriedFilingJointly => row.tax_mfj,
            FilingStatus::HeadOfHousehold => row.tax_hoh,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn lookup_finds_correct_row() {
        let table = TaxTable {
            rows: vec![
                TaxTableRow {
                    income_at_least: Decimal::from(0),
                    income_less_than: Decimal::from(50),
                    tax_single: Decimal::from(5),
                    tax_mfj: Decimal::from(3),
                    tax_hoh: Decimal::from(4),
                },
                TaxTableRow {
                    income_at_least: Decimal::from(50),
                    income_less_than: Decimal::from(100),
                    tax_single: Decimal::from(10),
                    tax_mfj: Decimal::from(7),
                    tax_hoh: Decimal::from(8),
                },
            ],
        };

        assert_eq!(
            table.lookup(Decimal::from(25), &FilingStatus::Single),
            Some(Decimal::from(5))
        );
        assert_eq!(
            table.lookup(Decimal::from(75), &FilingStatus::MarriedFilingJointly),
            Some(Decimal::from(7))
        );
        assert_eq!(
            table.lookup(Decimal::from(100), &FilingStatus::Single),
            None
        );
    }

    #[test]
    fn lookup_boundary_row() {
        let table = TaxTable {
            rows: vec![TaxTableRow {
                income_at_least: Decimal::from(50),
                income_less_than: Decimal::from(100),
                tax_single: Decimal::from(10),
                tax_mfj: Decimal::from(7),
                tax_hoh: Decimal::from(8),
            }],
        };

        // Exact lower bound is included
        assert_eq!(
            table.lookup(Decimal::from(50), &FilingStatus::Single),
            Some(Decimal::from(10))
        );
        // Upper bound is excluded
        assert_eq!(
            table.lookup(Decimal::from(100), &FilingStatus::Single),
            None
        );
        // Below range
        assert_eq!(table.lookup(Decimal::from(49), &FilingStatus::Single), None);
    }
}
