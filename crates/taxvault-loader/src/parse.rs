use taxvault_core::{DateYmd, FilingStatus};

use crate::error::LoaderError;

pub fn parse_filing_status(input: &str) -> Result<FilingStatus, LoaderError> {
    match input {
        "single" => Ok(FilingStatus::Single),
        "married_filing_jointly" | "mfj" => Ok(FilingStatus::MarriedFilingJointly),
        "head_of_household" | "hoh" => Ok(FilingStatus::HeadOfHousehold),
        other => Err(LoaderError::Conversion(format!(
            "unknown filing status: {other}"
        ))),
    }
}

pub fn parse_date(input: &str) -> Result<DateYmd, LoaderError> {
    let mut parts = input.split('-');
    let (Some(year), Some(month), Some(day), None) =
        (parts.next(), parts.next(), parts.next(), parts.next())
    else {
        return Err(LoaderError::Conversion(format!(
            "invalid date format: {input} (expected YYYY-MM-DD)"
        )));
    };

    let year: u16 = year
        .parse()
        .map_err(|_| LoaderError::Conversion(format!("invalid year in date: {input}")))?;
    let month: u8 = month
        .parse()
        .map_err(|_| LoaderError::Conversion(format!("invalid month in date: {input}")))?;
    let day: u8 = day
        .parse()
        .map_err(|_| LoaderError::Conversion(format!("invalid day in date: {input}")))?;

    DateYmd::new(year, month, day).map_err(|e| LoaderError::Conversion(e.to_string()))
}
