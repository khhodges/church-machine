"""Adversarial checks of the independent reader, without the retained parser."""
import binascii
import copy
import json
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest

import independent_decode as reader


HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[3]


def reseal(data):
    # Test-side oracle deliberately differs from the reader's bitwise routine.
    return data[:-2] + binascii.crc_hqx(data[:-2], 0xFFFF).to_bytes(2, "big")


class IndependentTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.capture = (ROOT / "attached_assets/capture_1794317160962.bin").read_bytes()
        cls.events = [json.loads(line) for line in
                      (ROOT / "attached_assets/events_1794317160963.jsonl").read_text().splitlines()]
        cls.result = json.loads((ROOT / "attached_assets/result_1794317160963.json").read_text())

    def run_decode(self, capture=None, events=None, result=None):
        return reader.decode(self.capture if capture is None else capture,
                             self.events if events is None else events,
                             self.result if result is None else result)

    def changed_frame(self, start, length, offset, value=None):
        data = bytearray(self.capture)
        data[start + offset] = data[start + offset] ^ 1 if value is None else value
        data[start:start + length] = reseal(bytes(data[start:start + length]))
        return bytes(data)

    def test_positive(self):
        decoded = self.run_decode()
        self.assertEqual(decoded["status"], "INDEPENDENT_DECODE_PASS")
        self.assertEqual(decoded["challenge_crc"], 0xAA4F)
        self.assertEqual(decoded["baseline"], self.result["baseline"])
        self.assertEqual(decoded["after"], self.result["after"])

    def test_crc_known_answers(self):
        self.assertEqual(reader.crc16(b""), 0xFFFF)
        self.assertEqual(reader.crc16(b"123456789"), 0x29B1)
        self.assertEqual(reader.crc16(bytes(range(256))),
                         binascii.crc_hqx(bytes(range(256)), 0xFFFF))

    def test_request_every_single_bit(self):
        for offset in range(40):
            for bit in range(8):
                frame = bytearray(self.capture[297280:297320])
                frame[offset] ^= 1 << bit
                with self.subTest(offset=offset, bit=bit), self.assertRaisesRegex(ValueError, "CRC"):
                    reader.frame_crc(frame, 40, "request")

    def test_wrong_crc_endianness_and_coverage(self):
        frame = self.capture[301920:302066]
        for bad in (frame[:-2] + frame[-2:][::-1],
                    frame[:-2] + binascii.crc_hqx(frame[4:-2], 0xFFFF).to_bytes(2, "big"),
                    frame[:-2] + binascii.crc_hqx(frame[:-2], 0).to_bytes(2, "big")):
            with self.assertRaisesRegex(ValueError, "CRC"):
                reader.frame_crc(bad, 146, "report")

    def test_crc_corruption_all_frames(self):
        for offset in (297290, 301650, 301950, 302100):
            data = bytearray(self.capture)
            data[offset] ^= 1
            with self.assertRaisesRegex(ValueError, "CRC"):
                self.run_decode(capture=bytes(data))

    def test_resealed_request_and_snapshot(self):
        for start, size, offset in ((297280, 40, 4), (297280, 40, 37),
                                    (301628, 292, 6), (301628, 292, 10),
                                    (301628, 292, 178), (301628, 292, 274)):
            with self.subTest(offset=offset), self.assertRaises(ValueError):
                self.run_decode(capture=self.changed_frame(start, size, offset))
        # Correct CRC with little-endian NIA must not pass.
        data = bytearray(self.capture)
        data[301638:301642] = data[301638:301642][::-1]
        data[301628:301920] = reseal(bytes(data[301628:301920]))
        with self.assertRaisesRegex(ValueError, "terminal"):
            self.run_decode(capture=bytes(data))

    def test_all_report_fields_even_with_agreeing_result(self):
        for start, name in ((301920, "baseline"), (302066, "after")):
            for field, offset in [("sequence", 4), ("nonce", 8)] + [
                    (field, 44 + 4 * i) for i, field in enumerate(reader.FIELDS)]:
                data = self.changed_frame(start, 146, offset + 3)
                result = copy.deepcopy(self.result)
                result[name][field] ^= 1
                with self.subTest(name=name, field=field), self.assertRaises(ValueError):
                    self.run_decode(capture=data, result=result)
            with self.assertRaisesRegex(ValueError, "identity"):
                self.run_decode(capture=self.changed_frame(start, 146, 12))

    def test_framing(self):
        duplicate = bytearray(self.capture)
        duplicate[100:140] = self.capture[297280:297320]
        missing = bytearray(self.capture)
        missing[297280] = 0
        for data in (self.capture[:-1], self.capture + b"x", bytes(duplicate), bytes(missing)):
            with self.assertRaises(ValueError):
                self.run_decode(capture=data)
        for offset in (301629, 301630, 301631):
            with self.assertRaises(ValueError):
                self.run_decode(capture=self.changed_frame(301628, 292, offset - 301628))

    def test_challenge_mutations(self):
        for offset in (0, 40, 60, 100, 118, 120, 127):
            events = copy.deepcopy(self.events)
            event = [e for e in events if e["event"] == "tx_attempt"][1]
            challenge = bytearray.fromhex(event["hex"])
            challenge[offset] ^= 1
            event["hex"] = challenge.hex()
            with self.subTest(offset=offset), self.assertRaises(ValueError):
                self.run_decode(events=events)

    def test_result_and_event_disagreement(self):
        for report in ("baseline", "after"):
            for field in self.result[report]:
                result = copy.deepcopy(self.result)
                result[report][field] ^= 1
                with self.assertRaises(ValueError):
                    self.run_decode(result=result)
        for kind in ("tx_complete", "baseline_verified", "post_claim_verified"):
            events = copy.deepcopy(self.events)
            del events[next(i for i, e in enumerate(events) if e["event"] == kind)]
            with self.assertRaises(ValueError):
                self.run_decode(events=events)
        for kind, key, value in (("rx", "count", 0), ("rx", "total", 1),
                                 ("tx_complete", "total", 1), ("serial_open", "nonce", 0),
                                 ("rx", "seconds", float("nan"))):
            events = copy.deepcopy(self.events)
            next(e for e in events if e["event"] == kind)[key] = value
            with self.assertRaises(ValueError):
                self.run_decode(events=events)

    def test_standalone_and_pins_without_retained_modules(self):
        with tempfile.TemporaryDirectory() as temporary:
            folder = Path(temporary)
            shutil.copyfile(HERE / "independent_decode.py", folder / "independent_decode.py")
            (folder / "capture.bin").write_bytes(self.capture)
            (folder / "result.json").write_bytes(
                (ROOT / "attached_assets/result_1794317160963.json").read_bytes())
            events = copy.deepcopy(self.events)
            events[0]["port"] = "[REDACTED]"
            (folder / "events.jsonl").write_text("".join(json.dumps(e) + "\n" for e in events))
            proc = subprocess.run([sys.executable, "-B", "-S", str(folder / "independent_decode.py")],
                                  cwd=folder, capture_output=True, text=True)
            self.assertEqual(proc.returncode, 0, proc.stderr)
            self.assertEqual(json.loads(proc.stdout)["status"], "INDEPENDENT_DECODE_PASS")
            for name in ("capture.bin", "result.json", "events.jsonl"):
                path = folder / name
                saved = path.read_bytes()
                if name == "events.jsonl":
                    events[0]["nonce"] ^= 1
                    path.write_text("".join(json.dumps(e) + "\n" for e in events))
                else:
                    path.write_bytes(saved + b" ")
                with self.assertRaisesRegex(ValueError, "pinned"):
                    reader.verify(folder)
                path.write_bytes(saved)


if __name__ == "__main__":
    unittest.main()
