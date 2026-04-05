#!/usr/bin/env python3

import argparse
import csv
import re
import sys
from decimal import Decimal, ROUND_HALF_UP
from pathlib import Path


ROOT = Path(__file__).resolve().parent.parent
RULES_PATH = ROOT / "rules" / "federal_2025.toml"
CSV_PATH = ROOT / "tax-table" / "federal_2025_table.csv"
IRS_SOURCE_URL = "https://www.irs.gov/instructions/i1040gi"

BRACKET_HEADER = re.compile(r"^\[\[tax_brackets\.([a-z_]+)\]\]$")


def parse_args():
    parser = argparse.ArgumentParser(
        description="Generate or verify the embedded 2025 federal tax table."
    )
    parser.add_argument(
        "--check",
        action="store_true",
        help="Fail if the checked-in CSV does not match the generated table rows.",
    )
    parser.add_argument(
        "--write",
        action="store_true",
        help="Rewrite the checked-in CSV using the generated table rows.",
    )
    parser.add_argument(
        "--status",
        choices=("verified", "unverified"),
        default="unverified",
        help="Verification status metadata to write with --write.",
    )
    parser.add_argument(
        "--source-reference",
        default="2025 IRS Instructions for Form 1040 and 1040-SR tax table "
        f"({IRS_SOURCE_URL})",
        help="Official source reference recorded in the CSV metadata.",
    )
    parser.add_argument(
        "--reviewed-by",
        help="Reviewer name to record when writing verified metadata.",
    )
    parser.add_argument(
        "--reviewed-at",
        help="Review date (YYYY-MM-DD) to record when writing verified metadata.",
    )
    parser.add_argument(
        "--method",
        help="Verification method to record when writing verified metadata.",
    )
    parser.add_argument(
        "--review-type",
        help="Optional review type note such as 'ai-assisted' or 'human'.",
    )
    parser.add_argument(
        "--pending-reason",
        default="Formal reviewer signoff has not yet been recorded in the repository.",
        help="Pending reason to record when writing unverified metadata.",
    )
    args = parser.parse_args()
    if not args.check and not args.write:
        parser.error("pass --check, --write, or both")
    if args.status == "verified":
        missing = [
            flag
            for flag, value in (
                ("--reviewed-by", args.reviewed_by),
                ("--reviewed-at", args.reviewed_at),
                ("--method", args.method),
            )
            if not value
        ]
        if missing:
            parser.error(
                "verified writes require "
                + ", ".join(missing)
            )
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


def load_csv_rows(path):
    rows = []
    with path.open(newline="") as handle:
        filtered = [line for line in handle if not line.startswith("#")]
    reader = csv.DictReader(filtered)
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


def build_metadata_lines(args):
    lines = [f"# verification.status={args.status}"]
    lines.append(f"# verification.source_reference={args.source_reference}")
    if args.status == "verified":
        lines.append(f"# verification.reviewed_by={args.reviewed_by}")
        lines.append(f"# verification.reviewed_at={args.reviewed_at}")
        lines.append(f"# verification.method={args.method}")
        if args.review_type:
            lines.append(f"# verification.review_type={args.review_type}")
    else:
        lines.append(f"# verification.pending_reason={args.pending_reason}")
    lines.append("# 2025 Federal Tax Table")
    lines.append("# Generated using IRS midpoint rounding convention per Form 1040 Instructions.")
    lines.append("# Covers taxable income $0 to $99,999 using the published IRS row structure.")
    return lines


def write_csv(path, metadata_lines, rows):
    header = "income_at_least,income_less_than,tax_single,tax_mfj,tax_hoh"
    lines = metadata_lines + [header]
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


def main():
    args = parse_args()
    brackets = parse_tax_brackets(RULES_PATH)
    expected_rows = generate_expected_rows(brackets)

    if args.check:
        mismatches = compare_rows(expected_rows, load_csv_rows(CSV_PATH))
        if mismatches:
            for mismatch in mismatches:
                print(mismatch, file=sys.stderr)
            return 1
        print("tax table rows match generated IRS-format expectations")

    if args.write:
        metadata_lines = build_metadata_lines(args)
        write_csv(CSV_PATH, metadata_lines, expected_rows)
        print(f"wrote {CSV_PATH}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
