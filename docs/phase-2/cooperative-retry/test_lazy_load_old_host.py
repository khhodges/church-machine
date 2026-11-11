"""Offline host-only tests; never opens serial or touches hardware."""
import ast
import binascii
import hashlib
import io
import json
from pathlib import Path
import struct
import unittest

import lazy_load_old as host
from upload_combined_initial import Link, IMAGE_HASH, INPUT_HASH, FIELDS


def frame(seq, **kw):
    fields = dict.fromkeys(FIELDS, 0)
    fields.update(epoch=1, renewals=seq * 100)
    fields.update(kw)
    raw = (b"UCV4" + struct.pack(">I", seq) + bytes.fromhex(IMAGE_HASH + INPUT_HASH)
           + struct.pack(">16I", *(fields[k] for k in FIELDS)))
    return raw + struct.pack(">H", binascii.crc_hqx(raw, 0xffff))


class Port:
    out_waiting = 0

    def __init__(self, rx):
        self.rx, self.writes = bytearray(rx), []

    def read(self, n):
        data = bytes(self.rx[:min(n, 7)])
        del self.rx[:len(data)]
        return data

    def write(self, data):
        self.writes.append(data)
        return len(data)


class Tests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.source = Path(__file__).resolve().parents[3] / (
            "generated-artifacts/combined-vendor-mmcm-corrected-20261111/source")
        row = json.loads((cls.source / "combined-inputs.json").read_text())["records"][0]
        cls.data = struct.pack("<64I", *row["words"])
        assert hashlib.sha256(cls.data).hexdigest() == row["localizedSha256LE"]

    def run_case(self, rx, fail=False, data=None):
        port = Port(rx)
        link = Link(port, io.BytesIO(), lambda x: None)
        if fail:
            with self.assertRaises((ValueError, TimeoutError)):
                host.deliver(link, self.data if data is None else data)
        else:
            host.deliver(link, self.data)
        return port

    def test_success_and_exact_wire(self):
        state = dict(phase=1, publications=1, transaction=1, receiver_state=6)
        port = self.run_case(b"partial" + frame(10) + frame(11) +
                             frame(12, transaction=1, receiver_state=1) +
                             frame(13, **state) + frame(14, **state))
        self.assertEqual(port.writes, [host.command(1, 256) + self.data + host.command(2)])

    def test_bad_baselines_send_nothing(self):
        for changes in [dict(epoch=2), dict(fault_seen=1), dict(phase=1),
                        dict(transaction=1), dict(receiver_state=7), dict(result_count=1)]:
            self.assertEqual(self.run_case(frame(1, **changes) + frame(2), True).writes, [])

    def test_bad_lump_sends_nothing(self):
        self.assertEqual(self.run_case(b"", True, bytes(256)).writes, [])

    def test_stopped_renewals_send_nothing(self):
        self.assertEqual(self.run_case(frame(1, renewals=7) + frame(2, renewals=7), True).writes, [])

    def test_failed_receiver_does_not_retry(self):
        port = self.run_case(frame(1) + frame(2) + frame(3, receiver_state=7), True)
        self.assertEqual(len(port.writes), 1)

    def test_crc_failure_and_sequence_gap(self):
        bad = bytearray(frame(1))
        bad[-1] ^= 1
        self.assertEqual(self.run_case(bytes(bad), True).writes, [])
        self.assertEqual(self.run_case(frame(1) + frame(3), True).writes, [])

    def test_frozen_protocol_matches(self):
        tree = ast.parse((self.source / "hardware/combined_protocol.py").read_text())
        func = next(n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name == "command")
        ns = dict(MAGIC=b"CLP1", struct=struct)
        exec(compile(ast.Module(body=[func], type_ignores=[]), "frozen", "exec"), ns)
        for op, size in [(1, 256), (2, 0)]:
            self.assertEqual(host.command(op, size), ns["command"](op, 0, 1, 1, size))

    def test_postpublication_fault_is_failure(self):
        state = dict(phase=1, publications=1, transaction=1, receiver_state=6)
        port = self.run_case(frame(1) + frame(2) + frame(3, **state) +
                             frame(4, fault_seen=1, **state), True)
        self.assertEqual(len(port.writes), 1)


if __name__ == "__main__":
    unittest.main()
