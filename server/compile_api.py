"""
server/compile_api.py — thin Python wrapper around server/compile_worker.js.

Spawns a Node.js subprocess, pipes the compile request JSON on stdin, reads
the JSON response from stdout, and returns it as a plain Python dict.

Never raises — compilation errors are returned as {ok: False, error: …} dicts.

Successful results are stored in a bounded in-process LRU cache (up to
_CACHE_MAX entries) keyed on a SHA-256 of the cache-relevant request fields
(worker_stamp, language, source, namespace_hint).  The worker_stamp is a
content-hash of compile_worker.js that is refreshed on every run_compile call
by re-stating the file; if the mtime has changed the full content hash is
recomputed and, if different, the entire cache is flushed.  This means a
long-running production server serves stale results for at most one request
after compile_worker.js is updated on disk.  Failed results are never cached
so that transient errors don't get stuck.
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
# _cache_lock must be held for every read or write of _cache or the worker
# stamp globals, so that concurrent Flask threads cannot race.
_cache: OrderedDict[str, dict] = OrderedDict()
_cache_lock = threading.Lock()

# Worker file tracking.  _WORKER_MTIME sentinel -1.0 ensures the first call
# to _refresh_worker_stamp_if_needed() always stats the file and seeds the stamp.
_WORKER_MTIME: float = -1.0
_WORKER_STAMP: str   = ''

VALID_LANGUAGES: frozenset[str] = frozenset({
    'english',
    'javascript',
    'haskell',
    'symbolic',
    'lambda',
    'assembly',
})


def _refresh_worker_stamp_if_needed() -> None:
    """Re-stat compile_worker.js; if its mtime changed, recompute the content
    hash and flush the entire cache so stale results are never served.

    *Must be called while holding _cache_lock.*
    The mtime check is O(1); the full SHA-256 read only happens on change.
    """
    global _WORKER_STAMP, _WORKER_MTIME
    try:
        mtime = os.path.getmtime(_WORKER)
    except OSError:
        mtime = -2.0   # file missing — distinct sentinel, triggers refresh
    if mtime == _WORKER_MTIME:
        return          # fast path: nothing has changed
    # mtime changed (or first call) — recompute content hash
    try:
        with open(_WORKER, 'rb') as fh:
            new_stamp = hashlib.sha256(fh.read()).hexdigest()[:16]
    except OSError:
        new_stamp = 'missing'
    if new_stamp != _WORKER_STAMP:
        _cache.clear()
        log.info(
            'compile_worker.js changed (stamp %s → %s); compile cache flushed',
            _WORKER_STAMP or '<none>', new_stamp,
        )
    _WORKER_STAMP = new_stamp
    _WORKER_MTIME = mtime


def _make_cache_key(payload: dict) -> str:
    """Return a stable hex cache key for the cache-relevant fields of *payload*.

    Reads the module-global *_WORKER_STAMP* which must have been refreshed by
    *_refresh_worker_stamp_if_needed()* before this call (under _cache_lock).
    """
    key_obj = {
        'worker_stamp':   _WORKER_STAMP,
        'language':       payload.get('language', ''),
        'source':         payload.get('source', ''),
        'namespace_hint': payload.get('namespace_hint'),
    }
    canonical = json.dumps(key_obj, sort_keys=True, ensure_ascii=False)
    return hashlib.sha256(canonical.encode('utf-8')).hexdigest()


def run_compile(payload: dict) -> dict:
    """Return the compiled result for *payload*, using the LRU cache when possible.

    On each call the worker file's mtime is checked under the lock; if the
    file has changed its content hash is recomputed and the cache is flushed,
    so upgrades to compile_worker.js are reflected within one request even in
    a long-running server that is never restarted.

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
    # Refresh the stamp and do the cache lookup under the same lock acquisition
    # so no thread can observe an inconsistent stamp/cache pair.
    with _cache_lock:
        _refresh_worker_stamp_if_needed()
        cache_key = _make_cache_key(payload)
        if cache_key in _cache:
            _cache.move_to_end(cache_key)
            log.debug('compile cache hit (key=%.12s…)', cache_key)
            return _cache[cache_key]

    # Spawn the Node subprocess outside the lock so concurrent requests for
    # *different* keys do not block each other.
    result = _run_compile_uncached(payload)

    # Only cache successes so transient failures don't get stuck.
    if result.get('ok'):
        with _cache_lock:
            # Refresh again: the worker may have changed while we were compiling.
            # If it did, _cache was flushed and we recompute the key under the
            # new stamp so we never store a result against a stale key.
            _refresh_worker_stamp_if_needed()
            cache_key = _make_cache_key(payload)
            # Re-check: another thread may have populated this key already.
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
