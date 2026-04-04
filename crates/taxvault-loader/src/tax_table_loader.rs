use rust_decimal::Decimal;
use taxvault_engine::{TaxTable, TaxTableRow};

use crate::error::LoaderError;

/// Load a tax table from CSV content. Returns the table and whether it's verified.
pub fn load_tax_table(csv_content: &str) -> Result<(TaxTable, bool), LoaderError> {
    let mut verified = true;

    // Check for placeholder header
    if csv_content.contains("PLACEHOLDER") {
        verified = false;
    }

    // Strip comment lines
    let clean: String = csv_content
        .lines()
        .filter(|line| !line.starts_with('#'))
        .collect::<Vec<_>>()
        .join("\n");

    let mut rdr = csv::ReaderBuilder::new()
        .has_headers(true)
        .trim(csv::Trim::All)
        .from_reader(clean.as_bytes());

    let mut rows = Vec::new();

    for result in rdr.records() {
        let record = result?;
        if record.len() < 5 {
            continue;
        }

        let income_at_least: Decimal = record[0].parse().map_err(|_| {
            LoaderError::Conversion(format!("invalid income_at_least: {}", &record[0]))
        })?;
        let income_less_than: Decimal = record[1].parse().map_err(|_| {
            LoaderError::Conversion(format!("invalid income_less_than: {}", &record[1]))
        })?;
        let tax_single: Decimal = record[2]
            .parse()
            .map_err(|_| LoaderError::Conversion(format!("invalid tax_single: {}", &record[2])))?;
        let tax_mfj: Decimal = record[3]
            .parse()
            .map_err(|_| LoaderError::Conversion(format!("invalid tax_mfj: {}", &record[3])))?;
        let tax_hoh: Decimal = record[4]
            .parse()
            .map_err(|_| LoaderError::Conversion(format!("invalid tax_hoh: {}", &record[4])))?;

        rows.push(TaxTableRow {
            income_at_least,
            income_less_than,
            tax_single,
            tax_mfj,
            tax_hoh,
        });
    }

    validate_tax_table(&rows)?;

    Ok((TaxTable { rows }, verified))
}

fn validate_tax_table(rows: &[TaxTableRow]) -> Result<(), LoaderError> {
    if rows.is_empty() {
        return Err(LoaderError::Validation(
            "tax table must contain at least one row".into(),
        ));
    }

    let mut expected_start = Decimal::ZERO;
    for (index, row) in rows.iter().enumerate() {
        if row.income_at_least != expected_start {
            return Err(LoaderError::Validation(format!(
                "tax table row {index} starts at {} but expected {}",
                row.income_at_least, expected_start
            )));
        }
        if row.income_less_than <= row.income_at_least {
            return Err(LoaderError::Validation(format!(
                "tax table row {index} has invalid range {}..{}",
                row.income_at_least, row.income_less_than
            )));
        }
        if row.tax_single < Decimal::ZERO
            || row.tax_mfj < Decimal::ZERO
            || row.tax_hoh < Decimal::ZERO
        {
            return Err(LoaderError::Validation(format!(
                "tax table row {index} contains negative tax values"
            )));
        }
        expected_start = row.income_less_than;
    }

    if expected_start < Decimal::from(100_000) {
        return Err(LoaderError::Validation(format!(
            "tax table coverage ends at {} but must cover taxable income below 100000",
            expected_start
        )));
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_gapped_ranges() {
        let csv = concat!(
            "income_at_least,income_less_than,tax_single,tax_mfj,tax_hoh\n",
            "0,50,3,3,3\n",
            "100,150,13,13,13\n",
            "150,100000,18,18,18\n"
        );

        let error = match load_tax_table(csv) {
            Ok(_) => panic!("unexpectedly accepted gapped tax table"),
            Err(error) => error,
        };
        assert!(matches!(error, LoaderError::Validation(_)));
    }

    #[test]
    fn rejects_incomplete_coverage() {
        let csv = concat!(
            "income_at_least,income_less_than,tax_single,tax_mfj,tax_hoh\n",
            "0,99950,3,3,3\n"
        );

        let error = match load_tax_table(csv) {
            Ok(_) => panic!("unexpectedly accepted incomplete tax table"),
            Err(error) => error,
        };
        assert!(matches!(error, LoaderError::Validation(_)));
    }

    #[test]
    fn rejects_negative_hoh_tax_values() {
        let csv = concat!(
            "income_at_least,income_less_than,tax_single,tax_mfj,tax_hoh\n",
            "0,100000,3,3,-1\n"
        );

        let error = match load_tax_table(csv) {
            Ok(_) => panic!("unexpectedly accepted negative HOH tax value"),
            Err(error) => error,
        };
        assert!(matches!(error, LoaderError::Validation(_)));
    }
}
