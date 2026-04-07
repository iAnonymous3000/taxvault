# Tax Vault

Tax Vault is an offline-first Rust workspace for narrow-scope 2025 federal tax estimates.

It is intentionally limited. The current product supports a small set of return types and income documents, runs entirely in the browser, and is designed for estimate workflows only.

## Project Status

Tax Vault is open for review and collaboration as an estimate-only project.

The repository currently supports local/private estimate runs because the checked-in 2025 tax table is `machine_checked`.

It is not approved for a public estimate release yet. The public-release gate remains locked until a named reviewer records `human_verified` metadata for the embedded 2025 tax table and the release checklist is completed.

Current recommendation: `NO-GO` for public release.

Known release blockers:

- `tax-table/federal_2025_table.csv` is still `machine_checked`, not `human_verified`
- `docs/release-checklist.md` still needs named approvers, sign-off dates, and the deployed commit SHA
- The stronger public-release verification command must pass: `python3 scripts/verify_tax_table.py --report --check --require-public-release-ready`

## Important Warning

Tax Vault is **not** a filing product.

Do not use it to file a return, sign a tax document, or decide how much to pay the IRS. Missing income, deductions, credits, or unsupported forms can make the estimate wrong.

## What The App Supports

- Filing statuses: `Single`, `Married Filing Jointly`, `Head of Household` for resident qualifying-person cases TaxVault can screen from current inputs
- Income: `W-2`, `SSA-1099`, `1099-INT`, `1099-DIV`
- Standard deduction, including age 65+ and blindness adjustments
- Student loan interest paid, subject to the 2025 cap and MAGI phaseout rules, after the filer confirms it was for a qualified loan they were legally obligated to pay
- Estimated tax payments entered by the user (Form 1040 line 26)
- Child Tax Credit and Credit for Other Dependents for entered dependents
- Guided manual entry helpers for supported paper forms
- Multiple local PDF/image reference uploads per supported form card for on-screen review
- Draft Form 1040 preview with browser print/save-PDF export for local review
- Anonymized support snapshot export for bug reports without names, dates of birth, SSNs, EINs, or issuer names
- Browser-only execution for the web app

## What The App Does Not Support

- EIC
- Itemized deductions
- Pensions and annuities
- IRA distributions
- Traditional IRA deductions
- HSA deductions
- Schedule C
- Capital gains schedules
- ACA credits
- Most federal forms and schedules outside the supported slice
- Head of Household cases that depend on a parent or an `other` relationship rather than a resident qualifying person TaxVault can screen
- Returns where someone else can claim the filer or spouse as a dependent
- OCR or importing fields from uploaded PDFs/images
- Filing-ready review
- Official IRS form PDFs ready for filing

## Privacy Model

The web app is designed to run entirely in the browser. Tax data entered into the UI is processed locally by the compiled WASM engine.

Local PDF/image references are previewed in-memory inside the current browser session so you can compare several documents on screen without sending them to a server.

There is currently no OCR/import flow for local PDFs or images and no cloud document-processing dependency in the repo.

## Repository Layout

- `crates/taxvault-core`: shared domain types and structural validation
- `crates/taxvault-engine`: policy checks and tax computation logic
- `crates/taxvault-forms`: Form 1040 line mapping
- `crates/taxvault-loader`: JSON, TOML, and CSV parsing plus rule-pack assembly
- `crates/taxvault-wasm`: browser-facing WASM wrapper
- `rules/`: tax rule packs
- `tax-table/`: published tax table data
- `tests/golden_vectors/`: end-to-end scenario fixtures
- `web/`: static browser UI

## Community Docs

- Contribution guide: `CONTRIBUTING.md`
- Security policy: `SECURITY.md`
- Code of conduct: `CODE_OF_CONDUCT.md`

## Prerequisites

- Rust `1.94.1` or newer
- Python `3` or newer
- Node.js `22` or newer plus npm (`24` is what CI uses)
- `wasm-pack 0.14+` for rebuilding the browser bundle
- A local static file server such as `python3 -m http.server`

## Local Development

For engine and rule-pack work, you can run the core Rust/Python verification flow from the workspace root:

```sh
cargo fmt --all --check
cargo clippy --workspace --all-targets --all-features -- -D warnings
cargo clippy --target wasm32-unknown-unknown -p taxvault-wasm -- -D warnings
cargo test --workspace
python3 -m unittest discover -s tests -p 'test_*.py'
python3 scripts/verify_tax_table.py --report --check
```

For browser verification, install the Node dependencies and run:

```sh
npm ci
npm run check:web-js
(cd crates/taxvault-wasm && wasm-pack build --target web --out-dir ../../web/pkg --release)
npx playwright install chromium
npm run test:web-smoke
```

`npm ci` installs the Playwright test runner used for browser smoke coverage. `npx playwright install chromium` only needs to be repeated when the Playwright version changes or your local browser cache is cleared.

If you want the local browser smoke suite to match CI's cross-browser coverage, install the extra browsers and opt in explicitly:

```sh
npx playwright install firefox webkit
PLAYWRIGHT_ALL_BROWSERS=1 npm run test:web-smoke
```

If you want local verification to mirror CI more closely, also install `cargo-audit` and run:

```sh
cargo install cargo-audit --locked
cargo audit
```

## Rebuild The Web Bundle

The generated browser package in `web/pkg` is ignored by git. Rebuild it before local browser testing or before deploying the static web app:

```sh
cd crates/taxvault-wasm
wasm-pack build --target web --out-dir ../../web/pkg --release
```

## Run The Web App Locally

After rebuilding `web/pkg`, serve the `web/` directory with any static file server:

```sh
cd web
python3 -m http.server 8000
```

Then open [http://localhost:8000](http://localhost:8000).

## Run Browser Smoke Tests

Tax Vault includes Playwright smoke tests for the browser flow in `tests/playwright/smoke.spec.js`.

They currently cover:

- the disclaimer gate and supported W-2 readiness when the tax table is machine-checked
- pre-compute unsupported-case blocking for Additional Medicare Tax
- Head of Household scope blocking before income entry alongside machine-check trust warnings
- legacy draft restore with SSN and EIN redaction
- support snapshot export redaction for shareable debugging artifacts
- printable draft Form 1040 preview rendering

To run them locally:

```sh
npm ci
npx playwright install chromium
cd crates/taxvault-wasm
wasm-pack build --target web --out-dir ../../web/pkg --release
cd ../..
npm run test:web-smoke
```

The Playwright runner starts a local static server automatically and exercises the built `web/` bundle in Chromium by default. CI also runs the same suite in Firefox and WebKit.

## Critical Software Controls

Tax Vault is still an estimate-only product, not filing-grade software.

The checked-in 2025 tax table is currently marked `machine_checked` in `tax-table/federal_2025_table.csv`. That enables local/private estimate calculations, but a named reviewer still needs to record `human_verified` metadata before any public estimate release should be considered.

Before any public estimate release, the stronger repository gate must pass:

```sh
python3 scripts/verify_tax_table.py --report --check --require-public-release-ready
```

Use these docs before any public release:

- `docs/production-readiness.md`
- `docs/rule-pack-verification.md`
- `docs/tax-table-review-2025.md`
- `docs/release-checklist.md`
- `docs/incident-runbook.md`

## Deploy To GitHub Pages

This repo includes a GitHub Pages workflow at `.github/workflows/pages.yml`.

To use it:

1. Open `Settings` -> `Pages`
2. Set `Source` to `GitHub Actions`
3. Push to `main`
4. Wait for the `Deploy Pages` workflow to finish

The deploy workflow now runs after the `CI` workflow succeeds on `main`, so the published Pages artifact tracks the exact commit that passed automated checks.

The Pages build also enforces `python3 scripts/verify_tax_table.py --report --check --require-public-release-ready`, so it will refuse to publish while the embedded tax table remains `machine_checked`.

The site will usually be published at:

`https://<owner>.github.io/<repository>/`

For this repository in its current location, that is:

`https://ianonymous3000.github.io/taxvault/`

## Test Data

Golden vectors live in `tests/golden_vectors/` and cover the currently supported return slice, including Social Security benefit taxability edge cases.

## Open Source Notes

The repository metadata and contributor guidance are in place for public collaboration.

The code in this repository is licensed under the Mozilla Public License 2.0. See `LICENSE`.
