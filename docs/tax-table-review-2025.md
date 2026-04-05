# 2025 Tax Table Review

## Source

- IRS 2025 Instructions for Form 1040 and 1040-SR:
  `https://www.irs.gov/instructions/i1040gi`

## What Was Reviewed

- The opening IRS table rows use finer-grained ranges than the previous repository CSV.
- The IRS instructions include a worked example for taxable income `$25,300` to `$25,350`.
- The embedded CSV now follows the published IRS row structure:
  - `0-5`, `5-15`, `15-25`, `25-50`
  - `$25` rows from `$50` through `$3,000`
  - `$50` rows from `$3,000` through `$100,000`

## Repository Check

Run:

```sh
python3 scripts/verify_tax_table.py --check
```

This regenerates the expected table from `rules/federal_2025.toml` using midpoint rounding and fails if the checked-in CSV differs.

## Formal Signoff

After reviewing the official IRS source, record the final verification metadata in `tax-table/federal_2025_table.csv` and complete `docs/release-checklist.md`.
