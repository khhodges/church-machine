"""
tests/server/test_compile_endpoint.py

Flask test-client unit tests for POST /api/compile.

These tests run entirely in-process via the Flask test client — no live
server or network is required.  They cover the basic contract:

  1. A known-good CLOOMC++ snippet (multi-line, method with parentheses)
     → ok=True, methods non-empty, words non-empty.
  2. A broken CLOOMC++ snippet → ok=False, errors non-empty.
  3. A known-good Assembly snippet → ok=True, words non-empty.
  4. Bad / missing input fields → HTTP 400.
  5. English natural-language source → ok=True.

Important syntax note:
  The CLOOMC++ JS compiler (_parseAbstraction) requires multi-line source
  with parenthesised method signatures:
      abstraction Name {
          method run() {
              return 42;
          }
      }
  Single-line and parens-free forms ('method Run { ... }') do not parse
  in compileJS() and produce ok=True with an empty dispatch table.
  All tests below use the canonical multi-line form.
"""

import base64
import json
import os
import sys
from concurrent.futures import ThreadPoolExecutor, as_completed
from unittest.mock import patch, MagicMock

import pytest

ROOT = os.path.normpath(os.path.join(os.path.dirname(__file__), '..', '..'))
if ROOT not in sys.path:
    sys.path.insert(0, ROOT)

from server.app import app

# server/app.py does `from compile_api import …` (bare name), so the module is
# registered in sys.modules as 'compile_api', not 'server.compile_api'.
# Import it the same way so our cache/patch targets the exact same object.
import sys
import importlib
if 'compile_api' not in sys.modules:
    importlib.import_module('compile_api')
import compile_api  # noqa: E402  (same object the Flask app uses)


# ---------------------------------------------------------------------------
# Source fixtures
# ---------------------------------------------------------------------------

# Multi-line CLOOMC++ with parenthesised method signatures — parses correctly
_JS_OK = """\
abstraction Adder {
    method add() {
        return 1 + 2;
    }
}
"""

_JS_MULTI = """\
abstraction Math {
    method zero() {
        return 0;
    }
    method one() {
        return 1;
    }
}
"""

_JS_BROKEN = '!!! this is definitely not valid CLOOMC source @@@'

_ASM_OK = """\
IADD DR1, DR0, #42
RETURN
"""

# Natural-English source for the 'english' language path
_ENGLISH_OK = """\
Create an abstraction called Greeter
Add a method called Run
  return 1
"""


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

@pytest.fixture(scope='module')
def client():
    """Yield a Flask test client with testing mode enabled."""
    app.config['TESTING'] = True
    with app.test_client() as c:
        yield c


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _post(client, source, language, **extra):
    payload = {'source': source, 'language': language, **extra}
    resp = client.post(
        '/api/compile',
        data=json.dumps(payload),
        content_type='application/json',
    )
    return resp


# ---------------------------------------------------------------------------
# Success cases — CLOOMC++ / javascript language
# ---------------------------------------------------------------------------

def test_cloomc_good_source_returns_ok(client):
    """A valid multi-line CLOOMC++ abstraction compiles with non-empty methods."""
    resp = _post(client, _JS_OK, 'javascript')
    assert resp.status_code == 200
    data = resp.get_json()
    assert data['ok'] is True, f"Expected ok=True, got: {data}"
    assert isinstance(data['words'], list), 'words must be a list'
    assert len(data['words']) > 0, 'words must be non-empty'
    # A properly-parsed multi-line CLOOMC++ abstraction produces at least 1 method
    assert len(data.get('methods', [])) >= 1, (
        f"Expected at least 1 method in LUMP, got methods={data.get('methods')}"
    )


def test_cloomc_words_are_unsigned_integers(client):
    """All words in the response must be non-negative integers."""
    resp = _post(client, _JS_OK, 'javascript')
    data = resp.get_json()
    assert data['ok'] is True
    assert all(isinstance(w, int) and w >= 0 for w in data['words']), (
        'all words must be non-negative integers'
    )


def test_cloomc_lump_binary_is_valid_base64(client):
    """lump_binary must decode to exactly words×4 bytes (big-endian words)."""
    resp = _post(client, _JS_OK, 'javascript')
    data = resp.get_json()
    assert data['ok'] is True
    lump_b64 = data.get('lump_binary')
    assert isinstance(lump_b64, str), 'lump_binary must be a string'
    decoded = base64.b64decode(lump_b64)
    assert len(decoded) == len(data['words']) * 4, (
        f'lump_binary length {len(decoded)} != words*4 {len(data["words"])*4}'
    )


def test_cloomc_warnings_field_present(client):
    """Response always includes a warnings list, even when empty."""
    resp = _post(client, _JS_OK, 'javascript')
    data = resp.get_json()
    assert data['ok'] is True
    assert 'warnings' in data, 'response must include a warnings field'
    assert isinstance(data['warnings'], list)


def test_cloomc_language_echoed(client):
    """Response language field reflects what the compiler detected."""
    resp = _post(client, _JS_OK, 'javascript')
    data = resp.get_json()
    assert data['ok'] is True
    assert isinstance(data.get('language'), str), 'language field must be a string'


def test_cloomc_abstraction_name_returned(client):
    """abstractionName must be echoed back when compilation succeeds."""
    resp = _post(client, _JS_OK, 'javascript')
    data = resp.get_json()
    assert data['ok'] is True
    assert data.get('abstractionName') == 'Adder', (
        f"abstractionName mismatch: {data.get('abstractionName')!r}"
    )


def test_cloomc_minimum_lump_size(client):
    """A CLOOMC lump is always at least 64 words (power-of-2 minimum)."""
    resp = _post(client, _JS_OK, 'javascript')
    data = resp.get_json()
    assert data['ok'] is True
    assert len(data['words']) >= 64, (
        f"lump must be at least 64 words, got {len(data['words'])}"
    )


def test_cloomc_multi_method_abstraction(client):
    """Multiple methods are compiled and appear in the response."""
    resp = _post(client, _JS_MULTI, 'javascript')
    data = resp.get_json()
    assert data['ok'] is True
    assert len(data.get('methods', [])) >= 2, (
        f"Expected ≥2 methods, got {data.get('methods')}"
    )


# ---------------------------------------------------------------------------
# Compile-error cases (ok=False, HTTP 200)
# ---------------------------------------------------------------------------

def test_broken_cloomc_returns_ok_false(client):
    """A source that fails to compile returns ok=False, HTTP 200."""
    resp = _post(client, _JS_BROKEN, 'javascript')
    assert resp.status_code == 200, f"expected HTTP 200, got {resp.status_code}"
    data = resp.get_json()
    assert data['ok'] is False, f"Expected ok=False, got: {data}"


def test_broken_cloomc_error_field(client):
    """A failed compile returns a non-empty error string."""
    resp = _post(client, _JS_BROKEN, 'javascript')
    data = resp.get_json()
    assert data['ok'] is False
    assert isinstance(data.get('error'), str) and len(data['error']) > 0, (
        f'Expected non-empty error string, got: {data}'
    )


def test_broken_cloomc_no_words_on_failure(client):
    """A failed compile must NOT include a words array."""
    resp = _post(client, _JS_BROKEN, 'javascript')
    data = resp.get_json()
    assert data['ok'] is False
    assert 'words' not in data, 'words must not appear in a failed compile response'
    assert 'lump_binary' not in data, 'lump_binary must not appear in a failed compile response'


# ---------------------------------------------------------------------------
# namespace_hint.allocation_words
# ---------------------------------------------------------------------------

def test_namespace_hint_allocation_words(client):
    """namespace_hint.allocation_words requests a specific lump size."""
    resp = _post(client, _JS_OK, 'javascript',
                 namespace_hint={'allocation_words': 128})
    data = resp.get_json()
    assert data['ok'] is True
    assert len(data['words']) == 128, (
        f"Expected 128 words, got {len(data['words'])}"
    )


# ---------------------------------------------------------------------------
# Assembly language
# ---------------------------------------------------------------------------

def test_assembly_good_source_returns_ok(client):
    """A valid Assembly snippet compiles successfully."""
    resp = _post(client, _ASM_OK, 'assembly')
    assert resp.status_code == 200
    data = resp.get_json()
    assert data['ok'] is True, f"Expected ok=True, got: {data}"
    assert isinstance(data['words'], list)
    assert len(data['words']) >= 64


def test_assembly_lump_binary_consistent(client):
    """Assembly lump_binary decodes to exactly words×4 bytes."""
    resp = _post(client, _ASM_OK, 'assembly')
    data = resp.get_json()
    assert data['ok'] is True
    decoded = base64.b64decode(data['lump_binary'])
    assert len(decoded) == len(data['words']) * 4


def test_assembly_bad_mnemonic_returns_ok_false(client):
    """An unknown mnemonic causes a compile failure."""
    resp = _post(client, 'FROBULATE DR0, DR1', 'assembly')
    assert resp.status_code == 200
    data = resp.get_json()
    assert data['ok'] is False, f"Expected ok=False for bad mnemonic, got: {data}"
    assert isinstance(data.get('error'), str) and len(data['error']) > 0


# ---------------------------------------------------------------------------
# English (natural-language source via compile() auto-detect)
# ---------------------------------------------------------------------------

def test_english_natural_language_source(client):
    """English natural-language prose compiles successfully."""
    resp = _post(client, _ENGLISH_OK, 'english')
    assert resp.status_code == 200
    data = resp.get_json()
    # compile() auto-detect handles both English prose and CLOOMC++ source
    assert isinstance(data.get('ok'), bool)
    if data['ok']:
        assert len(data.get('words', [])) > 0
        assert isinstance(data.get('lump_binary'), str)


def test_english_cloomc_source_accepted(client):
    """CLOOMC++ source submitted with language='english' returns HTTP 200 ok."""
    # compile() auto-detect is used for english so CLOOMC++ source compiles too
    src = 'abstraction Noop {\n    method run() {\n        return 0;\n    }\n}'
    resp = _post(client, src, 'english')
    assert resp.status_code == 200
    data = resp.get_json()
    assert data['ok'] is True, (
        f"CLOOMC++ source with language='english' should compile ok, got: {data}"
    )
    assert len(data['words']) > 0


# ---------------------------------------------------------------------------
# Input-validation errors → HTTP 400
# ---------------------------------------------------------------------------

def test_missing_source_field_returns_400(client):
    """Request without a source field must return HTTP 400."""
    resp = client.post(
        '/api/compile',
        data=json.dumps({'language': 'javascript'}),
        content_type='application/json',
    )
    assert resp.status_code == 400, (
        f"missing source should return 400, got {resp.status_code}"
    )


def test_empty_source_returns_400(client):
    """An empty source string must return HTTP 400."""
    resp = _post(client, '', 'javascript')
    assert resp.status_code == 400, (
        f"empty source should return 400, got {resp.status_code}"
    )


def test_missing_language_field_returns_400(client):
    """Request without a language field must return HTTP 400."""
    resp = client.post(
        '/api/compile',
        data=json.dumps({'source': _JS_OK}),
        content_type='application/json',
    )
    assert resp.status_code == 400, (
        f"missing language should return 400, got {resp.status_code}"
    )


def test_invalid_language_value_returns_400(client):
    """An unrecognised language value must return HTTP 400."""
    resp = _post(client, _JS_OK, 'cobol')
    assert resp.status_code == 400, (
        f"invalid language 'cobol' should return 400, got {resp.status_code}"
    )


def test_non_json_body_returns_400(client):
    """A non-JSON body must return HTTP 400."""
    resp = client.post(
        '/api/compile',
        data='not json at all',
        content_type='text/plain',
    )
    assert resp.status_code == 400, (
        f"non-JSON body should return 400, got {resp.status_code}"
    )


def test_extra_fields_are_ignored(client):
    """Unknown fields in the request body are silently ignored."""
    resp = _post(client, _JS_OK, 'javascript', unknown_field='yes', another=42)
    assert resp.status_code == 200
    data = resp.get_json()
    assert isinstance(data.get('ok'), bool), f'unexpected response: {data}'

def _load_fixture(name):
    """Load a golden fixture from tests/server/fixtures/<name>.json."""
    fixture_path = os.path.join(_FIXTURES_DIR, f'{name}.json')
    with open(fixture_path, 'r', encoding='utf-8') as fh:
        return json.load(fh)


# ---------------------------------------------------------------------------
# LRU cache — identical requests must not re-spawn Node
# ---------------------------------------------------------------------------

def test_cache_hit_does_not_respawn_node_sequential(client):
    """Two identical compile requests must produce the same words with only one
    Node subprocess spawn (the second call is served from the in-process LRU
    cache).
    """
    # Clear the cache before the test so prior test runs don't interfere.
    compile_api._cache.clear()

    unique_source = """\
abstraction CacheHitProbe {
    method probe() {
        return 99;
    }
}
"""

    # Wrap _run_compile_uncached so we can count how many times it is called.
    original_uncached = compile_api._run_compile_uncached
    call_count = []

    def counting_uncached(payload):
        call_count.append(1)
        return original_uncached(payload)

    with patch.object(compile_api, '_run_compile_uncached', side_effect=counting_uncached):
        resp1 = _post(client, unique_source, 'javascript')
        resp2 = _post(client, unique_source, 'javascript')

    assert resp1.status_code == 200
    assert resp2.status_code == 200

    data1 = resp1.get_json()
    data2 = resp2.get_json()

    assert data1['ok'] is True, f'first compile failed: {data1}'
    assert data2['ok'] is True, f'second compile failed: {data2}'

    # Both responses must carry identical word lists.
    assert data1['words'] == data2['words'], (
        'cache hit returned different words than the original compile'
    )

    # The subprocess must have been spawned exactly once.
    assert len(call_count) == 1, (
        f'expected 1 subprocess spawn (cache hit on 2nd call), got {len(call_count)}'
    )


def test_cache_concurrent_hits_return_consistent_words():
    """N concurrent identical compile requests (called directly on run_compile,
    bypassing Flask) must all return the same words, and the cache must not
    exceed _CACHE_MAX entries — verifying the threading lock prevents races.
    """
    import threading

    compile_api._cache.clear()

    payload = {
        'source': (
            'abstraction ConcurrentCacheProbe {\n'
            '    method value() {\n'
            '        return 7;\n'
            '    }\n'
            '}\n'
        ),
        'language': 'javascript',
    }

    n_threads = 8
    results = [None] * n_threads
    errors = []
    barrier = threading.Barrier(n_threads)

    def do_compile(idx):
        try:
            barrier.wait()   # release all threads simultaneously for max contention
            results[idx] = compile_api.run_compile(dict(payload))
        except Exception as exc:
            errors.append(exc)

    threads = [threading.Thread(target=do_compile, args=(i,)) for i in range(n_threads)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()

    assert not errors, f'concurrent compile calls raised exceptions: {errors}'

    words_sets = [tuple(r['words']) for r in results if r and r.get('ok')]
    assert len(words_sets) == n_threads, (
        f'not all concurrent compiles succeeded: {results}'
    )
    assert len(set(words_sets)) == 1, (
        'concurrent cache hits returned inconsistent words across threads'
    )

    # Cache must not have grown beyond the configured maximum.
    with compile_api._cache_lock:
        cache_size = len(compile_api._cache)
    assert cache_size <= compile_api._CACHE_MAX, (
        f'cache grew to {cache_size} entries, exceeding _CACHE_MAX={compile_api._CACHE_MAX}'
    )

class TestGoldenOutput:
    """Pin exact compiled word arrays for canonical programs.

    Each test compiles a known snippet via the live /api/compile endpoint and
    compares the returned words[] against the stored fixture.  A mismatch means
    the compiler or LUMP builder changed its output — see the HOW TO UPDATE
    comment above for the update procedure.
    """

    def test_trivial_return_asm(self, client):
        """Trivial RETURN assembly — minimal 1-instruction lump."""
        fixture = _load_fixture('trivial_return_asm')
        resp = _post(client, fixture['source'], fixture['language'])
        assert resp.status_code == 200
        data = resp.get_json()
        assert data['ok'] is True, f"compile failed: {data.get('error')}"
        assert data['words'] == fixture['words'], (
            f"Golden mismatch for trivial_return_asm.\n"
            f"  expected: {fixture['words']!r}\n"
            f"  actual:   {data['words']!r}\n"
            f"If this change is intentional, update tests/server/fixtures/trivial_return_asm.json."
        )

    def test_iadd_return_asm(self, client):
        """IADD DR1, DR0, #42 then RETURN — two-instruction lump with immediate."""
        fixture = _load_fixture('iadd_return_asm')
        resp = _post(client, fixture['source'], fixture['language'])
        assert resp.status_code == 200
        data = resp.get_json()
        assert data['ok'] is True, f"compile failed: {data.get('error')}"
        assert data['words'] == fixture['words'], (
            f"Golden mismatch for iadd_return_asm.\n"
            f"  expected: {fixture['words']!r}\n"
            f"  actual:   {data['words']!r}\n"
            f"If this change is intentional, update tests/server/fixtures/iadd_return_asm.json."
        )

    def test_return_zero_asm(self, client):
        """IADD DR0, DR0, #0 (zeroing no-op) then RETURN — immediate-zero encoding."""
        fixture = _load_fixture('return_zero_asm')
        resp = _post(client, fixture['source'], fixture['language'])
        assert resp.status_code == 200
        data = resp.get_json()
        assert data['ok'] is True, f"compile failed: {data.get('error')}"
        assert data['words'] == fixture['words'], (
            f"Golden mismatch for return_zero_asm.\n"
            f"  expected: {fixture['words']!r}\n"
            f"  actual:   {data['words']!r}\n"
            f"If this change is intentional, update tests/server/fixtures/return_zero_asm.json."
        )

    def test_single_method_cloomc(self, client):
        """Single-method CLOOMC abstraction (Adder.add returns 1+2)."""
        fixture = _load_fixture('single_method_cloomc')
        resp = _post(client, fixture['source'], fixture['language'])
        assert resp.status_code == 200
        data = resp.get_json()
        assert data['ok'] is True, f"compile failed: {data.get('error')}"
        assert data['words'] == fixture['words'], (
            f"Golden mismatch for single_method_cloomc.\n"
            f"  expected: {fixture['words']!r}\n"
            f"  actual:   {data['words']!r}\n"
            f"If this change is intentional, update tests/server/fixtures/single_method_cloomc.json."
        )

    def test_two_method_cloomc(self, client):
        """Two-method CLOOMC abstraction (Math.zero, Math.one) — dispatch table + two bodies."""
        fixture = _load_fixture('two_method_cloomc')
        resp = _post(client, fixture['source'], fixture['language'])
        assert resp.status_code == 200
        data = resp.get_json()
        assert data['ok'] is True, f"compile failed: {data.get('error')}"
        assert data['words'] == fixture['words'], (
            f"Golden mismatch for two_method_cloomc.\n"
            f"  expected: {fixture['words']!r}\n"
            f"  actual:   {data['words']!r}\n"
            f"If this change is intentional, update tests/server/fixtures/two_method_cloomc.json."
        )
