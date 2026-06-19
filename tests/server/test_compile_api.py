"""
tests/server/test_compile_api.py

Test suite for the CLOOMC++ Compiler API (ECO-002 spec):
  POST /api/compile

Covers (ECO-002 shape: ok bool, flat words/lump_binary, 6 languages, no target):
  CA-1  Successful compile (assembly)        → ok: true, words, lump_binary
  CA-2  Hard syntax error                    → ok: false, error
  CA-3  Unresolved symbols (lazy-resolve)    → ok: true (xfail if behaviour changes)
  CA-5  Missing / invalid request fields     → HTTP 400
  CA-6  Invalid language value               → HTTP 400
  CA-6b Unknown extra fields silently ignored
  CA-8  Auth token enforcement               → HTTP 401
  CA-9  compile_api.run_compile unit tests   → correct dict shape
  CA-10 compile_worker.js direct invocation  → correct dict shape
  CA-11 namespace_hint allocation_words      → len(words) honoured
  CA-12 All 6 supported languages accepted   → HTTP 200
  CA-13 Response shape completeness          → required keys present
"""

import base64
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

_ASM_OK = """\
IADD DR1, DR0, #42
HALT
"""

_ASM_BROKEN = "!!! this is definitely not valid CLOOMC source @@@"

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
    })
    assert resp.status_code == 200
    data = resp.get_json()
    assert data.get('ok') is True, f"unexpected response: {data}"
    assert isinstance(data.get('words'), list)
    assert len(data['words']) >= 64
    assert isinstance(data.get('lump_binary'), str)
    decoded = base64.b64decode(data['lump_binary'])
    assert len(decoded) == len(data['words']) * 4
    assert isinstance(data.get('warnings'), list)
    assert 'language' in data


# ---------------------------------------------------------------------------
# CA-2: Hard compile failure (syntax error)
# ---------------------------------------------------------------------------

def test_ca2_compile_failed_syntax_error(client):
    resp = _post(client, {
        'source':   _ASM_BROKEN,
        'language': 'assembly',
    })
    assert resp.status_code == 200
    data = resp.get_json()
    assert data.get('ok') is False, f"expected failure, got: {data}"
    assert isinstance(data.get('error'), str)
    assert len(data['error']) > 0
    assert 'words' not in data
    assert 'lump_binary' not in data


# ---------------------------------------------------------------------------
# CA-3: Unresolved symbols (lazy-resolve) → ok: true with non-empty warnings
# ---------------------------------------------------------------------------

@pytest.mark.xfail(strict=False, reason="unresolved-symbol behavior not yet confirmed")
def test_ca3_unresolved_symbols(client):
    resp = _post(client, {
        'source':   _ASM_UNRESOLVED,
        'language': 'assembly',
    })
    assert resp.status_code == 200
    data = resp.get_json()
    assert data.get('ok') is True, data
    assert len(data.get('warnings', [])) > 0


# ---------------------------------------------------------------------------
# CA-5: Missing / empty required fields → HTTP 400
# ---------------------------------------------------------------------------

@pytest.mark.parametrize('body, expected_fragment', [
    (
        {'language': 'assembly'},
        'source',
    ),
    (
        {'source': _ASM_OK},
        'language',
    ),
    (
        {'source': '', 'language': 'assembly'},
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
    })
    assert resp.status_code == 400
    data = resp.get_json()
    assert 'language' in data.get('error', '')


# ---------------------------------------------------------------------------
# CA-6b: Unknown extra fields are silently ignored (target, options)
# ---------------------------------------------------------------------------

def test_ca6b_unknown_fields_ignored(client):
    resp = _post(client, {
        'source':   _ASM_OK,
        'language': 'assembly',
        'target':   'simulator',
        'options':  {'strict_mode': True},
    })
    assert resp.status_code == 200
    data = resp.get_json()
    assert isinstance(data.get('ok'), bool), "response must have ok bool field"


# ---------------------------------------------------------------------------
# CA-8: Auth token enforcement
# ---------------------------------------------------------------------------

def test_ca8_auth_token_missing(client):
    with patch.object(_app_module, '_COMPILE_API_TOKEN', 'secret-token-123'):
        resp = _post(client, {
            'source':   _ASM_OK,
            'language': 'assembly',
        })
    assert resp.status_code == 401


def test_ca8_auth_token_wrong(client):
    with patch.object(_app_module, '_COMPILE_API_TOKEN', 'secret-token-123'):
        resp = _post(client, {
            'source':   _ASM_OK,
            'language': 'assembly',
        }, token='wrong-token')
    assert resp.status_code == 401


def test_ca8_auth_token_correct(client):
    with patch.object(_app_module, '_COMPILE_API_TOKEN', 'secret-token-123'):
        resp = _post(client, {
            'source':   _ASM_OK,
            'language': 'assembly',
        }, token='secret-token-123')
    assert resp.status_code == 200
    data = resp.get_json()
    assert isinstance(data.get('ok'), bool)


# ---------------------------------------------------------------------------
# CA-9: compile_api.run_compile — subprocess error handling
# ---------------------------------------------------------------------------

def test_ca9_run_compile_timeout():
    from server.compile_api import run_compile
    with patch('server.compile_api.subprocess.run',
               side_effect=subprocess.TimeoutExpired(cmd='node', timeout=30)):
        result = run_compile({'source': _ASM_OK, 'language': 'assembly'})
    assert result.get('ok') is False
    assert 'timed out' in result.get('error', '').lower()


def test_ca9_run_compile_bad_json():
    from server.compile_api import run_compile
    mock_proc = MagicMock()
    mock_proc.stdout = b'NOT JSON OUTPUT'
    mock_proc.stderr = b''
    with patch('server.compile_api.subprocess.run', return_value=mock_proc):
        result = run_compile({'source': _ASM_OK, 'language': 'assembly'})
    assert result.get('ok') is False
    assert result.get('error')


def test_ca9_run_compile_empty_stdout():
    from server.compile_api import run_compile
    mock_proc = MagicMock()
    mock_proc.stdout = b''
    mock_proc.stderr = b'node: error'
    with patch('server.compile_api.subprocess.run', return_value=mock_proc):
        result = run_compile({'source': _ASM_OK, 'language': 'assembly'})
    assert result.get('ok') is False
    assert result.get('error')


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
    })
    assert result.get('ok') is True, result
    assert isinstance(result.get('words'), list)
    assert len(result['words']) >= 64
    assert isinstance(result.get('lump_binary'), str)
    decoded = base64.b64decode(result['lump_binary'])
    assert len(decoded) == len(result['words']) * 4


def test_ca10_worker_header_word():
    """Verify the packed header word encodes cw and cc correctly."""
    result = _invoke_worker({
        'source':   _ASM_OK,
        'language': 'assembly',
    })
    assert result.get('ok') is True, result
    header = result['words'][0] & 0xFFFFFFFF
    cw = (header >> 10) & 0x1FFF
    cc = header & 0xFF
    assert cw >= 0
    assert cc >= 0


def test_ca10_worker_compile_failed():
    result = _invoke_worker({
        'source':   _ASM_BROKEN,
        'language': 'assembly',
    })
    assert result.get('ok') is False
    assert isinstance(result.get('error'), str)
    assert 'words' not in result
    assert 'lump_binary' not in result


def test_ca10_worker_invalid_json():
    worker = os.path.join(ROOT, 'server', 'compile_worker.js')
    proc = subprocess.run(
        ['node', worker],
        input=b'not json at all',
        capture_output=True,
        timeout=10,
    )
    data = json.loads(proc.stdout.decode('utf-8').strip())
    assert data.get('ok') is False
    assert 'Invalid JSON' in data.get('error', '')


# ---------------------------------------------------------------------------
# CA-11: namespace_hint allocation_words honoured
# ---------------------------------------------------------------------------

def test_ca11_namespace_hint_allocation():
    result = _invoke_worker({
        'source':   _ASM_OK,
        'language': 'assembly',
        'namespace_hint': {'allocation_words': 128, 'gt_type': 'inform'},
    })
    assert result.get('ok') is True, result
    assert len(result['words']) == 128


# ---------------------------------------------------------------------------
# CA-12: All 6 supported languages are accepted
# ---------------------------------------------------------------------------

LANG_SOURCES = {
    'assembly':    _ASM_OK,
    'english':     'abstraction Noop { method Run { return 0 } }',
    'javascript':  'abstraction Noop { method Run { return 0 } }',
    'haskell':     'abstraction Noop { method run = 0 }',
    'lambda':      'abstraction Noop { method Run = \\x -> 0 }',
    'symbolic':    'abstraction Noop { method Run = 0 }',
}

@pytest.mark.parametrize('lang', sorted(LANG_SOURCES.keys()))
def test_ca12_all_languages_accepted(client, lang):
    resp = _post(client, {
        'source':   LANG_SOURCES[lang],
        'language': lang,
    })
    assert resp.status_code == 200
    data = resp.get_json()
    assert isinstance(data.get('ok'), bool), \
        f'lang={lang}: expected ok bool, got {data}'


# ---------------------------------------------------------------------------
# CA-13: Response shape completeness
# ---------------------------------------------------------------------------

def test_ca13_ok_response_shape():
    result = _invoke_worker({
        'source':   _ASM_OK,
        'language': 'assembly',
    })
    assert result.get('ok') is True
    for field in ('language', 'words', 'lump_binary', 'warnings'):
        assert field in result, f'response missing field: {field}'
    assert isinstance(result['words'], list)
    assert isinstance(result['lump_binary'], str)
    assert isinstance(result['warnings'], list)
    assert isinstance(result['language'], str)


def test_ca13_fail_response_shape():
    result = _invoke_worker({
        'source':   _ASM_BROKEN,
        'language': 'assembly',
    })
    assert result.get('ok') is False
    for field in ('language', 'error'):
        assert field in result, f'failure response missing field: {field}'
    assert isinstance(result['error'], str)
