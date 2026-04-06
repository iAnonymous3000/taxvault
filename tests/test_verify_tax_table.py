#!/usr/bin/env python3

import argparse
import importlib.util
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parent.parent
SCRIPT_PATH = ROOT / "scripts" / "verify_tax_table.py"
SPEC = importlib.util.spec_from_file_location("verify_tax_table", SCRIPT_PATH)
MODULE = importlib.util.module_from_spec(SPEC)
assert SPEC.loader is not None
SPEC.loader.exec_module(MODULE)


class VerifyTaxTableScriptTests(unittest.TestCase):
    def test_validate_metadata_requires_pending_reason_for_unverified_tables(self):
        metadata = MODULE.parse_verification_metadata(
            "\n".join(
                [
                    "# verification.status=unverified",
                    "# verification.source_reference=IRS table",
                    "income_at_least,income_less_than,tax_single,tax_mfj,tax_hoh",
                ]
            )
        )

        issues = MODULE.validate_metadata(metadata)

        self.assertIn(
            "verification.pending_reason is required when verification.status=unverified",
            issues,
        )

    def test_validate_metadata_rejects_bad_human_verified_review_date(self):
        metadata = MODULE.VerificationMetadata(
            status="human_verified",
            source_reference="IRS table",
            reviewed_by="Release Approver",
            reviewed_at="04-05-2026",
            method="Compared generated rows against the official publication.",
        )

        issues = MODULE.validate_metadata(metadata)

        self.assertIn("verification.reviewed_at must use YYYY-MM-DD", issues)

    def test_validate_metadata_requires_method_for_machine_checked_status(self):
        metadata = MODULE.VerificationMetadata(
            status="machine_checked",
            source_reference="IRS table",
        )

        issues = MODULE.validate_metadata(metadata)

        self.assertIn(
            "verification.method is required when verification.status=machine_checked",
            issues,
        )

    def test_resolve_write_metadata_preserves_existing_human_verified_signoff(self):
        existing = MODULE.VerificationMetadata(
            status="human_verified",
            source_reference="IRS table",
            reviewed_by="Release Approver",
            reviewed_at="2026-04-05",
            method="Compared generated rows against the official publication.",
            review_type="human",
        )
        args = argparse.Namespace(
            status=None,
            source_reference=None,
            reviewed_by=None,
            reviewed_at=None,
            method=None,
            review_type=None,
            pending_reason=None,
        )

        resolved = MODULE.resolve_write_metadata(existing, args)

        self.assertEqual(resolved, existing)

    def test_resolve_write_metadata_defaults_new_machine_checked_metadata(self):
        args = argparse.Namespace(
            status="machine_checked",
            source_reference=None,
            reviewed_by=None,
            reviewed_at=None,
            method=None,
            review_type=None,
            pending_reason=None,
        )

        resolved = MODULE.resolve_write_metadata(MODULE.VerificationMetadata(), args)

        self.assertEqual(resolved.status, "machine_checked")
        self.assertEqual(resolved.source_reference, MODULE.DEFAULT_SOURCE_REFERENCE)
        self.assertEqual(resolved.method, MODULE.DEFAULT_MACHINE_CHECK_METHOD)
        self.assertEqual(resolved.review_type, "automation")

    def test_resolve_write_metadata_defaults_new_unverified_metadata(self):
        args = argparse.Namespace(
            status="unverified",
            source_reference=None,
            reviewed_by=None,
            reviewed_at=None,
            method=None,
            review_type=None,
            pending_reason=None,
        )

        resolved = MODULE.resolve_write_metadata(MODULE.VerificationMetadata(), args)

        self.assertEqual(resolved.status, "unverified")
        self.assertEqual(resolved.source_reference, MODULE.DEFAULT_SOURCE_REFERENCE)
        self.assertEqual(resolved.pending_reason, MODULE.DEFAULT_PENDING_REASON)

    def test_release_gate_issues_blocks_machine_checked_public_release(self):
        metadata = MODULE.VerificationMetadata(
            status="machine_checked",
            source_reference="IRS table",
            method="Generated rows matched the embedded CSV.",
        )

        issues = MODULE.release_gate_issues(
            metadata,
            row_issues=[],
            metadata_issues=[],
            require_public_release_ready=True,
        )

        self.assertEqual(
            issues,
            [
                "public release gate is not satisfied: machine_checked metadata is present, so local/private estimates can run, but no human signoff is recorded for public release"
            ],
        )

    def test_release_gate_issues_allows_human_verified_public_release(self):
        metadata = MODULE.VerificationMetadata(
            status="human_verified",
            source_reference="IRS table",
            reviewed_by="Release Approver",
            reviewed_at="2026-04-06",
            method="Compared generated rows against the official publication.",
        )

        issues = MODULE.release_gate_issues(
            metadata,
            row_issues=[],
            metadata_issues=[],
            require_public_release_ready=True,
        )

        self.assertEqual(issues, [])


if __name__ == "__main__":
    unittest.main(verbosity=2)
