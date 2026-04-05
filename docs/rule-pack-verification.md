# Rule Pack Verification

## Goal

TaxVault now uses three tax-table trust states:

- `unverified`: calculations below the tax-table threshold stay locked
- `machine_checked`: local/private estimates may run, but no human reviewer signoff is recorded
- `human_verified`: a named reviewer recorded a real review suitable for public estimate-release gates

`human_verified` must never be inferred from placeholder-free CSV content alone.

## Required CSV Header Metadata

The top comment block in `tax-table/federal_2025_table.csv` must include these lines before a release can be marked `human_verified`:

```text
# verification.status=human_verified
# verification.source_reference=<official source reviewed>
# verification.reviewed_by=<named reviewer>
# verification.reviewed_at=<YYYY-MM-DD>
# verification.method=<how the reviewer checked the table>
```

For local/private estimates without a human reviewer, `machine_checked` must include:

```text
# verification.status=machine_checked
# verification.source_reference=<official source reviewed>
# verification.method=<how the automated check was performed>
```

If any required field is missing, the repository must not treat the table as higher-trust than the recorded status allows.

## Review Procedure

1. Compare the generated CSV against the official IRS source for the tax year.
2. Confirm coverage is continuous from `$0` through the required table range.
3. Confirm the midpoint rounding convention and bracket transitions match the official source.
4. Run `python3 scripts/verify_tax_table.py --report --check`.
5. Run the full local verification flow from the repo root.
6. Record the reviewer name, date, and method in the CSV header if you are moving to `human_verified`.
7. Complete `docs/release-checklist.md` before public release.

## Current Repository Policy

Until the metadata above is completed by a named reviewer, keep the repository at most `machine_checked`:

```text
# verification.status=machine_checked
```

Local/private estimate calculations may run while the embedded table is `machine_checked`, but public estimate releases should remain blocked until it is `human_verified`.

If you need to regenerate `tax-table/federal_2025_table.csv`, use `python3 scripts/verify_tax_table.py --write --report --check`. That rewrite flow preserves the existing verification metadata unless you explicitly override it.
