# Tax Vault

Tax Vault is an offline-first Rust workspace for narrow-scope 2025 federal tax estimates.

It is intentionally limited. The current product supports a small set of return types and income documents, runs entirely in the browser, and is designed for estimate workflows only.

## Important Warning

Tax Vault is **not** a filing product.

Do not use it to file a return, sign a tax document, or decide how much to pay the IRS. Missing income, deductions, credits, or unsupported forms can make the estimate wrong.

## What The App Supports

- Filing statuses: `Single`, `Married Filing Jointly`, `Head of Household`
- Income: `W-2`, `SSA-1099`, `1099-INT`, `1099-DIV`
- Standard deduction, including age 65+ and blindness adjustments
- Child Tax Credit and Credit for Other Dependents for entered dependents
- Guided manual entry helpers for supported paper forms
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
- OCR or document image upload
- Filing-ready review

## Privacy Model

The web app is designed to run entirely in the browser. Tax data entered into the UI is processed locally by the compiled WASM engine.

There is currently no OCR upload flow and no cloud document-processing dependency in the repo.

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

## Prerequisites

- Rust `1.94.1` or newer
- `wasm-pack 0.14+` for rebuilding the browser bundle
- A local static file server such as `python3 -m http.server`

## Local Development

Run the full verification flow from the workspace root:

```sh
cargo fmt --all --check
cargo clippy --workspace --all-targets --all-features -- -D warnings
cargo test --workspace
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

## Test Data

Golden vectors live in `tests/golden_vectors/` and cover the currently supported return slice, including Social Security benefit taxability edge cases.

## GitHub Upload Notes

This repo is now set up with:

- a root `.gitignore`
- line-ending and editor defaults
- a basic GitHub Actions CI workflow
- updated workspace metadata for crate descriptions and README inheritance

Two decisions are still intentionally left to the repo owner:

- the repository URL
- the software license

Choose those before making the repo public.
