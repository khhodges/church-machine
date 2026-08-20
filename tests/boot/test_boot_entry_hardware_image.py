"""Regression tests — hardware boot-entry selection (Task: boot-to-first-LUMP handoff).

The Wukong board's boot ROM runs whatever E-GT sits in Thread.caps[0]
(thread_loc + 244).  These tests assert that generate_boot_image():

  1. writes the requested boot-entry E-GT at the Thread.caps[0] word offset,
     for both slot 6 (SelfTest) and slot 7 (WukongCallHome);
  2. leaves the selected entry lump's body RESIDENT in the image (magic
     header, cw > 0) when require_entry_resident=True;
  3. fails loudly (ValueError) when the entry lump body is not resident and
     require_entry_resident=True (hardware upload path);
  4. read_boot_entry_info() reports the same facts from the packed image —
     this is the gate /api/boot-image/send-to-hardware uses to reject
     non-resident images before they reach the board.
"""
import json
import os
import struct
import sys

import pytest

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
sys.path.insert(0, ROOT)

from server.boot_image import (
    generate_boot_image,
    read_boot_entry_info,
    build_wukong_upload_image,
    create_gt,
    integrity32,
    NS_ENTRY_WORDS,
    WUKONG_DMEM_WORDS,
    WUKONG_UPLOAD_BODY_BASE_WORD,
)

LUMPS_DIR = os.path.join(ROOT, "server", "lumps")

THREAD_CAPS_OFFSET = 244   # Thread.caps[0] word offset inside the Thread lump


def _minimal_cfg(total=16384):
    return {
        "step1": {
            "totalNamespaceWords": total,
            "namespaceLumpWords":  1024,
            "threadLumpWords":      256,
        },
    }


def _unpack_words(data):
    n = len(data) // 4
    return list(struct.unpack(f"<{n}I", data[:n * 4]))


def _ns_slot_base(total, slot):
    return total - (slot + 1) * NS_ENTRY_WORDS


def _thread_loc(words, total):
    return words[_ns_slot_base(total, 1)]


def _reissue_boot_entry(image, slot, seq):
    """Return a coherent image where ``slot`` has a non-zero generation."""
    words = _unpack_words(image)
    total = len(words)
    ns_base = _ns_slot_base(total, slot)
    authority = (words[ns_base + 1] & ~(0x1FF << 21)) | ((seq & 0x1FF) << 21)
    words[ns_base + 1] = authority
    words[ns_base + 2] = integrity32(words[ns_base], authority)
    words[_thread_loc(words, total) + THREAD_CAPS_OFFSET] = create_gt(
        seq, slot, {"E": 1}, 1
    )
    return struct.pack(f"<{total}I", *words)


def _capabilitytest_manifest_body():
    """Load the one manifest-designated CapabilityTest body for slot 10."""
    with open(os.path.join(LUMPS_DIR, "manifest.json"), "r") as f:
        entries = json.load(f)
    matches = [
        entry for entry in entries
        if isinstance(entry, dict)
        and not entry.get("archived")
        and entry.get("abstraction") == "CapabilityTest"
        and entry.get("ns_slot") == 10
        and entry.get("boot_resident") is True
    ]
    assert len(matches) == 1, (
        "manifest.json must define exactly one boot-resident CapabilityTest "
        f"at slot 10; found {len(matches)}"
    )
    filename = matches[0].get("filename")
    assert isinstance(filename, str) and filename
    with open(os.path.join(LUMPS_DIR, filename), "rb") as f:
        raw = f.read()
    assert len(raw) % 4 == 0
    return list(struct.unpack(f">{len(raw) // 4}I", raw))


@pytest.mark.parametrize("slot", [6, 7])
def test_caps0_gt_and_entry_body_resident(slot):
    """Hardware image carries the requested E-GT at Thread.caps[0] and a
    resident entry lump body, for both slot 6 and slot 7."""
    cfg = _minimal_cfg()
    image = generate_boot_image(cfg, LUMPS_DIR, boot_entry_slot=slot,
                                require_entry_resident=True)
    words = _unpack_words(image)
    total = cfg["step1"]["totalNamespaceWords"]

    # Thread.caps[0] holds the E-GT for the selected slot.
    thr = _thread_loc(words, total)
    caps0 = words[thr + THREAD_CAPS_OFFSET]
    expected = create_gt(0, slot, {"E": 1}, 1)
    assert caps0 == expected, (
        f"Thread.caps[0] = 0x{caps0:08x}, expected E-GT 0x{expected:08x} "
        f"for slot {slot}"
    )

    # Entry lump body is resident: valid magic and cw > 0 at NS word0 location.
    entry_loc = words[_ns_slot_base(total, slot)]
    assert 0 < entry_loc < total, f"slot {slot} location {entry_loc} out of range"
    hdr = words[entry_loc]
    assert (hdr >> 27) & 0x1F == 0x1F, (
        f"slot {slot} entry lump header 0x{hdr:08x} has wrong magic"
    )
    assert (hdr >> 10) & 0x1FFF > 0, (
        f"slot {slot} entry lump is a cw=0 stub — body not resident"
    )


@pytest.mark.parametrize("slot", [6, 7])
def test_read_boot_entry_info_matches(slot):
    """read_boot_entry_info() (the send-to-hardware gate) agrees with the
    generator: correct slot, resident body, matching caps[0] GT."""
    image = generate_boot_image(_minimal_cfg(), LUMPS_DIR, boot_entry_slot=slot,
                                require_entry_resident=True)
    info = read_boot_entry_info(image)
    assert info["entry_slot"] == slot
    assert info["resident"] is True, f"reason: {info['reason']}"
    assert info["caps0_ok"] is True, (
        f"caps0=0x{info['thread_caps0']:08x} expected=0x{info['expected_gt']:08x}"
    )


def test_non_resident_entry_rejected_for_hardware():
    """require_entry_resident=True must raise for an entry slot whose body is
    not resident (MMIO device slot — never has executable code)."""
    with pytest.raises(ValueError, match="not resident|MMIO"):
        generate_boot_image(_minimal_cfg(), LUMPS_DIR, boot_entry_slot=2,
                            require_entry_resident=True)


def test_non_resident_entry_allowed_for_simulator():
    """Same slot without require_entry_resident generates (simulator can
    lazy-fetch), but read_boot_entry_info flags it as non-resident so the
    send-to-hardware gate would reject it."""
    image = generate_boot_image(_minimal_cfg(), LUMPS_DIR, boot_entry_slot=2)
    info = read_boot_entry_info(image)
    assert info["entry_slot"] == 2
    assert info["resident"] is False
    assert info["reason"]


def test_wukong_projection_keeps_capabilitytest_body_and_clist():
    """Slot 10 must survive the generic-image → Wukong-DMEM projection.

    This is the board-specific regression for the NUC_CLIST header-magic
    fault: Wukong reads a forward NS descriptor at word 10*4, not the generic
    image's inverted tail-table entry.
    """
    generic = generate_boot_image(
        _minimal_cfg(), LUMPS_DIR, boot_entry_slot=10,
        require_entry_resident=True,
    )
    projected, info = build_wukong_upload_image(generic)
    words = _unpack_words(projected)
    expected_body = _capabilitytest_manifest_body()
    forward_ns_base = 10 * NS_ENTRY_WORDS
    body_base = WUKONG_UPLOAD_BODY_BASE_WORD

    assert len(projected) == WUKONG_DMEM_WORDS * 4
    assert info["entry_slot"] == 10
    assert info["entry_loc"] == body_base
    assert info["resident"] is True
    assert info["caps0_ok"] is True
    assert words[forward_ns_base] == body_base * 4
    assert words[body_base:body_base + len(expected_body)] == expected_body
    assert ((words[body_base] >> 27) & 0x1F) == 0x1F
    assert ((words[body_base] >> 10) & 0x1FFF) == (
        (expected_body[0] >> 10) & 0x1FFF
    )
    expected_cc = expected_body[0] & 0xFF
    assert words[body_base + len(expected_body) - expected_cc:
                 body_base + len(expected_body)] == expected_body[-expected_cc:]
    # Wukong's fixed Boot.Thread lives at word 896 and dispatches from caps[0].
    assert words[896 + THREAD_CAPS_OFFSET] == create_gt(0, 10, {"E": 1}, 1)


def test_wukong_projection_preserves_reissued_boot_entry_generation():
    """An entry at generation 1 must retain matching GTs after projection.

    This protects the real VERSION fault where a slot-10 descriptor said seq=1
    while Thread.caps[0] was still minted at seq=0.
    """
    generic = generate_boot_image(
        _minimal_cfg(), LUMPS_DIR, boot_entry_slot=10,
        require_entry_resident=True,
    )
    reissued = _reissue_boot_entry(generic, 10, 1)
    source_info = read_boot_entry_info(reissued)
    projected, projected_info = build_wukong_upload_image(reissued)
    words = _unpack_words(projected)

    assert source_info["entry_gt_seq"] == 1
    assert source_info["caps0_ok"] is True
    assert source_info["expected_gt"] == create_gt(1, 10, {"E": 1}, 1)
    assert projected_info["caps0_ok"] is True
    assert words[10 * NS_ENTRY_WORDS + 1] >> 21 == 1
    assert words[896 + THREAD_CAPS_OFFSET] == create_gt(1, 10, {"E": 1}, 1)
