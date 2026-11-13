import importlib.util
import json
from pathlib import Path
import struct
import pytest

SPEC = importlib.util.spec_from_file_location("prepare_startup_candidate",
    Path(__file__).with_name("prepare_startup_candidate.py"))
prep = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(prep)
ABSENT = prep.ROOT / "generated-artifacts/boot2-lazy-candidate"
SOURCE = prep.ROOT / "generated-artifacts/boot2-offline-check/candidate/private-lumps"


def inputs():
    raw = (ABSENT / "boot2.bin").read_bytes()
    records = json.loads((ABSENT / "preparation.json").read_text())["records"]
    # Placement unit tests only; actual authenticated linking is exercised by
    # the preparation command, not mocked as admitted by these raw bodies.
    bodies = {slot: prep.api_only(next(SOURCE.glob(f"{name}.1.*.lump")).read_bytes())
              for slot, name in prep.STARTUP.items()}
    return raw, records, bodies


def test_only_selected_body_ranges_change():
    raw, records, bodies = inputs()
    result, updated = prep.install(raw, records, bodies)
    assert result[:5120] == raw[:5120]
    for r in updated:
        a, n = r["locationWords"]*4, r["allocationWords"]*4
        if r["slot"] in prep.STARTUP:
            words = struct.unpack(f">{n//4}I", bodies[r["slot"]])
            assert result[a:a+n] == struct.pack(f"<{len(words)}I", *words)
            assert r["contentInstalled"]
        else:
            assert result[a:a+n] == raw[a:a+n] and not r["contentInstalled"]


@pytest.mark.parametrize("failure", ["missing", "size", "occupied", "descriptor", "overlap"])
def test_bad_installation_is_rejected(failure):
    raw, records, bodies = inputs()
    r = next(r for r in records if r["slot"] == 6)
    if failure == "missing":
        del bodies[6]
    elif failure == "size":
        bodies[6] += bytes(4)
    elif failure == "overlap":
        next(r for r in records if r["slot"] == 7)["locationWords"] = r["locationWords"]
    else:
        b = bytearray(raw)
        struct.pack_into("<I", b, r["locationWords"]*4+4 if failure == "occupied" else 6*16, 1)
        raw = bytes(b)
    with pytest.raises(ValueError):
        prep.install(raw, records, bodies)
