"""Run Thread continuity and selected-image rejection with read-only live guards.

Kept outside tests/boot: its session fixture copies the live library, while this
regression must construct its inputs without relying on current user selections.
"""
import hashlib
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest


ROOT = Path(__file__).resolve().parents[2]


def persistent_inputs():
    paths = [ROOT / "server" / "boot-config.json"]
    paths.extend(sorted((ROOT / "server" / "lumps").rglob("*")))
    snapshot = {}
    for path in paths:
        if path.is_symlink():
            value = ("symlink", os.readlink(path))
        elif path.is_file():
            value = ("file", hashlib.sha256(path.read_bytes()).hexdigest())
        elif path.is_dir():
            value = ("directory",)
        else:
            value = ("missing",)
        snapshot[str(path.relative_to(ROOT))] = value
    return snapshot


class RoundRobinIsolationTests(unittest.TestCase):
    def setUp(self):
        self.before = persistent_inputs()

    def tearDown(self):
        self.assertEqual(self.before, persistent_inputs(),
                         "regression must not change persistent catalog/config, even on failure")

    def run_private(self, command):
        with tempfile.TemporaryDirectory(prefix="thread-regression-test-") as temp:
            result = subprocess.run(
                command, cwd=temp, env={**os.environ, "TMPDIR": temp},
                capture_output=True, text=True, timeout=90)
            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
            self.assertEqual(list(Path(temp).iterdir()), [], "temporary image inputs must be cleaned up")
            return result

    def test_three_thread_continuity_without_persistent_writes(self):
        result = self.run_private(["node", str(ROOT / "simulator" / "test_round_robin_threads.js")])
        self.assertIn("PASS retired CALL → CHANGE → RETURN across three Threads", result.stdout)
        self.assertIn("PASS round-robin Thread switching", result.stdout)

    def test_selected_overlap_still_fails_without_repairing_inputs(self):
        result = self.run_private([
            sys.executable, str(ROOT / "tests" / "boot" / "round_robin_image_fixture.py"),
            "--selected-conflict",
        ])
        self.assertEqual(result.stdout, "", "a rejected selection must not emit an image")
        self.assertIn("PASS selected-image conflict rejected without repairs", result.stderr)


if __name__ == "__main__":
    unittest.main()
