"""Offline archive/verifier checks. Never invoke Vivado, SSH, or a device."""
import hashlib
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
import zipfile

ROOT = Path(__file__).resolve().parents[1]
ARCHIVE = ROOT / "generated-artifacts/request-retry-build-only.zip"
PARENT = ROOT / "generated-artifacts/uart-retry-build-only"


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


class ExportTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        with zipfile.ZipFile(ARCHIVE) as z:
            self.assertIsNone(z.testzip())
            z.extractall(self.temp.name)
        self.package = Path(self.temp.name) / "request-retry-build-only"

    def verify(self, *args):
        command = ("import sys,runpy; sys.path.insert(0,'.');"
                   f"sys.argv={['verify.py', *args]!r};"
                   "runpy.run_path('verify.py',run_name='__main__')")
        return subprocess.run([sys.executable, "-I", "-c", command],
                              cwd=self.package, capture_output=True, text=True, timeout=30)

    def test_clean_extraction_and_gates(self):
        result = self.verify()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("REQUEST_RETRY_DIAGNOSTIC_INPUTS_VERIFIED", result.stdout)
        for name in ("board.xdc", "clock-guard.tcl", "synth.tcl", "route.tcl",
                     "initializer_route_verify.py"):
            self.assertEqual(sha(self.package / name), sha(PARENT / name), name)
        self.assertEqual((self.package / "run.sh").read_text(),
                         (PARENT / "run.sh").read_text().replace(
                             "UART_RETRY_DIAGNOSTIC_BITSTREAM_BUILD_PASS",
                             "REQUEST_RETRY_DIAGNOSTIC_BITSTREAM_BUILD_PASS"))
        subprocess.run(["bash", "-n", str(self.package / "run.sh")], check=True)
        profile = json.loads((self.package / "rtl/guarded-profile.json").read_text())
        self.assertTrue(profile["diagnosticUartRequest"])
        self.assertIn("diagnostic_uart_request=True", (self.package / "generate.py").read_text())

    def test_tamper_rejected(self):
        for name in ("request-frame.bin", "response-frame.bin", "candidate-le.bin",
                     "rtl/church_wukong_xc7a100t.v", "host/responder.py",
                     "source-snapshot/hardware/request_diagnostic.py",
                     "evidence/generated-artifacts/request-retry-early-response-results.xml",
                     "rtl/guarded-profile.json", "route.tcl"):
            with self.subTest(name=name):
                p = self.package / name
                original = p.read_bytes()
                try:
                    p.write_bytes(original + b"\nTAMPER")
                    self.assertNotEqual(self.verify().returncode, 0, name)
                finally:
                    p.write_bytes(original)

    def fake_outputs(self, setup="0.1"):
        names = ("candidate-EXPERIMENTAL.bit", "routed.dcp", "synthesized.dcp",
                 "timing.txt", "precise-slack.txt", "drc.txt", "route-status.txt")
        for name in names:
            (self.package / name).write_text("FAKE OFFLINE TEST OUTPUT: " + name)
        (self.package / "timing.txt").write_text(
            "WNS(ns) TNS(ns) TPWS Total Endpoints\n----------\n"
            f"{setup} 0 0 100 0.01 0 0 100 0.2 0 0 30\n")
        return names

    def test_receipt_exact_hashes_and_no_overwrite(self):
        names = self.fake_outputs()
        result = self.verify("--record", "2026.1")
        self.assertEqual(result.returncode, 0, result.stderr)
        receipt = self.package / "build-receipt.json"
        raw = receipt.read_bytes()
        data = json.loads(raw)
        self.assertEqual(data["schema"], "church.request-retry-diagnostic-build/v1")
        self.assertEqual(data["manifestSha256"], sha(self.package / "manifest.json"))
        self.assertEqual(data["files"], {name: sha(self.package / name) for name in names})
        for field, name in (("requestFrameSha256", "request-frame.bin"),
                            ("responseFrameSha256", "response-frame.bin")):
            self.assertEqual(data[field], sha(self.package / name))
        self.assertIs(data["diagnosticUartRequest"], True)
        self.assertIs(data["programmingAuthorized"], False)
        self.assertIs(data["physicalBoardTested"], False)
        self.assertNotEqual(self.verify("--record", "2026.1").returncode, 0)
        self.assertEqual(receipt.read_bytes(), raw)

    def test_failed_timing_and_wrong_vendor_rejected(self):
        self.fake_outputs("-0.1")
        self.assertNotEqual(self.verify("--record", "2026.1").returncode, 0)
        self.assertFalse((self.package / "build-receipt.json").exists())
        self.fake_outputs()
        self.assertNotEqual(self.verify("--record", "2025.2").returncode, 0)
        self.assertFalse((self.package / "build-receipt.json").exists())


if __name__ == "__main__":
    unittest.main()
