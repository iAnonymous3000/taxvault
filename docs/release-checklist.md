# Release Checklist

Use this checklist for any public estimate release.

## Scope and Safety

- Confirm the release is still estimate-only and not filing-ready.
- Confirm unsupported forms and schedules are still clearly disclosed in the UI and README.
- Confirm the support-review flow blocks unsupported scenarios before compute.

## Rule and Table Review

- Confirm `tax-table/federal_2025_table.csv` review metadata is present and current.
- Confirm `verification.reviewed_by` names the actual approver.
- Confirm `verification.reviewed_at` matches the recorded review date.
- Confirm `verification.method` describes the review that was actually performed.
- Run `python3 scripts/verify_tax_table.py --check`

## Verification Commands

- Run `cargo fmt --all --check`
- Run `cargo clippy --workspace --all-targets --all-features -- -D warnings`
- Run `cargo test --workspace`
- Run browser smoke tests against the release build

## Release Approval

- Record release approver:
- Record rule-pack approver:
- Record release date:
- Record deployed commit:

If any item is incomplete, the release is `NO-GO`.
