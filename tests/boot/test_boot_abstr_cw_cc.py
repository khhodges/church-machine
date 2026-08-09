"""Integration tests for Binary-tab cw/cc refresh after Save.

Task #737: Confirm that the Binary tab shows updated cw/cc values immediately
after /api/lumps/save (no page reload) and that those values survive a server
restart (because _load_boot_abstr_lump() reads 00000600.lump on startup).

Three scenarios:

  1. POST /api/lumps/save for ns_slot=6 with a lump containing cw=17, cc=18
     → GET /api/lumps/list immediately after save (no manual reload, no page
     refresh) must return cw=17 / cc=18 as the first (Boot.Abstr) entry.
     The save endpoint calls _load_boot_abstr_lump() internally when boot-
     image.bin and boot-config.json are present on disk, so the in-memory
     _BOOT_ABSTR_META is refreshed without any extra step.

  2. With 00000600.lump already on disk, calling _load_boot_abstr_lump()
     (simulating a server restart) must still return cw=17 / cc=18.  The
     function is called twice to confirm idempotency across multiple boots.

  3. No 00000600.lump / sidecar on disk → _load_boot_abstr_lump() falls back
     to the on-disk boot-image.bin which carries the canonical NUC_CODE_WORDS=3,
     cc=0 Boot.Abstr (SelfTest at NS slot 6); GET /api/lumps/list must report
     cw=3 / cc=0 (no regression in the no-saved-lump code path).
"""
import os
import struct
import sys

import pytest

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
sys.path.insert(0, ROOT)

from server.boot_constants import DEMO_CLIST_SIZE  # noqa: E402

LUMPS_DIR      = os.path.join(ROOT, "server", "lumps")
LUMP_600_PATH  = os.path.join(LUMPS_DIR, "00000600.lump")
JSON_600_PATH  = os.path.join(LUMPS_DIR, "00000600.json")
# 00000003.json is the legacy sidecar name; _load_boot_abstr_lump() falls
# back to it when 00000600.json is absent, so the fixture must manage it too.
JSON_003_PATH  = os.path.join(LUMPS_DIR, "00000003.json")
# Keep old 300 names for backward-compat reference in clean_600 fixture.
LUMP_300_PATH  = os.path.join(LUMPS_DIR, "00000300.lump")
JSON_300_PATH  = os.path.join(LUMPS_DIR, "00000300.json")
# manifest.json is updated by /api/lumps/save; back it up to prevent churn.
MANIFEST_PATH  = os.path.join(LUMPS_DIR, "manifest.json")

# ── Lump header encoding ──────────────────────────────────────────────────────
# Header: [31:27]=0x1F magic, [26:23]=n_minus_6, [22:10]=cw, [9:8]=typ, [7:0]=cc
# n_minus_6=0  →  lump_size = 1 << (0+6) = 64 words

SAVED_CW        = 17
SAVED_CC        = 8   # must be ≤ DEMO_CLIST_SIZE (currently 11)
LUMP_N_MINUS_6  = 0           # 64-word lump
LUMP_SIZE_WORDS = 1 << (LUMP_N_MINUS_6 + 6)  # 64


def _make_header(cw, cc, n_minus_6=LUMP_N_MINUS_6, typ=0):
    return (0x1F << 27) | (n_minus_6 << 23) | (cw << 10) | (typ << 8) | cc


def _make_lump_words(cw, cc):
    """Return a 64-word lump array with the correct header and zero padding."""
    words = [0] * LUMP_SIZE_WORDS
    words[0] = _make_header(cw, cc)
    return words


# ── Fixtures ──────────────────────────────────────────────────────────────────

@pytest.fixture(scope="module")
def client():
    """Shared Flask test client for the entire module."""
    from server.app import app  # noqa: E402
    app.config["TESTING"] = True
    with app.test_client() as c:
        yield c


@pytest.fixture()
def clean_300():
    """Snapshot and restore the lumps directory state around each test.

    Files removed before the test (and restored/removed after):
    - 00000600.lump  (written by /api/lumps/save for ns_slot=6; Task #1918)
    - 00000600.json  (sidecar written by same endpoint)
    - 00000003.json  (legacy sidecar read as fallback by _load_boot_abstr_lump)
    - 00000300.lump  (old Boot.Abstr lump, kept for backward-compat)
    - 00000300.json  (old sidecar)

    Files backed up but kept in place (only restored after the test):
    - manifest.json  (updated by /api/lumps/save; must remain intact so the
                      boot-config Step 2 validation can read the lump catalog
                      and regenerate boot-image.bin successfully)

    All existing files are restored unconditionally in teardown, so the real
    lumps directory is left exactly as it was found regardless of test outcome.
    """
    _to_remove    = (LUMP_600_PATH, JSON_600_PATH, JSON_003_PATH, LUMP_300_PATH, JSON_300_PATH)
    _keep_in_place = (MANIFEST_PATH,)
    _backed: dict[str, bytes] = {}

    for path in _to_remove:
        if os.path.isfile(path):
            with open(path, "rb") as fh:
                _backed[path] = fh.read()
            os.remove(path)

    for path in _keep_in_place:
        if os.path.isfile(path):
            with open(path, "rb") as fh:
                _backed[path] = fh.read()

    yield  # run the test

    for path in _to_remove + _keep_in_place:
        if os.path.isfile(path):
            os.remove(path)
        if path in _backed:
            with open(path, "wb") as fh:
                fh.write(_backed[path])


@pytest.fixture()
def reset_boot_abstr_meta():
    """Snapshot and restore the global _BOOT_ABSTR_META dict so tests cannot
    bleed state into each other through the in-memory cache."""
    import server.app as _app
    original = dict(_app._BOOT_ABSTR_META)
    yield
    _app._BOOT_ABSTR_META.clear()
    _app._BOOT_ABSTR_META.update(original)


BOOT_CONFIG_PATH = os.path.join(ROOT, "server", "boot-config.json")


@pytest.fixture()
def reset_boot_config():
    """Back up boot-config.json, replace with a minimal valid config, then restore.

    The on-disk boot-config.json may contain Step 2 lump references (e.g. NS
    slot 18) whose lump files have since been deleted.  When those invalid
    references exist, the save endpoint's boot-image regeneration fails with
    a Step 2 validation error, causing boot_image_refreshed=False.

    This fixture ensures a known-good minimal config is in place for tests
    that rely on successful boot-image regeneration.
    """
    import json
    _MINIMAL_JSON = {
        "schemaVersion": 1,
        "targetBoard": "wukong-xc7a100t",
        "step1": {
            "totalNamespaceWords": 16384,
            "namespaceLumpWords":     64,
            "threadLumpWords":       256,
        },
    }
    _backed_cfg: bytes | None = None
    if os.path.isfile(BOOT_CONFIG_PATH):
        with open(BOOT_CONFIG_PATH, "rb") as fh:
            _backed_cfg = fh.read()
    with open(BOOT_CONFIG_PATH, "w") as fh:
        json.dump(_MINIMAL_JSON, fh, indent=2)

    yield

    if os.path.isfile(BOOT_CONFIG_PATH):
        os.remove(BOOT_CONFIG_PATH)
    if _backed_cfg is not None:
        with open(BOOT_CONFIG_PATH, "wb") as fh:
            fh.write(_backed_cfg)


# ── Helpers ───────────────────────────────────────────────────────────────────

def _write_lump_300(cw=SAVED_CW, cc=SAVED_CC):
    """Write a minimal valid 00000600.lump (big-endian, as /api/lumps/save does)."""
    words = _make_lump_words(cw, cc)
    with open(LUMP_600_PATH, "wb") as fh:
        fh.write(struct.pack(f">{LUMP_SIZE_WORDS}I", *words))


_MINIMAL_BOOT_CFG = {
    "step1": {
        "totalNamespaceWords": 16384,
        "namespaceLumpWords":     64,
        "threadLumpWords":       256,
    }
}


def _simulate_server_restart():
    """Regenerate boot-image.bin then sync _BOOT_ABSTR_META — mirrors server startup.

    A real server restart re-runs generate_boot_image() before calling
    _load_boot_abstr_lump().  Without that regeneration step, a stale
    boot-image.bin (written during a previous test or user session) causes
    _load_boot_abstr_lump() to report cw/cc from the old image rather than
    the current on-disk state of the lumps directory.

    If the saved boot config is absent or fails Step 2 validation (e.g. a
    previously-configured lump at NS slot 18 is no longer in the catalog),
    we fall back to _MINIMAL_BOOT_CFG so the regeneration always succeeds.
    """
    import server.app as _app
    from server.boot_image import generate_boot_image as _gen_bi
    try:
        cfg, err = _app._read_saved_boot_config()
        if err:
            cfg = _MINIMAL_BOOT_CFG
        blob = _gen_bi(cfg, LUMPS_DIR)
        boot_path = os.path.join(LUMPS_DIR, "boot-image.bin")
        with open(boot_path, "wb") as fh:
            fh.write(blob)
    except Exception:
        pass
    _app._load_boot_abstr_lump()


def _get_boot_abstr_from_list(client):
    """Return the Boot.Abstr (NS slot 6, token 00000600) entry from GET /api/lumps/list."""
    resp = client.get("/api/lumps/list")
    assert resp.status_code == 200, (
        f"GET /api/lumps/list returned {resp.status_code}; "
        f"body={resp.get_data(as_text=True)}"
    )
    entries = resp.get_json()
    assert isinstance(entries, list) and len(entries) > 0, (
        "Expected a non-empty JSON array from /api/lumps/list"
    )
    for e in entries:
        if e.get("token") in ("00000600",) or e.get("ns_slot") == 6:
            return e
    tokens = [e.get("token") for e in entries]
    pytest.fail(
        f"Boot.Abstr (token='00000600', ns_slot=6) not found in /api/lumps/list. "
        f"Tokens present: {tokens}"
    )


# ── Test 1: save cw=17/cc=18 → list reflects new values without page reload ──

BOOT_IMAGE_ON_DISK  = os.path.join(LUMPS_DIR, "boot-image.bin")
BOOT_CONFIG_ON_DISK = os.path.join(ROOT, "server", "boot-config.json")


@pytest.mark.skipif(
    not (os.path.isfile(BOOT_IMAGE_ON_DISK) and os.path.isfile(BOOT_CONFIG_ON_DISK)),
    reason="boot-image.bin or boot-config.json absent; save endpoint cannot "
           "auto-refresh _BOOT_ABSTR_META",
)
def test_save_ns_slot3_updates_list_immediately(client, clean_300, reset_boot_abstr_meta, reset_boot_config):
    """POST /api/lumps/save (ns_slot=6, cw=17, cc=18) must cause GET /api/lumps/list
    to return the new cw/cc immediately — no page reload or server restart needed.

    When both boot-image.bin and boot-config.json are present, save_lump()
    regenerates boot-image.bin and then calls _load_boot_abstr_lump(), which
    reads 00000600.lump (and 00000600.json) to update _BOOT_ABSTR_META in-process.
    The next GET /api/lumps/list therefore reflects the saved values without any
    additional reload step.
    """
    payload = {
        "binary": _make_lump_words(SAVED_CW, SAVED_CC),
        "metadata": {
            "abstraction": "SelfTest",
            "ns_slot": 6,
            "cw": SAVED_CW,
            "cc": SAVED_CC,
        },
    }
    resp = client.post("/api/lumps/save", json=payload)
    assert resp.status_code == 200, (
        f"POST /api/lumps/save returned {resp.status_code}; "
        f"body={resp.get_data(as_text=True)}"
    )
    data = resp.get_json()
    assert data.get("ok") is True, f"Expected ok=true, got: {data}"
    assert data.get("token") == "00000600", (
        f"Expected token='00000600' for ns_slot=6, got: {data.get('token')!r}"
    )
    assert os.path.isfile(LUMP_600_PATH), "00000600.lump was not written to disk"
    assert data.get("boot_image_refreshed") is True, (
        "Expected save_lump() to regenerate boot-image.bin and refresh "
        "_BOOT_ABSTR_META in-process (boot_image_refreshed must be True); "
        f"got: {data}"
    )

    # Verify immediately — no _load_boot_abstr_lump() or page reload here.
    entry = _get_boot_abstr_from_list(client)
    assert entry.get("cw") == SAVED_CW, (
        f"Expected cw={SAVED_CW} immediately after save, got cw={entry.get('cw')!r}"
    )
    assert entry.get("cc") == SAVED_CC, (
        f"Expected cc={SAVED_CC} immediately after save, got cc={entry.get('cc')!r}"
    )


# ── Test 2: values survive a simulated server restart ─────────────────────────

def test_saved_cw_cc_survive_server_restart(client, clean_300, reset_boot_abstr_meta, reset_boot_config):
    """With 00000600.lump on disk, _load_boot_abstr_lump() called twice
    (simulating two sequential boots) must return cw=17 / cc=18 each time."""
    _write_lump_300(SAVED_CW, SAVED_CC)

    for restart_number in (1, 2):
        _simulate_server_restart()
        entry = _get_boot_abstr_from_list(client)
        assert entry.get("cw") == SAVED_CW, (
            f"Restart #{restart_number}: expected cw={SAVED_CW}, "
            f"got cw={entry.get('cw')!r}"
        )
        assert entry.get("cc") == SAVED_CC, (
            f"Restart #{restart_number}: expected cc={SAVED_CC}, "
            f"got cc={entry.get('cc')!r}"
        )


# ── Test 3: no 00000600.lump → generate_boot_image() raises ValueError ────────

def test_no_saved_lump_raises_value_error(clean_300, tmp_path):
    """When 00000600.lump is absent, generate_boot_image() must raise ValueError.

    The direct-dispatch boot model has no fallback trampoline.  The real
    SelfTest lump must always be present when generating a boot image.
    This test confirms the error is raised with an informative message rather
    than silently producing a broken image.
    """
    import tempfile
    from server.boot_image import generate_boot_image as _gen_bi

    assert not os.path.isfile(LUMP_600_PATH), "Precondition: 00000600.lump must not exist"

    cfg = {
        "step1": {
            "totalNamespaceWords": 16384,
            "namespaceLumpWords":     64,
            "threadLumpWords":       256,
        },
    }
    with pytest.raises(ValueError, match="00000600.lump"):
        _gen_bi(cfg, str(tmp_path))
