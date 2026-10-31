"""Phase 1 naming/filtering tests. No serial or HTTP commands."""
import hashlib
import json
import struct
from pathlib import Path

import pytest
from hardware.wukong_bridge import (
    Phase1FlowTrace, PHASE1_MAP, PHASE1_IMAGE_SHA256,
)


def event(ev, nia, gt=0, **kw):
    return dict(ev_type=ev, nia=nia, payload_gt=gt, fault_valid=False,
                bp_hit=False, **kw)


def group(flow, events):
    result = []
    for packet in events:
        assert flow.annotate(packet)
        result.append(packet["gt_label"])
    return result


def test_change_call_return_and_multiple_threads():
    f = Phase1FlowTrace()
    labels = group(f, [event(3, 4), event(4, 4, 0x02000002),
                       event(5, 4, 0x32000002)])
    assert "CHANGE Boot.NS / unresolved / Boot ROM -> Boot.NS / Boot.Thread" in labels[-1]
    labels = group(f, [event(6, 8, 0x4a000015), event(7, 8, 0x42000015), event(8, 8)])
    assert labels[-1] == (
        "@phase1 event CALL Boot.NS / Boot.Thread / Boot ROM -> "
        "Boot.NS / Boot.Thread / ide.AmoebaStartup")
    assert all(label.startswith("@phase1 part ") for label in labels[:-1])
    group(f, [event(3, 0x4210), event(4, 0x4210, 0x0200000c),
              event(5, 0x4210, 0x3200000c)])
    labels = group(f, [event(6, 0x400c, 0x4a000011),
                       event(7, 0x400c, 0x42000011), event(8, 0x400c)])
    assert "Boot.NS / Thread.3 / ide.MalloryDriver -> Boot.NS / Thread.3 / ide.Mallory" in labels[-1]
    labels = group(f, [event(9, 0x3a10), event(10, 0x3a10, 0x4a000011),
                       event(11, 0x3a10, 0x52000013)])
    assert "RETURN Boot.NS / Thread.3 / ide.Mallory -> Boot.NS / Thread.3 / ide.MalloryDriver" in labels[-1]


def test_filter_and_step_fault_breakpoint_evidence():
    f = Phase1FlowTrace()
    assert not f.annotate(event(0, 0x4610))
    assert not f.annotate(event(1, 0x4610))
    f.step()
    p = event(0, 0x4610)
    assert f.annotate(p)
    assert "STEP" in p["gt_label"]
    assert not f.annotate(event(0, 0x4614))
    snapshot = {"reason": 0, "crc_valid": True, "cr": [[0, 0, 0] for _ in range(16)]}
    snapshot["cr"][12][0] = 0x0200000b
    f.snapshot(snapshot)
    assert f.thread == "Thread.2"
    assert not f.step_pending
    p = event(1, 0x3a08)
    p["fault_valid"] = True
    assert f.annotate(p) and "FAULT Boot.NS / Thread.2 / ide.Mallory" in p["gt_label"]
    p = event(0, 0x4614)
    p["bp_hit"] = True
    assert f.annotate(p)
    f.reset()
    assert f.thread is None and f.group is None


def test_missing_or_disagreeing_packets_never_invent_names():
    f = Phase1FlowTrace()
    p = event(8, 8)
    assert f.annotate(p) and "INCOMPLETE" in p["gt_label"]
    labels = group(f, [event(6, 8, 0x4a000015), event(7, 8, 0x42000011), event(8, 8)])
    assert labels[-1].endswith("Boot.NS / unresolved / unresolved")
    assert f.name(0x4a000063) == "unresolved"
    assert f.name(0x4a000015, threads=True) == "unresolved"
    assert f.object_at(0x100000) == "unresolved"


def test_golden_map_against_exact_preserved_image():
    path = Path("generated-artifacts/amoeba-retry-vendor-build/candidate-le.bin")
    if not path.exists():
        pytest.skip("preserved golden build is not distributed in source-only checkouts")
    data = path.read_bytes()
    assert hashlib.sha256(data).hexdigest() == PHASE1_IMAGE_SHA256
    for slot, (name, base, limit) in PHASE1_MAP.items():
        word_location, actual_limit = struct.unpack_from("<II", data, slot * 16)
        assert (word_location * 4, actual_limit) == (base, limit)
        if slot in (1, 2, 11, 12):
            continue
        # Names must be embedded in the exact image, not borrowed from catalog.
        found = False
        for offset in range(base + 4, base + 4 * (limit + 1), 4):
            frame = struct.unpack_from("<I", data, offset)[0]
            if frame >> 24 != 0xab:
                continue
            length = frame & 0xffffff
            if length > (base + 4 * (limit + 1) - offset - 4):
                continue
            raw = data[offset + 4:offset + 4 + (length + 3) // 4 * 4]
            raw = b"".join(raw[i:i+4][::-1] for i in range(0, len(raw), 4))[:length]
            try:
                api = json.loads(raw)
            except (ValueError, UnicodeDecodeError):
                continue
            if api.get("name") == name:
                found = True
                break
        assert found, name
