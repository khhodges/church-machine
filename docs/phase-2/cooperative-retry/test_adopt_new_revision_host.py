"""Host-only adoption checks; no serial device, board, build or network."""
import ast
import hashlib
import io
import json
from pathlib import Path
import struct
import unittest
from unittest.mock import patch

import adopt_new_revision as host
from test_lazy_load_old_host import Port, frame
from upload_combined_initial import Link


def baseline(seq, **kw):
    values = dict(host.BASELINE)
    values.update(kw)
    return frame(seq, **values)


def adopted(seq, **kw):
    values = dict(host.FINAL)
    values.update({f"result{i}": value for i, value in enumerate(host.RESULTS)})
    values.update({f"pc{i}": value for i, value in enumerate(host.PCS)})
    values.update(kw)
    return frame(seq, **values)


class Tests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.source = Path(__file__).resolve().parents[3] / (
            "generated-artifacts/combined-vendor-mmcm-corrected-20261111/source")
        cls.records = json.loads((cls.source / "combined-inputs.json").read_text())["records"]
        cls.data = struct.pack("<256I", *cls.records[2]["words"])

    def run_case(self, rx, fail=False, data=None):
        port = Port(rx)
        link = Link(port, io.BytesIO(), lambda message: None)
        if fail:
            with self.assertRaises((ValueError, TimeoutError)):
                host.deliver(link, self.data if data is None else data)
        else:
            host.deliver(link, self.data)
        return port

    def test_success_exact_wire_and_transient_results(self):
        midway = adopted(13, result_count=1, result1=0, result2=0, pc1=0, pc2=0)
        port = self.run_case(b"partial" + baseline(10) + baseline(11) +
            baseline(12, transaction=2, receiver_state=1) + midway +
            adopted(14) + adopted(15))
        self.assertEqual(port.writes, [host.command(1, 1024) + self.data + host.command(2)])

    def test_wrong_baselines_send_nothing(self):
        for kw in [dict(phase=0), dict(transaction=2), dict(publications=0),
                   dict(epoch=2), dict(fault_seen=1), dict(result_count=1),
                   dict(receiver_state=7), dict(progress=1)]:
            self.assertEqual(self.run_case(baseline(1, **kw) + baseline(2), True).writes, [])

    def test_bad_lump_sends_nothing(self):
        self.assertEqual(self.run_case(b"", True, bytes(1024)).writes, [])
        self.assertEqual(self.run_case(b"", True, self.data[:-1]).writes, [])

    def test_stopped_baseline_renewals_send_nothing(self):
        port = self.run_case(baseline(1, renewals=9) + baseline(2, renewals=9), True)
        self.assertEqual(port.writes, [])

    def test_wrong_result_pc_fault_and_failed_receiver(self):
        for kw in [dict(result0=18), dict(result1=17), dict(result2=29),
                   dict(pc0=0), dict(pc1=host.PCS[0]), dict(pc2=host.PCS[1]),
                   dict(fault_seen=1), dict(receiver_state=7), dict(progress=1)]:
            port = self.run_case(baseline(1) + baseline(2) + adopted(3, **kw), True)
            self.assertEqual(len(port.writes), 1)

    def test_repeated_or_regressing_confirmation_fails(self):
        for ending in [adopted(3), baseline(4), adopted(4, renewals=300)]:
            port = self.run_case(baseline(1) + baseline(2) + adopted(3) + ending, True)
            self.assertEqual(len(port.writes), 1)

    def test_stream_timeout(self):
        with patch.object(host.Observer, "read", side_effect=TimeoutError("no UART")):
            self.assertEqual(self.run_case(b"", True).writes, [])

    def test_frozen_identity_geometry_and_protocol(self):
        old, caller, new, new_caller = self.records
        self.assertEqual(hashlib.sha256(self.data).hexdigest(), host.LUMP_HASH)
        self.assertEqual((old["sizeWords"], new["sizeWords"]), (64, 256))
        self.assertLessEqual(old["baseByte"] + 64 * 4, new["baseByte"])
        self.assertEqual(host.PCS, (caller["baseByte"] + 16, new_caller["baseByte"] + 16,
                                   caller["baseByte"] + 16))
        tree = ast.parse((self.source / "hardware/combined_protocol.py").read_text())
        fn = next(n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name == "command")
        ns = dict(MAGIC=b"CLP1", struct=struct)
        exec(compile(ast.Module(body=[fn], type_ignores=[]), "frozen", "exec"), ns)
        for op, size in [(1, 1024), (2, 0)]:
            self.assertEqual(host.command(op, size), ns["command"](op, 1, 1, 2, size))


if __name__ == "__main__":
    unittest.main()
