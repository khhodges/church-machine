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
)

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

NS_LUMP_SIZE   = 64
CATALOG_COUNT  = len(DEFAULT_ABSTRACTION_CATALOG)   # 47
CLIST_BASE     = NS_LUMP_SIZE - CATALOG_COUNT        # 64 - 47 = 17

KEYSTONE_SLOT  = 32
TUNNEL_SLOT    = 31

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
    """Keystone GT (NS c-list slot 32) has exactly E-permission and no others."""
    word = boot_words[CLIST_BASE + KEYSTONE_SLOT]
    perms = (word >> 25) & 0x7F   # bits [31:25]
    e_bit = (perms >> 5) & 1
    other = perms & ~(1 << 5)
    assert e_bit == 1,  f"E-bit not set in Keystone GT: 0x{word:08X}"
    assert other == 0,  f"Extra permission bits set in Keystone GT: perms=0b{perms:07b}"


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
    """Return NS[32] physAddr from the NS table in the boot image."""
    total         = 16384
    ns_table_base = total - 1024        # NS_TABLE_RESERVE = 1024
    base32        = ns_table_base + KEYSTONE_SLOT * 4   # 4 words per NS entry
    return boot_words[base32]


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
const KEYSTONE_NS = 32;
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

const KEYSTONE_NS    = 32;
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
};

const _methods = {};
const registry = {
    bindMethod(ns, name, fn) { _methods[`${ns}.${name}`] = fn; },
};

const sa = Object.create(SystemAbstractions.prototype);
sa.registry = registry;
sa._initKeystone();

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
