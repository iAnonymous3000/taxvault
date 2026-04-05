# Production Readiness

## Current Status

Current recommendation: `NO-GO`

Reason:

- Tax Vault is intentionally scoped as a narrow 2025 federal estimate tool.
- The embedded 2025 tax table is currently marked `unverified`.
- Head of Household and some deduction eligibility checks still require manual review.

## Estimate-Only Release Gate

All items below must be true before a public estimate release:

- `tax-table/federal_2025_table.csv` has `verification.status=verified` plus recorded review metadata.
- `cargo fmt --all --check` passes.
- `cargo clippy --workspace --all-targets --all-features -- -D warnings` passes.
- `cargo test --workspace` passes.
- Browser smoke tests pass against the release build.
- Unsupported scenarios are blocked before compute.
- Release approver signs off on scope wording and disclaimer copy.
- Release checklist in `docs/release-checklist.md` is completed.
- Incident contacts and rollback plan in `docs/incident-runbook.md` are current.

## Filing-Grade Release Gate

This repo is not currently scoped for filing-grade release.

Do not reclassify Tax Vault as filing-ready or payment-grade until all of the following are separately planned and completed:

- complete federal form and schedule support for the intended filing scope
- formal tax subject-matter review for rule logic and edge cases
- reproducible annual rule update process with reviewer signoff
- release approval and incident ownership model
- legal, privacy, and compliance review for the intended operating model
