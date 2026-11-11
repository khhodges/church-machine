"""Offline replacement transport tests; never opens a serial port."""
import ast
import binascii
import io
from pathlib import Path
import struct
import unittest

import replace_with_user_b as host
from test_lazy_load_old_host import Port, frame
from test_adopt_new_revision_host import adopted
from upload_combined_initial import Link


def status(state, image=1, epoch=2):
    return b"CS" + bytes((state, image)) + struct.pack(">I", epoch)


def user_b(seq, **kw):
    values = dict(epoch=2, progress=seq * 10)
    values.update(kw)
    raw = bytearray(frame(seq, **values))
    raw[8:40] = bytes.fromhex(host.IMAGE_HASH)
    raw[-2:] = struct.pack(">H", binascii.crc_hqx(raw[:-2], 0xffff))
    return bytes(raw)


class Tests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.source = Path(__file__).resolve().parents[3] / (
            "generated-artifacts/combined-vendor-mmcm-corrected-20261111/source")
        cls.data = (cls.source / "applications/user-b.bin").read_bytes()

    def run_case(self, rx, fail=False, data=None):
        port = Port(rx)
        link = Link(port, io.BytesIO(), lambda x: None)
        if fail:
            with self.assertRaises((ValueError, TimeoutError)):
                host.replace(link, self.data if data is None else data)
        else:
            host.replace(link, self.data)
        return port

    def prefix(self):
        return adopted(10) + adopted(11)

    def loaded(self):
        return self.prefix() + status(1) + status(2) + status(3) + status(4)

    def test_exact_success_wire(self):
        port = self.run_case(b"partial" + self.loaded() + user_b(1) + user_b(2) + user_b(3))
        self.assertEqual(b"".join(port.writes),
                         host.command(1, 1, 65536) + self.data +
                         host.command(2, 2) + host.command(3, 2))

    def test_optional_verify_status(self):
        self.run_case(self.prefix() + status(1) + status(3) + status(4)
                      + user_b(1) + user_b(2) + user_b(3))

    def test_wrong_baseline_sends_nothing(self):
        for kw in [dict(epoch=2), dict(phase=1), dict(result0=0), dict(pc1=0),
                   dict(fault_seen=1), dict(transaction=3)]:
            self.assertEqual(self.run_case(adopted(1, **kw) + adopted(2), True).writes, [])

    def test_bad_image_sends_nothing(self):
        self.assertEqual(self.run_case(b"", True, bytes(65536)).writes, [])

    def test_wrong_loading_status_stops_before_data(self):
        for packet in [status(1, epoch=1), status(1, image=0), status(5), b"BADFRAME"]:
            self.assertEqual(len(self.run_case(self.prefix() + packet, True).writes), 1)

    def test_failed_validation_never_starts(self):
        port = self.run_case(self.prefix() + status(1) + status(2) + status(5), True)
        self.assertNotIn(host.command(3, 2), port.writes)

    def test_post_start_identity_epoch_crc_and_fault(self):
        corrupted = bytearray(user_b(1))
        corrupted[-1] ^= 1
        for bad in [frame(1, epoch=2), user_b(1, epoch=1), user_b(1, fault_seen=1),
                    bytes(corrupted)]:
            port = self.run_case(self.loaded() + bad, True)
            self.assertEqual(port.writes.count(host.command(3, 2)), 1)

    def test_stale_admission_state_rejected(self):
        for key in ("phase", "transaction", "receiver_state", "publications",
                    "result_count", "result0", "pc0"):
            self.run_case(self.loaded() + user_b(1, **{key: 1}), True)

    def test_no_progress_or_renewal_fails(self):
        for kw in [dict(progress=0), dict(renewals=8)]:
            self.run_case(self.loaded() + user_b(1, **kw) +
                          user_b(2, **kw) + user_b(3, **kw), True)

    def test_frozen_wire_format(self):
        tree = ast.parse((self.source / "hardware/starter_transport.py").read_text())
        fn = next(n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name == "command")
        ns = dict(MAGIC=b"CSI1")
        exec(compile(ast.Module(body=[fn], type_ignores=[]), "frozen", "exec"), ns)
        for op, epoch, size in [(1, 1, 65536), (2, 2, 0), (3, 2, 0)]:
            self.assertEqual(host.command(op, epoch, size), ns["command"](op, 1, epoch, size))


if __name__ == "__main__":
    unittest.main()
