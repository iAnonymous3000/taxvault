use crate::error::ValidationError;

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct DateYmd {
    year: u16,
    month: u8,
    day: u8,
}

impl DateYmd {
    pub fn new(year: u16, month: u8, day: u8) -> Result<Self, ValidationError> {
        if !(1..=12).contains(&month) {
            return Err(ValidationError::InvalidDate { year, month, day });
        }

        let max_day = match month {
            1 | 3 | 5 | 7 | 8 | 10 | 12 => 31,
            4 | 6 | 9 | 11 => 30,
            2 => {
                if is_leap_year(year) {
                    29
                } else {
                    28
                }
            }
            _ => unreachable!(),
        };

        if day < 1 || day > max_day {
            return Err(ValidationError::InvalidDate { year, month, day });
        }

        Ok(Self { year, month, day })
    }

    pub fn year(&self) -> u16 {
        self.year
    }

    pub fn month(&self) -> u8 {
        self.month
    }

    pub fn day(&self) -> u8 {
        self.day
    }

    /// Returns true if self is strictly before other.
    pub fn is_before(&self, other: &DateYmd) -> bool {
        (self.year, self.month, self.day) < (other.year, other.month, other.day)
    }
}

fn is_leap_year(year: u16) -> bool {
    (year.is_multiple_of(4) && !year.is_multiple_of(100)) || year.is_multiple_of(400)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn valid_dates() {
        assert!(DateYmd::new(2025, 1, 1).is_ok());
        assert!(DateYmd::new(2025, 12, 31).is_ok());
        assert!(DateYmd::new(2024, 2, 29).is_ok()); // leap year
        assert!(DateYmd::new(2000, 2, 29).is_ok()); // century leap year
    }

    #[test]
    fn invalid_dates() {
        assert!(DateYmd::new(2025, 0, 1).is_err());
        assert!(DateYmd::new(2025, 13, 1).is_err());
        assert!(DateYmd::new(2025, 1, 0).is_err());
        assert!(DateYmd::new(2025, 1, 32).is_err());
        assert!(DateYmd::new(2025, 2, 29).is_err()); // not leap year
        assert!(DateYmd::new(1900, 2, 29).is_err()); // century non-leap
        assert!(DateYmd::new(2025, 4, 31).is_err());
    }

    #[test]
    fn is_before() {
        let d1 = DateYmd::new(2025, 1, 1).unwrap();
        let d2 = DateYmd::new(2025, 1, 2).unwrap();
        let d3 = DateYmd::new(2024, 12, 31).unwrap();
        assert!(d1.is_before(&d2));
        assert!(!d2.is_before(&d1));
        assert!(d3.is_before(&d1));
        assert!(!d1.is_before(&d1));
    }
}
