#!/usr/bin/env python3

import argparse
import csv
import re
import sys
from dataclasses import dataclass
from datetime import datetime
from decimal import Decimal, ROUND_HALF_UP
from pathlib import Path


ROOT = Path(__file__).resolve().parent.parent
RULES_PATH = ROOT / "rules" / "federal_2025.toml"
CSV_PATH = ROOT / "tax-table" / "federal_2025_table.csv"
IRS_SOURCE_URL = "https://www.irs.gov/instructions/i1040gi"
DEFAULT_SOURCE_REFERENCE = (
    "2025 IRS Instructions for Form 1040 and 1040-SR tax table "
    f"({IRS_SOURCE_URL})"
)
DEFAULT_PENDING_REASON = "Formal reviewer signoff has not yet been recorded in the repository."
DEFAULT_MACHINE_CHECK_METHOD = (
    "Generated rows matched the embedded CSV using scripts/verify_tax_table.py --check; "
    "no human reviewer signoff is recorded."
)
CSV_HEADER = "income_at_least,income_less_than,tax_single,tax_mfj,tax_hoh"

BRACKET_HEADER = re.compile(r"^\[\[tax_brackets\.([a-z_]+)\]\]$")


@dataclass(frozen=True)
class VerificationMetadata:
    status: str = ""
    source_reference: str = ""
    reviewed_by: str = ""
    reviewed_at: str = ""
    method: str = ""
    review_type: str = ""
    pending_reason: str = ""


def normalize_status(status):
    raw = (status or "").strip()
    if raw == "verified":
        return "human_verified"
    return raw


def parse_args():
    parser = argparse.ArgumentParser(
        description="Generate, inspect, or verify the embedded 2025 federal tax table."
    )
    parser.add_argument(
        "--check",
        action="store_true",
        help="Fail if the checked-in CSV rows or verification metadata are invalid.",
    )
    parser.add_argument(
        "--report",
        action="store_true",
        help="Print the current verification status, metadata, and row-check summary.",
    )
    parser.add_argument(
        "--write",
        action="store_true",
        help="Rewrite the checked-in CSV using generated rows while preserving existing metadata by default.",
    )
    parser.add_argument(
        "--status",
        choices=("unverified", "machine_checked", "human_verified", "verified"),
        help="Verification status metadata to write with --write. 'verified' is accepted as a legacy alias for 'human_verified'.",
    )
    parser.add_argument(
        "--source-reference",
        help="Official source reference recorded in the CSV metadata.",
    )
    parser.add_argument(
        "--reviewed-by",
        help="Reviewer name to record when writing human_verified metadata.",
    )
    parser.add_argument(
        "--reviewed-at",
        help="Review date (YYYY-MM-DD) to record when writing human_verified metadata.",
    )
    parser.add_argument(
        "--method",
        help="Verification method to record when writing machine_checked or human_verified metadata.",
    )
    parser.add_argument(
        "--review-type",
        help="Optional review type note such as 'ai-assisted' or 'human'.",
    )
    parser.add_argument(
        "--pending-reason",
        help="Pending reason to record when writing unverified metadata.",
    )
    args = parser.parse_args()
    if not args.check and not args.report and not args.write:
        parser.error("pass --check, --report, --write, or any combination of them")
    return args


def parse_tax_brackets(path):
    brackets = {
        "single": [],
        "married_filing_jointly": [],
        "head_of_household": [],
    }
    current_status = None
    current_bracket = None

    def flush_current():
        nonlocal current_bracket
        if current_status is None or current_bracket is None:
            return
        if "min" not in current_bracket or "rate" not in current_bracket:
            raise ValueError(f"incomplete bracket for {current_status}: {current_bracket}")
        brackets[current_status].append(current_bracket)
        current_bracket = None

    for raw_line in list(path.read_text().splitlines()) + ["[[end]]"]:
        stripped = raw_line.strip()
        match = BRACKET_HEADER.match(stripped)
        if match or stripped == "[[end]]":
            flush_current()
            if stripped == "[[end]]":
                break
            current_status = match.group(1)
            if current_status not in brackets:
                raise ValueError(f"unsupported filing status section {current_status}")
            current_bracket = {}
            continue

        if current_status is None or not stripped or stripped.startswith("#"):
            continue

        if "=" not in stripped:
            continue
        key, value = (part.strip() for part in stripped.split("=", 1))
        if key not in {"min", "max", "rate"}:
            continue
        current_bracket[key] = Decimal(value)

    return brackets


def iter_table_ranges():
    opening_ranges = [(0, 5), (5, 15), (15, 25), (25, 50)]
    for row in opening_ranges:
        yield row

    lower = 50
    while lower < 3000:
        yield (lower, lower + 25)
        lower += 25

    while lower < 100000:
        yield (lower, lower + 50)
        lower += 50


def midpoint(lower, upper):
    return (Decimal(lower) + Decimal(upper)) / Decimal(2)


def compute_tax_at_income(income, brackets):
    total = Decimal("0")
    for bracket in brackets:
        lower = bracket["min"]
        upper = bracket.get("max")
        if income <= lower:
            break
        capped = income if upper is None else min(income, upper)
        taxable_amount = capped - lower
        if taxable_amount > 0:
            total += taxable_amount * bracket["rate"]
        if upper is None or income < upper:
            break
    return total


def rounded_whole_dollar(value):
    return value.quantize(Decimal("1"), rounding=ROUND_HALF_UP)


def generate_expected_rows(brackets_by_status):
    rows = []
    for lower, upper in iter_table_ranges():
        row_midpoint = midpoint(lower, upper)
        rows.append(
            {
                "income_at_least": str(lower),
                "income_less_than": str(upper),
                "tax_single": str(
                    rounded_whole_dollar(
                        compute_tax_at_income(row_midpoint, brackets_by_status["single"])
                    )
                ),
                "tax_mfj": str(
                    rounded_whole_dollar(
                        compute_tax_at_income(
                            row_midpoint, brackets_by_status["married_filing_jointly"]
                        )
                    )
                ),
                "tax_hoh": str(
                    rounded_whole_dollar(
                        compute_tax_at_income(
                            row_midpoint, brackets_by_status["head_of_household"]
                        )
                    )
                ),
            }
        )
    return rows


def read_csv_text(path):
    return path.read_text()


def parse_verification_metadata(csv_content):
    values = {}
    for line in csv_content.splitlines():
        if not line.startswith("#"):
            continue
        body = line[1:].strip()
        if "=" not in body:
            continue
        key, value = (part.strip() for part in body.split("=", 1))
        values[key] = value

    return VerificationMetadata(
        status=normalize_status(values.get("verification.status", "")),
        source_reference=values.get("verification.source_reference", ""),
        reviewed_by=values.get("verification.reviewed_by", ""),
        reviewed_at=values.get("verification.reviewed_at", ""),
        method=values.get("verification.method", ""),
        review_type=values.get("verification.review_type", ""),
        pending_reason=values.get("verification.pending_reason", ""),
    )


def filtered_csv_lines(csv_content):
    return [line for line in csv_content.splitlines() if not line.startswith("#")]


def load_csv_rows_from_text(csv_content):
    rows = []
    reader = csv.DictReader(filtered_csv_lines(csv_content))
    for row in reader:
        rows.append(row)
    return rows


def compare_rows(expected_rows, actual_rows):
    if len(expected_rows) != len(actual_rows):
        return [f"row count mismatch: expected {len(expected_rows)}, got {len(actual_rows)}"]

    mismatches = []
    for index, (expected, actual) in enumerate(zip(expected_rows, actual_rows)):
        for field in expected:
            if actual.get(field) != expected[field]:
                mismatches.append(
                    f"row {index} field {field}: expected {expected[field]}, got {actual.get(field)}"
                )
                if len(mismatches) >= 20:
                    return mismatches
    return mismatches


def validate_metadata(metadata):
    issues = []
    status = normalize_status(metadata.status)

    if status not in {"human_verified", "machine_checked", "unverified"}:
        if status:
            issues.append(
                "verification.status must be 'unverified', 'machine_checked', or "
                f"'human_verified', got '{status}'"
            )
        else:
            issues.append("verification.status is required")
        return issues

    if not metadata.source_reference.strip():
        issues.append("verification.source_reference is required")

    if status == "human_verified":
        if not metadata.reviewed_by.strip():
            issues.append(
                "verification.reviewed_by is required when verification.status=human_verified"
            )
        if not metadata.reviewed_at.strip():
            issues.append(
                "verification.reviewed_at is required when verification.status=human_verified"
            )
        else:
            try:
                datetime.strptime(metadata.reviewed_at, "%Y-%m-%d")
            except ValueError:
                issues.append("verification.reviewed_at must use YYYY-MM-DD")
        if not metadata.method.strip():
            issues.append(
                "verification.method is required when verification.status=human_verified"
            )
    elif status == "machine_checked":
        if not metadata.method.strip():
            issues.append(
                "verification.method is required when verification.status=machine_checked"
            )
    else:
        if not metadata.pending_reason.strip():
            issues.append(
                "verification.pending_reason is required when verification.status=unverified"
            )

    return issues


def pick_value(override, existing, fallback=""):
    if override is not None:
        return override
    if existing:
        return existing
    return fallback


def resolve_write_metadata(existing_metadata, args):
    base = existing_metadata or VerificationMetadata()
    status = normalize_status(pick_value(args.status, base.status, "unverified"))
    status = status or "unverified"
    source_reference = pick_value(
        args.source_reference, base.source_reference, DEFAULT_SOURCE_REFERENCE
    ).strip()

    if status == "human_verified":
        return VerificationMetadata(
            status="human_verified",
            source_reference=source_reference,
            reviewed_by=pick_value(args.reviewed_by, base.reviewed_by).strip(),
            reviewed_at=pick_value(args.reviewed_at, base.reviewed_at).strip(),
            method=pick_value(args.method, base.method).strip(),
            review_type=pick_value(args.review_type, base.review_type).strip(),
        )

    if status == "machine_checked":
        return VerificationMetadata(
            status="machine_checked",
            source_reference=source_reference,
            method=pick_value(args.method, base.method, DEFAULT_MACHINE_CHECK_METHOD).strip(),
            review_type=pick_value(args.review_type, base.review_type, "automation").strip(),
        )

    return VerificationMetadata(
        status="unverified",
        source_reference=source_reference,
        pending_reason=pick_value(
            args.pending_reason, base.pending_reason, DEFAULT_PENDING_REASON
        ).strip(),
    )


def build_metadata_lines(metadata):
    lines = [f"# verification.status={metadata.status}"]
    lines.append(f"# verification.source_reference={metadata.source_reference}")
    if metadata.status == "human_verified":
        lines.append(f"# verification.reviewed_by={metadata.reviewed_by}")
        lines.append(f"# verification.reviewed_at={metadata.reviewed_at}")
        lines.append(f"# verification.method={metadata.method}")
        if metadata.review_type:
            lines.append(f"# verification.review_type={metadata.review_type}")
    elif metadata.status == "machine_checked":
        lines.append(f"# verification.method={metadata.method}")
        if metadata.review_type:
            lines.append(f"# verification.review_type={metadata.review_type}")
    else:
        lines.append(f"# verification.pending_reason={metadata.pending_reason}")
    lines.append("# 2025 Federal Tax Table")
    lines.append("# Generated using IRS midpoint rounding convention per Form 1040 Instructions.")
    lines.append("# Covers taxable income $0 to $99,999 using the published IRS row structure.")
    return lines


def write_csv(path, metadata_lines, rows):
    lines = metadata_lines + [CSV_HEADER]
    for row in rows:
        lines.append(
            ",".join(
                [
                    row["income_at_least"],
                    row["income_less_than"],
                    row["tax_single"],
                    row["tax_mfj"],
                    row["tax_hoh"],
                ]
            )
        )
    path.write_text("\n".join(lines) + "\n")


def lock_status(metadata, row_issues, metadata_issues):
    if row_issues:
        return (
            "LOCKED",
            "LOCKED",
            "checked-in tax table rows differ from generated expectations",
        )
    if metadata_issues:
        return (
            "LOCKED",
            "LOCKED",
            "verification metadata is incomplete or invalid",
        )
    if metadata.status == "human_verified":
        return (
            "ENABLED",
            "READY",
            "human_verified metadata is present and generated rows match the checked-in CSV",
        )
    if metadata.status == "machine_checked":
        return (
            "ENABLED",
            "LOCKED",
            "machine_checked metadata is present, so local/private estimates can run, but no human signoff is recorded for public release",
        )
    return (
        "LOCKED",
        "LOCKED",
        "verification.status is still marked unverified",
    )


def print_report(metadata, actual_rows, row_issues, metadata_issues):
    local_state, public_state, reason = lock_status(metadata, row_issues, metadata_issues)
    print("Tax Table Verification Report")
    print(f"- CSV path: {CSV_PATH}")
    print(f"- Row count: {len(actual_rows)}")
    print(f"- Row generation check: {'PASS' if not row_issues else 'FAIL'}")
    print(f"- Verification status: {metadata.status or '(missing)'}")
    if metadata.source_reference:
        print(f"- Source reference: {metadata.source_reference}")
    if metadata.status == "human_verified":
        print(f"- Reviewed by: {metadata.reviewed_by or '(missing)'}")
        print(f"- Reviewed at: {metadata.reviewed_at or '(missing)'}")
        print(f"- Verification method: {metadata.method or '(missing)'}")
        if metadata.review_type:
            print(f"- Review type: {metadata.review_type}")
    elif metadata.status == "machine_checked":
        print(f"- Verification method: {metadata.method or '(missing)'}")
        if metadata.review_type:
            print(f"- Review type: {metadata.review_type}")
    else:
        print(f"- Pending reason: {metadata.pending_reason or '(missing)'}")
    print(f"- Local estimate state: {local_state}")
    print(f"- Public release state: {public_state}")
    print(f"- Gate reason: {reason}")

    if metadata_issues:
        print("- Metadata issues:")
        for issue in metadata_issues:
            print(f"  - {issue}")

    if row_issues:
        print("- Row issues:")
        for issue in row_issues:
            print(f"  - {issue}")


def main():
    args = parse_args()
    brackets = parse_tax_brackets(RULES_PATH)
    expected_rows = generate_expected_rows(brackets)

    csv_content = read_csv_text(CSV_PATH)
    existing_metadata = parse_verification_metadata(csv_content)

    if args.write:
        write_metadata = resolve_write_metadata(existing_metadata, args)
        write_issues = validate_metadata(write_metadata)
        if write_issues:
            for issue in write_issues:
                print(issue, file=sys.stderr)
            return 1

        write_csv(CSV_PATH, build_metadata_lines(write_metadata), expected_rows)
        print(f"wrote {CSV_PATH}")
        csv_content = read_csv_text(CSV_PATH)
        existing_metadata = parse_verification_metadata(csv_content)

    actual_rows = load_csv_rows_from_text(csv_content)
    row_issues = compare_rows(expected_rows, actual_rows)
    metadata_issues = validate_metadata(existing_metadata)

    if args.report:
        print_report(existing_metadata, actual_rows, row_issues, metadata_issues)

    if args.check:
        issues = metadata_issues + row_issues
        if issues:
            for issue in issues:
                print(issue, file=sys.stderr)
            return 1
        print("tax table rows and verification metadata are internally consistent")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
