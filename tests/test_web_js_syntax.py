"""Ensure the browser UI script parses as valid ECMAScript."""

import shutil
import subprocess
import unittest
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[1]
APP_JS = REPO_ROOT / "web" / "app.js"


class TestWebJsSyntax(unittest.TestCase):
    @unittest.skipUnless(shutil.which("node"), "node not installed; skipping JS syntax check")
    def test_app_js_parses(self) -> None:
        result = subprocess.run(
            ["node", "--check", str(APP_JS)],
            cwd=REPO_ROOT,
            capture_output=True,
            text=True,
            check=False,
        )
        self.assertEqual(
            result.returncode,
            0,
            msg=f"node --check failed:\n{result.stderr or result.stdout}",
        )


if __name__ == "__main__":
    unittest.main()
