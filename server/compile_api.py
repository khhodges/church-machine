"""
server/compile_api.py — thin Python wrapper around server/compile_worker.js.

Spawns a Node.js subprocess, pipes the compile request JSON on stdin, reads
the JSON response from stdout, and returns it as a plain Python dict.

Never raises — compilation errors are returned as compile_failed dicts.
"""
from __future__ import annotations

import json
import logging
import os
import subprocess

log = logging.getLogger(__name__)

_WORKER          = os.path.join(os.path.dirname(__file__), 'compile_worker.js')
_COMPILE_TIMEOUT = 30  # seconds

VALID_LANGUAGES: frozenset[str] = frozenset({
    'cloomc++',
    'english',
    'symbolic_math',
    'assembly',
    'js_cloomc++',
    'haskell_cloomc++',
    'lambda_calculus',
    'abstraction',
})

VALID_TARGETS: frozenset[str] = frozenset({
    'simulator',
    'ti60_f225',
    'wukong_xc7a100t',
    'tang_nano_20k',
})


def run_compile(payload: dict) -> dict:
    """Invoke compile_worker.js with *payload* and return its JSON response.

    Parameters
    ----------
    payload:
        Dict matching the compile request schema (source, language, target, …).

    Returns
    -------
    dict
        Always a valid response dict with at least a ``status`` key.
        On internal failures the status is ``"compile_failed"``.
    """
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
            return _fail(f'Compiler returned no output. stderr: {stderr[:500]}')
        return json.loads(stdout)
    except subprocess.TimeoutExpired:
        log.warning('compile_worker timed out after %ds', _COMPILE_TIMEOUT)
        return _fail(f'Compile timed out after {_COMPILE_TIMEOUT}s — reduce source complexity or try again')
    except json.JSONDecodeError as exc:
        log.error('compile_worker output was not valid JSON: %s', exc)
        return _fail(f'Compiler output was not valid JSON: {exc}')
    except Exception as exc:
        log.error('compile_worker unexpected error: %s', exc, exc_info=True)
        return _fail(str(exc))


def _fail(message: str) -> dict:
    return {
        'status':         'compile_failed',
        'console_output': [message],
        'errors':         [{'line': None, 'message': message, 'severity': 'error'}],
    }
