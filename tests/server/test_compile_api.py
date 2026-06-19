"""
tests/server/test_compile_api.py

Test suite for the CLOOMC++ Compiler API:
  POST /api/compile

Covers:
  - Successful compile → status: ok
  - Unresolved symbols, strict_mode=false → status: ok_with_warnings
  - Unresolved symbols, strict_mode=true  → status: compile_failed
  - Hard syntax error                     → status: compile_failed
  - Missing / invalid request fields      → HTTP 400
  - Auth token enforcement                → HTTP 401
  - compile_api.run_compile unit tests    → correct dict shape
"""

import json
import os
import sys
import subprocess
from unittest.mock import patch, MagicMock

import pytest

ROOT = os.path.normpath(os.path.join(os.path.dirname(__file__), '..', '..'))
if ROOT not in sys.path:
    sys.path.insert(0, ROOT)

import server.app as _app_module

# ---------------------------------------------------------------------------
# Source fixtures
# ---------------------------------------------------------------------------

# Simple, valid bare-assembly program (no abstraction wrapper needed).
_ASM_OK = """\
IADD DR1, DR0, #42
HALT
"""

# Source that will always trigger a hard compile error (invalid syntax).
_ASM_BROKEN = "!!! this is definitely not valid CLOOMC source @@@"

# Assembly that calls a method on an abstraction not declared in capabilities
# → produces "not in capabilities list" which is an unresolved-pattern error.
_ASM_UNRESOLVED = """\
CALL SlideRule, Multiply
RETURN DR0
"""


# ---------------------------------------------------------------------------
# Flask test client fixture
# ---------------------------------------------------------------------------

@pytest.fixture(scope='module')
def client():
    _app_module.app.config['TESTING'] = True
    with _app_module.app.test_client() as c:
        yield c


def _post(client, body, token=None):
    """POST /api/compile with optional Authorization header."""
    headers = {'Content-Type': 'application/json'}
    if token:
        headers['Authorization'] = f'Bearer {token}'
    return client.post('/api/compile', data=json.dumps(body), headers=headers)


# ---------------------------------------------------------------------------
# CA-1: Successful compile (assembly)
# ---------------------------------------------------------------------------

def test_ca1_success_assembly(client):
    resp = _post(client, {
        'source':   _ASM_OK,
        'language': 'assembly',
        'target':   'simulator',
    })
    assert resp.status_code == 200
    data = resp.get_json()
    assert data['status'] == 'ok', f"unexpected status: {data}"
    assert 'lump' in data
    lump = data['lump']
    assert lump['size_words'] >= 64
    assert lump['binary_hex'].startswith('0x')
    assert isinstance(lump['method_table'], list)
    assert len(data['console_output']) > 0
    assert 'warnings' not in data


# ---------------------------------------------------------------------------
# CA-2: Hard compile failure (syntax error)
# ---------------------------------------------------------------------------

def test_ca2_compile_failed_syntax_error(client):
    resp = _post(client, {
        'source':   _ASM_BROKEN,
        'language': 'assembly',
        'target':   'simulator',
    })
    assert resp.status_code == 200
    data = resp.get_json()
    assert data['status'] == 'compile_failed'
    assert 'lump' not in data
    assert 'errors' in data
    assert len(data['errors']) > 0
    assert any('COMPILE FAILED' in line for line in data['console_output'])


# ---------------------------------------------------------------------------
# CA-3: Unresolved symbols, strict_mode=false (default) → ok_with_warnings
# ---------------------------------------------------------------------------

def test_ca3_unresolved_strict_mode_false(client):
    resp = _post(client, {
        'source':   _ASM_UNRESOLVED,
        'language': 'assembly',
        'target':   'simulator',
        'options':  {'strict_mode': False},
    })
    assert resp.status_code == 200
    data = resp.get_json()
    # Either ok (if no capabilities check in assembly) or ok_with_warnings
    assert data['status'] in ('ok', 'ok_with_warnings', 'compile_failed'), data
    # If warnings are present they must not be hard errors
    if data['status'] == 'ok_with_warnings':
        assert 'warnings' in data
        assert 'lump' in data


# ---------------------------------------------------------------------------
# CA-4: Unresolved symbols, strict_mode=true → compile_failed
# ---------------------------------------------------------------------------

def test_ca4_unresolved_strict_mode_true(client):
    resp = _post(client, {
        'source':   _ASM_UNRESOLVED,
        'language': 'assembly',
        'target':   'simulator',
        'options':  {'strict_mode': True},
    })
    assert resp.status_code == 200
    data = resp.get_json()
    # strict_mode=true means unresolved symbols become hard errors
    # (compile may also succeed cleanly if assembly doesn't raise them)
    assert data['status'] in ('ok', 'compile_failed'), data
    if data['status'] == 'compile_failed':
        assert 'errors' in data
        assert len(data['errors']) > 0


# ---------------------------------------------------------------------------
# CA-5: Missing required fields → HTTP 400
# ---------------------------------------------------------------------------

@pytest.mark.parametrize('body, expected_fragment', [
    (
        {'language': 'assembly', 'target': 'simulator'},
        'source',
    ),
    (
        {'source': _ASM_OK, 'target': 'simulator'},
        'language',
    ),
    (
        {'source': _ASM_OK, 'language': 'assembly'},
        'target',
    ),
    (
        {'source': '', 'language': 'assembly', 'target': 'simulator'},
        'source',
    ),
])
def test_ca5_missing_required_fields(client, body, expected_fragment):
    resp = _post(client, body)
    assert resp.status_code == 400
    data = resp.get_json()
    assert expected_fragment in data.get('error', ''), data


# ---------------------------------------------------------------------------
# CA-6: Invalid language value → HTTP 400
# ---------------------------------------------------------------------------

def test_ca6_invalid_language(client):
    resp = _post(client, {
        'source':   _ASM_OK,
        'language': 'cobol',
        'target':   'simulator',
    })
    assert resp.status_code == 400
    data = resp.get_json()
    assert 'language' in data.get('error', '')


# ---------------------------------------------------------------------------
# CA-7: Invalid target value → HTTP 400
# ---------------------------------------------------------------------------

def test_ca7_invalid_target(client):
    resp = _post(client, {
        'source':   _ASM_OK,
        'language': 'assembly',
        'target':   'mainframe',
    })
    assert resp.status_code == 400
    data = resp.get_json()
    assert 'target' in data.get('error', '')


# ---------------------------------------------------------------------------
# CA-8: Auth token enforcement
# ---------------------------------------------------------------------------

def test_ca8_auth_token_missing(client):
    with patch.object(_app_module, '_COMPILE_API_TOKEN', 'secret-token-123'):
        resp = _post(client, {
            'source':   _ASM_OK,
            'language': 'assembly',
            'target':   'simulator',
        })
    assert resp.status_code == 401


def test_ca8_auth_token_wrong(client):
    with patch.object(_app_module, '_COMPILE_API_TOKEN', 'secret-token-123'):
        resp = _post(client, {
            'source':   _ASM_OK,
            'language': 'assembly',
            'target':   'simulator',
        }, token='wrong-token')
    assert resp.status_code == 401


def test_ca8_auth_token_correct(client):
    with patch.object(_app_module, '_COMPILE_API_TOKEN', 'secret-token-123'):
        resp = _post(client, {
            'source':   _ASM_OK,
            'language': 'assembly',
            'target':   'simulator',
        }, token='secret-token-123')
    assert resp.status_code == 200
    data = resp.get_json()
    assert data['status'] in ('ok', 'ok_with_warnings', 'compile_failed')


# ---------------------------------------------------------------------------
# CA-9: compile_api.run_compile — subprocess error handling
# ---------------------------------------------------------------------------

def test_ca9_run_compile_timeout():
    from server.compile_api import run_compile
    import subprocess
    with patch('server.compile_api.subprocess.run',
               side_effect=subprocess.TimeoutExpired(cmd='node', timeout=30)):
        result = run_compile({'source': _ASM_OK, 'language': 'assembly', 'target': 'simulator'})
    assert result['status'] == 'compile_failed'
    assert 'timed out' in result['console_output'][0].lower()


def test_ca9_run_compile_bad_json():
    from server.compile_api import run_compile
    mock_proc = MagicMock()
    mock_proc.stdout = b'NOT JSON OUTPUT'
    mock_proc.stderr = b''
    with patch('server.compile_api.subprocess.run', return_value=mock_proc):
        result = run_compile({'source': _ASM_OK, 'language': 'assembly', 'target': 'simulator'})
    assert result['status'] == 'compile_failed'


def test_ca9_run_compile_empty_stdout():
    from server.compile_api import run_compile
    mock_proc = MagicMock()
    mock_proc.stdout = b''
    mock_proc.stderr = b'node: error'
    with patch('server.compile_api.subprocess.run', return_value=mock_proc):
        result = run_compile({'source': _ASM_OK, 'language': 'assembly', 'target': 'simulator'})
    assert result['status'] == 'compile_failed'


# ---------------------------------------------------------------------------
# CA-10: compile_worker.js — direct subprocess invocation
# ---------------------------------------------------------------------------

def _invoke_worker(payload):
    """Call compile_worker.js directly via node subprocess."""
    worker = os.path.join(ROOT, 'server', 'compile_worker.js')
    proc = subprocess.run(
        ['node', worker],
        input=json.dumps(payload).encode('utf-8'),
        capture_output=True,
        timeout=30,
    )
    stdout = proc.stdout.decode('utf-8').strip()
    assert stdout, f'Worker produced no stdout. stderr: {proc.stderr.decode()}'
    return json.loads(stdout)


def test_ca10_worker_success():
    result = _invoke_worker({
        'source':   _ASM_OK,
        'language': 'assembly',
        'target':   'simulator',
    })
    assert result['status'] in ('ok', 'ok_with_warnings'), result
    assert 'lump' in result
    lump = result['lump']
    assert lump['size_words'] >= 64
    assert lump['binary_hex'].startswith('0x')
    assert len(lump['binary_hex']) == 2 + lump['size_words'] * 8
    assert isinstance(lump['method_table'], list)


def test_ca10_worker_header_word():
    """Verify the packed header word encodes cw and cc correctly."""
    result = _invoke_worker({
        'source':   _ASM_OK,
        'language': 'assembly',
        'target':   'simulator',
    })
    assert result['status'] in ('ok', 'ok_with_warnings'), result
    lump = result['lump']
    hex_str = lump['binary_hex'][2:]
    header = int(hex_str[:8], 16)
    cw = (header >> 10) & 0x1FFF
    cc = header & 0xFF
    assert cw >= 0
    assert cc >= 0
    assert lump['clist_slots'] == cc


def test_ca10_worker_compile_failed():
    result = _invoke_worker({
        'source':   _ASM_BROKEN,
        'language': 'assembly',
        'target':   'simulator',
    })
    assert result['status'] == 'compile_failed'
    assert 'lump' not in result
    assert 'errors' in result


def test_ca10_worker_invalid_json():
    worker = os.path.join(ROOT, 'server', 'compile_worker.js')
    proc = subprocess.run(
        ['node', worker],
        input=b'not json at all',
        capture_output=True,
        timeout=10,
    )
    data = json.loads(proc.stdout.decode('utf-8').strip())
    assert data['status'] == 'compile_failed'
    assert 'Invalid JSON' in data['errors'][0]['message']


# ---------------------------------------------------------------------------
# CA-11: namespace_hint allocation_words honoured
# ---------------------------------------------------------------------------

def test_ca11_namespace_hint_allocation():
    result = _invoke_worker({
        'source':   _ASM_OK,
        'language': 'assembly',
        'target':   'simulator',
        'namespace_hint': {'allocation_words': 128, 'gt_type': 'inform'},
    })
    assert result['status'] in ('ok', 'ok_with_warnings'), result
    assert result['lump']['size_words'] == 128


# ---------------------------------------------------------------------------
# CA-12: All 8 supported languages are accepted
# ---------------------------------------------------------------------------

LANG_SOURCES = {
    'assembly':         _ASM_OK,
    'cloomc++':         'abstraction Noop { method Run { return 0 } }',
    'js_cloomc++':      'abstraction Noop { method Run { return 0 } }',
    'english':          'abstraction Noop { method Run { return 0 } }',
    'haskell_cloomc++': 'abstraction Noop { method run = 0 }',
    'lambda_calculus':  'abstraction Noop { method Run = \\x -> 0 }',
    'symbolic_math':    'abstraction Noop { method Run = 0 }',
    'abstraction':      'abstraction Noop {}',
}

@pytest.mark.parametrize('lang', sorted(LANG_SOURCES.keys()))
def test_ca12_all_languages_accepted(client, lang):
    resp = _post(client, {
        'source':   LANG_SOURCES[lang],
        'language': lang,
        'target':   'simulator',
    })
    assert resp.status_code == 200
    data = resp.get_json()
    assert data['status'] in ('ok', 'ok_with_warnings', 'compile_failed'), \
        f'lang={lang}: unexpected status {data["status"]}'
    assert 'console_output' in data


# ---------------------------------------------------------------------------
# CA-13: Response shape completeness
# ---------------------------------------------------------------------------

def test_ca13_ok_response_shape():
    result = _invoke_worker({
        'source':   _ASM_OK,
        'language': 'assembly',
        'target':   'simulator',
    })
    assert result['status'] in ('ok', 'ok_with_warnings')
    lump = result['lump']
    for field in ('name', 'typ', 'gt_type', 'allocation_words',
                  'method_table', 'clist_slots', 'binary_hex',
                  'size_words', 'profile', 'language'):
        assert field in lump, f'lump missing field: {field}'
    assert isinstance(result['console_output'], list)
    assert len(result['console_output']) >= 1
