# Incident Runbook

Use this runbook if a released build is found to have a tax logic, rule-pack, or scope-control issue.

## Immediate Actions

1. Stop promoting the current build.
2. If possible, disable public access to the affected build.
3. Preserve the exact deployed commit, rule pack, and tax table files.
4. Open an incident record with date, reporter, impact, and suspected scope.

## Triage

- Determine whether the issue is:
  - incorrect tax computation
  - unsupported case that was not blocked
  - rule-pack provenance or review failure
  - privacy or data-handling issue
- Identify the earliest affected release.
- Identify whether the issue affects all users or a narrow slice.

## Containment

- If the issue affects correctness, keep the app locked until a fixed build is ready.
- If the issue is limited to one rule pack or one release artifact, replace or roll back that artifact.
- Do not mark a replacement build `human_verified` until the review metadata is updated.

## Recovery

1. Apply the fix.
2. Re-run the full verification flow.
3. Re-run Playwright browser smoke tests.
4. Re-complete `docs/release-checklist.md`.
5. Record the new deployed commit and approver.

## Post-Incident Review

- Document root cause.
- Document why existing tests or process gates missed it.
- Add a regression test, release gate, or documentation change before the next release.
