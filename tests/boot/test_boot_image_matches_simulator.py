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


@pytest.mark.parametrize("next_slot,expected_clist1_slot", [
    (None, 6),   # default: SelfTest self-loop (Next.GT → slot 6)
    (7,    7),   # configured: WukongCallHome (slot 7)
    (8,    8),   # configured: arbitrary user-chosen slot
    (300, 300),  # extended-namespace slot (> DEFAULT_NS_SLOTS_MAX=256); validates 16-bit slot_id encoding
])
def test_boot_image_next_gt_is_serialized(tmp_path, next_slot, expected_clist1_slot):
    """generate_boot_image() bakes the configured Next.GT into c-list[1] of the resident SelfTest lump.

    This guards the serialisation path added for nextAfterSelfTestSlot: the
    stored .lump binary retains catalog-loop defaults at its c-list tail, so
    generate_boot_image() must patch clist_gts[1] into mem[] after copying the
    resident lump.  Without that patch, changing nextAfterSelfTestSlot would
    update boot-config.json and the simulator's virtual clistGTs[1] but would
    never reach the boot-image binary uploaded to hardware.

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
    CANONICAL_FILENAME = "SelfTest.1.30542a6d.lump"
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

    cfg = {
        "step1": {
            "totalNamespaceWords": 16384,
            "namespaceLumpWords":     64,
            "threadLumpWords":       256,
        },
    }
    if next_slot is not None:
        cfg["nextAfterSelfTestSlot"] = next_slot

    img   = generate_boot_image(cfg, str(tmp_path))
    total = 16384
    words = list(struct.unpack(f"<{total}I", img))

    # Locate Boot.Abstr lump in the image.
    ns_base  = total - (BOOT_ABSTR_NS_SLOT + 1) * NS_ENTRY_WORDS
    boot_loc = words[ns_base]

    # c-list starts at boot_loc + LUMP_SIZE - CC; index 1 is the Next.GT.
    clist_base = boot_loc + LUMP_SIZE - CC
    clist_1    = words[clist_base + 1]

    # Expected: Inform E-GT targeting expected_clist1_slot, constructed the
    # same way boot_image.py does it (avoids hardcoding the bit pattern).
    expected_gt = create_gt(0, expected_clist1_slot, {"E": 1}, 1) & 0xFFFFFFFF

    assert clist_1 == expected_gt, (
        f"c-list[1] in boot image = 0x{clist_1:08X} (slot {clist_1 & 0xFFFF}); "
        f"expected Next.GT = 0x{expected_gt:08X} (slot {expected_clist1_slot}). "
        f"nextAfterSelfTestSlot={next_slot!r}. "
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
