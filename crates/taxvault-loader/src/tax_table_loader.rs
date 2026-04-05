use rust_decimal::Decimal;
use taxvault_engine::{TaxTable, TaxTableRow, TaxTableVerificationStatus};

use crate::error::LoaderError;
use crate::parse::parse_date;

/// Load a tax table from CSV content. Returns the table and its verification status.
pub fn load_tax_table(
    csv_content: &str,
) -> Result<(TaxTable, TaxTableVerificationStatus), LoaderError> {
    let verification_status = parse_verification_status(csv_content)?;

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

    Ok((TaxTable { rows }, verification_status))
}

#[derive(Default)]
struct TaxTableVerificationMetadata {
    status: Option<String>,
    source_reference: Option<String>,
    reviewed_by: Option<String>,
    reviewed_at: Option<String>,
    method: Option<String>,
    pending_reason: Option<String>,
}

fn parse_verification_status(csv_content: &str) -> Result<TaxTableVerificationStatus, LoaderError> {
    if csv_content.contains("PLACEHOLDER") {
        return Ok(TaxTableVerificationStatus::Unverified);
    }

    let mut metadata = TaxTableVerificationMetadata::default();

    for line in csv_content.lines().filter(|line| line.starts_with('#')) {
        let body = line.trim_start_matches('#').trim();
        let Some((key, value)) = body.split_once('=') else {
            continue;
        };

        let key = key.trim();
        let value = value.trim();

        match key {
            "verification.status" => metadata.status = Some(value.to_string()),
            "verification.source_reference" => metadata.source_reference = Some(value.to_string()),
            "verification.reviewed_by" => metadata.reviewed_by = Some(value.to_string()),
            "verification.reviewed_at" => metadata.reviewed_at = Some(value.to_string()),
            "verification.method" => metadata.method = Some(value.to_string()),
            "verification.pending_reason" => metadata.pending_reason = Some(value.to_string()),
            _ => {}
        }
    }

    match metadata.status.as_deref() {
        None | Some("unverified") => Ok(TaxTableVerificationStatus::Unverified),
        Some("machine_checked") => {
            require_verification_field(
                "verification.source_reference",
                metadata.source_reference.as_deref(),
                "machine_checked",
            )?;
            require_verification_field(
                "verification.method",
                metadata.method.as_deref(),
                "machine_checked",
            )?;
            Ok(TaxTableVerificationStatus::MachineChecked)
        }
        Some("verified") | Some("human_verified") => {
            require_verification_field(
                "verification.source_reference",
                metadata.source_reference.as_deref(),
                "human_verified",
            )?;
            require_verification_field(
                "verification.reviewed_by",
                metadata.reviewed_by.as_deref(),
                "human_verified",
            )?;
            let reviewed_at = require_verification_field(
                "verification.reviewed_at",
                metadata.reviewed_at.as_deref(),
                "human_verified",
            )?;
            parse_date(reviewed_at).map_err(|error| {
                LoaderError::Validation(format!(
                    "verification.reviewed_at must be YYYY-MM-DD: {error}"
                ))
            })?;
            require_verification_field(
                "verification.method",
                metadata.method.as_deref(),
                "human_verified",
            )?;
            Ok(TaxTableVerificationStatus::HumanVerified)
        }
        Some(other) => Err(LoaderError::Validation(format!(
            "verification.status must be 'unverified', 'machine_checked', or 'human_verified', got '{other}'"
        ))),
    }
}

fn require_verification_field<'a>(
    field: &str,
    value: Option<&'a str>,
    status: &str,
) -> Result<&'a str, LoaderError> {
    match value.map(str::trim).filter(|value| !value.is_empty()) {
        Some(value) => Ok(value),
        None => Err(LoaderError::Validation(format!(
            "{field} is required when verification.status={status}"
        ))),
    }
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

    #[test]
    fn table_is_unverified_without_explicit_review_metadata() {
        let csv = concat!(
            "# 2025 Federal Tax Table\n",
            "income_at_least,income_less_than,tax_single,tax_mfj,tax_hoh\n",
            "0,100000,3,3,3\n"
        );

        let (_, status) = load_tax_table(csv).expect("table should load");
        assert_eq!(status, TaxTableVerificationStatus::Unverified);
    }

    #[test]
    fn machine_checked_status_requires_method_metadata() {
        let csv = concat!(
            "# verification.status=machine_checked\n",
            "# verification.source_reference=IRS 2025 Form 1040 Tax Table\n",
            "income_at_least,income_less_than,tax_single,tax_mfj,tax_hoh\n",
            "0,100000,3,3,3\n"
        );

        let error = match load_tax_table(csv) {
            Ok(_) => panic!("machine_checked metadata should be enforced"),
            Err(error) => error,
        };
        assert!(matches!(error, LoaderError::Validation(_)));
    }

    #[test]
    fn human_verified_status_requires_review_metadata() {
        let csv = concat!(
            "# verification.status=human_verified\n",
            "income_at_least,income_less_than,tax_single,tax_mfj,tax_hoh\n",
            "0,100000,3,3,3\n"
        );

        let error = match load_tax_table(csv) {
            Ok(_) => panic!("human_verified table metadata should be enforced"),
            Err(error) => error,
        };
        assert!(matches!(error, LoaderError::Validation(_)));
    }

    #[test]
    fn machine_checked_table_with_method_sets_machine_checked_flag() {
        let csv = concat!(
            "# verification.status=machine_checked\n",
            "# verification.source_reference=IRS 2025 Form 1040 Tax Table\n",
            "# verification.method=Generated rows match the embedded CSV after automated checks.\n",
            "income_at_least,income_less_than,tax_single,tax_mfj,tax_hoh\n",
            "0,100000,3,3,3\n"
        );

        let (_, status) = load_tax_table(csv).expect("table should load");
        assert_eq!(status, TaxTableVerificationStatus::MachineChecked);
    }

    #[test]
    fn human_verified_table_with_review_metadata_sets_verified_flag() {
        let csv = concat!(
            "# verification.status=human_verified\n",
            "# verification.source_reference=IRS 2025 Form 1040 Tax Table\n",
            "# verification.reviewed_by=Release Approver\n",
            "# verification.reviewed_at=2026-04-05\n",
            "# verification.method=Compared generated rows against the published IRS table.\n",
            "income_at_least,income_less_than,tax_single,tax_mfj,tax_hoh\n",
            "0,100000,3,3,3\n"
        );

        let (_, status) = load_tax_table(csv).expect("table should load");
        assert_eq!(status, TaxTableVerificationStatus::HumanVerified);
    }

    #[test]
    fn legacy_verified_alias_maps_to_human_verified() {
        let csv = concat!(
            "# verification.status=verified\n",
            "# verification.source_reference=IRS 2025 Form 1040 Tax Table\n",
            "# verification.reviewed_by=Release Approver\n",
            "# verification.reviewed_at=2026-04-05\n",
            "# verification.method=Compared generated rows against the published IRS table.\n",
            "income_at_least,income_less_than,tax_single,tax_mfj,tax_hoh\n",
            "0,100000,3,3,3\n"
        );

        let (_, status) = load_tax_table(csv).expect("table should load");
        assert_eq!(status, TaxTableVerificationStatus::HumanVerified);
    }
}
