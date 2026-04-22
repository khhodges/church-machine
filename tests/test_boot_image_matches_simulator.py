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

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
sys.path.insert(0, ROOT)

from server.boot_image import generate_boot_image, NS_TABLE_RESERVE, NS_ENTRY_WORDS  # noqa: E402

LUMPS_DIR = os.path.join(ROOT, "server", "lumps")
HARNESS   = os.path.join(ROOT, "tests", "sim_init_dump.js")


# ---- configs ---------------------------------------------------------------

def _cfg_default():
    return {
        "step1": {
            "totalNamespaceWords": 16384,
            "namespaceLumpWords":     64,
            "threadLumpWords":       256,
            "abstractionLumpWords":  256,
        },
    }


def _cfg_custom_step1():
    # Larger thread + abstraction lumps; verifies the lump-header
    # n_minus_6 computation is driven by config (not hardcoded).
    return {
        "step1": {
            "totalNamespaceWords": 32768,
            "namespaceLumpWords":     64,
            "threadLumpWords":       512,
            "abstractionLumpWords":  512,
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
    cfg["step3"] = {"emptySlotCount": 8, "baseNamedNsCount": 47}
    return cfg


CONFIGS = [
    pytest.param(_cfg_default(),           id="default"),
    pytest.param(_cfg_custom_step1(),      id="custom_step1"),
    pytest.param(_cfg_step2_resident(),    id="step2_resident"),
    pytest.param(_cfg_step3_reservation(), id="step3_reservation"),
]


# ---- helpers --------------------------------------------------------------

STARTUP_CONFIG_LUMP_SIZE = 64  # Slot 2 (Startup.Config) is always 64 words (Task #396)

def _region_of(word_index, total_words, ns_size, thread_size, entry_size):
    """Human-readable name for the foundation region containing word_index.

    After Task #396: slot 2 (0x0140-0x017F, 64 words) is Startup.Config;
    Boot.Abstr (NS slot 3) takes abstractionLumpWords (= entry_size here).
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
    startup_config_end = ns_size + thread_size + 64  # slot 2: Startup.Config (64 words, Task #396)
    if word_index < startup_config_end:
        return "Startup.Config lump (slot 2, 64 words)"
    if word_index < startup_config_end + entry_size:
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
    abstr_size  = step1["abstractionLumpWords"]

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
def test_boot_image_matches_simulator(cfg):
    py_bytes  = generate_boot_image(cfg, LUMPS_DIR)
    sim_words = _run_simulator(cfg)
    _compare(py_bytes, sim_words, cfg)


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
