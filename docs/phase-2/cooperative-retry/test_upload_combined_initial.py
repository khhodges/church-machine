"""Host-only transport tests: no serial devices, boards, or vendor tools."""
import binascii
import ast
import hashlib
import io
import json
from pathlib import Path
import struct
import unittest
from unittest.mock import patch

import upload_combined_initial as host


def status(state, epoch=1):
    return b"CS" + bytes([state, 0]) + epoch.to_bytes(4, "big")


def observer(sequence=1, epoch=1, fault=0):
    values = [epoch] + [0] * 15
    values[14] = fault
    data = (b"UCV4" + sequence.to_bytes(4, "big") + bytes.fromhex(host.IMAGE_HASH)
            + bytes.fromhex(host.INPUT_HASH) + struct.pack(">16I", *values))
    return data + binascii.crc_hqx(data, 0xffff).to_bytes(2, "big")


class Port:
    out_waiting = 0

    def __init__(self, rx, partial=False):
        self.rx, self.writes, self.partial = bytearray(rx), [], partial

    def read(self, n):
        n = min(n, 3)  # Exercise arbitrary serial fragmentation.
        data = bytes(self.rx[:n])
        del self.rx[:n]
        return data

    def write(self, data):
        self.writes.append(data)
        return len(data) - int(self.partial)


class UploadTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.image = (Path(__file__).resolve().parents[3] /
            "generated-artifacts/combined-vendor-mmcm-corrected-20261111/source/"
            "applications/all-waiting.bin").read_bytes()

    def run_upload(self, rx, partial=False):
        port = Port(rx, partial)
        host.upload(host.Link(port, io.BytesIO(), lambda message: None), self.image)
        return port

    def test_exact_successful_wire_bytes(self):
        port = self.run_upload(status(0, 0) + status(1) + status(2) + status(3)
                               + status(4) + observer() + observer(2))
        expected = (b"CSI1" + struct.pack(">BBHII", 1, 0, 0, 0, 65536)
                    + self.image + host.command(2, 1) + host.command(3, 1))
        self.assertEqual(b"".join(port.writes), expected)

    def test_optional_transient_statuses_can_be_absent(self):
        self.run_upload(status(1) + status(3) + status(4) + observer() + observer(2))

    def test_bad_image_sends_nothing(self):
        port = Port(b"")
        with self.assertRaises(ValueError):
            host.upload(host.Link(port, io.BytesIO(), print), self.image[:-1])
        self.assertEqual(port.writes, [])
        with self.assertRaises(ValueError):
            host.validate_image(bytes(65536))

    def test_failed_validation_never_sends_start(self):
        port = Port(status(1) + status(2) + status(5))
        with self.assertRaises(ValueError):
            host.upload(host.Link(port, io.BytesIO(), lambda x: None), self.image)
        self.assertNotIn(host.command(3, 1), port.writes)

    def test_wrong_epoch_or_state_stops_before_image(self):
        for rx in [status(1, 2), status(4), b"BADFRAME", status(5)]:
            port = Port(rx)
            with self.assertRaises(ValueError):
                host.upload(host.Link(port, io.BytesIO(), lambda x: None), self.image)
            self.assertEqual(len(port.writes), 1)

    def test_short_write_is_not_retried(self):
        with self.assertRaises(IOError):
            self.run_upload(b"", partial=True)

    def test_timeout(self):
        link = host.Link(Port(b""), io.BytesIO(), print)
        with patch.object(host.time, "monotonic", return_value=10):
            with self.assertRaises(TimeoutError):
                link.exact(8, 9)

    def test_observer_failures(self):
        bad_crc = bytearray(observer())
        bad_crc[-1] ^= 1
        for data in [bytes(bad_crc), observer(epoch=2), observer(fault=1), b"short"]:
            with self.assertRaises(ValueError):
                host.decode_observer(data)
        altered = bytearray(observer())
        altered[8] ^= 1
        altered[-2:] = binascii.crc_hqx(altered[:-2], 0xffff).to_bytes(2, "big")
        with self.assertRaises(ValueError):
            host.decode_observer(bytes(altered))

    def test_repeated_observer_sequence_fails(self):
        with self.assertRaises(ValueError):
            self.run_upload(status(1) + status(3) + status(4) + observer() + observer())

    def test_pins_match_exact_frozen_runtime(self):
        source = (Path(__file__).resolve().parents[3] /
                  "generated-artifacts/combined-vendor-mmcm-corrected-20261111/source")
        records = json.loads((source / "combined-inputs.json").read_text())["records"]
        digest = hashlib.sha256(json.dumps(
            [[records[0], records[2]], [records[1], records[3]]],
            sort_keys=True, separators=(",", ":")).encode()).hexdigest()
        self.assertEqual(digest, host.INPUT_HASH)
        # Execute only pure reference functions, without importing RTL/toolchains.
        ns = {"MAGIC": b"CSI1", "binascii": binascii, "struct": struct,
              "REPORT_SIZE": 138, "FIELDS": host.FIELDS}
        for filename, function in [("starter_transport.py", "command"),
                                   ("request_protocol.py", "crc"),
                                   ("combined_observer.py", "decode_report")]:
            tree = ast.parse((source / "hardware" / filename).read_text())
            node = next(n for n in tree.body
                        if isinstance(n, ast.FunctionDef) and n.name == function)
            exec(compile(ast.Module(body=[node], type_ignores=[]), filename, "exec"), ns)
        for op, epoch, size in [(1, 0, 65536), (2, 1, 0), (3, 1, 0)]:
            self.assertEqual(host.command(op, epoch, size), ns["command"](op, 0, epoch, size))
        ns["MAGIC"] = b"UCV4"
        self.assertEqual(host.decode_observer(observer()),
                         ns["decode_report"](observer(), image_digest=host.IMAGE_HASH,
                                             inputs_digest=bytes.fromhex(host.INPUT_HASH)))

    def test_drain_is_bounded(self):
        port = Port(b"")
        port.out_waiting = 10
        with patch.object(host.time, "monotonic", side_effect=[0, 21]):
            with self.assertRaises(TimeoutError):
                host.Link(port, io.BytesIO(), print).drain()


if __name__ == "__main__":
    unittest.main()
