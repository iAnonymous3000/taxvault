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

    def request(self, method: str, path: str, payload=None):
        body = None if payload is None else json.dumps(payload).encode("utf-8")
        request = urllib.request.Request(
            f"http://127.0.0.1:{self.port}{path}",
            data=body,
            method=method,
            headers={"Content-Type": "application/json"},
        )

        try:
            with urllib.request.urlopen(request, timeout=10) as response:
                raw_body = response.read().decode("utf-8")
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
        self.browser = self.driver.new_session()

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

    def test_supported_return_stays_locked_until_tax_table_review_is_recorded(self):
        self.open_app()
        self.fill_step1_single()
        self.add_supported_w2()

        self.browser.wait_for(
            lambda: self.browser.text("#supportReviewBadge") == "Needs Attention",
            "support review never reached Needs Attention",
        )
        self.assertIn(
            "estimate calculations are locked",
            self.browser.text("#supportReviewSummary"),
        )
        self.assertTrue(
            any("marked unverified" in item for item in self.browser.texts("#supportReviewIssues li"))
        )
        self.assertTrue(self.browser.is_disabled("#computeBtn"))

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

        self.browser.wait_for(
            lambda: self.browser.text("#supportReviewBadge") == "Needs Attention",
            "Head of Household review never reached Needs Attention",
        )
        self.assertTrue(
            any("marked unverified" in item for item in self.browser.texts("#supportReviewIssues li"))
        )
        cautions = self.browser.texts("#supportReviewCautions li")
        self.assertTrue(
            any("Head of Household is still a manual determination" in item for item in cautions)
        )
        self.assertTrue(
            any("does not automatically establish Head of Household" in item for item in cautions)
        )
        self.assertTrue(self.browser.is_disabled("#computeBtn"))


if __name__ == "__main__":
    unittest.main(verbosity=2)
