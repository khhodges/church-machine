"""Independent frozen build evidence, no FPGA or current boot_rom imports."""
import hashlib
from pathlib import Path
import struct
import tarfile

import pytest
from hardware.wukong_bridge import boot_profile_n_init, validate_boot_sentinel


def test_profile_requires_explicit_selection():
    assert boot_profile_n_init(None) is None
    assert boot_profile_n_init("unknown") is None
    assert boot_profile_n_init("amoeba-retry-25mhz-uart-v1") == 2463
    sentinel = dict(magic=0xBC, tu_version=2, n_init_byte=0x9F)
    assert validate_boot_sentinel(sentinel, 2463)
    assert not validate_boot_sentinel({**sentinel, "n_init_byte": 0x9E}, 2463)


def test_expectation_matches_frozen_vendor_image():
    path = Path("attached_assets/amoeba-retry-vendor-evidence.tar_1793391382023.gz")
    if not path.is_file():
        pytest.skip("vendor evidence archive not installed")
    with tarfile.open(path) as archive:
        raw = archive.extractfile("./candidate-le.bin").read()
    assert hashlib.sha256(raw).hexdigest() == (
        "5603d8e105e47ca0f6524e4553989387c088de19ac0e6b3f6fd9897e170cf16d")
    count = sum(word != 0 for word in struct.unpack("<16384I", raw))
    assert count == boot_profile_n_init("amoeba-retry-25mhz-uart-v1")
    assert count & 255 == 0x9F
