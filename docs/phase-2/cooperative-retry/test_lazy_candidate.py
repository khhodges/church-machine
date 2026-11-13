import copy
import importlib.util
import json
from pathlib import Path
import struct

import pytest

SPEC = importlib.util.spec_from_file_location("prepare_lazy_candidate",
    Path(__file__).with_name("prepare_lazy_candidate.py"))
prep = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(prep)
SOURCE = prep.ROOT / "generated-artifacts/boot2-offline-check/candidate"


def inputs():
    meta = json.loads((SOURCE / "prepared.json").read_text())
    return ((SOURCE / "boot2.bin").read_bytes(), meta,
            {r["filename"]: (SOURCE / "private-lumps" / r["filename"]).read_bytes()
             for r in meta["layout_rows"] if r.get("policy") == "Lazy"})


def test_exact_reservations_preserve_resident_image():
    raw, meta, artifacts = inputs()
    candidate, records = prep.build(raw, meta, artifacts)
    assert len(records) == 11
    for region in meta["memory_map"]["regions"]:
        if region.get("resident") and region["kind"] != "namespace":
            a, n = region["byteAddress"], region["byteLength"]
            assert candidate[a:a+n] == raw[a:a+n]
    words = struct.unpack("<16384I", candidate)
    previous_end = 1280
    for r in records:
        base, size = r["locationWords"], r["allocationWords"]
        assert base >= previous_end
        previous_end = base + size
        assert words[r["slot"]*4:r["slot"]*4+4] == tuple(r["descriptor"])
        assert r["descriptor"][2] == prep.integrity32(base, r["descriptor"][1])
        assert (words[base] >> 10) & 8191 == 0
        assert 1 << (((words[base] >> 23) & 15) + 6) == size
        assert not any(words[base+1:base+size])
    assert words[2] == struct.unpack_from("<I", raw, 8)[0] + len(records)


@pytest.mark.parametrize("failure", ["hash", "capacity", "occupied", "descriptor", "duplicate"])
def test_unsafe_preparation_is_rejected(failure):
    raw, meta, artifacts = inputs()
    lazy = next(r for r in meta["layout_rows"] if r.get("policy") == "Lazy")
    if failure == "hash":
        artifacts[lazy["filename"]] = bytes(len(artifacts[lazy["filename"]]))
    elif failure == "capacity":
        meta["memory_map"]["regions"].append(dict(resident=True, byteAddress=65532, byteLength=4))
    elif failure == "duplicate":
        meta["layout_rows"].append(copy.deepcopy(lazy))
    else:
        modified = bytearray(raw)
        struct.pack_into("<I", modified, 5120 if failure == "occupied" else lazy["slot"]*16, 1)
        raw = bytes(modified)
    with pytest.raises(ValueError):
        prep.build(raw, meta, artifacts)
