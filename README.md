# Tax Vault

Tax Vault is an offline-first Rust workspace for narrow-scope 2025 federal tax estimates.

It is intentionally limited. The current product supports a small set of return types and income documents, runs entirely in the browser, and is designed for estimate workflows only.

## Project Status

Tax Vault is open for review and collaboration as an estimate-only project.

It is not approved for a public estimate release yet. The checked-in 2025 tax table is still `machine_checked`, not `human_verified`, so the repository's own release gate remains locked until a named reviewer records signoff.

## Important Warning

Tax Vault is **not** a filing product.

Do not use it to file a return, sign a tax document, or decide how much to pay the IRS. Missing income, deductions, credits, or unsupported forms can make the estimate wrong.

## What The App Supports

- Filing statuses: `Single`, `Married Filing Jointly`, `Head of Household`
- Income: `W-2`, `SSA-1099`, `1099-INT`, `1099-DIV`
- Standard deduction, including age 65+ and blindness adjustments
- Child Tax Credit and Credit for Other Dependents for entered dependents
- Guided manual entry helpers for supported paper forms
- Multiple local PDF/image reference uploads per supported form card for on-screen review
- Draft Form 1040 preview with browser print/save-PDF export for local review
- Browser-only execution for the web app

## What The App Does Not Support

- EIC
- Itemized deductions
- Pensions and annuities
- IRA distributions
- Schedule C
- Capital gains schedules
- ACA credits
- Most federal forms and schedules outside the supported slice
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
- Node.js `22` or newer plus npm
- `wasm-pack 0.14+` for rebuilding the browser bundle
- A local static file server such as `python3 -m http.server`

## Local Development

Run the full verification flow from the workspace root:

```sh
npm ci
cargo fmt --all --check
cargo clippy --workspace --all-targets --all-features -- -D warnings
cargo test --workspace
python3 -m unittest discover -s tests -p 'test_*.py'
npm run check:web-js
python3 scripts/verify_tax_table.py --report --check
(cd crates/taxvault-wasm && wasm-pack build --target web --out-dir ../../web/pkg --release)
npx playwright install chromium
npm run test:web-smoke
```

`npm ci` installs the Playwright test runner used for browser smoke coverage. `npx playwright install chromium` only needs to be repeated when the Playwright version changes or your local browser cache is cleared.

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
- Head of Household manual-review cautions alongside machine-check trust warnings
- legacy draft restore with SSN and EIN redaction
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

The Playwright runner starts a local static server automatically and exercises the built `web/` bundle in Chromium.

## Critical Software Controls

Tax Vault is still an estimate-only product, not filing-grade software.

The checked-in 2025 tax table is currently marked `machine_checked` in `tax-table/federal_2025_table.csv`. That enables local/private estimate calculations, but a named reviewer still needs to record `human_verified` metadata before any public estimate release should be considered.

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

The site will usually be published at:

`https://<owner>.github.io/<repository>/`

For this repository in its current location, that is:

`https://ianonymous3000.github.io/taxvault/`

## Test Data

Golden vectors live in `tests/golden_vectors/` and cover the currently supported return slice, including Social Security benefit taxability edge cases.

## Open Source Notes

The repository metadata and contributor guidance are in place for public collaboration.

The code in this repository is licensed under the Mozilla Public License 2.0. See `LICENSE`.
