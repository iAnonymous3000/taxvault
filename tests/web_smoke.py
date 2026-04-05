#!/usr/bin/env python3

import contextlib
import http.server
import json
import socket
import subprocess
import threading
import time
import unittest
import urllib.error
import urllib.request
from pathlib import Path


ROOT = Path(__file__).resolve().parent.parent
WEB_DIR = ROOT / "web"
DRIVER_START_TIMEOUT_SECONDS = 10
PAGE_WAIT_TIMEOUT_SECONDS = 20
POLL_INTERVAL_SECONDS = 0.1
WEBDRIVER_REQUEST_TIMEOUT_SECONDS = 10
SESSION_REQUEST_TIMEOUT_SECONDS = 30
SESSION_RETRY_COUNT = 3


def reserve_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.bind(("127.0.0.1", 0))
        return sock.getsockname()[1]


class QuietRequestHandler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, directory=None, **kwargs):
        super().__init__(*args, directory=str(WEB_DIR if directory is None else directory), **kwargs)

    def log_message(self, format, *args):
        return


class StaticWebServer:
    def __init__(self):
        self.port = reserve_port()
        self._server = http.server.ThreadingHTTPServer(("127.0.0.1", self.port), QuietRequestHandler)
        self._thread = threading.Thread(target=self._server.serve_forever, daemon=True)

    @property
    def url(self) -> str:
        return f"http://127.0.0.1:{self.port}/index.html"

    def start(self) -> None:
        self._thread.start()

    def stop(self) -> None:
        self._server.shutdown()
        self._server.server_close()
        self._thread.join(timeout=5)


class WebDriverError(RuntimeError):
    pass


class SafariDriver:
    def __init__(self):
        self.port = reserve_port()
        self._process = None

    def start(self) -> None:
        self._process = subprocess.Popen(
            ["safaridriver", "-p", str(self.port)],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
        deadline = time.time() + DRIVER_START_TIMEOUT_SECONDS
        last_error = None
        while time.time() < deadline:
            if self._process.poll() is not None:
                raise WebDriverError("safaridriver exited before accepting connections")

            try:
                self.request("GET", "/status")
                return
            except Exception as error:  # pragma: no cover - best-effort startup probing
                last_error = error
                time.sleep(POLL_INTERVAL_SECONDS)

        raise WebDriverError(f"safaridriver did not become ready: {last_error}")

    def stop(self) -> None:
        if self._process is None:
            return
        self._process.terminate()
        try:
            self._process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            self._process.kill()
            self._process.wait(timeout=5)

    def request(self, method: str, path: str, payload=None, timeout: float = WEBDRIVER_REQUEST_TIMEOUT_SECONDS):
        body = None if payload is None else json.dumps(payload).encode("utf-8")
        request = urllib.request.Request(
            f"http://127.0.0.1:{self.port}{path}",
            data=body,
            method=method,
            headers={"Content-Type": "application/json"},
        )

        try:
            with urllib.request.urlopen(request, timeout=timeout) as response:
                raw_body = response.read().decode("utf-8")
        except TimeoutError as error:
            raise WebDriverError(f"webdriver {method} {path} timed out after {timeout} seconds") from error
        except urllib.error.HTTPError as error:
            raw_body = error.read().decode("utf-8")
            try:
                parsed = json.loads(raw_body)
            except json.JSONDecodeError as decode_error:
                raise WebDriverError(
                    f"webdriver {method} {path} failed with unreadable response: {decode_error}"
                ) from error

            value = parsed.get("value", {})
            message = value.get("message", raw_body)
            raise WebDriverError(message) from error

        return json.loads(raw_body) if raw_body else {}

    def new_session(self):
        response = self.request(
            "POST",
            "/session",
            {"capabilities": {"alwaysMatch": {"browserName": "Safari"}}},
            timeout=SESSION_REQUEST_TIMEOUT_SECONDS,
        )
        value = response["value"]
        session_id = value.get("sessionId") or response.get("sessionId")
        if not session_id:
            raise WebDriverError(f"missing session id in response: {response}")
        return BrowserSession(self, session_id)


class BrowserSession:
    def __init__(self, driver: SafariDriver, session_id: str):
        self.driver = driver
        self.session_id = session_id

    def close(self) -> None:
        with contextlib.suppress(WebDriverError):
            self.driver.request("DELETE", f"/session/{self.session_id}")

    def navigate(self, url: str) -> None:
        self.driver.request("POST", f"/session/{self.session_id}/url", {"url": url})

    def execute(self, script: str, args=None):
        response = self.driver.request(
            "POST",
            f"/session/{self.session_id}/execute/sync",
            {"script": script, "args": list(args or [])},
        )
        return response["value"]

    def wait_for(self, predicate, message: str, timeout: float = PAGE_WAIT_TIMEOUT_SECONDS):
        deadline = time.time() + timeout
        last_error = None
        while time.time() < deadline:
            try:
                if predicate():
                    return
            except Exception as error:  # pragma: no cover - captured for debugging on failure
                last_error = error
            time.sleep(POLL_INTERVAL_SECONDS)

        if last_error is None:
            raise AssertionError(message)
        raise AssertionError(f"{message}: {last_error}")

    def click(self, selector: str) -> None:
        clicked = self.execute(
            """
            const element = document.querySelector(arguments[0]);
            if (!element || element.disabled) {
              return false;
            }
            element.click();
            return true;
            """,
            [selector],
        )
        if not clicked:
            raise AssertionError(f"could not click {selector}")

    def set_value(self, selector: str, value: str) -> None:
        updated = self.execute(
            """
            const element = document.querySelector(arguments[0]);
            if (!element) {
              return false;
            }
            element.focus();
            element.value = arguments[1];
            element.dispatchEvent(new Event("input", { bubbles: true }));
            element.dispatchEvent(new Event("change", { bubbles: true }));
            return true;
            """,
            [selector, value],
        )
        if not updated:
            raise AssertionError(f"could not set value for {selector}")

    def set_checked(self, selector: str, checked: bool) -> None:
        updated = self.execute(
            """
            const element = document.querySelector(arguments[0]);
            if (!element) {
              return false;
            }
            element.checked = Boolean(arguments[1]);
            element.dispatchEvent(new Event("input", { bubbles: true }));
            element.dispatchEvent(new Event("change", { bubbles: true }));
            return true;
            """,
            [selector, checked],
        )
        if not updated:
            raise AssertionError(f"could not set checked state for {selector}")

    def text(self, selector: str) -> str:
        text = self.execute(
            """
            const element = document.querySelector(arguments[0]);
            return element ? element.textContent.trim() : null;
            """,
            [selector],
        )
        if text is None:
            raise AssertionError(f"missing element for text lookup: {selector}")
        return text

    def texts(self, selector: str):
        return self.execute(
            """
            return Array.from(document.querySelectorAll(arguments[0]), (element) => element.textContent.trim())
              .filter(Boolean);
            """,
            [selector],
        )

    def class_list_contains(self, selector: str, class_name: str) -> bool:
        return bool(
            self.execute(
                """
                const element = document.querySelector(arguments[0]);
                return Boolean(element && element.classList.contains(arguments[1]));
                """,
                [selector, class_name],
            )
        )

    def is_disabled(self, selector: str) -> bool:
        return bool(
            self.execute(
                """
                const element = document.querySelector(arguments[0]);
                return Boolean(element && element.disabled);
                """,
                [selector],
            )
        )


class WebSmokeTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        if not (WEB_DIR / "pkg" / "taxvault_wasm.js").exists():
            raise AssertionError(
                "web/pkg is missing. Rebuild the WASM bundle before running browser smoke tests."
            )

        cls.server = StaticWebServer()
        cls.server.start()
        cls.driver = SafariDriver()
        cls.driver.start()

    @classmethod
    def tearDownClass(cls):
        cls.driver.stop()
        cls.server.stop()

    def setUp(self):
        last_error = None
        for attempt in range(SESSION_RETRY_COUNT):
            try:
                self.browser = self.driver.new_session()
                return
            except WebDriverError as error:
                last_error = error
                if attempt == SESSION_RETRY_COUNT - 1:
                    break
                type(self).driver.stop()
                type(self).driver = SafariDriver()
                type(self).driver.start()

        raise last_error

    def tearDown(self):
        self.browser.close()

    def open_app(self):
        self.browser.navigate(self.server.url)
        self.browser.wait_for(
            lambda: self.browser.class_list_contains("#loading", "hidden"),
            "app never finished loading",
        )
        self.browser.set_checked("#gateAcknowledge", True)
        self.browser.wait_for(
            lambda: not self.browser.execute("return document.querySelector('#gateContinueBtn').disabled;"),
            "disclaimer continue button never enabled",
        )
        self.browser.click("#gateContinueBtn")
        self.browser.wait_for(
            lambda: not self.browser.class_list_contains("#app", "hidden"),
            "app never opened after disclaimer acknowledgement",
        )

    def fill_step1_single(self):
        self.browser.set_value("#pFirst", "Alex")
        self.browser.set_value("#pLast", "Filer")
        self.browser.set_value("#pSsn", "400-01-0001")
        self.browser.set_value("#pDob", "1990-06-15")
        self.browser.click("#step1ContinueBtn")
        self.browser.wait_for(
            lambda: self.browser.class_list_contains("#step2", "active"),
            "step 2 never became active",
        )

    def add_supported_w2(self, wages: str = "60000"):
        self.browser.click("#addW2Btn")
        self.browser.set_value("#w2-1-employer", "Northwind Co")
        self.browser.set_value("#w2-1-ein", "12-3456789")
        self.browser.set_value("#w2-1-wages", wages)
        self.browser.set_value("#w2-1-fed-wh", "8000")
        self.browser.set_value("#w2-1-state-wh", "0")
        self.browser.set_value("#w2-1-ss-wages", wages)
        self.browser.set_value("#w2-1-ss-wh", "3720")
        self.browser.set_value("#w2-1-med-wages", wages)
        self.browser.set_value("#w2-1-med-wh", "870")

    def wait_for_ready_review(self):
        self.browser.wait_for(
            lambda: self.browser.text("#supportReviewBadge") == "Ready",
            "support review never reached the ready state",
        )
        self.browser.wait_for(
            lambda: not self.browser.is_disabled("#computeBtn"),
            "compute button never became enabled for a supported ready review",
        )

    def render_mock_result(self):
        mock_result = {
            "summary": {
                "tax_year": 2025,
                "filing_status": "Single",
                "total_wages": "60000",
                "total_taxable_interest": "125",
                "total_tax_exempt_interest": "50",
                "total_ordinary_dividends": "400",
                "total_qualified_dividends": "250",
                "total_social_security_benefits": "0",
                "taxable_social_security_benefits": "0",
                "total_income": "60525",
                "traditional_ira_deduction": "1200",
                "hsa_deduction": "800",
                "student_loan_interest_deduction": "250",
                "total_adjustments": "2250",
                "adjusted_gross_income": "58275",
                "standard_deduction": "15750",
                "total_deductions": "15750",
                "taxable_income": "42525",
                "income_tax": "4681",
                "child_dependent_credit": "0",
                "additional_child_tax_credit": "0",
                "total_w2_federal_withholding": "8000",
                "total_social_security_withholding": "0",
                "total_tax": "4681",
                "total_federal_withholding": "8000",
                "total_payments": "8000",
                "balance_due": "0",
                "overpayment": "3319",
            },
            "meta": {
                "rule_pack_version": "1.0.0",
                "tax_table_verification_status": "machine_checked",
                "tax_table_local_estimate_ready": True,
                "tax_table_human_verified": False,
                "estimate_scope": "Narrow supported-slice estimate",
                "privacy": "Runs entirely in your browser.",
                "scope_limits": ["Estimate only."],
            },
            "trace": "mock trace",
            "form": {
                "form_id": "1040",
                "tax_year": 2025,
                "lines": {
                    "1a": {"Currency": "60000"},
                    "1z": {"Currency": "60000"},
                    "2a": {"Currency": "50"},
                    "2b": {"Currency": "125"},
                    "3a": {"Currency": "250"},
                    "3b": {"Currency": "400"},
                    "6a": {"Currency": "0"},
                    "6b": {"Currency": "0"},
                    "9": {"Currency": "60525"},
                    "10": {"Currency": "2250"},
                    "11b": {"Currency": "58275"},
                    "12d": {"Checkbox": False},
                    "12e": {"Currency": "15750"},
                    "14": {"Currency": "15750"},
                    "15": {"Currency": "42525"},
                    "16": {"Currency": "4681"},
                    "19": {"Currency": "0"},
                    "21": {"Currency": "0"},
                    "22": {"Currency": "4681"},
                    "24": {"Currency": "4681"},
                    "25a": {"Currency": "8000"},
                    "25b": {"Currency": "0"},
                    "25d": {"Currency": "8000"},
                    "28": {"Currency": "0"},
                    "33": {"Currency": "8000"},
                    "34": {"Currency": "3319"},
                    "37": {"Currency": "0"},
                },
            },
        }

        rendered = self.browser.execute(
            """
            if (!window.__taxvaultTesting) {
              return false;
            }

            window.__taxvaultTesting.renderResults(arguments[0]);
            window.__taxvaultTesting.goToStep(3);
            return true;
            """,
            [mock_result],
        )
        if not rendered:
            raise AssertionError("testing hooks were not available in the browser app")

        self.browser.wait_for(
            lambda: self.browser.class_list_contains("#step3", "active"),
            "step 3 never became active for mock result rendering",
        )

    def test_supported_return_becomes_ready_when_tax_table_allows_local_estimates(self):
        self.open_app()
        self.fill_step1_single()
        self.add_supported_w2()

        self.wait_for_ready_review()
        self.assertIn(
            "machine-checked for local/private estimate use",
            self.browser.text("#supportReviewSummary"),
        )
        cautions = self.browser.texts("#supportReviewCautions li")
        self.assertTrue(any("machine-checked" in item for item in cautions))
        self.assertFalse(self.browser.is_disabled("#computeBtn"))

    def test_unsupported_return_shows_blocking_issue_before_compute(self):
        self.open_app()
        self.fill_step1_single()
        self.browser.click("#addW2Btn")
        self.browser.set_value("#w2-1-employer", "Northwind Co")
        self.browser.set_value("#w2-1-ein", "12-3456789")
        self.browser.set_value("#w2-1-wages", "210000")
        self.browser.set_value("#w2-1-fed-wh", "42000")
        self.browser.set_value("#w2-1-state-wh", "0")
        self.browser.set_value("#w2-1-ss-wages", "176100")
        self.browser.set_value("#w2-1-ss-wh", "10918.2")
        self.browser.set_value("#w2-1-med-wages", "210000")
        self.browser.set_value("#w2-1-med-wh", "3045")

        self.browser.wait_for(
            lambda: self.browser.text("#supportReviewBadge") == "Unsupported",
            "support review never marked the draft unsupported",
        )
        self.assertTrue(
            any("Additional Medicare Tax" in item for item in self.browser.texts("#supportReviewIssues li"))
        )
        self.assertTrue(self.browser.is_disabled("#computeBtn"))

    def test_head_of_household_parent_case_surfaces_manual_review_caution(self):
        self.open_app()
        self.browser.click('.status-option[data-status="head_of_household"]')
        self.browser.set_value("#pFirst", "Alex")
        self.browser.set_value("#pLast", "Filer")
        self.browser.set_value("#pSsn", "400-01-0001")
        self.browser.set_value("#pDob", "1990-06-15")
        self.browser.set_value("#dep-1-first", "Pat")
        self.browser.set_value("#dep-1-last", "Filer")
        self.browser.set_value("#dep-1-ssn", "400-02-0002")
        self.browser.set_value("#dep-1-dob", "1950-06-15")
        self.browser.set_value("#dep-1-relationship", "parent")
        self.browser.set_value("#dep-1-months", "12")
        self.browser.click("#step1ContinueBtn")
        self.browser.wait_for(
            lambda: self.browser.class_list_contains("#step2", "active"),
            "step 2 never became active for Head of Household flow",
        )
        self.add_supported_w2()

        self.wait_for_ready_review()
        cautions = self.browser.texts("#supportReviewCautions li")
        self.assertTrue(
            any("Head of Household is still a manual determination" in item for item in cautions)
        )
        self.assertTrue(
            any("does not automatically establish Head of Household" in item for item in cautions)
        )
        self.assertTrue(any("machine-checked" in item for item in cautions))
        self.assertFalse(self.browser.is_disabled("#computeBtn"))

    def test_draft_1040_preview_renders_printable_mock_result(self):
        self.open_app()
        self.fill_step1_single()
        self.render_mock_result()

        self.assertFalse(self.browser.is_disabled("#printDraftBtn"))
        self.assertEqual(self.browser.text(".draft-form-title"), "U.S. Individual Income Tax Return")
        self.assertTrue(
            any("Alex Filer" in item for item in self.browser.texts("#draftSummaryGrid .draft-summary-value"))
        )

        draft_text = self.browser.text("#draftSections")
        self.assertIn("Line 1a", draft_text)
        self.assertIn("Wages, salaries, tips", draft_text)
        self.assertIn("Estimated refund", draft_text)


if __name__ == "__main__":
    unittest.main(verbosity=2)
