# Contributing to Tax Vault

Thanks for taking an interest in Tax Vault.

This project is intentionally narrow: it is an estimate-only 2025 federal tax tool, not a filing product. Please keep that boundary in mind when proposing changes.

## Before You Start

- Read `README.md` for scope, supported cases, and local setup.
- Read `SECURITY.md` before reporting any privacy, data-handling, or safety-sensitive issue.
- Open an issue or start a discussion before large changes, especially if they broaden product scope.
- Contributions are expected to be compatible with the repository's MPL-2.0 license.

## Development Workflow

From the repository root, run:

```sh
cargo fmt --all --check
cargo clippy --workspace --all-targets --all-features -- -D warnings
cargo test --workspace
python3 -m unittest discover -s tests -p 'test_*.py'
python3 scripts/verify_tax_table.py --report --check
```

If you touch the web bundle, also rebuild:

```sh
cd crates/taxvault-wasm
wasm-pack build --target web --out-dir ../../web/pkg --release
```

If you run browser smoke tests on macOS, enable Safari automation first:

```sh
sudo safaridriver --enable
python3 tests/web_smoke.py
```

Safari's `Allow remote automation` setting must also be enabled.

## Scope Expectations

- Keep the app estimate-only unless the maintainer explicitly broadens the mission.
- Do not weaken or remove disclaimer, support-review, or trust-gating behavior without a matching design decision.
- For tax logic or rule-pack changes, add or update regression coverage and refresh any affected documentation.
- For user-facing behavior changes, prefer small, reviewable pull requests with a clear explanation of the impact.

## Pull Requests

- Keep changes focused.
- Include tests when behavior changes.
- Update docs when scope, setup, safety controls, or workflows change.
- Call out any assumptions, edge cases, or remaining follow-up work in the pull request description.

## Style

- Follow existing Rust, Python, and web code conventions in the repository.
- Prefer explicit, readable code over clever shortcuts.
- Preserve privacy-oriented and safety-oriented guardrails unless the change is intentionally revisiting them.
