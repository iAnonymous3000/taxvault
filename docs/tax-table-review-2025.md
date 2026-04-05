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
python3 scripts/verify_tax_table.py --report --check
```

This regenerates the expected table from `rules/federal_2025.toml` using midpoint rounding, validates the recorded verification metadata, and fails if the checked-in CSV differs.

## Safer Rewrite Flow

If you need to rewrite the CSV after updating brackets or row generation logic, the script now preserves the existing verification metadata by default:

```sh
python3 scripts/verify_tax_table.py --write --report --check
```

If you are recording a final signoff, write the verified metadata explicitly:

```sh
python3 scripts/verify_tax_table.py --write --status human_verified \
  --reviewed-by "Release Approver" \
  --reviewed-at 2026-04-05 \
  --method "Compared generated rows against the published IRS table."
```

If no human reviewer is available, keep the repository at `machine_checked` and use that state only for local/private estimates:

```sh
python3 scripts/verify_tax_table.py --write --status machine_checked --report --check
```

## Formal Signoff

After reviewing the official IRS source, record the final `human_verified` metadata in `tax-table/federal_2025_table.csv` and complete `docs/release-checklist.md`.
