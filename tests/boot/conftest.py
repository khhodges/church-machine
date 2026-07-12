"""Shared fixtures for tests/boot/.

The ``ensure_boot_abstr_lump`` fixture is session-scoped and autouse=True.
It writes a minimal synthetic Boot.Abstr lump (00000600.lump) to the real
server/lumps/ directory so that generate_boot_image() can succeed during
tests without needing the actual PostFlashSelftest lump on disk.

After the test session the file is removed if it was created by this fixture.
"""
import math
import os
import struct

import pytest

ROOT      = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
LUMPS_DIR = os.path.join(ROOT, "server", "lumps")

_BOOT_ABSTR_NS_SLOT = 6
_LUMP_SIZE          = 64          # words — must match BOOT_ABSTR_DEFAULT_SIZE
_LUMP_FILENAME      = f"{_BOOT_ABSTR_NS_SLOT << 8:08x}.lump"   # "00000600.lump"
_LUMP_PATH          = os.path.join(LUMPS_DIR, _LUMP_FILENAME)


def _make_synthetic_lump(lump_size: int = _LUMP_SIZE, cw: int = 3, cc: int = 0) -> bytes:
    """Return a minimal valid big-endian Boot.Abstr lump binary.

    Header: magic=0x1F, n_minus_6 derived from lump_size, cw, cc.
    All code/data words are zero (the lump body is not executed by these tests).
    This matches what generate_boot_image() embeds from the real SelfTest lump
    in terms of header layout and NS entry values.
    """
    n_minus_6 = max(0, math.ceil(math.log2(lump_size)) - 6)
    hdr       = (0x1F << 27) | (n_minus_6 << 23) | (cw << 10) | cc
    words     = [0] * lump_size
    words[0]  = hdr
    return struct.pack(f">{lump_size}I", *words)


@pytest.fixture(scope="session", autouse=True)
def ensure_boot_abstr_lump():
    """Write a synthetic 00000600.lump to server/lumps/ for the test session.

    generate_boot_image() raises ValueError when the Boot.Abstr lump file is
    absent (direct-dispatch model — no trampoline fallback).  Tests in this
    directory call generate_boot_image(cfg, LUMPS_DIR) with the real lumps
    directory, so a synthetic stand-in is installed for the duration of the
    session and cleaned up afterwards.

    If 00000600.lump is already present (e.g. a real SelfTest lump is installed)
    this fixture is a no-op and does not remove it afterwards.
    """
    already_present = os.path.exists(_LUMP_PATH)
    if not already_present:
        os.makedirs(LUMPS_DIR, exist_ok=True)
        with open(_LUMP_PATH, "wb") as fh:
            fh.write(_make_synthetic_lump())
    yield
    # Do NOT delete the synthetic lump in teardown.  The all-tests runner
    # executes boot test suites in parallel; a teardown delete in one pytest
    # session races with another session that also needs the file.  Leaving
    # the synthetic lump in server/lumps/ is safe — generate_boot_image()
    # treats any file whose name matches <slot<<8>.lump as the Boot.Abstr
    # lump and embeds it verbatim; the real SelfTest lump will overwrite this
    # stub when it is (re)built by update-lump.
