import copy
import hashlib
import json
import struct

import pytest

from server.namespace_layout_review import plan, prepare


def fixture():
    def lump(gt):
        words = [(31 << 27) | (1 << 10) | 1] + [0] * 62 + [gt]
        return struct.pack(">64I", *words)
    artifacts = {"SelfTest.lump": lump(0x02000006),
                 "WukongCallHome.lump": lump(0x32000002),
                 "CapabilityTest.lump": lump(0x02000001)}
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
    return (dict(abstractions=rows, freeSlotSequences={"4": 7}),
            dict(step1=dict(totalNamespaceWords=8192, nsSlotsMax=64)), artifacts)


def test_plan_is_explicit_preserves_residents_and_does_not_mutate_inputs():
    state, config, artifacts = fixture()
    before = copy.deepcopy((state, config, artifacts))
    p = plan(state, config, artifacts)
    assert (state, config, artifacts) == before
    assert p["metadataWords"][1:] == [0, len(state["abstractions"]) - 1, 0]
    assert p["cr15WordLimit"] == 255
    assert p["entryThread"]["gt"] == "02000002"
    uart = next(row for row in p["descriptors"] if row["name"] == "UART_DEV")
    assert (uart["slot"], uart["sequence"], uart["location"]) == (4, 7, 0x40000014)
    assert len(p["selectedArtifacts"]) == 3
    assert {r["name"] for r in p["affectedBindings"]} == {"WukongCallHome", "CapabilityTest"}
    assert next(r for r in p["descriptors"] if r["slot"] == 2)["location"] == 256
    assert p["blockers"]


@pytest.mark.parametrize("fault", ["hash", "duplicate", "thread-version", "generation"])
def test_invalid_inputs_fail_closed(fault):
    state, config, artifacts = fixture()
    if fault == "hash":
        artifacts["SelfTest.lump"] = b"\0" * 256
    elif fault == "duplicate":
        state["abstractions"].append(copy.deepcopy(state["abstractions"][0]))
    elif fault == "thread-version":
        state["abstractions"][1]["seq"] = 1
    else:
        state["freeSlotSequences"]["4"] = 512
    with pytest.raises(ValueError):
        plan(state, config, artifacts)


def test_frozen_review_cannot_publish_overwrite_or_write_outside_staging(tmp_path):
    state, config, artifacts = fixture()
    live = tmp_path / "live"
    live.mkdir()
    (live / "ns-state.json").write_text(json.dumps(state))
    cfg = tmp_path / "config.json"
    cfg.write_text(json.dumps(config))
    for name, raw in artifacts.items():
        (live / name).write_bytes(raw)
    before = {p: p.read_bytes() for p in (*live.iterdir(), cfg)}
    root = tmp_path / "generated-artifacts"
    out = root / "candidate"
    record = prepare(live, cfg, out, staging_root=root)
    assert record["approvalEligible"] is False
    assert record["activationAllowed"] is False
    assert not (out / "candidate.bin").exists()
    assert (out / "inputs/lumps/SelfTest.lump").read_bytes() == artifacts["SelfTest.lump"]
    assert {p: p.read_bytes() for p in before} == before
    with pytest.raises(ValueError, match="existing"):
        prepare(live, cfg, out, staging_root=root)
    with pytest.raises(ValueError, match="generated-artifacts"):
        prepare(live, cfg, live / "oops", staging_root=root)
