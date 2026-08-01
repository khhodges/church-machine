"""
server/compile_api.py — thin Python wrapper around server/compile_worker.js.

Spawns a Node.js subprocess, pipes the compile request JSON on stdin, reads
the JSON response from stdout, and returns it as a plain Python dict.

Never raises — compilation errors are returned as {ok: False, error: …} dicts.

Successful results are stored in a bounded in-process LRU cache (up to
_CACHE_MAX entries) keyed on a SHA-256 of the cache-relevant request fields
(language, source, namespace_hint).  Failed results are never cached so that
transient errors don't get stuck.
"""
from __future__ import annotations

import hashlib
import json
import logging
import os
import subprocess
import threading
from collections import OrderedDict

log = logging.getLogger(__name__)

_WORKER    = os.path.join(os.path.dirname(__file__), 'compile_worker.js')
# 10 s is the primary enforcement boundary.  compile_worker.js enforces its own
# matching deadline via worker_threads.terminate(), which is preemptive even for
# CPU-bound synchronous code.  This Python-level timeout is the fallback that
# SIGKILL's the Node subprocess if the worker thread somehow fails to report back.
_COMPILE_TIMEOUT = 10  # seconds
_CACHE_MAX       = 128  # maximum number of cached successful results

# In-process LRU cache: OrderedDict used as an LRU (oldest item at front).
# Only successful compile results (ok=True) are stored here.
# _cache_lock must be held for every read or write of _cache so that
# concurrent Flask threads cannot race on membership tests, LRU promotions,
# or capacity evictions.
_cache: OrderedDict[str, dict] = OrderedDict()
_cache_lock = threading.Lock()

VALID_LANGUAGES: frozenset[str] = frozenset({
    'english',
    'javascript',
    'haskell',
    'symbolic',
    'lambda',
    'assembly',
})


def _make_cache_key(payload: dict) -> str:
    """Return a stable hex cache key for the cache-relevant fields of *payload*."""
    key_obj = {
        'language':       payload.get('language', ''),
        'source':         payload.get('source', ''),
        'namespace_hint': payload.get('namespace_hint'),
    }
    canonical = json.dumps(key_obj, sort_keys=True, ensure_ascii=False)
    return hashlib.sha256(canonical.encode('utf-8')).hexdigest()


def run_compile(payload: dict) -> dict:
    """Return the compiled result for *payload*, using the LRU cache when possible.

    Checks the in-process LRU cache before spawning a Node subprocess.
    Only successful results (``ok=True``) are stored in the cache.

    Parameters
    ----------
    payload:
        Dict matching the compile request schema (source, language, …).
        Unknown fields are passed through to the worker and silently ignored.

    Returns
    -------
    dict
        Success: ``{ok: True, language, words, lump_binary, warnings}``.
        Failure: ``{ok: False, language, error}``.
        On internal subprocess failures the ``language`` key is ``''``.
    """
    cache_key = _make_cache_key(payload)

    # Cache lookup — hold the lock for the entire read-promote sequence so
    # another thread cannot evict the key between the membership check and the
    # move_to_end call.
    with _cache_lock:
        if cache_key in _cache:
            _cache.move_to_end(cache_key)
            cached = _cache[cache_key]
            log.debug('compile cache hit (key=%.12s…)', cache_key)
            return cached

    # Spawn the Node subprocess outside the lock so concurrent requests for
    # *different* keys do not block each other.
    result = _run_compile_uncached(payload)

    # Only cache successes so transient failures don't get stuck.
    if result.get('ok'):
        with _cache_lock:
            # Re-check: another thread may have populated this key while we
            # were compiling.  If so, adopt its result to stay consistent.
            if cache_key in _cache:
                _cache.move_to_end(cache_key)
                return _cache[cache_key]
            if len(_cache) >= _CACHE_MAX:
                _cache.popitem(last=False)   # evict least-recently-used entry
            _cache[cache_key] = result

    return result


def _run_compile_uncached(payload: dict) -> dict:
    """Spawn compile_worker.js and return its JSON response (never cached)."""
    language = payload.get('language', '')
    try:
        input_json = json.dumps(payload).encode('utf-8')
        proc = subprocess.run(
            ['node', _WORKER],
            input=input_json,
            capture_output=True,
            timeout=_COMPILE_TIMEOUT,
        )
        stdout = proc.stdout.decode('utf-8', errors='replace').strip()
        if not stdout:
            stderr = proc.stderr.decode('utf-8', errors='replace').strip()
            log.error('compile_worker produced no stdout. stderr: %s', stderr)
            return _fail(language, f'Compiler returned no output. stderr: {stderr[:500]}')
        return json.loads(stdout)
    except subprocess.TimeoutExpired:
        log.warning('compile_worker timed out after %ds', _COMPILE_TIMEOUT)
        return _fail(language, f'Compile timed out after {_COMPILE_TIMEOUT}s — reduce source complexity or try again')
    except json.JSONDecodeError as exc:
        log.error('compile_worker output was not valid JSON: %s', exc)
        return _fail(language, f'Compiler output was not valid JSON: {exc}')
    except Exception as exc:
        log.error('compile_worker unexpected error: %s', exc, exc_info=True)
        return _fail(language, str(exc))


def _fail(language: str, message: str) -> dict:
    return {
        'ok':       False,
        'language': language or '',
        'error':    message,
    }
