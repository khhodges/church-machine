"""Focused regression coverage for Task #3321 bootstrap T == GT."""
import json
from pathlib import Path
import shutil

import pytest

from server.bootstrap_identity import (
    bootstrap_identity_record,
    bootstrap_t_from_self_gt,
    verify_bootstrap_self_gt,
)
from server.lump_approvals import read_approvals
from server.lump_integrity import resolve_canonical_lump, canonical_binding_headers
from server.boot_image import generate_boot_image


_RESIDENT = {
    "resident": True, "boot_resident": True, "type": "Inform",
    "load_policy": "Resident", "ns_slot_policy": "static",
    "slot": 0xBEEF, "seq": 1, "token": "4a01beef",
}


def test_bootstrap_t_serializes_the_complete_unsigned_self_gt():
    gt = 0x4A01BEEF
    record = bootstrap_identity_record(_RESIDENT, gt)
    assert record == {"bootstrap_t": "4a01beef", "bootstrap_runtime_gt": gt}
    assert verify_bootstrap_self_gt(_RESIDENT, gt, record["bootstrap_t"]) == "4a01beef"


@pytest.mark.parametrize("binding", [
    {"resident": False, "boot_resident": True, "type": "Inform"},
    {"resident": True, "boot_resident": False, "type": "Inform"},
    {"resident": True, "boot_resident": True, "type": "Outform"},
    {"resident": True, "boot_resident": True, "type": "Inform", "load_policy": "Lazy"},
])
def test_bootstrap_helper_fails_closed_outside_frozen_resident(binding):
    with pytest.raises(ValueError):
        bootstrap_t_from_self_gt(binding, 0x4A000006)


def test_every_frozen_resident_manifest_approval_row0_and_boot_w3_share_t():
    root = Path(__file__).resolve().parents[2]
    lumps = root / "server" / "lumps"
    state = json.loads((lumps / "ns-state.json").read_text())
    image = (lumps / "boot-image.bin").read_bytes()
    words = __import__("struct").unpack(f"<{len(image) // 4}I", image)
    approvals = read_approvals(str(lumps / "approvals.json"))
    expected = {"SelfTest": 0x4A000006, "WukongCallHome": 0x4A000007,
                "CapabilityTest": 0x4A00000A}
    residents = [row for row in state["abstractions"]
                 if row.get("resident") is True and row.get("boot_resident") is True]
    assert {row["name"] for row in residents} == set(expected)
    for binding in residents:
        raw = (lumps / binding["filename"]).read_bytes()
        header = int.from_bytes(raw[:4], "big")
        allocation, cc = 1 << (((header >> 23) & 0xF) + 6), header & 0xFF
        row0 = int.from_bytes(raw[(allocation - cc) * 4:(allocation - cc + 1) * 4], "big")
        approval = approvals[__import__("hashlib").sha256(raw).hexdigest()]
        assert row0 == expected[binding["name"]]
        assert binding["token"] == f"{row0:08x}"
        assert binding["ns_slot_policy"] == "static"
        assert binding["load_policy"] == "Resident"
        assert approval["bootstrap_t"] == f"{row0:08x}"
        assert approval["bootstrap_runtime_gt"] == row0
        assert "identity_hash" not in approval
        assert words[len(words) - (binding["slot"] + 1) * 4 + 3] == row0


@pytest.mark.parametrize("mutation", ["slot", "seq", "token"])
def test_resolver_and_boot_reject_descriptor_or_token_mutation(tmp_path, mutation):
    root = Path(__file__).resolve().parents[2]
    source = root / "server" / "lumps"
    lumps = tmp_path / "lumps"
    shutil.copytree(source, lumps, symlinks=True)
    state = json.loads((lumps / "ns-state.json").read_text())
    row = next(r for r in state["abstractions"] if r.get("name") == "CapabilityTest")
    raw = (lumps / row["filename"]).read_bytes()
    request_token = row["token"]
    if mutation == "slot":
        row["slot"] = 11
    elif mutation == "seq":
        row["seq"] = 1
    else:
        row["token"] = "4a00000b"
    (lumps / "ns-state.json").write_text(json.dumps(state))
    resolution = resolve_canonical_lump(str(lumps), request_token, raw)
    assert not resolution["trusted"]
    assert "X-Lump-Identity-Hash" not in canonical_binding_headers(resolution)
    with pytest.raises(ValueError):
        generate_boot_image({"step1": {"totalNamespaceWords": 16384,
                                      "namespaceLumpWords": 1024,
                                      "threadLumpWords": 256}},
                            str(lumps))


def test_boot_rejects_identity_hash_downgrade_of_frozen_approval(tmp_path):
    root = Path(__file__).resolve().parents[2]
    lumps = tmp_path / "lumps"
    shutil.copytree(root / "server" / "lumps", lumps, symlinks=True)
    state = json.loads((lumps / "ns-state.json").read_text())
    row = next(r for r in state["abstractions"] if r.get("name") == "WukongCallHome")
    raw = (lumps / row["filename"]).read_bytes()
    digest = __import__("hashlib").sha256(raw).hexdigest()
    envelope = json.loads((lumps / "approvals.json").read_text())
    approval = envelope["approvals"][digest]
    approval.pop("bootstrap_t")
    approval.pop("bootstrap_runtime_gt")
    approval["identity_hash"] = __import__("hashlib").sha256(
        b"WukongCallHome#1").hexdigest()
    (lumps / "approvals.json").write_text(json.dumps(envelope))
    with pytest.raises(ValueError, match="requires bootstrap_t"):
        generate_boot_image({"step1": {"totalNamespaceWords": 16384,
                                      "namespaceLumpWords": 1024,
                                      "threadLumpWords": 256}}, str(lumps))