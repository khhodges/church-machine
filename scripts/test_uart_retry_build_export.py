"""Offline package checks: no vendor executable, remote builder, or device."""
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import shutil
import signal
import subprocess
import sys
import tempfile
import time
import unittest
import zipfile

ROOT = Path(__file__).resolve().parents[1]
ARCHIVE = ROOT / "generated-artifacts/uart-retry-build-only.zip"
SUCCESS = "UART_RETRY_DIAGNOSTIC_BITSTREAM_BUILD_PASS"


class RunnerProcessTests(unittest.TestCase):
    """Execute the frozen shell pipeline, never a vendor binary or board tool."""

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.home = self.root / "home"
        self.home.mkdir()
        self.bin = self.root / "bin"
        self.bin.mkdir()
        # An allowlist rather than inheriting PATH prevents accidental access to
        # any installed vendor tools. The real verifier remains unmodified.
        for name in ("bash", "dirname", "flock", "python3", "tee", "grep", "sha256sum"):
            target = shutil.which(name)
            self.assertIsNotNone(target, name)
            (self.bin / name).symlink_to(target)
        self.write_tool("timeout", """
import os, subprocess, sys
from pathlib import Path
duration, tool, *args = sys.argv[1:]
assert tool == 'vivado'
phase = args[args.index('-source') + 1]
assert duration == {'synth.tcl': '120m', 'route.tcl': '240m'}[phase]
with open('timeout-calls', 'a') as f:
    f.write(duration + ' ' + phase + '\\n')
result = subprocess.run([str(Path(__file__).with_name('vivado')), *args])
# Model GNU timeout's exit status without waiting hours. Vivado has already
# emitted partial output, just as a killed build may have done.
if os.environ.get('TIMEOUT_PHASE') == phase:
    print('FAKE_TIMEOUT ' + phase, flush=True)
    sys.exit(124)
sys.exit(result.returncode)
""")
        self.write_tool("vivado", """
import os, subprocess, sys, time
from pathlib import Path
phase = sys.argv[sys.argv.index('-source') + 1]
with open('vivado-calls', 'a') as f:
    f.write(phase + '\\n')
print('FAKE_VIVADO ' + phase, flush=True)
if os.environ.get('HOLD_PHASE') == phase:
    Path('entered').touch()
    deadline = time.monotonic() + 15
    while not Path('release').exists():
        if time.monotonic() > deadline:
            sys.exit(98)
        time.sleep(.02)
if phase == 'synth.tcl':
    Path('synthesized.dcp').write_text('fake checkpoint')
    print('COMBINED_SYNTH_EXPORT_COMPLETE', flush=True)
elif phase == 'route.tcl':
    for name in ('candidate-EXPERIMENTAL.bit', 'routed.dcp',
                 'precise-slack.txt', 'drc.txt', 'route-status.txt'):
        Path(name).write_text('fake output, not vendor evidence')
    Path('timing.txt').write_text(
        'WNS(ns) TNS(ns) TPWS Total Endpoints\\n----------\\n'
        '0.1 0 0 100 0.01 0 0 100 0.2 0 0 30\\n')
    # The runner requires a nonempty receipt; vendor/Tcl receipt production is
    # outside this shell-control test. Never claim these are verified outputs.
    Path('build-receipt.json').write_text('{"fake": true}\\n')
else:
    raise AssertionError(phase)
# Fail even after apparently good output: tee must not mask this status.
if os.environ.get('FAIL_PHASE') == phase:
    print('FAKE_FAILURE ' + phase, flush=True)
    sys.exit(42)
""")
        self.env = {
            "PATH": str(self.bin), "HOME": str(self.home),
            "XILINX_VIVADO": str(self.bin), "LC_ALL": "C",
            "PYTHONDONTWRITEBYTECODE": "1",
        }
        self.package = self.extract("first")

    def write_tool(self, name, source):
        path = self.bin / name
        path.write_text(f"#!{sys.executable}\n" + source)
        path.chmod(0o755)

    def extract(self, name):
        destination = self.root / name
        with zipfile.ZipFile(ARCHIVE) as archive:
            archive.extractall(destination)
        return destination / "uart-retry-build-only"

    def start(self, package, **env):
        process = subprocess.Popen(
            ["bash", "run.sh"], cwd=package, env={**self.env, **env},
            stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True,
            start_new_session=True,
        )
        self.addCleanup(self.stop, process)
        return process

    @staticmethod
    def stop(process):
        # Kill the whole process group, including fake tools/tee, on assertions
        # or harness timeouts; inherited lock descriptors must not leak.
        try:
            os.killpg(process.pid, signal.SIGKILL)
        except ProcessLookupError:
            pass
        process.communicate()

    def finish(self, process):
        output, _ = process.communicate(timeout=20)
        return process.returncode, output

    def run_package(self, package, **env):
        return self.finish(self.start(package, **env))

    def assert_failed(self, result, status=None):
        code, output = result
        self.assertNotEqual(code, 0, output)
        if status is not None:
            self.assertEqual(code, status, output)
        self.assertNotIn(SUCCESS, output)

    def test_success_control(self):
        code, output = self.run_package(self.package)
        self.assertEqual(code, 0, output)
        self.assertEqual(output.splitlines().count(SUCCESS), 1)
        self.assertEqual((self.package / "vivado-calls").read_text(),
                         "synth.tcl\nroute.tcl\n")
        self.assertEqual((self.package / "timeout-calls").read_text(),
                         "120m synth.tcl\n240m route.tcl\n")
        self.assertTrue((self.package / "build-receipt.json").is_file())

    def test_shared_lock_excludes_another_extraction_then_releases(self):
        other = self.extract("second")
        first = self.start(self.package, HOLD_PHASE="synth.tcl")
        deadline = time.monotonic() + 10
        while not (self.package / "entered").exists():
            self.assertIsNone(first.poll(), "First runner exited before lock test")
            self.assertLess(time.monotonic(), deadline, "Fake synthesis did not start")
            time.sleep(.02)
        blocked = self.run_package(other)
        self.assert_failed(blocked)
        self.assertIn("Another vendor build holds the lock", blocked[1])
        for name in ("vivado-calls", "timeout-calls", "synthesis.log"):
            self.assertFalse((other / name).exists(), name)
        (self.package / "release").touch()
        code, output = self.finish(first)
        self.assertEqual(code, 0, output)
        code, output = self.run_package(other)
        self.assertEqual(code, 0, output)
        self.assertIn(SUCCESS, output)

    def test_failures_timeouts_and_partial_output_reruns(self):
        for variable, status in (("FAIL_PHASE", 42), ("TIMEOUT_PHASE", 124)):
            for phase in ("synth.tcl", "route.tcl"):
                with self.subTest(variable=variable, phase=phase):
                    package = self.extract(variable + phase)
                    result = self.run_package(package, **{variable: phase})
                    self.assert_failed(result, status)
                    self.assertIn(
                        ("FAKE_FAILURE " if status == 42 else "FAKE_TIMEOUT ") + phase,
                        result[1])
                    expected = ("synth.tcl\n" if phase == "synth.tcl"
                                else "synth.tcl\nroute.tcl\n")
                    self.assertEqual((package / "vivado-calls").read_text(), expected)
                    self.assertTrue((package / "synthesis.log").exists())
                    self.assertTrue((package / "synthesized.dcp").exists())
                    # Preserve all partial artifacts and retry without injected
                    # failure. It must stop before either tool runs again.
                    before = {p.name: p.read_bytes() for p in package.iterdir()
                              if p.is_file()}
                    self.assert_failed(self.run_package(package))
                    after = {p.name: p.read_bytes() for p in package.iterdir()
                             if p.is_file()}
                    self.assertEqual(before, after)
                    # Failure must release the shared lock for a clean package.
                    clean = self.extract("clean-" + variable + phase)
                    code, output = self.run_package(clean)
                    self.assertEqual(code, 0, output)
                    self.assertIn(SUCCESS, output)


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
