import hashlib
import struct
import unittest
from unittest import mock

from server import boot_image
from server.portable_binding import (
    validate_portable_binding, validate_unresolved_clist, verify_candidate,
)


def _lump(cc=1):
    header = (0x1f << 27) | (0 << 23) | (1 << 10) | cc
    return struct.pack(">64I", header, 0x1f000000, *([0] * 62))


class PortableBindingTests(unittest.TestCase):
    def test_strong_external_dependency_requires_identity_hash(self):
        with self.assertRaisesRegex(ValueError, "requires authoritative identity_hash"):
            validate_portable_binding({
                "schema": "church.portable-lump-binding/v1", "owner": "Owner.Program#1",
                "dependencies": [
                    {"name": "__SELF__", "compiler_owned_self": True, "relocation_row": 0},
                    {"N": "Library.Target#7", "T": "01234567",
                     "binary_hash": "0" * 64, "rights": ["E"], "relocation_row": 1},
                ],
            }, 2)

    def test_contract_requires_one_inform_e_self_at_row_zero(self):
        base = {
            "schema": "church.portable-lump-binding/v1", "owner": "Owner.Program#1",
            "dependencies": [{"N": "Library.Target#7", "T": "01234567",
                              "binary_hash": "0" * 64,
                              "identity_hash": hashlib.sha256(b"Library.Target#7").hexdigest(),
                              "rights": ["E"],
                              "relocation_row": 0}],
        }
        with self.assertRaisesRegex(ValueError, "exactly one symbolic Self"):
            validate_portable_binding(base, 1)
        base["dependencies"].insert(0, {
            "name": "__SELF__", "compiler_owned_self": True,
            "rights": ["E"], "capability_type": "outform", "relocation_row": 0,
        })
        base["dependencies"][1]["relocation_row"] = 1
        with self.assertRaisesRegex(ValueError, "Inform"):
            validate_portable_binding(base, 2)

    def test_canonical_descriptor_and_actual_bytes_are_verified(self):
        raw = _lump(2)
        dot = "Library.Target"
        token = hashlib.sha256(dot.encode() + raw).hexdigest()[:8]
        digest = hashlib.sha256(raw).hexdigest()
        contract = validate_portable_binding({
            "schema": "church.portable-lump-binding/v1",
            "owner": "Owner.Program#1",
            "dependencies": [{"name": "__SELF__", "compiler_owned_self": True,
                              "relocation_row": 0},
                             {"N": "Library.Target#7", "T": token,
                              "binary_hash": digest,
                              "identity_hash": hashlib.sha256(b"Library.Target#7").hexdigest(),
                              "rights": ["E"],
                              "capability_type": "inform", "relocation_row": 1}],
        }, 2)
        ok, _ = verify_candidate(contract["dependencies"][1], {
            "dot_name": dot, "issue_n": 7, "authorized": True,
            "identity_hash": hashlib.sha256(b"Library.Target#7").hexdigest(),
        }, raw)
        self.assertTrue(ok)
        ok, reason = verify_candidate(contract["dependencies"][1], {
            "dot_name": dot, "issue_n": 7, "authorized": True,
            "identity_hash": hashlib.sha256(b"Library.Target#7").hexdigest(),
        }, raw[:-4] + b"\x00\x00\x00\x01")
        self.assertFalse(ok)
        self.assertIn("actual LUMP bytes", reason)

    def test_t_only_requires_explicit_legacy_authorization(self):
        raw = _lump(2)
        dot = "Library.Target"
        token = hashlib.sha256(dot.encode() + raw).hexdigest()[:8]
        contract = validate_portable_binding({
            "schema": "church.portable-lump-binding/v1",
            "owner": "Owner.Program#1", "compatibility": "allow-authorized-t-only",
            "dependencies": [{"name": "__SELF__", "compiler_owned_self": True,
                              "relocation_row": 0},
                             {"N": "Library.Target#7", "T": token,
                              "rights": ["E"], "relocation_row": 1}],
        }, 2)
        dep = contract["dependencies"][1]
        self.assertFalse(verify_candidate(dep, {"dot_name": dot, "issue_n": 7,
                                                 "authorized": True}, raw)[0])
        self.assertTrue(verify_candidate(dep, {
            "dot_name": dot, "issue_n": 7, "legacy_authorized": True, "authorized": True,
        }, raw)[0])

    def test_catalog_boot_localization_mints_only_after_verified_candidate(self):
        raw = _lump(2)
        dot = "Library.Target"
        token = hashlib.sha256(dot.encode() + raw).hexdigest()[:8]
        digest = hashlib.sha256(raw).hexdigest()
        binding = {"schema": "church.portable-lump-binding/v1", "owner": "Owner.Program#1",
                   "dependencies": [{"name": "__SELF__", "compiler_owned_self": True,
                                     "relocation_row": 0},
                                    {"N": "Library.Target#7", "T": token,
                                     "binary_hash": digest,
                                     "identity_hash": hashlib.sha256(b"Library.Target#7").hexdigest(),
                                     "rights": ["E"],
                                     "capability_type": "inform", "relocation_row": 1}]}
        words = list(struct.unpack(">64I", raw))
        words[-2] = 0xFEED5E1F
        localized = boot_image.localize_portable_lump_body(words, binding, {
            "Owner.Program#1": {"dot_name": "Owner.Program", "issue_n": 1,
                                "lump_bytes": raw, "ns_slot": 11, "sequence": 2,
                                "grants": ["E"], "capability_type": "inform", "authorized": True},
            "Library.Target#7": {"dot_name": dot, "issue_n": 7, "lump_bytes": raw,
                                 "ns_slot": 42, "sequence": 3, "grants": ["E"],
                                 "capability_type": "inform", "authorized": True,
                                 "identity_hash": hashlib.sha256(b"Library.Target#7").hexdigest()},
        })
        self.assertEqual(localized[-2], boot_image.create_gt(2, 11, {"E": 1}, 1))
        self.assertEqual(localized[-1], boot_image.create_gt(3, 42, {"E": 1}, 1))

    def test_unresolved_clist_rejects_embedded_local_gt(self):
        raw = _lump(2)
        dot = "Library.Target"
        binding = validate_portable_binding({
            "schema": "church.portable-lump-binding/v1", "owner": "Owner.Program#1",
            "dependencies": [
                {"name": "__SELF__", "compiler_owned_self": True, "relocation_row": 0},
                {"N": "Library.Target#7",
                 "T": hashlib.sha256(dot.encode() + raw).hexdigest()[:8],
                 "binary_hash": hashlib.sha256(raw).hexdigest(),
                 "identity_hash": hashlib.sha256(b"Library.Target#7").hexdigest(),
                 "rights": ["E"], "relocation_row": 1},
            ],
        }, 2)
        words = list(struct.unpack(">64I", raw))
        words[-2] = 0xFEED5E1F
        words[-1] = boot_image.create_gt(0, 42, {"E": 1}, 1)
        with self.assertRaisesRegex(ValueError, "embedded local GT"):
            validate_unresolved_clist(binding, words)

    def test_candidate_identity_hash_mismatch_is_rejected(self):
        raw = _lump(2)
        dot = "Library.Target"
        binding = validate_portable_binding({
            "schema": "church.portable-lump-binding/v1", "owner": "Owner.Program#1",
            "dependencies": [
                {"name": "__SELF__", "compiler_owned_self": True, "relocation_row": 0},
                {"N": "Library.Target#7",
                 "T": hashlib.sha256(dot.encode() + raw).hexdigest()[:8],
                 "binary_hash": hashlib.sha256(raw).hexdigest(),
                 "identity_hash": hashlib.sha256(b"Library.Target#7").hexdigest(),
                 "rights": ["E"], "relocation_row": 1},
            ],
        }, 2)
        ok, reason = verify_candidate(binding["dependencies"][1], {
            "dot_name": dot, "issue_n": 7, "authorized": True,
            "identity_hash": "f" * 64,
        }, raw)
        self.assertFalse(ok)
        self.assertIn("identity hash", reason)

    def test_wukong_rejects_unresolved_portable_marker_before_projection(self):
        words = [0] * 100
        words[0] = (0x1f << 27) | (1 << 10) | 1  # 64-word code LUMP, cc=1
        words[63] = 0xFEED5E1F
        words[50] = boot_image.BOOT_IMAGE_FORMAT_TAG
        image = struct.pack("<100I", *words)
        info = {"resident": True, "caps0_ok": True, "entry_slot": 6, "entry_loc": 0}
        with mock.patch.object(boot_image, "read_boot_entry_info", return_value=info):
            with self.assertRaisesRegex(ValueError, "unresolved portable c-list"):
                boot_image.build_wukong_upload_image(image)


if __name__ == "__main__":
    unittest.main()