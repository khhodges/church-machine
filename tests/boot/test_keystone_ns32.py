"""Regression tests: Keystone NS[32] boot wiring and Hello() pre-connect fault.

Four focused assertions from the Stage 2 code review:

  1. After generate_boot_image() the NS lump c-list slot 32 holds a valid
     E-perm Golden Token pointing at Keystone (NS index 32).

  2. The Keystone lump body (magic, cw=22, cc=2) is physically embedded at
     NS[32]'s physAddr in the default boot image — not zeroed.

  3. The Keystone lump manifest declares c-list slot 0 as the Tunnel GT
     (target_ns=31, wired_at_boot=true) — the intended boot-wiring contract.

  4. Keystone.Hello() before Connect() returns exactly FAULT_NO_CONTACT
     (0xDEAD0001), not a crash or an incorrect value.  Tested via a tiny
     Node.js subprocess that mocks the minimal simulator interface and
     directly calls the system_abstractions.js handler.
"""
import base64
import json
import os
import struct
import subprocess
import sys

import pytest

ROOT      = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
LUMPS_DIR = os.path.join(ROOT, "server", "lumps")
sys.path.insert(0, ROOT)

from server.boot_image import (  # noqa: E402
    generate_boot_image,
    create_gt,
    DEFAULT_ABSTRACTION_CATALOG,
    NS_TABLE_RESERVE,
)

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

NS_LUMP_SIZE   = 64
CATALOG_COUNT  = len(DEFAULT_ABSTRACTION_CATALOG)   # 44 (Task #1918)
CLIST_BASE     = NS_LUMP_SIZE - CATALOG_COUNT        # 64 - 44 = 20

KEYSTONE_SLOT  = 23   # Task #1918: Keystone moved from slot 32 to slot 23
TUNNEL_SLOT    = 22   # Task #1918: Tunnel moved from slot 31 to slot 22

FAULT_NO_CONTACT = 0xDEAD0001


# ---------------------------------------------------------------------------
# Fixture: default boot image
# ---------------------------------------------------------------------------

def _default_cfg():
    return {
        "step1": {
            "totalNamespaceWords": 16384,
            "namespaceLumpWords":     64,
            "threadLumpWords":       256,
        },
    }


@pytest.fixture(scope="module")
def boot_words():
    img = generate_boot_image(_default_cfg(), LUMPS_DIR)
    total = 16384
    assert len(img) == total * 4
    return list(struct.unpack(f"<{total}I", img))


# ---------------------------------------------------------------------------
# Test 1 — NS c-list slot 32 is a valid E-perm GT for Keystone after cold boot
# ---------------------------------------------------------------------------

def test_ns_clist_slot32_is_keystone_gt(boot_words):
    """memory[CLIST_BASE + 32] == E-perm Inform GT for NS slot 32 (Keystone).

    Failing here means generate_boot_image() is not populating the NS lump
    c-list entry for Keystone correctly — either the catalog is out of sync
    or the GT encoding changed.
    """
    expected = create_gt(0, KEYSTONE_SLOT, {"E": 1}, 1)
    actual   = boot_words[CLIST_BASE + KEYSTONE_SLOT]
    assert actual == expected, (
        f"NS c-list slot {KEYSTONE_SLOT} (Keystone): "
        f"got 0x{actual:08X}, expected 0x{expected:08X}"
    )


def test_keystone_gt_has_e_perm_only(boot_words):
    """Keystone GT (NS c-list slot 23) has exactly E-permission and no others (v2.0 format).

    v2.0 GT field layout:
      [30:28] perm3 — 3-bit permission payload (dom=1: E/S/L encoded as perm3[2:0])
      [27]    dom   — 1 = Church domain (E/S/L)
    E-only GT: dom=1, perm3=0b100 (E=1, S=0, L=0).
    """
    word  = boot_words[CLIST_BASE + KEYSTONE_SLOT]
    perm3 = (word >> 28) & 0x7   # bits [30:28]
    dom   = (word >> 27) & 0x1   # bit  [27]
    e_bit = (perm3 >> 2) & 1     # E = perm3[2]
    s_bit = (perm3 >> 1) & 1     # S = perm3[1]
    l_bit = (perm3 >> 0) & 1     # L = perm3[0]
    assert dom   == 1, f"Keystone GT must be Church domain (dom=1): 0x{word:08X}"
    assert e_bit == 1, f"E-bit not set in Keystone GT: 0x{word:08X}"
    assert s_bit == 0, f"S-bit unexpectedly set in Keystone GT: 0x{word:08X}"
    assert l_bit == 0, f"L-bit unexpectedly set in Keystone GT: 0x{word:08X}"


def test_keystone_gt_points_to_slot_32(boot_words):
    """Keystone GT NS index field == 32."""
    word     = boot_words[CLIST_BASE + KEYSTONE_SLOT]
    ns_index = word & 0xFFFF
    assert ns_index == KEYSTONE_SLOT, (
        f"NS index in Keystone GT is {ns_index}, expected {KEYSTONE_SLOT}"
    )


# ---------------------------------------------------------------------------
# Test 2 — Keystone lump body is physically resident in the default boot image
# ---------------------------------------------------------------------------

def _keystone_phys_addr(boot_words):
    """Return NS[23] physAddr from the NS table in the boot image."""
    total         = len(boot_words)
    ns_table_base = total - NS_TABLE_RESERVE   # NS_TABLE_RESERVE = 4096 (1024 entries × 4)
    base23        = ns_table_base + KEYSTONE_SLOT * 4   # 4 words per NS entry
    return boot_words[base23]


def test_keystone_phys_addr_is_nonzero(boot_words):
    """NS[32] physAddr must not be zero — Keystone must have a dedicated
    physical location in the boot image (not overlapping NS lump at word 0)."""
    phys = _keystone_phys_addr(boot_words)
    assert phys != 0, (
        "NS[32] physAddr is 0 — Keystone is not placed in the boot image; "
        "generate_boot_image() may not have processed the catalog entry"
    )


def test_keystone_lump_header_magic_in_boot_image(boot_words):
    """The first word at Keystone's physAddr is a valid lump header
    (magic bits[31:27] == 0x1F) — confirming the body is present, not zeroed.

    Lump files are stored big-endian on disk; _read_lump_body() does a
    byte-identity passthrough so the BE bytes land verbatim in the LE image.
    Reading back via struct.pack('<I') + struct.unpack('>I') recovers the
    original big-endian value for field extraction.
    """
    phys     = _keystone_phys_addr(boot_words)
    raw_word = boot_words[phys]
    be_word  = struct.unpack(">I", struct.pack("<I", raw_word))[0]
    magic    = (be_word >> 27) & 0x1F
    assert magic == 0x1F, (
        f"NS[32] physAddr={phys}: first word 0x{raw_word:08X} (BE: 0x{be_word:08X}) "
        f"has magic=0x{magic:02X}, expected 0x1F — Keystone lump body not present"
    )


def test_keystone_lump_header_cw_in_boot_image(boot_words):
    """Keystone lump header in the boot image must declare cw=22."""
    phys     = _keystone_phys_addr(boot_words)
    raw_word = boot_words[phys]
    be_word  = struct.unpack(">I", struct.pack("<I", raw_word))[0]
    cw       = (be_word >> 10) & 0x1FFF
    assert cw == 22, (
        f"NS[32] physAddr={phys}: lump header cw={cw}, expected 22 "
        "(Connect=17 + Hello=5 words)"
    )


def test_keystone_lump_header_cc_in_boot_image(boot_words):
    """Keystone lump header in the boot image must declare cc=2 (Tunnel + MumGT)."""
    phys     = _keystone_phys_addr(boot_words)
    raw_word = boot_words[phys]
    be_word  = struct.unpack(">I", struct.pack("<I", raw_word))[0]
    cc       = be_word & 0xFF
    assert cc == 2, (
        f"NS[32] physAddr={phys}: lump header cc={cc}, expected 2"
    )


# ---------------------------------------------------------------------------
# Test 3 — Keystone manifest declares c-list slot 0 as Tunnel (wired_at_boot)
# ---------------------------------------------------------------------------

@pytest.fixture(scope="module")
def keystone_manifest_entry():
    manifest_path = os.path.join(LUMPS_DIR, "manifest.json")
    with open(manifest_path, "r") as fh:
        entries = json.load(fh)
    for entry in entries:
        if entry.get("ns_slot") == KEYSTONE_SLOT:
            return entry
    pytest.fail(f"No manifest entry with ns_slot={KEYSTONE_SLOT} found in manifest.json")


def test_keystone_manifest_cw_matches_lump(keystone_manifest_entry):
    """manifest.json Keystone entry cw must match the compiled lump binary."""
    lump_path = os.path.join(LUMPS_DIR, "00002000.lump")
    assert os.path.isfile(lump_path), "00002000.lump is missing from server/lumps/"
    with open(lump_path, "rb") as fh:
        data = fh.read()
    words_be = struct.unpack(f">{len(data) // 4}I", data)
    header   = words_be[0]
    lump_cw  = (header >> 10) & 0x1FFF
    assert keystone_manifest_entry["cw"] == lump_cw, (
        f"manifest.json cw={keystone_manifest_entry['cw']} "
        f"!= lump header cw={lump_cw}"
    )


def test_keystone_manifest_clist_slot0_is_tunnel(keystone_manifest_entry):
    """Keystone manifest capabilities[0] must be the Tunnel GT at NS[31].

    This locks the intended boot-wiring contract: c-list slot 0 of Keystone
    is always the Tunnel capability, wired at boot, pointing at NS slot 31.
    A regression here means the manifest drifted from the architectural intent.
    """
    caps = keystone_manifest_entry.get("capabilities", [])
    assert len(caps) >= 1, "Keystone manifest has no capabilities entries"
    slot0 = caps[0]
    assert slot0.get("slot") == 0, (
        f"capabilities[0].slot={slot0.get('slot')!r}, expected 0 (Tunnel)"
    )
    assert slot0.get("name") == "Tunnel", (
        f"capabilities[0].name={slot0.get('name')!r}, expected 'Tunnel'"
    )
    assert slot0.get("target_ns") == TUNNEL_SLOT, (
        f"capabilities[0].target_ns={slot0.get('target_ns')!r}, "
        f"expected {TUNNEL_SLOT} (Tunnel NS slot)"
    )
    assert slot0.get("wired_at_boot") is True, (
        "capabilities[0].wired_at_boot is not true — "
        "Tunnel GT must be boot-wired into Keystone c-list slot 0"
    )


def test_keystone_manifest_clist_slot1_is_mumgt(keystone_manifest_entry):
    """Keystone manifest capabilities[1] must be the MumGT (filled by Connect)."""
    caps = keystone_manifest_entry.get("capabilities", [])
    assert len(caps) >= 2, "Keystone manifest has fewer than 2 capabilities entries"
    slot1 = caps[1]
    assert slot1.get("slot") == 1, (
        f"capabilities[1].slot={slot1.get('slot')!r}, expected 1 (MumGT)"
    )
    assert slot1.get("name") == "MumGT", (
        f"capabilities[1].name={slot1.get('name')!r}, expected 'MumGT'"
    )
    assert slot1.get("filled_by") == "Connect", (
        f"capabilities[1].filled_by={slot1.get('filled_by')!r}, "
        "expected 'Connect'"
    )


# ---------------------------------------------------------------------------
# Test 3 — Keystone.Hello() before Connect() returns FAULT_NO_CONTACT
# ---------------------------------------------------------------------------

_HELLO_HARNESS = """\
"use strict";
const SystemAbstractions = require("./simulator/system_abstractions.js");

// Minimal mock simulator with a fresh NULL c-list for Keystone (NS 32).
const KEYSTONE_NS = 23;
const LUMP_SIZE   = 64;
const CC          = 2;
const PHYS_BASE   = 0;
const CLIST_BASE  = PHYS_BASE + LUMP_SIZE - CC;   // 62

const memory = new Array(LUMP_SIZE).fill(0);
// Write a minimal lump header: magic=0x1F, n_minus_6=0, cw=0, cc=2
memory[PHYS_BASE] = (0x1F << 27) | (0 << 23) | (0 << 10) | CC;
// c-list slots are zero (NULL GT) — pre-connect state

const sim = {
    memory,
    nsClistMap: { [KEYSTONE_NS]: [] },
    readNSEntry: (ns) => ns === KEYSTONE_NS
        ? { word0_location: PHYS_BASE, ns_slot: KEYSTONE_NS }
        : null,
    parseLumpHeader: (word) => {
        const cc = word & 0xFF;
        const lumpSize = 1 << (((word >>> 23) & 0xF) + 6);
        return { cc, lumpSize };
    },
    createGT: (seq, ns, perms, type) => {
        const E = perms.E ? 1 : 0;
        return ((0x1F << 27) | (E << 30) | (ns & 0xFFFF)) >>> 0;
    },
};

// Minimal registry that stores and calls bound methods.
const _methods = {};
const registry = {
    bindMethod(ns, name, fn) { _methods[`${ns}.${name}`] = fn; },
};

const sa = Object.create(SystemAbstractions.prototype);
sa.registry = registry;
sa._initKeystone();

// Call Hello() with NULL c-list slot 1 (pre-connect).
const helloFn = _methods[`${KEYSTONE_NS}.Hello`];
const result  = helloFn(sim, []);

if (result.result === 0xDEAD0001) {
    process.stdout.write(JSON.stringify({ ok: true, result: result.result }) + "\\n");
    process.exit(0);
} else {
    process.stdout.write(JSON.stringify({ ok: false, result: result.result,
        message: result.message || "unexpected return" }) + "\\n");
    process.exit(1);
}
"""


def test_hello_before_connect_returns_fault_no_contact():
    """Keystone.Hello() with NULL c-list slot 1 returns exactly 0xDEAD0001.

    Exercises the system_abstractions.js handler inline via a Node.js subprocess
    with a mocked simulator that has an empty (NULL GT) c-list for NS[32].
    A regression here means Connect() was called implicitly or the fault code
    was changed — both are breaking changes.
    """
    proc = subprocess.run(
        ["node", "--input-type=commonjs"],
        input=_HELLO_HARNESS.encode("utf-8"),
        capture_output=True,
        timeout=10,
        cwd=ROOT,
    )
    stdout = proc.stdout.decode("utf-8", errors="replace").strip()
    stderr = proc.stderr.decode("utf-8", errors="replace").strip()

    assert proc.returncode == 0, (
        f"Hello-before-Connect harness exited {proc.returncode}.\n"
        f"stdout: {stdout}\nstderr: {stderr}"
    )

    try:
        data = json.loads(stdout)
    except json.JSONDecodeError as exc:
        pytest.fail(
            f"Harness produced non-JSON output: {exc}\nstdout: {stdout}"
        )

    assert data.get("ok") is True, (
        f"Hello() did not return FAULT_NO_CONTACT; "
        f"result=0x{data.get('result', 0):08X}, message={data.get('message')!r}"
    )
    assert data["result"] == FAULT_NO_CONTACT, (
        f"Hello() returned 0x{data['result']:08X}, "
        f"expected FAULT_NO_CONTACT=0x{FAULT_NO_CONTACT:08X}"
    )


# ---------------------------------------------------------------------------
# Test 4 — Connect(valid_identity) then Hello() returns GREET_RESPONSE
# ---------------------------------------------------------------------------

_CONNECT_HELLO_HARNESS = """\
"use strict";
const SystemAbstractions = require("./simulator/system_abstractions.js");

const KEYSTONE_NS    = 23;
const TUNNEL_NS = 22;
const LUMP_SIZE      = 64;
const CC             = 2;
const PHYS_BASE      = 0;
const CLIST_BASE_OFF = LUMP_SIZE - CC;   // 62

// Valid mum identity: protocol tag = 1 in bits[31:28], rest non-zero.
const VALID_IDENTITY = (1 << 28) | 0x0FACADE;
const GREET_RESPONSE = 0x48454C4C;

const memory = new Array(LUMP_SIZE).fill(0);
memory[PHYS_BASE] = (0x1F << 27) | (0 << 23) | (0 << 10) | CC;

const sim = {
    memory,
    nsClistMap: { [KEYSTONE_NS]: [] },
    readNSEntry: (ns) => ns === KEYSTONE_NS
        ? { word0_location: PHYS_BASE, ns_slot: KEYSTONE_NS }
        : null,
    parseLumpHeader: (word) => ({
        cc: word & 0xFF,
        lumpSize: 1 << (((word >>> 23) & 0xF) + 6),
    }),
    createGT: (seq, ns, perms, type) =>
        ((0x1F << 27) | ((perms.E ? 1 : 0) << 30) | (ns & 0xFFFF)) >>> 0,
    abstractionRegistry: null,
};

const _methods = {};
const registry = {
    bindMethod(ns, name, fn) { _methods[`${ns}.${name}`] = fn; },
};

const sa = Object.create(SystemAbstractions.prototype);
sa.registry = registry;
sa._initKeystone();

// Simulate Init() boot-wiring: pre-fill slot 0 with the Tunnel E-GT.
// In production this is done by Keystone.Init() during Navana.Init().
const tunnelGT = sim.createGT(0, TUNNEL_NS, { E: 1 }, 1);
sim.memory[PHYS_BASE + CLIST_BASE_OFF + 0] = tunnelGT >>> 0;

const connectFn = _methods[`${KEYSTONE_NS}.Connect`];
const helloFn   = _methods[`${KEYSTONE_NS}.Hello`];

const connectResult = connectFn(sim, [VALID_IDENTITY]);
if (connectResult.result !== 1) {
    process.stdout.write(JSON.stringify({ ok: false, step: "Connect",
        result: connectResult.result, message: connectResult.message }) + "\\n");
    process.exit(1);
}

const helloResult = helloFn(sim, []);
const ok = (helloResult.result >>> 0) === GREET_RESPONSE;
process.stdout.write(JSON.stringify({ ok, result: helloResult.result >>> 0,
    message: helloResult.message || "" }) + "\\n");
process.exit(ok ? 0 : 1);
"""


def test_hello_after_connect_returns_greet_response():
    """Connect(valid_identity_word) followed by Hello() returns 0x48454C4C ('HELL').

    Locks Stage 2 expected behavior: a valid Mum identity word (protocol tag
    bits[31:28] == 1) causes Connect() to issue a GT into c-list slot 1, after
    which Hello() returns the GREET_RESPONSE rather than FAULT_NO_CONTACT.
    """
    proc = subprocess.run(
        ["node", "--input-type=commonjs"],
        input=_CONNECT_HELLO_HARNESS.encode("utf-8"),
        capture_output=True,
        timeout=10,
        cwd=ROOT,
    )
    stdout = proc.stdout.decode("utf-8", errors="replace").strip()
    stderr = proc.stderr.decode("utf-8", errors="replace").strip()

    assert proc.returncode == 0, (
        f"Connect→Hello harness exited {proc.returncode}.\n"
        f"stdout: {stdout}\nstderr: {stderr}"
    )

    try:
        data = json.loads(stdout)
    except json.JSONDecodeError as exc:
        pytest.fail(
            f"Harness produced non-JSON output: {exc}\nstdout: {stdout}"
        )

    GREET_RESPONSE = 0x48454C4C
    assert data.get("ok") is True, (
        f"Hello() after Connect() did not return 0x{GREET_RESPONSE:08X}; "
        f"result=0x{data.get('result', 0):08X}, message={data.get('message')!r}"
    )
    assert data["result"] == GREET_RESPONSE, (
        f"Hello() returned 0x{data['result']:08X}, "
        f"expected GREET_RESPONSE=0x{GREET_RESPONSE:08X}"
    )


# ---------------------------------------------------------------------------
# Test 5 — Keystone.Init() wires Tunnel E-GT into c-list slot 0 at boot
# ---------------------------------------------------------------------------

_INIT_WIRE_HARNESS = """\
"use strict";
const SystemAbstractions = require("./simulator/system_abstractions.js");

// Minimal mock simulator with a Keystone lump (64 words, cc=2).
// Slot 0 starts as NULL GT; Init() must fill it with the Tunnel E-GT.
const KEYSTONE_NS = 23;
const TUNNEL_NS = 22;
const LUMP_SIZE   = 64;
const CC          = 2;
const PHYS_BASE   = 0;
const CLIST_BASE  = PHYS_BASE + LUMP_SIZE - CC;   // 62

const memory = new Array(LUMP_SIZE).fill(0);
// Minimal lump header: magic=0x1F, n_minus_6=0, cw=0, cc=2
memory[PHYS_BASE] = (0x1F << 27) | (0 << 23) | (0 << 10) | CC;

const sim = {
    memory,
    nsClistMap: { [KEYSTONE_NS]: [] },
    readNSEntry: (ns) => ns === KEYSTONE_NS
        ? { word0_location: PHYS_BASE, ns_slot: KEYSTONE_NS }
        : null,
    parseLumpHeader: (word) => {
        const cc = word & 0xFF;
        const lumpSize = 1 << (((word >>> 23) & 0xF) + 6);
        return { cc, lumpSize };
    },
    createGT: (seq, ns, perms, type) => {
        const E = perms.E ? 1 : 0;
        return ((0x1F << 27) | (E << 30) | (ns & 0xFFFF)) >>> 0;
    },
    abstractionRegistry: null,  // not needed for this test
};

const _methods = {};
const registry = {
    bindMethod(ns, name, fn) { _methods[`${ns}.${name}`] = fn; },
};

const sa = Object.create(SystemAbstractions.prototype);
sa.registry = registry;
sa._initKeystone();

// Call Keystone.Init() — the boot-wiring step.
const initFn = _methods[`${KEYSTONE_NS}.Init`];
if (!initFn) {
    process.stdout.write(JSON.stringify({ ok: false, message: "Keystone.Init not bound" }) + "\\n");
    process.exit(1);
}
initFn(sim, {});

// Read c-list slot 0 — must be non-zero (the Tunnel E-GT).
const slot0 = sim.memory[CLIST_BASE + 0] >>> 0;
const tunnelNSInSlot = slot0 & 0xFFFF;
const ebitSet = ((slot0 >>> 30) & 1) === 1;

if (slot0 === 0) {
    process.stdout.write(JSON.stringify({ ok: false, result: 0,
        message: "c-list slot 0 is still NULL GT after Keystone.Init()" }) + "\\n");
    process.exit(1);
}

const ok = (tunnelNSInSlot === TUNNEL_NS) && ebitSet;
process.stdout.write(JSON.stringify({
    ok,
    result: slot0,
    tunnelNS: tunnelNSInSlot,
    eBitSet: ebitSet,
    message: ok
        ? `slot 0 = 0x${slot0.toString(16).toUpperCase().padStart(8,'0')} — Tunnel E-GT wired correctly`
        : `slot 0 = 0x${slot0.toString(16).toUpperCase().padStart(8,'0')} — wrong GT (ns=${tunnelNSInSlot}, E=${ebitSet})`
}) + "\\n");
process.exit(ok ? 0 : 1);
"""


def test_keystone_init_wires_tunnel_gt_into_clist_slot0():
    """Keystone.Init() writes a valid Tunnel E-GT (NS[31]) into c-list slot 0.

    This is the core boot-wiring contract from Task #769: after _initKeystone()
    binds the Init method and Init() is called (as Navana.Init does at boot),
    sim.memory[clist_base + 0] must hold a non-zero E-GT pointing at NS[31].

    A regression here means the cold-boot path for Keystone.Hello() will see a
    NULL GT in slot 0 and cannot route through the Tunnel without a lazy-load.
    """
    proc = subprocess.run(
        ["node", "--input-type=commonjs"],
        input=_INIT_WIRE_HARNESS.encode("utf-8"),
        capture_output=True,
        timeout=10,
        cwd=ROOT,
    )
    stdout = proc.stdout.decode("utf-8", errors="replace").strip()
    stderr = proc.stderr.decode("utf-8", errors="replace").strip()

    assert proc.returncode == 0, (
        f"Keystone.Init wire harness exited {proc.returncode}.\n"
        f"stdout: {stdout}\nstderr: {stderr}"
    )

    try:
        data = json.loads(stdout)
    except json.JSONDecodeError as exc:
        pytest.fail(
            f"Harness produced non-JSON output: {exc}\nstdout: {stdout}"
        )

    assert data.get("ok") is True, (
        f"Keystone.Init() did not wire Tunnel GT into slot 0; "
        f"result=0x{data.get('result', 0):08X}, message={data.get('message')!r}"
    )
    assert data.get("tunnelNS") == TUNNEL_SLOT, (
        f"c-list slot 0 NS index = {data.get('tunnelNS')}, expected {TUNNEL_SLOT} (Tunnel)"
    )
    assert data.get("eBitSet") is True, (
        f"Tunnel GT in c-list slot 0 has E-bit clear: 0x{data.get('result', 0):08X}"
    )


# ---------------------------------------------------------------------------
# Test 6 — Hello() returns FAULT_NO_CONTACT when slot 0 (Tunnel) is NULL
#          even when slot 1 (MumGT) is non-NULL (Connect was called but
#          Init was not).  This distinguishes the slot-0 guard from the
#          pre-connect slot-1 guard that existed before Task #773.
# ---------------------------------------------------------------------------

_HELLO_SLOT0_NULL_HARNESS = """\
"use strict";
const SystemAbstractions = require("./simulator/system_abstractions.js");

const KEYSTONE_NS    = 23;
const LUMP_SIZE      = 64;
const CC             = 2;
const PHYS_BASE      = 0;
const CLIST_BASE_OFF = LUMP_SIZE - CC;   // 62

const FAULT_NO_CONTACT = 0xDEAD0001;
// Non-zero sentinel value for slot 1 — simulates Connect() having been called.
const FAKE_MUM_GT = 0xC0FFEE01;

const memory = new Array(LUMP_SIZE).fill(0);
memory[PHYS_BASE] = (0x1F << 27) | (0 << 23) | (0 << 10) | CC;
// Slot 0 (Tunnel) stays NULL — Init() was never called.
// Slot 1 (MumGT) is non-zero — Connect() has been called.
memory[PHYS_BASE + CLIST_BASE_OFF + 1] = FAKE_MUM_GT >>> 0;

const sim = {
    memory,
    nsClistMap: { [KEYSTONE_NS]: [] },
    readNSEntry: (ns) => ns === KEYSTONE_NS
        ? { word0_location: PHYS_BASE, ns_slot: KEYSTONE_NS }
        : null,
    parseLumpHeader: (word) => ({
        cc: word & 0xFF,
        lumpSize: 1 << (((word >>> 23) & 0xF) + 6),
    }),
    createGT: (seq, ns, perms, type) =>
        ((0x1F << 27) | ((perms.E ? 1 : 0) << 30) | (ns & 0xFFFF)) >>> 0,
    abstractionRegistry: null,
};

const _methods = {};
const registry = {
    bindMethod(ns, name, fn) { _methods[`${ns}.${name}`] = fn; },
};

const sa = Object.create(SystemAbstractions.prototype);
sa.registry = registry;
sa._initKeystone();

const helloFn = _methods[`${KEYSTONE_NS}.Hello`];
const result  = helloFn(sim, []);

const ok = (result.result >>> 0) === FAULT_NO_CONTACT;
process.stdout.write(JSON.stringify({
    ok,
    result: result.result >>> 0,
    message: result.message || "",
    slot0: sim.memory[PHYS_BASE + CLIST_BASE_OFF + 0],
    slot1: sim.memory[PHYS_BASE + CLIST_BASE_OFF + 1],
}) + "\\n");
process.exit(ok ? 0 : 1);
"""


def test_hello_slot0_null_returns_fault_no_contact():
    """Hello() returns FAULT_NO_CONTACT when slot 0 (Tunnel) is NULL, even
    when slot 1 (MumGT) is non-zero.

    This test is distinct from test_hello_before_connect_returns_fault_no_contact
    (which has both slots NULL).  Here Connect() has been called so slot 1 is
    non-zero, but Init() was never called so slot 0 is still NULL.  The new
    routing path added in Task #773 must guard on slot 0, not slot 1.
    """
    proc = subprocess.run(
        ["node", "--input-type=commonjs"],
        input=_HELLO_SLOT0_NULL_HARNESS.encode("utf-8"),
        capture_output=True,
        timeout=10,
        cwd=ROOT,
    )
    stdout = proc.stdout.decode("utf-8", errors="replace").strip()
    stderr = proc.stderr.decode("utf-8", errors="replace").strip()

    assert proc.returncode == 0, (
        f"Hello-slot0-null harness exited {proc.returncode}.\n"
        f"stdout: {stdout}\nstderr: {stderr}"
    )

    try:
        data = json.loads(stdout)
    except json.JSONDecodeError as exc:
        pytest.fail(
            f"Harness produced non-JSON output: {exc}\nstdout: {stdout}"
        )

    assert data.get("ok") is True, (
        f"Hello() did not return FAULT_NO_CONTACT when slot 0 is NULL; "
        f"result=0x{data.get('result', 0):08X}, message={data.get('message')!r}"
    )
    assert data["result"] == FAULT_NO_CONTACT, (
        f"Hello() returned 0x{data['result']:08X}, "
        f"expected FAULT_NO_CONTACT=0x{FAULT_NO_CONTACT:08X}"
    )


# ---------------------------------------------------------------------------
# Test 7 — Hello() calls abstractionRegistry.dispatchMethod(31, 'Call', ...)
#          with the MumGT from slot 1 when slot 0 (Tunnel) is wired
# ---------------------------------------------------------------------------

_HELLO_DISPATCH_HARNESS = """\
"use strict";
const SystemAbstractions = require("./simulator/system_abstractions.js");

const KEYSTONE_NS    = 23;
const TUNNEL_NS = 22;
const LUMP_SIZE      = 64;
const CC             = 2;
const PHYS_BASE      = 0;
const CLIST_BASE_OFF = LUMP_SIZE - CC;   // 62

const VALID_IDENTITY = (1 << 28) | 0x0FACADE;

const memory = new Array(LUMP_SIZE).fill(0);
memory[PHYS_BASE] = (0x1F << 27) | (0 << 23) | (0 << 10) | CC;

// Capture dispatchMethod calls for assertion.
const dispatchCalls = [];

const sim = {
    memory,
    nsClistMap: { [KEYSTONE_NS]: [] },
    readNSEntry: (ns) => ns === KEYSTONE_NS
        ? { word0_location: PHYS_BASE, ns_slot: KEYSTONE_NS }
        : null,
    parseLumpHeader: (word) => ({
        cc: word & 0xFF,
        lumpSize: 1 << (((word >>> 23) & 0xF) + 6),
    }),
    createGT: (seq, ns, perms, type) =>
        ((0x1F << 27) | ((perms.E ? 1 : 0) << 30) | (ns & 0xFFFF)) >>> 0,
    abstractionRegistry: {
        dispatchMethod(nsIndex, method, simRef, args) {
            dispatchCalls.push({ nsIndex, method, args: Object.assign({}, args) });
            return { ok: true, result: 0 };
        },
    },
};

const _methods = {};
const registry = {
    bindMethod(ns, name, fn) { _methods[`${ns}.${name}`] = fn; },
};

const sa = Object.create(SystemAbstractions.prototype);
sa.registry = registry;
sa._initKeystone();

// Boot-wire slot 0 with Tunnel E-GT (Init() contract).
const tunnelGT = sim.createGT(0, TUNNEL_NS, { E: 1 }, 1);
sim.memory[PHYS_BASE + CLIST_BASE_OFF + 0] = tunnelGT >>> 0;

// Call Connect() to fill slot 1 with MumGT.
const connectFn = _methods[`${KEYSTONE_NS}.Connect`];
const connectResult = connectFn(sim, [VALID_IDENTITY]);
if (connectResult.result !== 1) {
    process.stdout.write(JSON.stringify({ ok: false, step: "Connect",
        message: connectResult.message }) + "\\n");
    process.exit(1);
}

// Read back the MumGT that Connect() stored in slot 1.
const mumGT = sim.memory[PHYS_BASE + CLIST_BASE_OFF + 1] >>> 0;

// Call Hello() — should trigger dispatchMethod(31, 'Call', sim, { cr2: mumGT }).
const helloFn = _methods[`${KEYSTONE_NS}.Hello`];
helloFn(sim, []);

// Assert the dispatch was recorded correctly.
const call = dispatchCalls[0];
const ok = call
    && call.nsIndex === TUNNEL_NS
    && call.method === "Call"
    && (call.args.cr2 >>> 0) === mumGT;

process.stdout.write(JSON.stringify({
    ok: !!ok,
    dispatchCalls,
    mumGT,
    message: ok
        ? "dispatchMethod called with correct nsIndex, method, and cr2"
        : "dispatchMethod call mismatch: " + JSON.stringify(call || null),
}) + "\\n");
process.exit(ok ? 0 : 1);
"""


def test_hello_dispatches_tunnel_call_with_mum_gt():
    """Hello() calls abstractionRegistry.dispatchMethod(31, 'Call', ..., {cr2: mumGT})
    when slot 0 (Tunnel) is wired and slot 1 (MumGT) was filled by Connect().

    Directly exercises the Tunnel forwarding step added in Task #773 by supplying
    a mock abstractionRegistry that records dispatchMethod invocations.
    """
    proc = subprocess.run(
        ["node", "--input-type=commonjs"],
        input=_HELLO_DISPATCH_HARNESS.encode("utf-8"),
        capture_output=True,
        timeout=10,
        cwd=ROOT,
    )
    stdout = proc.stdout.decode("utf-8", errors="replace").strip()
    stderr = proc.stderr.decode("utf-8", errors="replace").strip()

    assert proc.returncode == 0, (
        f"Hello-dispatch harness exited {proc.returncode}.\n"
        f"stdout: {stdout}\nstderr: {stderr}"
    )

    try:
        data = json.loads(stdout)
    except json.JSONDecodeError as exc:
        pytest.fail(
            f"Harness produced non-JSON output: {exc}\nstdout: {stdout}"
        )

    assert data.get("ok") is True, (
        f"Hello() did not dispatch Tunnel.Call correctly; "
        f"message={data.get('message')!r}, dispatchCalls={data.get('dispatchCalls')!r}"
    )


# ---------------------------------------------------------------------------
# Test 8 — Tunnel.Call (NS[31]) is registered by _bindTunnel() and returns
#          ok:true with the cr2 GT echoed back when cr2 is non-zero
# ---------------------------------------------------------------------------

_TUNNEL_CALL_HARNESS = """\
"use strict";
const SystemAbstractions = require("./simulator/system_abstractions.js");

const TUNNEL_NS = 22;

// Minimal mock sim — Tunnel.Call does not read sim memory.
const sim = {
    memory: new Array(64).fill(0),
};

const _methods = {};
const registry = {
    bindMethod(ns, name, fn) { _methods[`${ns}.${name}`] = fn; },
};

const sa = Object.create(SystemAbstractions.prototype);
sa.registry = registry;
sa._bindTunnel();

const callFn = _methods[`${TUNNEL_NS}.Call`];
if (!callFn) {
    process.stdout.write(JSON.stringify({ ok: false, message: "Tunnel.Call not bound by _bindTunnel()" }) + "\\n");
    process.exit(1);
}

// Case 1: non-zero cr2 — must return ok:true and echo the GT back.
const FAKE_MUM_GT = 0xC0FFEE01;
const result1 = callFn(sim, { cr2: FAKE_MUM_GT });
const case1ok = result1.ok === true && (result1.result >>> 0) === FAKE_MUM_GT;

// Case 2: zero cr2 — must return ok:false with NULL_GT fault.
const result2 = callFn(sim, { cr2: 0 });
const case2ok = result2.ok === false && result2.fault === "NULL_GT";

const ok = case1ok && case2ok;
process.stdout.write(JSON.stringify({
    ok,
    case1: { ok: result1.ok, result: result1.result >>> 0, fault: result1.fault, pass: case1ok },
    case2: { ok: result2.ok, result: result2.result, fault: result2.fault, pass: case2ok },
    message: ok
        ? "Tunnel.Call: non-zero cr2 → ok:true; zero cr2 → ok:false/NULL_GT"
        : `Tunnel.Call assertion failure — case1ok=${case1ok}, case2ok=${case2ok}`
}) + "\\n");
process.exit(ok ? 0 : 1);
"""


def test_tunnel_call_returns_ok_when_cr2_nonzero():
    """Tunnel.Call (NS[31]) registered by _bindTunnel() returns ok:true and echoes
    the cr2 GT when cr2 is non-zero, and ok:false / fault='NULL_GT' when cr2 is zero.

    Exercises the _bindTunnel() path added in this task.  Without _bindTunnel(),
    Hello() calling dispatchMethod(31, 'Call', ...) silently receives a METHOD
    fault instead of forwarding.  This test confirms the handler is reachable and
    correct independently of the Keystone path.
    """
    proc = subprocess.run(
        ["node", "--input-type=commonjs"],
        input=_TUNNEL_CALL_HARNESS.encode("utf-8"),
        capture_output=True,
        timeout=10,
        cwd=ROOT,
    )
    stdout = proc.stdout.decode("utf-8", errors="replace").strip()
    stderr = proc.stderr.decode("utf-8", errors="replace").strip()

    assert proc.returncode == 0, (
        f"Tunnel.Call harness exited {proc.returncode}.\n"
        f"stdout: {stdout}\nstderr: {stderr}"
    )

    try:
        data = json.loads(stdout)
    except json.JSONDecodeError as exc:
        pytest.fail(
            f"Harness produced non-JSON output: {exc}\nstdout: {stdout}"
        )

    assert data.get("ok") is True, (
        f"Tunnel.Call test failed; message={data.get('message')!r}, "
        f"case1={data.get('case1')!r}, case2={data.get('case2')!r}"
    )


# ---------------------------------------------------------------------------
# Test 9 — Full round-trip: boot image → live simulator → Navana.Init →
#           assert memory[Keystone_clist_base + 0] == Tunnel E-GT
# ---------------------------------------------------------------------------

_NAVANA_INIT_KEYSTONE_HARNESS = os.path.join(
    os.path.dirname(__file__), "sim_navana_init_keystone.js"
)

_ROUND_TRIP_CFG = {
    "step1": {
        "totalNamespaceWords": 16384,
        "namespaceLumpWords":     64,
        "threadLumpWords":       256,
    },
}


def test_keystone_slot0_wiring_survives_boot_image_round_trip():
    """Boot image → live simulator → Navana.Init → Keystone c-list slot 0 is Tunnel E-GT.

    This exercises the full path that the isolated unit tests cannot cover:

      1. generate_boot_image() produces the canonical NS memory image with
         Keystone (NS[32]) placed at its correct physical address, with a
         real cc=2 lump header and the correct NS-table entry.

      2. The image is loaded into a ChurchSimulator instance that has a
         full AbstractionRegistry + SystemAbstractions stack — the same stack
         the browser IDE uses.

      3. The boot state machine (_bootStep loop) runs to completion, placing
         NS entries and lump headers exactly as they will appear in production.

      4. Navana.Init (NS[5] Init method) is dispatched.  Navana.Init calls
         sim.abstractionRegistry.dispatchMethod(32, 'Init', sim, {}) which is
         Keystone.Init.  Keystone.Init uses sim.readNSEntry(32) and
         sim.parseLumpHeader() to locate the c-list base inside the lump
         body, then writes the Tunnel E-GT (NS[31]) into slot 0.

      5. This test reads sim.memory at that same c-list slot 0 address and
         asserts the value is a non-zero E-GT pointing at NS[31] (Tunnel).

    A failure here catches wiring that passes in isolation but breaks when
    combined with the full NS table layout, a real lump header, or the actual
    clistBase calculation performed inside the live simulator.
    """
    img_bytes = generate_boot_image(_ROUND_TRIP_CFG, LUMPS_DIR)
    img_b64   = base64.b64encode(img_bytes).decode("ascii")

    envelope = json.dumps({"imageBase64": img_b64, "config": _ROUND_TRIP_CFG}).encode("utf-8")

    proc = subprocess.run(
        ["node", _NAVANA_INIT_KEYSTONE_HARNESS],
        input=envelope,
        capture_output=True,
        timeout=30,
        cwd=ROOT,
    )
    stdout = proc.stdout.decode("utf-8", errors="replace").strip()
    stderr = proc.stderr.decode("utf-8", errors="replace").strip()

    assert proc.returncode == 0, (
        f"sim_navana_init_keystone.js exited {proc.returncode}.\n"
        f"stdout: {stdout}\nstderr: {stderr}"
    )

    try:
        data = json.loads(stdout)
    except json.JSONDecodeError as exc:
        pytest.fail(
            f"Harness produced non-JSON output: {exc}\nstdout: {stdout}"
        )

    assert data.get("loaded") is True, (
        f"loadBootImage() returned False — boot image was not loaded into the simulator.\n"
        f"faultCount={data.get('faultCount')}"
    )

    assert data.get("bootComplete") is True, (
        f"Boot state machine did not complete — check the image or simulator.\n"
        f"faultCount={data.get('faultCount')}, message={data.get('message')!r}"
    )

    assert data.get("navanaOk") is True, (
        "Navana.Init dispatch returned a falsy/error result — "
        "Keystone.Init cannot have been called.\n"
        f"message={data.get('message')!r}"
    )

    assert data.get("slot0", 0) != 0, (
        "Keystone c-list slot 0 is NULL GT after Navana.Init in live simulator.\n"
        f"message={data.get('message')!r}\n"
        f"lumpSize={data.get('lumpSize')}, cc={data.get('cc')}, clistBase={data.get('clistBase')}"
    )

    assert data.get("tunnelNS") == TUNNEL_SLOT, (
        f"Keystone c-list slot 0 NS index = {data.get('tunnelNS')}, "
        f"expected {TUNNEL_SLOT} (Tunnel)\n"
        f"slot0={data.get('slot0Hex')!r}, message={data.get('message')!r}"
    )

    assert data.get("eBitSet") is True, (
        f"Tunnel GT in Keystone c-list slot 0 has E-bit clear.\n"
        f"slot0={data.get('slot0Hex')!r}, message={data.get('message')!r}"
    )

    # Strict bitwise equality using the JS simulator's v2.0 GT layout (authoritative).
    # v2.0 layout:  [31]=b_flag=0  [30:28]=perm3=100(E)  [27]=dom=1
    #               [26:25]=gt_type=01(Inform)  [24:16]=gt_seq=0  [15:0]=slot_id=22
    # = 0x40000000 | 0x08000000 | 0x02000000 | 22 = 0x4A000016
    # NOTE: Python create_gt() still uses old layout (type at [24:23]) so is NOT used here.
    perm3_e  = 0b100          # E-only in Church domain
    dom      = 1
    gt_type  = 1              # Inform
    expected_gt = ((perm3_e << 28) | (dom << 27) | (gt_type << 25) | TUNNEL_SLOT) & 0xFFFFFFFF
    actual_slot0 = data.get("slot0", 0)
    assert actual_slot0 == expected_gt, (
        f"Keystone c-list slot 0 bitwise mismatch: "
        f"got 0x{actual_slot0:08X}, expected 0x{expected_gt:08X} "
        f"(Tunnel E-GT for NS[{TUNNEL_SLOT}], v2.0 format, type=Inform, seq=0).\n"
        f"This catches extra permission bits or wrong GT type even when NS index and E-bit are correct."
    )

    assert data.get("ok") is True, (
        f"Round-trip wiring check failed: {data.get('message')!r}"
    )


# ---------------------------------------------------------------------------
# Test 10 (T5) — Tunnel.Call bound by _initKeystone returns GREET_RESPONSE
#               when cr2 is a valid MumGT (after Init + Connect)
# ---------------------------------------------------------------------------

_TUNNEL_CALL_KEYSTONE_HARNESS = """\
"use strict";
const SystemAbstractions = require("./simulator/system_abstractions.js");

const KEYSTONE_NS    = 23;
const TUNNEL_NS = 22;
const LUMP_SIZE      = 64;
const CC             = 2;
const PHYS_BASE      = 0;
const CLIST_BASE_OFF = LUMP_SIZE - CC;   // 62

// Valid mum identity: protocol tag = 1 in bits[31:28], rest non-zero.
const VALID_IDENTITY = (1 << 28) | 0x0FACADE;
const GREET_RESPONSE = 0x48454C4C;

const memory = new Array(LUMP_SIZE).fill(0);
memory[PHYS_BASE] = (0x1F << 27) | (0 << 23) | (0 << 10) | CC;

const sim = {
    memory,
    nsClistMap: { [KEYSTONE_NS]: [] },
    readNSEntry: (ns) => ns === KEYSTONE_NS
        ? { word0_location: PHYS_BASE, ns_slot: KEYSTONE_NS }
        : null,
    parseLumpHeader: (word) => ({
        cc: word & 0xFF,
        lumpSize: 1 << (((word >>> 23) & 0xF) + 6),
    }),
    createGT: (seq, ns, perms, type) =>
        ((0x1F << 27) | ((perms.E ? 1 : 0) << 30) | (ns & 0xFFFF)) >>> 0,
    abstractionRegistry: null,
};

const _methods = {};
const registry = {
    bindMethod(ns, name, fn) { _methods[`${ns}.${name}`] = fn; },
};

const sa = Object.create(SystemAbstractions.prototype);
sa.registry = registry;
sa._initKeystone();

// Call Keystone.Init() explicitly — this is the boot-wiring step that writes
// the Tunnel E-GT into c-list slot 0, matching the literal task requirement.
const initFn = _methods[`${KEYSTONE_NS}.Init`];
if (!initFn) {
    process.stdout.write(JSON.stringify({ ok: false,
        message: "Keystone.Init not bound by _initKeystone()" }) + "\\n");
    process.exit(1);
}
initFn(sim, {});

// Call Connect() to fill slot 1 with MumGT.
const connectFn = _methods[`${KEYSTONE_NS}.Connect`];
const connectResult = connectFn(sim, [VALID_IDENTITY]);
if (connectResult.result !== 1) {
    process.stdout.write(JSON.stringify({ ok: false, step: "Connect",
        message: connectResult.message }) + "\\n");
    process.exit(1);
}

// Read back the MumGT that Connect() stored in slot 1.
const mumGT = sim.memory[PHYS_BASE + CLIST_BASE_OFF + 1] >>> 0;

// Invoke Tunnel.Call bound by _initKeystone — cr2=mumGT (non-zero).
const tunnelCallFn = _methods[`${TUNNEL_NS}.Call`];
if (!tunnelCallFn) {
    process.stdout.write(JSON.stringify({ ok: false,
        message: "Tunnel.Call not bound by _initKeystone()" }) + "\\n");
    process.exit(1);
}

const result = tunnelCallFn(sim, { cr2: mumGT });
const ok = result.ok === true && (result.result >>> 0) === GREET_RESPONSE;

process.stdout.write(JSON.stringify({
    ok,
    result: result.result >>> 0,
    fault: result.fault || null,
    mumGT,
    message: result.message || "",
}) + "\\n");
process.exit(ok ? 0 : 1);
"""


def test_tunnel_call_with_valid_mum_gt_returns_greet_response():
    """Tunnel.Call bound by _initKeystone() returns ok=True and result=0x48454C4C
    after Init() + Connect(valid_word) with a non-zero MumGT in slot 1.

    Follows the literal boot sequence: Keystone.Init() is called first (wires
    the Tunnel E-GT into c-list slot 0), then Connect(valid_identity) fills
    slot 1 with MumGT, then Tunnel.Call({cr2: mumGT}) is invoked.

    Expects the canonical GREET_RESPONSE (0x48454C4C, 'HELL') and ok=True —
    the Stage 4 live-bridge behavior.  Distinct from Test 8 (_bindTunnel),
    which echoes cr2 instead of returning GREET_RESPONSE.
    """
    proc = subprocess.run(
        ["node", "--input-type=commonjs"],
        input=_TUNNEL_CALL_KEYSTONE_HARNESS.encode("utf-8"),
        capture_output=True,
        timeout=10,
        cwd=ROOT,
    )
    stdout = proc.stdout.decode("utf-8", errors="replace").strip()
    stderr = proc.stderr.decode("utf-8", errors="replace").strip()

    assert proc.returncode == 0, (
        f"Tunnel.Call(mumGT) harness exited {proc.returncode}.\n"
        f"stdout: {stdout}\nstderr: {stderr}"
    )

    try:
        data = json.loads(stdout)
    except json.JSONDecodeError as exc:
        pytest.fail(
            f"Harness produced non-JSON output: {exc}\nstdout: {stdout}"
        )

    GREET_RESPONSE = 0x48454C4C
    assert data.get("ok") is True, (
        f"Tunnel.Call(mumGT) did not return ok=True; "
        f"result=0x{data.get('result', 0):08X}, fault={data.get('fault')!r}, "
        f"message={data.get('message')!r}"
    )
    assert data["result"] == GREET_RESPONSE, (
        f"Tunnel.Call(mumGT) returned 0x{data['result']:08X}, "
        f"expected GREET_RESPONSE=0x{GREET_RESPONSE:08X}"
    )


# ---------------------------------------------------------------------------
# Test 11 (T6) — Tunnel.Call bound by _initKeystone returns ok=False and
#                fault='NO_CONTACT' when cr2 is zero (NULL GT)
# ---------------------------------------------------------------------------

_TUNNEL_CALL_NULL_GT_HARNESS = """\
"use strict";
const SystemAbstractions = require("./simulator/system_abstractions.js");

const TUNNEL_NS = 22;

// Minimal mock sim — Tunnel.Call bound by _initKeystone does not read memory.
const sim = {
    memory: new Array(64).fill(0),
};

const _methods = {};
const registry = {
    bindMethod(ns, name, fn) { _methods[`${ns}.${name}`] = fn; },
};

const sa = Object.create(SystemAbstractions.prototype);
sa.registry = registry;
sa._initKeystone();

const tunnelCallFn = _methods[`${TUNNEL_NS}.Call`];
if (!tunnelCallFn) {
    process.stdout.write(JSON.stringify({ ok: false,
        message: "Tunnel.Call not bound by _initKeystone()" }) + "\\n");
    process.exit(1);
}

// cr2 = 0 (NULL GT) — Connect() was never called.
const result = tunnelCallFn(sim, { cr2: 0 });
const ok = result.ok === false && result.fault === "NO_CONTACT";

process.stdout.write(JSON.stringify({
    ok,
    resultOk: result.ok,
    fault: result.fault || null,
    result: (result.result >>> 0),
    message: result.message || "",
}) + "\\n");
process.exit(ok ? 0 : 1);
"""


def test_tunnel_call_with_null_gt_returns_no_contact():
    """Tunnel.Call bound by _initKeystone() returns ok=False and fault='NO_CONTACT'
    when cr2 is zero (NULL GT).

    This guards the pre-connect guard in the Stage 4 Tunnel.Call binding: if
    the caller passes cr2=0 (i.e. Keystone.Connect() was never called and slot 1
    is still NULL), the bridge must refuse with ok=False and fault='NO_CONTACT'.

    A regression here means the guard was loosened to allow NULL GTs through,
    which would cause Mum.Greet() to be invoked with no valid capability token.
    """
    proc = subprocess.run(
        ["node", "--input-type=commonjs"],
        input=_TUNNEL_CALL_NULL_GT_HARNESS.encode("utf-8"),
        capture_output=True,
        timeout=10,
        cwd=ROOT,
    )
    stdout = proc.stdout.decode("utf-8", errors="replace").strip()
    stderr = proc.stderr.decode("utf-8", errors="replace").strip()

    assert proc.returncode == 0, (
        f"Tunnel.Call(cr2=0) harness exited {proc.returncode}.\n"
        f"stdout: {stdout}\nstderr: {stderr}"
    )

    try:
        data = json.loads(stdout)
    except json.JSONDecodeError as exc:
        pytest.fail(
            f"Harness produced non-JSON output: {exc}\nstdout: {stdout}"
        )

    assert data.get("ok") is True, (
        f"Tunnel.Call(cr2=0) guard failed; "
        f"resultOk={data.get('resultOk')!r}, fault={data.get('fault')!r}, "
        f"message={data.get('message')!r}"
    )
    assert data.get("resultOk") is False, (
        f"Tunnel.Call(cr2=0) returned ok=True, expected ok=False"
    )
    assert data.get("fault") == "NO_CONTACT", (
        f"Tunnel.Call(cr2=0) fault={data.get('fault')!r}, expected 'NO_CONTACT'"
    )
