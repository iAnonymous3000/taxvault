use crate::filer::{
    Dependent, DividendIncome, FilerInfo, FilerRole, FilingStatus, InterestIncome,
    SocialSecurityIncome, W2Income,
};

pub struct TaxFacts {
    pub tax_year: u16,
    pub filing_status: FilingStatus,
    pub primary_filer: FilerInfo,
    pub spouse: Option<FilerInfo>,
    pub dependents: Vec<Dependent>,
    pub w2_income: Vec<W2Income>,
    pub interest_income: Vec<InterestIncome>,
    pub dividend_income: Vec<DividendIncome>,
    pub social_security_income: Vec<SocialSecurityIncome>,
}

impl TaxFacts {
    /// Returns the filing status for convenience.
    pub fn filing_status(&self) -> FilingStatus {
        self.filing_status
    }

    /// Iterates W-2s for a given filer role.
    pub fn w2s_for_role(&self, role: FilerRole) -> impl Iterator<Item = &W2Income> {
        self.w2_income.iter().filter(move |w| w.recipient == role)
    }

    /// Iterates 1099-INT forms for a given filer role.
    pub fn interest_for_role(&self, role: FilerRole) -> impl Iterator<Item = &InterestIncome> {
        self.interest_income
            .iter()
            .filter(move |interest| interest.recipient == role)
    }

    /// Iterates 1099-DIV forms for a given filer role.
    pub fn dividends_for_role(&self, role: FilerRole) -> impl Iterator<Item = &DividendIncome> {
        self.dividend_income
            .iter()
            .filter(move |dividend| dividend.recipient == role)
    }

    /// Iterates SSA-1099 forms for a given filer role.
    pub fn social_security_for_role(
        &self,
        role: FilerRole,
    ) -> impl Iterator<Item = &SocialSecurityIncome> {
        self.social_security_income
            .iter()
            .filter(move |benefit| benefit.recipient == role)
    }
}
