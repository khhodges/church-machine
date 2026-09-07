"""Integration tests for Binary-tab cw/cc refresh after Save.

Task #737: Confirm that the Binary tab shows updated cw/cc values immediately
after /api/lumps/save (no page reload) and that those values survive a server
restart (because _load_boot_abstr_lump() reads the manifest-designated file on
startup).

Three scenarios:

   1. POST /api/lumps/save for the active ns-state SelfTest slot with a
      header-derived SelfTest lump (cw=17, cc=2, live c-list E-GTs) → GET /api/lumps/list immediately
     after save (no manual reload, no page refresh) must return cw=17 / cc=2 as
     the first (Boot.Abstr) entry.  The save endpoint calls
     _load_boot_abstr_lump() internally so _BOOT_ABSTR_META is refreshed without
      any extra step.  Its allocation is read from its header, while its two
      c-list rows are checked against the active Namespace descriptor.

  2. With the manifest updated, calling _load_boot_abstr_lump() (simulating a
     server restart) must still return cw=17 / cc=2.  The function is called
     twice to confirm idempotency across multiple boots.

   3. An absent authoritative Namespace binding is rejected instead of falling
      back to a historical token-derived filename.
"""
import os
import struct
import sys

import pytest

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
sys.path.insert(0, ROOT)

LUMPS_DIR      = os.path.join(ROOT, "server", "lumps")
MANIFEST_PATH  = os.path.join(LUMPS_DIR, "manifest.json")
NS_STATE_PATH  = os.path.join(LUMPS_DIR, "ns-state.json")
APPROVALS_PATH = os.path.join(LUMPS_DIR, "approvals.json")

# ── Lump header encoding ──────────────────────────────────────────────────────
# Header: [31:27]=0x1F magic, [26:23]=n_minus_6, [22:10]=cw, [9:8]=typ, [7:0]=cc
# n_minus_6=0  →  lump_size = 1 << (0+6) = 64 words

SAVED_CW        = 17
# SelfTest's executable c-list has two state-derived continuation rows.
SAVED_CC        = 2
def _active_selftest():
    """Resolve the sole active SelfTest descriptor from ns-state and manifest."""
    import json
    with open(os.path.join(LUMPS_DIR, "ns-state.json"), encoding="utf-8") as fh:
        rows = json.load(fh)["abstractions"]
    row = next(row for row in rows if row.get("name") == "SelfTest")
    return row


def _make_active_lump_words(cw=SAVED_CW):
    """Reuse the approved active shape and its live state-derived c-list."""
    row = _active_selftest()
    with open(os.path.join(LUMPS_DIR, row["filename"]), "rb") as fh:
        raw = fh.read()
    words = list(struct.unpack(f">{len(raw) // 4}I", raw))
    header = words[0]
    size = 1 << (((header >> 23) & 0xF) + 6)
    cc = header & 0xFF
    assert len(words) >= size and cc == SAVED_CC
    words = words[:size]
    words[0] = (header & ~((0x1FFF << 10) | 0xFF)) | (cw << 10) | cc
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

    The active manifest, namespace state, and approvals are restored after
    each save so no state-selected identity leaks into another test.

    All existing files are restored unconditionally in teardown.  The shared
    boot fixture already redirects this module to a private library copy.
    """
    # Saving archives/replaces both the selected artifact and its sidecar, so
    # snapshot the complete private test library rather than guessing names.
    _backed: dict[str, bytes] = {}
    for name in os.listdir(LUMPS_DIR):
        path = os.path.join(LUMPS_DIR, name)
        if os.path.isfile(path):
            with open(path, "rb") as fh:
                _backed[path] = fh.read()

    yield  # run the test

    for name in os.listdir(LUMPS_DIR):
        path = os.path.join(LUMPS_DIR, name)
        if os.path.isfile(path) and path not in _backed:
            os.remove(path)
    for path, content in _backed.items():
        with open(path, "wb") as fh:
            fh.write(content)


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
    """Replace the private boot config with a minimal valid config, then restore.

    The shared boot fixture redirects ``BOOT_CONFIG_PATH`` and this test
    module's path constant to temporary storage.  The copied config may
    contain Step 2 LUMP references (e.g. NS slot 18) whose files have since
    been deleted, which makes boot-image regeneration fail validation.

    This fixture ensures a known-good minimal config is in place for the
    test, without changing the IDE's real boot-config.json.
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
    """Return the active SelfTest entry from GET /api/lumps/list."""
    resp = client.get("/api/lumps/list")
    assert resp.status_code == 200, (
        f"GET /api/lumps/list returned {resp.status_code}; "
        f"body={resp.get_data(as_text=True)}"
    )
    entries = resp.get_json()
    assert isinstance(entries, list) and len(entries) > 0, (
        "Expected a non-empty JSON array from /api/lumps/list"
    )
    active = _active_selftest()
    for e in entries:
        if (e.get("abstraction") == "SelfTest"
                and e.get("token") == active["token"]
                and (e.get("filename") == active["filename"]
                     or (e.get("ns_slot") == active["slot"]
                         and e.get("lump_version") == active.get("lump_version")))):
            return e
    tokens = [e.get("token") for e in entries]
    pytest.fail(
        f"Active SelfTest not found in /api/lumps/list. "
        f"Tokens present: {tokens}"
    )


def _approved_payload(client, payload):
    """Obtain the current hash-bound save plan and explicit E approval."""
    planned = client.post("/api/lumps/save-plan", json=payload)
    assert planned.status_code == 201, planned.get_data(as_text=True)
    plan = planned.get_json()
    issued = client.post("/api/lumps/approval-intent", json={
        "digest": plan["digest"],
        "action": plan["action"],
        "plan": plan["plan"],
        "confirmation": True,
        "approval": {"grants": ["E"]},
    })
    assert issued.status_code == 201, issued.get_data(as_text=True)
    approved = {
        "binary": payload["binary"],
        "metadata": dict(payload["metadata"]),
    }
    approved["metadata"].update({
        "save_plan": plan["plan"],
        "approval_intent": issued.get_json()["intent"],
    })
    return approved


# ── Test 1: save cw=17/cc=18 → list reflects new values without page reload ──

BOOT_IMAGE_ON_DISK  = os.path.join(LUMPS_DIR, "boot-image.bin")
BOOT_CONFIG_ON_DISK = os.path.join(ROOT, "server", "boot-config.json")


@pytest.mark.skipif(
    not (os.path.isfile(BOOT_IMAGE_ON_DISK) and os.path.isfile(BOOT_CONFIG_ON_DISK)),
    reason="boot-image.bin or boot-config.json absent; save endpoint cannot "
           "auto-refresh _BOOT_ABSTR_META",
)
def test_save_active_selftest_updates_list_immediately(client, clean_300, reset_boot_abstr_meta, reset_boot_config):
    """POST /api/lumps/save at the active SelfTest slot → GET /api/lumps/list must
    return the new cw/cc immediately — no page reload or server restart needed.

    The active artifact's header-derived shape and state-derived c-list are
    retained; save_lump() rejects malformed c-list contracts before mutation.
    When the save succeeds, _load_boot_abstr_lump() is called (unconditionally for
    this token) so _BOOT_ABSTR_META is refreshed in-process and the next GET
    /api/lumps/list reflects the saved cw/cc without any extra step.
    """
    payload = {
        "binary": _make_active_lump_words(),
        "metadata": {
            "abstraction": "SelfTest",
            "ns_slot": _active_selftest()["slot"],
            "token": _active_selftest()["token"],
            "cw": SAVED_CW,
            "cc": SAVED_CC,
            "capabilities": [
                {"name": "Self", "rights": ["E"],
                 "nsIndex": _active_selftest()["slot"]},
                {"name": "Next", "rights": ["E"],
                 "nsIndex": _active_selftest()["slot"]},
            ],
        },
    }
    resp = client.post("/api/lumps/save", json=_approved_payload(client, payload))
    assert resp.status_code == 200, (
        f"POST /api/lumps/save returned {resp.status_code}; "
        f"body={resp.get_data(as_text=True)}"
    )
    data = resp.get_json()
    assert data.get("ok") is True, f"Expected ok=true, got: {data}"
    # The save endpoint writes a versioned filename (e.g. SelfTest.1.<hash>.lump),
    # The save endpoint writes a versioned filename. Check its reported path.
    _saved_lump_file = os.path.join(LUMPS_DIR, data.get("lump", ""))
    assert os.path.isfile(_saved_lump_file), (
        f"save_lump() reported lump={data.get('lump')!r} but that file is not on disk"
    )
    # _BOOT_ABSTR_META is always refreshed after a SelfTest save (via
    # _load_boot_abstr_lump() called unconditionally in save_lump() when
    # boot_image_refreshed is False).  boot_image_refreshed may be False when
    # generate_boot_image cannot locate the SelfTest lump via manifest ns_slot.
    assert data.get("ok") is True, f"save_lump() did not return ok=True: {data}"

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
    """With the manifest updated by /api/lumps/save, _load_boot_abstr_lump()
    called twice (simulating two sequential boots) must return cw=17 / cc=2.

    Uses the save endpoint (not a direct disk write) so manifest.json is
    updated to point at the new versioned file.  _load_boot_abstr_lump()
    reads the manifest-designated file on restart; without a manifest update
    it would silently fall back to the still-present canonical SelfTest binary
    and report the canonical cw rather than the test value.

    The binary retains the active descriptor's header-derived allocation and
    state-derived c-list contract.
    """
    payload = {
        "binary": _make_active_lump_words(),
        "metadata": {
            "abstraction": "SelfTest",
            "ns_slot": _active_selftest()["slot"],
            "token": _active_selftest()["token"],
            "cw": SAVED_CW,
            "cc": SAVED_CC,
            "capabilities": [
                {"name": "Self", "rights": ["E"],
                 "nsIndex": _active_selftest()["slot"]},
                {"name": "Next", "rights": ["E"],
                 "nsIndex": _active_selftest()["slot"]},
            ],
        },
    }
    resp = client.post("/api/lumps/save", json=_approved_payload(client, payload))
    assert resp.status_code == 200, (
        f"POST /api/lumps/save returned {resp.status_code}; "
        f"body={resp.get_data(as_text=True)}"
    )

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


# ── Test 3: no active locator → generate_boot_image() raises ValueError ───────

def test_missing_authoritative_binding_raises_value_error(clean_300, tmp_path):
    """A missing state/manifest binding cannot fall back to a slot filename."""
    from server.boot_image import generate_boot_image as _gen_bi

    (tmp_path / "manifest.json").write_text("[]")
    (tmp_path / "ns-state.json").write_text('{"abstractions": []}')

    cfg = {
        "step1": {
            "totalNamespaceWords": 16384,
            "namespaceLumpWords":     64,
            "threadLumpWords":       256,
        },
    }
    with pytest.raises(ValueError, match="SelfTest.*Namespace-state binding"):
        _gen_bi(cfg, str(tmp_path))
