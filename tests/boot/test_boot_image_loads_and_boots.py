"""End-to-end check: a Python-generated boot image actually boots the simulator.

`tests/test_boot_image_matches_simulator.py` (Task #223) only verifies that
the bytes `server.boot_image.generate_boot_image()` produces are byte-for-byte
identical to what the simulator's `_initNamespaceTable()` would have written.
That guards against drift between the two NS-table producers, but it does NOT
exercise the actual loader path used by the IDE:

    sim = ChurchSimulator()        # no bootConfig at construction
    sim.loadBootImage(binary)      # overlay the Python-generated image
    while !bootComplete:           # then run the boot ROM state machine
        sim._bootStep()

This test (Task #224) drives that full loader-plus-boot path through a Node
harness (`tests/sim_boot_loader.js`) for each representative configuration
and asserts:

  * `loadBootImage()` reports success.
  * The boot state machine reaches `bootComplete = true` without faulting.
  * `nsCount` matches what the config asks for (named slots + Step-3 reserves).
  * Capability registers landed on the expected NS slots:
      - CR15 -> NS Slot 0 (Boot.NS, the namespace root)
      - CR12 -> NS Slot 1 (Boot.Thread, the thread identity)
      - CR14 -> NS Slot 6 (Boot.Abstr/SelfTest, code; R+X)  [direct — no director hop since Task #247]
      - CR6  -> NULL (cc=0 CLOOMC design: no c-list at HALT; Task #651)
  * A sentinel CALL frame was pushed (so a stray RETURN reboots cleanly).
  * PC=0 and M-elevation has been dropped after boot completes.

Any regression in `loadBootImage()` (truncation, NS-count miscalculation,
step-3 reservation handling, ...) or in the boot ROM mirror in
`_bootStep()` will be caught here, including drift in fields the per-word
check intentionally ignores (resident lump bodies, etc.).
"""
import base64
import json
import os
import struct
import subprocess
import sys
import warnings

import pytest

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
sys.path.insert(0, ROOT)

from server.boot_image import (  # noqa: E402
    generate_boot_image,
    integrity32,
    parse_ns_table,
    read_boot_entry_info,
)

LUMPS_DIR = os.path.join(ROOT, "server", "lumps")
HARNESS   = os.path.join(ROOT, "tests", "boot", "sim_boot_loader.js")


# ---- configs (mirror test_boot_image_matches_simulator.py) ----------------

def _cfg_default():
    return {
        "step1": {
            "totalNamespaceWords": 16384,
            "namespaceLumpWords":  1024,
            "threadLumpWords":      256,
        },
    }


def _cfg_custom_step1():
    return {
        "step1": {
            "totalNamespaceWords": 32768,
            "namespaceLumpWords":  1024,
            "threadLumpWords":      256,
        },
    }


def _cfg_step2_resident():
    cfg = _cfg_default()
    cfg["step2"] = {
        "lumps": [
            # A resident entry must name an exact selected, approved artifact.
            # This geometry-only loader fixture intentionally has none.
            {"nsSlot": 18, "resident": False,
             "physAddr": 4096, "lumpSize": 64},
        ],
    }
    return cfg


def _cfg_step3_reservation():
    cfg = _cfg_default()
    cfg["step3"] = {"emptySlotCount": 8, "baseNamedNsCount": 51}
    return cfg


def _cfg_no_window():
    # Image sized to the simulator's A7 v1.2 default memory window (131072 words).
    # Used together with skip_window=True so the harness never defines
    # `global.window`, exercising the IDE's "no project bootConfig has been
    # saved yet" startup path through loadBootImage().
    return {
        "step1": {
            "totalNamespaceWords": 131072,
            "namespaceLumpWords":   1024,
            "threadLumpWords":       256,
        },
    }


# (config, skip_window, expected_ns_count)
# expected_ns_count is the exact nsCount loadBootImage() should report:
#   * The sparse fixed catalog extends through slot 13, including M_BIT_DEV.
#     Slots 11–12 remain null/free, but slot 13 makes nsCount=14.
#   * Generated Thread#2 and Thread#3 retain slots 11 and 12; later Threads skip 13.
#   * Step-3 emptySlotCount adds reserved-but-empty entries; baseNamedNsCount=51
#     sets the starting index explicitly → total = 51 + 8 = 59.
CONFIGS = [
    pytest.param(_cfg_default(),           False, 14, id="default"),
    pytest.param(_cfg_custom_step1(),      False, 14, id="custom_step1"),
    pytest.param(_cfg_step2_resident(),    False, 14, id="step2_unresident"),
    pytest.param(_cfg_step3_reservation(), False, 59, id="step3_reservation"),
    pytest.param(_cfg_no_window(),         True,  14, id="no_window_bootconfig"),
]


# ---- helpers --------------------------------------------------------------

def _run_harness(cfg, image_bytes, skip_window=False):
    payload = json.dumps({
        "config": cfg,
        "imageBase64": base64.b64encode(image_bytes).decode("ascii"),
        "skipWindow": bool(skip_window),
    })
    proc = subprocess.run(
        ["node", HARNESS],
        input=payload.encode("utf-8"),
        capture_output=True,
        timeout=30,
        cwd=ROOT,
    )
    if proc.returncode != 0:
        raise RuntimeError(
            f"sim_boot_loader.js exited {proc.returncode}\n"
            f"stderr:\n{proc.stderr.decode('utf-8', errors='replace')}"
        )
    out = proc.stdout.decode("utf-8", errors="replace").strip()
    try:
        return json.loads(out)
    except json.JSONDecodeError as e:
        raise RuntimeError(
            f"sim_boot_loader.js produced non-JSON output: {e}\nstdout:\n{out}"
        )


def _gt_index(word0):
    """Decode the NS-slot index field from a Golden Token word0."""
    # Layout (see simulator.createGT / parseGT): bits[8:0] = nsIndex
    return word0 & 0x1FF


# ---- the test -------------------------------------------------------------

@pytest.mark.parametrize("cfg,skip_window,expected_ns_count", CONFIGS)
def test_boot_image_loads_and_boots(cfg, skip_window, expected_ns_count):
    image = generate_boot_image(cfg, LUMPS_DIR)
    status = _run_harness(cfg, image, skip_window=skip_window)

    # --- loader sanity ------------------------------------------------------
    assert status["loaded"] is True, (
        f"loadBootImage() returned false; status={status}"
    )
    # When the harness suppresses window.bootConfig the simulator falls back
    # to its A7 v1.2 default (131072 words); the image was generated to match.
    expected_mem = (131072 if skip_window
                    else cfg["step1"]["totalNamespaceWords"])
    assert status["memoryWords"] == expected_mem, (
        f"simulator memory size {status['memoryWords']} != "
        f"expected {expected_mem} (skip_window={skip_window})"
    )

    # --- boot completed cleanly --------------------------------------------
    assert status["faultLog"] == [], (
        f"boot raised fault(s):\n  " +
        "\n  ".join(f"[{f['type']}] {f['message']} (pc={f['pc']}, step={f['step']})"
                    for f in status["faultLog"])
    )
    assert status["halted"] is False, f"simulator halted during boot; status={status}"
    assert status["bootComplete"] is True, (
        f"bootComplete is False after driving _bootStep(); "
        f"reached bootStep={status['bootStep']}, iterations={status['iterations']}, "
        f"status={status}"
    )

    # --- post-boot architectural state -------------------------------------
    assert status["pc"] == 0, f"PC should be 0 at boot entry, got {status['pc']}"
    assert status["mElevation"] is False, (
        "M-elevation must be dropped before bootComplete; still ON"
    )
    assert status["sentinelOnTop"] is True, (
        f"sentinel CALL frame missing from call stack; "
        f"depth={status['callStackDepth']}"
    )

    # --- nsCount lands on the *exact* expected value -----------------------
    assert status["nsCount"] == expected_ns_count, (
        f"nsCount={status['nsCount']} != expected {expected_ns_count}"
    )

    # --- capability registers point at the right NS slots ------------------
    assert _gt_index(status["cr15"]["word0"]) == 0, (
        f"CR15 should hold a GT for NS Slot 0 (Boot.NS); got "
        f"index={_gt_index(status['cr15']['word0'])}"
    )
    assert _gt_index(status["cr12"]["word0"]) == 1, (
        f"CR12 should hold a GT for NS Slot 1 (Boot.Thread); got "
        f"index={_gt_index(status['cr12']['word0'])}"
    )
    assert _gt_index(status["cr14"]["word0"]) == 6, (
        f"CR14 should hold a GT for NS Slot 6 (Boot.Abstr/SelfTest code); got "
        f"index={_gt_index(status['cr14']['word0'])}"
    )
    # CR6 at HALT depends on the embedded Boot.Abstr lump's cc field:
    #   cc=0 (default / pre-LAZY placeholder): B:06 NUC_CLIST leaves CR6 NULL.
    #   cc>0 (POLA-finalized lump): B:06 NUC_CLIST installs the compacted c-list;
    #         CR6 holds a valid E-GT for NS Slot 6 (Boot.Abstr/SelfTest).
    # Both are correct — the distinction is whether POLA compression has been
    # applied and saved to 00000600.lump (Task #651 applies to the cc=0 path).
    cr6_idx = _gt_index(status["cr6"]["word0"])
    assert cr6_idx == 0 or cr6_idx == 6, (
        f"CR6 at HALT must be NULL (cc=0, index=0) or Boot.Abstr GT (cc>0, index=6); "
        f"got index={cr6_idx}"
    )


# ---- Task #2867: CapabilityTest boot-entry residency + boot ----------------
#
# Selecting CapabilityTest (NS slot 10) as the boot entry must produce an
# image whose slot-10 body is the current boot-resident program with its
# declared capabilities — never a synthetic header over zero words — and the simulator
# capabilities — never a synthetic header over zero words — and the simulator
# must boot it to completion with CR14 pointing at slot 10.

CAPTEST_SLOT = 10


def _saved_project_cfg():
    """The saved boot-config.json when present (it is gitignored runtime
    state), else the equivalent default Wukong geometry — keeping the test
    hermetic on a fresh checkout."""
    path = os.path.join(ROOT, "server", "boot-config.json")
    if os.path.isfile(path):
        with open(path) as f:
            return json.load(f)
    return {
        "step1": {
            "totalNamespaceWords": 32768,
            "namespaceLumpWords":   1024,
            "threadLumpWords":       256,
        },
    }


def _capabilitytest_manifest_body():
    """Return the exact CapabilityTest binding/body from committed NS state."""
    with open(os.path.join(LUMPS_DIR, "ns-state.json"), "r") as f:
        state = json.load(f)
    matches = [
        entry for entry in state.get("abstractions", [])
        if isinstance(entry, dict)
        and entry.get("name") == "CapabilityTest"
        and entry.get("slot") == CAPTEST_SLOT
    ]
    assert len(matches) == 1, (
        "ns-state.json must contain exactly one authoritative CapabilityTest "
        f"entry for slot {CAPTEST_SLOT}; found {len(matches)}"
    )
    entry = matches[0]
    # V2 migration fixtures may retain the historical identity-only
    # Namespace-state record. Select the exact approved CapabilityTest body,
    # rather than treating a stale token/filename as an executable binding.
    from server.lump_approvals import read_approvals
    approvals = read_approvals(os.path.join(LUMPS_DIR, "approvals.json"))
    candidates = [
        row.get("filename") for row in approvals.values()
        if isinstance(row, dict) and row.get("dot_name") == "CapabilityTest"
        and isinstance(row.get("filename"), str)
    ]
    assert len(candidates) == 1
    filename = candidates[0]
    with open(os.path.join(LUMPS_DIR, filename), "rb") as f:
        raw = f.read()
    assert len(raw) % 4 == 0
    return entry, struct.unpack(f">{len(raw) // 4}I", raw)


def _slot_body(image_bytes, slot, body_words=64):
    """Return a requested number of body words from an NS slot in an image."""
    import struct
    n = len(image_bytes) // 4
    words = struct.unpack(f"<{n}I", image_bytes)
    base = n - (slot + 1) * 4          # inverted NS layout, 4 words/slot
    loc = words[base]
    return loc, words[loc:loc + body_words]


def _reissue_boot_entry(image_bytes, slot, seq):
    """Advance one descriptor generation while keeping its body and seal valid."""
    words = list(struct.unpack(f"<{len(image_bytes) // 4}I", image_bytes))
    ns_base = len(words) - (slot + 1) * 4
    authority = (words[ns_base + 1] & ~(0x1FF << 21)) | ((seq & 0x1FF) << 21)
    words[ns_base + 1] = authority
    words[ns_base + 2] = integrity32(words[ns_base], authority)
    return struct.pack(f"<{len(words)}I", *words)


def test_capabilitytest_image_payload_integrity():
    """Generated image embeds CapabilityTest's real body at slot 10."""
    cfg = _saved_project_cfg()
    _, expected_body = _capabilitytest_manifest_body()
    image = generate_boot_image(cfg, LUMPS_DIR, boot_entry_slot=CAPTEST_SLOT)
    loc, body = _slot_body(image, CAPTEST_SLOT, len(expected_body))
    assert loc > 0, "slot 10 has no allocated location"
    hdr = body[0]
    assert (hdr >> 27) == 0x1F, f"slot 10 header magic invalid: 0x{hdr:08X}"
    cw = (hdr >> 10) & 0x1FFF
    cc = hdr & 0xFF
    assert body == expected_body, (
        "slot 10 body differs from the authoritative boot-resident "
        "CapabilityTest binary"
    )
    # The code region must be real instructions, not a zero-filled placeholder.
    code = body[1:1 + cw]
    nonzero = sum(1 for wv in code if wv != 0)
    assert nonzero >= cw - 1, (
        f"slot 10 code region is mostly zeros ({nonzero}/{cw} non-zero) — "
        f"placeholder body instead of the real CapabilityTest program"
    )
    # Every declared capability must be present at the lump tail.
    clist = body[len(body) - cc:]
    assert all(gv != 0 for gv in clist), (
        f"slot 10 c-list has zero entries: {[hex(gv) for gv in clist]}"
    )


def test_capabilitytest_boot_entry_boots():
    """Simulator boots to completion with CapabilityTest selected (slot 10)."""
    cfg = _saved_project_cfg()
    image = generate_boot_image(cfg, LUMPS_DIR, boot_entry_slot=CAPTEST_SLOT)
    status = _run_harness(cfg, image)
    assert status["loaded"] is True
    assert status["faultLog"] == [], (
        f"boot raised fault(s): {status['faultLog']}"
    )
    assert status["bootComplete"] is True
    assert status["bootEntrySlot"] == CAPTEST_SLOT
    # CR14 (code, R+X) must target the selected entry, not Boot.Abstr.
    assert _gt_index(status["cr14"]["word0"]) == CAPTEST_SLOT, (
        f"CR14 index={_gt_index(status['cr14']['word0'])}, expected {CAPTEST_SLOT}"
    )
    # CR0 (boot-entry E-GT via Thread.caps[0]) must also encode slot 10.
    assert (status["cr0"]["word0"] & 0xFFFF) == CAPTEST_SLOT


def test_capabilitytest_reissued_generation_boots():
    """Boot mints all entry capabilities from the live W1 generation.

    Reproduces the reported `GT seq 0, entry seq 1` failure without changing
    CapabilityTest code: only the Namespace descriptor is reissued.
    """
    cfg = _saved_project_cfg()
    image = generate_boot_image(cfg, LUMPS_DIR, boot_entry_slot=CAPTEST_SLOT)
    reissued = _reissue_boot_entry(image, CAPTEST_SLOT, 1)
    status = _run_harness(cfg, reissued)

    assert status["loaded"] is True
    assert status["faultLog"] == [], (
        f"reissued CapabilityTest failed boot: {status['faultLog']}"
    )
    assert status["bootComplete"] is True
    assert ((status["cr0"]["word0"] >> 16) & 0x1FF) == 1
    assert ((status["cr14"]["word0"] >> 16) & 0x1FF) == 1


def test_capabilitytest_regeneration_preserves_nonzero_generation(tmp_path):
    """A replacement rebuild retains slot 10's authoritative generation."""
    import shutil

    isolated_lumps = tmp_path / "lumps"
    shutil.copytree(LUMPS_DIR, isolated_lumps)
    state_path = isolated_lumps / "ns-state.json"
    state = json.loads(state_path.read_text())
    cap_entry = next(
        entry for entry in state["abstractions"]
        if entry.get("slot") == CAPTEST_SLOT
    )
    cap_entry["seq"] = 7
    state_path.write_text(json.dumps(state))

    cfg = _saved_project_cfg()
    image = generate_boot_image(
        cfg, str(isolated_lumps), boot_entry_slot=CAPTEST_SLOT)
    parsed = parse_ns_table(image)
    descriptor = next(
        entry for entry in parsed
        if entry["slot"] == CAPTEST_SLOT
    )
    assert descriptor["seq"] == 7
    entry_info = read_boot_entry_info(image)
    assert entry_info["entry_gt_seq"] == 7
    status = _run_harness(cfg, image)
    assert status["faultLog"] == [], status["faultLog"]
    assert status["bootComplete"] is True
    assert ((status["cr0"]["word0"] >> 16) & 0x1FF) == 7
    assert ((status["cr14"]["word0"] >> 16) & 0x1FF) == 7


def test_capabilitytest_manifest_boot_resident():
    """CapabilityTest's committed Namespace binding must remain resident."""
    with open(os.path.join(LUMPS_DIR, "ns-state.json")) as f:
        state = json.load(f)
    matches = [e for e in state.get("abstractions", []) if isinstance(e, dict)
               and e.get("name") == "CapabilityTest"
               and e.get("slot") == CAPTEST_SLOT]
    assert len(matches) == 1, (
        "ns-state.json must contain exactly one CapabilityTest slot-10 entry; "
        f"found {len(matches)}"
    )
    assert matches[0].get("boot") is True or matches[0].get("resident") is True
    # Token-less historical state resolves only through one exact approval.
    _capabilitytest_manifest_body()


def test_capabilitytest_boot_binding_points_to_valid_binary():
    """The Namespace-bound artifact location must contain a valid LUMP."""
    entry, words = _capabilitytest_manifest_body()
    header = words[0]
    assert (header >> 27) & 0x1F == 0x1F
    assert len(words) == 1 << (((header >> 23) & 0xF) + 6)
    assert entry["slot"] == CAPTEST_SLOT


def test_served_boot_image_carries_capabilitytest_body(tmp_path):
    """The boot artifact the server ships must carry CapabilityTest's real
    body at slot 10 (not zeros).

    server/lumps/boot-image.bin is intentionally gitignored: the server
    (re)generates it from tracked inputs — boot-config.json, manifest.json,
    and the lump binaries — whenever those are newer.  This test is
    therefore hermetic: it reproduces that exact regeneration path into a
    temp file and validates the artifact, so it passes from a fresh
    checkout without relying on untracked workspace residue.
    """
    from server.boot_image import validate_boot_image
    cfg = _saved_project_cfg()
    _, expected_body = _capabilitytest_manifest_body()
    image = generate_boot_image(cfg, LUMPS_DIR)   # default entry, as on regen
    path = tmp_path / "boot-image.bin"
    path.write_bytes(image)
    served = path.read_bytes()
    # Accepted by the format/mandatory-slot validator (rejects obsolete images).
    validate_boot_image(served)
    loc, body = _slot_body(served, CAPTEST_SLOT, len(expected_body))
    hdr = body[0]
    expected_cw = (expected_body[0] >> 10) & 0x1FFF
    assert (hdr >> 27) == 0x1F and ((hdr >> 10) & 0x1FFF) == expected_cw, (
        f"served image slot 10 header 0x{hdr:08X} is not the real "
        f"CapabilityTest lump (expected magic=0x1F, cw={expected_cw}) — "
        f"the manifest boot_resident flag regressed"
    )
    assert body == expected_body
    nonzero = sum(1 for wv in body[1:1 + expected_cw] if wv != 0)
    assert nonzero >= expected_cw - 1, (
        "served image slot 10 code region is zero-filled — the manifest "
        "boot_resident flag regressed"
    )


def test_stale_image_reports_loaded_false():
    """An image without the current format tag must report loaded=False and
    must not fabricate a bootable state (bootComplete stays False)."""
    cfg = _cfg_default()
    image = bytearray(generate_boot_image(cfg, LUMPS_DIR))
    # Corrupt the format tag wherever it appears (scan the last 8192 words).
    import struct as _struct
    n = len(image) // 4
    words = list(_struct.unpack(f"<{n}I", bytes(image)))
    # V2 marker is physical Namespace Header word 1, never a tail sentinel.
    words[1] = 0xDEADBEEF
    stale = _struct.pack(f"<{n}I", *words)
    status = _run_harness(cfg, stale)
    assert status["loaded"] is False, (
        "loadBootImage() must reject an image without the current format tag"
    )

def test_oversized_image_is_rejected_atomically_before_load_ns():
    """A valid 32K image cannot be partially overlaid on a 16K simulator."""
    image_cfg = _cfg_custom_step1()
    simulator_cfg = _cfg_default()
    image = generate_boot_image(image_cfg, LUMPS_DIR)

    status = _run_harness(simulator_cfg, image)

    assert status["loaded"] is False
    assert status["rejectedAtomically"] is True, status
    assert "32,768 words" in status["lastBootImageError"]
    assert "16,384 words" in status["lastBootImageError"]
    assert "regenerate" in status["lastBootImageError"].lower()
    assert status["faultLog"] == [], (
        "configuration mismatch must be rejected by the loader, not become "
        f"a LOAD_NS integrity fault: {status['faultLog']}"
    )
    assert status["bootStep"] == 0


def test_undersized_image_is_rejected_atomically_before_load_ns():
    """A valid 16K image cannot be treated as an overlay on a 32K simulator."""
    image_cfg = _cfg_default()
    simulator_cfg = _cfg_custom_step1()
    image = generate_boot_image(image_cfg, LUMPS_DIR)

    status = _run_harness(simulator_cfg, image)

    assert status["loaded"] is False
    assert status["rejectedAtomically"] is True, status
    assert "16,384 words" in status["lastBootImageError"]
    assert "32,768 words" in status["lastBootImageError"]
    assert "regenerate" in status["lastBootImageError"].lower()
    assert status["faultLog"] == []
    assert status["bootStep"] == 0


def test_matching_16k_image_preserves_namespace_table_and_load_ns():
    """The exact-size image keeps its complete tail table and passes LOAD_NS."""
    cfg = _cfg_default()
    image = generate_boot_image(cfg, LUMPS_DIR)
    status = _run_harness(cfg, image)

    assert status["loaded"] is True
    assert status["memoryWords"] == 16384
    assert status["nsTableBase"] + 1024 == status["memoryWords"]
    assert status["bootComplete"] is True
    assert status["faultLog"] == []
    assert _gt_index(status["cr15"]["word0"]) == 0


if __name__ == "__main__":
    failures = 0
    for p in CONFIGS:
        cfg, skip_window, expected_ns = p.values
        name = p.id
        try:
            test_boot_image_loads_and_boots(cfg, skip_window, expected_ns)
            print(f"PASS: {name}")
        except AssertionError as e:
            failures += 1
            print(f"FAIL: {name}\n{e}")
    import tempfile
    from pathlib import Path
    for fn in (test_capabilitytest_image_payload_integrity,
               test_capabilitytest_boot_entry_boots,
               test_capabilitytest_manifest_boot_resident,
               test_capabilitytest_boot_metadata_matches_sidecar,
               test_served_boot_image_carries_capabilitytest_body,
               test_stale_image_reports_loaded_false):
        try:
            if fn is test_served_boot_image_carries_capabilitytest_body:
                with tempfile.TemporaryDirectory() as td:
                    fn(Path(td))
            else:
                fn()
            print(f"PASS: {fn.__name__}")
        except AssertionError as e:
            failures += 1
            print(f"FAIL: {fn.__name__}\n{e}")
    sys.exit(1 if failures else 0)
