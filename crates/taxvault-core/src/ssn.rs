use crate::error::ValidationError;
use zeroize::{Zeroize, ZeroizeOnDrop};

/// SSN stored as 9 raw digits. Never logged, never displayed by default.
/// Does NOT implement Serialize, Deserialize, Display, or Debug (that reveals digits).
#[derive(Clone, Zeroize, ZeroizeOnDrop)]
pub struct Ssn([u8; 9]);

impl Ssn {
    /// Parse and validate an SSN from a string like "123-45-6789" or "123456789".
    pub fn parse(input: &str) -> Result<Self, ValidationError> {
        let ssn = Ssn(parse_digits(input)?);
        ssn.validate()?;
        Ok(ssn)
    }

    fn validate(&self) -> Result<(), ValidationError> {
        let area = self.0[0] as u16 * 100 + self.0[1] as u16 * 10 + self.0[2] as u16;
        let group = self.0[3] * 10 + self.0[4];
        let serial = self.0[5] as u16 * 1000
            + self.0[6] as u16 * 100
            + self.0[7] as u16 * 10
            + self.0[8] as u16;

        if area == 0 {
            return Err(ValidationError::InvalidSsn {
                reason: "area number cannot be 000".into(),
            });
        }
        if area == 666 {
            return Err(ValidationError::InvalidSsn {
                reason: "area number cannot be 666".into(),
            });
        }
        if (900..=999).contains(&area) {
            return Err(ValidationError::InvalidSsn {
                reason: format!("area number {area} is in reserved range 900-999"),
            });
        }
        if group == 0 {
            return Err(ValidationError::InvalidSsn {
                reason: "group number cannot be 00".into(),
            });
        }
        if serial == 0 {
            return Err(ValidationError::InvalidSsn {
                reason: "serial number cannot be 0000".into(),
            });
        }

        Ok(())
    }

    /// Returns "***-**-XXXX" where XXXX is the last four digits.
    pub fn masked(&self) -> String {
        format!(
            "***-**-{}{}{}{}",
            self.0[5], self.0[6], self.0[7], self.0[8]
        )
    }

    /// Returns a short-lived guard that derefs to the formatted SSN.
    /// The guard zeroes the buffer on drop.
    pub fn reveal(&self) -> SsnGuard {
        let formatted = format!(
            "{}{}{}-{}{}-{}{}{}{}",
            self.0[0],
            self.0[1],
            self.0[2],
            self.0[3],
            self.0[4],
            self.0[5],
            self.0[6],
            self.0[7],
            self.0[8]
        );
        SsnGuard {
            buf: zeroize::Zeroizing::new(formatted),
        }
    }
}

fn parse_digits(input: &str) -> Result<[u8; 9], ValidationError> {
    let bytes = input.as_bytes();
    match bytes {
        [a, b, c, d, e, f, g, h, i] if bytes.iter().all(|byte| byte.is_ascii_digit()) => Ok([
            digit(*a),
            digit(*b),
            digit(*c),
            digit(*d),
            digit(*e),
            digit(*f),
            digit(*g),
            digit(*h),
            digit(*i),
        ]),
        [a, b, c, b'-', d, e, b'-', f, g, h, i]
            if [a, b, c, d, e, f, g, h, i]
                .iter()
                .all(|byte| byte.is_ascii_digit()) =>
        {
            Ok([
                digit(*a),
                digit(*b),
                digit(*c),
                digit(*d),
                digit(*e),
                digit(*f),
                digit(*g),
                digit(*h),
                digit(*i),
            ])
        }
        _ => Err(ValidationError::InvalidSsn {
            reason: "expected format ######### or ###-##-####".into(),
        }),
    }
}

fn digit(byte: u8) -> u8 {
    byte - b'0'
}

impl std::fmt::Debug for Ssn {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "Ssn({})", self.masked())
    }
}

impl PartialEq for Ssn {
    fn eq(&self, other: &Self) -> bool {
        self.0 == other.0
    }
}

impl Eq for Ssn {}

impl std::hash::Hash for Ssn {
    fn hash<H: std::hash::Hasher>(&self, state: &mut H) {
        self.0.hash(state);
    }
}

pub struct SsnGuard {
    buf: zeroize::Zeroizing<String>,
}

impl std::ops::Deref for SsnGuard {
    type Target = str;
    fn deref(&self) -> &str {
        &self.buf
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn valid_ssns() {
        assert!(Ssn::parse("400-01-0001").is_ok());
        assert!(Ssn::parse("123-45-6789").is_ok());
        assert!(Ssn::parse("001-01-0001").is_ok());
        assert!(Ssn::parse("899-99-9999").is_ok());
    }

    #[test]
    fn area_000_rejected() {
        assert!(Ssn::parse("000-12-3456").is_err());
    }

    #[test]
    fn area_666_rejected() {
        assert!(Ssn::parse("666-12-3456").is_err());
    }

    #[test]
    fn area_900_999_rejected() {
        assert!(Ssn::parse("900-12-3456").is_err());
        assert!(Ssn::parse("950-12-3456").is_err());
        assert!(Ssn::parse("999-12-3456").is_err());
    }

    #[test]
    fn group_00_rejected() {
        assert!(Ssn::parse("123-00-6789").is_err());
    }

    #[test]
    fn serial_0000_rejected() {
        assert!(Ssn::parse("123-45-0000").is_err());
    }

    #[test]
    fn masked_display() {
        let ssn = Ssn::parse("123-45-6789").unwrap();
        assert_eq!(ssn.masked(), "***-**-6789");
    }

    #[test]
    fn reveal_and_drop() {
        let ssn = Ssn::parse("123-45-6789").unwrap();
        let guard = ssn.reveal();
        assert_eq!(&*guard, "123-45-6789");
    }

    #[test]
    fn debug_shows_masked() {
        let ssn = Ssn::parse("123-45-6789").unwrap();
        let dbg = format!("{:?}", ssn);
        assert!(dbg.contains("***-**-6789"));
        assert!(!dbg.contains("123"));
    }

    #[test]
    fn parse_without_dashes() {
        let ssn = Ssn::parse("123456789").unwrap();
        assert_eq!(ssn.masked(), "***-**-6789");
    }

    #[test]
    fn rejects_embedded_text() {
        assert!(Ssn::parse("abc123456789").is_err());
        assert!(Ssn::parse("123-45-6789xyz").is_err());
    }

    #[test]
    fn rejects_wrong_dash_positions() {
        assert!(Ssn::parse("12-345-6789").is_err());
        assert!(Ssn::parse("1234-56-789").is_err());
    }
}
