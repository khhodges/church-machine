"""Offline regression tests, including semantic failures after hash checks."""
import copy
import importlib.util
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
import zipfile

import build_bundle
import replay


class OfflineReplayTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        parent = build_bundle.ROOT / "generated-artifacts"
        parent.mkdir(exist_ok=True)
        cls.temp = tempfile.TemporaryDirectory(dir=parent)
        cls.work = Path(cls.temp.name)
        cls.archive = build_bundle.build(cls.work / "first")
        with zipfile.ZipFile(cls.archive) as archive:
            archive.extractall(cls.work / "unpacked")
        cls.bundle = cls.work / "unpacked/request-retry-offline"
        sys.path.insert(0, str(cls.bundle))
        spec = importlib.util.spec_from_file_location("offline_retained_session", cls.bundle / "session.py")
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        cls.session_class = module.Session
        cls.capture = (cls.bundle / "capture.bin").read_bytes()
        cls.events = [json.loads(line) for line in (cls.bundle / "events.jsonl").read_text().splitlines()]
        cls.result = json.loads((cls.bundle / "result.json").read_text())

    @classmethod
    def tearDownClass(cls):
        sys.path.remove(str(cls.bundle))
        cls.temp.cleanup()

    def check(self, capture=None, events=None, result=None):
        return replay.replay(self.capture if capture is None else capture,
                             self.events if events is None else events,
                             self.result if result is None else result, self.session_class)

    def test_clean_standalone_replay_without_repository_or_site_packages(self):
        completed = subprocess.run([sys.executable, "-B", "-S", str(self.bundle / "replay.py")],
                                   cwd=self.work, capture_output=True, text=True)
        self.assertEqual(completed.returncode, 0, completed.stderr)
        self.assertEqual(json.loads(completed.stdout)["status"], "OFFLINE_REPLAY_PASS")

    def test_repeat_build_is_identical(self):
        second = build_bundle.build(self.work / "second")
        self.assertEqual(self.archive.read_bytes(), second.read_bytes())

    def test_redistribution_notice_is_packaged_and_hashed(self):
        name = "REDISTRIBUTION.md"
        notice = (self.bundle / name).read_bytes()
        self.assertEqual(notice, (build_bundle.HERE / name).read_bytes())
        manifest = json.loads((self.bundle / "manifest.json").read_text())
        self.assertEqual(manifest["files"][name],
                         dict(bytes=len(notice), sha256=build_bundle.digest(notice)))

    def test_no_overwrite(self):
        with self.assertRaisesRegex(ValueError, "already exists"):
            build_bundle.build(self.work / "first")

    def test_historical_inputs_are_pinned(self):
        for name, expected in build_bundle.INPUTS.items():
            self.assertEqual(build_bundle.digest((build_bundle.ROOT / name).read_bytes()), expected)

    def test_sanitization_changes_only_port(self):
        original = json.loads((build_bundle.ROOT / "attached_assets/events_1794317160963.jsonl")
                              .read_text().splitlines()[0])
        sanitized = dict(self.events[0])
        self.assertEqual(sanitized.pop("port"), "[REDACTED]")
        original.pop("port")
        self.assertEqual(sanitized, original)
        original_events = [json.loads(line) for line in
                           (build_bundle.ROOT / "attached_assets/events_1794317160963.jsonl")
                           .read_text().splitlines()]
        self.assertEqual(self.events[1:], original_events[1:])
        source = (self.bundle / "session.py").read_text()
        self.assertNotIn("import serial", source)
        self.assertNotIn("run_serial", source)

    def test_hash_rejects_changed_file(self):
        path = self.bundle / "capture.bin"
        try:
            path.write_bytes(self.capture + b"x")
            with self.assertRaisesRegex(ValueError, "Hash/size mismatch"):
                replay.verify_bundle(self.bundle)
        finally:
            path.write_bytes(self.capture)

    def test_corrupt_frames_and_truncation(self):
        for offset in (297285, 301650, 301950, 302100):
            with self.subTest(offset=offset):
                capture = bytearray(self.capture)
                capture[offset] ^= 1
                with self.assertRaises(ValueError):
                    self.check(capture=bytes(capture))
        with self.assertRaises(ValueError):
            self.check(capture=self.capture[:-1])
        with self.assertRaises(ValueError):
            self.check(capture=self.capture + b"x")

    def test_event_disagreement(self):
        for kind, key, value in (("rx", "total", 1), ("rx", "count", 0),
                                 ("tx_attempt", "hex", "00"), ("tx_complete", "count", 1),
                                 ("tx_complete", "total", 1), ("serial_open", "nonce", 1)):
            with self.subTest(kind=kind, key=key):
                events = copy.deepcopy(self.events)
                next(e for e in events if e["event"] == kind)[key] = value
                with self.assertRaises(ValueError):
                    self.check(events=events)
        for kind in ("baseline_verified", "tx_complete", "post_claim_verified"):
            events = copy.deepcopy(self.events)
            index = next(i for i, e in enumerate(events) if e["event"] == kind)
            del events[index]
            with self.assertRaises(ValueError):
                self.check(events=events)
        with self.assertRaises(ValueError):
            self.check(events=self.events + [self.events[-1]])

    def test_result_disagreement(self):
        for key, value in (("status", "failed"), ("rxBytes", 0), ("txBytes", 0),
                           ("snapshot", [3, 0, 0, 0]), ("nonce", 1),
                           ("elapsedSeconds", 0)):
            result = copy.deepcopy(self.result)
            result[key] = value
            with self.subTest(key=key), self.assertRaises(ValueError):
                self.check(result=result)
        for report in ("baseline", "after"):
            for field in self.result[report]:
                result = copy.deepcopy(self.result)
                result[report][field] += 1
                with self.subTest(report=report, field=field), self.assertRaises(ValueError):
                    self.check(result=result)


if __name__ == "__main__":
    unittest.main()
