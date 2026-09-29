"""Synthetic IDX1 framing/structure vectors; no execution or trusted admission."""

import copy
import hashlib
import json
import struct

import pytest

from server.idx1_profile import (
    FEATURES, IDX1Error, IDX1TargetError, MAGIC, frame_envelope,
    parse_envelope,
)


def fixture(words=None, extents=None, starts=None, dispatch=None, fast=2):
    # word 1 = branch table, word 2 = fast return, words 3/4 = packet,
    # word 5 = raw offset table, word 6 = private table, word 7 = return.
    words = words or [0xBF000001, 0x1F000000, 0x52B00002, 0x070B0000,
                      7, 0, 0x1F000000]
    extents = extents or [
        {"startWord": 1, "endWord": 5, "kind": "code"},
        {"startWord": 5, "endWord": 7, "kind": "data"},
        {"startWord": 7, "endWord": len(words) + 1, "kind": "code"},
    ]
    starts = starts if starts is not None else [1, 2, 3, 7]
    dispatch = dispatch if dispatch is not None else [
        {"selector": 1, "word": 1, "kind": "branch"},
        {"selector": 5, "word": 5, "kind": "offset"},
        {"selector": 6, "word": 6, "kind": "private"},
    ]
    allocation = 64
    header = (31 << 27) | ((len(words) & 0x1FFF) << 10)
    payload = struct.pack(">I", header) + struct.pack(f">{len(words)}I", *words)
    payload += b"\0" * (allocation * 4 - len(payload))
    meta = {
        "schema": "cm.idx1.execution/1", "isaProfile": "IDX1",
        "requiredFeatures": list(FEATURES),
        "payloadSha256": hashlib.sha256(payload).hexdigest(),
        "layout": {"codeWords": len(words), "extents": extents,
                   "instructionStarts": starts, "dispatch": dispatch,
                   "fastEntry": fast},
    }
    return payload, meta


def wire(payload, metadata_bytes):
    return (MAGIC + struct.pack(">IIII", 1, len(metadata_bytes), len(payload), 0)
            + metadata_bytes + b"\0" * (-len(metadata_bytes) % 4) + payload)


def recode(payload, meta):
    return wire(payload, json.dumps(meta, separators=(",", ":")).encode())


def reject(payload, meta, text=None):
    with pytest.raises(IDX1Error, match=text):
        parse_envelope(recode(payload, meta))


@pytest.mark.parametrize("typ", [1, 2, 3])
def test_inner_non_abstraction_type_rejected(typ):
    payload, meta = fixture()
    header = int.from_bytes(payload[:4], "big") | (typ << 8)
    payload = header.to_bytes(4, "big") + payload[4:]
    meta["payloadSha256"] = hashlib.sha256(payload).hexdigest()
    reject(payload, meta, "typ=0")


def test_roundtrip_identity_coordinates_and_typed_dispatch():
    payload, meta = fixture()
    raw = frame_envelope(payload, meta)
    result = parse_envelope(raw)
    assert result.payload == payload
    assert result.instruction_starts == (1, 2, 3, 7)
    assert result.extents == ((1, 5, "code"), (5, 7, "data"), (7, 8, "code"))
    assert result.fast_entry == result.resolve_selector(0) == 2
    assert result.resolve_selector(1) == 2
    assert result.resolve_selector(5) == 7
    assert result.warnings == ()
    assert result.execution_digest == hashlib.sha256(raw).hexdigest()
    for selector in (6, 2, 0xFFFFFFFF):
        with pytest.raises(IDX1TargetError):
            result.resolve_selector(selector)
    for interior in (0, 4, 5, 6, 8, 64):
        with pytest.raises(IDX1TargetError):
            result.require_start(interior)
    # Different JSON bytes, identical meaning/payload, different execution identity.
    alternative = wire(payload, json.dumps(meta).encode())
    assert parse_envelope(alternative).execution_digest != result.execution_digest


def test_all_envelope_bytes_bound_and_exact_framing():
    payload, meta = fixture()
    raw = frame_envelope(payload, meta)
    length = struct.unpack_from(">I", raw, 12)[0]
    pad_at = 24 + length
    assert pad_at % 4  # this fixture exercises padding
    for index in (0, 8, 12, 16, 20, 24, pad_at, len(raw) - 1):
        changed = bytearray(raw)
        changed[index] ^= 1
        with pytest.raises(IDX1Error):
            parse_envelope(bytes(changed))
    for variant in (raw[:-1], raw + b"\0", payload,
                    raw[:24], raw[:pad_at], raw[:pad_at + 1]):
        with pytest.raises(IDX1Error):
            parse_envelope(variant)
    for index, value in ((8, 2), (12, 0), (12, 1048577), (20, 1)):
        altered = bytearray(raw)
        struct.pack_into(">I", altered, index, value)
        with pytest.raises(IDX1Error):
            parse_envelope(bytes(altered))
    with pytest.raises(IDX1Error, match="payloadSha256"):
        parse_envelope(recode(payload[:-1] + b"\1", meta))


@pytest.mark.parametrize("raw", [
    b'{"schema":1,"schema":2}', b'\xef\xbb\xbf{}', b'{"x":-0}',
    b'{"x":1.0}', b'{"x":1e2}', b'{"x":NaN}', b'\xff',
    b'{"x":"\\ud800"}',
])
def test_invalid_json_fail_closed(raw):
    payload, _ = fixture()
    with pytest.raises(IDX1Error):
        parse_envelope(wire(payload, raw))


@pytest.mark.parametrize("change", [
    lambda m: m.update(isaProfile="LEGACY"),
    lambda m: m.update(schema="cm.idx1.execution/2"),
    lambda m: m.update(requiredFeatures=list(FEATURES) + ["unknown"]),
    lambda m: m.update(requiredFeatures=list(reversed(FEATURES))),
    lambda m: m.update(requiredFeatures=[FEATURES[0]] * 3),
    lambda m: m.update(requiredFeatures=None),
    lambda m: m.update(extra=1),
    lambda m: m["layout"].update(extra=1),
    lambda m: m["layout"].update(codeWords=True),
    lambda m: m["layout"].update(codeWords=8),
    lambda m: m["layout"].update(fastEntry=4),
    lambda m: m["layout"].update(fastEntry=5),
    lambda m: m["layout"].update(instructionStarts=[1, 2, 3, 4, 7]),
    lambda m: m["layout"].update(instructionStarts=[1, 2, 3]),
    lambda m: m["layout"]["extents"][0].update(endWord=6),
    lambda m: m["layout"]["extents"][0].update(startWord=0),
    lambda m: m["layout"]["extents"][0].update(kind="unknown"),
    lambda m: m["layout"]["extents"][1].update(startWord=6),
    lambda m: m["layout"]["dispatch"][0].update(kind="offset"),
    lambda m: m["layout"]["dispatch"][1].update(kind="branch"),
    lambda m: m["layout"]["dispatch"][0].update(selector=0),
    lambda m: m["layout"]["dispatch"][1].update(selector=1),
    lambda m: m["layout"]["dispatch"][1].update(word=4),
    lambda m: m["layout"]["dispatch"][2].update(kind="unknown"),
])
def test_metadata_rejects_unknown_features_bad_extents_interiors_and_dispatch(change):
    payload, original = fixture()
    meta = copy.deepcopy(original)
    change(meta)
    reject(payload, meta)


@pytest.mark.parametrize("word,starts", [
    (0x50000000, [1, 2, 3, 7]),  # zero role
    (0x54B00002, [1, 2, 3, 7]),  # unsupported role1 LOAD
    (0x53B00000, [1, 2, 3, 7]),  # subtract zero
])
def test_bad_packet_header(word, starts):
    payload, meta = fixture(words=[0xBF000001, 0x1F000000, word,
                                   0x070B0000, 7, 0, 0x1F000000], starts=starts)
    reject(payload, meta)


@pytest.mark.parametrize("w1", [
    0x070B0001, 0x57000000, 0x47000000, 0xF7000000,
    0x170B0000, 0x27010000, 0x87090000, 0x97090000,
])
def test_invalid_wrapped_modes_and_replacement(w1):
    payload, meta = fixture(words=[0xBF000001, 0x1F000000, 0x52300002,
                                   w1, 7, 0, 0x1F000000])
    reject(payload, meta)


def test_three_word_call_w2_and_truncation():
    words = [0xBF000001, 0x1F000000, 0x56200004, 0x17030000,
             0x01400001, 7, 0, 0x1F000000]
    extents = [
        {"startWord": 1, "endWord": 6, "kind": "code"},
        {"startWord": 6, "endWord": 8, "kind": "data"},
        {"startWord": 8, "endWord": 9, "kind": "code"},
    ]
    payload, meta = fixture(words, extents, [1, 2, 3, 8], [
        {"selector": 1, "word": 1, "kind": "branch"},
        {"selector": 6, "word": 6, "kind": "offset"},
        {"selector": 7, "word": 7, "kind": "private"},
    ])
    assert parse_envelope(frame_envelope(payload, meta)).instruction_starts == (1, 2, 3, 8)
    changed = words.copy()
    changed[4] |= 0x02000000
    bad, bad_meta = fixture(changed, extents, [1, 2, 3, 8],
                            meta["layout"]["dispatch"])
    reject(bad, bad_meta)
    extents[0]["endWord"] = 5
    extents[1]["startWord"] = 5
    reject(payload, meta, "crosses code extent")


def test_structurally_valid_fault_targets_are_saveable_and_warn():
    payload, meta = fixture(words=[0xBF000001, 0x1F000000, 0x53000001,
                                   0xB8800000, 4, 0, 0x1F000000])
    # Literal branch packet targets word 2; raw offset targets interior word 4.
    result = parse_envelope(frame_envelope(payload, meta))
    assert len(result.warnings) == 1
    with pytest.raises(IDX1TargetError):
        result.resolve_selector(5)
    payload, meta = fixture(words=[0xBF000001, 0x1F000000, 0x53000001,
                                   0xB8800000, 99, 0, 0x1F000000])
    assert "target 99" in parse_envelope(frame_envelope(payload, meta)).warnings[0]
    words = [0xBF000001, 0x1F000000, 0x53000000, 0xB8800000,
             7, 0, 0x1F000000]  # DR0 - 0 is noncanonical
    payload, meta = fixture(words)
    reject(payload, meta)
    words[2] = 0x53000001  # DR0 - 1 targets word 2, legal
    words[4] = 4  # offset dispatch targets W1 interior
    payload, meta = fixture(words)
    result = parse_envelope(frame_envelope(payload, meta))
    assert any("selector 5" in warning for warning in result.warnings)


def test_inner_lump_geometry_and_retired_or_data_opcodes_in_code():
    payload, meta = fixture()
    for header in (0, (31 << 27) | (1 << 23) | (7 << 10),
                   (31 << 27) | (63 << 10) | 1):
        bad = struct.pack(">I", header) + payload[4:]
        reject(bad, dict(meta, payloadSha256=hashlib.sha256(bad).hexdigest()))
    for opcode in (8, 9, 11, 26, 30, 31):
        words = [0xBF000001, 0x1F000000, opcode << 27,
                 0x070B0000, 7, 0, 0x1F000000]
        bad, bad_meta = fixture(words)
        reject(bad, bad_meta, "unsupported executable opcode")


@pytest.mark.parametrize("w0,w1", [
    (0x54900000, 0x17180000),  # direct CALL role1
    (0x55400001, 0x17030007),  # indexed CALL role1 only
    (0x52200004, 0x17030060),  # indexed CALL role0 only
    (0x52200000, 0x87094000),  # DREAD immediate-shaped mode
    (0x52300002, 0x97090008),  # BFEXT legal width
    (0x53000002, 0xB8800000),  # branch backward from W0
])
def test_allowed_packet_forms(w0, w1):
    payload, meta = fixture(words=[0xBF000001, 0x1F000000, w0, w1,
                                   7, 0, 0x1F000000])
    assert parse_envelope(frame_envelope(payload, meta)).instruction_starts == (1, 2, 3, 7)


def test_packet_cannot_enter_data_or_look_like_multiple_starts():
    words = [0xBF000001, 0x1F000000, 0x52B00002, 0x070B0000,
             7, 0, 0x1F000000]
    payload, meta = fixture(words)
    meta["layout"]["extents"][0]["endWord"] = 4
    meta["layout"]["extents"][1]["startWord"] = 4
    reject(payload, meta, "crosses code extent")
    payload, meta = fixture(words, starts=[1, 2, 3, 4, 7])
    reject(payload, meta, "instructionStarts")


def test_self_rehashed_tamper_is_not_a_provenance_check():
    payload, meta = fixture()
    original = parse_envelope(frame_envelope(payload, meta))
    changed = bytearray(payload)
    changed[4 * 7 + 3] ^= 1  # alter last one-word instruction, still structurally legal
    meta["payloadSha256"] = hashlib.sha256(changed).hexdigest()
    altered = parse_envelope(frame_envelope(bytes(changed), meta))
    assert altered.execution_digest != original.execution_digest