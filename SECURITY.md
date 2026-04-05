# Security Policy

Tax Vault handles tax-estimate workflows and should be treated as safety-sensitive software even though it is not a filing product.

## Supported Branch

Until versioned releases exist, security fixes are tracked on `main`.

## What To Report Privately

Please report these issues privately:

- privacy or data-exposure bugs
- bypasses of support-review or estimate-locking controls
- incorrect tax computations that could materially mislead users
- trust-state, rule-pack, or verification regressions
- dependency or build-chain issues that affect released artifacts

Do not open a public issue for any report that could put users at risk.

## How To Report

Use GitHub's private vulnerability reporting for this repository if it is enabled.

If private vulnerability reporting is unavailable, contact the maintainer privately through GitHub before sharing details publicly.

Include:

- a short description of the issue
- affected commit, branch, or deployed build if known
- reproduction steps or a minimal test case
- impact assessment
- any suggested mitigation if you have one

## Response Expectations

The maintainer will try to acknowledge reports promptly, confirm whether the issue is reproducible, and coordinate a fix before public disclosure when practical.

Because this project is estimate-only and still maturing, reports about correctness and scope-control failures may be handled with the same priority as conventional security issues.
