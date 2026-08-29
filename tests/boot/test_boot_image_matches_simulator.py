"""Verify the Python-generated boot image matches what the simulator computes.

For each representative boot config:

  1. `server.boot_image.generate_boot_image()` produces a raw 32-bit LE
     binary image of the namespace memory window.
  2. The same config is fed via stdin to `tests/sim_init_dump.js`, which
     instantiates `ChurchSimulator` headlessly under Node — that runs
     `reset()` → `_initNamespaceTable()` and dumps `memory[]` to stdout
     as raw little-endian bytes.
  3. The two byte streams are compared word-by-word. Any mismatch fails
     with a diff that names the offending word index, NS-table slot, and
     foundation region (Boot.NS / Boot.Thread / Boot.Abstr / NS table).

This guards against silent drift between the Python boot-image producer
(canonical) and the simulator's hardcoded init path (fallback) — see
`server/boot_image.py` docstring and `simulator/simulator.js`
`_initNamespaceTable()`.

Configurations exercised:

  * `default`           — historical demo defaults (16384 ns words)
  * `custom_step1`      — custom thread / abstraction lump sizes
  * `step2_resident`    — Step-2 resident lump with a physAddr override
  * `step3_reservation` — Step-3 empty NS slot reservations
"""
import json
import os
import struct
import subprocess
import sys

import pytest

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
sys.path.insert(0, ROOT)

from server.boot_image import (  # noqa: E402
    BOOT_ABSTR_NS_SLOT,
    NS_ENTRY_WORDS,
    NS_TABLE_RESERVE,
    create_gt,
    generate_boot_image,
    generated_thread_slots,
    parse_ns_table_raw,
)
from hardware.thread_design import (  # noqa: E402
    THREAD_CAPS_OFFSET,
    THREAD_STO_OFFSET,
)

LUMPS_DIR = os.path.join(ROOT, "server", "lumps")
HARNESS   = os.path.join(ROOT, "tests", "boot", "sim_init_dump.js")


# ---- configs ---------------------------------------------------------------

def _cfg_default():
    return {
        "step1": {
            "totalNamespaceWords": 16384,
            "namespaceLumpWords":  1024,
            "threadLumpWords":      256,
        },
    }


def _cfg_custom_step1():
    # Larger thread lump; verifies the lump-header n_minus_6 computation is
    # driven by threadLumpWords (not hardcoded). Boot.Abstr is always 64w
    # default (Task #568); abstractionLumpWords is deprecated and ignored.
    return {
        "step1": {
            "totalNamespaceWords": 32768,
            "namespaceLumpWords":  1024,
            "threadLumpWords":      512,
        },
    }


def _cfg_step2_resident():
    cfg = _cfg_default()
    cfg["step2"] = {
        "lumps": [
            {"nsSlot": 18, "resident": True,
             "physAddr": 4096, "lumpSize": 64},
        ],
    }
    return cfg


def _cfg_step3_reservation():
    cfg = _cfg_default()
    cfg["step3"] = {"emptySlotCount": 8, "baseNamedNsCount": 51}
    return cfg


def _cfg_generated_threads(count):
    cfg = _cfg_default()
    cfg["step1"]["threadCount"] = count
    return cfg


CONFIGS = [
    pytest.param(_cfg_default(),           id="default"),
    pytest.param(_cfg_custom_step1(),      id="custom_step1"),
    pytest.param(_cfg_generated_threads(2), id="generated_threads_2"),
    pytest.param(_cfg_generated_threads(5), id="generated_threads_5"),
    pytest.param(_cfg_step2_resident(),    id="step2_resident"),
    pytest.param(_cfg_step3_reservation(), id="step3_reservation"),
]


# ---- helpers --------------------------------------------------------------

BOOT_ABSTR_DEFAULT_SIZE  = 64  # Boot.Abstr default size when no saved lump (Task #568)

def _region_of(word_index, total_words, ns_size, thread_size, entry_size):
    """Human-readable name for the foundation region containing word_index.

    A7 v1.2 layout: Thread LUMP at word 0; Boot.Abstr immediately after Thread;
    NS TABLE at NS_TABLE_BASE = total_words - NS_TABLE_RESERVE.
    """
    ns_table_base = total_words - NS_TABLE_RESERVE
    if word_index >= ns_table_base:
        # Slots count down from the top: slot 0 at top-4, slot N at top-(N+1)*4.
        r = total_words - 1 - word_index   # 0-indexed distance from top word
        slot  = r // NS_ENTRY_WORDS
        k     = NS_ENTRY_WORDS - 1 - (r % NS_ENTRY_WORDS)
        field = ["word0_location", "word1_limits", "word2_seals", "word3_cache_token"][k]
        return f"NS table slot {slot} ({field})"
    if word_index < thread_size:
        return "Boot.Thread lump"
    boot_abstr_end = thread_size + entry_size
    if word_index < boot_abstr_end:
        return "Boot.Abstr lump (slot 6)"
    return "resident / free region"


def _run_simulator(cfg):
    """Invoke the Node harness; return memory[] as a list of 32-bit ints."""
    proc = subprocess.run(
        ["node", HARNESS],
        input=json.dumps(cfg).encode("utf-8"),
        capture_output=True,
        timeout=30,
        cwd=ROOT,
    )
    if proc.returncode != 0:
        raise RuntimeError(
            f"sim_init_dump.js exited {proc.returncode}\n"
            f"stderr:\n{proc.stderr.decode('utf-8', errors='replace')}"
        )
    raw = proc.stdout
    n = len(raw) // 4
    return list(struct.unpack(f"<{n}I", raw[: n * 4]))


def _resident_body_ranges(cfg):
    """Return [(start_word, end_word_exclusive), ...] for resident lump bodies.

    `_initNamespaceTable` does NOT load resident lump bodies — that happens
    later via `eagerInstallResident()` / `lazyLoad()`. The Python boot
    image bakes them in at generation time, so those word ranges are
    expected to differ and must be excluded from the per-word comparison.
    The NS-table entries that point at those bodies ARE compared.
    """
    out = []
    step2 = cfg.get("step2") if isinstance(cfg.get("step2"), dict) else None
    if not step2:
        return out
    for e in step2.get("lumps") or []:
        if not (isinstance(e, dict) and e.get("resident")):
            continue
        phys = int(e.get("physAddr") or 0)
        size = int(e.get("lumpSize") or 0)
        if phys > 0 and size > 0:
            out.append((phys, phys + size))
    return out


def _compare(py_bytes, sim_words, cfg, extra_skips=None):
    step1 = cfg["step1"]
    total       = step1["totalNamespaceWords"]
    ns_size     = step1["namespaceLumpWords"]
    thread_size = step1["threadLumpWords"]
    # Boot.Abstr is always the 64w default when no saved lump (tmp_path used here).
    abstr_size  = BOOT_ABSTR_DEFAULT_SIZE

    assert len(py_bytes) == total * 4, (
        f"Python image length {len(py_bytes)} bytes != expected {total * 4}"
    )
    assert len(sim_words) == total, (
        f"simulator memory length {len(sim_words)} words != expected {total}"
    )

    py_words = list(struct.unpack(f"<{total}I", py_bytes))
    skip_ranges = _resident_body_ranges(cfg) + (extra_skips or [])

    def _skip(i):
        for s, e in skip_ranges:
            if s <= i < e:
                return True
        return False

    diffs = []
    for i, (a, b) in enumerate(zip(py_words, sim_words)):
        if a != b and not _skip(i):
            diffs.append((i, a, b))
            if len(diffs) >= 20:
                break

    if diffs:
        lines = [
            f"{len(diffs)}+ word(s) differ between server/boot_image.py and simulator._initNamespaceTable():"
        ]
        for i, py, sim in diffs:
            region = _region_of(i, total, ns_size, thread_size, abstr_size)
            lines.append(
                f"  word[0x{i:05X}]  py=0x{py:08X}  sim=0x{sim:08X}  ({region})"
            )
        raise AssertionError("\n".join(lines))


# ---- the test -------------------------------------------------------------

def _write_synthetic_boot_abstr_lump(lumps_dir, lump_size=64, cw=3, cc=0):
    """Write a minimal synthetic Boot.Abstr lump and a companion manifest to lumps_dir.

    The lump has a valid header (magic=0x1F, n_minus_6, cw, cc=0) and
    zeros everywhere else — matching what the JS simulator's
    _initNamespaceTable() produces at the boot entry slot when the
    direct-dispatch path is active (no trampoline written, just the
    header word).

    A minimal manifest.json is written alongside so that
    find_lump_file_by_abstraction() can locate the lump by abstraction
    name ("SelfTest") rather than by the legacy token-encoded path.
    """
    import math
    n_minus_6 = max(0, int(math.ceil(math.log2(lump_size))) - 6)
    hdr = (0x1F << 27) | (n_minus_6 << 23) | (cw << 10) | cc
    words = [0] * lump_size
    words[0] = hdr
    from server.boot_image import BOOT_ABSTR_NS_SLOT
    lump_token = f"{BOOT_ABSTR_NS_SLOT << 8:08x}"
    lump_name = f"{lump_token}.lump"
    lump_path = os.path.join(lumps_dir, lump_name)
    with open(lump_path, "wb") as f:
        f.write(struct.pack(f">{lump_size}I", *words))
    # Write a minimal manifest so find_lump_file_by_abstraction() resolves
    # "SelfTest" at BOOT_ABSTR_NS_SLOT.  No 'filename' field → falls back to
    # the token-named file written above.
    manifest_path = os.path.join(lumps_dir, "manifest.json")
    if not os.path.isfile(manifest_path):
        with open(manifest_path, "w") as _mf:
            json.dump([{
                "token": lump_token,
                "abstraction": "SelfTest",
                "ns_slot": BOOT_ABSTR_NS_SLOT,
                "ns_slot_policy": "static",
                "boot_resident": True,
            }], _mf)
    with open(os.path.join(lumps_dir, "ns-state.json"), "w") as _sf:
        json.dump({
            "abstractions": [{
                "name": "SelfTest",
                "slot": BOOT_ABSTR_NS_SLOT,
                "token": lump_token,
            }]
        }, _sf)
    return lump_path, lump_size


def _boot_entry_body_range(cfg):
    """Return (start_word, end_word_exclusive) for the Boot.Abstr lump body.

    A7 v1.2: Boot.Abstr starts immediately after Thread at word thread_size.
    The JS simulator's _initNamespaceTable() writes zeros at this range
    (no lump content), while the Python generator embeds a synthetic lump.
    The range must be excluded from the parity comparison.
    """
    step1       = cfg["step1"]
    thread_size = step1["threadLumpWords"]
    start       = thread_size                    # A7 v1.2: Boot.Abstr at thread_size (not ns_size+thread_size)
    end         = start + BOOT_ABSTR_DEFAULT_SIZE
    return (start, end)


@pytest.mark.parametrize("cfg", CONFIGS)
def test_boot_image_matches_simulator(cfg, tmp_path):
    # Write a minimal synthetic Boot.Abstr lump into tmp_path so that
    # generate_boot_image() succeeds (the direct-dispatch model requires the
    # real SelfTest lump; we use a synthetic stand-in here).
    # The JS simulator now writes the same minimal lump header at the boot
    # entry slot body (via _initNamespaceTable), so no extra_skips needed.
    _write_synthetic_boot_abstr_lump(str(tmp_path))

    py_bytes  = generate_boot_image(cfg, str(tmp_path))
    sim_words = _run_simulator(cfg)
    _compare(py_bytes, sim_words, cfg)


@pytest.mark.parametrize("count", [1, 2, 5])
def test_generated_thread_namespace_entries_have_stable_slots_and_boot_cr0(count, tmp_path):
    """Thread#2 onward are resident, named NS entries with Thread.1's CR0."""
    _write_synthetic_boot_abstr_lump(str(tmp_path))
    cfg = _cfg_generated_threads(count)
    image = generate_boot_image(cfg, str(tmp_path))
    raw = parse_ns_table_raw(image)
    assert raw is not None
    assert raw["thread"]["count"] == count

    entries = {row["slot"]: row for row in raw["entries"]}
    expected_slots = generated_thread_slots(count)
    assert all(slot in entries for slot in range(11))
    assert tuple(slot for slot in entries if slot >= 11) == expected_slots

    # N=1 remains the historical 11-entry layout.  Generated threads begin
    # immediately after the final catalog body and remain physically contiguous.
    if count == 1:
        assert 11 not in entries
        return

    expected_cr0 = create_gt(0, BOOT_ABSTR_NS_SLOT, {"E": 1}, 1)
    previous_location = entries[10]["w0"] + 64
    thread_size = cfg["step1"]["threadLumpWords"]
    for slot in expected_slots:
        location = entries[slot]["w0"]
        assert location == previous_location
        assert entries[slot]["w1"] & 0x1FFFF == thread_size - 1
        header = struct.unpack_from("<I", image, location * 4)[0]
        assert (header >> 27) & 0x1F == 0x1F
        assert ((header >> 8) & 0x3) == 2
        cr0 = struct.unpack_from("<I", image, (location + THREAD_CAPS_OFFSET) * 4)[0]
        assert cr0 == expected_cr0
        previous_location = location + thread_size


def test_generated_thread_slot_collision_and_capacity_are_rejected(tmp_path):
    _write_synthetic_boot_abstr_lump(str(tmp_path))
    cfg = _cfg_generated_threads(2)
    cfg["step2"] = {"lumps": [{
        "nsSlot": 11, "resident": True, "physAddr": 4096, "lumpSize": 64,
    }]}
    with pytest.raises(ValueError, match=r"slot 11 is reserved"):
        generate_boot_image(cfg, str(tmp_path))

    cfg = _cfg_generated_threads(2)
    cfg["step1"]["nsSlotsMax"] = 11
    with pytest.raises(ValueError, match=r"requires generated Thread slots through 11"):
        generate_boot_image(cfg, str(tmp_path))


def test_generated_thread_body_overlap_and_nondefault_boot_entry_are_rejected_or_preserved(tmp_path):
    """Thread bodies cannot be clobbered and retain the selected entry target."""
    _write_synthetic_boot_abstr_lump(str(tmp_path))
    colliding = _cfg_generated_threads(2)
    colliding["step2"] = {"lumps": [{
        "nsSlot": 16, "resident": True, "physAddr": 640, "lumpSize": 256,
    }]}
    with pytest.raises(ValueError, match=r"overlaps the fixed boot and generated Thread region"):
        generate_boot_image(colliding, str(tmp_path))

    image = generate_boot_image(_cfg_generated_threads(5), str(tmp_path), boot_entry_slot=7)
    entries = {row["slot"]: row for row in parse_ns_table_raw(image)["entries"]}
    expected = create_gt(0, 7, {"E": 1}, 1)
    for slot in generated_thread_slots(5):
        location = entries[slot]["w0"]
        assert struct.unpack_from("<I", image, (location + THREAD_CAPS_OFFSET) * 4)[0] == expected


def test_default_thread_count_remains_byte_compatible(tmp_path):
    """The pre-feature default omits threadCount and must remain unchanged."""
    _write_synthetic_boot_abstr_lump(str(tmp_path))
    legacy = _cfg_default()
    explicit_single = _cfg_default()
    explicit_single["step1"]["threadCount"] = 1
    assert generate_boot_image(legacy, str(tmp_path)) == generate_boot_image(
        explicit_single, str(tmp_path))


def test_generated_threads_use_fixed_stack_boundary(tmp_path):
    """Every generated Thread must use fixed private-ABI stack geometry."""
    _write_synthetic_boot_abstr_lump(str(tmp_path))
    cfg = _cfg_generated_threads(3)
    cfg["step1"]["threadLumpWords"] = 512
    generated = generate_boot_image(cfg, str(tmp_path))
    step1 = cfg["step1"]
    total = int(step1["totalNamespaceWords"])
    assert len(generated) == total * 4
    words = struct.unpack(f"<{total}I", generated)
    thread_count = int(step1.get("threadCount") or 1)
    slots = [1, *generated_thread_slots(thread_count)]
    expected_boundary = THREAD_CAPS_OFFSET - 1
    retired_tail_relative_boundary = int(step1["threadLumpWords"]) - 13
    assert THREAD_STO_OFFSET == 17
    assert expected_boundary == 0xF3
    assert retired_tail_relative_boundary == 0x1F3

    for slot in slots:
        ns_base = total - (slot + 1) * NS_ENTRY_WORDS
        thread_loc = words[ns_base]
        actual_boundary = words[thread_loc + THREAD_STO_OFFSET]
        assert actual_boundary == expected_boundary, (
            f"NS slot {slot} Thread boundary at +"
            f"{THREAD_STO_OFFSET} is 0x{actual_boundary:08X}; "
            f"expected fixed +243 (0x{expected_boundary:08X})"
        )


def test_committed_ns_state_names_generated_threads_from_image_count(tmp_path, monkeypatch):
    """Committed inspection exposes generated slots with their stable pet names."""
    _write_synthetic_boot_abstr_lump(str(tmp_path))
    image_path = tmp_path / "boot-image.bin"
    image_path.write_bytes(generate_boot_image(_cfg_generated_threads(5), str(tmp_path)))

    from server import app as server_app
    monkeypatch.setattr(server_app, "BOOT_IMAGE_PATH", str(image_path))
    monkeypatch.setattr(server_app, "LUMPS_DIR", str(tmp_path))
    monkeypatch.setattr(server_app, "BOOT_CONFIG_PATH", str(tmp_path / "missing-config.json"))
    monkeypatch.setattr(server_app, "BOOT_CONFIG_LEGACY_PATH", str(tmp_path / "missing-legacy.json"))

    entries = server_app._derive_ns_state_entries()
    names = {entry["slot"]: entry["name"] for entry in entries}
    assert {slot: names[slot] for slot in generated_thread_slots(5)} == {
        11: "Thread#2", 12: "Thread#3", 13: "Thread#4", 14: "Thread#5",
    }


# ---- saved-lump path tests -------------------------------------------------

def _make_boot_abstr_lump(lump_size, cc, nuc_code_words=3, demo_clist_size=18):
    """Synthesise a valid big-endian Boot.Abstr .lump file of `lump_size` words.

    The header encodes: magic=0x1F, n_minus_6, cw=nuc_code_words, typ=0, cc.
    The last `cc` words are non-zero sentinel GTs; everything else is zero.
    """
    import math
    n_minus_6 = max(0, int(math.ceil(math.log2(lump_size))) - 6)
    hdr = (0x1F << 27) | ((n_minus_6 & 0xF) << 23) | ((nuc_code_words & 0x1FFF) << 10) | (cc & 0xFF)
    words = [0] * lump_size
    words[0] = hdr
    # Fill code region (words 1..nuc_code_words) with placeholder instruction
    for i in range(nuc_code_words):
        words[1 + i] = 0x07000000  # LOAD no-op placeholder
    # Fill c-list tail with non-zero sentinels
    for i in range(cc):
        words[lump_size - cc + i] = 0x04000000 | (i & 0xFF)  # sentinel GT
    return struct.pack(f">{lump_size}I", *words)


@pytest.mark.parametrize("lump_size,cc", [
    (64,  0),   # 64w with cc=0 (CLOOMC design: no c-list, CHANGE→TPERM→CALL)
    (128, 0),   # 128w with cc=0 (larger lump, no c-list)
])
def test_boot_image_places_saved_lump(tmp_path, lump_size, cc):
    """generate_boot_image() places a valid saved Boot.Abstr lump at Boot.Abstr's slot.

    The saved lump filename is derived from BOOT_ABSTR_NS_SLOT: f"{BOOT_ABSTR_NS_SLOT<<8:08x}.lump"
    (e.g. "00000600.lump" when BOOT_ABSTR_NS_SLOT=6).

    Verifies:
      - Boot.Abstr NS table entry (word0) points to the correct physical address.
      - The NS table word1 encodes the correct limit17 (lump_size - cc - 1)
        and clist_count (= cc).
      - The lump header at that address round-trips (n_minus_6, cw, cc).
    """
    from server.boot_image import (
        generate_boot_image, NS_TABLE_RESERVE, NS_ENTRY_WORDS,
        BOOT_ABSTR_NS_SLOT, DEMO_CLIST_SIZE,
        pack_ns_word1,
    )

    # Write a synthetic saved lump into tmp_path using the token-named filename
    # and a companion manifest so find_lump_file_by_abstraction() resolves it.
    saved_bytes = _make_boot_abstr_lump(lump_size, cc)
    saved_token    = f"{BOOT_ABSTR_NS_SLOT << 8:08x}"
    saved_filename = f"{saved_token}.lump"
    saved_path = tmp_path / saved_filename
    saved_path.write_bytes(saved_bytes)
    # Manifest without 'filename' field: find_lump_file_by_abstraction() falls
    # back to the token-named file written above.
    manifest_path = tmp_path / "manifest.json"
    if not manifest_path.exists():
        manifest_path.write_text(json.dumps([{
            "token": saved_token,
            "abstraction": "SelfTest",
            "ns_slot": BOOT_ABSTR_NS_SLOT,
            "ns_slot_policy": "static",
            "boot_resident": True,
        }]))
    (tmp_path / "ns-state.json").write_text(json.dumps({
        "abstractions": [{
            "name": "SelfTest",
            "slot": BOOT_ABSTR_NS_SLOT,
            "token": saved_token,
        }]
    }))

    cfg = {
        "step1": {
            "totalNamespaceWords": 16384,
            "namespaceLumpWords":     64,
            "threadLumpWords":       256,
        },
    }
    img = generate_boot_image(cfg, str(tmp_path))
    total = 16384
    words = list(struct.unpack(f"<{total}I", img))
    # NS table slot 3 word0 = physical location (count-down: slot N at total-(N+1)*4)
    ns_base  = total - (BOOT_ABSTR_NS_SLOT + 1) * NS_ENTRY_WORDS
    boot_loc = words[ns_base]

    # Expected physical address: A7 v1.2 — Boot.Abstr starts immediately after Thread.
    # Thread is at word 0 with size 256, so Boot.Abstr base = 256.
    # (Old v1.1 formula was ns_size + thread_size = 64 + 256.)
    thread_size = cfg["step1"]["threadLumpWords"]
    expected_loc = thread_size
    assert boot_loc == expected_loc, (
        f"Boot.Abstr physical address {boot_loc} != expected {expected_loc}"
    )

    # NS word1: limit17 = lump_size - cc - 1; clistCount = cc
    ns_word1 = words[ns_base + 1]
    limit17   = ns_word1 & 0x1FFFF
    clist_cnt = (ns_word1 >> 17) & 0x1FF
    expected_limit17 = lump_size - cc - 1
    assert limit17 == expected_limit17, (
        f"NS word1 limit17={limit17} != expected {expected_limit17}"
    )
    assert clist_cnt == cc, f"NS word1 clistCount={clist_cnt} != expected cc={cc}"

    # Lump header at boot_loc
    hdr = words[boot_loc]
    hdr_magic = (hdr >> 27) & 0x1F
    hdr_nm6   = (hdr >> 23) & 0xF
    hdr_cw    = (hdr >> 10) & 0x1FFF
    hdr_cc    = hdr & 0xFF
    import math
    expected_nm6 = max(0, int(math.ceil(math.log2(lump_size))) - 6)
    assert hdr_magic == 0x1F, f"lump header magic={hdr_magic:#x} != 0x1F"
    assert hdr_nm6 == expected_nm6, f"lump header n_minus_6={hdr_nm6} != {expected_nm6}"
    assert hdr_cw == 3, f"lump header cw={hdr_cw} != 3 (synthetic lump nuc_code_words default)"
    assert hdr_cc == cc, f"lump header cc={hdr_cc} != {cc}"


@pytest.mark.parametrize("lightning_slot,stale_next_config", [
    (6,   None),  # default LightningBolt target: SelfTest
    (7,   6),     # LightningBolt target must beat stale self-loop config
    (8,   300),   # LightningBolt target must beat any stale configured target
    (300, 7),     # validates the 16-bit slot_id encoding above the default NS limit
])
def test_boot_image_next_gt_follows_lightning_bolt(tmp_path, lightning_slot, stale_next_config):
    """SelfTest c-list[1] always follows the selected LightningBolt boot entry.

    The stored SelfTest binary has a slot-6 template in c-list[1], so image
    generation must replace it after copying the resident lump. A legacy
    nextAfterSelfTestSlot setting is deliberately supplied in several cases
    to prove it cannot override the LightningBolt selection.

    Uses the production SelfTest lump (cc=2, 512 words) so the patch path taken
    by generate_boot_image() is identical to what runs on hardware.
    """
    from server.boot_image import (
        generate_boot_image, NS_TABLE_RESERVE, NS_ENTRY_WORDS,
        BOOT_ABSTR_NS_SLOT, create_gt,
    )

    # ── Use the production SelfTest binary (cc=2, 512 words) ──────────────────
    #    find_lump_file_by_abstraction() prefers the "filename" field in the
    #    manifest entry; we copy the canonical file into tmp_path and point the
    #    manifest at it so the generator loads the real binary.
    with open(os.path.join(LUMPS_DIR, "manifest.json"), encoding="utf-8") as _mf:
        _selftest_entries = json.load(_mf)
    CANONICAL_FILENAME = next(
        entry["filename"] for entry in _selftest_entries
        if entry.get("abstraction") == "SelfTest"
        and isinstance(entry.get("filename"), str)
    )
    real_lump_src = os.path.join(LUMPS_DIR, CANONICAL_FILENAME)
    (tmp_path / CANONICAL_FILENAME).write_bytes(
        open(real_lump_src, "rb").read()
    )

    # Parse lump header to get CC and LUMP_SIZE from the actual binary.
    with open(real_lump_src, "rb") as _f:
        _hdr = struct.unpack_from(">I", _f.read(4))[0]
    CC        = _hdr & 0xFF                            # must be 2
    LUMP_SIZE = 1 << (((_hdr >> 23) & 0xF) + 6)       # must be 512
    assert CC == 2,   f"SelfTest lump cc={CC} but expected 2; rebuild with build_selftest_lump.js"
    assert LUMP_SIZE == 512, f"SelfTest lump_size={LUMP_SIZE} but expected 512"

    SAVED_TOKEN = f"{BOOT_ABSTR_NS_SLOT << 8:08x}"
    (tmp_path / "manifest.json").write_text(json.dumps([{
        "token":           SAVED_TOKEN,
        "abstraction":     "SelfTest",
        "ns_slot":         BOOT_ABSTR_NS_SLOT,
        "ns_slot_policy":  "static",
        "boot_resident":   True,
        "lump_size":       LUMP_SIZE,
        "cc":              CC,
        "filename":        CANONICAL_FILENAME,
    }]))
    (tmp_path / "ns-state.json").write_text(json.dumps({
        "abstractions": [{
            "name": "SelfTest",
            "slot": BOOT_ABSTR_NS_SLOT,
            "token": SAVED_TOKEN,
        }]
    }))

    cfg = {
        "step1": {
            "totalNamespaceWords": 16384,
            "namespaceLumpWords":     64,
            "threadLumpWords":       256,
        },
    }
    if stale_next_config is not None:
        cfg["nextAfterSelfTestSlot"] = stale_next_config

    img   = generate_boot_image(cfg, str(tmp_path), boot_entry_slot=lightning_slot)
    total = 16384
    words = list(struct.unpack(f"<{total}I", img))

    # Locate Boot.Abstr lump in the image.
    ns_base  = total - (BOOT_ABSTR_NS_SLOT + 1) * NS_ENTRY_WORDS
    boot_loc = words[ns_base]

    # c-list starts at boot_loc + LUMP_SIZE - CC. Row 0 is SelfTest's
    # immutable E-GT for the in-program CR0/CR1 EXACT check; row 1 is Next.GT.
    clist_base = boot_loc + LUMP_SIZE - CC
    clist_0    = words[clist_base]
    clist_1    = words[clist_base + 1]

    expected_self_gt = create_gt(0, BOOT_ABSTR_NS_SLOT, {"E": 1}, 1) & 0xFFFFFFFF
    assert clist_0 == expected_self_gt, (
        f"c-list[0] in boot image = 0x{clist_0:08X}; "
        f"expected immutable SelfTest E-GT = 0x{expected_self_gt:08X}. "
        "SelfTest loads this row into CR1 before TPERM EXACT CR0, CR1."
    )

    # Expected: Inform E-GT targeting the LightningBolt-selected slot,
    # constructed the same way boot_image.py does it (avoids hardcoding bits).
    expected_gt = create_gt(0, lightning_slot, {"E": 1}, 1) & 0xFFFFFFFF

    assert clist_1 == expected_gt, (
        f"c-list[1] in boot image = 0x{clist_1:08X} (slot {clist_1 & 0xFFFF}); "
        f"expected LightningBolt Next.GT = 0x{expected_gt:08X} (slot {lightning_slot}). "
        f"ignored nextAfterSelfTestSlot={stale_next_config!r}. "
        f"Boot.Abstr at word 0x{boot_loc:X}, c-list base at word 0x{clist_base:X}."
    )


if __name__ == "__main__":
    failures = 0
    for p in CONFIGS:
        cfg = p.values[0]
        name = p.id
        try:
            py_bytes  = generate_boot_image(cfg, LUMPS_DIR)
            sim_words = _run_simulator(cfg)
            _compare(py_bytes, sim_words, cfg)
            print(f"PASS: {name}")
        except AssertionError as e:
            failures += 1
            print(f"FAIL: {name}\n{e}")
    sys.exit(1 if failures else 0)
