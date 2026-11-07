"""Execute the visual-result classifier against Playwright-shaped outcomes."""
import json
import subprocess
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def report(*results, errors=None):
    return {"errors": errors or [], "suites": [{"suites": [{"specs": [{"title": "snapshot: map", "tests": [{"projectName": "mobile", "results": list(results)}]}]}]}]}


def difference():
    return {"status": "failed", "errors": [{"message": "Error: expect(page).toHaveScreenshot(expected) failed\n100 pixels (ratio 0.01 of all image pixels) are different."}], "attachments": [{"name": "map-actual.png", "contentType": "image/png"}]}


class VisualResultTests(unittest.TestCase):
    def run_report(self, data, exit_code):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "result.json"
            path.write_text(json.dumps(data))
            return subprocess.run(["node", str(ROOT / "scripts/classify-visual-results.js"), str(path), str(exit_code)], capture_output=True, text=True)

    def test_real_pixel_difference_is_advisory(self):
        result = self.run_report(report(difference()), 1)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn('"mobile: snapshot: map"', result.stdout)

    def test_success_needs_no_retry_trace_or_images(self):
        self.assertEqual(self.run_report(report({"status": "passed"}), 0).returncode, 0)

    def test_browser_startup_failure_is_blocking(self):
        result = self.run_report(report({"status": "failed", "errors": [{"message": "browserType.launch: executable missing"}]}), 1)
        self.assertEqual(result.returncode, 1)

    def test_setup_assertion_is_blocking_even_in_snapshot_test(self):
        failure = {"status": "failed", "errors": [{"message": "expect(locator).toBeVisible() failed"}]}
        self.assertEqual(self.run_report(report(failure), 1).returncode, 1)

    def test_screenshot_timeout_without_comparison_is_blocking(self):
        failure = {"status": "failed", "errors": [{"message": "expect(page).toHaveScreenshot(expected) failed\nTimeout 15000ms exceeded."}], "attachments": [{"name": "map-actual.png", "contentType": "image/png"}]}
        self.assertEqual(self.run_report(report(failure), 1).returncode, 1)

    def test_retry_does_not_hide_nonvisual_failure(self):
        failure = {"status": "failed", "errors": [{"message": "network setup failed"}]}
        self.assertEqual(self.run_report(report(failure, {"status": "passed"}), 0).returncode, 1)

    def test_global_error_is_blocking(self):
        self.assertEqual(self.run_report(report({"status": "passed"}, errors=[{"message": "webServer could not start"}]), 1).returncode, 1)

    def test_mixed_screenshot_and_other_error_is_blocking(self):
        failure = difference()
        failure["errors"].append({"message": "afterEach cleanup failed"})
        self.assertEqual(self.run_report(report(failure), 1).returncode, 1)

    def test_all_skipped_visual_tests_do_not_claim_coverage(self):
        self.assertEqual(self.run_report(report({"status": "skipped"}), 0).returncode, 1)

    def test_empty_or_missing_report_cannot_turn_failure_green(self):
        for data in ({}, {"suites": []}):
            self.assertEqual(self.run_report(data, 1).returncode, 1)


if __name__ == "__main__":
    unittest.main()
