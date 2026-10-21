"""Generated GT conformance; no catalog, saved artifacts, hardware, or app startup.

The JSON contract is the packing oracle. Both languages are checked against it,
so equal-but-wrong implementations cannot pass merely by agreeing with each other.
Generic decoders intentionally expose the ordinary/raw overlay even for Abstract
words; semantic Abstract fields are checked separately with parseAbstractGT.
"""
import ast
import itertools
import json
from pathlib import Path
import subprocess
import sys

import pytest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))

from server import boot_image as boot
from server.namespace_ascending_image import _decode_gt

ISA = json.loads((ROOT / "shared/architecture_contracts.json").read_text())["isa"]
ORDINARY = ISA["gtWord0"]
ABSTRACT = ISA["abstractGtWord0"]
TYPES = ORDINARY["types"]
ORDER = ISA["permissions"]["logicalOrder"]
UINT = (1 << ORDINARY["widthBits"]) - 1


def maximum(layout, name):
    lo, hi = layout["fields"][name]
    return (1 << (hi - lo + 1)) - 1


def pack(layout, **fields):
    return sum((value & maximum(layout, name)) << layout["fields"][name][0]
               for name, value in fields.items()) & UINT


def unpack(layout, word):
    return {name: (word >> bits[0]) & maximum(layout, name)
            for name, bits in layout["fields"].items()}


def edges(layout, name):
    top = maximum(layout, name)
    return sorted({0, 1, top // 2, top // 2 + 1, top - 1, top})


@pytest.fixture(scope="module")
def inspection_decoder():
    # This pure function lives in the Flask entrypoint. Compile its actual AST
    # rather than importing app.py (which starts services and touches persistence).
    tree = ast.parse((ROOT / "server/app.py").read_text())
    function = next(n for n in tree.body
                    if isinstance(n, ast.FunctionDef) and n.name == "_decode_gt_word")
    scope = {}
    exec(compile(ast.Module(body=[function], type_ignores=[]),
                 str(ROOT / "server/app.py"), "exec"), scope)
    return scope[function.name]


def permissions(raw):
    result = dict.fromkeys(ORDER, 0)
    domain = next(d for d in ISA["permissions"]["domains"].values()
                  if d["dom"] == raw["dom"])
    for bit, name in enumerate(domain["payloadLowToHigh"]):
        result[name] = (raw["perm"] >> bit) & 1
    return {"B": raw["b_flag"], **result}


def ordinary_vector(word, inspection_decoder):
    raw = unpack(ORDINARY, word)
    perms = permissions(raw)
    church = "".join(p for p in ("L", "S", "E") if perms[p])
    malformed = raw["gt_type"] != TYPES["ABSTRACT"] and len(church) > 1
    type_name = next(k for k, v in TYPES.items() if v == raw["gt_type"])
    type_name = type_name if type_name == "NULL" else type_name.title()
    parsed = dict(gt_seq=raw["gt_seq"], index=raw["slot_id"],
                  permissions=perms, type=raw["gt_type"], typeName=type_name,
                  malformed=malformed,
                  malformedReason=f"multi-Church permissions ({church})" if malformed else None)
    # Inspection's null flag means zero word, not the simulator's type-field
    # NULL predicate. It is presentation-only and does not validate permissions.
    unsigned = word & UINT
    expected = dict(null=unsigned == 0, gt_word=f"0x{unsigned:08X}",
                    ns_index=raw["slot_id"], gt_seq=raw["gt_seq"],
                    gt_type=type_name,
                    perms=("".join(p for p in ["B", *ORDER] if perms[p]) or "---")
                    if unsigned else "")
    assert inspection_decoder(word) == expected, f"inspection word={word:#x}"
    assert _decode_gt(word) == dict(
        slot=raw["slot_id"], sequence=raw["gt_seq"], type=raw["gt_type"],
        domain=raw["dom"], permissions=raw["perm"]), f"candidate word={word:#x}"
    return dict(word=word, parsed=parsed)


def run_simulator(vectors):
    result = subprocess.run(
        ["node", "tests/gt/contract_differential.js"], cwd=ROOT,
        input=json.dumps(vectors), capture_output=True, text=True, timeout=60)
    assert result.returncode == 0, result.stderr
    assert json.loads(result.stdout) == {"checked": len(vectors)}


def test_every_ordinary_generation_type_domain_payload_and_bind(inspection_decoder):
    vectors = []
    slots = edges(ORDINARY, "slot_id")
    # Exhaustive 9-bit generations, all ordinary types, both domains, all eight
    # permission payloads (including malformed Church combinations), and B.
    for seq, typ, dom, perm, bind in itertools.product(
            range(maximum(ORDINARY, "gt_seq") + 1),
            [v for v in TYPES.values() if v != TYPES["ABSTRACT"]],
            range(2), range(maximum(ORDINARY, "perm") + 1), range(2)):
        slot = slots[(seq + typ + dom + perm + bind) % len(slots)]
        word = pack(ORDINARY, gt_seq=seq, gt_type=typ, dom=dom,
                    perm=perm, b_flag=bind, slot_id=slot)
        vector = ordinary_vector(word, inspection_decoder)
        perms = vector["parsed"]["permissions"]
        # Boot's encoder deliberately emits B=0; it is not a validation gate.
        # Its raw multi-Church words must still decode as malformed in the sim.
        encoded = boot.create_gt(seq, slot, perms, typ)
        canonical = pack(ORDINARY, gt_seq=seq, gt_type=typ,
                         dom=dom if perm else 0, perm=perm, slot_id=slot)
        assert encoded == canonical, (seq, slot, perms, typ)
        vector.update(method="createGT", args=[seq, slot, perms, typ])
        if vector["parsed"]["malformed"]:
            vector["error"] = "single-Church-perm"
        else:
            vector["expected"] = canonical | pack(ORDINARY, b_flag=bind)
        vectors.append(vector)
    assert len(vectors) == 49152
    run_simulator(vectors)


def test_all_abstract_subtypes_generations_and_rw(inspection_decoder):
    vectors = []
    data_edges = edges(ABSTRACT, "ab_data")
    for subtype, seq, read, write in itertools.product(
            range(maximum(ABSTRACT, "ab_type") + 1),
            range(maximum(ABSTRACT, "gt_seq") + 1), range(2), range(2)):
        data = data_edges[(subtype + seq + read + write) % len(data_edges)]
        word = pack(ABSTRACT, ab_type=subtype, gt_seq=seq, read=read,
                    write=write, gt_type=TYPES["ABSTRACT"], ab_data=data)
        assert boot.create_abstract_gt(subtype, {"R": read, "W": write}, seq, data) == word
        vector = ordinary_vector(word, inspection_decoder)
        vector.update(
            abstractParsed=dict(ab_type=subtype, R=read, W=write,
                                type=TYPES["ABSTRACT"], gt_seq=seq, ab_data=data,
                                device_class=data >> 8, device_data=data & 255),
            method="createAbstractGT", args=[subtype, {"R": read, "W": write}, seq, data],
            expected=word)
        vectors.append(vector)
    assert len(vectors) == 16384
    run_simulator(vectors)


def test_unsigned_boundaries_and_field_truncation(inspection_decoder):
    # Walking bits exercise every field independently, plus 0, sign transition,
    # all-ones, signed JS representations and values wrapping modulo 2**32.
    words = {0, UINT, UINT >> 1, (UINT >> 1) + 1}
    words.update(1 << bit for bit in range(ORDINARY["widthBits"]))
    words.update(UINT ^ (1 << bit) for bit in range(ORDINARY["widthBits"]))
    vectors = []
    for word in sorted(words):
        for alias in (word, word - (UINT + 1), word + UINT + 1):
            vector = ordinary_vector(alias, inspection_decoder)
            raw = unpack(ABSTRACT, alias)
            vector["abstractParsed"] = dict(
                ab_type=raw["ab_type"], R=raw["read"], W=raw["write"],
                type=raw["gt_type"], gt_seq=raw["gt_seq"], ab_data=raw["ab_data"],
                device_class=raw["ab_data"] >> 8, device_data=raw["ab_data"] & 255)
            vectors.append(vector)
    for seq, slot in itertools.product(
            [-1, *edges(ORDINARY, "gt_seq"), maximum(ORDINARY, "gt_seq") + 1, UINT],
            [-1, *edges(ORDINARY, "slot_id"), maximum(ORDINARY, "slot_id") + 1, UINT]):
        for typ in TYPES.values():
            expected = pack(ORDINARY, gt_seq=seq, slot_id=slot, gt_type=typ, dom=1, perm=4)
            assert boot.create_gt(seq, slot, {"E": 1}, typ) == expected
            vectors.append(dict(method="createGT", args=[seq, slot, {"E": 1}, typ],
                                expected=expected))
    for subtype, seq, data in itertools.product(
            [-1, maximum(ABSTRACT, "ab_type") + 1],
            [-1, maximum(ABSTRACT, "gt_seq") + 1],
            [-1, maximum(ABSTRACT, "ab_data") + 1]):
        expected = pack(ABSTRACT, ab_type=subtype, gt_seq=seq, ab_data=data,
                        gt_type=TYPES["ABSTRACT"], read=1, write=1)
        assert boot.create_abstract_gt(subtype, {"R": 1, "W": 1}, seq, data) == expected
        vectors.append(dict(method="createAbstractGT",
                            args=[subtype, {"R": 1, "W": 1}, seq, data], expected=expected))
    run_simulator(vectors)


def test_malformed_permission_inputs():
    vectors = []
    # All mixed-domain input combinations: no encoded word can represent them.
    for turing, church in itertools.product(range(1, 8), repeat=2):
        perms = {p: (turing >> i) & 1 for i, p in enumerate(ORDER[:3])}
        perms.update({p: (church >> i) & 1 for i, p in enumerate(ORDER[3:])})
        vectors.append(dict(method="createGT", args=[0, 0, perms, TYPES["INFORM"]],
                            error="domain-impure"))
        # The server's low-level encoder documents Church dominance, unlike
        # the simulator's guarded constructor. Do not silently equate the APIs.
        assert boot._encode_perm(perms) == (1, church)
        assert boot.create_gt(0, 0, perms, TYPES["INFORM"]) == pack(
            ORDINARY, gt_type=TYPES["INFORM"], dom=1, perm=church)
    illegal = [p for p in ["B", *ORDER] if p not in ("R", "W")]
    for mask in range(1, 1 << len(illegal)):
        perms = {p: (mask >> i) & 1 for i, p in enumerate(illegal)}
        for subtype in range(maximum(ABSTRACT, "ab_type") + 1):
            with pytest.raises(ValueError, match="not valid perm bits"):
                boot.create_abstract_gt(subtype, perms, 0, 0)
            vectors.append(dict(method="createAbstractGT", args=[subtype, perms, 0, 0],
                                error="not valid perm bits"))
    run_simulator(vectors)
