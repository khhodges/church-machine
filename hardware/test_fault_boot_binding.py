"""Exact prepared-image wiring, with disposable bytes and no catalog access."""
from dataclasses import replace
import hashlib
import struct

import pytest

from hardware.fault_entry import FaultBootBinding
from hardware.guarded_build_profile import bind_prepared_boot, build_inputs
from hardware.integrity32 import integrity32


def prepared():
    words = [0] * 16384
    for slot, base, version in ((1, 0, 3), (2, 256, 5)):
        auth = 255 | version << 21
        words[slot * 4:slot * 4 + 4] = [base, auth, integrity32(base, auth), 0]
    words[256] = 0xf900820c
    digest = hashlib.sha256(struct.pack("<16384I", *words)).hexdigest()
    return words, digest


def test_preparation_derives_only_foundational_identity():
    words, digest = prepared()
    kwargs, record = bind_prepared_boot(
        dict(runtime_image_words=words, expected_boot_guard=(3 << 9) | 5),
        dict(imageSha256=digest))
    binding = kwargs["fault_boot_binding"]
    assert binding.namespace == 0x02030001 | (255 | 3 << 21) << 64
    assert binding.thread == 0x02050002 | 1024 << 32 | (255 | 5 << 21) << 64
    assert not hasattr(binding, "handler")
    assert binding.image_sha256 == digest
    assert record["faultEntry"] == "boot-thread-continuation"
    assert kwargs["runtime_image_words"] is words
    assert build_inputs() == (dict(clk_freq=50_000_000, baud=57600, sim_mode=False), None)


@pytest.mark.parametrize("corruption", ["hash", "seal", "layout", "thread", "word", "guard"])
def test_bad_preparation_rejected(corruption):
    words, digest = prepared()
    if corruption == "hash":
        digest = "0" * 64
    elif corruption != "guard":
        if corruption == "seal":
            words[10] ^= 1
        elif corruption == "layout":
            words[4] = 4
        elif corruption == "thread":
            words[256] = 0
        else:
            words[100] = -1
        if corruption != "word":
            digest = hashlib.sha256(struct.pack("<16384I", *words)).hexdigest()
    with pytest.raises(ValueError):
        FaultBootBinding.from_prepared_image(
            words, image_sha256=digest, boot_guard=0 if corruption == "guard" else 1541)


def test_wrapper_revalidates_binding_fields_not_just_hash():
    from hardware.wukong_top import ChurchWukongXC7A100T
    words, digest = prepared()
    binding = FaultBootBinding.from_prepared_image(
        words, image_sha256=digest, boot_guard=1541)
    with pytest.raises(ValueError, match="differs from the prepared image"):
        ChurchWukongXC7A100T(sim_mode=True, sim_boot_image_words=words,
                            expected_boot_guard=1541,
                            fault_boot_binding=replace(binding, checks=()))
