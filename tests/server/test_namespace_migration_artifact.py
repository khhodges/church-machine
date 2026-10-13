import hashlib
import json
import struct

import pytest

from server.boot_image import create_gt
from server.namespace_layout_review import prepare as prepare_review
from server.namespace_migration_artifact import prepare_migration


def _lump(rows):
    words = [(31 << 27) | (1 << 10) | len(rows)]
    words.extend([0] * (63 - len(rows)))
    words.extend(rows)
    return struct.pack(">64I", *words)


def _fixture():
    artifacts = {
        "SelfTest.lump": _lump([create_gt(0, 6, {"E": 1}, 1)]),
        "WukongCallHome.lump": _lump([
            create_gt(0, 7, {"E": 1}, 1),
            create_gt(0, 2, {"R": 1, "W": 1}, 1),
        ]),
        "CapabilityTest.lump": _lump([
            create_gt(0, 8, {"E": 1}, 1),
            create_gt(0, 2, {"R": 1, "W": 1}, 1),
            create_gt(0, 1, {"E": 1}, 1),
        ]),
    }
    rows = [
        dict(name="Boot.NS", slot=0, seq=0, location=0, limit=255),
        dict(name="Boot.Thread", slot=1, seq=0, location=16, limit=255),
        dict(name="UART_DEV", slot=2, seq=0, location=0x40000014, limit=2),
        dict(name="LED_DEV", slot=3, seq=0, location=0x40000000, limit=4),
    ]
    for index, (name, raw) in enumerate(artifacts.items()):
        rows.append(dict(name=name[:-5], slot=6 + index, seq=0,
                         location=272 + 64 * index, limit=1, filename=name,
                         binary_hash=hashlib.sha256(raw).hexdigest(),
                         boot_resident=True, boot=index == 2))
    return (
        {"abstractions": rows, "freeSlotSequences": {"4": 7}},
        {"step1": {"totalNamespaceWords": 8192, "nsSlotsMax": 64,
                   "threadStackWords": 32}},
        artifacts,
    )


def _make_review(tmp_path, *, stale_gt=False, unresolved_gt=False):
    state, config, artifacts = _fixture()
    if stale_gt or unresolved_gt:
        raw = bytearray(artifacts["WukongCallHome.lump"])
        if stale_gt:
            # A source GT with a sequence that does not match source NS[2].
            value = create_gt(1, 2, {"R": 1, "W": 1}, 1)
        else:
            value = 0xFEED0000
        struct.pack_into(">I", raw, 63 * 4, value)
        artifacts["WukongCallHome.lump"] = bytes(raw)
        next(row for row in state["abstractions"]
             if row["name"] == "WukongCallHome")["binary_hash"] = hashlib.sha256(raw).hexdigest()
    live = tmp_path / "live"
    live.mkdir(parents=True)
    (live / "ns-state.json").write_text(json.dumps(state))
    config_path = tmp_path / "boot-config.json"
    config_path.write_text(json.dumps(config))
    for filename, raw in artifacts.items():
        (live / filename).write_bytes(raw)
    root = tmp_path / "generated-artifacts"
    review_dir = root / "review"
    review = prepare_review(live, config_path, review_dir, staging_root=root)
    before = {str(path): path.read_bytes() for path in (config_path, *live.iterdir())}
    return root, review_dir, review, before


def test_migration_package_localizes_private_residents_and_preserves_saved_design(tmp_path):
    root, review_dir, review, before = _make_review(tmp_path)
    output = root / "migration"

    record = prepare_migration(
        review_dir, output, staging_root=root)

    assert record["status"] == "private-migration-rows-prepared"
    assert record["approvalEligible"] is False
    assert record["activationAllowed"] is False
    assert record["imageGenerated"] is False
    assert record["reviewId"] == review["reviewId"]
    assert len(record["localizedResidents"]) == 3
    assert len(record["affectedBindingsVerified"]) == 3
    assert all(binding["verified"] for binding in record["affectedBindingsVerified"])
    target = json.loads((output / "target-state.json").read_text())
    assert target["namespaceFormat"] == "ascending-nst-metadata-slot0-v1"
    by_name = {row["name"]: row for row in target["abstractions"]}
    assert (by_name["Boot.NS"]["slot"], by_name["Boot.Thread"]["slot"]) == (1, 2)
    assert (by_name["UART_DEV"]["slot"], by_name["UART_DEV"]["seq"]) == (4, 7)
    assert by_name["WukongCallHome"]["slot"] == 7
    assert before == {
        str(path): path.read_bytes()
        for path in (tmp_path / "boot-config.json", *(tmp_path / "live").iterdir())
    }

    for resident in record["localizedResidents"]:
        path = output / "localized-lumps" / resident["filename"]
        raw = path.read_bytes()
        assert hashlib.sha256(raw).hexdigest() == resident["sha256"]
        assert resident["codeAndDataUnchanged"] is True
        assert resident["destinationCListVerified"] is True
    wukong = next(r for r in record["localizedResidents"]
                  if r["name"] == "WukongCallHome")
    assert wukong["clist"][1]["sourceSlot"] == 2
    assert wukong["clist"][1]["destinationSlot"] == 4
    assert wukong["clist"][1]["destinationGT"] == "32070004"

    capability_test = next(r for r in record["localizedResidents"]
                           if r["name"] == "CapabilityTest")
    moved = {item["row"]: item for item in capability_test["clist"]}
    assert moved[1]["destinationSlot"] == 4
    assert moved[2]["destinationSlot"] == 2
    assert moved[2]["destinationGT"] == "4a000002"


def test_migration_rejects_stale_source_capability_and_does_not_publish(tmp_path):
    root, review_dir, _review, before = _make_review(tmp_path, stale_gt=True)
    output = root / "migration"
    with pytest.raises(ValueError, match="stale source sequence"):
        prepare_migration(review_dir, output, staging_root=root)
    assert not output.exists()
    assert before == {
        str(path): path.read_bytes()
        for path in (tmp_path / "boot-config.json", *(tmp_path / "live").iterdir())
    }


def test_migration_rejects_unresolved_nonself_binding(tmp_path):
    root, review_dir, _review, before = _make_review(tmp_path, unresolved_gt=True)
    output = root / "migration"
    with pytest.raises(ValueError, match="unresolved symbolic binding"):
        prepare_migration(review_dir, output, staging_root=root)
    assert not output.exists()
    assert before == {
        str(path): path.read_bytes()
        for path in (tmp_path / "boot-config.json", *(tmp_path / "live").iterdir())
    }


def test_migration_rejects_tampered_review_and_existing_output(tmp_path):
    root, review_dir, _review, _before = _make_review(tmp_path)
    review_path = review_dir / "candidate.json"
    data = json.loads(review_path.read_text())
    data["proposal"]["descriptors"][0]["slot"] = 3
    review_path.write_text(json.dumps(data))
    with pytest.raises(ValueError, match="intact"):
        prepare_migration(review_dir, root / "migration", staging_root=root)

    # A valid review cannot replace an earlier frozen migration package.
    root, review_dir, _review, _before = _make_review(tmp_path / "second")
    output = root / "migration"
    output.mkdir(parents=True)
    with pytest.raises(ValueError, match="existing"):
        prepare_migration(review_dir, output, staging_root=root)
