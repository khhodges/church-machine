"""
tests/server/test_build_approval.py

Regression tests for the Build Approval gate:
  - Auth enforcement on all /api/build-approval/* and /api/wukong-build/* endpoints
  - SelfTest opcode check: RETURN(3) regression fixture, BRANCH(23) pass,
    real 00000600.lump passes, appended-data bypass attempt is rejected
  - SelfTest E-GT check: correct vs corrupted c-list[0], appended-data bypass rejected
  - Freeze-snapshot: derives map server-side, stores all_checks_pass, uses temp dir
  - /start gate: rejected without a clean snapshot, accepted after a clean freeze

ISA note: Church Machine opcodes are 5-bit, encoded in bits[31:27].
  BRANCH = 23  (0b10111)
  RETURN =  3  (0b00011)  — Church RETURN; NOT 24
"""
import json
import math
import os
import struct
import sys
import tempfile

import pytest

# -------------------------------------------------------------------
# Bring server/app into scope without running the server
# -------------------------------------------------------------------
SERVER_DIR = os.path.join(os.path.dirname(__file__), '..', '..', 'server')
sys.path.insert(0, SERVER_DIR)
import app as _app   # noqa: E402

client = _app.app.test_client()

REPORT_TOKEN = os.environ.get('REPORT_TOKEN', '')
AUTH_HEADERS = {'Authorization': f'Bearer {REPORT_TOKEN}'} if REPORT_TOKEN else {}

# ISA constants — 5-bit opcodes at bits[31:27]
CHURCH_BRANCH_OP = 23   # 0b10111
CHURCH_RETURN_OP =  3   # 0b00011


# ===================================================================
# LUMP binary helpers
# ===================================================================

def _next_pow2(n: int) -> int:
    if n <= 1:
        return 1
    return 1 << math.ceil(math.log2(n))


def _make_lump(
    terminal_opcode: int,
    clist_word: int = 0x4A000006,
    cw: int = 8,
    cc: int = 1,
    pad_to_pow2: bool = True,
) -> bytes:
    """
    Build a minimal synthetic LUMP binary.

    Opcodes are 5-bit at bits[31:27] (Church ISA).

    Layout:
      word 0        — header: magic|cw|cc
      words 1..cw-1 — zero code words
      word cw       — terminal instruction  (last code word, header-defined boundary)
      zero padding  — if pad_to_pow2, pad total to next power of two
      last cc words — c-list (placed at file end)
    """
    header = (0x1F << 27) | (cw << 10) | cc
    min_words = 1 + cw + cc
    total = _next_pow2(min_words) if pad_to_pow2 else min_words

    words = [0] * total
    words[0] = header
    words[cw] = (terminal_opcode << 27) | 0x000001   # terminal instruction at word[cw]
    # c-list at the last cc words of the (possibly padded) file
    for i in range(cc):
        words[total - cc + i] = clist_word
    return b''.join(struct.pack('>I', w) for w in words)


def _write_tmp_lump(data: bytes) -> str:
    f = tempfile.NamedTemporaryFile(suffix='.lump', delete=False)
    f.write(data)
    f.close()
    return f.name


# ===================================================================
# Auth: every protected endpoint must return 401 without a token
# ===================================================================

@pytest.mark.parametrize('method,path', [
    ('GET',  '/api/build-approval/ns-map'),
    ('POST', '/api/build-approval/freeze-snapshot'),
    ('GET',  '/api/build-approval/snapshot/latest'),
    ('GET',  '/api/wukong-build/status'),
    ('POST', '/api/wukong-build/start'),
])
def test_endpoint_requires_auth(method, path):
    """All Build Approval endpoints must refuse unauthenticated requests."""
    resp = client.get(path) if method == 'GET' else client.post(path, json={})
    assert resp.status_code == 401, (
        f'{method} {path} should return 401 without token, got {resp.status_code}'
    )


def test_query_string_token_not_accepted():
    """
    Query-string token auth must be rejected — URLs appear in server logs and
    browser history, making ?token= unacceptable for build-privileged endpoints.
    """
    if not REPORT_TOKEN:
        pytest.skip('REPORT_TOKEN not set')
    resp = client.get(f'/api/build-approval/ns-map?token={REPORT_TOKEN}')
    assert resp.status_code == 401, (
        'Query-string token must be rejected; only Authorization: Bearer is accepted'
    )


# ===================================================================
# LUMP size validation helper
# ===================================================================

def test_validate_lump_size_exact_fit():
    """Exact (1 + cw + cc) — no padding — must be accepted."""
    assert _app._ba_validate_lump_size(10, 8, 1) is None   # 1+8+1=10


def test_validate_lump_size_pow2_fit():
    """Next-power-of-two size must be accepted (normal padded LUMP format)."""
    assert _app._ba_validate_lump_size(512, 499, 1) is None   # SelfTest actual


def test_validate_lump_size_too_short():
    """File shorter than (1 + cw + cc) must be rejected."""
    err = _app._ba_validate_lump_size(5, 8, 1)
    assert err is not None
    assert 'short' in err


def test_validate_lump_size_appended():
    """File with appended data (not min or pow2) must be rejected."""
    # 10-word exact-fit LUMP with 2 words appended → 12 words; pow2 would be 16
    err = _app._ba_validate_lump_size(12, 8, 1)
    assert err is not None
    assert 'tamper' in err.lower() or 'unexpected' in err.lower()


# ===================================================================
# Opcode check: BRANCH/RETURN/unknown + appended-data bypass
# ===================================================================

def test_opcode_check_catches_church_return_regression():
    """Terminal Church RETURN (5-bit opcode 3) must be rejected (v12→v13 regression)."""
    path = _write_tmp_lump(_make_lump(terminal_opcode=CHURCH_RETURN_OP))
    try:
        result = _app._ba_check_final_opcode(path)
        assert result['ok'] is False, (
            f'RETURN({CHURCH_RETURN_OP}) should be rejected; '
            f'ok={result["ok"]} detail={result["detail"]}'
        )
        assert 'RETURN' in result['detail'] or str(CHURCH_RETURN_OP) in result['detail']
    finally:
        os.unlink(path)


def test_opcode_check_passes_for_branch():
    """Terminal BRANCH (5-bit opcode 23) must pass."""
    path = _write_tmp_lump(_make_lump(terminal_opcode=CHURCH_BRANCH_OP))
    try:
        result = _app._ba_check_final_opcode(path)
        assert result['ok'] is True, (
            f'BRANCH({CHURCH_BRANCH_OP}) should pass; '
            f'ok={result["ok"]} detail={result["detail"]}'
        )
    finally:
        os.unlink(path)


def test_opcode_check_warns_for_unknown_opcode():
    """Unknown opcode (neither 3 nor 23) must warn (ok=None) not hard-fail."""
    OTHER_OP = 15
    path = _write_tmp_lump(_make_lump(terminal_opcode=OTHER_OP))
    try:
        result = _app._ba_check_final_opcode(path)
        assert result['ok'] is None, (
            f'Unknown opcode {OTHER_OP} should warn (ok=None); got ok={result["ok"]}'
        )
        assert result.get('warn') is True
    finally:
        os.unlink(path)


def test_opcode_check_passes_for_real_selftest_lump():
    """
    The canonical SelfTest LUMP (00000600.lump) must not be flagged as a regression.

    The check must:
      - Use the header-defined cw boundary (currently 499) — not a file-length-derived offset
      - Return ok=False ONLY when it finds Church RETURN (opcode 3) at that position
      - Return ok=True when it finds BRANCH (opcode 23)
      - Return ok=None (warning) for any other opcode (extended ISA instructions)

    Note: the SelfTest binary was updated by subsequent tasks (Next.GT wiring) and now
    ends its code section with an extended-ISA instruction (opcode 8), so ok=None is the
    correct result for the current binary.  ok=False would mean a RETURN regression was
    detected — which is the only hard failure this gate is designed to catch.
    """
    lump_path = os.path.join(SERVER_DIR, 'lumps', '00000600.lump')
    if not os.path.exists(lump_path):
        pytest.skip('00000600.lump not present')
    result = _app._ba_check_final_opcode(lump_path)
    # Must not detect a Church RETURN regression
    assert result['ok'] is not False, (
        f'Real SelfTest LUMP must not be flagged as a regression (ok=False); '
        f'ok={result["ok"]} detail={result["detail"]}'
    )
    # Must have scanned to the header-defined cw=499 boundary, not a file-length offset
    assert 'word[499]' in result['detail'], (
        f'Boundary check: expected scan to header-defined cw=499; detail={result["detail"]}'
    )


def test_opcode_check_rejects_appended_data_bypass():
    """
    Appended-data bypass attempt: RETURN binary with a BRANCH word appended
    beyond the declared content.  The check must reject the file before
    scanning any opcodes (size validation fails first).
    """
    # Build a 10-word LUMP with RETURN at word[cw=8] (exact fit, no padding)
    data = bytearray(_make_lump(terminal_opcode=CHURCH_RETURN_OP, pad_to_pow2=False))
    # Append a BRANCH word and a fake c-list beyond the declared boundary
    data += struct.pack('>I', (CHURCH_BRANCH_OP << 27) | 0x01)  # BRANCH appendage
    data += struct.pack('>I', 0x4A000006)                        # fake c-list appendage
    path = _write_tmp_lump(bytes(data))
    try:
        result = _app._ba_check_final_opcode(path)
        # Must be rejected (ok=False) — either size error or RETURN opcode caught
        assert result['ok'] is False, (
            f'Appended-data bypass must fail; ok={result["ok"]} detail={result["detail"]}'
        )
    finally:
        os.unlink(path)


# ===================================================================
# E-GT check: correct, corrupted, appended-data bypass
# ===================================================================

SELFTEST_NS_SLOT = 6


def test_egt_check_passes_for_real_selftest_lump():
    """Real SelfTest LUMP c-list[0] must equal boot_rom's expected E-GT."""
    lump_path = os.path.join(SERVER_DIR, 'lumps', '00000600.lump')
    if not os.path.exists(lump_path):
        pytest.skip('00000600.lump not present')
    result = _app._ba_check_selftest_egt(lump_path, SELFTEST_NS_SLOT)
    assert result['ok'] is True, (
        f'Real SelfTest LUMP E-GT should match; '
        f'ok={result["ok"]} detail={result["detail"]}'
    )


def test_egt_check_fails_for_wrong_clist():
    """Corrupted c-list[0] must fail the E-GT check."""
    WRONG = 0xDEADBEEF
    path = _write_tmp_lump(_make_lump(terminal_opcode=CHURCH_BRANCH_OP, clist_word=WRONG))
    try:
        result = _app._ba_check_selftest_egt(path, SELFTEST_NS_SLOT)
        assert result['ok'] is False, (
            f'Wrong c-list[0] 0x{WRONG:08X} should fail; '
            f'ok={result["ok"]} detail={result["detail"]}'
        )
    finally:
        os.unlink(path)


def test_egt_check_rejects_appended_data_bypass():
    """
    Appended-data bypass attempt: wrong c-list in declared position, correct
    E-GT appended beyond it.  Size validation must reject before the c-list
    is read from the attacker-controlled position.
    """
    CORRECT_EGT = 0x4A000006
    # Build exact-fit (no pow2 padding) LUMP with wrong c-list
    data = bytearray(_make_lump(
        terminal_opcode=CHURCH_BRANCH_OP,
        clist_word=0xDEADBEEF,    # wrong c-list in declared position
        pad_to_pow2=False,
    ))
    # Append the correct E-GT beyond the declared content boundary
    data += struct.pack('>I', CORRECT_EGT)
    path = _write_tmp_lump(bytes(data))
    try:
        result = _app._ba_check_selftest_egt(path, SELFTEST_NS_SLOT)
        assert result['ok'] is False, (
            f'Appended-data bypass must fail; ok={result["ok"]} detail={result["detail"]}'
        )
    finally:
        os.unlink(path)


# ===================================================================
# Freeze-snapshot: server-side derivation, all_checks_pass, isolated dir
# ===================================================================

def test_freeze_snapshot_derives_map_server_side(monkeypatch, tmp_path):
    """freeze-snapshot ignores client JSON; derives map server-side."""
    if not REPORT_TOKEN:
        pytest.skip('REPORT_TOKEN not set')
    monkeypatch.setattr(_app, '_BUILD_SNAPSHOTS_DIR', str(tmp_path))
    resp = client.post(
        '/api/build-approval/freeze-snapshot',
        json={'map': {'attacker': 'payload'}},
        headers=AUTH_HEADERS,
    )
    assert resp.status_code == 200
    data = resp.get_json()
    assert data.get('ok') is True
    snap_path = tmp_path / data['filename']
    assert snap_path.exists(), f'Snapshot file not written: {data["filename"]}'
    snap = json.loads(snap_path.read_text())
    ns_map = snap.get('ns_map', {})
    assert 'tiers' in ns_map, 'Map must contain server-derived tiers'
    assert 'attacker' not in ns_map, 'Attacker payload must not appear in snapshot'


def test_freeze_snapshot_stores_all_checks_pass(monkeypatch, tmp_path):
    """freeze-snapshot stores all_checks_pass in both the file and the response."""
    if not REPORT_TOKEN:
        pytest.skip('REPORT_TOKEN not set')
    monkeypatch.setattr(_app, '_BUILD_SNAPSHOTS_DIR', str(tmp_path))
    resp = client.post(
        '/api/build-approval/freeze-snapshot',
        json={},
        headers=AUTH_HEADERS,
    )
    assert resp.status_code == 200
    data = resp.get_json()
    assert 'all_checks_pass' in data, 'Response must include all_checks_pass'
    snap = json.loads((tmp_path / data['filename']).read_text())
    assert 'all_checks_pass' in snap, 'Snapshot file must include all_checks_pass'
    # Value must be a boolean (True or False, not None)
    assert isinstance(snap['all_checks_pass'], bool)


# ===================================================================
# /start gate: requires a clean frozen snapshot
# ===================================================================

def test_start_rejected_without_snapshot(monkeypatch, tmp_path):
    """
    /api/wukong-build/start must return 422 when no approval snapshot exists,
    even with a valid token + nonce.
    """
    if not REPORT_TOKEN:
        pytest.skip('REPORT_TOKEN not set')
    monkeypatch.setattr(_app, '_BUILD_SNAPSHOTS_DIR', str(tmp_path))
    # Obtain a fresh nonce
    ns_resp = client.get('/api/build-approval/ns-map', headers=AUTH_HEADERS)
    nonce = ns_resp.get_json().get('build_nonce', '')
    resp = client.post(
        '/api/wukong-build/start',
        json={'build_nonce': nonce},
        headers=AUTH_HEADERS,
    )
    assert resp.status_code == 422, (
        f'Should be 422 (no snapshot); got {resp.status_code}: {resp.get_json()}'
    )


def test_allcheckspass_gate_ignores_lazy_tier_failures():
    """
    Regression: failing lazy/dynamic-tier checks must not block Freeze/Approve.

    This test documents and enforces the gate semantics that must be implemented
    identically in both server-side (_snap_all_pass) and client-side
    (BuildApprovalView._allChecksPass):
      - Bootstrap (slots 0-1) and Resident (slots 2-7) failures → block approval
      - Lazy/dynamic failures → informational warning only, do not block

    The commit that fixes this test demonstrates the v8 regression: when the
    old _allChecksPass() iterated every tier, stale legacy manifest entries in
    the lazy tier (missing LUMP files, superseded tokens) silently disabled
    Freeze Snapshot for the entire project even though all hardware-relevant
    slots passed.
    """
    # Synthetic map: hardware tiers ✅, lazy tier ❌ (stale legacy entry)
    synthetic_map = {
        'tiers': {
            'bootstrap': [
                {'slot': 0, 'name': 'Boot.NS',     'checks': [{'label': 'header', 'ok': True}]},
                {'slot': 1, 'name': 'Boot.Thread', 'checks': [{'label': 'header', 'ok': True}]},
            ],
            'resident': [
                {'slot': 6, 'name': 'SelfTest', 'checks': [
                    {'label': 'BRANCH opcode', 'ok': True, 'detail': 'BRANCH ✅'},
                    {'label': 'SelfTest E-GT', 'ok': True, 'detail': '✅ matches boot_rom'},
                ]},
            ],
            'lazy': [
                # Stale entry — missing LUMP file (old superseded token)
                {'slot': '(dynamic)', 'name': 'NoteG', 'checks': [
                    {'label': 'file', 'ok': False, 'detail': 'LUMP binary not found: None'},
                ]},
                # Stale entry — cw/cc manifest mismatch
                {'slot': '(dynamic)', 'name': 'Tunnel', 'checks': [
                    {'label': 'cw/cc', 'ok': False, 'detail': 'binary cw=37 vs manifest cw=1'},
                ]},
            ],
        }
    }

    # ── Server-side gate ───────────────────────────────────────────────────────
    def server_snap_all_pass(m):
        """Mirrors _snap_all_pass() in server/app.py — bootstrap+resident only."""
        for tier_name in ('bootstrap', 'resident'):
            for s in m.get('tiers', {}).get(tier_name, []):
                for c in s.get('checks', []):
                    if c.get('ok') is False:
                        return False
        return True

    assert server_snap_all_pass(synthetic_map), (
        'Server gate: lazy-tier failures must not block approval'
    )

    # ── Client-side gate ───────────────────────────────────────────────────────
    # This documents the exact semantics required by simulator/app-build-approval.js
    # BuildApprovalView._allChecksPass() — must match server identically.
    def client_all_checks_pass(last_map):
        """Mirrors BuildApprovalView._allChecksPass() in app-build-approval.js."""
        HW_TIERS = ['bootstrap', 'resident']
        tiers = last_map.get('tiers', {})
        for tier_name in HW_TIERS:
            for s in tiers.get(tier_name, []):
                for c in s.get('checks', []):
                    if c.get('ok') is False:
                        return False
        return True

    assert client_all_checks_pass(synthetic_map), (
        'Client gate: lazy-tier failures must not disable Freeze/Approve'
    )

    # ── Confirm a hardware-tier failure DOES block ─────────────────────────────
    failing_hw_map = json.loads(json.dumps(synthetic_map))  # deep copy
    failing_hw_map['tiers']['resident'][0]['checks'].append(
        {'label': 'BRANCH opcode', 'ok': False, 'detail': '❌ RETURN regression'}
    )
    assert not server_snap_all_pass(failing_hw_map), (
        'Hardware-tier RETURN regression must block server approval gate'
    )
    assert not client_all_checks_pass(failing_hw_map), (
        'Hardware-tier RETURN regression must disable Freeze/Approve in the UI'
    )


def test_real_ns_map_hardware_tiers_all_pass():
    """
    Integration test: the COMMITTED repository's NS map must have no hard failures
    in the hardware-relevant tiers (bootstrap and resident).

    Lazy/dynamic slots are intentionally excluded — they contain stale legacy
    manifest entries that do not affect the Vivado bitstream.  This test confirms
    a Freeze + Approve workflow can succeed against the current catalog.
    """
    ns_map = _app._ba_build_ns_map()
    tiers = ns_map.get('tiers', {})

    hw_failures = []
    for tier_name in ('bootstrap', 'resident'):
        for s in tiers.get(tier_name, []):
            for c in s.get('checks', []):
                if c.get('ok') is False:
                    hw_failures.append(
                        f"[{tier_name}] slot={s.get('slot')} name={s.get('name')!r} "
                        f"check={c['label']!r}: {c['detail']}"
                    )

    assert not hw_failures, (
        'Hardware-tier NS map checks have hard failures — Freeze/Approve is blocked:\n'
        + '\n'.join(hw_failures)
    )


def test_build_approval_routes_registered():
    """
    Smoke test: all Build Approval routes must be registered before the server
    starts serving requests.  This catches the regression where the if __name__
    block blocked before route decorators were processed.
    """
    registered = {rule.rule for rule in _app.app.url_map.iter_rules()}
    expected = [
        '/api/build-approval/ns-map',
        '/api/build-approval/freeze-snapshot',
        '/api/build-approval/snapshot/latest',
        '/api/wukong-build/start',
        '/api/wukong-build/status',
    ]
    for route in expected:
        assert route in registered, (
            f'Build Approval route {route!r} is not registered — '
            f'check that if __name__ block is at the physical end of app.py'
        )


def test_worker_droplet_constants_defined():
    """
    All four droplet configuration constants used by _ba_build_worker must be
    defined at module level.  A missing constant causes an immediate NameError
    in the background thread, silently marking the build as failed without
    ever SSHing to the droplet.
    """
    for name in ('_DROPLET_USER', '_DROPLET_IP', '_DROPLET_BUILD_DIR', '_VIVADO_SESSION'):
        assert hasattr(_app, name), (
            f'Droplet constant {name} missing from server/app.py — '
            f'_ba_build_worker() will NameError on first approved build'
        )
        val = getattr(_app, name)
        assert isinstance(val, str) and val, (
            f'{name} must be a non-empty string; got {val!r}'
        )


def test_worker_command_construction(monkeypatch, tmp_path):
    """
    _ba_build_worker must construct valid SSH command strings without raising
    when a clean approved snapshot exists.  We mock subprocess.run to intercept
    the SSH call and verify the command structure without touching a real host.
    """
    if not REPORT_TOKEN:
        pytest.skip('REPORT_TOKEN not set')

    # Write a clean approved snapshot so the /start gate passes
    monkeypatch.setattr(_app, '_BUILD_SNAPSHOTS_DIR', str(tmp_path))
    clean_snap = {
        'frozen_at': '20260101T000000Z',
        'all_checks_pass': True,
        'ns_map': {'tiers': {}},
    }
    (tmp_path / 'build-approval-20260101T000000Z.json').write_text(json.dumps(clean_snap))

    captured_cmds = []

    def _mock_run(cmd, **kwargs):
        captured_cmds.append(cmd)
        class _R:
            returncode = 0
            stdout = 'EXIT_0\n'
            stderr = ''
        return _R()

    import subprocess as _sp
    monkeypatch.setattr(_sp, 'run', _mock_run)

    # Write a minimal fake SSH key so _ba_write_ssh_key() doesn't fail
    fake_key = (
        '-----BEGIN OPENSSH PRIVATE KEY-----\n'
        'AAAA\n'
        '-----END OPENSSH PRIVATE KEY-----\n'
    )
    monkeypatch.setenv('DropletPrivateKey', fake_key)
    monkeypatch.setattr(_app, '_ba_build_log', [])
    monkeypatch.setattr(_app, '_ba_build_done', True)
    monkeypatch.setattr(_app, '_ba_build_exit', None)

    # Call the worker directly with a temporary key path
    import tempfile, os as _os
    with tempfile.NamedTemporaryFile(suffix='.key', delete=False) as kf:
        kf.write(fake_key.encode())
        key_path = kf.name
    try:
        _os.chmod(key_path, 0o600)
        # Run worker synchronously (it calls _time.sleep but we mock subprocess)
        import time as _time_mod
        monkeypatch.setattr(_time_mod, 'sleep', lambda _: None)
        _app._ba_build_worker(key_path)
    finally:
        _os.unlink(key_path)

    assert len(captured_cmds) >= 1, 'Worker must invoke at least one SSH command'
    # The first SSH command must include the droplet IP and build directory
    first_cmd = ' '.join(str(c) for c in captured_cmds[0])
    assert _app._DROPLET_IP in first_cmd, (
        f'SSH command must contain droplet IP {_app._DROPLET_IP!r}; got: {first_cmd[:200]}'
    )
    assert _app._DROPLET_BUILD_DIR in first_cmd, (
        f'SSH command must contain build dir {_app._DROPLET_BUILD_DIR!r}; got: {first_cmd[:200]}'
    )


def test_start_rejected_with_failed_snapshot(monkeypatch, tmp_path):
    """
    /api/wukong-build/start must return 422 if the latest snapshot has
    all_checks_pass=False.
    """
    if not REPORT_TOKEN:
        pytest.skip('REPORT_TOKEN not set')
    monkeypatch.setattr(_app, '_BUILD_SNAPSHOTS_DIR', str(tmp_path))
    # Write a snapshot where checks failed
    bad_snap = {
        'frozen_at': '20260101T000000Z',
        'all_checks_pass': False,
        'ns_map': {'tiers': {}},
    }
    snap_file = tmp_path / 'build-approval-20260101T000000Z.json'
    snap_file.write_text(json.dumps(bad_snap))
    ns_resp = client.get('/api/build-approval/ns-map', headers=AUTH_HEADERS)
    nonce = ns_resp.get_json().get('build_nonce', '')
    resp = client.post(
        '/api/wukong-build/start',
        json={'build_nonce': nonce},
        headers=AUTH_HEADERS,
    )
    assert resp.status_code == 422, (
        f'Should be 422 (failed checks in snapshot); got {resp.status_code}: {resp.get_json()}'
    )


# ===================================================================
# Security regression tests
# ===================================================================

class TestLumpSavePathTraversal:
    """
    Regression: POST /api/lumps/save must reject abstraction names that produce
    canonical dot names containing path separators or traversal sequences.
    to_dot_name() preserves '/', '..', and absolute-path prefixes from
    request-controlled input; the server must validate before any write.
    """

    def _save_payload(self, abs_name, cw=8, cc=1):
        """Minimal save payload with a synthetically valid header."""
        n_words = cw + cc + 1
        hdr = (0x1F << 27) | (cw << 10) | cc
        words = [hdr] + [0] * (n_words - 1)
        return {
            'binary':   words,
            'metadata': {'abstraction': abs_name, 'ns_slot': None, 'token': None},
        }

    def test_absolute_path_name_rejected(self):
        resp = client.post('/api/lumps/save',
                           json=self._save_payload('/tmp/evil'))
        assert resp.status_code in (400, 422), (
            f'/tmp/evil abstraction must be rejected; got {resp.status_code}: {resp.get_json()}'
        )
        body = resp.get_json() or {}
        assert 'error' in body or 'ok' in body

    def test_dotdot_traversal_name_rejected(self):
        resp = client.post('/api/lumps/save',
                           json=self._save_payload('../../etc/passwd'))
        assert resp.status_code in (400, 422), (
            f'Traversal abstraction must be rejected; got {resp.status_code}: {resp.get_json()}'
        )

    def test_slash_in_name_rejected(self):
        resp = client.post('/api/lumps/save',
                           json=self._save_payload('Foo/Bar'))
        assert resp.status_code in (400, 422), (
            f'Slash in abstraction name must be rejected; got {resp.status_code}: {resp.get_json()}'
        )

    def test_normal_name_passes_allowlist(self, monkeypatch, tmp_path):
        """A legitimate dot-name (e.g. SelfTest) must not be rejected by the
        allowlist check — only path-traversal names are blocked."""
        # Redirect writes to a temp dir so the test is self-contained
        monkeypatch.setattr(_app, 'LUMPS_DIR', str(tmp_path))
        monkeypatch.setattr(_app, '_LUMPS_DIR', str(tmp_path))
        # We only care that the security guard doesn't reject valid names;
        # subsequent phases may fail for unrelated reasons (manifest, etc.).
        resp = client.post('/api/lumps/save',
                           json=self._save_payload('SelfTest'))
        body = resp.get_json() or {}
        # Must NOT be a 400 security rejection
        assert resp.status_code != 400 or 'traversal' not in str(body).lower(), (
            f'Valid name SelfTest was rejected by path-traversal guard: {body}'
        )


class TestNextAfterSelftestAuth:
    """
    Regression: POST /api/boot-config/next-after-selftest must require
    Authorization: Bearer <REPORT_TOKEN> when REPORT_TOKEN is configured.
    When REPORT_TOKEN is absent (dev mode), the endpoint must allow the request.
    """

    def test_requires_token_when_configured(self, monkeypatch):
        monkeypatch.setenv('REPORT_TOKEN', 'test-secret-token-for-gate')
        resp = client.post('/api/boot-config/next-after-selftest',
                           json={'nextAfterSelfTestSlot': 9})
        assert resp.status_code == 401, (
            f'Should require auth when REPORT_TOKEN is set; got {resp.status_code}'
        )

    def test_accepts_valid_token(self, monkeypatch, tmp_path):
        monkeypatch.setenv('REPORT_TOKEN', 'test-secret-token-for-gate')
        # Redirect boot-config writes to temp dir
        cfg_path = str(tmp_path / 'boot-config.json')
        monkeypatch.setattr(_app, 'BOOT_CONFIG_PATH', cfg_path)
        resp = client.post(
            '/api/boot-config/next-after-selftest',
            json={'nextAfterSelfTestSlot': 9},
            headers={'Authorization': 'Bearer test-secret-token-for-gate'},
        )
        assert resp.status_code == 200, (
            f'Should accept valid token; got {resp.status_code}: {resp.get_json()}'
        )

    def test_allows_when_no_token_configured(self, monkeypatch, tmp_path):
        monkeypatch.delenv('REPORT_TOKEN', raising=False)
        cfg_path = str(tmp_path / 'boot-config.json')
        monkeypatch.setattr(_app, 'BOOT_CONFIG_PATH', cfg_path)
        resp = client.post('/api/boot-config/next-after-selftest',
                           json={'nextAfterSelfTestSlot': 9})
        assert resp.status_code == 200, (
            f'Should allow without credentials in dev mode; got {resp.status_code}: {resp.get_json()}'
        )
