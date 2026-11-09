"""Offline package checks: no vendor executable, remote builder, or device."""
import hashlib
import importlib.util
import json
from pathlib import Path
import subprocess
import tempfile
import unittest
import zipfile

ROOT = Path(__file__).resolve().parents[1]
ARCHIVE = ROOT / "generated-artifacts/uart-retry-build-only.zip"


class ExportTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp = tempfile.TemporaryDirectory()
        with zipfile.ZipFile(ARCHIVE) as z:
            if z.testzip() is not None:
                raise ValueError("ZIP CRC failure")
            z.extractall(cls.temp.name)
        cls.package = Path(cls.temp.name) / "uart-retry-build-only"

    @classmethod
    def tearDownClass(cls):
        cls.temp.cleanup()

    def verify(self):
        return subprocess.run(["python3", "-I", "-c",
                               "import sys,runpy; sys.path.insert(0,'.'); "
                               "runpy.run_path('verify.py',run_name='__main__')"], cwd=self.package,
                              capture_output=True, text=True)

    def test_clean_extracted_package(self):
        # -I excludes workspace paths; add ONLY this extracted package explicitly
        # for the verifier's sibling timing helper.
        result = self.verify()
        self.assertEqual(result.returncode, 0, result.stderr)

    def test_manifest_all_archived_files(self):
        meta = json.loads((self.package / "manifest.json").read_text())
        for name, digest in meta["files"].items():
            self.assertEqual(hashlib.sha256((self.package / name).read_bytes()).hexdigest(), digest)
        for name, digest in meta["sourceFiles"].items():
            self.assertEqual(meta["files"]["source-snapshot/" + name], digest)
        self.assertEqual(hashlib.sha256(json.dumps(meta["sourceFiles"], sort_keys=True,
                                                  separators=(",", ":")).encode()).hexdigest(),
                         meta["sourceFilesSha256"])

    def test_mutations_rejected(self):
        for name in ("candidate-le.bin", "fixed-frame.bin",
                     "rtl/church_wukong_xc7a100t.v", "route.tcl",
                     "source-snapshot/hardware/uart_retry_receiver.py"):
            with self.subTest(name=name):
                path = self.package / name
                saved = path.read_bytes()
                try:
                    path.write_bytes(saved + b"\n")
                    result = self.verify()
                    self.assertNotEqual(result.returncode, 0)
                    self.assertIn("Input changed", result.stderr)
                finally:
                    path.write_bytes(saved)

    def test_admission_and_imports_outside_workspace(self):
        import amaranth
        dependencies = str(Path(amaranth.__file__).resolve().parents[1])
        code = "import sys; sys.path.append(" + repr(dependencies) + ")\n" + """import sys, struct
sys.path.insert(0, 'source-snapshot')
from hardware.wukong_top import ChurchWukongXC7A100T
from hardware.guarded_build_profile import validate_words
from hardware.uart_retry_receiver import FRAME
words = struct.unpack('<16384I', open('candidate-le.bin','rb').read())
assert validate_words(words, 23971) == words
assert FRAME == open('fixed-frame.bin','rb').read()
bad = list(words); bad[0] ^= 1
try: validate_words(bad, 23971)
except ValueError: pass
else: raise AssertionError('changed image admitted')
"""
        result = subprocess.run(["python3", "-I", "-c", code], cwd=self.package,
                                capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stderr)

    def test_timing_rejects_missing_negative_and_failing_endpoints(self):
        spec = importlib.util.spec_from_file_location(
            "timing", self.package / "initializer_route_verify.py")
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        header = "WNS(ns) TNS(ns) TPWS Total Endpoints\n----------\n"
        good = "0.1 0 0 100 0.01 0 0 100 0.2 0 0 30"
        self.assertEqual(module.timing_summary(header + good)["setupTotal"], 100)
        for text in ("", header, header + good + "\n" + header + good,
                     header + good.replace("0.1 ", "-0.001 ", 1),
                     header + good.replace("0 0 100", "0 1 100", 1),
                     header + good.replace("0 0 100", "0 0 0", 1),
                     header + good.replace("0.01", "nan")):
            with self.subTest(text=text), self.assertRaises((ValueError, IndexError)):
                module.timing_summary(text)

    def test_locked_runner_and_gates(self):
        runner = (self.package / "run.sh").read_text()
        subprocess.run(["bash", "-n", "run.sh"], cwd=self.package, check=True)
        self.assertIn('exec 9>"$HOME/wukong-vivado-build.lock"', runner)
        self.assertIn("flock -n 9", runner)
        self.assertIn("set -euo pipefail", runner)
        for duration in ("120m", "240m"):
            self.assertIn("timeout " + duration, runner)
        route = (self.package / "route.tcl").read_text()
        for gate in ("get_drc_violations -quiet -filter {SEVERITY == Error}",
                     "Missing $delay timing path", "$slack < 0",
                     "python3 verify.py --timing", "assert_board"):
            self.assertLess(route.index(gate), route.index("write_bitstream"))
        self.assertIn('set_property SEVERITY Error', route)
        self.assertIn("2026.1", route)
        result = subprocess.run(["bash", "run.sh", "override"], cwd=self.package,
                                capture_output=True, text=True)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("No override", result.stdout)


if __name__ == "__main__":
    unittest.main()
