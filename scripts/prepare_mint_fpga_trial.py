#!/usr/bin/env python3
"""Fresh, inert Mint binding fixture; no live catalog, approval or installation IO."""
import hashlib
import json
from pathlib import Path
import struct
import subprocess
import sys
import tempfile

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from server.boot_image import create_gt, pack_lump_header
from shared.namespace_header import pack_namespace_word0
from hardware.integrity32 import integrity32

FORMAT = "mint-private-fpga-create-trial-v1"
WORDS, SLOTS = 16384, 256
# Physical byte addresses, not legacy simulator word locations.
LAYOUT = {
    "ide.Mint": (9, 4096, 1024),
    "ide.PkVerify": (15, 8192, 64),
    "ide.MintState": (18, 12288, 1024),
    "ide.MintPool": (19, 32768, 2048),
    "ide.MintNamespace": (20, 0, SLOTS * 4),
}
QUEUE = list(range(32, 64))
HISTORY = 64
# Explicit preparation cut. Updating these pins is a new review decision,
# never an automatic consequence of compiling whatever source happens to exist.
PINS = {
    "mint": (
        "cacadb5f489ccd7b8bd25769587703b75ab5896541978019e7603bc86b056623",
        "16ac5bd768a4c4d24e34210cea109aa1e2138c4324ea9d549d4227cf84f6a074",
    ),
    "pkverify": (
        "5a1735f21218182e434d69e095e26c384488e578ac1fa4ccdd641989672c3f13",
        "47a6b9dbac0f36e2dadbd2dc9726b4b3d12f630642f80df7543d2e7fc45ebef5",
    ),
}


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def native_code():
    return json.loads(subprocess.check_output(
        ["node", str(ROOT / "scripts/mint_trial_code.js")], cwd=ROOT, timeout=30))


def gt(name, rights):
    return create_gt(0, LAYOUT[name][0], dict.fromkeys(rights, 1), 1)


def encoded(words):
    return struct.pack(f">{len(words)}I", *words)


def construct(code):
    """Construct a fresh synthetic design, never infer history from empty words."""
    if set(code) != set(PINS):
        raise ValueError("Unexpected executable inventory")
    for name, (source_pin, code_pin) in PINS.items():
        if (sha(code[name]["source"].encode()) != source_pin
                or sha(encoded(code[name]["code"])) != code_pin):
            raise ValueError(f"{name} source/code identity changed; explicit review required")
    memory = [0] * WORDS
    bindings = [
        gt("ide.Mint", "E"), gt("ide.MintState", "RW"),
        gt("ide.MintState", "L"), gt("ide.MintPool", "RW"),
        gt("ide.PkVerify", "E"), gt("ide.MintNamespace", "RW"),
    ]
    expected = [
        ("SELF", ["E"]), ("ide.MintState", ["R", "W"]),
        ("ide.MintState", ["L"]), ("ide.MintPool", ["R", "W"]),
        ("ide.PkVerify", ["E"]), ("ide.MintNamespace", ["R", "W"]),
    ]
    actual = [(c["name"], c["rights"]) for c in code["mint"]["capabilities"]]
    if actual != expected:
        raise ValueError("Mint declarations changed; explicit provisioning review required")
    if [(c["name"], c["rights"]) for c in code["pkverify"]["capabilities"]] != [("SELF", ["E"])]:
        raise ValueError("Verifier has unexpected authority")

    for key, name, caps in [
        ("mint", "ide.Mint", bindings),
        ("pkverify", "ide.PkVerify", [gt("ide.PkVerify", "E")]),
    ]:
        _, base, size = LAYOUT[name]
        body = code[key]["code"]
        if len(body) + 1 + len(caps) > size:
            raise ValueError(f"{name} code overlaps C-list")
        at = base // 4
        memory[at] = pack_lump_header(size.bit_length() - 7, len(body), len(caps))
        memory[at + 1:at + 1 + len(body)] = body
        memory[at + size - len(caps):at + size] = caps

    state = LAYOUT["ide.MintState"][1] // 4
    state_size = LAYOUT["ide.MintState"][2]
    memory[state:state + 7] = [
        pack_lump_header(4, 0, 1), 0, LAYOUT["ide.MintPool"][2],
        7, 7 + len(QUEUE), LAYOUT["ide.MintPool"][1], HISTORY,
    ]
    memory[state + 7:state + 7 + len(QUEUE)] = QUEUE
    # Fresh isolated universe: only these explicitly designated slots are
    # never-used. All other slots are unavailable (reserved), including holes.
    history = [1024] * SLOTS
    for slot in QUEUE:
        history[slot] = 512
    memory[state + HISTORY:state + HISTORY + SLOTS] = history
    # Scratch is the sole L row, at the final word. Initially NULL.
    memory[state + state_size - 1] = 0

    def entry(slot, base, size):
        w1 = size - 1
        memory[slot * 4:slot * 4 + 4] = [base, w1, integrity32(base, w1), 0]

    # Slot 1 is the privileged Namespace root, never a public C-list grant.
    entry(1, 0, SLOTS * 4)
    # Reserve isolated Thread homes; no prepared CR0, entry or execution claim.
    entry(2, 24576, 256)
    memory[24576 // 4] = pack_lump_header(2, 32, 12, 2)
    for slot, base, size in LAYOUT.values():
        entry(slot, base, size)
    memory[:4] = [pack_namespace_word0(WORDS, SLOTS), 0, len(LAYOUT) + 2, 0]
    design = {
        "format": FORMAT, "purpose": "isolated-saved-design-candidate",
        "historyOrigin": "fresh-disposable-universe-not-live-or-reboot-state",
        "installationAllowed": False, "activationAllowed": False,
        "hardwareProgrammingAllowed": False, "approvalEligible": False,
        "namespace": {"baseBytes": 0, "slots": SLOTS, "strideBytes": 16},
        "cr15": {"baseBytes": 0, "limitWords": SLOTS * 4 - 1},
        "capacityWords": WORDS,
        "bindings": {name: {"slot": slot, "baseBytes": base, "words": size}
                     for name, (slot, base, size) in LAYOUT.items()},
        "mintClist": bindings, "freeQueue": QUEUE,
        "historyWordOffset": HISTORY, "scratchWordOffset": state_size - 1,
        "publicClists": {}, "threadRangeBytes": [24576, 25600],
        "sourceSha256": {key: sha(value["source"].encode()) for key, value in code.items()},
    }
    return design, memory


def validate(design, memory, code):
    """Fail closed on any unreviewed design/byte change, plus geometry checks."""
    expected_design, expected_memory = construct(code)
    if design != expected_design:
        raise ValueError("Design differs from the exact private provisioning contract")
    if len(memory) != WORDS or any(type(w) is not int or not 0 <= w <= 0xffffffff for w in memory):
        raise ValueError("Invalid image word bounds")
    state = LAYOUT["ide.MintState"][1] // 4
    cursor, end, qstart, qend, pool, hist = memory[state + 1:state + 7]
    scratch = design["scratchWordOffset"]
    if not (0 <= cursor < end <= LAYOUT["ide.MintPool"][2]):
        raise ValueError("Pool interval out of bounds")
    if pool != LAYOUT["ide.MintPool"][1] or pool % 4 or pool + end * 4 > WORDS * 4:
        raise ValueError("Pool physical byte base/bounds mismatch")
    if not (7 <= qstart < qend <= hist and hist + SLOTS <= scratch):
        raise ValueError("Queue/history/scratch overlap")
    queue = memory[state + qstart:state + qend]
    if len(set(queue)) != len(queue):
        raise ValueError("Duplicate free slot")
    for slot in queue:
        if not 2 <= slot < SLOTS or slot in [1, 2, *(v[0] for v in LAYOUT.values())]:
            raise ValueError("Free slot aliases occupied or reserved slot")
        if memory[state + hist + slot] != 512:
            raise ValueError("Free slot lacks explicit fresh history")
        if any(memory[slot * 4:slot * 4 + 4]):
            raise ValueError("Free destination is occupied")
    ranges = [(0, SLOTS * 16), tuple(design["threadRangeBytes"])]
    ranges += [(base, base + size * 4) for name, (_, base, size) in LAYOUT.items()
               if name != "ide.MintNamespace"]
    for i, (start, stop) in enumerate(ranges):
        if start % 4 or not 0 <= start < stop <= WORDS * 4:
            raise ValueError("Physical extent outside memory")
        if any(start < b and a < stop for a, b in ranges[:i]):
            raise ValueError("Private state aliases another extent")
    if memory != expected_memory:
        raise ValueError("Image differs from exact code, bindings, history or private alias inventory")
    return {
        "status": "candidate-bindings-validated",
        "imageSha256": sha(encoded(memory)),
        "designSha256": sha(json.dumps(design, sort_keys=True).encode()),
        "checks": ["exact-native-code", "ascending-table-identity", "physical-byte-pool",
                   "explicit-fresh-history", "unique-free-queue", "bounds",
                   "scratch-disjoint", "closed-c-list-inventory-no-public-aliases"],
        "notEstablished": ["live-provisioning", "CREATE-RTL-execution", "physical-FPGA-acceptance",
                           "durable-reboot-or-release-history", "credential-authentication"],
    }


def prepare():
    code = native_code()
    design, memory = construct(code)
    evidence = validate(design, memory, code)
    root = ROOT / "generated-artifacts"
    root.mkdir(exist_ok=True)
    if root.is_symlink():
        raise ValueError("Candidate output root must not be a symlink")
    output = Path(tempfile.mkdtemp(prefix="mint-fpga-trial-", dir=root))
    (output / "candidate.bin").write_bytes(encoded(memory))
    for name, value in [("saved-design", design), ("evidence", evidence), ("native-code", code)]:
        (output / f"{name}.json").write_text(json.dumps(value, indent=2) + "\n")
    # Validate the saved bytes, not just the in-memory constructor.
    saved = (output / "candidate.bin").read_bytes()
    validate(json.loads((output / "saved-design.json").read_text()),
             list(struct.unpack(f">{WORDS}I", saved)), code)
    print(output.relative_to(ROOT))


if __name__ == "__main__":
    prepare()
