# Rule Pack Verification

## Goal

`table_verified` must mean that a human reviewer recorded a real review of the embedded tax table metadata in the repository. It must not be inferred from placeholder-free CSV content alone.

## Required CSV Header Metadata

The top comment block in `tax-table/federal_2025_table.csv` must include these lines before a release can be marked verified:

```text
# verification.status=verified
# verification.source_reference=<official source reviewed>
# verification.reviewed_by=<named reviewer>
# verification.reviewed_at=<YYYY-MM-DD>
# verification.method=<how the reviewer checked the table>
```

If any required field is missing, or if `verification.status` is not `verified`, the app must treat the table as unverified.

## Review Procedure

1. Compare the generated CSV against the official IRS source for the tax year.
2. Confirm coverage is continuous from `$0` through the required table range.
3. Confirm the midpoint rounding convention and bracket transitions match the official source.
4. Run `python3 scripts/verify_tax_table.py --check`.
5. Run the full local verification flow from the repo root.
6. Record the reviewer name, date, and method in the CSV header.
7. Complete `docs/release-checklist.md` before public release.

## Current Repository Policy

Until the metadata above is completed by a named reviewer, keep:

```text
# verification.status=unverified
```

The browser product should remain locked for estimate calculations while the embedded table is unverified.
