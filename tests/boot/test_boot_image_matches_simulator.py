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

from server.boot_image import generate_boot_image, NS_TABLE_RESERVE, NS_ENTRY_WORDS  # noqa: E402

LUMPS_DIR = os.path.join(ROOT, "server", "lumps")
HARNESS   = os.path.join(ROOT, "tests", "boot", "sim_init_dump.js")


# ---- configs ---------------------------------------------------------------

def _cfg_default():
    return {
        "step1": {
            "totalNamespaceWords": 16384,
            "namespaceLumpWords":     64,
            "threadLumpWords":       256,
        },
    }


def _cfg_custom_step1():
    # Larger thread lump; verifies the lump-header n_minus_6 computation is
    # driven by threadLumpWords (not hardcoded). Boot.Abstr is always 64w
    # default (Task #568); abstractionLumpWords is deprecated and ignored.
    return {
        "step1": {
            "totalNamespaceWords": 32768,
            "namespaceLumpWords":     64,
            "threadLumpWords":       512,
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


CONFIGS = [
    pytest.param(_cfg_default(),           id="default"),
    pytest.param(_cfg_custom_step1(),      id="custom_step1"),
    pytest.param(_cfg_step2_resident(),    id="step2_resident"),
    pytest.param(_cfg_step3_reservation(), id="step3_reservation"),
]


# ---- helpers --------------------------------------------------------------

BOOT_ABSTR_DEFAULT_SIZE  = 64  # Boot.Abstr default size when no saved lump (Task #568)

def _region_of(word_index, total_words, ns_size, thread_size, entry_size):
    """Human-readable name for the foundation region containing word_index.

    After Task #1205: null slot 2 gap removed; Boot.Abstr (NS slot 3) starts
    immediately after Boot.Thread at ns_size + thread_size.
    """
    ns_table_base = total_words - NS_TABLE_RESERVE
    if word_index >= ns_table_base:
        slot = (word_index - ns_table_base) // NS_ENTRY_WORDS
        field = ["word0_location", "word1_limits", "word2_seals", "word3_abstract_gt"][
            (word_index - ns_table_base) % NS_ENTRY_WORDS]
        return f"NS table slot {slot} ({field})"
    if word_index < ns_size:
        return "Boot.NS lump"
    if word_index < ns_size + thread_size:
        return "Boot.Thread lump"
    boot_abstr_end = ns_size + thread_size + entry_size
    if word_index < boot_abstr_end:
        return "Boot.Abstr lump (slot 3)"
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


def _compare(py_bytes, sim_words, cfg):
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
    skip_ranges = _resident_body_ranges(cfg)

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

@pytest.mark.parametrize("cfg", CONFIGS)
def test_boot_image_matches_simulator(cfg, tmp_path):
    # Use an empty temporary lumps directory so that user-saved lumps (e.g.
    # 00000300.lump with a POLA-modified cc) never influence the boot image
    # generated here.  The simulator harness always uses its own hardcoded
    # defaults, so the Python generator must too for this parity test.
    py_bytes  = generate_boot_image(cfg, str(tmp_path))
    sim_words = _run_simulator(cfg)
    _compare(py_bytes, sim_words, cfg)


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
    """generate_boot_image() places a valid 00000300.lump at Boot.Abstr's slot.

    Verifies:
      - Boot.Abstr NS table entry (word0) points to the correct physical address.
      - The NS table word1 encodes the correct limit17 (lump_size - cc - 1)
        and clist_count (= cc).
      - The lump header at that address round-trips (n_minus_6, cw, cc).
    """
    from server.boot_image import (
        generate_boot_image, NS_TABLE_RESERVE, NS_ENTRY_WORDS,
        BOOT_ABSTR_NS_SLOT, NUC_CODE_WORDS, DEMO_CLIST_SIZE,
        pack_ns_word1,
    )

    # Write a synthetic saved lump into tmp_path.
    saved_bytes = _make_boot_abstr_lump(lump_size, cc)
    saved_path = tmp_path / "00000300.lump"
    saved_path.write_bytes(saved_bytes)

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
    ns_table_base = total - NS_TABLE_RESERVE

    # NS table slot 3 word0 = physical location
    ns_base = ns_table_base + BOOT_ABSTR_NS_SLOT * NS_ENTRY_WORDS
    boot_loc = words[ns_base]

    # Expected physical address: after Boot.NS(64) + Boot.Thread(256) — null slot 2 gap removed (Task #1205)
    expected_loc = 64 + 256
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
    assert hdr_cw == NUC_CODE_WORDS, f"lump header cw={hdr_cw} != {NUC_CODE_WORDS}"
    assert hdr_cc == cc, f"lump header cc={hdr_cc} != {cc}"


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
