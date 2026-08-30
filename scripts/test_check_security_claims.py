#!/usr/bin/env python3
"""Mutation tests for check_security_claims.py."""

from __future__ import annotations

import shutil
import tempfile
import unittest
from pathlib import Path

import check_security_claims


ROOT = Path(__file__).resolve().parents[1]


class SecurityClaimsGuardTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp_dir = tempfile.TemporaryDirectory()
        self.root = Path(self.temp_dir.name)
        (self.root / "docs").mkdir()
        shutil.copy2(ROOT / "README.md", self.root / "README.md")
        shutil.copy2(ROOT / "docs/HARDWARE.md", self.root / "docs/HARDWARE.md")
        shutil.copy2(
            ROOT / "docs/cm-msg-protocol.md",
            self.root / "docs/cm-msg-protocol.md",
        )
        shutil.copytree(ROOT / "docs/archive", self.root / "docs/archive")

    def tearDown(self) -> None:
        self.temp_dir.cleanup()

    def mutate(self, relative: str, old: str, new: str) -> None:
        path = self.root / relative
        text = path.read_text(encoding="utf-8")
        self.assertIn(old, text)
        path.write_text(text.replace(old, new, 1), encoding="utf-8")

    def assert_rejected(self, expected: str) -> None:
        errors = check_security_claims.validate(self.root)
        self.assertTrue(
            any(expected.lower() in error.lower() for error in errors),
            f"expected {expected!r} in errors: {errors}",
        )

    def test_clean_repository_fixture_passes(self) -> None:
        self.assertEqual([], check_security_claims.validate(self.root))

    def test_rejects_fw3_shipped_top_status(self) -> None:
        self.mutate(
            "docs/cm-msg-protocol.md",
            "**Planned (FW=3):**",
            "**Shipped/current (FW=3):**",
        )
        self.assert_rejected("planned/design/proposal FW=3 bullet")

    def test_rejects_fw3_current_compatibility_row(self) -> None:
        self.mutate(
            "docs/cm-msg-protocol.md",
            "**FW=3.0** (planned)",
            "**FW=3.0** (current)",
        )
        self.assert_rejected("FW=3 compatibility row must be labeled")

    def test_rejects_fw2_encryption_claim(self) -> None:
        self.mutate(
            "docs/cm-msg-protocol.md",
            "Plaintext ASCII JSON/control data over UART",
            "Encrypted ASCII JSON/control data over UART",
        )
        self.assert_rejected("FW=2 compatibility row must describe plaintext")

    def test_rejects_unlabeled_fw3_crypto_section(self) -> None:
        self.mutate(
            "docs/cm-msg-protocol.md",
            "## 3. Proposed FW=3 Wire Format",
            "## 3. FW=3 Wire Format",
        )
        self.assert_rejected("must be labeled planned, design, or proposal")

    def test_rejects_contradictory_cipher(self) -> None:
        self.mutate("docs/cm-msg-protocol.md", "ChaCha20", "AES-GCM")
        self.assert_rejected("contradictory cipher")

    def test_rejects_invalid_chacha20_key_width(self) -> None:
        self.mutate(
            "docs/cm-msg-protocol.md",
            "256-bit `K_enc`",
            "128-bit `K_enc`",
        )
        self.assert_rejected("ChaCha20 K_enc must be 256-bit")

    def test_rejects_short_hkdf_output(self) -> None:
        self.mutate(
            "docs/cm-msg-protocol.md",
            "K_enc = HKDF(hashes.SHA256(), 32,",
            "K_enc = HKDF(hashes.SHA256(), 16,",
        )
        self.assert_rejected("must derive 32-byte K_enc")

    def test_rejects_32_bit_frame_nonce(self) -> None:
        self.mutate(
            "docs/cm-msg-protocol.md",
            "64-bit monotonic nonce counter",
            "32-bit monotonic nonce counter",
        )
        self.assert_rejected("nonce declarations must not use 32-bit")

    def test_rejects_uncovered_archive_file(self) -> None:
        self.mutate(
            "docs/archive/README.md",
            "Every file in this directory",
            "Files in this directory",
        )
        (self.root / "docs/archive/unmarked.txt").write_text(
            "unmarked archive\n", encoding="utf-8"
        )
        self.assert_rejected("unmarked.txt")


if __name__ == "__main__":
    unittest.main()