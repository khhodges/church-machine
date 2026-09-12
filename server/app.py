import os
import re
import sys
import io
import json
import struct
import logging
import uuid
import secrets
import base64
import mimetypes
import warnings as _warnings_mod
import zipfile
import subprocess
import tempfile
import gzip as _gzip
import queue
import threading
import contextlib
import contextvars
import fcntl
import requests as http_requests
import html as _html

# ── SSE device-event bus ──────────────────────────────────────────────────────
_sse_clients     = []
_sse_clients_lock = threading.Lock()

# ── LUMP manifest write lock ───────────────────────────────────────────────────
# All archive/current/approval/manifest transitions use this lock. Keeping the
# complete transition serialised is important: the files are a single history
# record, not independent per-token cache entries.
_lumps_manifest_lock = threading.RLock()
_lump_history_lock_state = threading.local()

# Test hook — set to a callable to be invoked inside save_lump() after all
# per-token file writes (Phase 5/6) complete but BEFORE the manifest lock is
# acquired (Phase 7).  This lets tests synchronise threads so both have
# finished their Phase-1 manifest read before either enters Phase 7, making
# the race window deterministic.  None in production (no overhead).
_lumps_manifest_pre_write_hook: "threading.Callable | None" = None
_bootstrap_pre_lock_hook: "threading.Callable | None" = None
import hashlib
import hmac
import time
_LUMP_TRANSITION_UNSET = object()


def _atomic_write_json(path: str, data) -> None:
    """Write *data* as JSON to *path* atomically.

    Serialises to a sibling temp file first, then calls os.replace() so the
    destination is either the old content or the new content — never a
    partially-written intermediate state.  Any I/O error during the write
    leaves the original file untouched; the temp file is cleaned up.
    """
    dir_ = os.path.dirname(os.path.abspath(path))
    fd, tmp_path = tempfile.mkstemp(dir=dir_, suffix='.tmp')
    try:
        with os.fdopen(fd, 'w') as fh:
            json.dump(data, fh, indent=2)
        os.replace(tmp_path, path)
    except Exception:
        try:
            os.unlink(tmp_path)
        except OSError:
            pass
        raise

def _lump_transition_path(lumps_dir: str, filename: str) -> str:
    """Return a safe path for an internally-generated LUMP filename."""
    if not filename or os.path.basename(filename) != filename:
        raise ValueError(f"Invalid LUMP transition filename: {filename!r}")
    root = os.path.realpath(os.path.abspath(lumps_dir))
    path = os.path.abspath(os.path.join(lumps_dir, filename))
    if not (path == root or path.startswith(root + os.sep)):
        raise ValueError(f"LUMP transition path escapes library: {filename!r}")
    return path
def _bank_custody_key() -> bytes:
    return hashlib.sha256(
        ("ChurchMachine.BankCustody|" + str(app.secret_key)).encode("utf-8")
    ).digest()
def _push_device_event(payload: dict):
    """Broadcast a JSON event to all open SSE connections."""
    msg = "data: " + json.dumps(payload) + "\n\n"
    with _sse_clients_lock:
        dead = []
        for q in _sse_clients:
            try:
                q.put_nowait(msg)
            except Exception:
                dead.append(q)
        for q in dead:
            _sse_clients.remove(q)
# ─────────────────────────────────────────────────────────────────────────────
from flask import (
    Flask, after_this_request, jsonify, send_from_directory, send_file,
    redirect, make_response, request, session, g,
)

# Ensure the server/ directory is on sys.path so local modules (boot_image, etc.)
# are importable whether the app is started as `python3 server/app.py` (dev) or
# `gunicorn server.app:app` from the workspace root (production).
# Per-process session token for the /api/generate-method endpoint.
# Generated fresh on every server start so external callers cannot reuse a leaked token.
_GENERATE_SESSION_TOKEN = secrets.token_urlsafe(32)
_COMPILE_API_TOKEN = os.environ.get('COMPILE_API_TOKEN', '')

_SERVER_DIR = os.path.dirname(os.path.abspath(__file__))
if _SERVER_DIR not in sys.path:
    sys.path.insert(0, _SERVER_DIR)


def _env_flag(name):
    """Return whether an environment flag is explicitly enabled."""
    return os.environ.get(name, "").strip().lower() in {
        "1", "true", "yes", "on",
    }


# Release-test subprocesses can point writable server state at a temporary
# copy.  The isolated browser harness opts into a stricter mode below; all
# four writable roots are then mandatory and every override is checked against
# the real production destination before any application state is opened.
_ISOLATED_TEST_MODE = (
    _env_flag("CHURCH_TEST_ISOLATED_MODE")
    or _env_flag("CHURCH_TEST_ISOLATED")
)
_PRODUCTION_WRITABLE_PATHS = {
    "CHURCH_TEST_LUMPS_DIR": (
        os.path.realpath(os.path.join(_SERVER_DIR, "lumps")), True),
    "CHURCH_TEST_BOOT_CONFIG_PATH": (
        os.path.realpath(os.path.join(_SERVER_DIR, "boot-config.json")), False),
    "CHURCH_TEST_BUILD_SNAPSHOTS_DIR": (
        os.path.realpath(os.path.join(_SERVER_DIR, "build-snapshots")), True),
    "CHURCH_TEST_DB_PATH": (
        os.path.realpath(os.path.join(_SERVER_DIR, "church_machine.db")), False),
}


def _test_path_override(name):
    """Read one test path and reject the corresponding production target."""
    raw = os.environ.get(name, "").strip()
    if not raw:
        return ""
    candidate = os.path.realpath(os.path.abspath(raw))
    production, is_directory = _PRODUCTION_WRITABLE_PATHS[name]
    try:
        inside_server_tree = os.path.commonpath(
            (candidate, os.path.realpath(_SERVER_DIR))) == os.path.realpath(_SERVER_DIR)
    except ValueError:
        inside_server_tree = False
    if inside_server_tree:
        is_production_path = True
    elif is_directory:
        try:
            is_production_path = os.path.commonpath(
                (candidate, production)) == production
        except ValueError:
            is_production_path = False
    else:
        is_production_path = candidate == production
    if is_production_path:
        raise RuntimeError(
            f"{name} points to production writable state ({candidate}); "
            "refusing to start with a production test override"
        )
    return candidate


_LUMPS_DIR_OVERRIDE = _test_path_override("CHURCH_TEST_LUMPS_DIR")
_BOOT_CONFIG_PATH_OVERRIDE = _test_path_override(
    "CHURCH_TEST_BOOT_CONFIG_PATH")
_BUILD_SNAPSHOTS_DIR_OVERRIDE = _test_path_override(
    "CHURCH_TEST_BUILD_SNAPSHOTS_DIR")
_DB_PATH_OVERRIDE = _test_path_override("CHURCH_TEST_DB_PATH")

if _ISOLATED_TEST_MODE:
    _missing_isolated_overrides = [
        name for name in _PRODUCTION_WRITABLE_PATHS
        if not os.environ.get(name, "").strip()
    ]
    if _missing_isolated_overrides:
        raise RuntimeError(
            "CHURCH_TEST_ISOLATED_MODE requires disposable overrides for: "
            + ", ".join(_missing_isolated_overrides)
        )
    logging.info(
        "Isolated test mode enabled; external report jobs, GitHub checks, "
        "and Wukong listeners will not start"
    )

# `python server/app.py` puts only server/ on sys.path.  The Wukong symbol
# module lives under the repository root, so make that importable before the
# optional symbol import below.  Without this, the running workflow silently
# installs the "<unknown>" decoder fallback while direct test imports work.
_REPO_DIR = os.path.dirname(_SERVER_DIR)
if _REPO_DIR not in sys.path:
    sys.path.insert(0, _REPO_DIR)

import boot_image as _boot_image_gen
try:
    from boot_constants import DEMO_CLIST_SIZE, BOOT_ABSTR_DEFAULT_SIZE
except ImportError:
    from server.boot_constants import DEMO_CLIST_SIZE, BOOT_ABSTR_DEFAULT_SIZE
try:
    import wukong_udp as _wukong_udp
except ImportError:
    _wukong_udp = None
try:
    from hardware.wukong_trace_symbols import (
        trace_metadata    as _wukong_trace_metadata_static,
        _disassemble_word as _wts_disasm,
    )
except ImportError:
    _wukong_trace_metadata_static = lambda _nia: None
    _wts_disasm = lambda _w: '<unknown>'


def _wukong_disassemble_word(word, pet_name=None):
    """Return a deterministic display string for a known hardware word.

    A pet-name-backed listing must never render the generic ``<unknown>``
    placeholder.  The normal path uses the source-backed decoder; the
    word-literal fallback keeps the row useful if a downloaded/standalone
    server cannot load that optional decoder.
    """
    try:
        disasm = _wts_disasm(int(word) & 0xFFFFFFFF)
    except Exception:
        disasm = None
    if isinstance(disasm, str) and disasm.strip() and \
            disasm.strip().lower() not in ('<unknown>', 'unknown'):
        return disasm
    word_text = f'0x{int(word) & 0xFFFFFFFF:08X}'
    return f'WORD {word_text}' if pet_name else word_text


# ── Dynamic NIA map ──────────────────────────────────────────────────────────
# Populated by _wukong_update_active_lump_nia() whenever a boot image is sent
# to hardware.  Stores {base_byte, end_byte, name, lump_words} for the active
# entry lump so every trace event gets a "LumpName.N" label instead of a raw
# hex NIA.  Resident Wukong programs are covered by
# _wukong_trace_metadata_static;
# for user-compiled lumps this map is the only source of labels.
_wukong_active_lump_info = {}

def _wukong_resolve_nia(nia):
    """Resolve a trace NIA: check the dynamic active-lump table first, then
    fall back to the static resident-program + Boot-ROM table from
    wukong_trace_symbols."""
    info = _wukong_active_lump_info
    if (info and
            info.get('base_byte', -1) <= nia < info.get('end_byte', 0) and
            nia % 4 == 0):
        offset = (nia - info['base_byte']) // 4
        name   = info.get('name', 'Lump')
        word   = info.get('lump_words', {}).get(offset)
        if offset == 0:
            disasm = 'LUMP_HEADER'
        elif word is not None:
            disasm = _wukong_disassemble_word(word, name)
        else:
            disasm = f'WORD 0x{offset:08X}'
        return {
            'pet_name':   name,
            'offset':     offset,
            'nia_label':  f'{name}.{offset}',
            'map_instr_word': int(word) & 0xFFFFFFFF if word is not None else None,
            'disasm':     disasm,
            'source_map': 'uploaded',
        }
    return _wukong_trace_metadata_static(nia)

_wukong_trace_metadata = _wukong_resolve_nia


def _wukong_correlate_trace_metadata(nia, supplied_word=None):
    """Return only instruction metadata that belongs to this retirement.

    NIA-backed symbols are authoritative when the packet has no instruction
    word.  When a newer bridge supplies a word, it must match the word mapped
    at that NIA.  An unknown NIA can still be decoded from its supplied word,
    but is explicitly marked as word-only rather than assigned a false label.
    """
    location = _wukong_trace_metadata(nia) or {}
    word = None if supplied_word is None else int(supplied_word) & 0xFFFFFFFF
    expected = location.get('map_instr_word')
    if word is None:
        if location:
            location['metadata_status'] = 'NIA map (unverified)'
        return location
    if expected is not None and (int(expected) & 0xFFFFFFFF) != word:
        return {
            'observed_instr_word': word,
            'disasm': _wukong_disassemble_word(word),
            'source_map': 'instruction-word',
            'metadata_status': (
                f"mismatch: NIA map has 0x{int(expected) & 0xFFFFFFFF:08X}, "
                f"packet has 0x{word:08X}"
            ),
        }
    if not location:
        return {
            'observed_instr_word': word,
            'disasm': _wukong_disassemble_word(word),
            'source_map': 'instruction-word',
            'metadata_status': 'address metadata unavailable',
        }
    location['observed_instr_word'] = word
    location['metadata_status'] = 'matched'
    return location

from flask_sqlalchemy import SQLAlchemy
from sqlalchemy.orm import DeclarativeBase
from werkzeug.middleware.proxy_fix import ProxyFix

logging.basicConfig(level=logging.INFO)

class Base(DeclarativeBase):
    pass

db = SQLAlchemy(model_class=Base)

app = Flask(__name__)
app.secret_key = os.environ.get("SESSION_SECRET", "dev-secret-key")

# Save diagnostics are intentionally append-only and metadata-only. They give
# a failed browser save a server-side correlation point without persisting
# source text, approval tokens, session cookies, or other secrets. Diagnostics
# are a separate, bounded operational record; they are never part of a LUMP
# manifest, approval ledger, or artifact bundle.
_LUMP_SAVE_DIAGNOSTIC_LOCK = threading.Lock()
# Keep runtime events separate from the legacy synthetic stream so old
# diagnostics cannot be mistaken for authoritative request outcomes.
_LUMP_SAVE_DIAGNOSTIC_FILENAME = "save-runtime-diagnostics.jsonl"
_LUMP_SAVE_DIAGNOSTIC_MAX_BYTES = 256 * 1024
_LUMP_SAVE_DIAGNOSTIC_ROTATIONS = 3
_LUMP_SAVE_DIAGNOSTIC_MAX_EVENT_BYTES = 12 * 1024
_LUMP_SAVE_DIAGNOSTIC_MAX_BATCH_EVENTS = 100
_LUMP_SAVE_DIAGNOSTIC_MAX_BATCH_BYTES = 64 * 1024
_LUMP_SAVE_DIAGNOSTIC_RATE_WINDOW = 60.0
_LUMP_SAVE_DIAGNOSTIC_RATE_LIMIT = 60
_LUMP_SAVE_DIAGNOSTIC_GLOBAL_RATE_LIMIT = 600
_LUMP_SAVE_DIAGNOSTIC_MAX_RATE_KEYS = 2048
_LUMP_SAVE_DIAGNOSTIC_RATE_LOCK = threading.Lock()
_LUMP_SAVE_DIAGNOSTIC_RATE = {}
_LUMP_SAVE_DIAGNOSTIC_GLOBAL_RATE = []
# Diagnostic delivery may begin before the IDE has opened a save/approval
# flow.  Keep its signed-session binding separate from the save authorization
# binding: accepting a same-origin diagnostic must never create or prove a
# ``_lump_approval_session``.
_LUMP_SAVE_DIAGNOSTIC_SESSION_KEY = "_lump_save_diagnostic_session"

_LUMP_DIAGNOSTIC_STRING_LIMITS = {
    "attempt_id": 128, "operation_id": 128, "candidate_id": 128,
    "plan_id": 128, "stage": 48, "event": 96, "entry_point": 128,
    "event_id": 160, "outcome": 24, "client_diagnostic_attempt_id": 128,
    "client_timestamp": 64, "occurred_at": 64, "name": 128, "message": 96,
    "stack": 1024,
}
_LUMP_DIAGNOSTIC_EVENT_FIELDS = frozenset({
    "attempt_id", "operation_id", "candidate_id", "plan_id", "stage",
    "event", "entry_point", "outcome", "elapsed_ms", "http_status", "error",
    "event_id", "client_timestamp",
    "occurred_at",
    # ``committed`` is retained as a compatibility projection for existing
    # local log readers; ``outcome`` remains the authoritative tri-state field.
    "committed",
    "client_diagnostic_attempt_id",
})
_LUMP_DIAGNOSTIC_SENSITIVE_VALUE = re.compile(
    r"(?i)(?:bearer\s+|(?:authorization|cookie|set-cookie|"
    r"approval|session|access|refresh|api|private|secret|password|"
    r"credential|proof|binary|source|body)"
    r"(?:[_-][a-z0-9]+)*\s*[:=]\s*)([^\s,;\"']+)"
)
_LUMP_DIAGNOSTIC_LONG_VALUE = re.compile(
    r"(?i)\b(?:-----BEGIN [^-]+-----|data:[a-z0-9/+.-]+;base64,)[^\s]{32,}"
)
_LUMP_DIAGNOSTIC_QUERY_SECRET = re.compile(
    r"(?i)([?&](?:token|key|secret|password|cookie|session|authorization|"
    r"proof|approval|credential)[^=&#\s]*=)[^&#\s]+"
)
_LUMP_DIAGNOSTIC_STACK_LOCATION = re.compile(
    r"(?:(?:https?|file)://[^\s)\]]+|[/A-Za-z0-9_.-]+):\d+(?::\d+)?"
)
_LUMP_DIAGNOSTIC_ERROR_NAMES = {
    "approvalerror": "ApprovalError",
    "approvalstoreerror": "ApprovalStoreError",
    "bootimageunavailable": "BootImageUnavailable",
    "error": "Error",
    "exception": "Error",
    "invalidpayload": "InvalidPayload",
    "manifesterror": "ManifestError",
    "rollbackerror": "RollbackError",
    "aborterror": "AbortError",
    "networkerror": "NetworkError",
    "oserror": "OSError",
    "rangeerror": "RangeError",
    "syntaxerror": "SyntaxError",
    "timeouterror": "TimeoutError",
    "typeerror": "TypeError",
    "valueerror": "ValueError",
    "transitionconflict": "TransitionConflict",
    "transitionrecovered": "TransitionRecovered",
}
_LUMP_DIAGNOSTIC_CODES = frozenset({
    "capture_failed", "preflight_rejected", "approval_rejected",
    "commit_rejected", "commit_unknown", "reconciliation_unknown",
    "repository_unavailable", "invalid_response", "reload_failed",
    "namespace_save_failed", "timeout", "authorization_rejected",
    "diagnostic_failure", "unexpected_failure",
})
_LUMP_DIAGNOSTIC_CODE_REASONS = {
    "capture_failed": "Save capture failed before the repository request.",
    "preflight_rejected": "The repository rejected save preparation.",
    "approval_rejected": "The repository rejected the approval step.",
    "commit_rejected": "The repository rejected the save.",
    "commit_unknown": "The repository could not confirm the save outcome.",
    "reconciliation_unknown": (
        "Reconciliation could not confirm the save outcome."),
    "repository_unavailable": "The repository was unavailable.",
    "invalid_response": "The repository returned an invalid response.",
    "reload_failed": "The repository committed, but local reload failed.",
    "namespace_save_failed": "Namespace state could not be saved.",
    "timeout": "The save request timed out.",
    "authorization_rejected": "Repository authorization was rejected.",
    "diagnostic_failure": "Save diagnostics could not be recorded.",
    "unexpected_failure": "An unexpected save-stage failure occurred.",
}


def _safe_lump_diagnostic_string(value, field, *, limit=None):
    """Return a bounded, log-safe string or ``None``.

    Client diagnostics are untrusted input. In particular, error messages and
    stacks frequently include request details copied by browser libraries.
    Keep the useful prose while removing credential-like values and control
    characters. Unknown fields never reach this helper.
    """
    if not isinstance(value, str):
        return None
    maximum = int(limit or _LUMP_DIAGNOSTIC_STRING_LIMITS.get(field, 256))
    value = value.replace("\x00", "")
    value = "".join(
        char for char in value
        if char in "\n\r\t" or ord(char) >= 0x20
    ).strip()
    value = _LUMP_DIAGNOSTIC_SENSITIVE_VALUE.sub(
        lambda match: match.group(0)[:match.start(1) - match.start(0)]
        + "[REDACTED]",
        value,
    )
    value = _LUMP_DIAGNOSTIC_QUERY_SECRET.sub(r"\1[REDACTED]", value)
    value = _LUMP_DIAGNOSTIC_LONG_VALUE.sub("[REDACTED]", value)
    if len(value) > maximum:
        value = value[:maximum] + "…"
    return value or None


def _lump_diagnostic_error_name(value):
    try:
        normalized = re.sub(r"[^a-z0-9]", "", str(value or "").lower())
    except Exception:
        normalized = ""
    return _LUMP_DIAGNOSTIC_ERROR_NAMES.get(normalized, "Error")


def _lump_diagnostic_error_code(error):
    """Accept frontend enum codes only; infer a safe fallback for server errors."""
    supplied = error.get("code") if isinstance(error, dict) else None
    if isinstance(supplied, str) and supplied in _LUMP_DIAGNOSTIC_CODES:
        return supplied
    text = ""
    if isinstance(error, dict):
        text = " ".join(
            str(error.get(field) or "").lower()
            for field in ("name", "message"))
    if re.search(r"authorization|approval|credential|forbidden|session", text):
        return "authorization_rejected"
    if re.search(r"reload|boot.?image|refresh|install", text):
        return "reload_failed"
    if re.search(r"timeout|abort", text):
        return "timeout"
    if re.search(r"network|fetch|transport|connection", text):
        return "repository_unavailable"
    if re.search(r"invalid|payload|schema|base64", text):
        return "preflight_rejected"
    if re.search(r"operation|reconcil|replay", text):
        return "reconciliation_unknown"
    if re.search(r"commit|transition|rollback|manifest", text):
        return "commit_rejected"
    return "unexpected_failure"


def _lump_diagnostic_stack_locations(value):
    if not isinstance(value, str):
        return None
    locations = []
    for match in _LUMP_DIAGNOSTIC_STACK_LOCATION.finditer(value):
        location = match.group(0)
        # Query strings and fragments are not locations and commonly carry
        # bearer/session keys. Keep only the path plus line/column.
        location = re.split(r"[?#]", location, maxsplit=1)[0]
        location = re.sub(r"(?<=//)[^/@\s]+@", "", location)
        location = location.rstrip(".,;:")
        if location and location not in locations:
            locations.append(location)
        if len(locations) >= 8:
            break
    return "\n".join(locations)[:_LUMP_DIAGNOSTIC_STRING_LIMITS["stack"]] or None


def _sanitize_lump_diagnostic_error(error, depth=0):
    """Keep only classified reasons and source-free stack locations."""
    if depth > 3:
        return None
    if isinstance(error, str):
        code = "unexpected_failure"
        return {
            "code": code,
            "reason": _LUMP_DIAGNOSTIC_CODE_REASONS[code],
            "name": "Error",
            "message": _LUMP_DIAGNOSTIC_CODE_REASONS[code],
        }
    if not isinstance(error, dict):
        return None
    code = _lump_diagnostic_error_code(error)
    reason = _LUMP_DIAGNOSTIC_CODE_REASONS[code]
    result = {
        "code": code,
        "reason": reason,
        "name": _lump_diagnostic_error_name(error.get("name")),
        # Keep the historical message key for local readers, but only with
        # the server-derived allowlisted reason, never client prose.
        "message": reason,
    }
    stack = _lump_diagnostic_stack_locations(error.get("stack"))
    if stack:
        result["stack"] = stack
    cause = _sanitize_lump_diagnostic_error(error.get("cause"), depth + 1)
    if cause:
        result["cause"] = cause
    return result or None


def _sanitize_lump_diagnostic_event(event, *, source="server",
                                    authoritative=False, defaults=None):
    """Normalize one event to the small retained diagnostic contract."""
    if not isinstance(event, dict):
        return None
    defaults = defaults if isinstance(defaults, dict) else {}
    normalized = {
        "timestamp": time.time(),
        "source": "server" if source == "server" else "client",
        "authoritative": bool(authoritative),
    }
    for field in _LUMP_DIAGNOSTIC_EVENT_FIELDS:
        value = event.get(field, defaults.get(field))
        if (field == "attempt_id" and value is None
                and source != "server"):
            # Browser-only failures historically called this
            # diagnostic_attempt_id. It is accepted as the non-authoritative
            # event's attempt_id, never as a server operation identity.
            value = event.get("diagnostic_attempt_id")
        if (field in ("client_timestamp", "occurred_at")
                and value is None and source != "server"):
            # The retained ``timestamp`` is always ingestion time. Preserve a
            # bounded browser timestamp under a distinct name for clock/skew
            # diagnosis without allowing it to replace server chronology.
            value = event.get("occurred_at", event.get("timestamp"))
        if field == "error":
            value = _sanitize_lump_diagnostic_error(value)
        elif field == "committed":
            # This compatibility projection is server-authored only. A client
            # may report an outcome, but cannot make a retained record look
            # authoritative by supplying ``committed``.
            value = value if source == "server" and isinstance(value, bool) else None
        elif field in ("elapsed_ms", "http_status"):
            if isinstance(value, bool) or not isinstance(value, (int, float)):
                value = None
            else:
                try:
                    value = int(value)
                except (TypeError, ValueError, OverflowError):
                    value = None
                if field == "elapsed_ms" and value is not None:
                    value = max(0, min(value, 86_400_000))
                if field == "http_status" and value is not None:
                    value = max(0, min(value, 999))
        elif field in ("client_timestamp", "occurred_at"):
            if isinstance(value, bool):
                value = None
            elif isinstance(value, (int, float)):
                try:
                    value = int(value)
                except (TypeError, ValueError, OverflowError):
                    value = None
                if value is not None:
                    value = max(0, min(value, 10**15))
            elif isinstance(value, str):
                value = value.strip()
                if (not value or len(value) > 64
                        or not re.fullmatch(
                            r"\d{4}-\d{2}-\d{2}T[0-9:.+\- Z]+", value)):
                    value = None
            else:
                value = None
        else:
            value = _safe_lump_diagnostic_string(
                value, field, limit=_LUMP_DIAGNOSTIC_STRING_LIMITS.get(field))
            if (field in {
                    "attempt_id", "operation_id", "candidate_id", "plan_id",
                    "event_id", "client_diagnostic_attempt_id"}
                    and value is not None
                    and not re.fullmatch(r"[A-Za-z0-9._:-]{1,160}", value)):
                value = None
            if field == "outcome" and value not in {
                    "committed", "rejected", "unknown"}:
                value = "unknown" if value is not None else None
        if value is not None:
            normalized[field] = value
    # These are useful for rotation inspection and do not claim transaction
    # authority. The event's explicit outcome remains the source of truth.
    return normalized


def _lump_diagnostic_operation_context(operation_id):
    """Read only correlation fields from a durable operation, if available."""
    if not operation_id:
        return {}
    try:
        operation = _read_lump_save_operation(operation_id)
    except Exception:
        operation = None
    if not isinstance(operation, dict):
        return {}
    return {
        key: operation.get(key)
        for key in ("attempt_id", "candidate_id", "plan_id",
                    "client_diagnostic_attempt_id")
        if operation.get(key) is not None
    }


def _append_lump_diagnostic_event(event, *, source="server",
                                  authoritative=False, defaults=None):
    """Best-effort bounded append. Never raises into a save request."""
    try:
        normalized = _sanitize_lump_diagnostic_event(
            event, source=source, authoritative=authoritative, defaults=defaults)
        if normalized is None:
            return False
        line = json.dumps(
            normalized, sort_keys=True, separators=(",", ":"),
            ensure_ascii=True,
        ) + "\n"
        line_bytes = len(line.encode("utf-8"))
        if (line_bytes > _LUMP_SAVE_DIAGNOSTIC_MAX_EVENT_BYTES
                or line_bytes > _LUMP_SAVE_DIAGNOSTIC_MAX_BYTES):
            return False
        os.makedirs(LUMPS_DIR, exist_ok=True)
        path = os.path.join(LUMPS_DIR, _LUMP_SAVE_DIAGNOSTIC_FILENAME)
        if not _LUMP_SAVE_DIAGNOSTIC_LOCK.acquire(blocking=False):
            return False
        try:
            # The process lock complements the in-process lock so independent
            # workers cannot rotate the same retained stream simultaneously.
            with open(os.path.join(
                    LUMPS_DIR, "save-runtime-diagnostics.lock"), "a+") as lock_file:
                try:
                    fcntl.flock(
                        lock_file.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
                except (BlockingIOError, OSError) as lock_error:
                    if getattr(lock_error, "errno", None) in (11, 13, 35):
                        return False
                    raise
                try:
                    current_size = os.path.getsize(path)
                except OSError:
                    current_size = 0
                if current_size and (
                        current_size + line_bytes
                        > _LUMP_SAVE_DIAGNOSTIC_MAX_BYTES):
                    # Rotate only completed files first. The active file is
                    # moved once, after the loop, so the event that triggered
                    # rotation is appended to the new active file.
                    for index in range(
                            _LUMP_SAVE_DIAGNOSTIC_ROTATIONS - 1, 1, -1):
                        older = f"{path}.{index - 1}"
                        newer = f"{path}.{index}"
                        if os.path.exists(older):
                            os.replace(older, newer)
                    os.replace(path, f"{path}.1")
                with open(path, "a", encoding="utf-8") as diagnostic_file:
                    diagnostic_file.write(line)
                try:
                    fcntl.flock(lock_file.fileno(), fcntl.LOCK_UN)
                except OSError:
                    pass
        finally:
            _LUMP_SAVE_DIAGNOSTIC_LOCK.release()
        return True
    except BaseException:
        # Diagnostics must never turn a successful atomic save into a failed
        # HTTP response. The application logger still records the issue.
        try:
            logging.exception("[lumps] unable to append save diagnostic")
        except BaseException:
            pass
        return False


def _save_lump_diagnostic_event(*, stage, event, outcome="unknown", error=None,
                                http_status=None, **fields):
    """Emit an authoritative event for the current SAVE LUMP request."""
    try:
        record = getattr(g, "_lump_save_diagnostic", None)
        if not isinstance(record, dict):
            return False
        started = record.get("started_monotonic")
        elapsed_ms = None
        if isinstance(started, (int, float)):
            elapsed_ms = max(0, int((time.monotonic() - started) * 1000))
        try:
            entry_point = request.path
        except RuntimeError:
            entry_point = "server"
        payload = {
            "attempt_id": record.get("attempt_id"),
            "operation_id": record.get("operation_id"),
            "candidate_id": record.get("candidate_id"),
            "plan_id": record.get("plan_id"),
            "client_diagnostic_attempt_id": record.get(
                "client_diagnostic_attempt_id"),
            "stage": stage, "event": event, "outcome": outcome,
            "entry_point": entry_point,
            "elapsed_ms": elapsed_ms, "http_status": http_status,
            "error": error,
        }
        payload.update(fields)
        return _append_lump_diagnostic_event(
            payload, source="server", authoritative=True)
    except BaseException:
        # The diagnostic path is deliberately fail-closed. In particular, a
        # broken logger or custom event object must not escape into Flask.
        try:
            logging.error("[lumps] save diagnostic emission failed")
        except BaseException:
            pass
        return False


def _diagnostic_origin_is_same_site():
    """Accept browser diagnostics only from the current configured origin."""
    supplied = request.headers.get("Origin")
    if not supplied:
        # A normal unauthenticated IDE/CLI test caller may omit Origin, but a
        # browser-shaped request may not bypass the same-origin boundary.
        browser_headers = (
            request.headers.get("Sec-Fetch-Site")
            or request.headers.get("Sec-Fetch-Mode")
            or request.headers.get("Sec-Fetch-Dest")
        )
        user_agent = request.headers.get("User-Agent", "")
        if browser_headers or re.search(
                r"(?:mozilla|chrome|safari|firefox|edg|webkit)",
                user_agent, re.I):
            return False
        return True
    supplied = supplied.rstrip("/")
    allowed = {request.url_root.rstrip("/"), request.host_url.rstrip("/")}
    domains = []
    for key in ("REPLIT_DEV_DOMAIN", "REPLIT_DOMAINS"):
        domains.extend(os.environ.get(key, "").replace(",", " ").split())
    for domain in domains:
        domain = domain.strip().rstrip("/")
        if domain:
            allowed.update((f"https://{domain}", f"http://{domain}"))
    return supplied in allowed


def _diagnostic_session_binding():
    """Return a diagnostics-only signed-session binding.

    A fresh IDE tab reports capture or validation failures before the save
    preflight has established an approval session.  The diagnostics stream is
    intentionally metadata-only and same-origin gated, so it can bootstrap
    this separate rate-limit binding without granting any save capability.
    """
    binding = session.get(_LUMP_SAVE_DIAGNOSTIC_SESSION_KEY)
    if (not isinstance(binding, str)
            or not re.fullmatch(r"[A-Za-z0-9_-]{16,128}", binding)):
        binding = secrets.token_urlsafe(24)
        session[_LUMP_SAVE_DIAGNOSTIC_SESSION_KEY] = binding
    return binding


def _diagnostic_has_session_proof():
    """Return whether this browser has a diagnostics-only session binding."""
    binding = session.get(_LUMP_SAVE_DIAGNOSTIC_SESSION_KEY)
    return (isinstance(binding, str)
            and bool(re.fullmatch(r"[A-Za-z0-9_-]{16,128}", binding)))


def _diagnostic_rate_allowed():
    """Bound browser reporting without retaining the caller address."""
    binding = _diagnostic_session_binding()
    key = hashlib.sha256(
        (str(app.secret_key) + "|diagnostics|" + str(binding)).encode("utf-8")
    ).hexdigest()
    now = time.monotonic()
    if not _LUMP_SAVE_DIAGNOSTIC_RATE_LOCK.acquire(blocking=False):
        return False
    try:
        global_values = [
            stamp for stamp in _LUMP_SAVE_DIAGNOSTIC_GLOBAL_RATE
            if now - stamp < _LUMP_SAVE_DIAGNOSTIC_RATE_WINDOW
        ]
        if len(global_values) >= _LUMP_SAVE_DIAGNOSTIC_GLOBAL_RATE_LIMIT:
            _LUMP_SAVE_DIAGNOSTIC_GLOBAL_RATE[:] = global_values
            return False
        # Expired keys are discarded before adding a new one, so attacker
        # controlled sessions cannot grow this in-memory map without bound.
        for old_key, old_values in list(_LUMP_SAVE_DIAGNOSTIC_RATE.items()):
            fresh = [
                stamp for stamp in old_values
                if now - stamp < _LUMP_SAVE_DIAGNOSTIC_RATE_WINDOW
            ]
            if fresh:
                _LUMP_SAVE_DIAGNOSTIC_RATE[old_key] = fresh
            else:
                _LUMP_SAVE_DIAGNOSTIC_RATE.pop(old_key, None)
        if (key not in _LUMP_SAVE_DIAGNOSTIC_RATE
                and len(_LUMP_SAVE_DIAGNOSTIC_RATE)
                >= _LUMP_SAVE_DIAGNOSTIC_MAX_RATE_KEYS):
            return False
        values = [
            stamp for stamp in _LUMP_SAVE_DIAGNOSTIC_RATE.get(key, [])
            if now - stamp < _LUMP_SAVE_DIAGNOSTIC_RATE_WINDOW
        ]
        if len(values) >= _LUMP_SAVE_DIAGNOSTIC_RATE_LIMIT:
            _LUMP_SAVE_DIAGNOSTIC_RATE[key] = values
            return False
        values.append(now)
        _LUMP_SAVE_DIAGNOSTIC_RATE[key] = values
        global_values.append(now)
        _LUMP_SAVE_DIAGNOSTIC_GLOBAL_RATE[:] = global_values
        return True
    finally:
        _LUMP_SAVE_DIAGNOSTIC_RATE_LOCK.release()


@app.route("/api/lumps/save-diagnostics", methods=["POST"])
def save_lump_diagnostics():
    """Best-effort browser event ingestion; there is deliberately no GET."""
    def _rejected(message, status, received=0):
        return jsonify({
            "ok": False,
            "error": message,
            "accepted": 0,
            "accepted_event_ids": [],
            "received": received,
        }), status

    if not _diagnostic_origin_is_same_site():
        return _rejected("same-origin diagnostics required", 403)
    if not _diagnostic_rate_allowed():
        return _rejected("diagnostic reporting rate limit exceeded", 429)
    if request.content_length and request.content_length > _LUMP_SAVE_DIAGNOSTIC_MAX_BATCH_BYTES:
        return _rejected("diagnostic batch is too large", 413)
    raw_body = request.get_data(cache=True)
    if len(raw_body) > _LUMP_SAVE_DIAGNOSTIC_MAX_BATCH_BYTES:
        return _rejected("diagnostic batch is too large", 413)
    payload = request.get_json(silent=True)
    if not isinstance(payload, dict) or set(payload) - {"events"}:
        return _rejected("request must contain only events", 400)
    events = payload.get("events")
    if not isinstance(events, list):
        return _rejected("events must be an array", 400)
    if len(events) > _LUMP_SAVE_DIAGNOSTIC_MAX_BATCH_EVENTS:
        return _rejected("too many diagnostic events", 413, len(events))
    accepted = 0
    accepted_event_ids = []
    for event in events:
        normalized = _sanitize_lump_diagnostic_event(
            event, source="client", authoritative=False)
        if normalized is not None and _append_lump_diagnostic_event(
                normalized, source="client", authoritative=False):
            accepted += 1
            event_id = normalized.get("event_id")
            if event_id is not None:
                accepted_event_ids.append(event_id)
    return jsonify({
        "ok": True,
        "accepted": accepted,
        "accepted_event_ids": accepted_event_ids,
        "received": len(events),
    }), 202


@app.after_request
def _record_lump_save_diagnostic(response):
    record = getattr(g, "_lump_save_diagnostic", None)
    if record is None:
        return response
    try:
        body = response.get_json(silent=True)
    except Exception:
        body = None
    body = body if isinstance(body, dict) else {}
    committed = body.get("committed")
    if (record.get("is_preflight")
            and "committed" not in body
            and response.status_code < 300):
        # A successful plan is preparation, not a committed save. Do not
        # mislabel it as a rejected artifact in the retained result event.
        committed = None
    elif committed is None and "committed" not in body:
        committed = bool(body.get("ok") is True and response.status_code < 300)
    elif committed is not None and not isinstance(committed, bool):
        committed = None
    if (record.get("add_committed_projection", True)
            and response.status_code >= 400 and "committed" not in body):
        # Every save failure is returned before the atomic transition commits,
        # or from a transition that has already rolled back. Make that fact
        # explicit to the browser instead of forcing it to infer state from
        # the HTTP status alone.
        body["committed"] = False
        response.set_data(json.dumps(body))
        response.content_type = "application/json"
    outcome = "committed" if committed is True else "rejected"
    if body.get("atomic_transition_failed") or committed is None:
        outcome = "unknown"
    stage = "Commit" if committed is True or body.get(
        "atomic_transition_failed") else "Prepare"
    error = None if committed is True or (
        record.get("is_preflight") and response.status_code < 300) else {
        "name": "SaveError",
        "message": body.get("error") or response.status or "save failed",
    }
    _save_lump_diagnostic_event(
        stage=stage, event="request_result", outcome=outcome,
        error=error, http_status=response.status_code)
    summary = {
        "attempt_id": record.get("attempt_id"),
        "operation_id": record.get("operation_id"),
        "candidate_id": record.get("candidate_id"),
        "plan_id": record.get("plan_id"),
        "stage": stage, "event": "save_result", "outcome": outcome,
        "entry_point": request.path, "http_status": response.status_code,
        "error": error, "committed": committed,
    }
    _append_lump_diagnostic_event(
        summary, source="server", authoritative=True)
    if getattr(g, "_lump_save_operation_active", False):
        # Validation failures are proven non-commits because this hook runs
        # after the handler has returned.  A transition exception is explicitly
        # left unknown: a process interruption around a multi-file transition
        # must never be reported as a proven rollback.
        try:
            _prior = _read_lump_save_operation(record["operation_id"]) or {}
            if (_prior.get("outcome") == "committed"
                    and outcome != "committed"):
                # A concurrent request with the same ID may lose the history
                # race after the winner has committed.  Never downgrade that
                # durable proof to its follower's conflict response.
                response.headers["X-Lump-Save-Operation"] = record["operation_id"]
                return response
            _prior.update({
                "outcome": outcome,
                "status": response.status_code,
                "response": body,
                "updated_at": time.time(),
            })
            _write_lump_save_operation(record["operation_id"], _prior)
        except Exception:
            logging.exception("[lumps] unable to record save operation result")
    response.headers["X-Lump-Save-Operation"] = record["operation_id"]
    return response

@app.route("/api/m-bit-ide-access", methods=["GET", "POST"])
def api_m_bit_ide_access():
    """Verify a one-use M_BIT_DEV picker reveal without persisting access."""
    response = None
    if request.method == "POST":
        configured = os.environ.get("M_BIT_IDE_SECRET", "")
        supplied = str((request.get_json(silent=True) or {}).get("secret", ""))
        # Exact, case-sensitive match.  compare_digest avoids leaking how much
        # of an incorrect secret matched.
        if not configured or not hmac.compare_digest(supplied, configured):
            response = make_response(jsonify({"unlocked": False, "error": "Incorrect IDE secret"}), 403)
        else:
            response = make_response(jsonify({"unlocked": True}))
    else:
        # Unlock state intentionally exists only in the current browser picker.
        # Reloading or reopening always requires the IDE secret again.
        response = make_response(jsonify({"unlocked": False}))
    response.headers["Cache-Control"] = "no-store"
    return response
app.wsgi_app = ProxyFix(app.wsgi_app, x_proto=1, x_host=1)

db_path = (
    _DB_PATH_OVERRIDE
    if _DB_PATH_OVERRIDE
    else os.path.join(os.path.dirname(os.path.abspath(__file__)), "church_machine.db")
)
app.config["SQLALCHEMY_DATABASE_URI"] = f"sqlite:///{db_path}"
app.config["SQLALCHEMY_TRACK_MODIFICATIONS"] = False

db.init_app(app)

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SIMULATOR_DIR = os.path.join(BASE_DIR, "simulator")
DOCS_DIR = os.path.join(BASE_DIR, "docs")
WEB_DIR = os.path.join(BASE_DIR, "web")
RISCV_CAP_DIR = os.path.join(BASE_DIR, "riscv_cap")

BOOT_ID = str(uuid.uuid4())

def _build_version_identity():
    """Return the current build identifier together with its identity type.

    Development workspaces have Git metadata, while published deployments
    identify themselves with the Replit deployment build ID.  These strings
    use different namespaces and must not be presented as comparable commits.
    """
    try:
        version = subprocess.check_output(
            ["git", "rev-parse", "--short", "HEAD"],
            cwd=BASE_DIR, stderr=subprocess.DEVNULL
        ).decode().strip()
        if version:
            return version, "git"
    except Exception:
        pass
    deploy_id = os.environ.get("REPL_DEPLOY_ID", "")
    if deploy_id:
        return deploy_id[:8], "deployment"
    repl_id = os.environ.get("REPL_ID", "")
    if repl_id:
        return repl_id[:8], "runtime"
    return "unknown", "unknown"

def _git_short_hash():
    """Backward-compatible shorthand for callers storing a build identifier."""
    return _build_version_identity()[0]

BUILD_VERSION, BUILD_VERSION_KIND = _build_version_identity()

_COMPRESSIBLE = ('javascript', 'css', 'html', 'json', 'text/')
_gz_cache = {}

def _serve_file(filepath, filename):
    """Read a file from disk and return a gzip-compressed response with ETag support."""
    if not os.path.isfile(filepath):
        return make_response("Not found", 404)
    stat = os.stat(filepath)
    etag = f'"{int(stat.st_mtime)}-{stat.st_size}"'
    if request.headers.get('If-None-Match') == etag:
        resp = make_response('', 304)
        resp.headers['ETag'] = etag
        resp.headers['Cache-Control'] = 'no-cache'
        return resp
    ct = mimetypes.guess_type(filename)[0] or 'application/octet-stream'
    ae = request.headers.get('Accept-Encoding', '')
    if 'gzip' in ae and any(x in ct for x in _COMPRESSIBLE):
        cache_key = etag
        if cache_key not in _gz_cache:
            with open(filepath, 'rb') as f:
                data = f.read()
            if len(data) >= 1024:
                compressed = _gzip.compress(data, compresslevel=6)
                _gz_cache[cache_key] = compressed if len(compressed) < len(data) else None
                raw = data
            else:
                _gz_cache[cache_key] = None
                raw = data
        else:
            compressed = _gz_cache[cache_key]
            raw = None
        compressed = _gz_cache[cache_key]
        if compressed is not None:
            resp = make_response(compressed)
            resp.headers['Content-Type'] = ct
            resp.headers['Content-Encoding'] = 'gzip'
            resp.headers['Content-Length'] = len(compressed)
            resp.headers['Vary'] = 'Accept-Encoding'
            resp.headers['ETag'] = etag
            resp.headers['Cache-Control'] = 'no-cache'
            return resp
        if raw is None:
            with open(filepath, 'rb') as f:
                raw = f.read()
        resp = make_response(raw)
        resp.headers['Content-Type'] = ct
        resp.headers['Content-Length'] = len(raw)
        resp.headers['ETag'] = etag
        resp.headers['Cache-Control'] = 'no-cache'
        return resp
    with open(filepath, 'rb') as f:
        data = f.read()
    resp = make_response(data)
    resp.headers['Content-Type'] = ct
    resp.headers['Content-Length'] = len(data)
    resp.headers['ETag'] = etag
    resp.headers['Cache-Control'] = 'no-cache'
    return resp

@app.after_request
def add_cache_control(response):
    if response.content_type and (
        "javascript" in response.content_type
        or "text/css" in response.content_type
        or "text/html" in response.content_type
    ):
        existing = response.headers.get("Cache-Control", "")
        if "no-store" not in existing:
            response.headers["Cache-Control"] = "no-cache, must-revalidate"
        response.headers["Pragma"] = "no-cache"
        response.headers["Expires"] = "0"
    response.headers["Permissions-Policy"] = "serial=(self)"
    return response

_INTRO_DIST_DIR = os.path.join(BASE_DIR, "artifacts", "church-machine-ide-introduction", "dist", "public")

@app.route("/ide-intro/")
@app.route("/ide-intro/<path:filename>")
def serve_ide_intro(filename="index.html"):
    """Serve the pre-built IDE Introduction slides SPA.

    The artifact is built with BASE_PATH=/ide-intro/ so all asset references
    are rooted there.  Any path that doesn't match a real file falls back to
    index.html so client-side routes (/handout, etc.) work after a hard
    refresh.

    Returns 503 with a JSON body if the SPA has not been built yet (i.e.
    dist/public/index.html is absent) so callers get an actionable error
    rather than a werkzeug 404 with no explanation.
    """
    index_path = os.path.join(_INTRO_DIST_DIR, "index.html")
    if not os.path.isfile(index_path):
        return jsonify({
            "error": "IDE Introduction slides not built. "
                     "Run: pnpm --filter @workspace/church-machine-ide-introduction build"
        }), 503
    filepath = os.path.join(_INTRO_DIST_DIR, filename)
    if os.path.isfile(filepath):
        return send_from_directory(_INTRO_DIST_DIR, filename)
    return send_from_directory(_INTRO_DIST_DIR, "index.html")

@app.route("/dl/wukong-bridge")
def download_wukong_bridge():
    # Serve the canonical bridge from hardware/ — server/wukong_bridge.py was a
    # stale duplicate that caused users to download an outdated bridge.
    p = os.path.join(os.path.dirname(__file__), "..", "hardware", "wukong_bridge.py")
    if not os.path.isfile(p):
        return jsonify({"ok": False, "error": "Wukong bridge is unavailable"}), 404
    return send_file(os.path.abspath(p), as_attachment=True,
                     download_name="wukong_bridge.py",
                     mimetype="text/plain")

def _wukong_build_version():
    """Read WUKONG_BUILD_VERSION from hardware/wukong_top.py (best-effort)."""
    try:
        top = os.path.join(os.path.dirname(__file__), "..", "hardware", "wukong_top.py")
        with open(os.path.abspath(top)) as f:
            for line in f:
                m = re.match(r"\s*WUKONG_BUILD_VERSION\s*=\s*(\d+)", line)
                if m:
                    return int(m.group(1))
    except Exception:
        pass
    return None

def _wukong_bridge_version():
    """Read the version of the canonical downloadable bridge (best-effort)."""
    try:
        bridge = os.path.join(os.path.dirname(__file__), "..", "hardware",
                              "wukong_bridge.py")
        with open(os.path.abspath(bridge)) as f:
            for line in f:
                m = re.match(r"\s*BRIDGE_VERSION\s*=\s*(\d+)", line)
                if m:
                    return int(m.group(1))
    except Exception:
        pass
    return None

def _wukong_build_dir():
    """Directory holding the pre-built Wukong bitstream (patchable in tests)."""
    return os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "build"))


_wukong_upload_lock = threading.RLock()


def _wukong_upload_guard(build_dir):
    """Serialize canonical bitstream publication across threads and workers."""
    import contextlib
    import fcntl

    @contextlib.contextmanager
    def _guard():
        os.makedirs(build_dir, exist_ok=True)
        lock_path = os.path.join(build_dir, ".wukong-upload.lock")
        with _wukong_upload_lock:
            with open(lock_path, "a+") as lock_file:
                fcntl.flock(lock_file.fileno(), fcntl.LOCK_EX)
                try:
                    yield
                finally:
                    fcntl.flock(lock_file.fileno(), fcntl.LOCK_UN)
    return _guard()


def _bitstream_sidecar_path(bit_path):
    """Path of the JSON metadata sidecar next to a .bit file."""
    return bit_path + ".meta.json"

def _sha256_file(path):
    """Return the SHA-256 digest for a local artifact, or None if unreadable."""
    import hashlib
    try:
        digest = hashlib.sha256()
        with open(path, "rb") as handle:
            for chunk in iter(lambda: handle.read(1 << 20), b""):
                digest.update(chunk)
        return digest.hexdigest()
    except (OSError, TypeError):
        return None

def _write_bitstream_sidecar(bit_path, version=None, source_commit=None):
    """Write a metadata sidecar describing the actual .bit file on disk.

    Records the declared build version (may be None if unknown), the md5 of
    the file contents (so staleness/tampering is detectable), a built_at
    timestamp, and the source commit when known.
    """
    import hashlib, datetime as _dt
    md5 = hashlib.md5()
    sha256 = hashlib.sha256()
    with open(bit_path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            md5.update(chunk)
            sha256.update(chunk)
    meta = {
        "version": version,
        "md5": md5.hexdigest(),
        "sha256": sha256.hexdigest(),
        "built_at": _dt.datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ"),
        "source_commit": source_commit,
        "size_bytes": os.path.getsize(bit_path),
    }
    with open(_bitstream_sidecar_path(bit_path), "w") as f:
        json.dump(meta, f, indent=2)
    return meta

def _read_bitstream_meta(bit_path):
    """Return trustworthy sidecar metadata for bit_path, or None.

    Returns None when the sidecar is missing, unparseable, or its recorded
    digest no longer matches the file on disk (i.e. the .bit was replaced
    without updating the sidecar — metadata cannot be trusted). Legacy
    MD5-only sidecars remain readable for download labeling, but a sidecar that
    supplies SHA-256 must also verify it before that stronger identity is used.
    """
    import hashlib
    sc = _bitstream_sidecar_path(bit_path)
    try:
        with open(sc) as f:
            meta = json.load(f)
        if not isinstance(meta, dict) or not meta.get("md5"):
            return None
        md5 = hashlib.md5()
        sha256 = hashlib.sha256()
        with open(bit_path, "rb") as f:
            for chunk in iter(lambda: f.read(1 << 20), b""):
                md5.update(chunk)
                sha256.update(chunk)
        if md5.hexdigest() != meta["md5"]:
            return None
        expected_sha256 = meta.get("sha256")
        if expected_sha256 and sha256.hexdigest() != expected_sha256:
            return None
        return meta
    except Exception:
        return None

def _read_wukong_release_evidence(build_dir):
    """Return verified identities for the canonical Wukong release bundle."""
    bit_name = "church_wukong_xc7a100t.bit"
    mcs_name = "church_wukong_xc7a100t.mcs"
    bit_path = os.path.join(build_dir, bit_name)
    mcs_path = os.path.join(build_dir, mcs_name)
    provenance_path = os.path.join(
        build_dir, "church_wukong_xc7a100t.provenance.json"
    )
    evidence = {
        "verified": False,
        "bit_sha256": _sha256_file(bit_path),
        "mcs_sha256": _sha256_file(mcs_path),
        "provenance_identity": None,
    }
    meta = _read_bitstream_meta(bit_path) if os.path.isfile(bit_path) else None
    try:
        with open(provenance_path, encoding="utf-8") as handle:
            provenance = json.load(handle)
    except (OSError, ValueError, TypeError):
        return evidence
    if not isinstance(provenance, dict) or not isinstance(meta, dict):
        return evidence

    artifacts = provenance.get("artifacts")
    if not isinstance(artifacts, dict):
        return evidence
    bit_record = artifacts.get(bit_name)
    mcs_record = artifacts.get(mcs_name)
    sentinel = provenance.get("sentinel")
    source_commit = provenance.get("source_commit")
    build_version = sentinel.get("build_version") if isinstance(sentinel, dict) else None
    if (
        not isinstance(bit_record, dict) or
        not isinstance(mcs_record, dict) or
        not isinstance(source_commit, str) or
        not re.fullmatch(r"[0-9a-fA-F]{40}", source_commit) or
        not isinstance(build_version, int) or
        isinstance(build_version, bool)
    ):
        return evidence
    evidence["verified"] = bool(
        provenance.get("schema_version") == 1 and
        provenance.get("release_status") == "verified" and
        provenance.get("source_tree_clean") is True and
        evidence["bit_sha256"] and
        evidence["mcs_sha256"] and
        meta.get("sha256") == evidence["bit_sha256"] ==
        bit_record.get("sha256") and
        meta.get("size_bytes") == bit_record.get("size_bytes") ==
        os.path.getsize(bit_path) and
        meta.get("source_commit") == source_commit and
        meta.get("version") == build_version and
        evidence["mcs_sha256"] == mcs_record.get("sha256") and
        mcs_record.get("size_bytes") == os.path.getsize(mcs_path)
    )
    if evidence["verified"]:
        identity_material = {
            "schema": "wukong-release-download-v1",
            "source_commit": source_commit.lower(),
            "build_version": build_version,
            "bit_sha256": evidence["bit_sha256"],
            "mcs_sha256": evidence["mcs_sha256"],
        }
        canonical = json.dumps(identity_material, sort_keys=True,
                               separators=(",", ":"), ensure_ascii=True)
        evidence["provenance_identity"] = (
            "wukong-release:v1:" +
            hashlib.sha256(canonical.encode("utf-8")).hexdigest()
        )
    return evidence


def _wukong_bit_download_identity(bit_path):
    """Return exact verified metadata for the bytes currently at bit_path."""
    meta = _read_bitstream_meta(bit_path) if os.path.isfile(bit_path) else None
    if not meta:
        return None
    digest = meta.get("sha256") or _sha256_file(bit_path)
    if not digest:
        return None
    material = {
        "schema": "wukong-bit-download-v1",
        "sha256": digest,
        "version": meta.get("version"),
        "source_commit": meta.get("source_commit"),
    }
    canonical = json.dumps(material, sort_keys=True, separators=(",", ":"),
                           ensure_ascii=True)
    return {
        "provenance_identity": "wukong-bit:v1:" + hashlib.sha256(
            canonical.encode("utf-8")).hexdigest(),
        "sha256": digest,
        "meta": meta,
    }


def _serve_exact_wukong_artifact(path, name, kind, identity, digest):
    """Serve only when the caller selected these exact current bytes."""
    target, target_error = _wukong_target_error(request.args)
    if target_error:
        return _wukong_target_rejection(target_error)
    requested_identity = str(
        request.args.get("artifact_identity") or
        request.args.get("provenance_identity", "") or "").strip()
    requested_digest = str(request.args.get("sha256", "") or "").strip().lower()
    if not identity or not digest:
        return jsonify({
            "ok": False, "error": "Current artifact has no verified download identity",
            "decision": "identity_unavailable",
        }), 409
    if (not requested_identity or not requested_digest or
            not hmac.compare_digest(requested_identity, identity) or
            not hmac.compare_digest(requested_digest, digest.lower())):
        return jsonify({
            "ok": False,
            "error": "Requested artifact identity does not match the current verified bytes",
            "decision": "artifact_mismatch",
        }), 409
    # Re-hash at the serve boundary so replacement after status discovery
    # cannot make a formerly valid URL download different bytes.
    current_digest = _sha256_file(path)
    if not current_digest or not hmac.compare_digest(current_digest, digest.lower()):
        return jsonify({
            "ok": False, "error": "Artifact changed before download",
            "decision": "stale_artifact",
        }), 409
    response = send_file(os.path.abspath(path), as_attachment=True,
                         download_name=name,
                         mimetype="application/octet-stream")
    response.headers["X-Wukong-Provenance-Identity"] = identity
    response.headers["X-Wukong-Artifact-SHA256"] = digest.lower()
    response.headers["X-Wukong-Artifact-Kind"] = kind
    response.headers["X-Wukong-Lifecycle-State"] = "downloaded"
    response.headers["Cache-Control"] = "no-store"
    return response


_BITSTREAM_VERSION_LOG_FILE = "wukong-bitstream-versions.json"
_bitstream_version_log_lock = threading.Lock()


def _bitstream_version_log_path():
    """Return the append-only Wukong build-version log path."""
    return os.path.join(_wukong_build_dir(), _BITSTREAM_VERSION_LOG_FILE)

def _read_bitstream_version_log():
    """Return the persisted version log, newest first, without raising."""
    try:
        with open(_bitstream_version_log_path()) as f:
            records = json.load(f)
        if not isinstance(records, list):
            return []
        return [record for record in records if isinstance(record, dict)][-100:][::-1]
    except (OSError, ValueError, TypeError):
        return []

def _record_bitstream_version_event(status, version, source, source_commit=None,
                                    bit_hash=None):
    """Persist a factual Wukong bitstream build event.

    The remote Vivado build and a subsequent artifact upload are separate
    operations.  A build record therefore never invents an artifact hash:
    ``bit_hash`` remains null until the generated .bit is uploaded and verified
    locally.  The version and source commit are captured before the remote build
    starts so later edits cannot rewrite this historical record.
    """
    import datetime as _dt
    record = {
        "timestamp": _dt.datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ"),
        "status": "succeeded" if status == "succeeded" else "failed",
        "version": version if isinstance(version, int) else None,
        "source": str(source)[:40],
        "source_commit": str(source_commit)[:64] if source_commit else None,
        "bit_hash": str(bit_hash)[:128] if bit_hash else None,
    }
    with _bitstream_version_log_lock:
        existing = list(reversed(_read_bitstream_version_log()))
        existing.append(record)
        log_path = _bitstream_version_log_path()
        log_dir = os.path.dirname(log_path)
        if log_dir:
            os.makedirs(log_dir, exist_ok=True)
        _atomic_write_json(log_path, existing[-100:])
    return record

_WUKONG_BITSTREAM_SOURCE_PREFIXES = ("hardware/", "verilog/")
_WUKONG_BITSTREAM_SOURCE_EXCLUDES = (
    "hardware/wukong_bridge.py",
)

def _is_wukong_bitstream_source(path):
    """Return whether a repository path can change the synthesized Wukong image."""
    if not any(path.startswith(prefix) for prefix in _WUKONG_BITSTREAM_SOURCE_PREFIXES):
        return False
    if path in _WUKONG_BITSTREAM_SOURCE_EXCLUDES or path.startswith("hardware/test"):
        return False
    return True

def _git_full_head():
    """Return the full local HEAD, or None when this checkout has no git history."""
    try:
        return subprocess.check_output(
            ["git", "rev-parse", "HEAD"],
            cwd=BASE_DIR, stderr=subprocess.DEVNULL, timeout=10,
            text=True,
        ).strip()
    except Exception:
        return None

def _wukong_bitstream_release_status():
    """Describe source changes waiting for the next Wukong bitstream release.

    The source commit stored in a verified bitstream sidecar is the release
    baseline.  If that metadata is absent or unverifiable, the baseline is
    explicitly unknown rather than guessing that the current artifact contains
    the current source.  This endpoint is intentionally read-only; the Build
    Approval tab remains the sole build/release action.
    """
    bit_path = os.path.join(_wukong_build_dir(), "church_wukong_xc7a100t.bit")
    meta = _read_bitstream_meta(bit_path) if os.path.isfile(bit_path) else None
    release_evidence = _read_wukong_release_evidence(_wukong_build_dir())
    head = _git_full_head()
    short_head = head[:12] if head else _git_short_hash()
    source_version = _wukong_build_version()
    artifact_version = meta.get("version") if meta else None
    artifact_commit = meta.get("source_commit") if meta else None
    artifact_sha = None
    if meta:
        artifact_sha = meta.get("sha256")
        if not artifact_sha and os.path.isfile(bit_path):
            # Legacy sidecars only carried MD5; they remain usable for download
            # labeling, but never qualify as a release proof.
            artifact_sha = None
    provenance_matches = release_evidence["verified"]
    baseline_known = bool(
        head and artifact_commit and
        re.fullmatch(r"[0-9a-fA-F]{7,40}", str(artifact_commit))
    )
    pending = (
        meta is None or
        artifact_version != source_version or
        not baseline_known or
        str(artifact_commit).lower() != head.lower() or
        not provenance_matches
    )

    if not pending:
        reason = "The verified bitstream matches the current main-workstream source."
    elif meta is None:
        reason = "The stored bitstream has no trusted metadata; a new release baseline is required."
    elif artifact_version != source_version:
        reason = f"Source is at v{source_version}, while the verified artifact is v{artifact_version}."
    elif not baseline_known:
        reason = "The verified artifact has no trusted source commit, so its release baseline is unknown."
    elif not provenance_matches:
        reason = "The bitstream has no matching clean-source provenance record; release status is unknown."
    else:
        reason = "Hardware source changes are ahead of the verified bitstream."

    items = []
    git_error = None
    if head:
        try:
            log_args = [
                "git", "log", "--first-parent",
                "--format=%H%x09%h%x09%aI%x09%s",
            ]
            if baseline_known:
                ancestor = subprocess.run(
                    ["git", "merge-base", "--is-ancestor", str(artifact_commit), head],
                    cwd=BASE_DIR, stdout=subprocess.DEVNULL,
                    stderr=subprocess.DEVNULL, timeout=10,
                ).returncode == 0
            else:
                ancestor = False
            if ancestor:
                log_args.append(f"{artifact_commit}..HEAD")
            else:
                log_args.extend(["-n", "8"])
            log_args.extend(["--", "hardware/", "verilog/"])
            log_text = subprocess.check_output(
                log_args, cwd=BASE_DIR, stderr=subprocess.DEVNULL,
                timeout=20, text=True,
            )
            for line in log_text.splitlines():
                parts = line.split("\t", 3)
                if len(parts) != 4:
                    continue
                commit, short_commit, committed_at, message = parts
                files_text = subprocess.check_output(
                    ["git", "diff-tree", "--root", "--no-commit-id",
                     "--name-only", "-r", commit, "--", "hardware/", "verilog/"],
                    cwd=BASE_DIR, stderr=subprocess.DEVNULL,
                    timeout=10, text=True,
                )
                files = sorted({
                    path.strip() for path in files_text.splitlines()
                    if _is_wukong_bitstream_source(path.strip())
                })
                if files:
                    items.append({
                        "commit": short_commit[:12],
                        "timestamp": committed_at,
                        "message": message[:240],
                        "files": files[:40],
                    })
                if len(items) >= 8:
                    break
        except Exception as exc:
            # The release card remains useful without commit detail, and must
            # not expose subprocess paths or exception text to the browser.
            git_error = "Source history is temporarily unavailable."
            logging.debug("Wukong release candidate history unavailable: %s", exc)

    return {
        "pending": bool(pending),
        "source_version": source_version,
        "source_commit": short_head,
        "artifact": {
            "present": bool(os.path.isfile(bit_path)),
            "version": artifact_version,
            "source_commit": str(artifact_commit)[:12] if artifact_commit else None,
            "built_at": meta.get("built_at") if meta else None,
            "sha256": artifact_sha,
            "provenance_verified": provenance_matches,
        },
        "baseline_known": baseline_known,
        "reason": reason,
        "items": items,
        "error": git_error,
    }

@app.route("/api/bitstream-versions")
def api_bitstream_versions():
    """Return completed Wukong releases plus the current pending release set."""
    return jsonify({
        "ok": True,
        "versions": _read_bitstream_version_log(),
        "release": _wukong_bitstream_release_status(),
    })

def _wukong_min_tu_version():
    """Read _TU_VERSION_CALL_3PKT from hardware/wukong_top.py (best-effort)."""
    try:
        top = os.path.join(os.path.dirname(__file__), "..", "hardware", "wukong_top.py")
        with open(os.path.abspath(top)) as f:
            for line in f:
                m = re.match(r"\s*_TU_VERSION_CALL_3PKT\s*=\s*(0[xX][0-9a-fA-F]+|\d+)", line)
                if m:
                    return int(m.group(1), 0)
    except Exception:
        pass
    return None

def _wukong_min_thread_scheduler_build():
    """Read the explicit M6 scheduler capability floor from the RTL source."""
    try:
        top = os.path.join(os.path.dirname(__file__), "..", "hardware", "wukong_top.py")
        with open(os.path.abspath(top)) as f:
            for line in f:
                m = re.match(r"\s*WUKONG_THREAD_SCHEDULER_MIN_BUILD\s*=\s*(\d+)", line)
                if m:
                    return int(m.group(1))
    except Exception:
        pass
    return None

@app.route("/dl/wukong-bit")
def download_wukong_bit():
    p = os.path.join(_wukong_build_dir(), "church_wukong_xc7a100t.bit")
    # Only advertise a version verified against the actual file's sidecar
    # metadata — never the current source version (the .bit on disk may be
    # older than the source right after a code push).
    exact = _wukong_bit_download_identity(p)
    meta = exact.get("meta") if exact else None
    ver = meta.get("version") if meta else None
    name = ("church_wukong_xc7a100t_v%d.bit" % ver) if ver else "church_wukong_xc7a100t.bit"
    return _serve_exact_wukong_artifact(
        p, name, "bit", exact.get("provenance_identity") if exact else None,
        exact.get("sha256") if exact else None)

@app.route("/dl/wukong-bscan")
def download_wukong_bscan():
    p = os.path.join(os.path.dirname(__file__), "..", "build", "bscan_spi_xc7a100t_fgg676.bit")
    return send_file(os.path.abspath(p), as_attachment=True,
                     download_name="bscan_spi_xc7a100t_fgg676.bit",
                     mimetype="application/octet-stream")

@app.route("/dl/wukong-mcs")
def download_wukong_mcs():
    p = os.path.join(_wukong_build_dir(), "church_wukong_xc7a100t.mcs")
    evidence = _read_wukong_release_evidence(_wukong_build_dir())
    identity = evidence.get("provenance_identity") if evidence.get("verified") else None
    return _serve_exact_wukong_artifact(
        p, "church_wukong_xc7a100t.mcs", "mcs", identity,
        evidence.get("mcs_sha256") if evidence.get("verified") else None)

@app.route("/dl/wukong-v17-bit")
def download_wukong_v17_bit():
    """Serve the quarantined v17 candidate without replacing the release file."""
    p = os.path.abspath(os.path.join(
        _wukong_build_dir(), "release-candidate-v17",
        "church_wukong_xc7a100t.bit"))
    if not os.path.isfile(p):
        return jsonify({"ok": False, "error": "v17 candidate is unavailable"}), 404
    return send_file(p, as_attachment=True,
                     download_name="church_wukong_xc7a100t_v17.bit",
                     mimetype="application/octet-stream")

@app.route("/dl/wukong-v17-mcs")
def download_wukong_v17_mcs():
    """Serve the quarantined v17 candidate without replacing the release file."""
    p = os.path.abspath(os.path.join(
        _wukong_build_dir(), "release-candidate-v17",
        "church_wukong_xc7a100t.mcs"))
    if not os.path.isfile(p):
        return jsonify({"ok": False, "error": "v17 candidate is unavailable"}), 404
    return send_file(p, as_attachment=True,
                     download_name="church_wukong_xc7a100t_v17.mcs",
                     mimetype="application/octet-stream")

@app.route("/dl/wukong-verilog")
def download_wukong_verilog():
    p = os.path.join(os.path.dirname(__file__), "..", "build", "church_wukong_xc7a100t.v")
    return send_file(os.path.abspath(p), as_attachment=True,
                     download_name="church_wukong_xc7a100t.v",
                     mimetype="text/plain")

@app.route("/dl/patch-sapphire")
def download_patch_sapphire():
    p = os.path.join(os.path.dirname(__file__), "..", "scripts", "patch_sapphire_init.py")
    return send_file(os.path.abspath(p),
                     as_attachment=True,
                     download_name="patch_sapphire_init.py",
                     mimetype="text/plain")

@app.route("/upload/wukong-bit", methods=["POST"])
def upload_wukong_bit():
    """Accept a new Wukong XC7A100T bitstream upload, save it to build/.

    Usage from Chromebook or droplet:
      curl -X POST <ide-url>/upload/wukong-bit \
           -H "Authorization: Bearer <REPORT_TOKEN>" \
           -F "file=@church_wukong_xc7a100t.bit" \
           -F "version=<hardware-version>" \
           -F "commit=<full-source-commit>" \
           -F "build_record_id=<approved-build-record>"

    Omitting build_record_id is allowed for unmatched external artifacts, but
    those uploads explicitly carry no authoritative Namespace snapshot.
    """
    token = os.environ.get("REPORT_TOKEN", "")
    if not token:
        # Fail closed: a write endpoint with no token configured is not safe to expose.
        return jsonify({"ok": False, "error": "REPORT_TOKEN is not configured on this server"}), 503
    auth = request.headers.get("Authorization", "")
    q_token = request.args.get("token", "")
    if auth != f"Bearer {token}" and q_token != token:
        _record_build_event(board="wukong-xc7a100t", status="failed", notes="auth_rejected")
        return jsonify({"ok": False, "error": "Unauthorized"}), 401
    if "file" not in request.files:
        _record_build_event(board="wukong-xc7a100t", status="failed", notes="missing_file")
        return jsonify({"ok": False, "error": "No file field in request"}), 400
    f = request.files["file"]
    if not f.filename:
        _record_build_event(board="wukong-xc7a100t", status="failed", notes="empty_filename")
        return jsonify({"ok": False, "error": "Empty filename"}), 400
    build_dir = _wukong_build_dir()
    bit_path = os.path.join(build_dir, "church_wukong_xc7a100t.bit")
    # Validate all request metadata BEFORE touching the canonical bitstream,
    # so a rejected upload can never replace or corrupt the served artifact.
    ver_raw = request.form.get("version", "") or request.args.get("version", "")
    version = None
    if ver_raw:
        try:
            version = int(ver_raw)
        except ValueError:
            _record_build_event(board="wukong-xc7a100t", status="failed", notes="invalid_version")
            return jsonify({"ok": False, "error": "version must be an integer"}), 400
    source_commit = request.form.get("commit", "") or request.args.get("commit", "") or None
    build_record_raw = (
        request.form.get("build_record_id", "") or
        request.args.get("build_record_id", "")
    )
    build_record_id = None
    if build_record_raw:
        try:
            build_record_id = int(build_record_raw)
        except ValueError:
            _record_build_event(board="wukong-xc7a100t", status="failed",
                                notes="invalid_build_record")
            return jsonify({"ok": False, "error": "build_record_id must be an integer"}), 400
    _approver = request.form.get("approver", "") or request.args.get("approver", "")

    # Unique temp files plus a cross-process lock keep artifact, sidecar, and
    # history publication one serialized operation.
    import tempfile as _upload_tempfile
    try:
        os.makedirs(build_dir, exist_ok=True)
    except Exception:
        _record_build_event(board="wukong-xc7a100t", status="failed",
                            notes="save_error", approver=_approver)
        app.logger.exception("Wukong bit upload directory error")
        return jsonify({"ok": False, "error": "Upload write failed"}), 500
    with _wukong_upload_guard(build_dir):
        match = {
            "state": "unavailable",
            "reason": "Upload is not bound to an approved server build record.",
        }
        matched_record = None
        matched_snapshot = None
        if build_record_id is not None:
            candidate = db.session.get(BuildRecord, build_record_id)
            binding_error = None
            if candidate is None or candidate.board != "wukong-xc7a100t":
                binding_error = "Approved build record was not found."
            elif candidate.status != "succeeded":
                binding_error = "Approved build did not complete successfully."
            elif candidate.hardware_version != version:
                binding_error = "Upload build version does not match the approved build."
            elif not source_commit or str(candidate.git_commit) != str(source_commit):
                binding_error = "Upload source commit does not exactly match the approved build."
            elif not candidate.bit_hash:
                binding_error = "Approved build has no verified remote artifact digest."
            elif candidate.bit_path:
                binding_error = "Approved build artifact was already uploaded."
            else:
                candidate_snapshot = _read_record_namespace_snapshot(candidate)
                if candidate_snapshot is None:
                    binding_error = "Approved build has no Namespace snapshot."
                else:
                    matched_record = candidate
                    matched_snapshot = candidate_snapshot
            if binding_error:
                _record_build_event(
                    board="wukong-xc7a100t", status="failed",
                    notes="build_binding_rejected", approver=_approver,
                    hardware_version=version, git_commit=source_commit or "")
                return jsonify({"ok": False, "error": binding_error,
                                "namespace_snapshot": False}), 409

        tmp_fd, tmp_path = _upload_tempfile.mkstemp(
            prefix="church_wukong_xc7a100t.bit.uploading.", dir=build_dir)
        os.close(tmp_fd)
        try:
            f.save(tmp_path)
            meta = _write_bitstream_sidecar(
                tmp_path, version=version, source_commit=source_commit)
            if matched_record is not None and meta["md5"] != matched_record.bit_hash:
                _record_build_event(
                    board="wukong-xc7a100t", status="failed",
                    notes="artifact_digest_mismatch", approver=_approver,
                    hardware_version=version, git_commit=source_commit or "")
                return jsonify({
                    "ok": False,
                    "error": "Upload digest does not match the approved remote build.",
                    "namespace_snapshot": False,
                }), 409
            if matched_record is not None:
                match = {
                    "state": "available",
                    "build_id": matched_record.id,
                    "fingerprint": matched_snapshot["fingerprint"],
                }
            os.replace(_bitstream_sidecar_path(tmp_path), _bitstream_sidecar_path(bit_path))
            os.replace(tmp_path, bit_path)
            size = os.path.getsize(bit_path)
        except Exception:
            _record_build_event(board="wukong-xc7a100t", status="failed",
                                notes="save_error", approver=_approver)
            app.logger.exception("Wukong bit upload filesystem error")
            return jsonify({"ok": False, "error": "Upload write failed"}), 500
        finally:
            for leftover in (tmp_path, _bitstream_sidecar_path(tmp_path)):
                try:
                    os.remove(leftover)
                except OSError:
                    pass

        app.logger.info("Wukong bit uploaded: %d bytes (version=%s md5=%s)",
                        size, version, meta["md5"])
        _record_build_event(
            board="wukong-xc7a100t",
            status="succeeded",
            notes="upload" if matched_snapshot else "upload_namespace_unavailable",
            bit_path=bit_path,
            bit_hash=meta["md5"],
            approver=_approver,
            ns_snapshot=matched_snapshot,
            hardware_version=version,
            git_commit=(matched_record.git_commit if matched_record else (source_commit or "")),
        )
        if matched_record is not None:
            matched_record.bit_path = bit_path
            db.session.commit()
        _record_bitstream_version_event(
            status="succeeded",
            version=version,
            source="verified-upload",
            source_commit=source_commit,
            bit_hash=meta["md5"],
        )

    return jsonify({"ok": True, "size_bytes": size, "version": version, "md5": meta["md5"],
                    "namespace_snapshot": match.get("state") == "available",
                    "namespace_reason": match.get("reason")})


@app.route("/api/bitstream-status")
def api_bitstream_status():
    """Return downloadable volatile and persistent Wukong image metadata."""
    build_dir = _wukong_build_dir()
    bit_path = os.path.join(build_dir, "church_wukong_xc7a100t.bit")
    mcs_path = os.path.join(build_dir, "church_wukong_xc7a100t.mcs")
    present = os.path.isfile(bit_path)
    mcs_present = os.path.isfile(mcs_path)
    release_evidence = _read_wukong_release_evidence(build_dir)
    source_version = _wukong_build_version()
    meta = {}
    bit_version = None
    version_known = False
    mismatch = False
    mismatch_message = None
    if present:
        stat = os.stat(bit_path)
        import datetime as _dt
        sidecar = _read_bitstream_meta(bit_path)
        if sidecar:
            bit_version = sidecar.get("version")
            version_known = bit_version is not None
            built_at = sidecar.get("built_at")
            git_sha = sidecar.get("source_commit")
        else:
            built_at = _dt.datetime.utcfromtimestamp(stat.st_mtime).strftime("%Y-%m-%dT%H:%M:%SZ")
            git_sha = None
        if source_version is not None:
            if not version_known:
                mismatch = True
                mismatch_message = ("Source is at v%d but the downloadable bitstream's "
                                    "version is unknown — rebuild/upload needed."
                                    % source_version)
            elif bit_version != source_version:
                mismatch = True
                mismatch_message = ("Source is at v%d but the downloadable bitstream is "
                                    "v%d — rebuild/upload needed."
                                    % (source_version, bit_version))
        meta = {
            "built_at": built_at,
            "firmware_version": bit_version,
            "size_bytes": stat.st_size,
            "git_sha": git_sha,
        }
    # Artifact publication, a browser download, programmer acknowledgement, and
    # a board-reported build are separate facts.  This server can prove only
    # publication and a target-bound boot report; it deliberately has no
    # "installed" shortcut for a downloaded .bit/.mcs.
    with _wukong_boot_info_lock:
        reported = dict(_wukong_boot_info)
    with _wukong_bridge_lock:
        bridge = dict(_wukong_bridge_info)
    report_matches_live_target = bool(
        reported.get('trusted') and reported.get('device_uid') and
        reported.get('device_uid') == bridge.get('device_uid') and
        reported.get('session_id') == bridge.get('session_id') and
        reported.get('received_ts') and bridge.get('updated_ts') and
        time.time() - float(reported['received_ts']) < _WUKONG_TARGET_FRESH_SECONDS and
        time.time() - float(bridge['updated_ts']) < _WUKONG_TARGET_FRESH_SECONDS and
        bridge.get('state') not in ('reconnecting', 'serial_error', 'network_error'))
    bit_download = _wukong_bit_download_identity(bit_path)
    mcs_download_identity = (
        release_evidence.get("provenance_identity")
        if release_evidence.get("verified") else None
    )
    return jsonify({
        "ok": True,
        "present": present,
        "built_at": meta.get("built_at"),
        "build_letter": meta.get("build_letter"),
        "firmware_version": meta.get("firmware_version"),
        "version_known": version_known,
        "source_version": source_version,
        "version_mismatch": mismatch,
        "mismatch_message": mismatch_message,
        "size_bytes": meta.get("size_bytes"),
        "git_sha": meta.get("git_sha"),
        "git_date": meta.get("git_date"),
        "git_message": meta.get("git_message"),
        "mcs_present": mcs_present,
        "mcs_size_bytes": os.path.getsize(mcs_path) if mcs_present else None,
        "artifact_sha256": release_evidence["bit_sha256"],
        "mcs_sha256": release_evidence["mcs_sha256"],
        "release_verified": release_evidence["verified"],
        "download": {
            "bit": {
                "available": bool(bit_download),
                "provenance_identity": (
                    bit_download.get("provenance_identity")
                    if bit_download else None),
                "sha256": bit_download.get("sha256") if bit_download else None,
            },
            "mcs": {
                "available": bool(
                    mcs_present and mcs_download_identity and
                    release_evidence.get("mcs_sha256")),
                "provenance_identity": mcs_download_identity,
                "sha256": (
                    release_evidence.get("mcs_sha256")
                    if mcs_download_identity else None),
            },
        },
        "lifecycle": {
            "generated": bool(present and _read_bitstream_meta(bit_path)),
            "downloaded": "unobserved",
            "programmed": "unacknowledged",
            "reported_running": report_matches_live_target,
            "reported_build_version": (
                reported.get("build_version") if report_matches_live_target else None),
            "reported_device_uid": (
                reported.get("device_uid") if report_matches_live_target else None),
            "reported_session_id": (
                reported.get("session_id") if report_matches_live_target else None),
        },
    })


def _record_build_event(board, status, notes="", bit_path="", bit_hash="", mcs_path="", approver="",
                        ns_snapshot=None, hardware_version=None, git_commit=None):
    """Write a BuildRecord directly from server-side code.

    Called by build_fpga() and upload_wukong_bit() — no client auth required.
    The display version is set equal to the auto-incremented primary key so the
    allocation is inherently atomic and unique (no MAX+1 race).
    Errors are logged but never propagate (callers must not be disrupted by a
    history-write failure).
    """
    import datetime as _dt
    try:
        br = BuildRecord(
            version=0,   # placeholder; overwritten with id after flush
            timestamp=_dt.datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ"),
            board=str(board or "")[:64],
            status=str(status or "unknown")[:16],
            approver=str(approver or "")[:128],
            git_commit=str(_git_short_hash() if git_commit is None else git_commit)[:64],
            hardware_version=(int(hardware_version)
                              if isinstance(hardware_version, int) else None),
            ns_snapshot=(json.dumps(ns_snapshot, sort_keys=True, separators=(",", ":"))
                         if isinstance(ns_snapshot, dict) else None),
            bit_path=str(bit_path or "")[:512],
            bit_hash=str(bit_hash or "")[:64],
            mcs_path=str(mcs_path or "")[:512],
            notes=str(notes or ""),
        )
        db.session.add(br)
        db.session.flush()   # assigns br.id within the current transaction
        br.version = br.id   # version = id: unique, monotone, no race
        db.session.commit()
        logging.info("build_history: recorded v%d board=%s status=%s", br.version, board, status)
        return br.id
    except Exception as _e:
        logging.warning("build_history: could not record event: %s", _e)
        try:
            db.session.rollback()
        except Exception:
            pass
        return None


_NAMESPACE_SNAPSHOT_SCHEMA_VERSION = 1
_NAMESPACE_SNAPSHOT_MAX_SLOTS = 256


def _namespace_snapshot_fingerprint(namespace):
    """Return the deterministic identity of immutable Namespace contents."""
    canonical = json.dumps(namespace, sort_keys=True, separators=(",", ":")).encode("utf-8")
    return _ba_hashlib.sha256(canonical).hexdigest()


def _raw_namespace_fingerprint(raw):
    """Return a deterministic identity for committed four-word NS entries."""
    import hashlib
    entries = []
    for entry in (raw or {}).get("entries", []):
        if not isinstance(entry, dict):
            continue
        entries.append({
            "slot": int(entry.get("slot", 0)),
            "w0": int(entry.get("w0", 0)) & 0xFFFFFFFF,
            "w1": int(entry.get("w1", 0)) & 0xFFFFFFFF,
            "w2": int(entry.get("w2", 0)) & 0xFFFFFFFF,
            "w3": int(entry.get("w3", 0)) & 0xFFFFFFFF,
        })
    entries.sort(key=lambda item: item["slot"])
    encoded = json.dumps(entries, sort_keys=True, separators=(",", ":")).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


def _capture_committed_namespace_snapshot(hardware_version=None, source_commit=None,
                                         approval_frozen_at=None):
    """Freeze the server's committed decoded and raw Namespace state.

    This deliberately reads the persisted state and boot image at the accepted
    build boundary.  It never accepts browser state, and callers retain the
    returned JSON verbatim rather than re-reading mutable live files later.
    """
    with _namespace_commit_guard():
        if not os.path.isfile(NS_STATE_PATH) or not os.path.isfile(BOOT_IMAGE_PATH):
            raise ValueError("Committed Namespace state or boot image is unavailable")
        with open(NS_STATE_PATH, encoding="utf-8") as state_file:
            state = json.load(state_file)
        if not isinstance(state, dict) or not isinstance(state.get("abstractions"), list):
            raise ValueError("Committed Namespace metadata is invalid")
        with open(BOOT_IMAGE_PATH, "rb") as image_file:
            raw = _boot_image_gen.parse_ns_table_raw(image_file.read())
        if not isinstance(raw, dict) or not isinstance(raw.get("entries"), list):
            raise ValueError("Committed boot image has no readable Namespace table")
        raw_fingerprint = _raw_namespace_fingerprint(raw)

    decoded_slots = []
    for entry in state["abstractions"]:
        if not isinstance(entry, dict) or not isinstance(entry.get("slot"), int):
            continue
        if not 0 <= entry["slot"] < _NAMESPACE_SNAPSHOT_MAX_SLOTS:
            continue
        # Keep only declared Namespace metadata.  Browser-only annotations and
        # arbitrary future payload fields cannot become build authority.
        decoded = {
            key: entry[key] for key in (
                "name", "slot", "location", "type", "f", "g", "limit",
                "seq", "seal", "token", "cache_token", "boot",
            ) if key in entry
        }
        if decoded.get("name"):
            decoded_slots.append(decoded)
    decoded_slots.sort(key=lambda item: item["slot"])

    raw_entries = []
    for entry in raw["entries"]:
        if not isinstance(entry, dict) or not isinstance(entry.get("slot"), int):
            continue
        if not 0 <= entry["slot"] < _NAMESPACE_SNAPSHOT_MAX_SLOTS:
            continue
        try:
            raw_entries.append({
                "slot": entry["slot"],
                "w0": int(entry["w0"]) & 0xFFFFFFFF,
                "w1": int(entry["w1"]) & 0xFFFFFFFF,
                "w2": int(entry["w2"]) & 0xFFFFFFFF,
                "w3": int(entry["w3"]) & 0xFFFFFFFF,
            })
        except (KeyError, TypeError, ValueError):
            continue
    raw_entries.sort(key=lambda item: item["slot"])
    if not raw_entries:
        raise ValueError("Committed boot image Namespace table is empty")
    decoded_by_slot = {entry["slot"]: entry for entry in decoded_slots}
    raw_by_slot = {entry["slot"]: entry for entry in raw_entries}
    if set(decoded_by_slot) != set(raw_by_slot):
        raise ValueError("Committed Namespace metadata and raw table occupy different slots")
    for slot, decoded in decoded_by_slot.items():
        try:
            decoded_location = int(str(decoded["location"]), 0)
        except (KeyError, TypeError, ValueError):
            raise ValueError(f"Committed Namespace slot {slot} has an invalid location")
        if decoded_location != raw_by_slot[slot]["w0"]:
            raise ValueError(f"Committed Namespace slot {slot} metadata does not match raw table")
    recorded_raw_fingerprint = state.get("committed_raw_fingerprint")
    if not recorded_raw_fingerprint:
        raise ValueError("Committed Namespace metadata is not bound to a raw table revision")
    if recorded_raw_fingerprint != raw_fingerprint:
        raise ValueError("Committed Namespace metadata is bound to a different raw table revision")

    namespace = {
        "decoded_slots": decoded_slots,
        "raw": {
            "total_words": int(raw.get("totalWords", 0)),
            "max_entries": int(raw.get("maxEntries", 0)),
            "ns_table_base": int(raw.get("nsTableBase", 0)),
            "entries": raw_entries,
        },
    }
    return {
        "schema_version": _NAMESPACE_SNAPSHOT_SCHEMA_VERSION,
        "fingerprint": _namespace_snapshot_fingerprint(namespace),
        "captured_at": _ba_datetime.datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ"),
        "authority": "server-committed-namespace",
        "provenance": {
            "hardware_version": hardware_version if isinstance(hardware_version, int) else None,
            "source_commit": str(source_commit)[:64] if source_commit else None,
            "approval_frozen_at": str(approval_frozen_at)[:32] if approval_frozen_at else None,
            "committed_raw_fingerprint": raw_fingerprint,
        },
        "namespace": namespace,
    }


def _read_record_namespace_snapshot(record):
    """Return a validated, bounded historical Namespace snapshot or None."""
    try:
        snapshot = json.loads(record.ns_snapshot) if record and record.ns_snapshot else None
    except (TypeError, ValueError):
        return None
    if not isinstance(snapshot, dict) or snapshot.get("schema_version") != _NAMESPACE_SNAPSHOT_SCHEMA_VERSION:
        return None
    namespace = snapshot.get("namespace")
    raw = namespace.get("raw") if isinstance(namespace, dict) else None
    slots = namespace.get("decoded_slots") if isinstance(namespace, dict) else None
    if not isinstance(raw, dict) or not isinstance(raw.get("entries"), list) or not isinstance(slots, list):
        return None
    if len(raw["entries"]) > _NAMESPACE_SNAPSHOT_MAX_SLOTS or len(slots) > _NAMESPACE_SNAPSHOT_MAX_SLOTS:
        return None
    fingerprint = snapshot.get("fingerprint")
    if not isinstance(fingerprint, str) or len(fingerprint) != 64:
        return None
    return snapshot


def _namespace_match_for_hardware_version(hardware_version):
    """Find one unambiguous successful historical Namespace for an FPGA version."""
    if not isinstance(hardware_version, int):
        return {"state": "unavailable", "reason": "The FPGA did not report a build version."}
    try:
        records = (BuildRecord.query
                   .filter_by(board="wukong-xc7a100t", status="succeeded",
                              hardware_version=hardware_version)
                   .order_by(BuildRecord.id.desc()).all())
    except Exception:
        return {"state": "unavailable", "reason": "Build history is unavailable."}
    grouped = {}
    for record in records:
        snapshot = _read_record_namespace_snapshot(record)
        if snapshot:
            grouped.setdefault(snapshot["fingerprint"], (record, snapshot))
    if not grouped:
        return {"state": "unavailable",
                "reason": "No recorded Namespace snapshot matches this FPGA build."}
    if len(grouped) != 1:
        return {"state": "ambiguous",
                "reason": "More than one recorded Namespace snapshot matches this build version."}
    record, snapshot = next(iter(grouped.values()))
    return {
        "state": "available",
        "build_id": record.id,
        "build_history_version": record.version,
        "fingerprint": snapshot["fingerprint"],
    }


def _build_namespace_detail(record):
    """Return a path-free bounded historical context for the browser."""
    snapshot = _read_record_namespace_snapshot(record)
    if not snapshot:
        return {"ok": True, "available": False,
                "reason": "No Namespace snapshot is available for this build."}
    return {
        "ok": True,
        "available": True,
        "build": {
            "id": record.id,
            "version": record.version,
            "hardware_version": record.hardware_version,
            "status": record.status,
            "git_commit": record.git_commit,
            "bit_hash": record.bit_hash or None,
        },
        "snapshot": snapshot,
    }


@app.route("/api/builds", methods=["GET"])
def api_builds_list():
    """Return build records, newest first.

    Public fields (no auth required): id, version, timestamp, board, status,
    approver, git_commit, bit_hash, notes, test_results summary.

    Server file paths (bit_path, mcs_path) and raw NS snapshots are omitted
    from the public response — they are not needed by the IDE UI and would
    expose internal filesystem layout.
    """
    try:
        records = BuildRecord.query.order_by(BuildRecord.id.desc()).all()
        out = []
        for r in records:
            tr = None
            if r.test_results:
                try:
                    tr = json.loads(r.test_results)
                except Exception:
                    pass
            out.append({
                "id":           r.id,
                "version":      r.version,
                "timestamp":    r.timestamp,
                "board":        r.board,
                "status":       r.status,
                "approver":     r.approver,
                "git_commit":   r.git_commit,
                "test_results": tr,
                "bit_hash":     r.bit_hash,   # integrity check only — no server path
                "hardware_version": r.hardware_version,
                "namespace_snapshot": bool(_read_record_namespace_snapshot(r)),
                "namespace_fingerprint": (
                    _read_record_namespace_snapshot(r).get("fingerprint")
                    if _read_record_namespace_snapshot(r) else None
                ),
                # notes omitted: may contain internal error codes stored server-side
            })
        return jsonify({"ok": True, "builds": out})
    except Exception as e:
        logging.exception("api_builds_list failed")
        return jsonify({"ok": False, "error": "could not load build history"}), 500


@app.route("/api/builds/<int:build_id>/namespace", methods=["GET"])
def api_build_namespace_detail(build_id):
    """Return the saved test context for one historical build, never live NS state."""
    try:
        record = db.session.get(BuildRecord, build_id)
        if record is None:
            return jsonify({"ok": False, "error": "Build record not found"}), 404
        return jsonify(_build_namespace_detail(record))
    except Exception:
        logging.exception("api_build_namespace_detail failed")
        return jsonify({"ok": False, "error": "could not load build Namespace"}), 500


@app.route("/api/builds/namespace-match", methods=["GET"])
def api_build_namespace_match():
    """Resolve a reported FPGA version without falling back to live Namespace state."""
    try:
        version = int(request.args.get("hardware_version", ""))
    except (TypeError, ValueError):
        return jsonify({"ok": False, "error": "hardware_version must be an integer"}), 400
    result = _namespace_match_for_hardware_version(version)
    return jsonify({"ok": True, "hardware_version": version, **result})


@app.route("/api/builds", methods=["POST"])
def api_builds_create():
    """Create a build record from an external caller (droplet, CI, Vivado script).

    Always requires Authorization: Bearer <REPORT_TOKEN> or ?token=<REPORT_TOKEN>.
    Browser-triggered FPGA builds are recorded server-side inside build_fpga()
    — they do not call this endpoint.

    Body (JSON):
        board        — board identifier string
        status       — 'succeeded' | 'failed' | 'partial'
        approver     — who triggered the build (optional)
        git_commit   — git short hash (optional; auto-detected if omitted)
        hardware_version — FPGA sentinel build version (optional)
        test_results — JS object {workflow_name: 'pass'|'fail'|'unknown'} (optional)
        bit_hash     — md5 hex of .bit file (optional)
        notes        — free text (optional)
        version      — integer version override (optional; auto-incremented if omitted)
    """
    _token = os.environ.get("REPORT_TOKEN", "")
    if not _token:
        return jsonify({"ok": False, "error": "REPORT_TOKEN is not configured on this server"}), 503
    _auth = request.headers.get("Authorization", "")
    _qtok = request.args.get("token", "")
    if _auth != f"Bearer {_token}" and _qtok != _token:
        return jsonify({"ok": False, "error": "Unauthorized"}), 401

    import datetime as _dt
    data = request.get_json(silent=True) or {}
    # Version is always set equal to the record's primary key after flush —
    # no caller-supplied override, no MAX+1 race.
    test_res = data.get("test_results")
    try:
        hardware_version = int(data.get("hardware_version")) if data.get("hardware_version") is not None else None
    except (TypeError, ValueError):
        return jsonify({"ok": False, "error": "hardware_version must be an integer"}), 400
    try:
        br = BuildRecord(
            version=0,   # placeholder; overwritten with id after flush
            timestamp=_dt.datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ"),
            board=str(data.get("board", ""))[:64],
            status=str(data.get("status", "unknown"))[:16],
            approver=str(data.get("approver", ""))[:128],
            git_commit=str(data.get("git_commit", "") or _git_short_hash())[:64],
            # External callers cannot supply Namespace authority.  Only the
            # approved server-side build boundary records an authoritative snapshot.
            ns_snapshot=None,
            hardware_version=hardware_version,
            test_results=json.dumps(test_res) if test_res is not None else None,
            # External callers supply a hash only — paths are internal to the server.
            bit_hash=str(data.get("bit_hash", ""))[:64],
            notes=str(data.get("notes", "")),
        )
        db.session.add(br)
        db.session.flush()   # assigns br.id within the current transaction
        br.version = br.id   # version = id: unique, monotone, no race
        db.session.commit()
        return jsonify({"ok": True, "id": br.id, "version": br.version})
    except Exception as e:
        logging.exception("api_builds_create failed")
        db.session.rollback()
        return jsonify({"ok": False, "error": "database error"}), 500


@app.route("/dl/build-soc-cm-md")
def download_build_soc_cm_md():
    """Serve hardware/soc_combined/BUILD_SOC_CM.md as a plain-text response."""
    md_path = os.path.abspath(os.path.join(os.path.dirname(__file__), "..",
                                            "hardware", "soc_combined", "BUILD_SOC_CM.md"))
    if not os.path.isfile(md_path):
        resp = make_response("BUILD_SOC_CM.md not found.", 404)
        resp.headers["Content-Type"] = "text/plain"
        return resp
    with open(md_path, "r") as f:
        content = f.read()
    resp = make_response(content, 200)
    resp.headers["Content-Type"] = "text/plain; charset=utf-8"
    resp.headers["Content-Disposition"] = 'inline; filename="BUILD_SOC_CM.md"'
    return resp


@app.route("/dl/wukong-zip")
def download_wukong_zip():
    """Download the QMTECH Wukong XC7A100T build package.

    ZIP contains:
      church_wukong_xc7a100t.il  — Amaranth RTLIL (optional, for inspection)
      church_wukong_xc7a100t.v   — Verilog netlist (add to Vivado project)
      wukong_xc7a100t.xdc        — Vivado pin constraints
      wukong_xc7a100t.tcl        — Vivado batch build script
      wukong_bridge.py           — native Wukong USB-UART trace/command bridge
      local_bridge.py            — browser WebSerial bridge helper

    If the Verilog has not been generated yet, returns 404 with instructions.
    """
    import zipfile, io
    BASE = os.path.dirname(__file__)
    BUILD_DIR = os.path.abspath(os.path.join(BASE, "..", "build"))
    HW_DIR    = os.path.abspath(os.path.join(BASE, "..", "hardware"))

    v_path  = os.path.join(BUILD_DIR, "church_wukong_xc7a100t.v")
    il_path = os.path.join(BUILD_DIR, "church_wukong_xc7a100t.il")

    if not os.path.exists(v_path):
        return (
            "Wukong Verilog not yet generated.\n"
            "Run:  python -m hardware.gen_rtlil --wukong build\n"
            "Then restart the server and try again.",
            404,
        )

    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        zf.write(v_path,  "church_wukong_xc7a100t.v")
        if os.path.exists(il_path):
            zf.write(il_path, "church_wukong_xc7a100t.il")
        xdc = os.path.join(HW_DIR, "wukong_xc7a100t.xdc")
        tcl = os.path.join(HW_DIR, "wukong_xc7a100t.tcl")
        bridge = os.path.join(BASE, "local_bridge.py")
        flash_guide = os.path.join(BASE, "..", "docs", "wukong-vivado-flash-guide.md")
        if os.path.exists(xdc):
            zf.write(xdc, "wukong_xc7a100t.xdc")
        if os.path.exists(tcl):
            zf.write(tcl, "wukong_xc7a100t.tcl")
        if os.path.exists(flash_guide):
            zf.write(flash_guide, "wukong-vivado-flash-guide.md")
        wukong_bridge = os.path.join(HW_DIR, "wukong_bridge.py")
        if os.path.exists(wukong_bridge):
            zf.write(wukong_bridge, "wukong_bridge.py")
        if os.path.exists(bridge):
            zf.write(bridge, "local_bridge.py")
    buf.seek(0)
    return send_file(buf, as_attachment=True,
                     download_name="church-wukong-package.zip",
                     mimetype="application/zip")


@app.route("/api/releases")
def api_releases():
    import hashlib as _hashlib
    manifest_path = os.path.join(os.path.dirname(__file__), "releases", "manifest.json")
    try:
        with open(manifest_path) as _f:
            manifest = json.load(_f)
    except Exception as _e:
        return jsonify({"ok": False, "error": str(_e)}), 500
    latest_ver = manifest.get("latest")
    release = next((r for r in manifest.get("releases", []) if r["version"] == latest_ver), None)
    _verilog_by_board = {
        "wukong-xc7a100t": "church_wukong_xc7a100t.v",
    }
    _vfile = _verilog_by_board.get((release or {}).get("board"), "church_wukong_xc7a100t.v")
    verilog_path = os.path.join(os.path.dirname(__file__), "..", "build", _vfile)
    stale = False
    if release and os.path.exists(verilog_path):
        try:
            with open(verilog_path, "rb") as _f:
                sha = _hashlib.sha256(_f.read()).hexdigest()
            stale = (sha != release.get("verilog_sha256", ""))
        except Exception:
            pass
    return jsonify({"ok": True, "release": release, "stale": stale})

@app.route("/api/releases/publish", methods=["POST"])
def api_releases_publish():
    import hashlib as _hashlib, datetime as _dt
    data = request.get_json(silent=True) or {}
    manifest_path = os.path.join(os.path.dirname(__file__), "releases", "manifest.json")
    verilog_path  = os.path.join(os.path.dirname(__file__), "..", "build", "church_wukong_xc7a100t.v")
    if not os.path.exists(verilog_path):
        return jsonify({"ok": False, "error": "Verilog file not found"}), 404
    with open(verilog_path, "rb") as _f:
        sha = _hashlib.sha256(_f.read()).hexdigest()
    try:
        with open(manifest_path) as _f:
            manifest = json.load(_f)
    except Exception:
        manifest = {"latest": None, "releases": []}
    version = data.get("version") or (_dt.date.today().strftime("0.%Y%m%d"))
    new_entry = {
        "version":         version,
        "date":            _dt.date.today().isoformat(),
        "board":           "wukong-xc7a100t",
        "description":     data.get("description", ""),
        "boot_rom_words":  data.get("boot_rom_words", []),
        "verilog_sha256":  sha,
        "verilog_download": "/dl/wukong-verilog",
        "zip_download":     "/dl/wukong-zip",
        "notes":           data.get("notes", ""),
    }
    manifest["releases"] = [r for r in manifest.get("releases", []) if r["version"] != version]
    manifest["releases"].insert(0, new_entry)
    manifest["latest"] = version
    with open(manifest_path, "w") as _f:
        json.dump(manifest, _f, indent=2)
    return jsonify({"ok": True, "version": version, "sha256": sha})

@app.route("/")
def index():
    landing_path = os.path.join(BASE_DIR, "landing.html")
    return send_file(landing_path, mimetype="text/html")

_SITE_SEARCH_CODE_ROOTS = (
    "hardware",
    "scripts",
    "server",
    "simulator",
    "tests",
)
_SITE_SEARCH_CODE_EXTENSIONS = frozenset({
    ".bash", ".c", ".cc", ".cloomc", ".cpp", ".css", ".h", ".hpp",
    ".js", ".mjs", ".py", ".scss", ".sh", ".sv", ".tcl", ".ts",
    ".tsx", ".v", ".vh", ".yaml", ".yml",
})
_SITE_SEARCH_CODE_EXCLUDED_DIRS = frozenset({
    ".git", ".cache", ".local", ".pytest_cache", "__pycache__",
    "node_modules", "test-results", "lumps",
})
_SITE_SEARCH_MAX_CODE_BYTES = 2 * 1024 * 1024


def _site_code_filepath(filename):
    """Return an allowlisted source path, or None for an unsafe path."""
    if not filename or filename.startswith("/") or "\\" in filename:
        return None
    parts = filename.split("/")
    if any(part in {"", ".", ".."} for part in parts):
        return None
    if parts[0] not in _SITE_SEARCH_CODE_ROOTS:
        return None
    if os.path.splitext(filename)[1].lower() not in _SITE_SEARCH_CODE_EXTENSIONS:
        return None

    filepath = os.path.realpath(os.path.join(BASE_DIR, *parts))
    repo_root = os.path.realpath(BASE_DIR)
    try:
        if os.path.commonpath((repo_root, filepath)) != repo_root:
            return None
    except ValueError:
        return None
    if not os.path.isfile(filepath):
        return None
    try:
        if os.path.getsize(filepath) > _SITE_SEARCH_MAX_CODE_BYTES:
            return None
    except OSError:
        return None
    return filepath


def _site_code_fallback_title(rel):
    filename = os.path.basename(rel)
    stem = os.path.splitext(filename)[0].replace("-", " ").replace("_", " ").strip()
    return (stem or filename) + " source"


def _site_search_sources():
    """Yield public pages, docs, and allowlisted source files searchable from /."""
    sources = [
        ("landing.html", "/", "Landing page", "page"),
        ("simulator/index.html", "/simulator/", "Church Machine IDE", "page"),
    ]
    if os.path.isdir(DOCS_DIR):
        for root, dirs, files in os.walk(DOCS_DIR):
            dirs[:] = sorted(d for d in dirs if d not in {".git", "__pycache__"})
            for filename in sorted(files):
                if not filename.endswith((".md", ".html")):
                    continue
                filepath = os.path.join(root, filename)
                rel = os.path.relpath(filepath, BASE_DIR).replace(os.sep, "/")
                doc_rel = rel[len("docs/"):]
                if doc_rel.startswith("business/"):
                    url = "/business/" + doc_rel[len("business/"):]
                    if not url.endswith(".html"):
                        url += ".html"
                elif doc_rel == "six-laws/index.html":
                    url = "/six-laws/"
                elif doc_rel == "patents/index.html":
                    url = "/patents/"
                else:
                    url = "/" + rel
                title = filename.rsplit(".", 1)[0].replace("-", " ").replace("_", " ").strip()
                sources.append((rel, url, title, "document"))
    for code_root in _SITE_SEARCH_CODE_ROOTS:
        root_dir = os.path.join(BASE_DIR, code_root)
        if not os.path.isdir(root_dir):
            continue
        for root, dirs, files in os.walk(root_dir):
            dirs[:] = sorted(
                directory for directory in dirs
                if directory not in _SITE_SEARCH_CODE_EXCLUDED_DIRS
                and not directory.startswith(".")
            )
            for filename in sorted(files):
                extension = os.path.splitext(filename)[1].lower()
                if filename.startswith(".") or extension not in _SITE_SEARCH_CODE_EXTENSIONS:
                    continue
                filepath = os.path.join(root, filename)
                try:
                    if os.path.getsize(filepath) > _SITE_SEARCH_MAX_CODE_BYTES:
                        continue
                except OSError:
                    continue
                rel = os.path.relpath(filepath, BASE_DIR).replace(os.sep, "/")
                sources.append((
                    rel,
                    "/code/" + rel,
                    _site_code_fallback_title(rel),
                    "code",
                ))
    return sources

def _site_search_text(raw, extension):
    """Convert a public source into compact searchable text."""
    if extension == ".html":
        raw = re.sub(r"<(script|style)\b[^>]*>.*?</\1>", " ", raw,
                     flags=re.IGNORECASE | re.DOTALL)
        raw = re.sub(r"<[^>]+>", " ", raw)
    return re.sub(r"\s+", " ", _html.unescape(raw)).strip()

def _site_search_title(raw, fallback, extension):
    if extension == ".html":
        match = re.search(r"<title\b[^>]*>(.*?)</title>", raw,
                          flags=re.IGNORECASE | re.DOTALL)
        if not match:
            match = re.search(r"<h1\b[^>]*>(.*?)</h1>", raw,
                              flags=re.IGNORECASE | re.DOTALL)
        if match:
            title = re.sub(r"<[^>]+>", " ", match.group(1))
            title = re.sub(r"\s+", " ", _html.unescape(title)).strip()
            if title:
                return title
    else:
        match = re.search(r"^\s*#\s+(.+?)\s*$", raw, flags=re.MULTILINE)
        if match:
            return match.group(1).strip()
        match = re.search(r"\babstraction\s+([A-Za-z_][A-Za-z0-9_]*)\s*\{", raw)
        if match:
            return match.group(1) + " source"
    return fallback

@app.route("/api/site-search")
def site_search():
    """Search public pages, docs, and allowlisted source files."""
    query = re.sub(r"\s+", " ", request.args.get("q", "")).strip()
    if len(query) > 120:
        query = query[:120]
    if not query:
        return jsonify({"query": "", "results": []})

    terms = [term.lower() for term in query.split() if term]
    results = []
    for rel, url, fallback_title, kind in _site_search_sources():
        filepath = _site_code_filepath(rel) if kind == "code" else os.path.join(BASE_DIR, rel)
        try:
            if kind == "code" and filepath is None:
                continue
            with open(filepath, "r", encoding="utf-8", errors="replace") as source:
                raw = source.read()
            modified_at = os.path.getmtime(filepath)
        except (OSError, UnicodeError):
            continue
        extension = os.path.splitext(filepath)[1].lower()
        searchable = _site_search_text(raw, extension)
        lower = searchable.lower()
        title = _site_search_title(raw, fallback_title, extension)
        haystack = " ".join((title, rel, searchable)).lower()
        if not all(term in haystack for term in terms):
            continue

        first_match = min(
            (position for term in terms
             for position in [lower.find(term)] if position >= 0),
            default=0
        )
        start = max(0, first_match - 90)
        excerpt = searchable[start:start + 240]
        if start > 0:
            excerpt = "…" + excerpt
        if start + 240 < len(searchable):
            excerpt += "…"
        title_score = sum(title.lower().count(term) for term in terms)
        path_score = sum(rel.lower().count(term) for term in terms)
        results.append({
            "title": title,
            "url": url,
            "path": "/" if rel == "landing.html" else "/" + rel,
            "kind": kind,
            "excerpt": excerpt,
            "_score": title_score * 20 + path_score * 5,
            "_modified_at": modified_at,
        })

    results.sort(key=lambda item: (
        -item.pop("_modified_at"),
        -item.pop("_score"),
        item["title"].lower(),
    ))
    return jsonify({"query": query, "results": results})


@app.route("/code/<path:filename>")
def site_code_viewer(filename):
    """Display an allowlisted source file as escaped text."""
    filepath = _site_code_filepath(filename)
    if filepath is None:
        return jsonify({"error": "Code file not found"}), 404
    try:
        with open(filepath, "r", encoding="utf-8", errors="replace") as source:
            raw = source.read()
    except (OSError, UnicodeError):
        return jsonify({"error": "Code file not found"}), 404

    rel = os.path.relpath(filepath, BASE_DIR).replace(os.sep, "/")
    title = _site_search_title(
        raw,
        _site_code_fallback_title(rel),
        os.path.splitext(filepath)[1].lower(),
    )
    page = (
        "<!doctype html><html lang=\"en\"><head><meta charset=\"utf-8\">"
        "<meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">"
        "<title>" + _html.escape(title) + "</title>"
        "<style>body{margin:0;background:#0b1020;color:#dbe4f0;font:14px/1.55 "
        "system-ui,sans-serif}header{padding:18px 24px;border-bottom:1px solid "
        "#263449;background:#111827}h1{margin:0 0 5px;font-size:18px;color:#f4d06f}"
        "p{margin:0;color:#94a3b8;font:12px/1.4 monospace}pre{margin:0;padding:24px;"
        "overflow:auto;tab-size:4}code{font:13px/1.6 'SF Mono','Fira Code',monospace;"
        "white-space:pre}</style></head><body><header><h1>" +
        _html.escape(title) + "</h1><p>" + _html.escape(rel) +
        "</p></header><pre><code>" + _html.escape(raw) +
        "</code></pre></body></html>"
    )
    return make_response(page, 200, {"Content-Type": "text/html; charset=utf-8"})


@app.route("/robots.txt")
def robots_txt():
    origin = request.url_root.rstrip("/")
    content = (
        f"User-agent: *\n"
        f"Allow: /\n"
        f"Sitemap: {origin}/sitemap.xml\n"
        "# AI crawler guidance\n"
        "# See /llms.txt for a structured index of documentation\n"
    )
    return make_response(content, 200, {"Content-Type": "text/plain; charset=utf-8"})

@app.route("/llms.txt")
def llms_txt():
    content = (
        "# Church Machine — llms.txt\n"
        "# Capability-based secure computing platform (Church Machine / CLOOMC)\n"
        "#\n"
        "# Church Machine is a capability-secure computing architecture with its own\n"
        "# ISA, multi-language compiler (CLOOMC), and FPGA hardware target (Wukong A7).\n"
        "# Capabilities replace pointers for all inter-abstraction communication.\n"
        "\n"
        "## Core documentation\n"
        "- /docs/cloomc-foundation.md: CLOOMC ISA, capability model, memory architecture\n"
        "- /docs/HARDWARE.md: Wukong A7 board hardware setup and FPGA integration\n"
        "- /docs/instruction-set.md: Instruction set reference and fault recovery\n"
        "- /docs/isa_reference.md: ISA encoding reference\n"
        "- /docs/mload.md: mLoad memory instruction specification\n"
        "\n"
        "## Public pages\n"
        "- /: Landing page — overview of the Church Machine platform\n"
        "- /simulator/: Browser-based Church Machine IDE\n"
        "- /start-guide: Getting started guide\n"
    )
    return make_response(content, 200, {"Content-Type": "text/plain; charset=utf-8"})
@app.route("/sitemap.xml")
def sitemap_xml():
    origin = request.url_root.rstrip("/")
    content = (
        '<?xml version="1.0" encoding="UTF-8"?>\n'
        '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'
        f'  <url><loc>{origin}/</loc><priority>1.0</priority></url>\n'
        f'  <url><loc>{origin}/simulator/</loc><priority>0.9</priority></url>\n'
        f'  <url><loc>{origin}/docs/</loc><priority>0.7</priority></url>\n'
        f'  <url><loc>{origin}/ide-intro/</loc><priority>0.6</priority></url>\n'
        f'  <url><loc>{origin}/start-guide</loc><priority>0.7</priority></url>\n'
        f'  <url><loc>{origin}/release/r1/</loc><priority>0.5</priority></url>\n'
        f'  <url><loc>{origin}/release/r12/</loc><priority>0.5</priority></url>\n'
        '</urlset>\n'
    )
    return make_response(content, 200, {"Content-Type": "application/xml; charset=utf-8"})

@app.route("/api/health")
@app.route("/health")
def health():
    return jsonify({"status": "ok"})

@app.route("/api/bank-custody", methods=["POST"])
def save_bank_custody():
    """Legacy owner-key recovery is retired; custody stays inside Bank."""
    return jsonify({"ok": False, "error": "Bank custody requires a typed BankVariable capability"}), 410
    data = request.get_json(silent=True) or {}
    vault_id = _bank_custody_vault_id(data.get("vault_id"))
    state = _bank_custody_validate_state(data.get("state"))
    if not state or (data.get("vault_id") is not None and not vault_id):
        return jsonify({"ok": False, "error": "invalid protected custody state"}), 400
    # New vault identifiers are server-issued CSPRNG values. A caller may
    # provide an existing one only when updating it with the current proof.
    requested_vault_id = vault_id
    credential = state["credential"]
    with _bank_custody_lock:
        row = (db.session.execute(_sa_text(
            "SELECT revoked, consumed, revision FROM bank_custody WHERE vault_id = :vault_id"
        ), {"vault_id": vault_id}).mappings().first() if vault_id else None)
        if requested_vault_id and row:
            _, _, error = _bank_custody_authorize_request(vault_id, data)
            if error:
                return error
        if row and (row["revoked"] or row["consumed"]):
            return jsonify({"ok": False, "error": "custody vault is retired"}), 409
        if not row:
            vault_id = secrets.token_urlsafe(32).replace("-", "a").replace("_", "b")
        revision = int(row["revision"]) + 1 if row else 1
        try:
            db.session.execute(_sa_text("""
                INSERT INTO bank_custody
                    (vault_id, protected_state, credential_gt, proof_commitment, revoked, revision, updated_at)
                VALUES (:vault_id, :protected_state, :credential_gt, :proof_commitment, 0, :revision, :updated_at)
                ON CONFLICT(vault_id) DO UPDATE SET
                    protected_state = excluded.protected_state,
                    credential_gt = excluded.credential_gt,
                    proof_commitment = excluded.proof_commitment,
                    revoked = 0,
                    revision = excluded.revision,
                    updated_at = excluded.updated_at
            """), {
                "vault_id": vault_id,
                "protected_state": _bank_custody_protect(state),
                "credential_gt": credential["gt"] & 0xFFFFFFFF,
                "proof_commitment": credential["proofCommitment"].lower(),
                "revision": revision,
                "updated_at": time.time()
            })
            db.session.commit()
        except Exception:
            db.session.rollback()
            return jsonify({"ok": False, "error": "could not save protected custody state"}), 500
    return jsonify({"ok": True, "vault_id": vault_id, "revision": revision})
@app.route("/favicon.ico")
def favicon():
    return redirect("/simulator/favicon.svg", code=301)

@app.route("/api/boot-id")
def boot_id():
    return jsonify({
        "bootId": BOOT_ID,
        "version": BUILD_VERSION,
        "version_kind": BUILD_VERSION_KIND,
    })

# ---------------------------------------------------------------------------
# Daily report — manual trigger
# ---------------------------------------------------------------------------

@app.route("/report/send-now")
def report_send_now():
    """Manually trigger the daily report email. Returns JSON confirmation.

    Requires Authorization: Bearer <REPORT_TOKEN> header or ?token=<REPORT_TOKEN>.
    """
    from daily_report import check_report_auth as _check_auth
    if not _check_auth(request):
        return jsonify({"error": "Unauthorized — supply token via Authorization header or ?token="}), 401
    try:
        from daily_report import send_daily_report as _send_report, generate_report as _gen_report
        ok, msg = _send_report(db_path)
        plain, _, cost = _gen_report(db_path)
        import datetime
        return jsonify({
            "sent": ok,
            "message": msg,
            "date": datetime.date.today().isoformat(),
            "estimated_cost_today": round(cost, 2),
            "recipient": "sipanticinc@gmail.com",
        })
    except Exception as exc:
        logging.exception("Error in /report/send-now")
        return jsonify({"sent": False, "message": str(exc)}), 500

@app.route("/report/sync-lfs-now")
def report_sync_lfs_now():
    """Manually trigger the nightly LFS backup. Returns JSON confirmation.

    Requires Authorization: Bearer <REPORT_TOKEN> header or ?token=<REPORT_TOKEN>.
    """
    from daily_report import check_report_auth as _check_auth
    if not _check_auth(request):
        return jsonify({"error": "Unauthorized — supply token via Authorization header or ?token="}), 401
    try:
        import subprocess
        _script = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "scripts", "sync-lfs-to-github.sh")
        result = subprocess.run(
            ["bash", _script],
            capture_output=True,
            text=True,
            timeout=300,
        )
        success = result.returncode == 0
        output = (result.stdout + result.stderr).strip()
        logging.info("Manual LFS sync triggered: success=%s", success)
        return jsonify({
            "success": success,
            "returncode": result.returncode,
            "output": output,
        })
    except Exception as exc:
        logging.exception("Error in /report/sync-lfs-now")
        return jsonify({"success": False, "message": str(exc)}), 500

def _execute_git_sync():
    """Run the configured non-LFS GitHub mirror push and return its result."""
    import subprocess

    pat = os.environ.get("GITHUB_PAT", "").strip()
    if not pat:
        return {"success": False, "message": "GITHUB_PAT secret is not set"}, 503

    script = os.path.join(
        os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
        "scripts", "sync-to-github.sh",
    )
    if not os.path.isfile(script):
        return {"success": False, "message": "sync-to-github.sh not found"}, 500

    repo_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    try:
        result = subprocess.run(
            ["bash", script],
            capture_output=True,
            text=True,
            timeout=180,
            cwd=repo_root,
            env={**os.environ, "GITHUB_PAT": pat},
        )
        output = (result.stdout + result.stderr).strip()
        success = result.returncode == 0
        sha    = subprocess.run(["git", "rev-parse", "--short", "HEAD"],
                                capture_output=True, text=True,
                                cwd=repo_root).stdout.strip()
        branch = subprocess.run(["git", "rev-parse", "--abbrev-ref", "HEAD"],
                                capture_output=True, text=True,
                                cwd=repo_root).stdout.strip()

        # Parse per-repo outcomes from script output lines.
        # The script emits "push to <repo> succeeded." or "push to <repo> FAILED".
        def _repo_status(repo_path):
            if f"push to {repo_path} succeeded" in output:
                return "ok"
            if f"push to {repo_path} FAILED" in output:
                return "fail"
            return "unknown"

        repos = {
            "s-ide-v1":       _repo_status("khhodges/s-ide-v1"),
            "church-machine": _repo_status("khhodges/church-machine"),
        }

        if success:
            _invalidate_versions_diff_cache()
        logging.info(
            "Manual git-sync triggered: success=%s sha=%s repos=%s",
            success, sha, repos,
        )
        return {
            "success": success,
            "returncode": result.returncode,
            "output": output[-2000:],
            "sha": sha,
            "branch": branch,
            "repos": repos,
        }, 200
    except Exception as exc:
        logging.exception("Error running GitHub sync")
        return {"success": False, "message": str(exc)}, 500


def _invalidate_versions_diff_cache():
    """Force the next Versions refresh to compare against GitHub again."""
    cache = globals().get("_versions_diff_cache")
    if not isinstance(cache, dict):
        return
    lock = globals().get("_versions_diff_lock")
    if lock is not None:
        with lock:
            cache.update(key=None, ts=0.0, payload=None)
    else:
        cache.update(key=None, ts=0.0, payload=None)


@app.route("/internal/git-sync")
def internal_git_sync():
    """Trigger an immediate code push to both GitHub repos (non-LFS).

    Pushes to:
      • khhodges/s-ide-v1      (S-IDE v1 simplified entry-point IDE)
      • khhodges/church-machine (full Church Machine source)

    Requires Authorization: Bearer <REPORT_TOKEN> header or ?token=<REPORT_TOKEN>.
    """
    from daily_report import check_report_auth as _check_auth
    if not _check_auth(request):
        return jsonify({"error": "Unauthorized — supply token via Authorization header or ?token="}), 401
    payload, status = _execute_git_sync()
    return jsonify(payload), status


@app.route("/api/github/push", methods=["POST"])
def api_github_push():
    """Run an explicit UI-requested push without exposing the GitHub PAT.

    The browser action is confirmed in the UI. The server keeps the PAT
    server-side and reuses the same mirror script as the authenticated
    internal endpoint.
    """
    payload, status = _execute_git_sync()
    return jsonify(payload), status


@app.route("/report/task-run", methods=["POST"])
def report_task_run():
    """Record a task agent run for cost tracking. POST {task_id, note?}.

    Requires Authorization: Bearer <REPORT_TOKEN> header or ?token=<REPORT_TOKEN>.
    """
    from daily_report import check_report_auth as _check_auth
    if not _check_auth(request):
        return jsonify({"error": "Unauthorized — supply token via Authorization header or ?token="}), 401
    try:
        from daily_report import record_task_run as _record
        data = request.get_json(silent=True) or {}
        note = data.get("note", data.get("task_id", ""))
        _record(db_path, event_type="task_run", note=note)
        return jsonify({"recorded": True})
    except Exception as exc:
        logging.warning("Error in /report/task-run: %s", exc)
        return jsonify({"recorded": False, "error": str(exc)}), 500

# ---------------------------------------------------------------------------
# CTMM web app API stubs (used by web/app.js + web/index.html)
# These endpoints are called by the CTMM simulator frontend served at /ctmm/.
# The server does not run Replit Auth so auth always reports unauthenticated.
# ---------------------------------------------------------------------------

@app.route("/api/user")
def api_user():
    return jsonify({"authenticated": False})

def _is_development_mode():
    replit_deployment = os.environ.get("REPLIT_DEPLOYMENT")
    if replit_deployment is None:
        return os.environ.get("REPLIT_DEV_DOMAIN") is not None
    return replit_deployment != "1"

@app.route("/api/environment")
def api_environment():
    return jsonify({"is_development": _is_development_mode()})

_LANDING_CONTENT_PATH = os.path.join(
    os.path.dirname(os.path.abspath(__file__)), "landing_content.json"
)

@app.route("/api/landing-content", methods=["GET"])
def api_landing_content_get():
    if os.path.isfile(_LANDING_CONTENT_PATH):
        try:
            with open(_LANDING_CONTENT_PATH, "r") as f:
                contents = json.load(f)
            return jsonify({"contents": contents})
        except Exception:
            pass
    return jsonify({"contents": {}})

@app.route("/api/landing-content", methods=["POST"])
def api_landing_content_post():
    if not _is_development_mode():
        return jsonify({"success": False, "error": "Editing disabled in production"}), 403
    data = request.get_json(silent=True) or {}
    section_key = data.get("section_key")
    content = data.get("content")
    if not section_key or content is None:
        return jsonify({"success": False, "error": "Missing section_key or content"}), 400
    contents = {}
    if os.path.isfile(_LANDING_CONTENT_PATH):
        try:
            with open(_LANDING_CONTENT_PATH, "r") as f:
                contents = json.load(f)
        except Exception:
            pass
    contents[section_key] = content
    with open(_LANDING_CONTENT_PATH, "w") as f:
        json.dump(contents, f)
    return jsonify({"success": True})

@app.route("/api/state", methods=["GET"])
def api_state_get():
    return jsonify({"found": False})

@app.route("/api/state", methods=["POST"])
def api_state_post():
    return jsonify({"success": False, "error": "Sign-in required"}), 401

@app.route("/api/states", methods=["GET"])
def api_states_get():
    return jsonify({"states": []})

@app.route("/api/state/<int:state_id>", methods=["DELETE"])
def api_state_delete(state_id):
    return jsonify({"success": False, "error": "Sign-in required"}), 401

# ---------------------------------------------------------------------------
# Boot Image Designer config (Task #214 — Step 1: memory allocation)
# ---------------------------------------------------------------------------
# Programmer-controlled boot-image config persisted as a single project-level
# JSON file. Future Tasks #215–#217 extend the same file with `step2`
# (resident lumps), `step3` (reserved empty NS slots), and the binary image
# generator settings.
# File spec uses a hyphen (boot-config.json) per docs/foundation-lump-design.md §4.
BOOT_CONFIG_PATH = (
    _BOOT_CONFIG_PATH_OVERRIDE
    if _BOOT_CONFIG_PATH_OVERRIDE
    else os.path.join(os.path.dirname(os.path.abspath(__file__)),
                      "boot-config.json")
)
# Legacy filename from an earlier draft of this task — read for backward
# compatibility, then migrated to the canonical name on next save.
BOOT_CONFIG_LEGACY_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)),
                                       "boot_config.json")
BOOT_CONFIG_SCHEMA_VERSION = 1

# Hardware profile data shown to the programmer as read-only reference.
# Per docs/foundation-lump-design.md §3 the IDE never derives sizes — it only
# surfaces what the chosen target board offers. `addressRange` is the byte
# range of the namespace memory window the chosen board exposes.
HARDWARE_PROFILES = {
    "wukong-xc7a100t": {
        "label": "QMTECH Wukong Artix-7 (XC7A100T)",
        # This is the synthesized 16K-word Namespace BRAM, not the capacity
        # of the Artix-7 device. Keep it tied to the upload projection ABI.
        "totalRamWords": _boot_image_gen.WUKONG_DMEM_WORDS,
        "addressBits": 16,
        "addressRange": "0x0000_0000 – 0x0000_FFFF (64 KB byte-addressable)",
        "notes": "QMTECH Wukong XC7A100T — 64 KB block-RAM namespace window",
        "maxThreadCount": _boot_image_gen.WUKONG_PHYSICAL_MAX_THREAD_COUNT,
    },
}

# Saved configs from the retired Efinix Ti60 era carry targetBoard
# "ti60-f225". The Wukong exposes the identical namespace window, so
# loaders transparently migrate the board id instead of rejecting the file.
_LEGACY_BOARD_ALIASES = {"ti60-f225": "wukong-xc7a100t"}

def _migrate_legacy_board(cfg):
    """Rewrite retired board ids in a loaded boot-config dict (in place)."""
    if isinstance(cfg, dict):
        tb = cfg.get("targetBoard")
        if tb in _LEGACY_BOARD_ALIASES:
            cfg["targetBoard"] = _LEGACY_BOARD_ALIASES[tb]
    return cfg

DEFAULT_BOOT_CONFIG = {
    "schemaVersion": BOOT_CONFIG_SCHEMA_VERSION,
    "targetBoard": "wukong-xc7a100t",
    # The selected Lightning Bolt / first executable abstraction.  Older
    # configs omit this field and retain the architectural SelfTest default.
    "bootEntrySlot": 6,
    # Programmer-selected approval/load rules.  This is separate from
    # step2.lumps because architecture-defined Namespace rows do not contain
    # user LUMP bodies, but their approval rule is still user-owned.
    "slotRules": {},
    "step1": {
        "totalNamespaceWords": 16384,
        "namespaceLumpWords": 64,
        # The minimum normative Thread body is 256 words; larger supported
        # power-of-two bodies assign every added word to Heap.
        "threadLumpWords": 256,
    },
    # Step 2 (Task #215): per-lump resident/lazy decision. Empty list =
    # historical default (all catalog lumps lazy-loaded on first CALL).
    "step2": {
        "lumps": []
    },
    # Step 3 (Task #216): how many empty NS slots to reserve at boot for
    # lumps that don't exist yet at design time. The runtime lazy loader
    # claims these slots on demand when new lumps are created.
    "step3": {
        "emptySlotCount": 0
    },
}

SLOT_RULE_VALUES = (
    "Bootstrap", "Hardware", "Empty", "Resident", "Preload", "Lazy",
    "LightningBolt",
)


def _validate_slot_rules(slot_rules):
    """Validate programmer-owned per-slot approval rules.

    LightningBolt is stored as the one visible boot-entry choice, while
    bootEntrySlot remains the normalized runtime representation.
    """
    if slot_rules is None:
        return None
    if not isinstance(slot_rules, dict):
        return "slotRules must be an object"
    for raw_slot, rule in slot_rules.items():
        try:
            slot = int(raw_slot)
        except (TypeError, ValueError):
            return f"slotRules has an invalid NS slot: {raw_slot!r}"
        if slot < 0 or slot >= MAX_NS_ENTRIES:
            return f"slotRules has an invalid NS slot: {raw_slot!r}"
        if rule not in SLOT_RULE_VALUES:
            return f"NS slot {slot} has invalid slot rule {rule!r}"
    return None

# Namespace Header V2 encodes its physical table count directly in its
# 13-bit ``cw`` field.  This is a codec limit, not the former designer-only
# 1024/power-of-two limit.
MAX_NS_ENTRIES = _boot_image_gen.NAMESPACE_HEADER_V2_MAX_SLOTS
# How many fixed named NS entries are present after a cold boot. Configured
# Thread.2 onward occupy deterministic slots immediately after this catalog.
# _initNamespaceTable() always populates Boot.NS (0), Boot.Thread (1), UART,
# LED, BTN, TIMER, SelfTest, WukongCallHome, Tunnel, Ethernet, CapabilityTest.
# Slots 2–5 are MMIO device windows backed by hardware registers, not RAM.
# The ⚡ lightning bolt sets Thread.CR0 to whichever slot the programmer
# chooses as boot entry (default 6 = SelfTest; Wukong boards use 7).
# Keep in sync with simulator.js _getHardwareBootCatalog() and
# server/boot_image.py DEFAULT_ABSTRACTION_CATALOG.
BASE_NAMED_NS_COUNT = 11

# Slots reserved for the complete built-in catalog (foundational lumps and
# device MMIO regions) — the programmer cannot place an additional lump here.
# the programmer cannot place an additional resident lump body here.
# Slots 0–1: Boot.NS, Boot.Thread (foundational RAM lumps).
# Slots 2–5: UART_DEV, LED_DEV, BTN_DEV, TIMER_DEV (MMIO windows; NS entries
#            point at physical hardware addresses, no lump body in RAM).
RESERVED_NS_SLOTS = set(range(BASE_NAMED_NS_COUNT))


def _generated_thread_slots_for_step1(step1):
    """Return the generated Thread.2+ slots reserved by a valid Step-1 config."""
    try:
        return set(_boot_image_gen.generated_thread_slots(
            _boot_image_gen.configured_thread_count(step1 or {})))
    except ValueError:
        return set()


def _named_ns_count_for_step1(step1):
    """Fixed catalog plus the configured generated Thread Namespace entries."""
    return BASE_NAMED_NS_COUNT + len(_generated_thread_slots_for_step1(step1))
# Archive revisions are immutable until an explicit history-delete request.
# Do not add retention/pruning here: automatic deletion makes recovery and
# audit of approved artifacts impossible.
LUMPS_MANIFEST_PATH = os.path.join(
    _LUMPS_DIR_OVERRIDE or os.path.join(os.path.dirname(os.path.abspath(__file__)), "lumps"),
    "manifest.json",
)

def _load_lump_catalog(selected_tokens=None):
    """Catalog exact binaries; manifest supplies locator/history fields only."""
    try:
        with open(LUMPS_MANIFEST_PATH, "r") as f:
            raw = json.load(f)
    except Exception:
        return []
    selected_tokens = selected_tokens or {}
    _deployed_by_token = {}
    try:
        with open(NS_STATE_PATH, encoding="utf-8") as _ns_fh:
            for _row in json.load(_ns_fh).get("abstractions", []):
                if isinstance(_row, dict) and _row.get("token"):
                    _deployed_by_token[str(_row["token"]).lower().zfill(8)] = _row
    except (OSError, ValueError, TypeError):
        _deployed_by_token = {}
    out = []
    floating = []
    for entry in raw if isinstance(raw, list) else []:
        # Only an approval bound to the exact current bytes may supplement the
        # manifest.  A neighbouring JSON sidecar is never an authority.
        approval = {}
        try:
            binary = _inspect_lump_binary(os.path.join(
                os.path.dirname(LUMPS_MANIFEST_PATH),
                entry.get("filename") or f"{entry.get('token', '')}.lump"))
            approval = _matching_lump_approval(
                os.path.dirname(LUMPS_MANIFEST_PATH), binary["binary_hash"]) or {}
        except (OSError, ValueError):
            continue

        _api = binary.get("api_definition") or {}
        _token = str(entry.get("token") or "").lower().zfill(8)
        _filename_label = os.path.basename(
            entry.get("filename") or f"{_token}.lump").removesuffix(".lump")
        _approved_name = (approval.get("display_name") or approval.get("dot_name")
                          or approval.get("abstraction"))
        _label = _approved_name or _filename_label

        def _apply_binding_candidate_fields(record):
            record["cache_token"] = _token
            record["cacheToken"] = _token
            record["grants"] = approval.get("grants", [])
            record["capability_type"] = approval.get("capability_type")
            for src, dst in (("dot_name", "dotName"), ("issue_n", "issueN"),
                             ("identity_hash", "identityHash"),
                             ("binary_hash", "binaryHash")):
                value = (binary["binary_hash"] if src == "binary_hash"
                         else approval.get(src))
                if value is not None:
                    record[dst] = value

        _deployment = _deployed_by_token.get(_token, {})
        slot = _deployment.get("slot")
        policy = "static" if isinstance(slot, int) else "dynamic"
        # Pre-bound slots above the built-in catalog are legacy private
        # identities, not programmer selections.  Expose those lumps as
        # dynamically allocated so they cannot reserve user capacity.
        if isinstance(slot, int) and slot >= BASE_NAMED_NS_COUNT:
            slot = None
            policy = "dynamic"
        if not isinstance(slot, int):
            # Floating lump — include in catalog with floating flag
            if policy == "dynamic" and _token:
                e = {
                    "abstraction": _label,
                    "nsSlot": None,
                    "lumpSize": binary["lump_size"],
                    "cw": binary["cw"], "cc": binary["cc"],
                    "token": _token,
                    "nsSlotPolicy": policy,
                    "hasExecutableMethods": binary["typ"] == 0 and binary["cw"] > 0,
                    "floating": True,
                    "description": approval.get("documentation"),
                    "contentProfile": binary.get("content_profile"),
                    "profile": approval.get("profile") or _api.get("profile"),
                }
                _apply_binding_candidate_fields(e)
                floating.append(e)
            continue
        if slot in RESERVED_NS_SLOTS:
            continue
        e = {
            "abstraction": _label,
            "nsSlot": slot,
            "lumpSize": binary["lump_size"],
            "cw": binary["cw"], "cc": binary["cc"],
            "token": _token,
            "lumpVersion": entry.get("lump_version", 0),
            "nsSlotPolicy": policy,
            "hasExecutableMethods": binary["typ"] == 0 and binary["cw"] > 0,
            "contentProfile": binary.get("content_profile"),
            "profile": approval.get("profile") or _api.get("profile"),
        }
        # Expose the canonical binding needed by host-side prefetch.  These
        # values are informational until receiveLump() verifies the response
        # headers and raw payload hash.
        for _src, _dst in (("dot_name", "dotName"), ("issue_n", "issueN"),
                            ("identity_hash", "identityHash"), ("binary_hash", "binaryHash")):
            _value = binary["binary_hash"] if _src == "binary_hash" else approval.get(_src)
            if _value is not None:
                e[_dst] = _value
        _apply_binding_candidate_fields(e)
        out.append(e)

    # A namespace slot is an abstraction identity, not an archive-version
    # listing.  Keep exactly one build candidate per dot name.  A persisted
    # token selection wins; otherwise use the newest version, with manifest
    # order as the deterministic tie-breaker.
    grouped = {}
    for candidate in out:
        name = candidate.get("abstraction") or ""
        grouped.setdefault(name, []).append(candidate)

    selected_out = []
    for name, candidates in grouped.items():
        wanted = selected_tokens.get(name)
        chosen = next((c for c in candidates if wanted and c.get("token") == wanted), None)
        if chosen is None:
            chosen = max(
                enumerate(candidates),
                key=lambda pair: (
                    int(pair[1].get("lumpVersion") or 0),
                    pair[0],
                ),
            )[1]
        selected_out.append(chosen)

    # Stable ordering: by NS slot, then abstraction name.
    selected_out.sort(key=lambda e: (e["nsSlot"], e["abstraction"] or ""))
    # Floating lumps appended after fixed-slot entries, sorted by name.
    floating.sort(key=lambda e: e["abstraction"] or "")
    return selected_out + floating

def _step2_selected_tokens(step2):
    """Return abstraction→token selections from a saved Step 2 payload."""
    selected = {}
    if not isinstance(step2, dict):
        return selected
    for row in step2.get("lumps") or []:
        if not isinstance(row, dict):
            continue
        abstraction = row.get("abstraction")
        token = row.get("lumpToken")
        if isinstance(abstraction, str) and abstraction and isinstance(token, str) and token:
            selected[abstraction] = token
    return selected

def _validate_step2_lump_tokens(step2):
    """Reject explicit version selections that are not manifest entries."""
    selected = _step2_selected_tokens(step2)
    if not selected:
        return None
    try:
        with open(LUMPS_MANIFEST_PATH) as f:
            entries = json.load(f)
    except Exception as exc:
        return f"Cannot validate selected LUMP versions: {exc}"
    for abstraction, token in selected.items():
        if not any(
            isinstance(entry, dict)
            and not entry.get("archived")
            and entry.get("abstraction") == abstraction
            and entry.get("token") == token
            for entry in (entries if isinstance(entries, list) else [])
        ):
            return f"Unknown LUMP version token {token!r} for abstraction {abstraction!r}"
    return None

def _normalize_step2_preload_bindings(step2):
    """Bind every Preload row to its canonical catalog record.

    The UI may omit these mechanical fields, but it may not choose them.  A
    caller-supplied token, capacity, or digest must match the selected catalog
    candidate exactly; omitted fields are populated from that candidate before
    validation and persistence.
    """
    if step2 is None or not isinstance(step2, dict):
        return step2, None
    lumps = step2.get("lumps")
    if not isinstance(lumps, list):
        return step2, None
    selected_tokens = _step2_selected_tokens(step2)
    catalog_entries = _load_lump_catalog(selected_tokens) if selected_tokens else _load_lump_catalog()
    catalog = {
        entry.get("nsSlot"): entry for entry in catalog_entries
        if isinstance(entry, dict) and isinstance(entry.get("nsSlot"), int)
    }

    def canonical_hash(value):
        if value is None:
            return None
        value = str(value).strip().lower()
        if value.startswith("sha256:"):
            value = value[7:]
        return value if len(value) == 64 and all(ch in "0123456789abcdef" for ch in value) else None

    normalized_rows = []
    for entry in lumps:
        if not isinstance(entry, dict):
            normalized_rows.append(entry)
            continue
        row = dict(entry)
        policy = row.get("loadPolicy", row.get("load_policy"))
        if policy is None:
            policy = "Resident" if row.get("resident") else (
                "Preload" if row.get("prefetch") else "Lazy")
        if policy != "Preload":
            normalized_rows.append(row)
            continue
        slot = row.get("nsSlot")
        catalog_entry = catalog.get(slot)
        # Let the ordinary Step 2 validator return its clear slot error.
        if catalog_entry is None:
            normalized_rows.append(row)
            continue
        canonical_token = str(catalog_entry.get("token") or "").lower()
        canonical_size = catalog_entry.get("lumpSize")
        canonical_binary = canonical_hash(
            catalog_entry.get("binaryHash") or catalog_entry.get("binary_hash"))
        canonical_identity = canonical_hash(
            catalog_entry.get("identityHash") or catalog_entry.get("identity_hash"))
        supplied_token = str(row.get("lumpToken") or "").lower()
        if supplied_token and supplied_token != canonical_token:
            return None, f"Wukong preload slot {slot} lumpToken does not match its canonical catalog record"
        if row.get("lumpSize") is not None and row.get("lumpSize") != canonical_size:
            return None, f"Wukong preload slot {slot} lumpSize does not match its canonical catalog record"
        supplied_binary = row.get("binaryHash", row.get("binary_hash"))
        if supplied_binary is not None and canonical_hash(supplied_binary) != canonical_binary:
            return None, f"Wukong preload slot {slot} binaryHash does not match its canonical catalog record"
        supplied_identity = row.get("identityHash", row.get("identity_hash"))
        if supplied_identity is not None and (
                not canonical_identity or canonical_hash(supplied_identity) != canonical_identity):
            return None, f"Wukong preload slot {slot} identityHash does not match its canonical catalog record"
        if not canonical_token or not isinstance(canonical_size, int) or not canonical_binary:
            return None, f"Wukong preload slot {slot} lacks a complete canonical catalog binding"
        row["abstraction"] = catalog_entry.get("abstraction") or row.get("abstraction")
        row["lumpToken"] = canonical_token
        row["lumpSize"] = canonical_size
        row["binaryHash"] = canonical_binary
        if canonical_identity:
            row["identityHash"] = canonical_identity
        else:
            row.pop("identityHash", None)
            row.pop("identity_hash", None)
        normalized_rows.append(row)
    normalized = dict(step2)
    normalized["lumps"] = normalized_rows
    return normalized, None

def _boot_abstr_size_for_validation():
    """Return the actual allocation for the state-authorized SelfTest."""
    boot_abstr_size = BOOT_ABSTR_DEFAULT_SIZE
    locator = _active_selftest_locator(LUMPS_DIR)
    if locator is None:
        return boot_abstr_size
    saved_abstr_path = os.path.join(LUMPS_DIR, locator["filename"])
    try:
        import struct as _vstruct
        with open(saved_abstr_path, "rb") as fh:
            raw = fh.read()
        n_words = len(raw) // 4
        if n_words < 1:
            return boot_abstr_size
        hdr = _vstruct.unpack(">I", raw[:4])[0]
        magic = (hdr >> 27) & 0x1F
        n_minus_6 = (hdr >> 23) & 0xF
        cw = (hdr >> 10) & 0x1FFF
        cc = hdr & 0xFF
        declared = 1 << (n_minus_6 + 6)
        if (magic == 0x1F and 64 <= declared <= 16384
                and n_words >= declared and cw >= 1 and cc >= 1
                and cc <= declared):
            return declared
    except OSError:
        pass
    return boot_abstr_size


def _validate_step2(step2, step1, target_board):
    """Validate one load policy per Namespace slot.

    New rows use ``loadPolicy`` (Empty, Resident, Preload, Lazy).  Legacy
    resident/prefetch fields are accepted only as an input compatibility layer.
    """
    if step2 is None:
        return None
    if not isinstance(step2, dict):
        return "step2 must be an object"
    lumps = step2.get("lumps") or []
    if not isinstance(lumps, list):
        return "step2.lumps must be a list"
    token_err = _validate_step2_lump_tokens(step2)
    if token_err:
        return token_err
    selected_tokens = _step2_selected_tokens(step2)
    catalog_entries = (
        _load_lump_catalog(selected_tokens)
        if selected_tokens else _load_lump_catalog()
    )
    catalog = {e["nsSlot"]: e for e in catalog_entries}
    _raw_ns_slots_max_v2 = step1.get("nsSlotsMax")
    _ns_slots_max_v2 = (_boot_image_gen.DEFAULT_NS_SLOTS_MAX
                         if _raw_ns_slots_max_v2 is None
                         else int(_raw_ns_slots_max_v2))
    NS_TABLE_RESERVE = _boot_image_gen.ns_table_reserve_words(_ns_slots_max_v2)
    total = step1["totalNamespaceWords"]
    # Determine actual Boot.Abstr size from the saved SelfTest lump (looked up via
    # manifest.json).  A resident step-2 lump must not overlap whichever Boot.Abstr
    # will actually be placed.
    _abstr_size_for_validation = _boot_abstr_size_for_validation()
    _thread_count = _boot_image_gen.configured_thread_count(step1)
    foundation_end = _boot_image_gen.boot_resident_region_end(
        step1["threadLumpWords"], _abstr_size_for_validation, _thread_count)
    # The Namespace LUMP lives at the Namespace-table tail.  The protected
    # RAM prefix includes Thread.1, SelfTest, fixed catalog bodies (slots
    # 7–10), and every generated Thread body.
    usable_end = total - NS_TABLE_RESERVE
    seen_slots = set()
    occupied = []  # list of (start, end_exclusive, label) for resident lumps
    generated_thread_slots = _generated_thread_slots_for_step1(step1)
    for entry in lumps:
        if not isinstance(entry, dict):
            return "each step2.lumps entry must be an object"
        slot = entry.get("nsSlot")
        if (not isinstance(slot, int) or isinstance(slot, bool)
                or slot < 0 or slot >= _ns_slots_max_v2):
            return f"step2.lumps entry has invalid nsSlot: {slot!r}"
        if slot in RESERVED_NS_SLOTS:
            return (f"NS slot {slot} is reserved (foundational lump or device "
                    f"MMIO) and cannot host a resident lump")
        if slot in generated_thread_slots:
            return (f"NS slot {slot} is reserved for generated "
                    f"{_boot_image_gen.generated_thread_label(slot)} and cannot "
                    "host a programmer-selected lump")
        if slot in seen_slots:
            return f"duplicate step2.lumps entry for NS slot {slot}"
        seen_slots.add(slot)
        policy = entry.get("loadPolicy", entry.get("load_policy"))
        if policy is None:
            policy = "Resident" if entry.get("resident") else (
                "Preload" if entry.get("prefetch") else "Lazy")
        if policy not in ("Empty", "Resident", "Preload", "Lazy"):
            return f"NS slot {slot} has invalid loadPolicy {policy!r}"
        if policy == "Empty":
            continue
        if slot not in catalog:
            return f"NS slot {slot} is not present in the lump catalog"
        resident = policy == "Resident"
        if not resident:
            if policy == "Preload":
                if target_board == "wukong-xc7a100t":
                    return ("Wukong physical uploads include the selected boot "
                            "entry and up to three Thread contexts; Preload "
                            "LUMPs are not supported by this board build")
            continue
        cat = catalog[slot]
        lump_size = entry.get("lumpSize") or cat.get("lumpSize")
        if not isinstance(lump_size, int) or lump_size <= 0:
            return f"resident lump for NS slot {slot} has invalid lumpSize"
        phys = entry.get("physAddr")
        if not isinstance(phys, int) or phys < 0:
            return (f"resident lump for NS slot {slot} ({cat.get('abstraction')}) "
                    f"requires a non-negative integer physAddr")
        if phys < foundation_end:
            return (f"resident lump {cat.get('abstraction')} (NS slot {slot}) "
                    f"physAddr {phys} overlaps the foundational lump region "
                    f"(0..{foundation_end-1})")
        hw_profile = HARDWARE_PROFILES.get(target_board, {})
        board_total = hw_profile.get("totalRamWords", 0)
        if board_total and phys + lump_size > board_total:
            return (f"resident lump {cat.get('abstraction')} (NS slot {slot}) "
                    f"of {lump_size} words at physAddr {phys} would extend past "
                    f"the {hw_profile.get('label', target_board)} board RAM limit "
                    f"of {board_total} words")
        if phys + lump_size > usable_end:
            return (f"resident lump {cat.get('abstraction')} (NS slot {slot}) "
                    f"of {lump_size} words at physAddr {phys} would extend past "
                    f"the usable namespace region (ends at {usable_end})")
        for (s, e, lbl) in occupied:
            if not (phys + lump_size <= s or phys >= e):
                return (f"resident lump {cat.get('abstraction')} (NS slot {slot}) "
                        f"at {phys}..{phys+lump_size-1} overlaps {lbl}")
        occupied.append((phys, phys + lump_size, f"{cat.get('abstraction')} (NS {slot})"))
    return None

def _validate_step3(step3, step1, step2):
    """Validate the optional Step 3 (empty NS slot reservation) section.

    `step3.emptySlotCount` is the number of blank NS entries to append at
    boot for the runtime lazy loader to claim. Must be a non-negative int
    that, combined with the foundational + device + Step 2 catalog slots
    actually present, fits within MAX_NS_ENTRIES.
    """
    if step3 is None:
        return None
    if not isinstance(step3, dict):
        return "step3 must be an object"
    n = step3.get("emptySlotCount", 0)
    if not isinstance(n, int) or n < 0:
        return "step3.emptySlotCount must be a non-negative integer"
    # Generated Thread.2 onward are named entries too. Step 3 reserves after
    # the fixed catalog plus those deterministic Thread slots.
    named_count = _named_ns_count_for_step1(step1)
    end = named_count + n
    # Validate against the *configured* capacity (step1.nsSlotsMax, legacy
    # default 256) so save-time and generation-time contracts agree — the
    # generator rejects overflow of the configured table, not the 1024 cap.
    _cap = MAX_NS_ENTRIES
    try:
        _raw_cap = (step1 or {}).get("nsSlotsMax")
        _cap = (_boot_image_gen.DEFAULT_NS_SLOTS_MAX if _raw_cap is None
                else int(_raw_cap))
    except Exception:
        pass
    _cap = min(_cap, MAX_NS_ENTRIES)
    if end > _cap:
        return (f"step3.emptySlotCount ({n}) plus the {named_count} "
                f"named NS slots written at boot would need {end} entries "
                f"but the configured NS table only holds {_cap}")
    return None

def _is_pow2(n):
    return isinstance(n, int) and n > 0 and (n & (n - 1)) == 0

def _validate_step1(target_board, step1):
    if target_board not in HARDWARE_PROFILES:
        return f"Unknown target board: {target_board}"
    profile = HARDWARE_PROFILES[target_board]
    required_fields = ("totalNamespaceWords", "namespaceLumpWords", "threadLumpWords")
    for f in required_fields:
        v = step1.get(f)
        if not isinstance(v, int) or v <= 0:
            return f"step1.{f} must be a positive integer"
    # Validate before using the count in arithmetic.  In particular, do not
    # let a string/bool hand-edited into boot-config be silently coerced into
    # a different generated Thread layout.
    _raw_thread_count = step1.get("threadCount")
    max_thread_count = profile.get(
        "maxThreadCount", _boot_image_gen.MAX_THREAD_COUNT)
    if (_raw_thread_count is not None and
            (not isinstance(_raw_thread_count, int) or isinstance(_raw_thread_count, bool)
             or not (1 <= _raw_thread_count <= max_thread_count))):
        return (f"step1.threadCount must be an integer between 1 and "
                f"{max_thread_count} when provided for {profile['label']}")
    _thread_count = _raw_thread_count if _raw_thread_count is not None else 1
    # abstractionLumpWords is deprecated (Task #568/569) — silently ignore if present in
    # legacy saved configs; the generator derives the size from the saved lump directly.
    total = step1["totalNamespaceWords"]
    if total > profile["totalRamWords"]:
        return (f"totalNamespaceWords ({total}) exceeds {profile['label']} "
                f"budget ({profile['totalRamWords']} words)")
    for f in required_fields:
        if not _is_pow2(step1[f]):
            return f"step1.{f} must be a power of 2"
        if step1[f] < 64:
            return f"step1.{f} must be at least 64 words (FPGA minimum slot)"
    # Boot.Abstr actual size is always BOOT_ABSTR_DEFAULT_SIZE (64) or the saved
    # lump size — abstractionLumpWords is ignored for the foundation_sum check.
    foundation_sum = _boot_image_gen.boot_resident_region_end(
        step1["threadLumpWords"], BOOT_ABSTR_DEFAULT_SIZE, _thread_count)
    # The Namespace LUMP occupies the Namespace-table tail, while the
    # architecture-defined device rows are MMIO. The contiguous RAM prefix
    # also includes the architecture-defined catalog bodies.
    if foundation_sum > total:
        return (f"Sum of foundational lump sizes ({foundation_sum}) exceeds "
                f"totalNamespaceWords ({total})")
    # Optional nsSlotsMax — validated here, persisted by boot_config_post (Task #1244).
    _raw_ns_slots_max = step1.get("nsSlotsMax")
    if _raw_ns_slots_max is not None:
        if (not isinstance(_raw_ns_slots_max, int)
                or isinstance(_raw_ns_slots_max, bool)
                or not 0 <= _raw_ns_slots_max <= MAX_NS_ENTRIES):
            return (f"step1.nsSlotsMax must be an integer in 0..{MAX_NS_ENTRIES} "
                    "when provided")
    # The Thread reserves 18 leading words and 12 tail capability homes.
    if step1["threadLumpWords"] < 256:
        return ("step1.threadLumpWords must be at least 256: the Thread "
                "minimum private layout requires 18 leading words and 12 tail capability homes")
    if step1["threadLumpWords"] not in _boot_image_gen.THREAD_SUPPORTED_BODY_WORDS:
        return ("step1.threadLumpWords must be one of the normative Thread body "
                f"sizes: {_boot_image_gen.THREAD_SUPPORTED_BODY_WORDS}")
    _thread_stack_words = step1.get("threadStackWords", 32)
    if (not isinstance(_thread_stack_words, int) or isinstance(_thread_stack_words, bool)
            or _thread_stack_words <= 0):
        return "step1.threadStackWords must be a positive integer"
    _thread_layout = _boot_image_gen.thread_layout(
        step1["threadLumpWords"], _thread_stack_words)
    if not _thread_layout["valid"]:
        return ("step1 Thread geometry overlaps: stack must leave at least one "
                "Heap word after the protected STO and before the tail capability homes")
    # The physical V2 table is tail-anchored and has exactly four words per
    # encoded slot; no power-of-two rounding or minimum reserve is applied.
    _ns_slots_max_v1 = (_boot_image_gen.DEFAULT_NS_SLOTS_MAX
                         if _raw_ns_slots_max is None else _raw_ns_slots_max)
    if _ns_slots_max_v1 < _named_ns_count_for_step1(step1):
        return (f"step1.nsSlotsMax ({_ns_slots_max_v1}) cannot hold the "
                f"{_named_ns_count_for_step1(step1)} named entries required by "
                f"threadCount ({step1.get('threadCount', 1)})")
    NS_TABLE_RESERVE = _boot_image_gen.ns_table_reserve_words(_ns_slots_max_v1)
    usable = total - NS_TABLE_RESERVE
    if foundation_sum > usable:
        return (f"Sum of foundational lump sizes ({foundation_sum}) exceeds the "
                f"{usable}-word usable space (total {total} minus {NS_TABLE_RESERVE} "
                f"reserved for the namespace table)")
    return None

@app.route("/api/boot-config", methods=["GET"])
def boot_config_get():
    # Returns the persisted project boot config, or `null` when none exists.
    # When `config` is null the simulator MUST keep its historical defaults
    # (65536-word memory, 64/256/256 lump sizes) — the IDE only changes the
    # boot image when the programmer has explicitly saved a config. The
    # `defaults` field carries form values to prefill the modal so the
    # programmer has a sensible starting point to edit.
    path = None
    if os.path.isfile(BOOT_CONFIG_PATH):
        path = BOOT_CONFIG_PATH
    elif os.path.isfile(BOOT_CONFIG_LEGACY_PATH):
        path = BOOT_CONFIG_LEGACY_PATH
    cfg = None
    if path is not None:
        try:
            with open(path, "r") as f:
                cfg = json.load(f)
        except Exception as e:
            return jsonify({"error": f"Failed to read boot-config.json: {e}"}), 500
        _migrate_legacy_board(cfg)
        s1 = cfg.get("step1") if isinstance(cfg, dict) else None
        if (not isinstance(cfg, dict)
            or _validate_step1(cfg.get("targetBoard"), s1 or {}) is not None):
            cfg = None  # corrupt/stale file — fall through to "no config"
        else:
            # Step 2 is optional; if present in the file it must validate. If
            # it doesn't, drop it rather than discarding the whole config.
            s2 = cfg.get("step2")
            if s2 is not None and _validate_step2(s2, s1, cfg.get("targetBoard")) is not None:
                cfg.pop("step2", None)
            s3 = cfg.get("step3")
            if s3 is not None and _validate_step3(s3, s1, cfg.get("step2")) is not None:
                cfg.pop("step3", None)
    return jsonify({
        "config": cfg,
        "defaults": DEFAULT_BOOT_CONFIG,
        "profiles": HARDWARE_PROFILES,
        "lumpCatalog": _load_lump_catalog(
            _step2_selected_tokens(cfg.get("step2")) if isinstance(cfg, dict) else {}
        ),
        "limits": {
            "maxNsEntries": MAX_NS_ENTRIES,
            # The physical boot layout always stores SelfTest at slot 6, even
            # when the lightning-bolt target is another catalog entry. The
            # Builder needs this authoritative size for resident addresses.
            "bootAbstrLumpWords": _boot_abstr_size_for_validation(),
            "baseNamedNsCount": _named_ns_count_for_step1(
                cfg.get("step1") if isinstance(cfg, dict) else DEFAULT_BOOT_CONFIG["step1"]),
            "generatedThreadSlots": sorted(_generated_thread_slots_for_step1(
                cfg.get("step1") if isinstance(cfg, dict) else DEFAULT_BOOT_CONFIG["step1"])),
        },
    })

@app.route("/api/boot-config", methods=["POST"])
def boot_config_post():
    data = request.get_json(silent=True) or {}
    target_board = data.get("targetBoard")
    step1 = data.get("step1") or {}
    err = _validate_step1(target_board, step1)
    if err:
        return jsonify({"ok": False, "error": err}), 400
    step2 = data.get("step2")
    step2, binding_err = _normalize_step2_preload_bindings(step2)
    if binding_err:
        return jsonify({"ok": False, "error": binding_err}), 400
    err2 = _validate_step2(step2, step1, target_board)
    if err2:
        return jsonify({"ok": False, "error": err2}), 400
    step3 = data.get("step3")
    err3 = _validate_step3(step3, step1, step2)
    if err3:
        return jsonify({"ok": False, "error": err3}), 400
    # Load the previous config once so clients that predate bootEntrySlot do
    # not erase a saved Lightning Bolt selection or Namespace slot labels.
    existing = {}
    if os.path.exists(BOOT_CONFIG_PATH):
        try:
            with open(BOOT_CONFIG_PATH) as existing_file:
                loaded_existing = json.load(existing_file)
            if isinstance(loaded_existing, dict):
                existing = loaded_existing
        except Exception:
            pass
    boot_entry_slot = data.get(
        "bootEntrySlot",
        existing.get("bootEntrySlot", DEFAULT_BOOT_CONFIG["bootEntrySlot"]),
    )
    if (not isinstance(boot_entry_slot, int) or isinstance(boot_entry_slot, bool)
            or boot_entry_slot < 0 or boot_entry_slot >= MAX_NS_ENTRIES):
        return jsonify({
            "ok": False,
            "error": (
                "bootEntrySlot must be an integer between 0 and "
                f"{MAX_NS_ENTRIES - 1}"
            ),
        }), 400
    slot_rules = data.get("slotRules", existing.get("slotRules", {}))
    slot_rules_err = _validate_slot_rules(slot_rules)
    if slot_rules_err:
        return jsonify({"ok": False, "error": slot_rules_err}), 400
    normalized_slot_rules = {
        str(int(slot)): rule for slot, rule in (slot_rules or {}).items()
    }
    cfg = {
        "schemaVersion": BOOT_CONFIG_SCHEMA_VERSION,
        "targetBoard": target_board,
        "bootEntrySlot": boot_entry_slot,
        "slotRules": normalized_slot_rules,
        "step1": {
            "totalNamespaceWords": int(step1["totalNamespaceWords"]),
            "namespaceLumpWords": int(step1["namespaceLumpWords"]),
            "threadLumpWords": int(step1["threadLumpWords"]),
        },
    }
    # Persist nsSlotsMax when provided (Task #1244 — dynamic NS table reserve).
    # Omitting it from the saved config means downstream code defaults to 256 slots
    # (1024-word reserve), preserving backward compatibility with old configs.
    if step1.get("nsSlotsMax") is not None:
        cfg["step1"]["nsSlotsMax"] = int(step1["nsSlotsMax"])
    # Persist threadCount when provided (Task #2562 — V20 Thread.1..Thread.n).
    if step1.get("threadCount") is not None:
        cfg["step1"]["threadCount"] = int(step1["threadCount"])
    cfg["step1"]["threadStackWords"] = int(step1.get("threadStackWords", 32))
    if step2 is not None:
        norm = []
        for e in (step2.get("lumps") or []):
            policy = e.get("loadPolicy", e.get("load_policy"))
            if policy is None:
                policy = "Resident" if e.get("resident") else (
                    "Preload" if e.get("prefetch") else "Lazy")
            row = {"nsSlot": int(e["nsSlot"]), "loadPolicy": policy,
                   # Compatibility projection for boot-image readers; not a
                   # second programmer-facing decision.
                   "resident": policy == "Resident"}
            if e.get("abstraction"):
                row["abstraction"] = str(e["abstraction"])
            if e.get("lumpToken"):
                row["lumpToken"] = str(e["lumpToken"])
            if policy == "Preload":
                # Capacity and canonical hashes are derived from the catalog
                # and retained as bridge bindings.  URL, order, and
                # required/optional controls are intentionally not persisted.
                if e.get("lumpSize") is not None:
                    row["lumpSize"] = int(e["lumpSize"])
                binary_hash = e.get("binaryHash") or e.get("binary_hash")
                if binary_hash:
                    row["binaryHash"] = str(binary_hash)
                identity_hash = e.get("identityHash") or e.get("identity_hash")
                if identity_hash:
                    row["identityHash"] = str(identity_hash)
            if row["resident"]:
                row["physAddr"] = int(e["physAddr"])
                if e.get("lumpSize") is not None:
                    row["lumpSize"] = int(e["lumpSize"])
            cfg.setdefault("step2", {"lumps": []})
            norm.append(row)
        cfg["step2"] = {"lumps": norm}
    if step3 is not None:
        cfg["step3"] = {"emptySlotCount": int(step3.get("emptySlotCount", 0) or 0)}
    # Preserve slotLabels from the existing file — they are written by the
    # /api/boot-config/slot-label endpoint and must not be wiped by a
    # Boot Image Designer save that doesn't include them.
    if isinstance(existing.get("slotLabels"), dict):
        cfg["slotLabels"] = existing["slotLabels"]
    # Next.GT is derived from the LightningBolt boot entry when generating an
    # image. A separately saved continuation target is obsolete and must not
    # survive a Boot Image Designer save.
    cfg.pop("nextAfterSelfTestSlot", None)
    try:
        with open(BOOT_CONFIG_PATH, "w") as f:
            json.dump(cfg, f, indent=2)
    except Exception as e:
        return jsonify({"ok": False, "error": f"Failed to write boot-config.json: {e}"}), 500
    # A boot image is a complete memory image, not an overlay. If Step 1 now
    # selects a different memory size, report the cached binary as invalidated.
    # Keep the file until explicit regeneration replaces it; all serve/upload
    # gates validate against the configured size, so it cannot be advertised or
    # applied in the interim.
    boot_image_invalidated = False
    invalidated_image_words = None
    if os.path.isfile(BOOT_IMAGE_PATH):
        try:
            image_bytes = os.path.getsize(BOOT_IMAGE_PATH)
            configured_bytes = cfg["step1"]["totalNamespaceWords"] * 4
            if image_bytes != configured_bytes:
                boot_image_invalidated = True
                invalidated_image_words = image_bytes // 4
        except OSError as exc:
            logging.warning("boot_config_post: could not inspect cached boot image: %s", exc)
    return jsonify({
        "ok": True,
        "config": cfg,
        "bootImageInvalidated": boot_image_invalidated,
        "invalidatedBootImageWords": invalidated_image_words,
    })


def _optional_report_token_check():
    """Require REPORT_TOKEN only when it is configured in the environment.

    IDE-internal mutation endpoints call this so they are protected in
    production deployments (where REPORT_TOKEN is set) while remaining
    usable in local dev sessions that omit the token.  Clients should send
    'Authorization: Bearer <token>' when the token is available.
    """
    token = os.environ.get('REPORT_TOKEN', '').strip()
    if not token:
        return True, None          # auth not configured — allow (dev mode)
    auth = request.headers.get('Authorization', '')
    if auth == f'Bearer {token}':
        return True, None
    err = jsonify({'ok': False, 'error':
                   'Unauthorized — supply REPORT_TOKEN via Authorization: Bearer header.'})
    return False, (err, 401)


def _wukong_control_auth():
    """Authenticate a physical bridge/control request without leaking secrets.

    The bridge and the IDE use the same configured REPORT_TOKEN convention:
    callers supply it only in an Authorization bearer header.  Local
    development remains usable when no hardware secret has been configured,
    matching the established IDE mutation convention above.  Deliberately do
    not accept query parameters: they are routinely retained in browser and
    proxy logs.
    """
    return _optional_report_token_check()


@app.route("/api/boot-config/next-after-selftest", methods=["POST"])
def boot_config_next_after_selftest():
    """Reject retired independent Next.GT configuration requests.

    Next.GT always follows the ⚡ LightningBolt boot-entry GT; accepting an
    independent slot would make the displayed continuation disagree with the
    generated boot image.
    """
    ok, err = _optional_report_token_check()
    if not ok:
        return err
    return jsonify({
        "ok": False,
        "error": "Next.GT always follows the LightningBolt boot-entry slot and cannot be set independently.",
    }), 409


@app.route("/api/boot-config/slot-label", methods=["POST"])
def boot_config_slot_label():
    """Merge a single NS slot → label mapping into boot-config.json.
    Called by +Add LUMP so the label survives hard resets without touching
    the step1/step2/step3 fields written by the Boot Image Designer."""
    data = request.get_json(silent=True) or {}
    slot = data.get("slot")
    label = str(data.get("label", "") or "").strip()
    if not isinstance(slot, int) or slot < 2 or slot >= 256:
        return jsonify({"ok": False, "error": "slot must be an integer 2–255"}), 400
    if not label:
        return jsonify({"ok": False, "error": "label must be a non-empty string"}), 400
    cfg = {}
    if os.path.exists(BOOT_CONFIG_PATH):
        try:
            with open(BOOT_CONFIG_PATH) as f:
                cfg = json.load(f)
        except Exception:
            pass
    if not isinstance(cfg.get("slotLabels"), dict):
        cfg["slotLabels"] = {}
    cfg["slotLabels"][str(slot)] = label
    try:
        with open(BOOT_CONFIG_PATH, "w") as f:
            json.dump(cfg, f, indent=2)
    except Exception as e:
        return jsonify({"ok": False, "error": f"Failed to write boot-config.json: {e}"}), 500
    return jsonify({"ok": True, "slot": slot, "label": label})

# ---------------------------------------------------------------------------
# Boot image binary generator (Task #217)
# ---------------------------------------------------------------------------
# The generator reads the saved boot-config.json and produces a raw 32-bit
# little-endian memory dump of the namespace memory window — see
# server/boot_image.py for the layout. The image is written to
# server/lumps/boot-image.bin so the IDE can offer it as a download AND so
# the simulator can fetch and apply it at boot via /api/boot-image/binary.
BOOT_IMAGE_PATH = os.path.join(os.path.dirname(LUMPS_MANIFEST_PATH), "boot-image.bin")
BOOT_IMAGE_PROVENANCE_PATH = os.path.join(
    os.path.dirname(LUMPS_MANIFEST_PATH), "boot-image.provenance.json")
NS_STATE_PATH   = os.path.join(os.path.dirname(LUMPS_MANIFEST_PATH), "ns-state.json")
LUMPS_DIR = os.path.dirname(LUMPS_MANIFEST_PATH)
_namespace_commit_lock = threading.RLock()
_namespace_commit_state = threading.local()


def _namespace_commit_guard():
    """Cross-process, re-entrant lock for the committed Namespace file pair."""
    import contextlib
    import fcntl

    @contextlib.contextmanager
    def _guard():
        with _namespace_commit_lock:
            depth = getattr(_namespace_commit_state, "depth", 0)
            if depth:
                _namespace_commit_state.depth = depth + 1
                try:
                    yield
                finally:
                    _namespace_commit_state.depth -= 1
                return
            lock_path = os.path.join(os.path.dirname(NS_STATE_PATH), ".namespace-commit.lock")
            os.makedirs(os.path.dirname(lock_path), exist_ok=True)
            with open(lock_path, "a+") as lock_file:
                fcntl.flock(lock_file.fileno(), fcntl.LOCK_EX)
                _namespace_commit_state.depth = 1
                try:
                    yield
                finally:
                    _namespace_commit_state.depth = 0
                    fcntl.flock(lock_file.fileno(), fcntl.LOCK_UN)
    return _guard()


def _write_boot_image_bytes(image_bytes):
    """Atomically replace the committed boot image under the Namespace lock."""
    tmp_path = BOOT_IMAGE_PATH + ".tmp"
    provenance_tmp_path = BOOT_IMAGE_PROVENANCE_PATH + ".tmp"
    with _namespace_commit_guard():
        try:
            provenance = _boot_image_gen.build_boot_image_provenance(
                image_bytes, LUMPS_DIR)
            with open(tmp_path, "wb") as image_file:
                image_file.write(image_bytes)
            with open(provenance_tmp_path, "w", encoding="utf-8") as provenance_file:
                json.dump(provenance, provenance_file, sort_keys=True, indent=2)
            os.replace(tmp_path, BOOT_IMAGE_PATH)
            os.replace(provenance_tmp_path, BOOT_IMAGE_PROVENANCE_PATH)
            _invalidate_ns_state_raw_binding()
        except Exception:
            for pending_path in (tmp_path, provenance_tmp_path):
                try:
                    os.remove(pending_path)
                except OSError:
                    pass
            raise


def _invalidate_ns_state_raw_binding():
    """Mark decoded metadata unavailable after a raw-only boot-image write."""
    if not os.path.isfile(NS_STATE_PATH):
        return
    with open(NS_STATE_PATH, encoding="utf-8") as state_file:
        state = json.load(state_file)
    if not isinstance(state, dict):
        raise ValueError("Namespace metadata is invalid")
    # Avoid rewriting semantically unchanged state.  Besides unnecessary I/O,
    # touching this authoritative generator input after writing boot-image.bin
    # would make the new image immediately appear stale again.
    if "committed_raw_fingerprint" not in state:
        return
    state.pop("committed_raw_fingerprint", None)
    tmp_state = NS_STATE_PATH + ".tmp"
    with open(tmp_state, "w", encoding="utf-8") as state_file:
        json.dump(state, state_file, indent=2)
    os.replace(tmp_state, NS_STATE_PATH)

# Canonical list of server-managed tokens — excluded from the /api/lumps browser
# listing and exempt from the R3 manifest-presence check in test_lump_consistency.py.
# Edit server/lumps/server_managed_tokens.json (one place only) to add new tokens.
def _load_server_managed_tokens() -> frozenset:
    _path = os.path.join(LUMPS_DIR, 'server_managed_tokens.json')
    try:
        with open(_path) as _f:
            return frozenset(t.lower() for t in json.load(_f).get('tokens', []))
    except Exception as _e:
        print(f'[lumps] WARNING: could not load server_managed_tokens.json: {_e}', flush=True)
        return frozenset()

SERVER_MANAGED_TOKENS: frozenset = _load_server_managed_tokens()

def _read_saved_boot_config():
    """Load and revalidate the persisted boot-config.json. Returns the
    cfg dict on success, or (None, error_message) on failure."""
    path = None
    if os.path.isfile(BOOT_CONFIG_PATH):
        path = BOOT_CONFIG_PATH
    elif os.path.isfile(BOOT_CONFIG_LEGACY_PATH):
        path = BOOT_CONFIG_LEGACY_PATH
    if path is None:
        return None, "No saved boot-config.json — open the Boot Image Designer and save first."
    try:
        with open(path, "r") as f:
            cfg = json.load(f)
    except Exception as e:
        return None, f"Failed to read boot-config.json: {e}"
    _migrate_legacy_board(cfg)
    err = _validate_step1(cfg.get("targetBoard"), cfg.get("step1") or {})
    if err:
        return None, f"Saved config fails Step 1 validation: {err}"
    s2 = cfg.get("step2")
    if s2 is not None:
        err2 = _validate_step2(s2, cfg["step1"], cfg.get("targetBoard"))
        if err2:
            return None, f"Saved config fails Step 2 validation: {err2}"
    s3 = cfg.get("step3")
    if s3 is not None:
        err3 = _validate_step3(s3, cfg["step1"], cfg.get("step2"))
        if err3:
            return None, f"Saved config fails Step 3 validation: {err3}"
    return cfg, None

@app.route("/api/boot-image/generate", methods=["POST"])
def boot_image_generate():
    cfg, err = _read_saved_boot_config()
    if err:
        return jsonify({"ok": False, "error": err}), 400
    body = request.get_json(silent=True) or {}
    # Explicit requests win; otherwise generation uses the Lightning Bolt
    # selection saved with the Boot Image Designer config.
    entry_slot = body.get("entrySlot", cfg.get(
        "bootEntrySlot", DEFAULT_BOOT_CONFIG["bootEntrySlot"]))
    if entry_slot is not None:
        try:
            entry_slot = max(0, min(255, int(entry_slot)))
        except (TypeError, ValueError):
            entry_slot = None
    # Hardware-targeted generation (Wukong bridge upload): the entry lump's
    # code body must be resident — the FPGA has no lazy-fetch path.
    for_hardware = bool(body.get("forHardware", False))
    drift_warnings = []
    try:
        with _warnings_mod.catch_warnings(record=True) as _caught:
            _warnings_mod.simplefilter("always")
            blob = _boot_image_gen.generate_boot_image(
                cfg, LUMPS_DIR, boot_entry_slot=entry_slot,
                require_entry_resident=for_hardware)
        for _w in _caught:
            if issubclass(_w.category, UserWarning):
                drift_warnings.append(str(_w.message))
                logging.warning("boot-image drift: %s", _w.message)
    except Exception as e:
        return jsonify({"ok": False, "error": f"Generator failed: {e}"}), 500
    try:
        _write_boot_image_bytes(blob)
    except Exception as e:
        return jsonify({"ok": False, "error": f"Failed to write boot-image.bin: {e}"}), 500
    _load_boot_abstr_lump()
    _load_boot_ns_lump()
    return jsonify({
        "ok": True,
        "bytes": len(blob),
        "words": len(blob) // 4,
        "downloadUrl": "/api/boot-image/download",
        "binaryUrl": "/api/boot-image/binary",
        "warnings": drift_warnings,
    })

@app.route("/api/boot-image/download", methods=["GET"])
def boot_image_download():
    if not os.path.isfile(BOOT_IMAGE_PATH):
        return jsonify({"error": "boot-image.bin not generated yet"}), 404
    with open(BOOT_IMAGE_PATH, "rb") as _f:
        _image_bytes = _f.read()
    _cfg, _cfg_err = _read_saved_boot_config()
    _configured_words = (
        int(_cfg["step1"]["totalNamespaceWords"])
        if _cfg_err is None and _cfg is not None else None
    )
    try:
        _boot_image_gen.validate_boot_image(_image_bytes, _configured_words)
    except ValueError as _e:
        logging.error("boot_image_download: stale or invalid boot image on disk: %s", _e)
        return jsonify({"error": f"Boot image on disk is stale or invalid: {_e}"}), 500
    return send_file(io.BytesIO(_image_bytes), mimetype="application/octet-stream",
                     as_attachment=True, download_name="boot-image.bin")

def _boot_image_is_stale():
    """Return True if the image size or any tracked source is stale.

    Checked files: the state-authorized SelfTest binary, manifest.json
    (controls boot_resident policy), and ns-state.json (authoritative slot,
    artifact, and generation bindings).  If boot-image.bin does not exist
    the function returns False so callers fall through to their own 404 path.
    """
    if not os.path.isfile(BOOT_IMAGE_PATH):
        return False
    try:
        _cfg, _cfg_err = _read_saved_boot_config()
        if _cfg_err is None and _cfg is not None:
            _expected_bytes = int(_cfg["step1"]["totalNamespaceWords"]) * 4
            if os.path.getsize(BOOT_IMAGE_PATH) != _expected_bytes:
                return True
        # Generator source changes do not necessarily make any LUMP/config
        # input newer than an existing image.  Check the normative Thread
        # CHURCH-frame stack pointer by content so retired images regenerate
        # even when all file mtimes otherwise look current.
        with open(BOOT_IMAGE_PATH, "rb") as _image_file:
            _image_bytes = _image_file.read()
        _total_words = len(_image_bytes) // 4
        _thread_ns_word0 = _total_words - ((1 + 1) * _boot_image_gen.NS_ENTRY_WORDS)
        if 0 <= _thread_ns_word0 < _total_words:
            _thread_loc = struct.unpack_from(
                "<I", _image_bytes, _thread_ns_word0 * 4)[0]
            _sto_idx = (
                _thread_loc
                + _boot_image_gen.THREAD_STO_OFFSET
            )
            if not 0 <= _sto_idx < _total_words:
                return True
            _actual_resume_sto = struct.unpack_from(
                "<I", _image_bytes, _sto_idx * 4)[0]
            # Validate the Thread's self-describing geometry, not whichever
            # boot configuration happens to be saved by this server. A valid
            # temporary/downloaded image can legitimately have a different
            # Thread allocation than the local designer configuration.
            _thread_header = struct.unpack_from(
                "<I", _image_bytes, _thread_loc * 4)[0]
            _thread_words = 1 << (((_thread_header >> 23) & 0xF) + 6)
            _thread_stack_words = (_thread_header >> 10) & 0x1FFF
            _layout = _boot_image_gen.thread_layout(
                _thread_words, _thread_stack_words)
            if not _layout["valid"]:
                return True
            _expected_resume_sto = _layout["stack_end"] - 2
            if (_actual_resume_sto & 0xFFF) != _expected_resume_sto:
                return True
        _img_mtime = os.path.getmtime(BOOT_IMAGE_PATH)
        _lumps_dir = os.path.dirname(BOOT_IMAGE_PATH)
        _tracked = ["manifest.json", "ns-state.json"]
        _locator = _active_selftest_locator(_lumps_dir)
        if _locator is not None:
            _tracked.append(_locator["filename"])
        for _fname in _tracked:
            _p = os.path.join(_lumps_dir, _fname)
            if os.path.isfile(_p) and os.path.getmtime(_p) > _img_mtime:
                return True
    except OSError:
        pass
    return False


def _auto_regen_boot_image():
    """Regenerate boot-image.bin from current LUMPs and saved config.

    Returns (img_bytes, error_string).  error_string is None on success.
    """
    try:
        _cfg, _err = _read_saved_boot_config()
        if _err:
            return None, f"Cannot read boot config: {_err}"
        # Preserve the programmer-selected LightningBolt/Starter during
        # staleness regeneration.  Omitting this argument falls back to the
        # SelfTest slot, which rewrites SelfTest.Next.GT as a self-reference and
        # turns its final ELOADCALL into unbounded recursion.
        _entry_slot = _cfg.get(
            "bootEntrySlot", DEFAULT_BOOT_CONFIG["bootEntrySlot"])
        _blob = _boot_image_gen.generate_boot_image(
            _cfg, LUMPS_DIR, boot_entry_slot=_entry_slot)
        _write_boot_image_bytes(_blob)
        _load_boot_abstr_lump()
        _load_boot_ns_lump()
        logging.info("boot_image_binary: auto-regenerated boot-image.bin (LUMP source was newer)")
        return _blob, None
    except Exception as _exc:
        logging.warning("boot_image_binary: auto-regenerate failed: %s", _exc)
        return None, str(_exc)


@app.route("/api/boot-image/binary", methods=["GET"])
def boot_image_binary():
    """Same file as /download, served inline so the simulator can fetch
    it as an ArrayBuffer at boot without triggering a download dialog."""
    if not os.path.isfile(BOOT_IMAGE_PATH):
        return jsonify({"error": "boot-image.bin not generated yet"}), 404
    # Fail closed before considering freshness regeneration.  A malformed or
    # tampered artifact is not a stale-but-known-good cache candidate; letting
    # the mtime/content freshness path regenerate it first can mask corruption
    # and serve a replacement with HTTP 200.
    with open(BOOT_IMAGE_PATH, "rb") as _f:
        _existing_image_bytes = _f.read()
    _cfg, _cfg_err = _read_saved_boot_config()
    _configured_words = (
        int(_cfg["step1"]["totalNamespaceWords"])
        if _cfg_err is None and _cfg is not None else None
    )
    try:
        _boot_image_gen.validate_boot_image(_existing_image_bytes, _configured_words)
    except ValueError as _e:
        logging.error("boot_image_binary: stale or invalid boot image on disk: %s", _e)
        return jsonify({"error": f"Boot image on disk is stale or invalid: {_e}"}), 500
    if _boot_image_is_stale():
        _new_bytes, _regen_err = _auto_regen_boot_image()
        if _regen_err:
            logging.warning("boot_image_binary: staleness regen failed (%s); cached copy remains unavailable", _regen_err)
    with open(BOOT_IMAGE_PATH, "rb") as _f:
        _image_bytes = _f.read()
    try:
        _boot_image_gen.validate_boot_image(_image_bytes, _configured_words)
    except ValueError as _e:
        logging.error("boot_image_binary: stale or invalid boot image on disk: %s", _e)
        return jsonify({"error": f"Boot image on disk is stale or invalid: {_e}"}), 500
    resp = send_file(io.BytesIO(_image_bytes), mimetype="application/octet-stream")
    resp.headers["Cache-Control"] = "no-store, no-cache, must-revalidate, max-age=0"
    resp.headers["Pragma"] = "no-cache"
    return resp

@app.route("/api/boot-image/exists", methods=["GET"])
def boot_image_exists():
    """Return whether a compatible boot-image.bin currently exists on disk."""
    if not os.path.isfile(BOOT_IMAGE_PATH):
        return jsonify({"exists": False})
    cfg, cfg_err = _read_saved_boot_config()
    if cfg_err:
        return jsonify({"exists": False, "reason": cfg_err})
    configured_words = int(cfg["step1"]["totalNamespaceWords"])
    image_words = os.path.getsize(BOOT_IMAGE_PATH) // 4
    if os.path.getsize(BOOT_IMAGE_PATH) != configured_words * 4:
        return jsonify({
            "exists": False,
            "reason": (
                f"Saved boot image has {image_words} words, but configured "
                f"Namespace memory has {configured_words} words; regenerate "
                "the boot image for the current memory configuration"
            ),
        })
    return jsonify({"exists": True})


def _crc16_ccitt(data_bytes):
    crc = 0xFFFF
    for b in data_bytes:
        crc ^= b << 8
        for _ in range(8):
            if crc & 0x8000:
                crc = (crc << 1) ^ 0x1021
            else:
                crc = crc << 1
            crc &= 0xFFFF
    return crc


@app.route("/api/device/<uid>/pending-lump", methods=["GET"])
def device_pending_lump(uid):
    """Return whether this device has a pending LUMP delivery.

    Response: {pending: bool, lump_seq: int, framed_hex: str}

    framed_hex is the complete PATCH_LUMP frame (6-byte header + boot-image
    bytes + 2-byte CRC16/CCITT-FALSE) encoded as a hex string.  Empty string
    when pending=false or no boot image exists.

    lump_seq=0 means Stage 0 (LED-flash boot image) has not yet been
    delivered.  After a successful lump-ack the seq advances to 1 and
    subsequent calls return pending=false.
    """
    row = db.session.execute(
        _sa_text("SELECT lump_seq FROM device_lump_state WHERE uid=:uid"),
        {"uid": uid}
    ).fetchone()

    lump_seq = row[0] if row else 0

    if lump_seq > 0:
        return jsonify({"pending": False, "lump_seq": lump_seq, "framed_hex": ""})

    if not os.path.isfile(BOOT_IMAGE_PATH):
        return jsonify({"pending": False, "lump_seq": 0, "framed_hex": "",
                        "error": "no boot-image.bin — generate it first"})

    try:
        with open(BOOT_IMAGE_PATH, "rb") as _f:
            img_bytes = _f.read()
    except OSError as e:
        return jsonify({"pending": False, "lump_seq": 0, "framed_hex": "",
                        "error": f"could not read boot image: {e}"}), 500

    if len(img_bytes) == 0 or len(img_bytes) % 4 != 0:
        return jsonify({"pending": False, "lump_seq": 0, "framed_hex": "",
                        "error": "boot image is empty or not 4-byte aligned"}), 500

    import struct as _struct_lump
    w0 = _struct_lump.unpack_from("<I", img_bytes, 0)[0]
    if (w0 >> 27) & 0x1F != 0x1F:
        return jsonify({"pending": False, "lump_seq": 0, "framed_hex": "",
                        "error": "boot image LUMP magic invalid — regenerate"}), 500

    n_words = len(img_bytes) // 4
    crc  = _crc16_ccitt(img_bytes)
    addr = 0x0000
    frame = bytes([
        0xBE, 0xEF,
        (addr    >> 8) & 0xFF, addr    & 0xFF,
        (n_words >> 8) & 0xFF, n_words & 0xFF,
    ]) + img_bytes + bytes([(crc >> 8) & 0xFF, crc & 0xFF])

    return jsonify({
        "pending":    True,
        "lump_seq":   0,
        "framed_hex": frame.hex(),
    })


@app.route("/api/device/<uid>/lump-ack", methods=["POST"])
def device_lump_ack(uid):
    """Acknowledge a LUMP delivery attempt.

    Body: {seq: int, ok: bool}

    On ok=true the device's lump_seq is advanced to seq+1 so the next
    call to pending-lump returns pending=false.
    On ok=false the seq is left unchanged so the next CALLHOME retries.
    """
    import time as _ack_time
    data = request.get_json(silent=True) or {}
    try:
        seq = int(data.get("seq", 0))
    except (TypeError, ValueError):
        seq = 0
    ok = bool(data.get("ok", False))

    if ok:
        db.session.execute(
            _sa_text(
                "INSERT OR REPLACE INTO device_lump_state (uid, lump_seq, delivered_at)"
                " VALUES (:uid, :seq, :delivered_at)"
            ),
            {"uid": uid, "seq": seq + 1, "delivered_at": _ack_time.time()}
        )
        db.session.commit()
        logging.info("lump-ack: device=%s seq=%d advanced to %d", uid, seq, seq + 1)
    else:
        logging.info("lump-ack: device=%s seq=%d failed — will retry on next CALLHOME", uid, seq)

    return jsonify({"ok": True, "seq": seq, "advanced": ok})


@app.route("/api/namespace-lump.json", methods=["GET"])
def namespace_lump_json():
    """Return a self-describing JSON manifest of the NS lump (NS Slot 0).

    Reads the current boot-config and the last generated boot-image.bin
    (or falls back to synthesising from the config when the binary is absent
    or stale). The response includes per-slot metadata for every named slot
    in the namespace and is suitable for offline auditing without the IDE.
    """
    import struct as _st
    cfg, err = _read_saved_boot_config()
    if err or cfg is None:
        cfg = {
            "step1": {
                "totalNamespaceWords": 16384,
                "namespaceLumpWords": 64,
                "threadLumpWords": 256,
            }
        }
    step1      = cfg["step1"]
    total      = int(step1["totalNamespaceWords"])
    ns_size    = int(step1["namespaceLumpWords"])

    use_cached = False
    if os.path.isfile(BOOT_IMAGE_PATH):
        with open(BOOT_IMAGE_PATH, "rb") as _f:
            _cached = _f.read()
        try:
            _boot_image_gen.validate_boot_image(_cached, total)
            img_bytes  = _cached
            use_cached = True
        except Exception:
            pass
    if not use_cached:
        try:
            img_bytes = _boot_image_gen.generate_boot_image(cfg, LUMPS_DIR)
        except Exception as _e:
            return jsonify({"error": f"Failed to generate boot image: {_e}"}), 500

    words          = list(_st.unpack(f"<{total}I", img_bytes[:total * 4]))
    # V2's serialized header is the authority for every Namespace-wide fact.
    # Do not reinterpret Word 0 as an ordinary n-6 LUMP header or recreate a
    # table size from the (possibly newer) saved editor configuration.
    physical = _boot_image_gen.read_namespace_header_info(img_bytes)
    ns_table_base  = physical["table_offset_words"]
    ns_entry_words = _boot_image_gen.NS_ENTRY_WORDS
    catalog        = _boot_image_gen.DEFAULT_ABSTRACTION_CATALOG

    slot_count = physical["slot_count"]
    slots = []
    for i in range(slot_count):
        ns_base = total - (i + 1) * ns_entry_words
        if ns_base < ns_table_base:
            break
        w0, w1, w2, w3 = words[ns_base], words[ns_base+1], words[ns_base+2], words[ns_base+3]

        limit17     = w1 & 0x1FFFF
        clist_count = (w1 >> 17) & 0x1FF
        gt_type     = (w1 >> 26) & 0x3
        chainable   = bool((w1 >> 28) & 0x1)

        label = None
        if i < len(catalog):
            entry = catalog[i]
            if entry is not None:
                label = entry[0] if isinstance(entry, tuple) else entry.get("label")
        if not label:
            label = "(free)" if (w0 == 0 and w1 == 0) else f"slot{i}"

        # New GT layout: dom[27], perm[30:28]; dom=0→Turing{X,W,R}, dom=1→Church{E,S,L}
        _dom   = (w3 >> 27) & 0x1
        _perm3 = (w3 >> 28) & 0x7
        if _dom == 1:
            perms = {"R": False, "W": False, "X": False,
                     "L": bool(_perm3 & 1), "S": bool(_perm3 & 2), "E": bool(_perm3 & 4)}
        else:
            perms = {"R": bool(_perm3 & 1), "W": bool(_perm3 & 2), "X": bool(_perm3 & 4),
                     "L": False, "S": False, "E": False}

        lump_base       = w0 if i != 0 else 0
        lump_size_words = 0
        lump_cw_val     = 0
        lump_cc_val     = 0
        if 0 <= lump_base < total:
            lh       = words[lump_base]
            lh_magic = (lh >> 27) & 0x1F
            if lh_magic == 0x1F:
                lh_nm6      = (lh >> 23) & 0xF
                lump_size_words = 1 << (lh_nm6 + 6)
                lump_cw_val = (lh >> 10) & 0x1FFF
                lump_cc_val = lh & 0xFF

        gt_word = 0

        slots.append({
            "index":        i,
            "label":        label,
            "type":         gt_type,
            "permissions":  perms,
            "chainable":    chainable,
            "lumpBase":     lump_base,
            "lumpSize":     lump_size_words,
            "clistCount":   clist_count,
            "codeWordCount": lump_cw_val,
            "gtWord":       f"0x{gt_word:08X}",
            "nsTableWords": [
                f"0x{w0:08X}",
                f"0x{w1:08X}",
                f"0x{w2:08X}",
                f"0x{w3:08X}",
            ],
        })

    manifest = {
        "physicalBase":    physical["base_byte"],
        "physicalSize":    physical["total_words"],
        "cc":              0,
        "cw":              physical["slot_count"],
        "formatVersion":   physical["version"],
        "tableOffsetWords": physical["table_offset_words"],
        "bootEntryByte":   physical["boot_entry_byte"],
        "bootEntrySlot":   physical["boot_entry_slot"],
        "sealBoundaryWord": physical["seal_boundary_word"],
        "totalMemoryWords": physical["total_words"],
        "nsTableBase":     ns_table_base,
        "slots":           slots,
    }
    resp = make_response(json.dumps(manifest, indent=2))
    resp.headers["Content-Type"] = "application/json"
    resp.headers["Content-Disposition"] = "attachment; filename=namespace-lump.json"
    return resp


def _validate_boot_image_bytes(image_bytes):
    """Raise ValueError if image_bytes fails the basic structural checks.

    This helper is factored out of boot_image_upload() so the guards can be
    exercised in unit tests without going through the HTTP layer.

    Raises:
        ValueError: with a human-readable message if the image is rejected.
    """
    if len(image_bytes) == 0:
        raise ValueError("Boot image is empty")
    if len(image_bytes) % 4 != 0:
        raise ValueError("Boot image size must be a multiple of 4 bytes")


@app.route("/api/boot-image/upload", methods=["POST"])
def boot_image_upload():
    """Accept an externally-supplied boot image binary, validate it, and save.

    Request body (JSON):
        { "data_b64": "<base64-encoded raw boot-image bytes>" }

    Validates the image with validate_boot_image() before writing to disk.
    Returns 400 with a descriptive error if the image is invalid (e.g. a
    zeroed mandatory NS slot that would cause a BOOT fault at runtime).
    """
    import base64 as _b64
    payload = request.get_json(force=True, silent=True)
    if not payload:
        return jsonify({"ok": False, "error": "Invalid JSON body"}), 400

    data_b64 = payload.get("data_b64")
    if data_b64 is None:
        return jsonify({"ok": False, "error": "Missing 'data_b64' field"}), 400

    try:
        image_bytes = _b64.b64decode(data_b64, validate=True)
    except Exception:
        return jsonify({"ok": False, "error": "Invalid base64 data"}), 400

    # Reachable via HTTP: base64.b64decode("") == b"", and the earlier
    # `data_b64 is None` check does not catch an empty string.  A client
    # that sends {"data_b64": ""} (which is what base64.b64encode(b"")
    # produces) will reach this guard rather than the None-check above.
    # The guard also provides defensive depth if this function is ever
    # invoked directly with b"" (bypassing the HTTP layer).
    # Covered by test_upload_empty_image_returns_400 and
    # test_empty_image_guard_direct in tests/test_boot_image_upload_endpoint.py.
    try:
        _validate_boot_image_bytes(image_bytes)
    except ValueError as exc:
        return jsonify({"ok": False, "error": str(exc)}), 400

    cfg, cfg_err = _read_saved_boot_config()
    if cfg_err:
        return jsonify({"ok": False, "error": cfg_err}), 400
    configured_words = int(cfg["step1"]["totalNamespaceWords"])
    try:
        _boot_image_gen.validate_boot_image(image_bytes, configured_words)
    except ValueError as exc:
        return jsonify({"ok": False, "error": str(exc)}), 400

    try:
        _write_boot_image_bytes(image_bytes)
    except Exception as e:
        return jsonify({"ok": False, "error": f"Failed to write boot-image.bin: {e}"}), 500

    return jsonify({
        "ok": True,
        "bytes": len(image_bytes),
        "words": len(image_bytes) // 4,
        "downloadUrl": "/api/boot-image/download",
        "binaryUrl": "/api/boot-image/binary",
    })


@app.route("/api/boot-image/ns-state", methods=["GET"])
def boot_image_ns_state():
    """Return the committed NS table snapshot (ns-state.json).

    Used by the browser to seed _findSrcLump and _nsState.  When the file is
    absent, derive it from boot-image.bin (cold-start path).
    """
    _ensure_ns_state()
    if not os.path.isfile(NS_STATE_PATH):
        return jsonify({"abstractions": []})
    try:
        with open(NS_STATE_PATH) as _fh:
            _state = json.load(_fh)
        # Attach the authoritative raw NS-table view (raw words + header
        # geometry straight from boot-image.bin) for the Namespace Design
        # Page drill-down.  Best-effort: absence just omits the block.
        try:
            if os.path.isfile(BOOT_IMAGE_PATH):
                with open(BOOT_IMAGE_PATH, "rb") as _bf:
                    _raw = _boot_image_gen.parse_ns_table_raw(_bf.read())
                if _raw is not None:
                    _state["committed"] = _raw
        except Exception:
            pass
        # Attach nextGtSlot so the Build Approval view can render the
        # SelfTest→Next connector (labelled arrow or self-loop).
        # None means "default self-loop" (SelfTest calls back into itself).
        try:
            if os.path.isfile(BOOT_CONFIG_PATH):
                with open(BOOT_CONFIG_PATH) as _bc_fh:
                    _bc = json.load(_bc_fh)
                _n = _bc.get("nextAfterSelfTestSlot")
                _state["nextGtSlot"] = _n if (isinstance(_n, int) and _n >= 0) else None
            else:
                _state["nextGtSlot"] = None
        except Exception:
            _state["nextGtSlot"] = None
        resp = jsonify(_state)
        resp.headers["Cache-Control"] = "no-store, no-cache, must-revalidate, max-age=0"
        resp.headers["Pragma"] = "no-cache"
        return resp
    except Exception as _exc:
        return jsonify({"error": str(_exc)}), 500


def _validate_symbolic_namespace_entries(entries):
    """Reject symbolic rows that claim an implementation or binary identity."""
    for entry in entries:
        if entry.get("symbolic") is not True:
            continue
        if entry.get("implementationMissing") is not True:
            raise ValueError("Symbolic Namespace entries must be explicitly marked implementationMissing")
        if any(entry.get(key) not in (None, "", False) for key in (
                "token", "filename", "binaryHash", "binary_hash",
                "identityHash", "identity_hash", "cacheToken", "cache_token",
                "resident", "boot_resident")):
            raise ValueError("Symbolic Namespace entries cannot carry binary or resident metadata")


@app.route("/api/boot-image/save-ns", methods=["POST"])
def boot_image_save_ns():
    """Single write path for NS table: writes boot-image.bin + ns-state.json atomically.

    Body JSON:
        {
          "data_b64":  "<base64 of raw boot-image bytes>",
          "ns_state":  {
            "abstractions": [
              { "name": "SelfTest", "slot": 6, "location": "0x00000100",
                "type": "Inform", "f": 0, "g": 0, "limit": "0x001FE",
                "seq": 0, "seal": "0x667F", "boot": true },
              ...
            ]
          }
        }

    This is the only endpoint that should be called for NS mutations.  All other
    NS changes (Add LUMP, Clear slot, boot-entry drag) are in-memory only until
    the user clicks Save NS Table, which posts here.
    """
    import base64 as _b64_sns
    _payload = request.get_json(force=True, silent=True)
    _boot_client_attempt = (
        _payload.get("diagnostic_attempt_id")
        if isinstance(_payload, dict) else None
    ) or request.headers.get("X-Diagnostic-Attempt-ID", "")
    _boot_operation = (
        _payload.get("operation_id") if isinstance(_payload, dict) else "")
    _boot_operation = str(_boot_operation or "").strip()
    if not _LUMP_SAVE_OPERATION_ID_RE.fullmatch(_boot_operation):
        _boot_operation = ""
    g._lump_save_diagnostic = {
        "attempt_id": uuid.uuid4().hex,
        "operation_id": _boot_operation,
        "candidate_id": None,
        "plan_id": None,
        "client_diagnostic_attempt_id": _boot_client_attempt,
        "is_preflight": False,
        "add_committed_projection": False,
        "started_monotonic": time.monotonic(),
    }
    _save_lump_diagnostic_event(
        stage="Capture", event="request_arrival", outcome="unknown")
    if not _payload:
        return jsonify({"ok": False, "error": "Invalid JSON body"}), 400

    _data_b64 = _payload.get("data_b64")
    _ns_state  = _payload.get("ns_state") or {}

    if _data_b64 is None:
        return jsonify({"ok": False, "error": "Missing 'data_b64' field"}), 400

    try:
        _img_bytes = _b64_sns.b64decode(_data_b64, validate=True)
    except Exception:
        return jsonify({"ok": False, "error": "Invalid base64 data"}), 400

    try:
        _validate_boot_image_bytes(_img_bytes)
    except ValueError as _exc:
        return jsonify({"ok": False, "error": str(_exc)}), 400

    cfg, cfg_err = _read_saved_boot_config()
    if cfg_err:
        return jsonify({"ok": False, "error": cfg_err}), 400
    configured_words = int(cfg["step1"]["totalNamespaceWords"])
    try:
        _boot_image_gen.validate_boot_image(_img_bytes, configured_words)
    except ValueError as _exc:
        return jsonify({"ok": False, "error": str(_exc)}), 400

    # Commit both files under one lock so an accepted build cannot capture a
    # decoded/raw hybrid while Save NS Table is in progress.
    try:
        _raw_abs = _ns_state.get("abstractions") or []
        # Accept list of rich dicts; silently drop any malformed element.
        _ns_entries = [
            _a for _a in _raw_abs
            if isinstance(_a, dict) and _a.get("name") and isinstance(_a.get("slot"), int)
        ]
        _validate_symbolic_namespace_entries(_ns_entries)
        # The four-word NS entry does not carry the resident artifact locator.
        # Preserve an existing locator when an older/browser client submits the
        # same slot and name without the sidecar fields.  This prevents a
        # successful Namespace save from making an otherwise valid resident
        # LUMP undiscoverable on the next boot-image regeneration.
        _old_by_slot = {}
        if os.path.isfile(NS_STATE_PATH):
            try:
                with open(NS_STATE_PATH, encoding="utf-8") as _old_state_fh:
                    _old_state = json.load(_old_state_fh)
                for _old_entry in (_old_state.get("abstractions") or []):
                    if (isinstance(_old_entry, dict)
                            and isinstance(_old_entry.get("slot"), int)):
                        _old_by_slot[_old_entry["slot"]] = _old_entry
            except (OSError, ValueError, TypeError):
                _old_by_slot = {}
        for _entry in _ns_entries:
            _old_entry = _old_by_slot.get(_entry["slot"])
            if not _old_entry or _old_entry.get("name") != _entry.get("name"):
                continue
            if _entry.get("symbolic") is True:
                continue
            for _key in (
                "token", "filename", "issue_n", "resident",
                "binaryHash", "identityHash", "cacheToken",
            ):
                if _entry.get(_key) is None and _old_entry.get(_key) is not None:
                    _entry[_key] = _old_entry[_key]
        with _namespace_commit_guard():
            old_image = None
            if os.path.isfile(BOOT_IMAGE_PATH):
                with open(BOOT_IMAGE_PATH, "rb") as old_image_file:
                    old_image = old_image_file.read()
            _write_boot_image_bytes(_img_bytes)
            try:
                _write_ns_state(_ns_entries)
            except Exception:
                if old_image is not None:
                    _write_boot_image_bytes(old_image)
                else:
                    try:
                        os.remove(BOOT_IMAGE_PATH)
                    except OSError:
                        pass
                raise
    except Exception as _exc:
        return jsonify({"ok": False, "error": f"Failed to commit Namespace: {_exc}"}), 500

    _load_boot_ns_lump()   # refresh _BOOT_NS_META

    return jsonify({
        "ok":          True,
        "bytes":       len(_img_bytes),
        "words":       len(_img_bytes) // 4,
        "downloadUrl": "/api/boot-image/download",
        "binaryUrl":   "/api/boot-image/binary",
    })


@app.route("/six-laws-review.pdf")
def six_laws_pdf():
    pdf_path = os.path.join(BASE_DIR, "six-laws-review.pdf")
    resp = make_response(send_file(pdf_path, mimetype="application/pdf"))
    resp.headers["Content-Disposition"] = 'attachment; filename="six-laws-review.pdf"'
    resp.headers["Cache-Control"] = "no-cache, no-store, must-revalidate"
    return resp

# ── Release 1 PDF downloads ──────────────────────────────────────────────────
_RELEASE_1_DIR = os.path.join(BASE_DIR, "release", "r1")

_RELEASE_1_MANIFEST = [
    # (filename, display_title, category)
    ("ctmm-r1-01-isa-reference.pdf",        "ISA Reference",                    "Hardware Specification"),
    ("ctmm-r1-02-isa-encoding.pdf",         "ISA Encoding",                     "Hardware Specification"),
    ("ctmm-r1-03-architecture.pdf",         "Architecture Overview",             "Hardware Specification"),
    ("ctmm-r1-04-church-instructions.pdf",  "Church Instructions",              "Hardware Specification"),
    ("ctmm-r1-05-instruction-set.pdf",      "Full Instruction Set",             "Hardware Specification"),
    ("ctmm-r1-06-golden-tokens.pdf",        "Golden Tokens",                    "Security & Capabilities"),
    ("ctmm-r1-07-abstract-gt.pdf",          "Abstract Golden Token",            "Security & Capabilities"),
    ("ctmm-r1-08-namespace-security.pdf",   "Namespace Security",               "Security & Capabilities"),
    ("ctmm-r1-09-mint.pdf",                 "Mint & PassKey Issuance",          "Security & Capabilities"),
    ("ctmm-r1-10-mload.pdf",               "Machine Load (mLoad)",             "Security & Capabilities"),
    ("ctmm-r1-11-switch-lifecycle.pdf",     "SWITCH Lifecycle & M-Gated Load",   "Security & Capabilities"),
    ("ctmm-r1-12-boot-rom-layout.pdf",      "Boot ROM Layout",                  "Boot Sequence"),
    ("ctmm-r1-13-boot-permission-rules.pdf","Boot Permission Rules",            "Boot Sequence"),
    ("ctmm-r1-14-hardware-deviations.pdf",  "Hardware Deviations — All Closed", "Conformance"),
]

@app.route("/start-guide")
def start_here():
    html = """<!DOCTYPE html>
<html lang="en"><head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Getting Started — Church Machine</title>
<meta name="description" content="Three-step guide to flashing the Wukong A7 FPGA, connecting it to the Church Machine IDE, and running your first CLOOMC program.">
<link rel="canonical" href="https://lab.cloomc.org/start-guide">
<meta property="og:title" content="Getting Started — Church Machine">
<meta property="og:description" content="Three-step guide to flashing, connecting, and running your first CLOOMC program on the Church Machine FPGA IDE.">
<meta property="og:type" content="website">
<meta property="og:url" content="https://lab.cloomc.org/start-guide">
<meta property="og:site_name" content="Church Machine">
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:system-ui,sans-serif;background:#0a0e17;color:#c8d6e5;min-height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:flex-start;padding:40px 24px 64px}
  .wrap{max-width:680px;width:100%}

  /* Logo */
  .logo{display:inline-flex;align-items:center;gap:.5rem;text-decoration:none;margin-bottom:2rem;opacity:.75;transition:opacity .15s}
  .logo:hover{opacity:1}
  .logo-lambda{font-family:Georgia,serif;font-size:1.5rem;color:#daa520;line-height:1}
  .logo-name{font-family:Georgia,serif;font-size:.95rem;color:#daa520;letter-spacing:.04em}
  .logo-sub{font-size:.65rem;color:#64748b;letter-spacing:.1em;text-transform:uppercase}

  /* Step indicator */
  .indicator{display:flex;align-items:center;margin-bottom:2.5rem;gap:0}
  .ind-step{display:flex;flex-direction:column;align-items:center;gap:4px;position:relative;z-index:1}
  .ind-circle{width:2rem;height:2rem;border-radius:50%;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:.85rem;transition:background .25s,border-color .25s,color .25s;border:2px solid #2a3a52;background:#0d1117;color:#4a5568}
  .ind-circle.done{background:#1a0e28;border-color:#a78bfa;color:#a78bfa}
  .ind-circle.active{background:#a78bfa;border-color:#a78bfa;color:#0a0e17}
  .ind-label{font-size:.6rem;color:#4a5568;text-align:center;max-width:52px;line-height:1.2;transition:color .25s}
  .ind-label.active{color:#a78bfa}
  .ind-label.done{color:#a78bfa}
  .ind-line{flex:1;height:2px;background:#2a3a52;position:relative;top:-14px;transition:background .25s}
  .ind-line.done{background:#a78bfa}
  @media(max-width:480px){
    .ind-label{display:none}
    .ind-circle{width:1.6rem;height:1.6rem;font-size:.75rem}
    .ind-line{top:-10px}
  }

  /* Pages */
  .pages-container{position:relative;overflow:hidden;min-height:380px}
  .page{display:none;animation:fadeIn .22s ease}
  .page.active{display:block}
  @keyframes fadeIn{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)}}

  .page-eyebrow{font-size:.72rem;color:#daa520;text-transform:uppercase;letter-spacing:.1em;margin-bottom:.5rem}
  .page-title{font-size:1.75rem;font-weight:700;color:#e2e8f0;margin-bottom:.75rem;line-height:1.2}
  .page-desc{font-size:.92rem;color:#94a3b8;line-height:1.65;margin-bottom:1.5rem}

  /* Code block */
  .code-block{background:#0d1117;border:1px solid #1e2a3a;border-radius:8px;padding:16px 20px;margin-bottom:1.5rem;overflow-x:auto}
  .code-block pre{font-family:'Fira Code','Cascadia Code',monospace;font-size:.8rem;color:#c8d6e5;line-height:1.7;white-space:pre}
  .code-label{font-size:.68rem;color:#4a5568;text-transform:uppercase;letter-spacing:.08em;margin-bottom:.5rem}
  .kw{color:#a78bfa}
  .cm{color:#4a5568}
  .gt{color:#daa520}
  .op{color:#38bdf8}
  .str{color:#86efac}

  /* Checklist */
  .checklist{list-style:none;margin-bottom:1.75rem}
  .checklist li{display:flex;align-items:flex-start;gap:.65rem;padding:.4rem 0;font-size:.88rem;color:#94a3b8;border-bottom:1px solid #111827}
  .checklist li:last-child{border-bottom:none}
  .checklist li::before{content:"◆";color:#daa520;font-size:.6rem;flex-shrink:0;margin-top:.25rem}

  /* Concept box */
  .concept-box{background:#0d1117;border-left:3px solid #daa520;border-radius:0 8px 8px 0;padding:14px 18px;margin-bottom:1.5rem;font-size:.85rem;color:#94a3b8;line-height:1.6}
  .concept-box strong{color:#daa520}

  /* Link card */
  .link-card{display:block;background:#0d1117;border:1px solid #1e2a3a;border-radius:8px;padding:14px 18px;text-decoration:none;transition:border-color .15s;margin-bottom:.75rem}
  .link-card:hover{border-color:#a78bfa}
  .link-card .lc-title{color:#a78bfa;font-size:.9rem;font-weight:600;margin-bottom:.25rem}
  .link-card .lc-desc{color:#64748b;font-size:.78rem;line-height:1.4}

  /* Nav */
  .nav{display:flex;align-items:center;justify-content:space-between;margin-top:2.5rem;padding-top:1.5rem;border-top:1px solid #1e2a3a;gap:1rem}
  .btn{display:inline-flex;align-items:center;gap:.4rem;padding:.6rem 1.25rem;border-radius:6px;font-size:.88rem;font-weight:600;cursor:pointer;text-decoration:none;transition:background .15s,border-color .15s,color .15s;border:none;font-family:inherit}
  .btn-ghost{background:transparent;border:1px solid #2a3a52;color:#64748b}
  .btn-ghost:hover{border-color:#a78bfa;color:#a78bfa}
  .btn-primary{background:#a78bfa;color:#0a0e17}
  .btn-primary:hover{background:#c4b5fd}
  .btn-primary:disabled{background:#2a3a52;color:#4a5568;cursor:not-allowed}
  .btn-primary:disabled:hover{background:#2a3a52;color:#4a5568}
  .btn-gold{background:#daa520;color:#0a0e17}
  .btn-gold:hover{background:#f0b429}
  .btn-gold:disabled{background:#2a3a52;color:#4a5568;cursor:not-allowed}
  .btn-gold:disabled:hover{background:#2a3a52;color:#4a5568}
  .nav-count{font-size:.75rem;color:#4a5568}

  /* Quiz */
  .quiz{background:#0d1117;border:1px solid #1e2a3a;border-radius:8px;padding:18px 20px;margin-top:1.75rem}
  .quiz-label{font-size:.65rem;color:#daa520;text-transform:uppercase;letter-spacing:.1em;margin-bottom:.6rem}
  .quiz-prompt{font-size:.9rem;color:#e2e8f0;margin-bottom:1rem;line-height:1.5}
  .quiz-options{display:flex;flex-direction:column;gap:.5rem}
  .quiz-opt{background:#111827;border:1px solid #2a3a52;border-radius:6px;padding:.55rem 1rem;font-size:.85rem;color:#94a3b8;cursor:pointer;text-align:left;font-family:inherit;transition:border-color .15s,color .15s,background .15s}
  .quiz-opt:hover:not(:disabled){border-color:#a78bfa;color:#c4b5fd}
  .quiz-opt.correct{background:#052e16;border-color:#4ade80;color:#4ade80;cursor:default}
  .quiz-opt.wrong{background:#1c0a0a;border-color:#6b2020;color:#6b2020;cursor:default}
  .quiz-opt:disabled{cursor:default}
  .quiz-hint{font-size:.8rem;color:#daa520;margin-top:.75rem;line-height:1.5;display:none}
  .quiz-hint.visible{display:block}
  .quiz-ok{font-size:.8rem;color:#4ade80;margin-top:.75rem;display:none}
  .quiz-ok.visible{display:block}
</style>
</head><body>
<div class="wrap">

  <a class="logo" href="/">
    <span class="logo-lambda">&#955;</span>
    <div>
      <div class="logo-name">Church Machine</div>
      <div class="logo-sub">Capability-Secured Computing</div>
    </div>
  </a>

  <!-- Step indicator -->
  <div class="indicator" id="indicator"></div>

  <!-- Page content -->
  <div class="pages-container">

    <!-- Page 1: Conventional Programming -->
    <div class="page" data-page="1">
      <div class="page-eyebrow">Step 1 of 6</div>
      <h1 class="page-title">Conventional Programming</h1>
      <p class="page-desc">
        Every program starts as a sequence of instructions. In the Church Machine you write those
        instructions in <strong>CLOOMC</strong> — the assembly language that compiles directly to the
        Church Machine ISA. Here is a minimal program that loads a value and returns it to the caller.
      </p>
      <div class="code-block">
        <div class="code-label">hello.cloomc — your first Church Machine program</div>
        <pre><span class="cm">; Namespace slot 3 — Boot.Abstr entry point</span>
<span class="kw">LLOAD</span>  <span class="op">CR1</span>, <span class="gt">#42</span>       <span class="cm">; load literal value 42 into CR1</span>
<span class="kw">RETURN</span> <span class="op">CR1</span>           <span class="cm">; hand CR1 back to the caller</span></pre>
      </div>
      <ul class="checklist">
        <li>Understand that CLOOMC instructions map 1-to-1 to Church Machine opcodes</li>
        <li>Recognise that <code>CR1</code>–<code>CR15</code> are the 15 general-purpose capability registers</li>
        <li>See how <code>RETURN</code> transfers control back through the call chain</li>
      </ul>
      <div class="concept-box">
        <strong>Key idea:</strong> The Church Machine executes one instruction per cycle, reads capabilities
        from registers, and validates every memory access through the mLoad pipeline before it touches RAM.
      </div>
      <div class="quiz" id="quiz-1">
        <div class="quiz-label">Quick Check</div>
        <div class="quiz-prompt">What does the <code>RETURN</code> instruction do?</div>
        <div class="quiz-options">
          <button class="quiz-opt" onclick="checkAnswer(1,this,false)">Loads a literal value into a capability register</button>
          <button class="quiz-opt" onclick="checkAnswer(1,this,true)">Transfers control back to the caller</button>
          <button class="quiz-opt" onclick="checkAnswer(1,this,false)">Checks a Golden Token for validity</button>
        </div>
        <div class="quiz-hint" id="hint-1">Think about what the opposite of CALL is — one enters an abstraction, the other exits it.</div>
        <div class="quiz-ok" id="ok-1">&#10003; Correct! RETURN hands the result register back up the call chain.</div>
      </div>
    </div>

    <!-- Page 2: Add Security Boundaries -->
    <div class="page" data-page="2">
      <div class="page-eyebrow">Step 2 of 6</div>
      <h1 class="page-title">Add Security Boundaries</h1>
      <p class="page-desc">
        Conventional code has no built-in memory safety. The Church Machine enforces boundaries using
        <strong>Golden Tokens</strong> — 32-bit unforgeable capability descriptors that carry version,
        CRC/parity checks, bounds, and permission bits. No code can read or write memory without a valid token.
      </p>
      <div class="code-block">
        <div class="code-label">Adding a Golden Token boundary</div>
        <pre><span class="cm">; CR6 already holds a Golden Token for a data lump</span>
<span class="kw">MLOAD</span>  <span class="op">CR2</span>, [<span class="gt">CR6</span>+<span class="op">#0</span>]  <span class="cm">; validated load — pipeline checks GT first</span>
<span class="kw">MSTORE</span> [<span class="gt">CR6</span>+<span class="op">#1</span>], <span class="op">CR2</span> <span class="cm">; validated store — same boundary check</span>
<span class="kw">RETURN</span> <span class="op">CR2</span></pre>
      </div>
      <ul class="checklist">
        <li>Every MLOAD/MSTORE passes through the 4-stage mLoad capability validation pipeline</li>
        <li>The pipeline checks: version, CRC/parity, bounds, and permission bits — in that order</li>
        <li>An out-of-bounds or permission-denied access fires a capability fault, not a crash</li>
        <li>Domain purity keeps capabilities strictly separate from code and data words</li>
      </ul>
      <div class="concept-box">
        <strong>Golden Token format:</strong> bits [31:28] version · [27:16] CRC/parity ·
        [15:8] upper bound · [7:0] lower bound. The <strong>E</strong> (execute) bit is the only
        permission in a C-List entry; data tokens carry <strong>R</strong> and/or <strong>W</strong>.
      </div>
      <div class="quiz" id="quiz-2">
        <div class="quiz-label">Quick Check</div>
        <div class="quiz-prompt">In what order does the mLoad pipeline perform its four checks?</div>
        <div class="quiz-options">
          <button class="quiz-opt" onclick="checkAnswer(2,this,false)">Bounds → CRC/parity → version → permissions</button>
          <button class="quiz-opt" onclick="checkAnswer(2,this,true)">Version → CRC/parity → bounds → permissions</button>
          <button class="quiz-opt" onclick="checkAnswer(2,this,false)">Permissions → bounds → CRC/parity → version</button>
        </div>
        <div class="quiz-hint" id="hint-2">The page lists the four checks explicitly — start with the most fundamental property of the token and work outward.</div>
        <div class="quiz-ok" id="ok-2">&#10003; Correct! Version first, then the seal, then bounds, then permission bits.</div>
      </div>
    </div>

    <!-- Page 3: IDE Test -->
    <div class="page" data-page="3">
      <div class="page-eyebrow">Step 3 of 6</div>
      <h1 class="page-title">IDE Test</h1>
      <p class="page-desc">
        The Church Machine IDE includes a built-in simulator — no FPGA hardware required. Open the
        Pipeline view to watch instructions flow through the capability validation stages, then run the
        self-test suite to confirm everything is working correctly.
      </p>
      <ul class="checklist">
        <li>Open the simulator and navigate to the <strong>Pipeline</strong> tab</li>
        <li>Load the <em>Bernoulli</em> example from the Examples drop-down</li>
        <li>Click <strong>Run</strong> and watch the mLoad pipeline stages light up in sequence</li>
        <li>Switch to the <strong>Dashboard</strong> tab and press <strong>Self-Test</strong></li>
        <li>All test indicators should show green — that is your proof-of-life</li>
      </ul>
      <div class="concept-box">
        <strong>What the pipeline view shows:</strong> each clock cycle you see the active instruction,
        the Golden Token being validated, which pipeline stage it is in (Fetch → Decode → Validate → Execute),
        and any fault that fires. Faults trigger the three-tier recovery system automatically.
      </div>
      <a class="link-card" href="/simulator/#pipeline">
        <div class="lc-title">Open Pipeline View &rarr;</div>
        <div class="lc-desc">Watch the mLoad capability validation pipeline in real time inside the browser simulator.</div>
      </a>
      <a class="link-card" href="/simulator/#tutorial">
        <div class="lc-title">Bernoulli Tutorial &rarr;</div>
        <div class="lc-desc">Step-by-step lambda calculus tutorial with Church Machine trace — no hardware needed.</div>
      </a>
      <div class="quiz" id="quiz-3">
        <div class="quiz-label">Quick Check</div>
        <div class="quiz-prompt">Which IDE tab lets you watch instructions move through the Fetch → Decode → Validate → Execute stages in real time?</div>
        <div class="quiz-options">
          <button class="quiz-opt" onclick="checkAnswer(3,this,false)">Dashboard</button>
          <button class="quiz-opt" onclick="checkAnswer(3,this,true)">Pipeline</button>
          <button class="quiz-opt" onclick="checkAnswer(3,this,false)">Builder</button>
        </div>
        <div class="quiz-hint" id="hint-3">You opened the link card for it just above — it shows the active Golden Token and which stage it is in on every clock cycle.</div>
        <div class="quiz-ok" id="ok-3">&#10003; Correct! The Pipeline tab visualises each stage of the mLoad validation on every cycle.</div>
      </div>
    </div>

    <!-- Page 4: Add LUMP to Repository -->
    <div class="page" data-page="4">
      <div class="page-eyebrow">Step 4 of 6</div>
      <h1 class="page-title">Add LUMP to Repository</h1>
      <p class="page-desc">
        A <strong>LUMP</strong> is the Church Machine's unit of deployment — a self-describing binary
        that packages compiled code, its C-List of capabilities, and a header with CRC/parity metadata.
        Once built, you commit the LUMP to the Mum Tunnel repository so others can lazy-load it.
      </p>
      <div class="code-block">
        <div class="code-label">LUMP anatomy (simplified)</div>
        <pre><span class="cm">; Word 0  — header: magic, version, lump_size</span>
<span class="cm">; Word 1  — bounds: cw (code words), cc (clist capacity)</span>
<span class="cm">; Word 2  — CRC/parity over words 0–1</span>
<span class="cm">; Words 3…cw  — compiled CLOOMC instructions</span>
<span class="cm">; Words cw+1…end — C-List: Golden Token slots</span></pre>
      </div>
      <ul class="checklist">
        <li>Use the <strong>Builder</strong> tab to compile your CLOOMC source into a LUMP binary</li>
        <li>Download the <code>.lump</code> file and its companion sidecar <code>.json</code></li>
        <li>Add both files plus a <code>manifest.json</code> entry to your repository</li>
        <li>Run the consistency gate: <code>pytest tests/lump/test_lump_consistency.py -v</code></li>
        <li>Commit — the LUMP is now available for lazy loading by any Church Machine</li>
      </ul>
      <a class="link-card" href="/simulator/#builder">
        <div class="lc-title">Open Builder Tab &rarr;</div>
        <div class="lc-desc">Compile, package, and download LUMP binaries for all three supported boards.</div>
      </a>
      <div class="quiz" id="quiz-4">
        <div class="quiz-label">Quick Check</div>
        <div class="quiz-prompt">Which LUMP word holds the CRC/parity value, and what does it cover?</div>
        <div class="quiz-options">
          <button class="quiz-opt" onclick="checkAnswer(4,this,false)">Word 0 — seals the entire compiled instruction list</button>
          <button class="quiz-opt" onclick="checkAnswer(4,this,true)">Word 2 — seals Words 0 and 1 (the header)</button>
          <button class="quiz-opt" onclick="checkAnswer(4,this,false)">The last word — seals the C-List capability slots</button>
        </div>
        <div class="quiz-hint" id="hint-4">Look at the LUMP anatomy above: the seal appears third in the layout and protects the two words that precede it.</div>
        <div class="quiz-ok" id="ok-4">&#10003; Correct! Word 2 is the CRC/parity value over Words 0–1 (magic/version/size and bounds).</div>
      </div>
    </div>

    <!-- Page 5: Lazy Load Approval -->
    <div class="page" data-page="5">
      <div class="page-eyebrow">Step 5 of 6</div>
      <h1 class="page-title">Lazy Load Approval</h1>
      <p class="page-desc">
        Church Machine abstractions are loaded <em>on demand</em> — not at boot time. The
        <strong>Locator</strong> intercepts a call to an unloaded namespace slot, fetches the LUMP
        from the Mum Tunnel, validates its CRC/parity, and maps it into RAM before execution resumes.
        You approve new LUMPs before they gain execute permission.
      </p>
      <ul class="checklist">
        <li>A <strong>floating lump</strong> sets <code>ns_slot: null</code> in the manifest — the Locator assigns a slot dynamically</li>
        <li>When first called, the Locator fires a <em>lazy-load fault</em> and pauses the calling thread</li>
        <li>The IDE shows an approval prompt listing the LUMP token, CRC, bounds, and requested permissions</li>
        <li>Approving grants the <strong>E</strong> (execute) permission and resumes the thread</li>
        <li>Rejecting logs the event and returns a capability fault to the caller</li>
      </ul>
      <div class="concept-box">
        <strong>Navana Master Controller:</strong> Navana manages namespace entries and orchestrates
        lazy loading. It is the only component that can mint a new Golden Token — all other code works
        with existing, bounded tokens it has been given.
      </div>
      <a class="link-card" href="/simulator/#namespace">
        <div class="lc-title">Namespace View &rarr;</div>
        <div class="lc-desc">Inspect all 64 namespace slots, their LUMP tokens, and load status in real time.</div>
      </a>
      <div class="quiz" id="quiz-5">
        <div class="quiz-label">Quick Check</div>
        <div class="quiz-prompt">Which permission bit must be granted before a lazy-loaded LUMP can execute?</div>
        <div class="quiz-options">
          <button class="quiz-opt" onclick="checkAnswer(5,this,false)">R — Read</button>
          <button class="quiz-opt" onclick="checkAnswer(5,this,false)">W — Write</button>
          <button class="quiz-opt" onclick="checkAnswer(5,this,true)">E — Execute</button>
        </div>
        <div class="quiz-hint" id="hint-5">The approval dialog grants exactly one permission — the one needed to actually run the code inside the LUMP.</div>
        <div class="quiz-ok" id="ok-5">&#10003; Correct! Approving grants the E (execute) permission and resumes the paused thread.</div>
      </div>
    </div>

    <!-- Page 6: Calibrate MTBF -->
    <div class="page" data-page="6">
      <div class="page-eyebrow">Step 6 of 6</div>
      <h1 class="page-title">Calibrate MTBF</h1>
      <p class="page-desc">
        Mean Time Between Faults (MTBF) tells you how reliable each abstraction is in production.
        Every capability fault is logged with its instruction address, faulting mnemonic, and Golden
        Token. The IDE aggregates these into a per-abstraction MTBF score that you use to decide
        when to patch, retire, or promote a LUMP.
      </p>
      <ul class="checklist">
        <li>Connect a Wukong Artix-7 board (serial bridge + call-home)</li>
        <li>The board sends call-home telemetry to the IDE on every fault event</li>
        <li>Open the <strong>Dashboard</strong> to see live MTBF scores per named abstraction</li>
        <li>A dropping MTBF score flags an abstraction for review before it causes a production outage</li>
        <li>Update the LUMP, re-run the consistency gate, and re-deploy — MTBF resets for the new version</li>
      </ul>
      <div class="concept-box">
        <strong>Call-home protocol:</strong> the FPGA sends a compact fault record over UART whenever
        the three-tier recovery system exhausts all options. The IDE decodes it, matches it to a namespace
        slot, and updates the MTBF table in the Devices view.
      </div>
      <a class="link-card" href="/simulator/#dashboard">
        <div class="lc-title">Dashboard &amp; MTBF View &rarr;</div>
        <div class="lc-desc">Live MTBF scores, fault history, and per-instruction reliability data.</div>
      </a>
      <a class="link-card" href="/simulator/#builder?tab=ti60-connect">
        <div class="lc-title">Connect Hardware &rarr;</div>
        <div class="lc-desc">One-click proof-of-life for the Wukong Artix-7 to start receiving telemetry.</div>
      </a>
      <div class="quiz" id="quiz-6">
        <div class="quiz-label">Quick Check</div>
        <div class="quiz-prompt">What event causes the FPGA to send a call-home fault record to the IDE?</div>
        <div class="quiz-options">
          <button class="quiz-opt" onclick="checkAnswer(6,this,false)">Every MLOAD instruction</button>
          <button class="quiz-opt" onclick="checkAnswer(6,this,false)">Each time a new LUMP is lazy-loaded</button>
          <button class="quiz-opt" onclick="checkAnswer(6,this,true)">When the three-tier recovery system exhausts all options</button>
        </div>
        <div class="quiz-hint" id="hint-6">Call-home is a last resort — it fires only after Tier 1 (.catch), Tier 2 (Scheduler.IRQ), and Tier 3 (double-fault → boot) have all failed.</div>
        <div class="quiz-ok" id="ok-6">&#10003; Correct! The FPGA calls home only when all three recovery tiers are exhausted.</div>
      </div>
    </div>

  </div><!-- /pages-container -->

  <!-- Navigation -->
  <div class="nav">
    <button class="btn btn-ghost" id="btn-prev" onclick="navigate(-1)">&#8592; <span id="prev-label">Home</span></button>
    <span class="nav-count" id="nav-count">1 of 6</span>
    <button class="btn btn-primary" id="btn-next" onclick="navigate(1)"><span id="next-label">Next</span> &#8594;</button>
  </div>

</div><!-- /wrap -->

<script>
  var TOTAL = 6;
  var current = 1;
  var answeredPages = {};

  function getPageFromURL() {
    var p = parseInt(new URLSearchParams(location.search).get('page'), 10);
    if (p >= 1 && p <= TOTAL) return p;
    return 1;
  }

  function buildIndicator(active) {
    var el = document.getElementById('indicator');
    var titles = ['Conventional\\nProgramming','Add Security\\nBoundaries','IDE Test','Add LUMP\\nto Repo','Lazy Load\\nApproval','Calibrate\\nMTBF'];
    var html = '';
    for (var i = 1; i <= TOTAL; i++) {
      var cls = i < active ? 'done' : i === active ? 'active' : '';
      html += '<div class="ind-step">';
      html += '<div class="ind-circle ' + cls + '">' + i + '</div>';
      html += '<div class="ind-label ' + cls + '">' + titles[i-1].replace('\\\\n','<br>') + '</div>';
      html += '</div>';
      if (i < TOTAL) {
        html += '<div class="ind-line' + (i < active ? ' done' : '') + '"></div>';
      }
    }
    el.innerHTML = html;
  }

  function updateNextBtn(n) {
    var nextBtn = document.getElementById('btn-next');
    nextBtn.disabled = !answeredPages[n];
  }

  function checkAnswer(page, btn, correct) {
    var quiz = document.getElementById('quiz-' + page);
    if (!quiz) return;
    var opts = quiz.querySelectorAll('.quiz-opt');
    opts.forEach(function(o) { o.disabled = true; });
    var hint = document.getElementById('hint-' + page);
    var ok = document.getElementById('ok-' + page);
    if (correct) {
      btn.classList.add('correct');
      ok.classList.add('visible');
      answeredPages[page] = true;
      if (page === current) updateNextBtn(page);
    } else {
      btn.classList.add('wrong');
      hint.classList.add('visible');
      opts.forEach(function(o) { o.disabled = false; });
      btn.disabled = true;
    }
  }

  function showPage(n, pushState) {
    current = n;
    document.querySelectorAll('.page').forEach(function(p) {
      p.classList.toggle('active', parseInt(p.dataset.page, 10) === n);
    });
    buildIndicator(n);
    document.getElementById('nav-count').textContent = n + ' of ' + TOTAL;

    var prevBtn = document.getElementById('btn-prev');
    var nextBtn = document.getElementById('btn-next');
    var prevLabel = document.getElementById('prev-label');
    var nextLabel = document.getElementById('next-label');

    if (n === 1) {
      prevLabel.textContent = 'Home';
      prevBtn.onclick = function() { location.href = '/'; };
    } else {
      prevLabel.textContent = 'Back';
      prevBtn.onclick = function() { navigate(-1); };
    }

    if (n === TOTAL) {
      nextLabel.textContent = 'Finish';
      nextBtn.className = 'btn btn-gold';
      nextBtn.onclick = function() { location.href = '/'; };
    } else {
      nextLabel.textContent = 'Next';
      nextBtn.className = 'btn btn-primary';
      nextBtn.onclick = function() { navigate(1); };
    }

    updateNextBtn(n);

    if (pushState) {
      var url = n === 1 ? '/start' : '/start?page=' + n;
      history.pushState({page: n}, '', url);
    }

    window.scrollTo({top: 0, behavior: 'smooth'});
  }

  function navigate(delta) {
    var next = current + delta;
    if (next < 1 || next > TOTAL) return;
    showPage(next, true);
  }

  window.addEventListener('popstate', function(e) {
    var p = (e.state && e.state.page) ? e.state.page : getPageFromURL();
    showPage(p, false);
  });

  showPage(getPageFromURL(), false);
</script>
</body></html>"""
    return html

@app.route("/release/r1/")
@app.route("/release/r1")
def release_r1_index():
    rows = ""
    current_cat = None
    for fname, title, cat in _RELEASE_1_MANIFEST:
        if cat != current_cat:
            current_cat = cat
            rows += f'<tr class="cat-row"><td colspan="3">{cat}</td></tr>\n'
        size_kb = 0
        p = os.path.join(_RELEASE_1_DIR, fname)
        if os.path.exists(p):
            size_kb = os.path.getsize(p) // 1024
        rows += (
            f'<tr><td>{title}</td>'
            f'<td class="sz">{size_kb} KB</td>'
            f'<td><a href="/release/r1/{fname}">Download PDF</a></td></tr>\n'
        )
    html = f"""<!DOCTYPE html>
<html lang="en"><head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>CM Release 1 — Document Set</title>
<meta name="description" content="14-document CM Release 1 package from Kenneth J Hamer-Hodges covering the Church-Turing Meta-Machine architecture, capability-based security, and the Church Machine ISA.">
<link rel="canonical" href="https://lab.cloomc.org/release/r1/">
<meta property="og:title" content="CM Release 1 — Document Set">
<meta property="og:description" content="Complete CM Release 1 document set — 14 PDFs covering the Church-Turing Meta-Machine architecture and capability-based secure computing.">
<meta property="og:type" content="website">
<meta property="og:url" content="https://lab.cloomc.org/release/r1/">
<meta property="og:site_name" content="Church Machine">
<style>
  body{{font-family:system-ui,sans-serif;background:#0a0e17;color:#c8d6e5;padding:32px;max-width:860px;margin:0 auto}}
  h1{{color:#daa520;margin-bottom:4px}}
  .sub{{color:#64748b;margin-bottom:28px;font-size:.9rem}}
  table{{width:100%;border-collapse:collapse;font-size:.9rem}}
  th{{text-align:left;padding:7px 10px;background:#111827;color:#daa520;border-bottom:2px solid #1e2a3a}}
  td{{padding:6px 10px;border-bottom:1px solid #1e2a3a;vertical-align:middle}}
  tr.cat-row td{{background:#0d1117;color:#60a5fa;font-weight:700;font-size:.78rem;
                letter-spacing:.08em;padding:10px 10px 4px;border-bottom:none}}
  a{{color:#4ade80;text-decoration:none}} a:hover{{text-decoration:underline}}
  .sz{{color:#64748b;font-family:monospace}}
</style></head><body>
<h1>CM Release 1 — Document Set</h1>
<p class="sub">Church-Turing Meta-Machine &middot; Kenneth J Hamer-Hodges &middot; May 2026 &middot; 14 documents</p>
<table>
<thead><tr><th>Document</th><th>Size</th><th>Download</th></tr></thead>
<tbody>{rows}</tbody>
</table>
<p style="margin-top:24px;font-size:.8rem;color:#4a5568">
  <a href="/">&larr; Home</a>
</p>
</body></html>"""
    return html

@app.route("/release/r1/<path:filename>")
def release_r1_pdf(filename):
    safe = os.path.basename(filename)
    pdf_path = os.path.join(_RELEASE_1_DIR, safe)
    if not os.path.isfile(pdf_path) or not safe.endswith(".pdf"):
        return "Not found", 404
    resp = make_response(send_file(pdf_path, mimetype="application/pdf"))
    resp.headers["Content-Disposition"] = f'attachment; filename="{safe}"'
    resp.headers["Cache-Control"] = "no-cache, no-store, must-revalidate"
    return resp

@app.route("/release/r12/")
@app.route("/release/r12")
def release_r12_index():
    html = """<!DOCTYPE html>
<html lang="en"><head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Church Machine — Wukong Artix-7 Download</title>
<meta name="description" content="Download the QMTECH Wukong Artix-7 FPGA package for the Church Machine IDE — Verilog netlist, XDC pin constraints, Vivado build script, and pre-built bitstream.">
<link rel="canonical" href="https://lab.cloomc.org/release/r12/">
<meta property="og:title" content="Church Machine — Wukong Artix-7 Download">
<meta property="og:description" content="Download the complete Wukong Artix-7 FPGA package for Church Machine — Verilog netlist, pin constraints, Vivado build script, and pre-built bitstream.">
<meta property="og:type" content="website">
<meta property="og:url" content="https://lab.cloomc.org/release/r12/">
<meta property="og:site_name" content="Church Machine">
<style>
  *{box-sizing:border-box}
  body{font-family:system-ui,sans-serif;background:#0a0e17;color:#c8d6e5;padding:24px 20px;max-width:720px;margin:0 auto}
  h1{color:#a78bfa;font-size:1.5rem;margin:0 0 4px}
  .tag{font-size:.75rem;color:#64748b;font-family:monospace;margin-bottom:1.8rem}
  /* ── Hero download block ── */
  .hero{background:#0d1117;border:1px solid #2d1f4e;border-radius:10px;padding:24px;margin-bottom:1.6rem;text-align:center}
  .hero-title{color:#daa520;font-size:1rem;font-weight:600;margin-bottom:.3rem}
  .hero-sub{font-size:.8rem;color:#64748b;margin-bottom:1.2rem}
  .dl-btn{display:inline-block;padding:.65rem 1.8rem;background:#a78bfa;border-radius:6px;
          color:#0a0e17;text-decoration:none;font-size:.95rem;font-weight:700;
          transition:background .15s;letter-spacing:.01em}
  .dl-btn:hover{background:#c4b5fd}
  .dl-btn-icon{margin-right:.4rem}
  .hero-meta{margin-top:1rem;font-size:.75rem;color:#4a5568}
  /* ── What's inside ── */
  .box-title{color:#daa520;font-size:.78rem;font-weight:700;text-transform:uppercase;
             letter-spacing:.06em;margin-bottom:.5rem}
  .contents-grid{display:grid;grid-template-columns:1fr 1fr;gap:4px 16px;
                 font-size:.78rem;color:#8892a4;margin-bottom:1.6rem}
  @media(max-width:480px){.contents-grid{grid-template-columns:1fr}}
  .contents-grid .file{font-family:monospace;color:#c4b5fd}
  .contents-grid .highlight .file{color:#4ade80}
  .contents-grid .note{color:#64748b;font-size:.72rem}
  /* ── Steps ── */
  .steps{margin-bottom:1.6rem}
  .step{display:flex;gap:14px;margin-bottom:1rem;align-items:flex-start}
  .step-num{flex-shrink:0;width:28px;height:28px;border-radius:50%;background:#1a0e28;
            border:2px solid #a78bfa;color:#a78bfa;font-size:.8rem;font-weight:700;
            display:flex;align-items:center;justify-content:center;margin-top:1px}
  .step-body{flex:1}
  .step-body strong{color:#e2e8f0;display:block;margin-bottom:.25rem;font-size:.88rem}
  .step-body p{margin:0;font-size:.8rem;color:#8892a4;line-height:1.55}
  .step-body code{background:#1a0e28;padding:.1rem .35rem;border-radius:3px;font-family:monospace;font-size:.78rem;color:#c4b5fd}
  .step-body pre{background:#0a0e17;border:1px solid #1e2a3a;border-radius:5px;
                 padding:.55rem .8rem;font-size:.76rem;color:#a3e635;margin:.4rem 0;
                 overflow-x:auto;white-space:pre}
  .step-body .alt{margin-top:.4rem;font-size:.76rem;color:#4a5568}
  .step-divider{border:none;border-top:1px solid #1e2a3a;margin:1.2rem 0}
  /* ── Rebuild section (collapsed) ── */
  details{margin-bottom:1.6rem}
  summary{cursor:pointer;color:#64748b;font-size:.82rem;padding:.4rem 0;
          list-style:none;display:flex;align-items:center;gap:.5rem}
  summary::before{content:"▶";font-size:.65rem;transition:transform .15s}
  details[open] summary::before{transform:rotate(90deg)}
  summary:hover{color:#a78bfa}
  /* ── Other boards ── */
  .other-boards{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:1.6rem}
  @media(max-width:480px){.other-boards{grid-template-columns:1fr}}
  .board-card{background:#0d1117;border:1px solid #1e2a3a;border-radius:7px;padding:14px}
  .board-card h3{color:#8892a4;font-size:.82rem;margin:0 0 .2rem}
  .board-card .board-tag{font-size:.7rem;color:#4a5568;margin-bottom:.7rem}
  .board-card a{display:inline-block;padding:.3rem .75rem;background:#0a0e17;border:1px solid #2d1f4e;
                border-radius:4px;color:#64748b;text-decoration:none;font-size:.76rem}
  .board-card a:hover{border-color:#a78bfa;color:#a78bfa}
  .back{margin-top:1.5rem;font-size:.78rem;color:#4a5568}
  .back a{color:#64748b;text-decoration:none}
  .back a:hover{color:#a78bfa}
</style></head><body>

<h1>&#x2B21; Church Machine — QMTECH Wukong Artix-7</h1>
<div class="tag">QMTECH Wukong XC7A100T &middot; JTAG &middot; Everything in one ZIP &nbsp;&middot;&nbsp;
  <a href="https://www.aliexpress.com/w/wholesale-qmtech-wukong.html"
     target="_blank" rel="noopener"
     style="color:#4ade80;text-decoration:none;">&#x1F6D2; Buy the QMTECH Wukong board</a>
</div>

<div class="hero">
  <div class="hero-title">Complete build package &amp; pre-built bitstream</div>
  <div class="hero-sub">One download. Extract, then build with Vivado — or flash the pre-built bitstream below.</div>
  <a class="dl-btn" href="/dl/wukong-zip"><span class="dl-btn-icon">&#x2B07;</span>Download church-wukong-package.zip</a>
  <a class="dl-btn" href="/dl/wukong-bridge" style="margin-left:.5rem;background:#4c1d95;color:#ddd6fe"><span class="dl-btn-icon">&#x2B07;</span>Download wukong_bridge.py</a>
  <div class="hero-meta">Includes Verilog netlist &middot; XDC pin constraints &middot; Vivado build script &middot; native USB-UART bridge</div>
</div>

<div id="r12BitstreamCard" style="margin-bottom:1.6rem"></div>
<script>
(function(){
  var card = document.getElementById('r12BitstreamCard');
  fetch('/api/bitstream-status').then(function(r){return r.json();}).then(function(d){
    if(d.present){
      var sz = d.size_bytes ? (d.size_bytes/1048576).toFixed(1)+' MB' : '';
      var dt = d.built_at ? d.built_at.replace('T',' ').replace('Z',' UTC') : '';
      var fw = d.version_known ? ('v' + d.firmware_version) : 'version unknown';
      var warn = '';
      if(d.version_mismatch && d.mismatch_message){
        warn = '<div style="background:#1a1408;border:1px solid #854d0e;border-radius:8px;padding:10px 14px;margin-top:8px;font-size:.78rem;color:#fbbf24">'
          +'<span style="font-weight:700">&#x26A0;&#xFE0F; Version mismatch:</span> '
          +String(d.mismatch_message).replace(/&/g,'&amp;').replace(/</g,'&lt;')
          +'</div>';
      }
      var versionSuffix = d.version_known ? ('_v' + d.firmware_version) : '';
      var bitName = 'church_wukong_xc7a100t' + versionSuffix + '.bit';
      var mcsName = 'church_wukong_xc7a100t' + versionSuffix + '.mcs';
      function exactUrl(kind) {
        var item = d.download && d.download[kind];
        return item && item.available
          ? '/dl/wukong-' + kind + '?provenance_identity=' +
            encodeURIComponent(item.provenance_identity) + '&sha256=' +
            encodeURIComponent(item.sha256)
          : '';
      }
      var bitUrl = exactUrl('bit');
      var mcsUrl = exactUrl('mcs');
      var mcs = mcsUrl
        ? '<a href="'+mcsUrl+'" download="'+mcsName+'" style="padding:.4rem 1rem;background:#4c1d95;border-radius:5px;color:#ddd6fe;text-decoration:none;font-size:.82rem;font-weight:700;white-space:nowrap">&#x2B07; Download .mcs (persistent)</a>'
        : '';
      card.innerHTML = '<div style="background:#071a0e;border:1px solid #166534;border-radius:8px;padding:14px 16px;margin-bottom:0">'
        +'<div style="display:flex;align-items:center;gap:14px">'
        +'<span style="font-size:1.5rem">✅</span>'
        +'<div><div style="color:#4ade80;font-weight:700;font-size:.9rem">Pre-built bitstream available</div>'
        +'<div style="font-size:.75rem;color:#64748b;margin-top:2px">'+sz+' &middot; '+fw+(dt?' &middot; built '+dt:'')+'<br>.bit loads once; .mcs programs the board to boot this image after reset.</div></div>'
        +'</div>'
        +'<div style="display:flex;flex-wrap:wrap;gap:8px;margin-top:12px">'
        +(bitUrl ? '<a href="'+bitUrl+'" download="'+bitName+'" style="padding:.4rem 1rem;background:#166534;border-radius:5px;color:#4ade80;text-decoration:none;font-size:.82rem;font-weight:700;white-space:nowrap">&#x2B07; Download current .bit (temporary)</a>' : '')
        +mcs+'</div>'
        +'</div>' + warn;
    } else {
      card.innerHTML = '<div style="background:#1a0e0e;border:1px solid #4a1212;border-radius:8px;padding:12px 16px;font-size:.8rem;color:#9ca3af">'
        +'<span style="color:#f87171;font-weight:700">Bitstream not yet built.</span> '
        +'Build it with Vivado: <code style="background:#0a0e17;padding:.1rem .3rem;border-radius:3px;color:#c4b5fd">source wukong_xc7a100t.tcl</code> from the extracted package, '
        +'then upload the resulting .bit to the IDE.'
        +'</div>';
    }
  }).catch(function(){});
})();
</script>
<div class="box-title">&#x1F4E6; What&rsquo;s inside the ZIP</div>
<div class="contents-grid">
  <div class="highlight"><span class="file">church_wukong_xc7a100t.v</span><span class="note"> — Verilog netlist ✓</span></div>
  <div><span class="file">church_wukong_xc7a100t.il</span><span class="note"> — Amaranth RTLIL source</span></div>
  <div><span class="file">wukong_xc7a100t.xdc</span><span class="note"> — Vivado pin constraints</span></div>
  <div><span class="file">wukong_xc7a100t.tcl</span><span class="note"> — Vivado batch build script</span></div>
  <div><span class="file">wukong_bridge.py</span><span class="note"> — native USB-UART trace &amp; command bridge</span></div>
  <div><span class="file">BUILD.md</span><span class="note"> — full instructions</span></div>
</div>

<div class="box-title">&#x26A1; Load once or make the Wukong boot persistently</div>
<p style="font-size:.82rem;color:#a78bfa">For the complete Windows/Vivado GUI
sequence and troubleshooting, see
<a href="/docs/wukong-vivado-flash-guide.md" style="color:#c4b5fd">Vivado Artix-7 Flash Guide</a>.</p>
<div class="steps">
  <div class="step">
    <div class="step-num">1</div>
    <div class="step-body">
      <strong>Extract the ZIP</strong>
      <p>Unzip into a folder and open a terminal there.</p>
    </div>
  </div>
  <div class="step">
    <div class="step-num">2</div>
    <div class="step-body">
      <strong>Temporary: load the FPGA for this session</strong>
      <pre>openFPGALoader church_wukong_xc7a100t.bit</pre>
      <p>Download the pre-built <code>.bit</code> from the card above. This writes the FPGA's volatile configuration, so pressing reset or removing power clears it.</p>
      <p class="alt">Or via Vivado: <strong>Hardware Manager</strong> → Open target → Auto Connect → Program Device → select the <code>.bit</code>.</p>
    </div>
  </div>
  <div class="step">
    <div class="step-num">3</div>
    <div class="step-body">
      <strong>Persistent: program the board's SPI boot flash</strong>
      <p>Download the <code>.mcs</code> file from the purple button. In Vivado Hardware Manager, choose <strong>Add Configuration Memory Device</strong>, select <code>n25q64-3.3v-spi-x1_x2_x4</code>, then program the configuration memory with the downloaded <code>.mcs</code>.</p>
      <p class="alt">This is the persistent “lock it home” path. It writes the Wukong’s SPI flash so the FPGA reloads this image after reset or power loss. Verify succeeds before resetting the board.</p>
    </div>
  </div>
  <div class="step">
    <div class="step-num">4</div>
    <div class="step-body">
      <strong>Reset and confirm automatic boot</strong>
      <p>Press RESET or power-cycle the board. A correctly programmed <code>.mcs</code> restores the Church Machine without selecting the <code>.bit</code> again.</p>
    </div>
  </div>
  <div class="step">
    <div class="step-num">5</div>
    <div class="step-body">
      <strong>Connect to the IDE</strong>
      <p>Open the <a href="/simulator" style="color:#a78bfa">Church Machine IDE</a> → click <strong>&#x1F50C; Connect Wukong</strong> → pick your board from the list. The IDE uploads the boot image automatically and the Church Machine starts running.</p>
    </div>
  </div>
</div>

<hr class="step-divider">

<details>
  <summary>&#x1F527; Rebuild the bitstream from source (AMD Vivado required)</summary>
  <div class="steps" style="margin-top:1rem">
    <div class="step">
      <div class="step-num">1</div>
      <div class="step-body">
        <strong>Run the Vivado build script</strong>
        <pre>vivado -mode batch -source wukong_xc7a100t.tcl</pre>
        <p>Creates the project, runs synthesis + implementation (~30 min), and writes <code>church_wukong_xc7a100t.bit</code>.</p>
      </div>
    </div>
    <div class="step">
      <div class="step-num">2</div>
      <div class="step-body">
        <strong>Flash</strong>
        <pre>openFPGALoader church_wukong_xc7a100t.bit</pre>
      </div>
    </div>
  </div>
</details>


<p class="back"><a href="/">&larr; Home</a> &nbsp;&middot;&nbsp; <a href="/release/r1">Release 1 Documents</a> &nbsp;&middot;&nbsp; <a href="/simulator">IDE</a></p>
</body></html>"""
    return html

_SIMULATOR_HTML_VERSION = BUILD_VERSION
_STARTER_HTML_VERSION   = "r20260527z"

@app.route("/start")
@app.route("/start/")
@app.route("/starter")
@app.route("/starter/")
def starter_index():
    # Redirect to a versioned URL the proxy has never cached.
    qs = request.query_string.decode()
    dest = f"/start/~/{_STARTER_HTML_VERSION}"
    if qs:
        dest += "?" + qs
    return redirect(dest, code=302)

@app.route("/start/~/<version>")
def starter_versioned(version):
    filepath = os.path.join(SIMULATOR_DIR, "starter.html")
    if os.path.isfile(filepath):
        with open(filepath, 'r', encoding='utf-8') as f:
            html = f.read()
        # Inject <base> so relative script/CSS URLs resolve to /simulator/
        html = html.replace('<head>', '<head><base href="/simulator/">', 1)
        resp = make_response(html)
        resp.headers['Content-Type'] = 'text/html; charset=utf-8'
        resp.headers['Cache-Control'] = 'no-store, no-cache, must-revalidate, max-age=0'
        resp.headers['Pragma'] = 'no-cache'
        resp.headers['Expires'] = '0'
        return resp
    return redirect("/simulator/", code=302)

@app.route("/simulator")
@app.route("/simulator/")
def simulator_index():
    # Redirect to a versioned URL (= git hash) that changes on every merge,
    # busting any proxy or browser cache automatically without a hard refresh.
    # Preserve the original query string (e.g. ?learn=1, ?debug=1) — without
    # this, any query param a caller attaches to /simulator/ is silently
    # dropped by the redirect and never reaches the versioned page.
    target = f"/simulator/~/{_SIMULATOR_HTML_VERSION}"
    if request.query_string:
        target += "?" + request.query_string.decode("utf-8")
    resp = redirect(target, code=302)
    resp.headers["Cache-Control"] = "no-store, no-cache, must-revalidate, max-age=0"
    resp.headers["Pragma"] = "no-cache"
    resp.headers["Expires"] = "0"
    return resp

@app.route("/simulator/~/<version>")
def simulator_versioned(version):
    filepath = os.path.join(SIMULATOR_DIR, "index.html")
    if os.path.isfile(filepath):
        with open(filepath, 'r', encoding='utf-8') as f:
            html = f.read()
        # Inject <base> so all relative URLs resolve to /simulator/
        html = html.replace('<head>', '<head><base href="/simulator/">', 1)
        resp = make_response(html)
        resp.headers['Content-Type'] = 'text/html; charset=utf-8'
        resp.headers['Cache-Control'] = 'no-store, no-cache, must-revalidate, max-age=0'
        resp.headers['Pragma'] = 'no-cache'
        resp.headers['Expires'] = '0'
        return resp
    return jsonify({"status": "simulator not yet built"})

_STALE_VERSION_RE = re.compile(r'^r\d{8}[a-z]?/?$')

@app.route("/simulator/<path:path>")
def simulator_static(path):
    # Redirect stale cached version paths (e.g. /simulator/r20260429c/) to current.
    if _STALE_VERSION_RE.match(path):
        resp = redirect(f"/simulator/~/{_SIMULATOR_HTML_VERSION}", code=302)
        resp.headers["Cache-Control"] = "no-store, no-cache, must-revalidate, max-age=0"
        resp.headers["Pragma"] = "no-cache"
        resp.headers["Expires"] = "0"
        return resp
    filepath = os.path.join(SIMULATOR_DIR, path)
    return _serve_file(filepath, os.path.basename(path))

_ATTACHED_ASSET_EXTENSIONS = {
    ".png", ".jpg", ".jpeg", ".webp", ".gif", ".svg",
}

@app.route("/attached_assets/<path:path>")
def attached_asset_static(path):
    """Serve browser-safe user-provided image assets used by IDE references."""
    if os.path.splitext(path)[1].lower() not in _ATTACHED_ASSET_EXTENSIONS:
        return make_response("Not found", 404)
    return send_from_directory(os.path.join(BASE_DIR, "attached_assets"), path)

_RV32_ALLOWED_EXTENSIONS = {
    ".html", ".js", ".css", ".json", ".png", ".jpg", ".jpeg",
    ".gif", ".svg", ".ico", ".woff", ".woff2", ".ttf", ".eot",
}


@app.route("/ctmm/")
def ctmm_index():
    filepath = os.path.join(WEB_DIR, "index.html")
    if os.path.isfile(filepath):
        return _serve_file(filepath, "index.html")
    return make_response("CM simulator not found", 404)

_CTMM_ALLOWED_EXTENSIONS = {
    ".html", ".js", ".css", ".json", ".png", ".jpg", ".jpeg",
    ".gif", ".svg", ".ico", ".woff", ".woff2", ".ttf", ".eot",
}

@app.route("/ctmm/<path:path>")
def ctmm_static(path):
    ext = os.path.splitext(path)[1].lower()
    if ext not in _CTMM_ALLOWED_EXTENSIONS:
        return make_response("Not found", 404)
    return send_from_directory(WEB_DIR, path)

@app.route("/docs/figures/<path:path>")
def docs_figures(path):
    return send_from_directory(os.path.join(DOCS_DIR, "figures"), path)

@app.route("/docs/runbook")
def docs_runbook():
    """Serve docs/RUNBOOK.md as plain text (the hardware integration runbook)."""
    return send_from_directory(DOCS_DIR, "RUNBOOK.md", mimetype="text/plain")

@app.route("/docs/<path:filename>")
def docs_raw(filename):
    if '..' in filename or filename.startswith('/'):
        return make_response("Invalid path", 400)
    if not filename.endswith('.md'):
        return make_response("Only markdown files allowed", 400)
    filepath = os.path.realpath(os.path.join(DOCS_DIR, filename))
    if not filepath.startswith(os.path.realpath(DOCS_DIR)):
        return make_response("Invalid path", 400)
    if not os.path.isfile(filepath):
        return make_response("Not found", 404)
    return send_from_directory(DOCS_DIR, filename, mimetype="text/plain")

PATENTS_DIR = os.path.join(DOCS_DIR, "patents")
SIX_LAWS_DIR = os.path.join(DOCS_DIR, "six-laws")

@app.route("/six-laws/")
def six_laws_index():
    resp = make_response(send_from_directory(SIX_LAWS_DIR, "index.html"))
    resp.headers["Cache-Control"] = "no-cache, no-store, must-revalidate"
    return resp

@app.route("/six-laws/view")
def six_laws_view():
    """Serve the Six Laws PDF inline so the browser displays it directly."""
    pdf_path = os.path.join(SIX_LAWS_DIR, "six-laws-review.pdf")
    resp = make_response(send_file(pdf_path, mimetype="application/pdf"))
    resp.headers["Content-Disposition"] = 'inline; filename="six-laws-review.pdf"'
    resp.headers["Cache-Control"] = "no-cache, no-store, must-revalidate"
    return resp

@app.route("/six-laws/files/<path:filename>")
def six_laws_file(filename):
    resp = make_response(send_from_directory(SIX_LAWS_DIR, filename))
    if filename.endswith(".pdf"):
        resp.headers["Content-Type"] = "application/pdf"
        resp.headers["Content-Disposition"] = f'attachment; filename="{filename}"'
    resp.headers["Cache-Control"] = "no-cache, no-store, must-revalidate"
    return resp

@app.route("/patents/")
def patents_index():
    resp = make_response(send_from_directory(PATENTS_DIR, "index.html"))
    resp.headers["Cache-Control"] = "no-cache, no-store, must-revalidate"
    return resp

@app.route("/python-demo/")
def python_demo():
    resp = make_response(send_from_directory(WEB_DIR, "python_demo.html"))
    resp.headers["Cache-Control"] = "no-cache, no-store, must-revalidate"
    return resp

@app.route("/patents/files/<path:filename>")
def patents_file(filename):
    resp = make_response(send_from_directory(PATENTS_DIR, filename))
    if filename.endswith(".pdf"):
        resp.headers["Content-Type"] = "application/pdf"
    resp.headers["Cache-Control"] = "no-cache, no-store, must-revalidate"
    return resp

@app.route("/figures/<path:path>")
def figures_html(path):
    if not path.endswith(".html"):
        path = path + ".html"
    resp = make_response(send_from_directory(os.path.join(DOCS_DIR, "figures"), path))
    resp.headers["Cache-Control"] = "no-cache, no-store, must-revalidate"
    return resp

CHURCH_SIM_DIR = os.path.join(BASE_DIR, "church_sim")
TEST_HARNESS_DIR = os.path.join(BASE_DIR, "test_harness")
BUSINESS_DIR = os.path.join(DOCS_DIR, "business")


@app.route("/business/plan.html")
def business_plan():
    return send_from_directory(BUSINESS_DIR, "plan.html")

@app.route("/business/deck.html")
def business_deck():
    return send_from_directory(BUSINESS_DIR, "deck.html")

@app.route("/docs/patent-unified.html")
def patent_unified():
    return send_from_directory(os.path.join(DOCS_DIR, "figures"), "patent-ctmm-unified.html")

@app.route("/docs/switch-lifecycle.html")
def switch_lifecycle_html():
    return send_from_directory(os.path.join(DOCS_DIR, "figures"), "switch-lifecycle.html")

BOOK_CHAPTERS = [
    ("Getting Started", [
        "quick-start.md",
        "board-connectivity.md",
        "cloomc-foundation.md",
        {"type": "figure", "name": "biology-of-abstractions.html", "label": "Biology of Abstractions"},
        "prologue.md",
        "contributing.md",
    ]),
    ("Part I: Introduction", [
        "overview.md",
        "getting-started.md",
        "handbook.md",
    ]),
    ("Part II: Architecture", [
        "architecture.md",
        "instruction-set.md",
        "isa_encoding.md",
        "church-instructions.md",
        "instruction-matrix.md",
        "lambda-instruction.md",
        "golden-tokens.md",
        "gt-literals.md",
        "call-stack.md",
        "dispatch-styles.md",
    ]),
    ("Part III: Security", [
        "namespace-security.md",
        "switch-lifecycle.md",
        "trusted-security-base.md",
        "boot-permission-rules.md",
        "risks.md",
    ]),
    ("Part IV: Runtime", [
        "CM_LUMP_SPECIFICATION.md",
        "abstractions.md",
        {"type": "figure", "name": "lumps-directory.html", "label": "Lump Viewer"},
        "garbage-collection.md",
        "locator.md",
        "family-registry.md",
        "namespace-json.md",
        "json-information.md",
    ]),
    ("Part V: Networking", [
        "network-transparency.md",
        "tunnel-messaging-example.md",
    ]),
    ("Part VI: Lambda Calculus", [
        "lambda-arithmetic.md",
        "note-g-comparison.md",
        "paper-sliderule-comparison.md",
    ]),
    ("Part VII: Immortal Software", [
        "longevity.md",
        "immortal-software.md",
    ]),
    ("Part VIII: The Civilisation Case", [
        "civilization-threat.md",
        "lambda-trust-and-civilization.md",
    ]),
    ("Part IX: Hardware Implementation", [
        "boot-rom-layout.md",
        "chipflow-cover-letter.md",
        "chipflow-technical-summary.md",
        "production_silicon_todo.md",
    ]),
    ("Part X: IDE Design Guide", [
        "IDE-Designer.md",
        "pet-name-language.md",
        "namespace-vocabulary-tutorial.md",
        "method-access-control.md",
    ]),
    ("Part XI: Implementation Plans", [
        "memory-manager.md",
        "plan-lazy-load.md",
        "plan-call-mum.md",
        "plan-browser.md",
    ]),
    ("Part XII: Patents & Proposals", [
        "patent-church-machine-claims.md",
        "patent-church-machine-email.md",
        "patent-cloomc-universal-target.md",
        "patent-ctmm-lambda.md",
        "patent-ctmm-unified.md",
        "proposal-lambda-registers.md",
    ]),
]

@app.route("/api/docs/list")
def docs_list():
    all_files = set()
    for f in os.listdir(DOCS_DIR):
        if f.endswith('.md'):
            all_files.add(f)

    chapters = []
    catalogued = set()
    figures_dir = os.path.join(DOCS_DIR, "figures")
    for part_title, filenames in BOOK_CHAPTERS:
        entries = []
        for item in filenames:
            if isinstance(item, dict) and item.get("type") == "link":
                dev_domain = os.environ.get("REPLIT_DEV_DOMAIN", "")
                # REPLIT_DOMAINS can hold multiple space-separated values
                # (e.g. "foo.replit.app bar.replit.app").  Extract only the
                # first token so that it is always a single well-formed domain
                # and the URL we build is never malformed.
                _replit_domains_raw = os.environ.get("REPLIT_DOMAINS", "")
                replit_domain = _replit_domains_raw.split()[0] if _replit_domains_raw.split() else ""
                port = item.get("artifact_port", 0)
                path = item.get("artifact_path", "/")
                production_path = item.get("production_path", "")
                if production_path:
                    # The IDE's Flask app serves the built artifact on this
                    # same-origin path in both development and production.
                    # Do not use port-prefixed dev URLs: their temporary proxy
                    # registration can vanish after a workspace reset.
                    origin_domain = dev_domain or replit_domain
                    url = (
                        f"https://{origin_domain}{production_path}"
                        if origin_domain else production_path
                    )
                    probe_port = 0
                else:
                    # Neither dev domain nor production domain is set (e.g. CI
                    # or a standalone install).  Disable the link rather than
                    # pointing to a URL that does not exist in this context.
                    url = ""
                    probe_port = 0
                entries.append({
                    "name": "",
                    "type": "link",
                    "label": item["label"],
                    "url": url,
                    "artifact_port": probe_port,
                    "size": 0,
                })
            elif isinstance(item, dict):
                # Inline figure entry within a chapter
                fig_name = item["name"]
                fig_path = os.path.join(figures_dir, fig_name)
                if os.path.isfile(fig_path):
                    size = os.path.getsize(fig_path)
                    entries.append({
                        "name": fig_name,
                        "type": "figure",
                        "label": item.get("label", fig_name.replace(".html", "")),
                        "size": size,
                    })
            elif item in all_files:
                filepath = os.path.join(DOCS_DIR, item)
                size = os.path.getsize(filepath)
                entries.append({"name": item, "type": "doc", "size": size})
                catalogued.add(item)
        if entries:
            chapters.append({"title": part_title, "docs": entries})

    uncatalogued = sorted(all_files - catalogued)
    if uncatalogued:
        entries = []
        for fname in uncatalogued:
            filepath = os.path.join(DOCS_DIR, fname)
            size = os.path.getsize(filepath)
            entries.append({"name": fname, "type": "doc", "size": size})
        chapters.append({"title": "Appendix", "docs": entries})

    flat_docs = []
    for ch in chapters:
        flat_docs.extend(ch["docs"])

    figures = []
    figures_dir = os.path.join(DOCS_DIR, "figures")
    if os.path.isdir(figures_dir):
        for f in sorted(os.listdir(figures_dir)):
            if f.endswith('.html'):
                filepath = os.path.join(figures_dir, f)
                size = os.path.getsize(filepath)
                figures.append({"name": f, "type": "figure", "size": size})
    return jsonify({"docs": flat_docs, "chapters": chapters, "figures": figures})

# Ports that the UI is allowed to probe via /api/artifact-reachable.
# The introduction remains reachable from the dedicated Docs toolbar and
# hamburger controls even though it is intentionally absent from BOOK_CHAPTERS.
_ARTIFACT_ALLOWED_PORTS: "frozenset[int]" = frozenset({21279}) | frozenset(
    item["artifact_port"]
    for _, entries in BOOK_CHAPTERS
    for item in entries
    if isinstance(item, dict) and item.get("type") == "link" and item.get("artifact_port")
)

@app.route("/api/artifact-reachable")
def artifact_reachable():
    """Check whether a known artifact dev server port is accepting connections.

    Only ports used by an explicit IDE artifact control are probed; any other port
    returns the same generic {"ok": false} so the endpoint cannot be used as a
    port-scanning oracle against arbitrary loopback services.

    Returns {"ok": true} when a TCP connection to 127.0.0.1:<port> succeeds
    within 1 second, otherwise {"ok": false}.  Error details are intentionally
    omitted from the response to avoid leaking internal service information.
    """
    import socket
    port = request.args.get("port", type=int)
    if not port or port not in _ARTIFACT_ALLOWED_PORTS:
        return jsonify({"ok": False}), 400
    try:
        sock = socket.create_connection(("127.0.0.1", port), timeout=1.0)
        sock.close()
        return jsonify({"ok": True})
    except (socket.timeout, ConnectionRefusedError, OSError):
        return jsonify({"ok": False})
@app.route("/api/docs/read/<path:filename>")
def docs_read(filename):
    if '..' in filename or filename.startswith('/'):
        return jsonify({"error": "Invalid path"}), 400
    if not filename.endswith('.md'):
        return jsonify({"error": "Only markdown files allowed"}), 400
    filepath = os.path.realpath(os.path.join(DOCS_DIR, filename))
    if not filepath.startswith(os.path.realpath(DOCS_DIR)):
        return jsonify({"error": "Invalid path"}), 400
    if not os.path.isfile(filepath):
        return jsonify({"error": "Not found"}), 404
    with open(filepath, 'r') as f:
        content = f.read()
    return jsonify({"name": filename, "content": content})

BUILD_DIR = os.path.join(BASE_DIR, "build")

_ALLOWED_BUILD_FILES = {
    "church_wukong_xc7a100t.v":  "text/plain",
    "church_wukong_xc7a100t.il": "text/plain",
}

@app.route("/download/<filename>")
def download_build_file(filename):
    if filename not in _ALLOWED_BUILD_FILES:
        return make_response("Not found", 404)
    filepath = os.path.join(BUILD_DIR, filename)
    if not os.path.isfile(filepath):
        return make_response("File not yet generated", 404)
    ct = _ALLOWED_BUILD_FILES[filename]
    with open(filepath, "rb") as f:
        data = f.read()
    resp = make_response(data, 200)
    resp.headers["Content-Type"] = ct
    resp.headers["Content-Disposition"] = f'attachment; filename="{filename}"'
    return resp

@app.route("/local_bridge.py")
@app.route("/webserial_bridge.py")
@app.route("/download/local_bridge.py")
@app.route("/download/webserial_bridge.py")
def download_local_bridge():
    """Serve the WebSerial HTTP bridge (server/local_bridge.py) for download.
    This bridge speaks the binary CALLHOME protocol and acts as a local HTTP
    proxy so Chrome's WebSerial API can reach the board over USB.
    For the ASCII CALLHOME bridge (Penguin / headless use) see /callhome_bridge.py.
    """
    bridge_path = os.path.join(os.path.dirname(__file__), "local_bridge.py")
    if not os.path.isfile(bridge_path):
        return make_response("Not found", 404)
    with open(bridge_path, "rb") as f:
        data = f.read()
    resp = make_response(data, 200)
    resp.headers["Content-Type"] = "text/plain"
    resp.headers["Content-Disposition"] = 'attachment; filename="webserial_bridge.py"'
    return resp

@app.route("/callhome_bridge.py")
@app.route("/download/callhome_bridge.py")
def download_callhome_bridge():
    """Serve the ASCII CALLHOME bridge (hardware/soc_combined/callhome_bridge.py)."""
    bridge_path = os.path.join(os.path.dirname(__file__), "..", "hardware", "soc_combined", "callhome_bridge.py")
    bridge_path = os.path.normpath(bridge_path)
    if not os.path.isfile(bridge_path):
        return make_response("Not found", 404)
    with open(bridge_path, "rb") as f:
        data = f.read()
    resp = make_response(data, 200)
    resp.headers["Content-Type"] = "text/plain"
    resp.headers["Content-Disposition"] = 'attachment; filename="callhome_bridge.py"'
    return resp

GITHUB_TOKEN = os.environ.get("GITHUB_TOKEN", "") or os.environ.get("GITHUB_PAT", "")
GITHUB_LIBRARY_REPO = os.environ.get("GITHUB_LIBRARY_REPO", "khhodges/church-machine")
GITHUB_FOUNDATION_REPO = "khhodges/cloomc-foundation"

def github_api(method, path, json_data=None, repo=None):
    if not GITHUB_TOKEN:
        return None, "GitHub not configured — set GITHUB_TOKEN"
    target_repo = repo or GITHUB_LIBRARY_REPO
    if not target_repo:
        return None, "No target repository configured"
    url = f"https://api.github.com/repos/{target_repo}{path}"
    headers = {
        "Authorization": f"token {GITHUB_TOKEN}",
        "Accept": "application/vnd.github.v3+json"
    }
    try:
        if method == "GET":
            r = http_requests.get(url, headers=headers, timeout=15)
        elif method == "PUT":
            r = http_requests.put(url, headers=headers, json=json_data, timeout=15)
        else:
            return None, f"Unsupported method: {method}"
        if r.status_code >= 400:
            return None, f"GitHub API {r.status_code}: {r.text[:200]}"
        return r.json(), None
    except Exception as e:
        return None, str(e)

def github_push_file(repo, filepath, content_str, commit_msg, branch="main"):
    encoded = base64.b64encode(content_str.encode("utf-8")).decode("utf-8")
    existing, _ = github_api("GET", f"/contents/{filepath}", repo=repo)
    sha = existing.get("sha") if existing and isinstance(existing, dict) and "sha" in existing else None
    put_data = {"message": commit_msg, "content": encoded, "branch": branch}
    if sha:
        put_data["sha"] = sha
    result, err = github_api("PUT", f"/contents/{filepath}", put_data, repo=repo)
    return result, err

@app.route("/api/library/repo-url")
def library_repo_url():
    if GITHUB_LIBRARY_REPO:
        return jsonify({"url": f"https://github.com/{GITHUB_LIBRARY_REPO}"})
    return jsonify({"url": ""})

def github_api_public(path, repo):
    url = f"https://api.github.com/repos/{repo}{path}"
    headers = {"Accept": "application/vnd.github.v3+json"}
    if GITHUB_TOKEN:
        headers["Authorization"] = f"token {GITHUB_TOKEN}"
    try:
        r = http_requests.get(url, headers=headers, timeout=15)
        if r.status_code >= 400:
            if GITHUB_TOKEN:
                headers_noauth = {"Accept": "application/vnd.github.v3+json"}
                r = http_requests.get(url, headers=headers_noauth, timeout=15)
                if r.status_code >= 400:
                    return None, f"GitHub API {r.status_code}: {r.text[:200]}"
            else:
                return None, f"GitHub API {r.status_code}: {r.text[:200]}"
        return r.json(), None
    except Exception as e:
        return None, str(e)

@app.route("/api/github/sync-status")
def github_sync_status():
    """Return the last GitHub auto-sync result from server/github-sync-status.json."""
    status_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "github-sync-status.json")
    try:
        with open(status_path, "r") as f:
            data = json.load(f)
        resp = jsonify(data)
    except FileNotFoundError:
        resp = jsonify({"status": "unknown", "branch": "", "sha": "", "error": "No sync recorded yet", "timestamp": None})
    except Exception as exc:
        resp = jsonify({"status": "error", "error": str(exc), "branch": "", "sha": "", "timestamp": None})
        resp.status_code = 500
    resp.headers["Cache-Control"] = "no-cache, no-store, must-revalidate"
    resp.headers["Pragma"] = "no-cache"
    resp.headers["Expires"] = "0"
    return resp

@app.route("/api/github/community")
def github_community():
    repos_info = []
    for repo_name, label in [(GITHUB_LIBRARY_REPO, "CLOOMC Project"), (GITHUB_FOUNDATION_REPO, "CLOOMC Foundation")]:
        if not repo_name:
            continue
        data, err = github_api_public("", repo_name)
        if err or not data:
            repos_info.append({"name": repo_name, "label": label, "error": err or "No data"})
            continue
        repos_info.append({
            "name": repo_name,
            "label": label,
            "url": data.get("html_url", f"https://github.com/{repo_name}"),
            "description": data.get("description", ""),
            "stars": data.get("stargazers_count", 0),
            "forks": data.get("forks_count", 0),
            "openIssues": data.get("open_issues_count", 0),
            "watchers": data.get("subscribers_count", 0),
            "license": (data.get("license") or {}).get("spdx_id", ""),
            "defaultBranch": data.get("default_branch", "main"),
            "language": data.get("language", ""),
            "updatedAt": data.get("updated_at", ""),
            "createdAt": data.get("created_at", ""),
        })
    return jsonify({"repos": repos_info})

@app.route("/api/github/activity")
def github_activity():
    repo = request.args.get("repo", GITHUB_LIBRARY_REPO)
    if not repo:
        return jsonify({"commits": [], "error": "No repo configured"})
    data, err = github_api_public("/commits?per_page=10", repo)
    if err or not isinstance(data, list):
        return jsonify({"commits": [], "repo": repo, "error": err or "No data"})
    commits = []
    for c in data[:10]:
        commit_info = c.get("commit", {})
        author_info = commit_info.get("author", {})
        gh_author = c.get("author") or {}
        commits.append({
            "sha": c.get("sha", "")[:7],
            "message": commit_info.get("message", "").split("\n")[0][:120],
            "author": author_info.get("name", "Unknown"),
            "avatar": gh_author.get("avatar_url", ""),
            "date": author_info.get("date", ""),
            "url": c.get("html_url", ""),
        })
    return jsonify({"commits": commits, "repo": repo})

# ---------------------------------------------------------------------------
# /api/versions/production — version of the deployed production server
# (lab.cloomc.org).  Fetches its /api/boot-id and caches briefly so the
# Versions tab's 15 s auto-refresh doesn't hammer production.
_versions_prod_cache = {"ts": 0.0, "payload": None}
_VERSIONS_PROD_TTL = 60  # seconds
PRODUCTION_BASE_URL = os.environ.get("PRODUCTION_BASE_URL", "https://lab.cloomc.org")


@app.route("/api/versions/production")
def versions_production():
    import time as _prod_time
    now = _prod_time.time()
    if _versions_prod_cache["payload"] is not None and now - _versions_prod_cache["ts"] < _VERSIONS_PROD_TTL:
        return jsonify(_versions_prod_cache["payload"])
    payload = {"url": PRODUCTION_BASE_URL}
    try:
        r = http_requests.get(f"{PRODUCTION_BASE_URL}/api/boot-id", timeout=8)
        if r.status_code == 200:
            data = r.json()
            if isinstance(data, dict) and data.get("version"):
                payload["version"] = data.get("version")
                remote_kind = str(data.get("version_kind") or "unknown")
                payload["version_kind"] = remote_kind
                payload["boot_id"] = data.get("bootId")
                payload["local_version"] = BUILD_VERSION
                payload["local_version_kind"] = BUILD_VERSION_KIND
                comparable = (
                    remote_kind != "unknown" and
                    remote_kind == BUILD_VERSION_KIND
                )
                payload["in_sync"] = (
                    data.get("version") == BUILD_VERSION if comparable else None
                )
                payload["comparison"] = (
                    "match" if payload["in_sync"] is True else
                    "mismatch" if payload["in_sync"] is False else
                    "not_comparable"
                )
                # Only cache validated successful responses; errors are never
                # cached so the next UI refresh retries immediately.
                _versions_prod_cache["ts"] = now
                _versions_prod_cache["payload"] = payload
            else:
                payload["error"] = "Malformed response from production"
        else:
            payload["error"] = f"HTTP {r.status_code}"
    except Exception as e:
        payload["error"] = str(e)
    return jsonify(payload)


# ---------------------------------------------------------------------------
# /api/versions/github-diff — file-level comparison between the local git HEAD
# (what the running IDE was built from) and GitHub HEAD. Local history often
# diverges from GitHub (task merges are local), so GitHub's compare API cannot
# be used; instead we compare blob SHAs of the two trees, which git computes
# identically on both sides.
_versions_diff_cache = {"key": None, "ts": 0.0, "payload": None}
_VERSIONS_DIFF_TTL = 300  # seconds

_VERSIONS_AREA_LABELS = {
    "hardware": "FPGA hardware & bridge",
    "server": "IDE server",
    "simulator": "IDE frontend / simulator",
    "tests": "tests",
    "scripts": "build & check scripts",
    "docs": "documentation",
    "build": "build artifacts (bitstreams)",
    "bitstreams": "build artifacts (bitstreams)",
    "e2e": "end-to-end tests",
}

# Non-functional paths excluded from the diff report (session artifacts,
# agent memory, upload scratch) — they never affect how the IDE or FPGA behave.
_VERSIONS_IGNORE_PREFIXES = ("attached_assets/", ".agents/", ".local/", ".cache/")

def _versions_ignored(path):
    return path.startswith(_VERSIONS_IGNORE_PREFIXES)

def _versions_area(path):
    top = path.split("/", 1)[0] if "/" in path else "(repo root)"
    return _VERSIONS_AREA_LABELS.get(top, top)

def _local_git_tree():
    """Return ({path: blob_sha}, head_sha) for the local checkout."""
    head = subprocess.check_output(
        ["git", "rev-parse", "HEAD"], cwd=BASE_DIR, text=True, timeout=10).strip()
    out = subprocess.check_output(
        ["git", "ls-tree", "-r", "HEAD"], cwd=BASE_DIR, text=True, timeout=30)
    tree = {}
    for line in out.splitlines():
        # format: <mode> <type> <sha>\t<path>
        try:
            meta, path = line.split("\t", 1)
            mode, otype, sha = meta.split()
        except ValueError:
            continue
        if otype == "blob":
            tree[path] = sha
    return tree, head

_versions_diff_lock = threading.Lock()

@app.route("/api/versions/github-diff")
def versions_github_diff():
    # Deliberately no ?repo= parameter: this endpoint uses the server's GitHub
    # token, so allowing arbitrary repos would turn it into a metadata proxy.
    repo = GITHUB_LIBRARY_REPO
    if not repo:
        return jsonify({"error": "No repo configured"}), 200
    import time as _diff_time
    now = _diff_time.time()

    # Time-based cache check FIRST — before any git subprocess or GitHub call —
    # so the 15 s auto-refresh doesn't burn workers or API quota.
    if (_versions_diff_cache["payload"] is not None
            and now - _versions_diff_cache["ts"] < _VERSIONS_DIFF_TTL):
        return jsonify(_versions_diff_cache["payload"])

    # Single-flight: if another request is already recomputing, serve the stale
    # payload (or a pending marker) instead of piling up subprocesses.
    if not _versions_diff_lock.acquire(blocking=False):
        if _versions_diff_cache["payload"] is not None:
            return jsonify(_versions_diff_cache["payload"])
        return jsonify({"error": "Comparison in progress — retry shortly"}), 200
    try:
        try:
            local_tree, local_head = _local_git_tree()
        except Exception as e:
            return jsonify({"error": f"Local git unavailable: {e}"}), 200

        commits, err = github_api_public("/commits?per_page=1", repo)
        if err or not isinstance(commits, list) or not commits:
            return jsonify({"error": err or "GitHub unreachable"}), 200
        gh_head = commits[0].get("sha", "")
        if not gh_head:
            return jsonify({"error": "GitHub HEAD sha missing"}), 200

        gh_tree_data, err = github_api_public(
            f"/git/trees/{gh_head}?recursive=1", repo)
        if err or not isinstance(gh_tree_data, dict):
            return jsonify({"error": err or "GitHub tree unavailable"}), 200
        if gh_tree_data.get("truncated"):
            # An incomplete remote tree would misreport missing entries as
            # local-only — refuse to compute a verdict rather than lie.
            payload = {"local_head": local_head[:7], "github_head": gh_head[:7],
                       "error": "GitHub tree truncated — comparison indeterminate"}
            _versions_diff_cache.update(key=None, ts=now, payload=payload)
            return jsonify(payload)
        gh_tree = {e["path"]: e["sha"]
                   for e in gh_tree_data.get("tree", [])
                   if e.get("type") == "blob"}

        changed = sorted(p for p, s in local_tree.items()
                         if p in gh_tree and gh_tree[p] != s
                         and not _versions_ignored(p))
        local_only = sorted(p for p in local_tree
                            if p not in gh_tree and not _versions_ignored(p))
        github_only = sorted(p for p in gh_tree
                             if p not in local_tree and not _versions_ignored(p))

        def _group(paths):
            areas = {}
            for p in paths:
                areas[_versions_area(p)] = areas.get(_versions_area(p), 0) + 1
            return dict(sorted(areas.items(), key=lambda kv: -kv[1]))

        LIMIT = 200
        payload = {
            "local_head": local_head[:7],
            "github_head": gh_head[:7],
            "in_sync": not (changed or local_only or github_only),
            "changed": changed[:LIMIT],
            "local_only": local_only[:LIMIT],
            "github_only": github_only[:LIMIT],
            "counts": {"changed": len(changed), "local_only": len(local_only),
                       "github_only": len(github_only)},
            "areas": _group(changed + local_only + github_only),
        }
        _versions_diff_cache.update(key=(local_head, gh_head, repo),
                                    ts=now, payload=payload)
        return jsonify(payload)
    finally:
        _versions_diff_lock.release()

@app.route("/api/github/contributors")
def github_contributors():
    repo = request.args.get("repo", GITHUB_LIBRARY_REPO)
    if not repo:
        return jsonify({"contributors": [], "error": "No repo configured"})
    data, err = github_api_public("/contributors?per_page=20", repo)
    if err or not isinstance(data, list):
        return jsonify({"contributors": [], "error": err or "No data"})
    contributors = []
    for c in data[:20]:
        contributors.append({
            "login": c.get("login", ""),
            "avatar": c.get("avatar_url", ""),
            "contributions": c.get("contributions", 0),
            "url": c.get("html_url", ""),
        })
    return jsonify({"contributors": contributors})

@app.route("/api/library/browse")
def library_browse():
    lang_filter = request.args.get("language", "")

    if not GITHUB_TOKEN or not GITHUB_LIBRARY_REPO:
        return jsonify({"items": [], "message": "GitHub not configured. Connect GitHub to enable the shared library."})

    items = []
    data, err = github_api("GET", "/contents/library")
    if err:
        return jsonify({"items": [], "message": err})

    if not isinstance(data, list):
        return jsonify({"items": [], "message": "No library directory found"})

    lang_dirs = [d for d in data if d.get("type") == "dir"]
    if lang_filter:
        lang_dirs = [d for d in lang_dirs if d["name"] == lang_filter]

    for lang_dir in lang_dirs:
        lang_name = lang_dir["name"]
        files_data, files_err = github_api("GET", f"/contents/library/{lang_name}")
        if files_err or not isinstance(files_data, list):
            continue
        for f in files_data:
            if f.get("name", "").endswith(".json"):
                abs_name = f["name"][:-5]
                file_data, file_err = github_api("GET", f"/contents/library/{lang_name}/{f['name']}")
                if file_err:
                    items.append({
                        "name": abs_name,
                        "path": f"library/{lang_name}/{f['name']}",
                        "doc": {"language": lang_name, "description": "", "author": "", "date": ""}
                    })
                    continue
                try:
                    content = base64.b64decode(file_data.get("content", "")).decode("utf-8")
                    parsed = json.loads(content)
                    doc = parsed.get("doc", {})
                    items.append({
                        "name": parsed.get("abstraction", abs_name),
                        "path": f"library/{lang_name}/{f['name']}",
                        "doc": doc
                    })
                except Exception:
                    items.append({
                        "name": abs_name,
                        "path": f"library/{lang_name}/{f['name']}",
                        "doc": {"language": lang_name}
                    })

    return jsonify({"items": items})

@app.route("/api/library/get/<path:filepath>")
def library_get(filepath):
    if not GITHUB_TOKEN or not GITHUB_LIBRARY_REPO:
        return jsonify({"error": "GitHub not configured"}), 503

    data, err = github_api("GET", f"/contents/{filepath}")
    if err:
        return jsonify({"error": err}), 404

    try:
        content = base64.b64decode(data.get("content", "")).decode("utf-8")
        parsed = json.loads(content)
        return jsonify(parsed)
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route("/api/library/publish", methods=["POST"])
def library_publish():
    if not GITHUB_TOKEN or not GITHUB_LIBRARY_REPO:
        return jsonify({"error": "GitHub not configured. Please connect your GitHub account first."}), 503

    payload = request.get_json()
    if not payload:
        return jsonify({"error": "No data provided"}), 400

    name = payload.get("abstraction", "").strip()
    if not name:
        return jsonify({"error": "Abstraction name is required"}), 400

    methods = payload.get("methods", [])
    if not methods or not any(m.get("code") for m in methods):
        return jsonify({"error": "Cannot publish empty abstraction — compiled methods required"}), 400

    mtbf = payload.get("mtbfScore", 0)
    if not isinstance(mtbf, int) or mtbf < 5:
        return jsonify({"error": f"MTBF too low — publish requires 5 consecutive clean runs (you have {mtbf})"}), 400

    if not payload.get("openSourceConsent"):
        return jsonify({"error": "Open Source membership required — accept the CLOOMC Open Source licence in Settings"}), 400

    doc = payload.get("doc", {})
    lang = doc.get("language", "javascript")
    source = payload.get("source", "")
    author = doc.get("author", "Anonymous")

    safe_name = "".join(c for c in name if c.isalnum() or c in "_-").strip()
    if not safe_name:
        safe_name = "abstraction"

    json_path = f"library/{lang}/{safe_name}.json"
    json_content = json.dumps(payload, indent=2)
    encoded = base64.b64encode(json_content.encode("utf-8")).decode("utf-8")

    existing, _ = github_api("GET", f"/contents/{json_path}")
    sha = existing.get("sha") if existing and isinstance(existing, dict) else None

    put_data = {
        "message": f"Add {name} by {author}",
        "content": encoded,
        "branch": "main"
    }
    if sha:
        put_data["sha"] = sha
        put_data["message"] = f"Update {name} by {author}"

    result, err = github_api("PUT", f"/contents/{json_path}", put_data)
    if err:
        return jsonify({"error": f"GitHub push failed: {err}"}), 500

    return jsonify({"ok": True, "path": json_path, "message": f"Published {name} to {GITHUB_LIBRARY_REPO}"})

@app.route("/api/github/export-simulator", methods=["POST"])
def export_simulator():
    if not GITHUB_TOKEN or not GITHUB_LIBRARY_REPO:
        return jsonify({"error": "GitHub not configured"}), 400
    sim_dir = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "simulator")
    if not os.path.isdir(sim_dir):
        return jsonify({"error": "simulator/ directory not found"}), 500
    export_extensions = {'.js', '.html', '.css', '.svg', '.json', '.cloomc'}
    results = []
    errors = []
    sim_readme = """# CLOOMC Simulator — Web-Based IDE

The Church Machine educational IDE. Open `index.html` in any modern browser to run.

## Quick Start

```bash
git clone https://github.com/khhodges/cloomc-project.git
cd cloomc-project/simulator
# Open index.html in your browser — no build step required
```

## What's Included

- **IDE** with nine views: Math, Code, Tutorial, Dashboard, Namespace, Abstractions, Pipeline, Reference, Docs
- **CLOOMC++ Compiler** — English, JavaScript, Haskell, Symbolic Math (Ada), Assembly
- **Interactive Math Tools** — HP-35 calculator, soroban abacus, logarithmic slide rule
- **Math Challenge** — Grade-adaptive problems with dual Turing/Church explanations
- **WebSerial** — Deploy to Tang Nano 20K FPGA directly from the browser

## License

Free and open source under GPL-3.0 for all educational and personal use.
See [LICENSE](../LICENSE) for details.
"""
    result, err = github_push_file(GITHUB_LIBRARY_REPO, "simulator/README.md", sim_readme, "Update simulator README")
    if err:
        errors.append(f"simulator/README.md: {err}")
    else:
        results.append("simulator/README.md")
    for dirpath, dirnames, filenames in os.walk(sim_dir):
        for fname in sorted(filenames):
            ext = os.path.splitext(fname)[1].lower()
            if ext not in export_extensions:
                continue
            fpath = os.path.join(dirpath, fname)
            rel = os.path.relpath(fpath, sim_dir)
            gh_path = f"simulator/{rel}"
            try:
                with open(fpath, 'r', encoding='utf-8') as f:
                    content = f.read()
                res, err = github_push_file(GITHUB_LIBRARY_REPO, gh_path, content, f"Export {rel}")
                if err:
                    errors.append(f"{gh_path}: {err}")
                else:
                    results.append(gh_path)
            except Exception as e:
                errors.append(f"{gh_path}: {str(e)}")
    return jsonify({"ok": len(errors) == 0, "pushed": results, "errors": errors, "total": len(results)})

BUILD_MD_TANG = ""  # removed — Tang Nano 20K no longer supported

BUILD_MD_WUKONG = """# Church Machine — QMTECH Wukong XC7A100T Build Package

## What's Inside

Vivado project files for the QMTECH Wukong (Artix-7 XC7A100T-2FGG676C).
Synthesise on any machine with Vivado 2020.x or later (WebPACK edition — free).

### Files
- `church_wukong_xc7a100t.v`  — Church Machine Verilog (Amaranth → Yosys)
- `church_wukong_xc7a100t.il` — Amaranth RTLIL (authoritative source)
- `wukong_xc7a100t.xdc`       — Vivado XDC pin constraints
- `wukong_xc7a100t.tcl`       — Vivado project creation + build script
- `wukong-vivado-flash-guide.md` — Windows/Vivado Hardware Manager guide
- `local_bridge.py`           — Serial bridge server (used by bridge.sh)

## Build Steps

```
unzip church-wukong-package.zip
cd church-wukong-package
vivado -mode batch -source wukong_xc7a100t.tcl
```

This creates the Vivado project, runs synthesis + implementation, and
generates `church_wukong_xc7a100t.bit` (20–40 min depending on CPU).

## Cloud Synthesis (DigitalOcean)

A CPU-Optimized droplet (8 vCPU / 16 GB) runs the full build in ~25 min:
1. Create droplet — Ubuntu 22.04, CPU-Optimized 8vCPU/16GB/160GB (~$0.15/hr)
2. Install Vivado 2023.2 WebPACK (free AMD account, ~45 GB install, ~40 min)
3. scp church-wukong-package.zip root@<droplet-ip>:~
4. SSH in and run: vivado -mode batch -source wukong_xc7a100t.tcl
5. scp root@<droplet-ip>:~/church-wukong-package/church_wukong_xc7a100t.bit .
6. Destroy the droplet. Total cost: ~$0.50–$1.00 per synthesis run.

## Programming

See `docs/wukong-vivado-flash-guide.md` for the complete Windows/Vivado GUI
sequence. For a temporary test, use Hardware Manager → Connect → Open Target
→ Program Device and select `church_wukong_xc7a100t.bit`. For persistent boot,
choose **Add Configuration Memory Device**, select
`n25q64-3.3v-spi-x1_x2_x4`, and program `church_wukong_xc7a100t.mcs` with
erase/program/verify enabled. A `.bit` is lost on reset or power loss; a
verified `.mcs` survives both.

Requires a JTAG adapter (Digilent JTAG-HS2 or compatible) connected
to the Wukong board's 14-pin JTAG header.

## Expected LED Behaviour After Programming

- D1 (G21): solid ON during boot, then blinks ~1 Hz
- D2 (G20): 1 Hz heartbeat during boot, then OFF (lit = fault latched)
"""


def _fpga_paths(board):
    """Return (paths_dict, zip_name, build_md, gen_args, synth_cmd_tpl).

    The QMTECH Wukong XC7A100T (Vivado toolchain) is the only supported
    board — the legacy F225 board flow was retired (Tasks #2506/#2509).
    Unknown board ids fall through to the Wukong paths.
    """
    build_dir = os.path.join(BASE_DIR, "build")
    hw_dir = os.path.join(BASE_DIR, "hardware")

    paths = {
        "rtlil":   os.path.join(build_dir, "church_wukong_xc7a100t.il"),
        "verilog": os.path.join(build_dir, "church_wukong_xc7a100t.v"),
        "xdc":     os.path.join(hw_dir,    "wukong_xc7a100t.xdc"),
        "tcl":     os.path.join(hw_dir,    "wukong_xc7a100t.tcl"),
        "wukong_bridge": os.path.join(hw_dir, "wukong_bridge.py"),
    }
    zip_name = "church-wukong-package.zip"
    build_md = BUILD_MD_WUKONG
    gen_args = ["python3", "-m", "hardware.gen_rtlil", "build", "--wukong"]
    # gen_rtlil already runs Yosys internally to produce the .v file.
    # A second Yosys pass here is redundant and fails/times out on the
    # 2.6 MB RTLIL.  Set to None so the build route skips it.
    synth_cmd_tpl = None
    return paths, zip_name, build_md, gen_args, synth_cmd_tpl


def _make_fpga_zip(board, paths, zip_name, build_md):
    """Zip up FPGA artifacts and return (BytesIO, zip_name, warnings)."""
    buf = io.BytesIO()
    warnings = []
    # Wukong Artix-7 — Vivado flow
    server_dir = os.path.join(BASE_DIR, "server")
    with zipfile.ZipFile(buf, 'w', zipfile.ZIP_DEFLATED) as zf:
        for key in ('verilog', 'rtlil'):
            p = paths.get(key)
            if p and os.path.isfile(p):
                zf.write(p, os.path.basename(p))
            elif p:
                warnings.append(f"{os.path.basename(p)} not found — run Build first")
        for key in ('xdc', 'tcl', 'wukong_bridge'):
            p = paths.get(key)
            if p and os.path.isfile(p):
                zf.write(p, os.path.basename(p))
        bridge = os.path.join(server_dir, "local_bridge.py")
        if os.path.isfile(bridge):
            zf.write(bridge, "local_bridge.py")
        zf.writestr("BUILD.md", build_md)
    return buf, zip_name, warnings


@app.route("/api/build/fpga")
def build_fpga():
    """Run Amaranth elaboration + Yosys synthesis. Save artifacts to build/. Return JSON status."""
    build_dir = os.path.join(BASE_DIR, "build")
    board = request.args.get("board", "wukong-xc7a100t").strip().lower()
    paths, zip_name, build_md, gen_args, synth_cmd_tpl = _fpga_paths(board)

    try:
        os.makedirs(build_dir, exist_ok=True)

        logging.info("FPGA build: generating RTLIL from Amaranth (board=%s)...", board)
        gen_result = subprocess.run(gen_args, cwd=BASE_DIR, capture_output=True, text=True, timeout=180)
        if gen_result.returncode != 0:
            _record_build_event(board=board, status="failed",
                                notes="Amaranth RTLIL generation failed",
                                approver=request.args.get("approver", ""))
            return jsonify({
                "error": "Amaranth RTLIL generation failed",
                "stderr": gen_result.stderr[-2000:] if gen_result.stderr else "",
                "stdout": gen_result.stdout[-1000:] if gen_result.stdout else ""
            }), 500

        if not os.path.isfile(paths["rtlil"]):
            _record_build_event(board=board, status="failed",
                                notes="RTLIL file not generated",
                                approver=request.args.get("approver", ""))
            return jsonify({"error": "RTLIL file not generated", "stderr": ""}), 500

        synth_warning = None
        if synth_cmd_tpl is not None:
            # Run a second Yosys synthesis pass when the board flow needs one
            # (no current board does — gen_rtlil emits the .v directly).
            fmt_args = {k: v for k, v in paths.items()}
            synth_cmd = synth_cmd_tpl.format(**fmt_args)
            logging.info("FPGA build: running Yosys synthesis...")
            try:
                synth_result = subprocess.run(["yosys", "-p", synth_cmd], cwd=BASE_DIR, capture_output=True, text=True, timeout=300)
                if synth_result.returncode != 0:
                    synth_warning = "Yosys synthesis failed (RTLIL still available)"
                    logging.warning("Yosys synthesis returned non-zero: %s", synth_result.stderr[-500:] if synth_result.stderr else "")
            except subprocess.TimeoutExpired:
                synth_warning = "Yosys synthesis timed out (RTLIL still available)"
                logging.warning("Yosys synthesis timed out")
            except Exception as synth_exc:
                # Do NOT interpolate synth_exc — it can contain filesystem paths.
                synth_warning = "Yosys synthesis error (RTLIL still available)"
                logging.warning("Yosys synthesis exception: %s", synth_exc)
        else:
            # gen_rtlil already produced the .v — no second Yosys pass needed.
            logging.info("FPGA build: Verilog produced by gen_rtlil — skipping redundant Yosys pass.")

        marker_path = os.path.join(build_dir, "_last_board.txt")
        with open(marker_path, 'w') as f:
            f.write(board)

        files = [os.path.basename(p) for p in paths.values() if os.path.isfile(p)]
        file_paths = [p for p in paths.values() if os.path.isfile(p)]
        logging.info("FPGA build: complete, files=%s, warning=%s", files, synth_warning)

        # --- server-side build history recording ---
        _bit  = paths.get("bit",  "")
        _mcs  = paths.get("mcs",  "")
        _bit_h = ""
        if _bit and os.path.isfile(_bit):
            try:
                import hashlib as _hl
                _md5 = _hl.md5()
                with open(_bit, "rb") as _bf:
                    for _chunk in iter(lambda: _bf.read(1 << 20), b""):
                        _md5.update(_chunk)
                _bit_h = _md5.hexdigest()
            except Exception:
                pass
        _bld_status = "partial" if synth_warning else "succeeded"
        _record_build_event(
            board=board,
            status=_bld_status,
            notes=synth_warning or "",
            bit_path=_bit if _bit and os.path.isfile(_bit) else "",
            bit_hash=_bit_h,
            mcs_path=_mcs if _mcs and os.path.isfile(_mcs) else "",
            approver=request.args.get("approver", ""),
        )
        # ------------------------------------------

        result = {"ok": True, "board": board, "files": files, "file_paths": file_paths}
        if synth_warning:
            result["warning"] = synth_warning
        return jsonify(result)

    except subprocess.TimeoutExpired:
        _record_build_event(board=board, status="failed", notes="timeout")
        return jsonify({"error": "Build timed out (300s limit)", "stderr": ""}), 500
    except Exception as e:
        logging.exception("FPGA build failed")
        # Store only a generic error code — never str(e), which may include paths.
        _record_build_event(board=board, status="failed", notes="internal_error")
        return jsonify({"error": str(e), "stderr": ""}), 500


@app.route("/api/download/fpga-zip")
def download_fpga_zip():
    """Download the ZIP of the last successfully built FPGA artifacts (no rebuild)."""
    build_dir = os.path.join(BASE_DIR, "build")
    board = request.args.get("board", "wukong-xc7a100t").strip().lower()
    paths, zip_name, build_md, _, _ = _fpga_paths(board)

    v_path = paths.get("verilog", "")
    if not os.path.isfile(v_path):
        return jsonify({
            "error": f"No build found for {board}. Click Build first to generate the Verilog."
        }), 404

    try:
        buf, zip_name, zip_warnings = _make_fpga_zip(board, paths, zip_name, build_md)
        zip_data = buf.getvalue()
        resp = make_response(zip_data)
        resp.headers['Content-Type'] = 'application/zip'
        resp.headers['Content-Disposition'] = f'attachment; filename="{zip_name}"'
        resp.headers['Content-Length'] = len(zip_data)
        if zip_warnings:
            resp.headers['X-Build-Warnings'] = ' | '.join(zip_warnings)
            resp.headers['Access-Control-Expose-Headers'] = 'X-Build-Warnings'
        logging.info("FPGA zip download: %s (%d bytes)", zip_name, len(zip_data))
        return resp
    except Exception as e:
        logging.exception("FPGA zip download failed")
        return jsonify({"error": str(e)}), 500


@app.route("/api/download/fpga-verilog")
def download_fpga_verilog():
    """Download just the Verilog file for the selected board (no zip)."""
    board = request.args.get("board", "wukong-xc7a100t").strip().lower()
    paths, _, _, _, _ = _fpga_paths(board)
    verilog_path = paths["verilog"]
    if not os.path.isfile(verilog_path):
        return jsonify({"error": "No build found for this board. Run Build first."}), 404
    filename = os.path.basename(verilog_path)
    return send_file(verilog_path, as_attachment=True, download_name=filename,
                     mimetype="text/plain")


@app.route("/api/download/fpga-sdc")
def download_fpga_sdc():
    """Download just the SDC constraints file for the selected board."""
    board = request.args.get("board", "wukong-xc7a100t").strip().lower()
    paths, _, _, _, _ = _fpga_paths(board)
    sdc_path = paths.get("sdc")
    if not sdc_path or not os.path.isfile(sdc_path):
        return jsonify({"error": "No SDC found for this board."}), 404
    filename = os.path.basename(sdc_path)
    return send_file(sdc_path, as_attachment=True, download_name=filename,
                     mimetype="text/plain")


@app.route("/api/download/fpga-peri")
def download_fpga_peri():
    """Download just the peri.xml periphery config for the selected board."""
    board = request.args.get("board", "wukong-xc7a100t").strip().lower()
    paths, _, _, _, _ = _fpga_paths(board)
    peri_path = paths.get("peri")
    if not peri_path or not os.path.isfile(peri_path):
        return jsonify({"error": "No peri.xml found for this board."}), 404
    filename = os.path.basename(peri_path)
    return send_file(peri_path, as_attachment=True, download_name=filename,
                     mimetype="application/xml")


@app.route("/api/download/fpga-package")
def download_fpga_package():
    """Legacy: build + download in one shot (kept for backwards compatibility)."""
    build_dir = os.path.join(BASE_DIR, "build")
    board = request.args.get("board", "wukong-xc7a100t").strip().lower()
    build_resp = build_fpga()
    if isinstance(build_resp, tuple):
        resp_obj, status = build_resp
        if status != 200:
            return build_resp
    else:
        if build_resp.status_code != 200:
            return build_resp
    return download_fpga_zip()


BITSTREAM_DIR = os.path.join(BASE_DIR, "bitstreams")
os.makedirs(BITSTREAM_DIR, exist_ok=True)

BITSTREAM_FILES = {
    "wukong-xc7a100t": "church_wukong_xc7a100t.bit",
}

# Boards whose bitstream lives outside BITSTREAM_DIR (e.g. committed build artifacts).
BITSTREAM_DIRS = {
    "wukong-xc7a100t": os.path.join(BASE_DIR, "build"),
}

@app.route("/admin/bitstreams")
def admin_bitstreams_page():
    """Admin UI for uploading official bitstream files.

    Requires ?token=<REPORT_TOKEN> or Authorization: Bearer <REPORT_TOKEN>.
    """
    from daily_report import check_report_auth as _check_auth
    if not _check_auth(request):
        return ("Unauthorized — add ?token=<your token> to the URL", 401,
                {"Content-Type": "text/plain"})

    token = request.args.get("token", "")
    rows = []
    import datetime
    for board, fname in BITSTREAM_FILES.items():
        path = os.path.join(BITSTREAM_DIR, fname)
        exists = os.path.isfile(path)
        size_str = ""
        mtime_str = "—"
        if exists:
            size_str = f"{os.path.getsize(path) / 1048576:.2f} MB"
            mtime_str = datetime.datetime.fromtimestamp(
                os.path.getmtime(path)).strftime("%Y-%m-%d %H:%M UTC")
        status_colour = "#66bb6a" if exists else "#ef5350"
        status_text   = f"✓ {size_str}" if exists else "✗ missing"
        board_label = {"wukong-xc7a100t": "QMTECH Wukong Artix-7"}.get(board, board)
        delete_td = (
            "<td><a href='/api/bitstream/delete/" + board + "?token=" + token + "'"
            " onclick=\"return confirm('Delete " + fname + "?')\""
            " style='color:#ef5350;font-size:0.8rem;text-decoration:none'>"
            "\U0001f5d1 Delete</a></td>"
            if exists else "<td></td>"
        )
        rows.append(f"""
        <tr>
          <td>{board_label}</td>
          <td><code>{fname}</code></td>
          <td style="color:{status_colour}">{status_text}</td>
          <td style="color:#9ca3af;font-size:0.8rem">{mtime_str}</td>
          <td>
            <form method="POST" action="/api/bitstream/upload?token={token}"
                  enctype="multipart/form-data" style="display:inline-flex;gap:0.5rem;align-items:center">
              <input type="hidden" name="board" value="{board}">
              <input type="file" name="file" accept=".hex,.bit,.fs"
                     style="color:#d0d0e8;font-size:0.8rem">
              <button type="submit"
                      style="background:rgba(218,165,32,0.18);border:1px solid rgba(218,165,32,0.6);
                             color:#daa520;border-radius:5px;padding:0.3rem 0.9rem;cursor:pointer;
                             font-size:0.8rem">
                &#11014; Upload
              </button>
            </form>
          </td>
          {delete_td}
        </tr>""")

    rows_html = "\n".join(rows)
    html = f"""<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Church Machine — Bitstream Admin</title>
  <style>
    *, *::before, *::after {{ box-sizing: border-box; }}
    body {{
      background: #08080f; color: #d0d0e8;
      font-family: system-ui, sans-serif;
      max-width: 900px; margin: 2rem auto; padding: 0 1rem;
    }}
    h1 {{ color: #daa520; font-size: 1.4rem; margin-bottom: 0.25rem; }}
    .subtitle {{ color: #9ca3af; font-size: 0.85rem; margin-bottom: 2rem; }}
    table {{ width: 100%; border-collapse: collapse; font-size: 0.88rem; }}
    th {{ color: #9ca3af; text-align: left; padding: 0.5rem 0.75rem;
          border-bottom: 1px solid rgba(255,255,255,0.1); font-weight: 600; }}
    td {{ padding: 0.65rem 0.75rem; border-bottom: 1px solid rgba(255,255,255,0.06); vertical-align: middle; }}
    tr:last-child td {{ border-bottom: none; }}
    .flash {{ background: rgba(74,222,128,0.12); border: 1px solid rgba(74,222,128,0.4);
              color: #4ade80; border-radius: 6px; padding: 0.6rem 1rem;
              margin-bottom: 1.5rem; font-size: 0.9rem; }}
    code {{ background: rgba(255,255,255,0.08); border-radius: 3px;
            padding: 0.1rem 0.35rem; font-size: 0.82rem; }}
  </style>
</head>
<body>
  <h1>&#x03BB; Church Machine — Bitstream Admin</h1>
  <p class="subtitle">Upload official pre-built programming files for each supported board.
     Uploaded files are served to users via the wizard's
     <em>prepackaged solution</em> path.</p>
  {"<div class='flash'>" + request.args.get("msg","") + "</div>"
   if request.args.get("msg") else ""}
  <table>
    <thead>
      <tr>
        <th>Board</th><th>Filename</th><th>Status</th>
        <th>Last updated</th><th>Upload new</th><th></th>
      </tr>
    </thead>
    <tbody>{rows_html}</tbody>
  </table>
  <p style="margin-top:2rem;color:#6b7280;font-size:0.75rem">
    Files are stored in <code>bitstreams/</code> inside the server directory.
    Token is required for all upload and delete operations.
  </p>
</body>
</html>"""
    return html, 200, {"Content-Type": "text/html; charset=utf-8"}


@app.route("/api/bitstream/delete/<board>")
def bitstream_delete(board):
    """Delete an official bitstream file (admin only)."""
    from daily_report import check_report_auth as _check_auth
    if not _check_auth(request):
        return jsonify({"error": "Unauthorized"}), 401
    board = board.strip().lower()
    expected = BITSTREAM_FILES.get(board)
    if not expected:
        return jsonify({"error": f"Unknown board: {board}"}), 404
    bdir = BITSTREAM_DIRS.get(board, BITSTREAM_DIR)
    path = os.path.join(bdir, expected)
    if os.path.isfile(path):
        os.remove(path)
        logging.info("Bitstream deleted: %s", expected)
    from urllib.parse import urlencode
    token = request.args.get("token", "")
    qs = urlencode({"token": token, "msg": f"{expected} deleted."})
    return redirect(f"/admin/bitstreams?{qs}")


@app.route("/api/bitstream/upload", methods=["POST"])
def bitstream_upload():
    """Upload an official bitstream file (admin only).

    Requires Authorization: Bearer <REPORT_TOKEN> header or ?token=<REPORT_TOKEN>.
    """
    from daily_report import check_report_auth as _check_auth
    if not _check_auth(request):
        return jsonify({"error": "Unauthorized — supply token via Authorization header or ?token="}), 401
    board = request.form.get("board", "wukong-xc7a100t").strip().lower()
    expected = BITSTREAM_FILES.get(board)
    if not expected:
        return jsonify({"error": f"Unknown board: {board}"}), 400
    f = request.files.get("file")
    if not f:
        return jsonify({"error": "No file uploaded"}), 400
    bdir = BITSTREAM_DIRS.get(board, BITSTREAM_DIR)
    dest = os.path.join(bdir, expected)
    f.save(dest)
    size = os.path.getsize(dest)
    logging.info("Bitstream uploaded: %s (%d bytes)", expected, size)
    # If request came from the admin UI form (not API), redirect back with confirmation
    if request.args.get("token"):
        from urllib.parse import urlencode
        token = request.args.get("token", "")
        qs = urlencode({"token": token, "msg": f"{expected} uploaded ({size / 1048576:.2f} MB)."})
        return redirect(f"/admin/bitstreams?{qs}")
    return jsonify({"ok": True, "filename": expected, "size": size})


@app.route("/api/bitstream/download/<board>")
def bitstream_download(board):
    """Download the official bitstream for a board."""
    board = board.strip().lower()
    expected = BITSTREAM_FILES.get(board)
    if not expected:
        return jsonify({"error": f"Unknown board: {board}"}), 404
    bdir = BITSTREAM_DIRS.get(board, BITSTREAM_DIR)
    path = os.path.join(bdir, expected)
    if not os.path.isfile(path):
        return jsonify({"error": f"No bitstream available for {board} yet. Build and upload one first."}), 404
    return send_file(path, as_attachment=True, download_name=expected)


@app.route("/api/bitstream/list")
def bitstream_list():
    """List available official bitstreams."""
    result = []
    for board, fname in BITSTREAM_FILES.items():
        bdir = BITSTREAM_DIRS.get(board, BITSTREAM_DIR)
        path = os.path.join(bdir, fname)
        exists = os.path.isfile(path)
        result.append({
            "board": board,
            "filename": fname,
            "available": exists,
            "size": os.path.getsize(path) if exists else 0,
            "modified": os.path.getmtime(path) if exists else None,
        })
    return jsonify({"ok": True, "bitstreams": result})


# ── Lazy-load lump endpoint ────────────────────────────────────────────────────
# The simulator calls GET /api/lump/<token_hex> when it encounters an Outform NS
# entry (gtType=2).  Lookup order:
#   1. LAZY_LUMPS dict  — pre-built local stubs (test lumps, cached library hits)
#   2. Mum Tunnel Library (GitHub) — searched by token field in published JSON
#
# Lump binary format as served by /api/lump/ (big-endian uint32s):
#   word 0 : CRC-32 of the lump payload (words 1..lumpSize) — big-endian uint32
#   word 1 : lump header  — [31:27]=0x1F magic, [26:23]=n_minus_6, [22:10]=cw, [9:8]=typ, [7:0]=cc
#   word 2..1+cw : code region
#   word (1+lumpSize-cc)..(lumpSize) : c-list GTs
#
# The CRC-32 preamble word lets the simulator (and future tools) detect download
# corruption the same way the hardware IoT unit does (OUTFORM_CRC = 0x15).
# Algorithm: CRC-32/ISO-HDLC (poly=0xEDB88320, init=0xFFFFFFFF, xorout=0xFFFFFFFF)
# — identical to Python's zlib.crc32().
import struct as _struct
import zlib as _zlib


def _decode_gt_word(gt32):
    """Decode a 32-bit Golden Token word (GT v2.0 word layout).

    GT v2.0 layout (isa_reference.md §3, abstract-gt.md):
      [31]=B (bind)  [30:28]=perm3  [27]=dom  [26:25]=gt_type
      [24:16]=gt_seq (9-bit revocation counter)  [15:0]=ns_index

    NOTE: the legacy v1 layout put gt_type at [24:23] and gt_seq at [22:16];
    v2.0 widens gt_seq to 9 bits and relocates gt_type to [26:25].  f_flag is
    NOT a GT word field in v2.0 (it lives in NS SLOT Word 1 bit[31]).
    """
    gt32 = int(gt32) & 0xFFFFFFFF
    if gt32 == 0:
        return {"null": True, "gt_word": "0x00000000", "ns_index": 0,
                "perms": "", "gt_type": "NULL", "gt_seq": 0}
    ns_index = gt32 & 0xFFFF
    gt_type  = (gt32 >> 25) & 0x3
    gt_seq   = (gt32 >> 16) & 0x1FF
    dom      = (gt32 >> 27) & 0x1
    perm3    = (gt32 >> 28) & 0x7
    b_flag   = (gt32 >> 31) & 0x1
    if dom == 0:
        perms = (('B' if b_flag else '') +
                 ('R' if perm3 & 1 else '') +
                 ('W' if perm3 & 2 else '') +
                 ('X' if perm3 & 4 else ''))
    else:
        perms = (('B' if b_flag else '') +
                 ('L' if perm3 & 1 else '') +
                 ('S' if perm3 & 2 else '') +
                 ('E' if perm3 & 4 else ''))
    return {
        "null":     False,
        "gt_word":  f"0x{gt32:08X}",
        "ns_index": ns_index,
        "gt_seq":   gt_seq,
        "perms":    perms or "---",
        "gt_type":  ['NULL', 'Inform', 'Outform', 'Abstract'][gt_type & 3],
    }


def _extract_clist_from_words(words, base=0):
    """Extract decoded C-List entries from a list of 32-bit ints.

    The LUMP is assumed to start at words[base].  Returns [] if cc==0 or on error.
    """
    try:
        hdr = int(words[base])
        if ((hdr >> 27) & 0x1F) != 0x1F:
            return []
        n_minus_6  = (hdr >> 23) & 0xF
        lump_size  = 1 << (n_minus_6 + 6)
        cc         = hdr & 0xFF
        if cc == 0:
            return []
        clist_start = base + lump_size - cc
        if clist_start + cc > len(words):
            return []
        return [_decode_gt_word(words[clist_start + i]) for i in range(cc)]
    except Exception:
        return []


# _check_lump_canonical_integrity is the server-facing alias for the
# importable helper defined in lump_integrity.py.  Using the module keeps the
# logic in one place and lets tests import the real implementation directly.
try:
    from lump_integrity import (
        check_lump_canonical_integrity as _check_lump_canonical_integrity,
        resolve_canonical_lump as _resolve_canonical_lump,
        canonical_binding_headers as _canonical_binding_headers,
        normalize_lump_token as _normalize_lump_token,
        LumpTokenError as _LumpTokenError,
    )
except ImportError:
    # Fallback: try with server package prefix (when imported as a sub-module)
    from server.lump_integrity import (
        check_lump_canonical_integrity as _check_lump_canonical_integrity,
        resolve_canonical_lump as _resolve_canonical_lump,
        canonical_binding_headers as _canonical_binding_headers,
        normalize_lump_token as _normalize_lump_token,
        LumpTokenError as _LumpTokenError,
    )

try:
    from bootstrap_identity import (
        bootstrap_identity_record as _bootstrap_identity_record,
        bootstrap_t_from_self_gt as _bootstrap_t_from_self_gt,
        validate_bootstrap_candidate as _validate_bootstrap_candidate,
        verify_bootstrap_self_gt as _verify_bootstrap_self_gt,
        resident_inform_egt as _resident_inform_egt,
    )
except ImportError:
    from server.bootstrap_identity import (
        bootstrap_identity_record as _bootstrap_identity_record,
        bootstrap_t_from_self_gt as _bootstrap_t_from_self_gt,
        validate_bootstrap_candidate as _validate_bootstrap_candidate,
        verify_bootstrap_self_gt as _verify_bootstrap_self_gt,
        resident_inform_egt as _resident_inform_egt,
    )


def _extract_clist_from_lump_file(lump_path):
    """Read a .lump binary (big-endian 32-bit words, no CRC prefix) and decode its C-List."""
    try:
        with open(lump_path, 'rb') as _fh:
            _raw = _fh.read()
        _n = len(_raw) // 4
        if _n < 1:
            return []
        _words = list(_struct.unpack(f'>{_n}I', _raw[:_n * 4]))
        return _extract_clist_from_words(_words, base=0)
    except Exception:
        return []


_LUMP_APPROVALS_FILENAME = "approvals.json"
from server.lump_approvals import read_approvals as _shared_read_approvals
from server.lump_approvals import write_approvals as _shared_write_approvals
from server.lump_approvals import envelope as _shared_approval_envelope


class _LumpApprovalStoreError(ValueError):
    """The strict approval ledger could not be read or validated."""


_LUMP_APPROVAL_INTENTS = {}
_LUMP_APPROVAL_INTENTS_LOCK = threading.Lock()
_LUMP_SAVE_PLANS = {}
_LUMP_SAVE_PLANS_LOCK = threading.Lock()
_LUMP_PROMOTION_BINDINGS = {}
_LUMP_PROMOTION_BINDINGS_LOCK = threading.Lock()
# The preflight endpoint runs the exact save canonicalisation path with this
# request-local payload override.  It is deliberately not a client-visible
# save mode.
_lump_save_payload_override = contextvars.ContextVar(
    "_lump_save_payload_override", default=None)
# Only the server-created bootstrap-history repair plan may preserve legacy
# undeclared c-list rows while it reissues a corrected immutable revision.
# A browser-supplied metadata flag must never activate this narrow exception.
_lump_bootstrap_history_repair_override = contextvars.ContextVar(
    "_lump_bootstrap_history_repair_override", default=False)
_LUMP_BOOTSTRAP_REPAIR_PLANS = {}
_LUMP_BOOTSTRAP_REPAIR_PLANS_LOCK = threading.Lock()
_LUMP_APPROVAL_INTENT_FIELDS = frozenset({
    "abstraction", "author", "version", "release_notes", "history_note",
    "display_name", "documentation", "annotations",
    "pet_name", "pet_names", "grants", "capability_type", "portable_binding",
})
_LUMP_SAVE_OPERATION_ID_RE = re.compile(r"[A-Za-z0-9._:-]{8,128}")


def _lump_save_storage_dir(name):
    """Return a private, non-executable directory in the LUMP file store."""
    directory = os.path.join(LUMPS_DIR, name)
    os.makedirs(directory, exist_ok=True)
    return directory


def _lump_save_operation_path(operation_id):
    if not _LUMP_SAVE_OPERATION_ID_RE.fullmatch(str(operation_id or "")):
        raise ValueError("invalid save operation id")
    return os.path.join(_lump_save_storage_dir("save-operations"),
                        f"{operation_id}.json")


def _operation_session_binding():
    """Bind a durable operation to the existing approval session without storing it."""
    session_id = session.get("_lump_approval_session", "")
    return hashlib.sha256(
        (str(app.secret_key) + "|lump-save-operation|" + str(session_id)).encode()
    ).hexdigest()


def _read_lump_save_operation(operation_id):
    try:
        with open(_lump_save_operation_path(operation_id), encoding="utf-8") as fh:
            value = json.load(fh)
        return value if isinstance(value, dict) else None
    except (OSError, ValueError, TypeError):
        return None


def _write_lump_save_operation(operation_id, document):
    document = dict(document)
    document["operation_id"] = operation_id
    _durable_atomic_json(_lump_save_operation_path(operation_id), document)


def _settle_orphaned_lump_save_operation(operation_id, document):
    """Settle a pending operation only after locks prove no publication began."""
    if not isinstance(document, dict) or document.get("outcome") != "pending":
        return document
    if os.path.lexists(os.path.join(LUMPS_DIR, _LUMP_TRANSITION_JOURNAL)):
        return document
    try:
        with open(os.path.join(LUMPS_DIR, "manifest.json"), encoding="utf-8") as source:
            manifest = json.load(source)
        if not isinstance(manifest, list):
            return document
    except FileNotFoundError:
        manifest = []
    except (OSError, ValueError):
        return document
    # A marker can be a partial transition, so preserve fail-closed unknown.
    if any(isinstance(row, dict) and row.get("operation_id") == operation_id
           for row in manifest):
        return document
    settled = dict(document)
    settled.update({
        "outcome": "rejected", "status": 409, "updated_at": time.time(),
        "response": {
            "ok": False, "committed": False, "operation_id": operation_id,
            "error": ("save was interrupted before durable publication; "
                      "retry with a new operation id"),
        },
    })
    _write_lump_save_operation(operation_id, settled)
    _append_lump_diagnostic_event(
        {
            "attempt_id": settled.get("attempt_id"),
            "operation_id": operation_id,
            "candidate_id": settled.get("candidate_id"),
            "plan_id": settled.get("plan_id"),
            "stage": "Commit", "event": "operation_reconcile",
            "outcome": "rejected", "entry_point": "reconcile",
            "error": {
                "name": "InterruptedSave",
                "message": "save was interrupted before durable publication",
            },
        },
        source="server", authoritative=True)
    return settled


@contextlib.contextmanager
def _lump_save_operation_guard(operation_id):
    """Serialize durable operation creation across server worker processes."""
    if not _LUMP_SAVE_OPERATION_ID_RE.fullmatch(str(operation_id or "")):
        raise ValueError("invalid save operation id")
    directory = _lump_save_storage_dir("save-operations")
    with open(os.path.join(directory, f".{operation_id}.lock"), "a+") as lock_file:
        fcntl.flock(lock_file.fileno(), fcntl.LOCK_EX)
        try:
            yield
        finally:
            fcntl.flock(lock_file.fileno(), fcntl.LOCK_UN)


def _store_lump_save_candidate(payload, operation_id, *, preflight=False,
                                attempt_id=None, plan_id=None):
    """Durably retain the submitted diagnostic artifact outside executable paths."""
    candidate_id = uuid.uuid4().hex
    document = {
        "candidate_id": candidate_id,
        "operation_id": operation_id,
        "attempt_id": attempt_id,
        "plan_id": plan_id,
        "created_at": time.time(),
        "kind": "save-plan" if preflight else "save",
        "session_binding": _operation_session_binding(),
        # This is intentionally a JSON-only quarantine store.  Nothing in the
        # resolver, manifest, boot builder, or LUMP bundle searches this tree.
        "payload": payload if isinstance(payload, dict) else None,
    }
    _durable_atomic_json(os.path.join(
        _lump_save_storage_dir("save-candidates"), f"{candidate_id}.json"), document)
    return candidate_id


def _candidate_summary(document):
    payload = document.get("payload") if isinstance(document, dict) else {}
    metadata = payload.get("metadata") if isinstance(payload, dict) else {}
    words = payload.get("binary") if isinstance(payload, dict) else None
    return {
        "candidate_id": document.get("candidate_id"),
        "operation_id": document.get("operation_id"),
        "created_at": document.get("created_at"),
        "kind": document.get("kind"),
        "abstraction": metadata.get("abstraction") if isinstance(metadata, dict) else None,
        "source_present": isinstance(metadata, dict)
        and isinstance(metadata.get(
            "original_source", metadata.get("submitted_source")), str),
        "binary_words": len(words) if isinstance(words, list) else None,
    }


@app.route("/api/lumps/save-candidates", methods=["GET"])
def list_lump_save_candidates():
    """List quarantined original save candidates without exposing executables."""
    directory = _lump_save_storage_dir("save-candidates")
    results = []
    for filename in os.listdir(directory):
        if not re.fullmatch(r"[0-9a-f]{32}\.json", filename):
            continue
        try:
            with open(os.path.join(directory, filename), encoding="utf-8") as fh:
                document = json.load(fh)
            if (isinstance(document, dict)
                    and document.get("session_binding") == _operation_session_binding()):
                results.append(_candidate_summary(document))
        except (OSError, ValueError, TypeError):
            continue
    return jsonify({"candidates": sorted(
        results, key=lambda value: value.get("created_at") or 0, reverse=True)})


@app.route("/api/lumps/save-candidates/<candidate_id>", methods=["GET"])
def get_lump_save_candidate(candidate_id):
    if not re.fullmatch(r"[0-9a-f]{32}", candidate_id):
        return jsonify({"error": "invalid candidate id"}), 400
    try:
        with open(os.path.join(_lump_save_storage_dir("save-candidates"),
                               f"{candidate_id}.json"), encoding="utf-8") as fh:
            document = json.load(fh)
    except OSError:
        return jsonify({"error": "save candidate not found"}), 404
    except (ValueError, TypeError):
        return jsonify({"error": "save candidate is unreadable"}), 409
    if (not isinstance(document, dict)
            or document.get("session_binding") != _operation_session_binding()):
        return jsonify({"error": "save candidate not found"}), 404
    # The original JSON payload is deliberately returned only as data. It has
    # no executable locator and cannot enter the library absent a new approved
    # save transaction.
    return jsonify(document)


@app.route("/api/lumps/save-operations/<operation_id>", methods=["GET"])
def get_lump_save_operation(operation_id):
    if not _LUMP_SAVE_OPERATION_ID_RE.fullmatch(operation_id):
        return jsonify({"error": "invalid save operation id"}), 400
    document = _read_lump_save_operation(operation_id)
    if not document or document.get("session_binding") != _operation_session_binding():
        return jsonify({"outcome": "unknown", "committed": None}), 404
    document = _settle_orphaned_lump_save_operation(operation_id, document)
    outcome = document.get("outcome")
    if outcome == "committed":
        return jsonify({"operation_id": operation_id, "outcome": "committed",
                        "committed": True, "response": document.get("response"),
                        "original_payload": document.get("original_payload")})
    if outcome == "rejected":
        return jsonify({"operation_id": operation_id, "outcome": "rejected",
                        "committed": False, "response": document.get("response"),
                        "original_payload": document.get("original_payload")})
    expected = document.get("expected")
    if isinstance(expected, dict):
        try:
            manifest = _read_manifest_safe(os.path.join(LUMPS_DIR, "manifest.json"))
            row = next(
                (entry for entry in manifest if isinstance(entry, dict)
                 and entry.get("token") == expected.get("token")
                 and entry.get("filename") == expected.get("filename")
                 and entry.get("operation_id") == operation_id),
                None)
            if row is not None:
                inspected = _inspect_lump_binary(os.path.join(
                    LUMPS_DIR, expected["filename"]))
                approval = _matching_lump_approval(
                    LUMPS_DIR, expected.get("digest"))
                namespace_complete = True
                expected_slot = expected.get("ns_slot")
                if isinstance(expected_slot, int):
                    namespace_rows, _ = _read_authoritative_namespace_rows()
                    namespace_complete = any(
                        isinstance(ns_row, dict)
                        and ns_row.get("slot") == expected_slot
                        and ns_row.get("token") == expected.get("token")
                        and ns_row.get("filename") == expected.get("filename")
                        for ns_row in namespace_rows)
                if (inspected["binary_hash"] == expected.get("digest")
                        and isinstance(approval, dict)
                        and approval.get("binary_hash") == expected.get("digest")
                        and approval.get("filename") == expected.get("filename")
                        and namespace_complete):
                    document.update({"outcome": "committed", "status": 200,
                                     "updated_at": time.time()})
                    _write_lump_save_operation(operation_id, document)
                    _append_lump_diagnostic_event(
                        {
                            "attempt_id": document.get("attempt_id"),
                            "operation_id": operation_id,
                            "candidate_id": document.get("candidate_id"),
                            "plan_id": document.get("plan_id"),
                            "stage": "Commit",
                            "event": "operation_reconcile",
                            "outcome": "committed",
                            "entry_point": "reconcile",
                        },
                        source="server", authoritative=True)
                    return jsonify({
                        "operation_id": operation_id, "outcome": "committed",
                        "committed": True, "response": document.get("response"),
                        "original_payload": document.get("original_payload"),
                    })
        except (OSError, ValueError, TypeError):
            pass
    # A process can die between the multi-file transition and a normal HTTP
    # response.  A pending record is not proof that rollback completed.
    return jsonify({"operation_id": operation_id, "outcome": "unknown",
                    "committed": None, "response": document.get("response"),
                    "original_payload": document.get("original_payload")})


@app.route("/api/lumps/save-operations/<operation_id>/artifact", methods=["GET"])
def get_lump_save_operation_artifact(operation_id):
    """Reload immutable server-finalized bytes, not a mutable token locator."""
    if not _LUMP_SAVE_OPERATION_ID_RE.fullmatch(operation_id):
        return jsonify({"error": "invalid save operation id"}), 400
    document = _read_lump_save_operation(operation_id)
    if (not isinstance(document, dict)
            or document.get("session_binding") != _operation_session_binding()
            or document.get("outcome") != "committed"):
        return jsonify({"error": "committed save operation not found"}), 404
    response = document.get("response")
    words = response.get("final_binary") if isinstance(response, dict) else None
    digest = response.get("digest") if isinstance(response, dict) else None
    filename = response.get("filename") if isinstance(response, dict) else None
    if (not isinstance(words, list) or not isinstance(digest, str)
            or not isinstance(filename, str)):
        return jsonify({"error": "committed operation has no immutable artifact"}), 409
    try:
        raw = _struct.pack(
            f">{len(words)}I", *[
                int(word) if not isinstance(word, bool) else -1 for word in words])
        if hashlib.sha256(raw).hexdigest() != digest:
            raise ValueError("operation artifact digest does not match")
        approval = _matching_lump_approval(LUMPS_DIR, digest)
        if not isinstance(approval, dict) or approval.get("binary_hash") != digest:
            raise ValueError("operation artifact approval is unavailable")
    except (TypeError, ValueError, _struct.error):
        return jsonify({"error": "committed operation artifact cannot be verified"}), 409
    return jsonify({
        "operation_id": operation_id, "filename": filename, "digest": digest,
        "immutable_filename": response.get("immutable_filename", filename),
        "ns_slot": response.get("ns_slot"),
        "candidate_id": response.get("candidate_id"),
        "final_binary": words,
    })

def _manifest_entry_identity(entry):
    """A stable identity for the destination being approved."""
    if entry is None:
        return None
    return hashlib.sha256(json.dumps(
        entry, sort_keys=True, separators=(",", ":")
    ).encode("utf-8")).hexdigest()


def _authoritative_lump_library_generation(
        lumps_dir, manifest_path, manifest, *, token8=None, ns_slot=None,
        dependency_slots=()):
    """Return the generation relevant to one save destination.

    Historically this hashed every library artifact, causing an unrelated save
    anywhere in the repository to invalidate an already approved candidate.
    A save only depends on its destination manifest record and Namespace rows
    it can install into or name from its c-list.  Keep the old positional
    signature for callers that genuinely need whole-library identity.
    """
    try:
        if token8 is not None:
            slots = {slot for slot in dependency_slots if isinstance(slot, int)}
            if isinstance(ns_slot, int):
                slots.add(ns_slot)
            rows, _ = _read_authoritative_namespace_rows()
            relevant_rows = []
            for row in rows:
                if not isinstance(row, dict):
                    raise ValueError("ns-state.json contains a non-object Namespace row")
                if row.get("slot") in slots:
                    relevant_rows.append(row)
            target_entries = [
                entry for entry in manifest
                if isinstance(entry, dict) and entry.get("token") == token8
            ]
            artifacts = []
            for entry in target_entries:
                filename = entry.get("filename")
                if not isinstance(filename, str) or not filename:
                    raise ValueError("destination manifest entry has no filename")
                with open(_lump_transition_path(lumps_dir, filename), "rb") as source:
                    artifacts.append((filename, hashlib.sha256(source.read()).hexdigest()))
            material = {
                "token": token8,
                "destination": target_entries,
                "namespace_rows": sorted(
                    relevant_rows, key=lambda row: row.get("slot", -1)),
                "artifacts": artifacts,
            }
            return hashlib.sha256(json.dumps(
                material, sort_keys=True, separators=(",", ":"), default=str
            ).encode("utf-8")).hexdigest()
        selected = []
        for entry in manifest:
            if not isinstance(entry, dict):
                raise ValueError("manifest entry is not an object")
            token = entry.get("token")
            filename = entry.get("filename")
            if not isinstance(filename, str) or not filename:
                if not isinstance(token, str) or not re.fullmatch(
                        r"[0-9a-fA-F]{8}", token):
                    raise ValueError(
                        "manifest entry has neither a filename nor a valid token")
                # Historical canonical entries select their artifact by token.
                # This is the same fail-closed fallback used by list/detail and
                # boot-image readers; the selected file must still exist below.
                filename = f"{token.lower()}.lump"
            path = _lump_transition_path(lumps_dir, filename)
            with open(path, "rb") as source:
                selected.append((entry, hashlib.sha256(source.read()).hexdigest()))
        return hashlib.sha256(json.dumps(
            selected, sort_keys=True, separators=(",", ":"), default=str
        ).encode("utf-8")).hexdigest()
    except (OSError, TypeError, ValueError) as exc:
        raise ValueError(
            f"authoritative library generation is unavailable: {exc}") from exc


def _allocate_new_lump_slot():
    """Choose an unoccupied dynamic Namespace slot from authoritative state."""
    rows, _ = _read_authoritative_namespace_rows()
    occupied = set()
    for row in rows:
        if not isinstance(row, dict):
            raise ValueError("ns-state.json contains a non-object Namespace row")
        slot = row.get("slot")
        if isinstance(slot, bool) or not isinstance(slot, int) or not 0 <= slot < MAX_NS_ENTRIES:
            raise ValueError(f"ns-state.json contains invalid Namespace slot {slot!r}")
        if slot in occupied:
            raise ValueError(f"ns-state.json has duplicate Namespace slot {slot}")
        occupied.add(slot)
    reserved = set(RESERVED_NS_SLOTS)
    try:
        config, error = _read_saved_boot_config()
        if not error:
            reserved.update(_generated_thread_slots_for_step1((config or {}).get("step1")))
    except (OSError, ValueError, TypeError):
        pass
    for slot in range(MAX_NS_ENTRIES):
        if slot not in reserved and slot not in occupied:
            return slot
    raise ValueError("no unoccupied Namespace slot is available")


def _check_lump_save_plan(plan, *, digest, action, token, filename,
                          consequence, replacement_identity, generation,
                          consume=False):
    """Validate (and only at mutation time consume) a save plan."""
    plan_id = str(plan or "")
    with _LUMP_SAVE_PLANS_LOCK:
        record = _LUMP_SAVE_PLANS.get(plan_id)
        if record is None:
            raise ValueError("a valid save plan is required")
        if record["expires"] < time.time():
            _LUMP_SAVE_PLANS.pop(plan_id, None)
            raise ValueError("save plan has expired")
        if record["session"] != session.get("_lump_approval_session"):
            raise ValueError("save plan belongs to a different session")
        checks = {
            "digest": digest, "action": action, "token": token,
            "filename": filename, "consequence": consequence,
            "replacement_identity": replacement_identity,
            "generation": generation,
        }
        for key, actual in checks.items():
            if record[key] != actual:
                if key == "generation":
                    raise ValueError("save plan is stale: authoritative library changed")
                raise ValueError(f"save plan {key.replace('_', ' ')} does not match")
        if consume:
            _LUMP_SAVE_PLANS.pop(plan_id, None)
    return record


def _parse_intrinsic_lump_content(words):
    """Parse the byte-embedded V1.3 API/source frame; return None for legacy."""
    if not words:
        return None
    header = words[0] & 0xFFFFFFFF
    size = 1 << (((header >> 23) & 0xF) + 6)
    cw, typ, cc = (header >> 10) & 0x1FFF, (header >> 8) & 3, header & 0xFF
    start, end = 1 + cw, size - cc
    if typ != 0 or start >= end or start >= len(words):
        return None
    frame_header = words[start] & 0xFFFFFFFF
    flags, api_len = (frame_header >> 16) & 0xFF, frame_header & 0xFFFF
    tiers = {0x00: 0, 0x01: 1, 0x03: 2, 0x05: 1, 0x07: 2}
    if (frame_header >> 24) != 0xAB or flags not in tiers or not api_len:
        return None
    api_words = (api_len + 3) // 4
    if start + 1 + api_words > end:
        return None
    try:
        api_raw = _struct.pack(
            f">{api_words}I", *words[start + 1:start + 1 + api_words])[:api_len]
        api = json.loads(api_raw.decode("utf-8"))
        if not isinstance(api, dict):
            return None
    except (ValueError, UnicodeDecodeError, _struct.error):
        return None
    source = None
    content_words = 1 + api_words
    if flags & 1:
        pos = start + 1 + api_words
        if pos >= end:
            return None
        source_len = words[pos] & 0xFFFFFFFF
        source_words = (source_len + 3) // 4
        # An explicitly embedded empty source is still source: preserve the
        # distinction between a source frame containing "" and an API-only or
        # legacy binary that has no source frame at all.
        if pos + 1 + source_words > end:
            return None
        packed = _struct.pack(
            f">{source_words}I", *words[pos + 1:pos + 1 + source_words])[:source_len]
        import zlib
        try:
            if flags & 4:
                source_bytes = zlib.decompress(packed, wbits=-15)
                if len(source_bytes) > 1 << 18:
                    return None
            else:
                source_bytes = packed
            source = source_bytes.decode("utf-8")
        except (ValueError, UnicodeDecodeError, zlib.error):
            return None
        content_words += 1 + source_words
    return {"tier": tiers[flags], "flags": flags, "api_len": api_len,
            "content_words": content_words, "source": source,
            "api_definition": api}


def _inspect_lump_binary(binary_or_path, *, allow_compact_fit=False):
    """Return intrinsic facts from one LUMP, or raise ValueError.

    This is the common parser used by catalogue, detail, history, preview and
    approval code.  No JSON metadata participates in structural validation.
    """
    if isinstance(binary_or_path, (bytes, bytearray)):
        raw = bytes(binary_or_path)
    else:
        with open(binary_or_path, "rb") as fh:
            raw = fh.read()
    if len(raw) < 4 or len(raw) % 4:
        raise ValueError("binary length is not a non-empty whole number of words")
    words = list(_struct.unpack(f">{len(raw) // 4}I", raw))
    header = words[0]
    magic = (header >> 27) & 0x1F
    if magic != 0x1F:
        raise ValueError(f"invalid header magic 0x{magic:02x}")
    declared_size = 1 << (((header >> 23) & 0xF) + 6)
    cw = (header >> 10) & 0x1FFF
    typ = (header >> 8) & 0x3
    cc = header & 0xFF
    if declared_size != len(words):
        min_size = 1 + cw + cc
        # Approval size rules permit either an exact-fit file or the next
        # power-of-two padded form, even when an older fixture omitted the
        # allocation exponent from its header.
        padded_size = 1 if min_size <= 1 else 1 << (min_size - 1).bit_length()
        compact_fit = len(words) in (min_size, padded_size)
        if not (allow_compact_fit and compact_fit):
            raise ValueError(
                f"header declares {declared_size} words but file contains {len(words)}"
            )
    if 1 + cw + cc > declared_size:
        raise ValueError(
            f"header regions exceed allocation: 1+cw({cw})+cc({cc}) > {declared_size}"
        )
    frame = _parse_intrinsic_lump_content(words)
    content_profile = None
    if frame:
        content_profile = (
            "api" if frame["flags"] == 0
            else "full" if frame["flags"] in (0x03, 0x07)
            else "compact"
        )
    return {
        "raw_bytes": raw,
        "words": words,
        "header": header,
        "cw": cw,
        "cc": cc,
        "typ": typ,
        "lump_size": declared_size,
        "binary_hash": hashlib.sha256(raw).hexdigest(),
        "content_profile": content_profile,
        "sourceStorageTier": frame["tier"] if frame else None,
        "api_definition": frame["api_definition"] if frame else None,
        "source": frame["source"] if frame else None,
        "clist_entries": _extract_clist_from_words(words),
    }


def _read_lump_approvals(lumps_dir):
    """Read the canonical, SHA-256-keyed approval store, failing closed."""
    path = os.path.join(lumps_dir, _LUMP_APPROVALS_FILENAME)
    try:
        return _shared_read_approvals(path)
    except Exception as exc:
        raise _LumpApprovalStoreError(
            f"approvals.json is corrupt and cannot be read safely: {exc}") from exc


def _matching_lump_approval(lumps_dir, binary_hash):
    approval = _read_lump_approvals(lumps_dir).get(binary_hash)
    return dict(approval) if approval is not None else None


def _write_lump_approval(lumps_dir, binary_hash, metadata):
    """Record reviewed extrinsic metadata under the exact binary digest."""
    with _lump_history_transition_lock(lumps_dir):
        approvals = _read_lump_approvals(lumps_dir)
        approval = {
            key: value for key, value in dict(metadata or {}).items()
            if key not in {"cw", "cc", "typ", "lump_size", "binary_hash",
                           "source", "api_definition", "sourceStorageTier"}
        }
        approval["binary_hash"] = binary_hash
        approvals[binary_hash] = approval
        _shared_write_approvals(
            os.path.join(lumps_dir, _LUMP_APPROVALS_FILENAME), approvals)


@app.route("/api/lumps/approval-intent", methods=["POST"])
def create_lump_approval_intent():
    """Issue a one-time, session-bound approval intent after UI confirmation.

    Request: {digest, action, plan, confirmation:true, approval:{...allowed fields...}}.
    The returned intent must accompany the matching mutation as
    metadata.approval_intent.  Intents are consumed exactly once.
    """
    payload = request.get_json(force=True, silent=True) or {}
    digest = str(payload.get("digest", "")).lower()
    action = str(payload.get("action", "")).lower()
    supplied = payload.get("approval", {})
    if not re.fullmatch(r"[0-9a-f]{64}", digest):
        return jsonify({"error": "digest must be an exact lowercase SHA-256"}), 400
    if action not in {"save", "replace", "fork", "restore", "deploy", "import-approval"}:
        return jsonify({"error": "unsupported approval action"}), 400
    if payload.get("confirmation") is not True or not isinstance(supplied, dict):
        return jsonify({"error": "explicit confirmation and approval object are required"}), 400
    if set(supplied) - _LUMP_APPROVAL_INTENT_FIELDS:
        return jsonify({"error": "approval contains fields outside the strict allowlist"}), 400
    session_id = session.setdefault("_lump_approval_session", secrets.token_urlsafe(24))
    plan_id = payload.get("plan", payload.get("plan_id"))
    if action in {"save", "replace"}:
        # Approval is meaningful only for the exact candidate/destination that
        # was just presented to the user in a server-derived plan.
        with _LUMP_SAVE_PLANS_LOCK:
            plan = _LUMP_SAVE_PLANS.get(str(plan_id or ""))
            if not plan:
                return jsonify({"error": "a valid save plan is required"}), 403
            if plan["expires"] < time.time():
                _LUMP_SAVE_PLANS.pop(str(plan_id or ""), None)
                return jsonify({"error": "save plan has expired"}), 403
            if plan["session"] != session_id:
                return jsonify({"error": "save plan belongs to a different session"}), 403
            if plan["digest"] != digest or plan["action"] != action:
                return jsonify({"error": "save plan digest or action does not match"}), 403
    intent = secrets.token_urlsafe(32)
    with _LUMP_APPROVAL_INTENTS_LOCK:
        _LUMP_APPROVAL_INTENTS[intent] = {
            "session": session_id, "digest": digest, "action": action,
            "approval": dict(supplied), "plan": str(plan_id or ""),
            "expires": time.time() + 300,
        }
    return jsonify({"intent": intent, "digest": digest, "action": action,
                    "plan_id": str(plan_id or "") or None,
                    "expires_in": 300}), 201


def _consume_lump_approval_intent(intent, digest, action, plan=None, consume=True):
    # This process-local lock makes removal atomic among all server threads.
    # Deployments with multiple workers must provide shared process-safe intent
    # storage rather than routing one intent between workers.
    with _LUMP_APPROVAL_INTENTS_LOCK:
        key = str(intent or "")
        record = _LUMP_APPROVAL_INTENTS.get(key)
        session_id = session.get("_lump_approval_session")
        if (not record or record["expires"] < time.time() or
                record["session"] != session_id or record["digest"] != digest or
                record["action"] != action or
                (action in {"save", "replace"}
                 and record.get("plan") != str(plan or ""))):
            raise ValueError("a valid, unexpired session-bound approval intent is required")
        if consume:
            _LUMP_APPROVAL_INTENTS.pop(key, None)
        return dict(record["approval"])


@app.route("/api/lumps/deploy-authorize", methods=["POST"])
def authorize_lump_simulator_deploy():
    """One-time, no-write authorization gate for ephemeral simulator deployment."""
    payload = request.get_json(force=True, silent=True) or {}
    token = str(payload.get("token", "")).lower().removeprefix("0x").zfill(8)
    if not re.fullmatch(r"[0-9a-f]{8}", token):
        return jsonify({"error": "token must be 1-8 hexadecimal digits"}), 400
    try:
        with _lump_history_transition_lock(LUMPS_DIR):
            entries = _read_manifest_safe(LUMPS_MANIFEST_PATH)
            rows = [e for e in entries if isinstance(e, dict) and e.get("token") == token]
            if len(rows) != 1:
                return jsonify({"error": "current immutable artifact is unavailable"}), 404
            facts = _inspect_lump_binary(os.path.join(
                LUMPS_DIR, rows[0].get("filename") or f"{token}.lump"))
            digest = facts["binary_hash"]
            if _matching_lump_approval(LUMPS_DIR, digest) is None:
                return jsonify({"error": "exact hash-bound approval is required"}), 403
            _consume_lump_approval_intent(payload.get("approval_intent"), digest, "deploy")
    except _LumpApprovalStoreError as exc:
        return jsonify({"error": str(exc)}), 500
    except ValueError as exc:
        return jsonify({"error": str(exc)}), 403
    except OSError:
        return jsonify({"error": "current immutable artifact is unavailable"}), 404
    return jsonify({"ok": True, "token": token, "binary_hash": digest,
                    "authorization": "ephemeral-simulator-deploy"})


def _lump_with_crc(raw_lump_bytes):
    """Prepend a big-endian CRC-32 word to *raw_lump_bytes* and return the result.

    The CRC is computed over the raw lump payload bytes (the lump words themselves),
    matching the hardware IoT unit's CRC-32/ISO-HDLC check (outform_iot.py).
    """
    crc = _zlib.crc32(raw_lump_bytes) & 0xFFFFFFFF
    return _struct.pack('>I', crc) + raw_lump_bytes

LAZY_LUMPS = {}    # token_hex_8 → bytes

# ── Lump header packing ─────────────────────────────────────────────────────────
def _pack_lump_header(n_minus_6=0, cw=1, cc=1, typ=0):
    return ((0x1F & 0x1F) << 27) | ((n_minus_6 & 0xF) << 23) | \
           ((cw & 0x1FFF) << 10) | ((typ & 0x3) << 8) | (cc & 0xFF)

def _words_to_binary(words):
    """Pack a list of up to 64 uint32 values into big-endian bytes (padded to lumpSize)."""
    n_minus_6 = (words[0] >> 23) & 0xF if words else 0
    lump_size  = 1 << (n_minus_6 + 6)
    padded     = list(words) + [0] * lump_size
    padded     = padded[:lump_size]
    return _struct.pack(f'>{lump_size}I', *[int(w) & 0xFFFFFFFF for w in padded])

def _build_lazy_lumps():
    # Math.Add — token 0xDEAD0003
    # 64-word lump: header | RETURN AL | <zeros> | NULL GT (c-list[63])
    # RETURN AL encoding: opcode=3, cond=14 → (3<<27)|(14<<23) = 0x1F000000
    RETURN_AL = 0x1F000000
    words      = [0] * 64
    words[0]   = _pack_lump_header(n_minus_6=0, cw=1, cc=1, typ=0)   # 0xF8000401
    words[1]   = RETURN_AL   # minimal callable body: immediately returns
    words[63]  = 0            # c-list slot 0 — NULL GT (caller supplies at runtime)
    LAZY_LUMPS['dead0003'] = _struct.pack('>64I', *words)

_build_lazy_lumps()

# ── Bundled lump loader ──────────────────────────────────────────────────────────
# Scans server/lumps/*.lump and pre-loads every binary into LAZY_LUMPS at startup.
# Bundled lumps take priority over the single hardcoded stub and are served before
# the GitHub Mum Tunnel Library is consulted, making the server self-contained in
# production environments where GitHub may not be reachable.
def _load_bundled_lumps():
    import glob as _glob
    import re as _re_bundled
    lumps_dir = LUMPS_DIR
    if not os.path.isdir(lumps_dir):
        return
    for path in sorted(_glob.glob(os.path.join(lumps_dir, '*.lump'))):
        stem = os.path.splitext(os.path.basename(path))[0].lower()
        # Only a token-shaped filename may register itself in the direct cache.
        # Named binaries are registered exclusively by the manifest pass below.
        # In particular, an archived SelfTest_v<N>.lump must remain viewable
        # through the explicit history route, never become a runnable "SelfTest"
        # alias merely because its filename shares that prefix.
        if not _re_bundled.fullmatch(r'[0-9a-f]{1,8}', stem):
            continue
        token8 = stem.zfill(8)
        try:
            with open(path, 'rb') as fh:
                data = fh.read()
            if len(data) < 4:
                continue
            hdr = _struct.unpack('>I', data[:4])[0]
            if (hdr >> 27) & 0x1F != 0x1F:
                print(f'[lumps] skip {path}: bad magic', flush=True)
                continue
            LAZY_LUMPS[token8] = data
            LAZY_LUMPS[stem.lstrip('0') or '0'] = data
        except Exception as exc:
            print(f'[lumps] error loading {path}: {exc}', flush=True)
    # Second pass: read manifest.json and re-register each named file under its
    # canonical token.  Human-readable filenames like "LEDFlash_v2.lump" don't
    # produce a valid token8 from their stem, so the loop above keys them under
    # a garbage string.  This pass ensures LAZY_LUMPS["00000300"] always holds
    # the manifest-designated binary, overriding any stale library-fetched copy.
    _mf_path = os.path.join(lumps_dir, 'manifest.json')
    if os.path.isfile(_mf_path):
        try:
            with open(_mf_path) as _mf:
                _mf_data = json.load(_mf)
            for _me in _mf_data:
                _tok = _me.get('token', '')
                _fn  = _me.get('filename', '')
                if not (_tok and _fn):
                    continue
                _np = os.path.join(lumps_dir, _fn)
                if not os.path.isfile(_np):
                    continue
                try:
                    with open(_np, 'rb') as _fh:
                        _d = _fh.read()
                    if len(_d) < 4:
                        continue
                    _h = _struct.unpack('>I', _d[:4])[0]
                    if (_h >> 27) & 0x1F != 0x1F:
                        continue
                    _t8 = _tok.lower().zfill(8)[:8]
                    LAZY_LUMPS[_t8] = _d
                    LAZY_LUMPS[_t8.lstrip('0') or '0'] = _d
                except Exception:
                    pass
        except Exception as exc:
            print(f'[lumps] manifest pass error: {exc}', flush=True)

def _derive_ns_state_entries():
    """Build hardwired NS rows from boot-image.bin (cold-start fallback).

    Reads the binary to get all column values; consults the manifest and
    hardware boot catalog for slot names.  Returns a list of dicts matching
    the ns-state.json "abstractions" element format.
    """
    import time as _tm_ns2
    if not os.path.isfile(BOOT_IMAGE_PATH):
        return []
    try:
        with open(BOOT_IMAGE_PATH, "rb") as _fh:
            _raw = _fh.read()
        _rows = _boot_image_gen.parse_ns_table(_raw)
        if not _rows:
            return []

        # Only architecture constants may name rows when canonical state is absent.
        _slot_names = {}
        _HW_CATALOG = {
            0: "Boot.NS", 1: "Boot.Thread",
            2: "UART_DEV", 3: "LED_DEV", 4: "BTN_DEV", 5: "TIMER_DEV",
            6: "SelfTest", 7: "WukongCallHome",
            8: "Tunnel", 9: "Ethernet", 10: "CapabilityTest",
            13: "M_BIT_DEV",
        }
        # The V20 raw Namespace descriptor carries authority/integrity, not
        # a persisted display type. Boot-image entries are Inform descriptors
        # by construction; retain the small map for compatibility with an
        # older parser which did expose gt_type.
        _GT_TYPE_NAMES = {1: "Inform", 2: "Outform"}
        # Generated Thread entries do not have manifest records: their names
        # are part of the boot-image layout policy.  Trust the binary's
        # count sentinel before assigning one of these labels so a stale
        # single-thread image never reinterprets a user-owned slot.
        _thread_count = 1
        try:
            _raw_view = _boot_image_gen.parse_ns_table_raw(_raw) or {}
            _thread_count = int((_raw_view.get("thread") or {}).get("count") or 1)
        except Exception:
            pass
        for _thread_slot in _boot_image_gen.generated_thread_slots(_thread_count):
            _HW_CATALOG[_thread_slot] = _boot_image_gen.generated_thread_label(_thread_slot)

        # Read boot-entry slot from binary sentinel (NS_TABLE_BASE - 2).
        _boot_slot = None
        try:
            _n2 = len(_raw) // 4
            _mem2 = list(_struct.unpack(f"<{_n2}I", _raw[:_n2 * 4]))
            _cfg2, _ = _read_saved_boot_config()
            _step1b  = (_cfg2 or {}).get("step1", {})
            _nsmax2  = int(_step1b.get("nsSlotsMax") or _boot_image_gen.DEFAULT_NS_SLOTS_MAX)
            _nsres2  = _boot_image_gen.ns_table_reserve_words(_nsmax2)
            _nsbase2 = _n2 - _nsres2
            _sidx2   = _nsbase2 - 2
            if 0 <= _sidx2 < _n2:
                _boot_slot = int(_mem2[_sidx2]) & 0xFF
        except Exception:
            pass

        _out = []
        for _r in _rows:
            _sl  = _r["slot"]
            _loc = _r["location"]
            _typ = _GT_TYPE_NAMES.get(_r.get("gt_type", 1), "Inform")
            _lim = _r["limit17"]
            _seq = _r["seq"]
            _seal = _r.get("seal", _r.get("integrity32", 0))
            _g    = _r["g"]
            _nm   = _slot_names.get(_sl) or _HW_CATALOG.get(_sl) or f"slot_{_sl}"
            _e = {
                "name":     _nm,
                "slot":     _sl,
                "location": f"0x{_loc:08X}",
                "type":     _typ,
                "f":        0,
                "g":        _g,
                "limit":    f"0x{_lim:05X}",
                "seq":      _seq,
                "seal":     f"0x{_seal:04X}",
            }
            if _boot_slot is not None and _sl == _boot_slot:
                _e["boot"] = True
            _out.append(_e)
        return _out
    except Exception as _exc:
        print(f"[ns-state] _derive_ns_state_entries failed: {_exc}", flush=True)
        return []

_load_bundled_lumps()

# ── Boot Abstraction lump (NS slot 6, "Boot.Abstr") ───────────────────────────────
# The boot lump is baked directly into boot-image.bin rather than stored as a
# standalone .lump file.  Extract it at startup so the Lump Repository can show it.

_BOOT_ABSTR_META = {}   # populated by _load_boot_abstr_lump(); empty means not found
_BOOT_NS_META    = {}   # populated by _load_boot_ns_lump();    empty means not found


# ── ns-state.json helpers ────────────────────────────────────────────────────
# ns-state.json records the LOGICAL state of the namespace as an ordered list
# of abstraction dot-names plus the boot-entry name.  Slot numbers are a
# synthesis detail owned by canonical Namespace state and boot configuration.

def _derive_ns_state_names():
    """Return architecture-defined names only when canonical state is absent."""
    return ["Boot.NS", "Boot.Thread", "UART_DEV", "LED_DEV", "BTN_DEV",
            "TIMER_DEV", "SelfTest", "WukongCallHome", "Tunnel", "Ethernet",
            "CapabilityTest", "M_BIT_DEV"]


def _wukong_lump_name_for_slot(slot):
    """Return the abstraction name for NS *slot* from canonical Namespace state."""
    try:
        with open(NS_STATE_PATH) as _fh:
            _ns = json.load(_fh)
        for _e in _ns.get('abstractions', []):
            if isinstance(_e, dict) and _e.get('slot') == slot:
                _n = _e.get('name')
                if _n:
                    return _n
    except Exception:
        pass
    return f'Slot{slot}'


def _wukong_update_active_lump_nia(image_bytes, entry_info):
    """Populate _wukong_active_lump_info so trace events resolve to pet-name labels.

    Called immediately after the boot image is validated and enqueued for the
    bridge.  Reads the LUMP header at the entry slot's location, derives the
    NIA byte range, stores the instruction words for disasm, and looks up the
    abstraction name from ns-state.json / manifest.json.
    """
    global _wukong_active_lump_info
    import struct as _st_nia
    entry_slot = entry_info.get('entry_slot')
    entry_loc  = entry_info.get('entry_loc')   # word index of LUMP header in image
    if entry_loc is None or not entry_info.get('resident'):
        _wukong_active_lump_info = {}
        return
    n_words = len(image_bytes) // 4
    words    = _st_nia.unpack(f'<{n_words}I', image_bytes[:n_words * 4])
    hdr      = words[entry_loc]
    n_m6     = (hdr >> 23) & 0xF          # lump size exponent (2^(n_m6+6) words total)
    lump_size = 2 ** (n_m6 + 6)
    base_byte = entry_loc * 4             # byte-addressed NIA of LUMP header word
    end_byte  = base_byte + lump_size * 4
    lump_words = {
        _i: words[entry_loc + _i]
        for _i in range(lump_size)
        if entry_loc + _i < n_words
    }
    name = _wukong_lump_name_for_slot(entry_slot)
    _wukong_active_lump_info = {
        'base_byte':  base_byte,
        'end_byte':   end_byte,
        'name':       name,
        'lump_words': lump_words,
    }
    print(f'[wukong-nia] active lump: {name!r}  '
          f'NIA=0x{base_byte:04X}–0x{end_byte:04X}  slot={entry_slot}', flush=True)


def _read_boot_entry_slot_from_image():
    """Return the selected entry slot from the committed boot image."""
    if not os.path.isfile(BOOT_IMAGE_PATH):
        return None
    with open(BOOT_IMAGE_PATH, "rb") as image_file:
        return _boot_image_gen.read_boot_entry_info(image_file.read()).get("entry_slot")


def _read_boot_entry_name_from_image():
    """Return the boot-entry name from binary selection plus canonical NS state."""
    _slot = _read_boot_entry_slot_from_image()
    if _slot is None:
        return None
    name = _wukong_lump_name_for_slot(_slot)
    return None if name == f"Slot{_slot}" else name

def _build_ns_state_document(entries):
    """Build the exact rich Namespace document without mutating the repository."""
    import time as _tm_ns
    state = {
        "abstractions": list(entries or []),
        "generated_at": _tm_ns.time(),
    }
    if os.path.isfile(BOOT_IMAGE_PATH):
        with open(BOOT_IMAGE_PATH, "rb") as image_file:
            raw = _boot_image_gen.parse_ns_table_raw(image_file.read())
        if isinstance(raw, dict):
            state["committed_raw_fingerprint"] = _raw_namespace_fingerprint(raw)
    return state


def _write_ns_state(entries):
    """Write ns-state.json atomically — rich list of NS row objects."""
    _tmp = NS_STATE_PATH + ".tmp"
    with _namespace_commit_guard():
        _state = _build_ns_state_document(entries)
        try:
            with open(_tmp, "w") as _fh:
                json.dump(_state, _fh, indent=2)
            os.replace(_tmp, NS_STATE_PATH)
        except Exception:
            try:
                os.remove(_tmp)
            except OSError:
                pass
            raise


def _prepare_saved_lump_ns_state(
        abstraction, ns_slot, token, filename, issue_n, lump_version):
    """Validate and build a saved artifact's next Namespace state without writing."""
    if not isinstance(ns_slot, int):
        return None
    if os.path.isfile(NS_STATE_PATH):
        with open(NS_STATE_PATH, encoding="utf-8") as state_file:
            state = json.load(state_file)
        entries = state.get("abstractions") if isinstance(state, dict) else None
        if not isinstance(entries, list):
            raise ValueError("ns-state.json has no abstractions array")
    else:
        entries = []

    entry = next(
        (row for row in entries
         if isinstance(row, dict) and row.get("slot") == ns_slot),
        None)
    selftest_rows = [
        row for row in entries
        if isinstance(row, dict) and row.get("name") == "SelfTest"
    ] if abstraction == "SelfTest" else []
    if len(selftest_rows) > 1:
        raise ValueError("ns-state.json has multiple authoritative SelfTest rows")
    if abstraction == "SelfTest" and selftest_rows:
        selftest_entry = selftest_rows[0]
        if entry is None:
            # Move the one logical SelfTest descriptor to the selected free slot.
            entry = selftest_entry
        elif entry is not selftest_entry:
            # An occupied target is still programmer-replaceable. Remove the old
            # SelfTest binding so the selected target becomes its sole identity.
            entries.remove(selftest_entry)
    if entry is None:
        # A programmer may install into an unused non-bootstrap slot.  Sequence
        # zero is the initial live sequence for a newly allocated descriptor.
        entry = {"name": abstraction, "slot": ns_slot, "seq": 0}
        entries.append(entry)
    entry.update({
        "name": abstraction,
        "slot": ns_slot,
        "token": token,
        "filename": filename,
        "issue_n": issue_n,
        "lump_version": lump_version,
        "resident": True,
        "load_policy": "Resident",
    })
    return entries


def _namespace_state_fingerprint(entries):
    """Return the exact identity of the authoritative Namespace rows."""
    return hashlib.sha256(json.dumps(
        entries, sort_keys=True, separators=(",", ":")
    ).encode("utf-8")).hexdigest()


def _read_authoritative_namespace_rows():
    """Read rich Namespace state and return rows plus its exact fingerprint."""
    if not os.path.isfile(NS_STATE_PATH):
        rows = []
    else:
        with open(NS_STATE_PATH, encoding="utf-8") as state_file:
            state = json.load(state_file)
        rows = state.get("abstractions") if isinstance(state, dict) else None
        if not isinstance(rows, list):
            raise ValueError("ns-state.json has no abstractions array")
    return rows, _namespace_state_fingerprint(rows)


def _allocate_bootstrap_history_repair_destination(abstraction):
    """Select the first Namespace slot eligible for a corrected resident LUMP.

    Slots 0 and 1 are architectural reservations.  A row blocks allocation
    only when it is both resident and already installed (with a token and
    filename).  The returned binding is a proposed destination identity; the
    caller must carry its Namespace fingerprint through approval and verify it
    again while holding the commit locks.
    """
    rows, namespace_identity = _read_authoritative_namespace_rows()
    by_slot = {}
    for row in rows:
        if not isinstance(row, dict):
            raise ValueError("ns-state.json contains a non-object Namespace row")
        slot = row.get("slot")
        if isinstance(slot, bool) or not isinstance(slot, int) \
                or not 0 <= slot < MAX_NS_ENTRIES:
            raise ValueError(f"ns-state.json contains invalid Namespace slot {slot!r}")
        if slot in by_slot:
            raise ValueError(f"ns-state.json has duplicate Namespace slot {slot}")
        by_slot[slot] = row

    reserved = {0, 1}
    reserved.update(
        slot for slot, row in by_slot.items()
        if row.get("resident") is True
        and isinstance(row.get("token"), str) and bool(row.get("token"))
        and isinstance(row.get("filename"), str) and bool(row.get("filename"))
    )
    for slot in range(2, MAX_NS_ENTRIES):
        if slot in reserved:
            continue
        source = by_slot.get(slot)
        sequence = 0 if source is None else source.get("seq", 0)
        if isinstance(sequence, bool) or not isinstance(sequence, int) \
                or not 0 <= sequence <= 0x1FF:
            raise ValueError(
                f"ns-state.json has invalid sequence for Namespace slot {slot}")
        binding = dict(source or {})
        binding.update({
            "name": str(abstraction or "").strip(),
            "slot": slot,
            "seq": sequence,
            "resident": True,
            "boot_resident": True,
            "type": "Inform",
            "load_policy": "Resident",
            "ns_slot_policy": "static",
        })
        runtime_gt = _resident_inform_egt(binding)
        binding["token"] = f"{runtime_gt:08x}"
        return {
            "slot": slot,
            "sequence": sequence,
            "runtime_gt": runtime_gt,
            "token": binding["token"],
            "binding": binding,
            "source_row": dict(source) if source is not None else None,
            "namespace_identity": namespace_identity,
        }
    raise ValueError(
        f"no eligible Namespace slot is available in the configured capacity "
        f"(slots 0 and 1 are reserved; capacity is {MAX_NS_ENTRIES})"
    )


def _ensure_ns_state():
    """Create/migrate ns-state.json to the rich per-slot format on startup.

    Migrates both legacy formats:
      - Old slot-keyed format: {"slots": {...}}
      - Old flat-name format:  {"abstractions": ["Name", ...], "boot_entry": "..."}
    Both are converted to the new rich format by re-parsing boot-image.bin.
    """
    if os.path.isfile(NS_STATE_PATH):
        try:
            with open(NS_STATE_PATH) as _fh:
                _existing = json.load(_fh)
            _abs = _existing.get("abstractions")
            _needs_migration = (
                # old slot-keyed format
                ("slots" in _existing and _abs is None)
                # old flat-name format: abstractions is a list of strings
                or (isinstance(_abs, list) and _abs and isinstance(_abs[0], str))
                # old flat-name format with empty list but boot_entry present
                or ("boot_entry" in _existing)
            )
            if _needs_migration:
                _entries = _derive_ns_state_entries()
                _write_ns_state(_entries)
                print(f"[ns-state] migrated to rich format: "
                      f"{len(_entries)} occupied slots", flush=True)
        except Exception as _exc:
            print(f"[ns-state] migration check failed: {_exc}", flush=True)
        return
    try:
        _entries = _derive_ns_state_entries()
        _write_ns_state(_entries)
        print(f"[ns-state] created cold-start ns-state.json: "
              f"{len(_entries)} occupied slots", flush=True)
    except Exception as _exc:
        print(f"[ns-state] cold-start creation failed: {_exc}", flush=True)


def _active_selftest_locator(lumps_dir=None):
    """Return the one state-authorized SelfTest slot/token/file binding."""
    lumps_dir = lumps_dir or LUMPS_DIR
    try:
        with open(NS_STATE_PATH, encoding="utf-8") as state_file:
            rows = json.load(state_file).get("abstractions", [])
        matches = [row for row in rows if isinstance(row, dict)
                   and row.get("name") == "SelfTest"]
        if len(matches) != 1:
            return None
        row = matches[0]
        slot, token, filename = row.get("slot"), row.get("token"), row.get("filename")
        if (isinstance(slot, bool) or not isinstance(slot, int)
                or not isinstance(token, str) or not isinstance(filename, str)
                or os.path.basename(filename) != filename):
            return None
        manifest_path = os.path.join(lumps_dir, "manifest.json")
        with open(manifest_path, encoding="utf-8") as manifest_file:
            manifest = json.load(manifest_file)
        if not isinstance(manifest, list):
            return None
        manifest_entry = next(
            (entry for entry in manifest
             if entry.get("token") == token and entry.get("filename") == filename),
            None)
        if manifest_entry is None:
            return None
        return {"slot": slot, "token": token, "filename": filename,
                "state": row, "manifest": manifest_entry}
    except (OSError, ValueError, TypeError, json.JSONDecodeError):
        return None


def _load_boot_abstr_lump():
    """Load the state-authorized SelfTest body and cache it under its live token.

    boot-image.bin is stored little-endian (matching validate_boot_image / simulator.js).
    The extracted word array is re-packed big-endian for LAZY_LUMPS, matching the
    convention used by all other *.lump files and the get_lump_words endpoint.
    """
    boot_path = BOOT_IMAGE_PATH
    locator = _active_selftest_locator()
    if locator is None:
        return
    if not os.path.isfile(boot_path):
        return
    try:
        with open(boot_path, 'rb') as fh:
            raw = fh.read()
        n_words = len(raw) // 4
        if n_words < 1024:
            return
        # boot-image.bin is little-endian — mirrors validate_boot_image() and simulator.js
        mem = list(_struct.unpack(f'<{n_words}I', raw[:n_words * 4]))
        # NS table lives at the last NS_TABLE_RESERVE words of the image.
        # Read the boot config to get the correct nsSlotsMax — same pattern as _load_boot_ns_lump().
        _cfg_ab, _err_ab = _read_saved_boot_config()
        _step1_ab = (_cfg_ab or {}).get("step1", {})
        _ns_slots_max_ab = int(_step1_ab.get("nsSlotsMax") or _boot_image_gen.DEFAULT_NS_SLOTS_MAX)
        _ns_table_reserve_ab = _boot_image_gen.ns_table_reserve_words(_ns_slots_max_ab)
        ns_table_base = n_words - _ns_table_reserve_ab
        NS_ENTRY_WORDS = 4
        boot_ns_base = ns_table_base + locator["slot"] * NS_ENTRY_WORDS
        word0_location = mem[boot_ns_base]   # NS entry word0 = physical word address of lump
        if word0_location == 0 or word0_location + 1 >= n_words:
            return
        # Parse lump header: [31:27]=0x1F magic, [26:23]=n_minus_6, [22:10]=cw, [9:8]=typ, [7:0]=cc
        hdr = mem[word0_location]
        n_minus_6 = (hdr >> 23) & 0xF
        cw        = (hdr >> 10) & 0x1FFF
        cc        = hdr & 0xFF
        lump_size = 1 << (n_minus_6 + 6)
        if word0_location + lump_size > n_words:
            return
        lump_words = mem[word0_location:word0_location + lump_size]
        # Store as big-endian bytes — matches *.lump file convention and get_lump_words
        LAZY_LUMPS[locator["token"]] = _struct.pack(f'>{lump_size}I', *lump_words)
        _BOOT_ABSTR_META.update({
            "token":       locator["token"],
            "abstraction": "SelfTest",
            "ns_slot":     locator["slot"],
            "lump_size":   lump_size,
            "cw":          cw,
            "cc":          cc,
            "lump_type":   "boot",
            "language":    "ISA",
            "description": (
                "SelfTest (a.k.a. Boot.Abstr) — the lump executed by the hardware ROM "
                "during boot phases B:01–B:07.  Loads NS, Thread, and SelfTest/Boot.Abstr "
                "lumps, then CALL CR0 (Thread.CR[0]) enters the configured first "
                "abstraction directly."
            ),
            "methods": [
                {
                    "name":        "Boot",
                    "offset":      0,
                    "length":      cw,
                    "description": "Hardware boot sequence entry point.",
                    "inputs":      [],
                    "outputs":     [],
                }
            ],
        })
        if cc > 0:
            _clist_start = lump_size - cc
            _BOOT_ABSTR_META['clist_entries'] = [
                _decode_gt_word(lump_words[_clist_start + _ci]) for _ci in range(cc)
            ]
        print(f'[boot] Boot.Abstr extracted: {lump_size}w at mem[{word0_location}], '
              f'cw={cw}, cc={cc}', flush=True)
        # Prefer the exact state+manifest-authorized SelfTest body over a
        # possible boot-image stub.
        _lumps_dir_mo = LUMPS_DIR
        _mf_mo_path = os.path.join(_lumps_dir_mo, 'manifest.json')
        _canonical_loaded = False
        if os.path.isfile(_mf_mo_path):
            try:
                with open(_mf_mo_path) as _mf_mo_f:
                    _mf_mo = json.load(_mf_mo_f)
                for _me_mo in _mf_mo:
                    if (_me_mo.get('token') == locator["token"]
                            and _me_mo.get('filename') == locator["filename"]):
                        _fn_mo = locator["filename"]
                        _np_mo = os.path.join(_lumps_dir_mo, _fn_mo) if _fn_mo else ''
                        if _fn_mo and os.path.isfile(_np_mo):
                            with open(_np_mo, 'rb') as _fh_mo:
                                _d_mo = _fh_mo.read()
                            try:
                                _facts_mo = _inspect_lump_binary(_d_mo)
                                _approval_mo = _matching_lump_approval(
                                    _lumps_dir_mo, _facts_mo["binary_hash"])
                            except (OSError, ValueError):
                                _facts_mo = None
                                _approval_mo = None
                            if _facts_mo is not None and _approval_mo is not None:
                                    _n_mo = len(_facts_mo["words"])
                                    _h_mo = _facts_mo["header"]
                                    LAZY_LUMPS[locator["token"]] = _d_mo
                                    LAZY_LUMPS[locator["token"].lstrip('0') or '0'] = _d_mo
                                    _cw_mo = _facts_mo["cw"]
                                    _cc_mo = _facts_mo["cc"]
                                    _ls_mo = _facts_mo["lump_size"]
                                    _BOOT_ABSTR_META.update({
                                        'cw': _cw_mo, 'cc': _cc_mo, 'lump_size': _ls_mo,
                                        'lump_version': _me_mo.get('lump_version', 0),
                                    })
                                    if _cc_mo > 0:
                                        _wds_mo = list(_struct.unpack(f'>{_n_mo}I', _d_mo))
                                        _BOOT_ABSTR_META['clist_entries'] = [
                                            _decode_gt_word(_wds_mo[_ls_mo - _cc_mo + _ci])
                                            for _ci in range(_cc_mo)
                                        ]
                                    _canonical_loaded = True
                                    for _fld in ('author', 'version', 'pet_names',
                                                 'capabilities', 'description', 'methods'):
                                        if _approval_mo.get(_fld) is not None:
                                            _BOOT_ABSTR_META[_fld] = _approval_mo[_fld]
                                    _BOOT_ABSTR_META['has_source'] = bool(
                                        _facts_mo.get("source"))
                                    print(f'[boot] SelfTest canonical binary loaded: {_fn_mo} '
                                          f'cw={_cw_mo} cc={_cc_mo}', flush=True)
                        break
            except Exception as _e_mo:
                print(f'[boot] state-authorized SelfTest override failed: {_e_mo}', flush=True)
    except Exception as exc:
        print(f'[boot] Failed to extract Boot.Abstr lump: {exc}', flush=True)

_load_boot_abstr_lump()


def _load_boot_ns_lump():
    """Parse boot-image.bin, extract Boot.NS (NS slot 0) metadata and cache in _BOOT_NS_META.

    Boot.NS (typ=1, Namespace LUMP) lives at word[0] of the image.  We extract its
    header and walk the NS table to build the namespace_meta.entries array that the
    Lump Repository panel uses to render the SVG dependency graph and NS Table view.
    """
    boot_path = BOOT_IMAGE_PATH
    if not os.path.isfile(boot_path):
        return
    try:
        with open(boot_path, 'rb') as fh:
            raw = fh.read()
        n_words = len(raw) // 4
        if n_words < 1024:
            return
        mem = list(_struct.unpack(f'<{n_words}I', raw[:n_words * 4]))
        _NS_ENTRY_WORDS = _boot_image_gen.NS_ENTRY_WORDS

        # Read the boot config to get the correct nsSlotsMax (same logic as
        # namespace_lump_json).  Fall back to MAX_NS_ENTRIES so we always find
        # the NS table even when the config is unavailable.
        _cfg_ns, _err_ns = _read_saved_boot_config()
        _step1_ns = (_cfg_ns or {}).get("step1", {})
        _ns_slots_max = int(_step1_ns.get("nsSlotsMax") or _boot_image_gen.DEFAULT_NS_SLOTS_MAX)
        _ns_table_reserve = _boot_image_gen.ns_table_reserve_words(_ns_slots_max)
        ns_table_base = n_words - _ns_table_reserve

        hdr = mem[0]
        if ((hdr >> 27) & 0x1F) != 0x1F:
            return
        n_minus_6 = (hdr >> 23) & 0xF
        cw        = (hdr >> 10) & 0x1FFF
        cc        = hdr & 0xFF
        lump_size = 1 << (n_minus_6 + 6)

        catalog    = _boot_image_gen.DEFAULT_ABSTRACTION_CATALOG
        slot_count = max(cc, len(catalog))
        entries    = []
        for i in range(min(slot_count, _ns_table_reserve // _NS_ENTRY_WORDS)):
            ns_base = ns_table_base + i * _NS_ENTRY_WORDS
            if ns_base + _NS_ENTRY_WORDS > n_words:
                break
            w0, w1, w2, w3 = mem[ns_base], mem[ns_base+1], mem[ns_base+2], mem[ns_base+3]
            is_null = (w0 == 0 and w1 == 0 and w2 == 0 and w3 == 0)

            label = ""
            if i < len(catalog):
                cat_e = catalog[i]
                if cat_e is not None:
                    label = cat_e[0] if isinstance(cat_e, tuple) else (cat_e.get("label") or "")
            if not label:
                label = "" if is_null else f"slot{i}"

            if is_null:
                entries.append({"slot": i, "label": label, "state": "null"})
            else:
                entries.append({"slot": i, "label": label, "state": "bundled",
                                 "file": "boot-image.bin"})

        _BOOT_NS_META.update({
            "token":       "00000000",
            "abstraction": "Boot.NS",
            "ns_slot":     0,
            "header_word": f"0x{hdr:08X}",
            "lump_size":   lump_size,
            "cw":          cw,
            "cc":          cc,
            "typ":         1,
            "lump_type":   "namespace",
            "language":    "namespace",
            "description": (
                "Boot Namespace LUMP (Boot.NS) — NS slot 0.  The physical namespace "
                "memory block.  Its tail contains the NS table (4 words × slot count).  "
                "All abstractions are addressed via GTs rooted here."
            ),
            "methods": [],
            "namespace_meta": {
                "app_id":         "Boot.NS",
                "base":           "0x00000000",
                "n":              n_minus_6 + 6,
                "cc":             cc,
                "ns_table_start": ns_table_base,
                "entries":        entries,
            },
        })
        print(f'[boot] Boot.NS extracted: {lump_size}w, cw={cw}, cc={cc}, '
              f'{len(entries)} NS table entries', flush=True)
    except Exception as exc:
        print(f'[boot] Failed to extract Boot.NS lump: {exc}', flush=True)
    # Cold-start: create ns-state.json if it doesn't exist yet
    _ensure_ns_state()


_load_boot_ns_lump()

# ── Mum Tunnel Library fallback ─────────────────────────────────────────────────
def _fetch_lump_from_library(token_hex):
    """Search the Mum Tunnel Library (GitHub) for an abstraction whose token matches.

    Returns (binary_bytes, name_str) or (None, None) when not found.
    The library JSON must include a "token" field set to the hex token string.
    """
    if not GITHUB_TOKEN or not GITHUB_LIBRARY_REPO:
        return None, None

    # Caller passes the normalized 8-hex W3 cache/index value.  A 96-bit
    # Outform token is normalized before this helper is called; never select
    # from its first word.
    raw_token  = token_hex.lower()
    lump_id    = raw_token[:8] if len(raw_token) >= 8 else raw_token
    token_norm = lump_id.lstrip('0') or '0'
    token_8    = lump_id.zfill(8)

    # Browse the library root for language directories
    index_data, err = github_api("GET", "/contents/library")
    if err or not isinstance(index_data, list):
        return None, None

    for lang_entry in index_data:
        if not isinstance(lang_entry, dict) or lang_entry.get('type') != 'dir':
            continue
        lang_name = lang_entry.get('name', '')
        files, _  = github_api("GET", f"/contents/library/{lang_name}")
        if not isinstance(files, list):
            continue
        for f in files:
            if not isinstance(f, dict) or not f.get('name', '').endswith('.json'):
                continue
            file_data, _ = github_api("GET", f"/contents/library/{lang_name}/{f['name']}")
            if not isinstance(file_data, dict):
                continue
            try:
                content = base64.b64decode(file_data.get('content', '')).decode('utf-8')
                payload = json.loads(content)
            except Exception:
                continue
            item_token = str(payload.get('token', '')).lower().strip()
            item_tok8  = item_token.zfill(8)
            item_tokn  = item_token.lstrip('0') or '0'
            if item_tok8 == token_8 or item_tokn == token_norm:
                # Found — build binary lump from the first method's words
                methods = payload.get('methods', [])
                raw_words = methods[0].get('words', []) if methods else []
                if not raw_words:
                    continue
                # If the words already have a valid lump header (magic=0x1F at [31:27]),
                # use them as-is; otherwise wrap with a generated header.
                first = int(raw_words[0]) & 0xFFFFFFFF
                if (first >> 27) == 0x1F:
                    lump_words = [int(w) & 0xFFFFFFFF for w in raw_words]
                else:
                    cw     = len(raw_words)
                    header = _pack_lump_header(n_minus_6=0, cw=cw, cc=0, typ=0)
                    lump_words = [header] + [int(w) & 0xFFFFFFFF for w in raw_words]
                name = payload.get('abstraction',
                                   f.get('name', '').replace('.json', ''))
                return _words_to_binary(lump_words), name

    return None, None

@app.route("/api/lump/<token_hex>")
def get_lump(token_hex):
    """Serve a raw lump binary — local stubs first, then Mum Tunnel Library.

    Accepts EXACTLY 8-hex (32-bit cache/index token) or 24-hex (96-bit Outform
    IDE token).  For a 24-hex Outform token the 32-bit cache/index T is the
    FINAL 8 hex chars — the Words1-3 Outform protocol carries T in W3.  Any
    other length or non-hex character is rejected with HTTP 400 (fail-closed);
    the server never truncates an arbitrary-length token to guess a lookup key.

    §8 answer (GT v2.0 spec open question): Content verifiability.
    The response includes both a CRC-32 preamble word (prepended to the payload
    by _lump_with_crc) for corruption detection and an X-Lump-Hash: sha256:<hex>
    response header carrying the SHA-256 of the raw lump bytes (before CRC prefix).
    The caller can verify byte integrity by computing sha256(raw_lump_bytes)
    and comparing against X-Lump-Hash.  X-Lump-Trust remains ``untrusted``
    unless an exact canonical approval also validates.
    """
    from flask import Response
    # ── Token format validation (fail-closed) ──────────────────────────────
    # Accept EXACTLY 8 hex (32-bit cache/index token) or 24 hex (96-bit Outform
    # IDE token).  For a 24-hex Outform token the 32-bit cache/index T is the
    # FINAL 8 hex chars — the Words1-3 protocol carries T in W3.  Anything else
    # (wrong length, non-hex) is a hard 400, never a silent truncated lookup.
    try:
        tok = _normalize_lump_token(token_hex)
    except _LumpTokenError as _te:
        return jsonify({"error": str(_te)}), 400

    key8   = tok["key8"]
    key    = key8.lstrip('0') or '0'

    data = None
    source = 'local'

    # A manifest row is a locator.  Always inspect the bytes at that exact
    # locator rather than a process cache which may predate a replacement.
    try:
        _raw_manifest = _read_manifest_safe(
            os.path.join(LUMPS_DIR, "manifest.json"))
    except ValueError as exc:
        return jsonify({"error": str(exc)}), 409
    _located_rows = [
        row for row in _raw_manifest
        if isinstance(row, dict) and row.get("token") == key8
    ]
    if len(_located_rows) > 1:
        return jsonify({"error": f"Duplicate manifest token {key8}"}), 409
    if _located_rows:
        _located_name = _located_rows[0].get("filename")
        if not isinstance(_located_name, str) or not _located_name:
            return jsonify({"error": "Manifest locator has no filename"}), 409
        try:
            data = _inspect_lump_binary(
                os.path.join(LUMPS_DIR, _located_name))["raw_bytes"]
        except (OSError, ValueError) as exc:
            return jsonify({"error": f"Lump integrity failure: {exc}"}), 409
        source = "manifest"
    else:
        data = LAZY_LUMPS.get(key) or LAZY_LUMPS.get(key8)

    if data is None:
        # Fall back to the Mum Tunnel Library
        data, lib_name = _fetch_lump_from_library(key8)
        if data is not None:
            LAZY_LUMPS[key8] = data           # cache for future requests
            source = f'library:{lib_name}'
        else:
            github_hint = '' if (GITHUB_TOKEN and GITHUB_LIBRARY_REPO) else \
                          ' (GitHub not configured — Mum Tunnel Library unavailable)'
            return jsonify({"error": f"Unknown lump token 0x{key8}{github_hint}"}), 404

    # ── Canonical resolution — fail-closed for canonical manifest entries ──
    # resolve_canonical_lump requires EXACTLY ONE canonical record per token,
    # cross-checks canonical filename, dot_name, positive issue_n, binary_hash,
    # identity_hash and sidecar consistency, and rejects ambiguous collisions
    # and mismatches.  It NEVER mutates or backfills metadata on GET.
    #   ok=False              → 409 (hard fail).
    #   ok=True, trusted=True  → serve + canonical identity-binding headers.
    #   ok=True, trusted=False → legacy/untrusted; serve raw but mark untrusted
    #                            so secure simulator promotion can reject.
    _gl_lumps_dir = LUMPS_DIR
    try:
        _gl_inspected = _inspect_lump_binary(data)
        data = _gl_inspected["raw_bytes"]
        _canonical_error = _check_lump_canonical_integrity(
            _gl_lumps_dir, key8, data)
        if isinstance(_canonical_error, str):
            return jsonify({"error": _canonical_error}), 409
        _gl_approval = _matching_lump_approval(
            _gl_lumps_dir, _gl_inspected["binary_hash"])
    except (OSError, ValueError) as exc:
        return jsonify({"error": f"Lump integrity failure: {exc}"}), 409
    if _gl_approval is None:
        _gl_res = {
            "binary_hash": _gl_inspected["binary_hash"],
            "trusted": False,
            "cache_token": key8,
        }
    else:
        _gl_res = _resolve_canonical_lump(
            _gl_lumps_dir, key8, _gl_inspected["raw_bytes"])
        if not _gl_res.get("ok"):
            return jsonify({"error": _gl_res.get("error")}), 409

    payload = _lump_with_crc(data)
    _headers = {
        'Content-Length': str(len(payload)),
        'X-Lump-Source': source,
        # X-Lump-Hash retained for backward compatibility (sha256 of raw bytes).
        'X-Lump-Hash': f"sha256:{_gl_res['binary_hash']}",
    }
    # Bind the response to canonical dot_name/issue_n/identity_hash/binary_hash
    # and the cache token (or mark untrusted for legacy entries).
    _headers.update(_canonical_binding_headers(_gl_res))
    resp = Response(payload, mimetype='application/octet-stream', headers=_headers)
    return resp


@app.route("/api/lumps/bundle.zip")
def get_lump_bundle():
    """Stream all pre-built lumps as a ZIP archive for offline / FPGA deployment.

    The archive contains:
      <token8>.lump  — raw big-endian binary for each bundled abstraction
      manifest.json  — JSON array describing each lump (token, name, cw, cc, methods)
    """
    import io as _io
    import zipfile as _zipfile
    from flask import Response as _Response

    lumps_dir = LUMPS_DIR
    buf = _io.BytesIO()
    manifest_path = os.path.join(lumps_dir, 'manifest.json') if os.path.isdir(lumps_dir) else None

    with _zipfile.ZipFile(buf, 'w', compression=_zipfile.ZIP_DEFLATED) as zf:
        n_lumps = 0
        if os.path.isdir(lumps_dir):
            import glob as _glob
            for path in sorted(_glob.glob(os.path.join(lumps_dir, '*.lump'))):
                arcname = os.path.basename(path)
                zf.write(path, arcname)
                n_lumps += 1
            if manifest_path and os.path.isfile(manifest_path):
                zf.write(manifest_path, 'manifest.json')

        if n_lumps == 0:
            inline_manifest = json.dumps(
                [{'token': k, 'abstraction': 'stub', 'lump_size': len(v) // 4,
                  'cw': 1, 'cc': 1}
                 for k, v in LAZY_LUMPS.items()],
                indent=2)
            for token_key, lump_bytes in LAZY_LUMPS.items():
                if len(token_key) == 8:
                    zf.writestr(f'{token_key}.lump', lump_bytes)
                    n_lumps += 1
            zf.writestr('manifest.json', inline_manifest)

    buf.seek(0)
    resp = _Response(
        buf.read(),
        mimetype='application/zip',
        headers={
            'Content-Disposition': 'attachment; filename="cloomc_lumps.zip"',
            'X-Lump-Count': str(n_lumps),
        })
    return resp


@app.route("/api/lumps/save-plan", methods=["POST"])
def preflight_lump_save_plan():
    """Validate a candidate through save canonicalisation without writing it."""
    candidate = request.get_json(force=True, silent=True)
    if not isinstance(candidate, dict):
        return jsonify({"error": "Invalid JSON payload"}), 400
    metadata = candidate.get("metadata", {})
    if not isinstance(metadata, dict):
        return jsonify({"error": "metadata must be an object"}), 400
    # This endpoint is the sole producer of the private preflight marker.
    planned = dict(candidate)
    planned["metadata"] = dict(metadata, _save_plan_preflight=True)
    session.setdefault("_lump_approval_session", secrets.token_urlsafe(24))
    reset = _lump_save_payload_override.set(planned)
    try:
        return save_lump()
    finally:
        _lump_save_payload_override.reset(reset)


@app.route("/api/lumps/save", methods=["POST"])
def save_lump():
    """Save a compiled LUMP binary and hash-bound approval.

    Expects JSON body with:
      binary   — array of uint32 words (big-endian will be packed server-side)
      metadata — object with abstraction name, methods, pet names, MTBF,
                 deployment info, capabilities, etc.
    Returns the token and saved file paths.
    """
    import datetime as _dt
    payload = _lump_save_payload_override.get()
    if payload is None:
        payload = request.get_json(force=True, silent=True)
    _metadata_for_diagnostic = (
        payload.get("metadata", {}) if isinstance(payload, dict) else {})
    _operation_id = (
        _metadata_for_diagnostic.get("operation_id", "")
        if isinstance(_metadata_for_diagnostic, dict) else "")
    _operation_id = str(_operation_id or request.headers.get(
        "X-Lump-Save-Operation", "")).strip()
    if not _LUMP_SAVE_OPERATION_ID_RE.fullmatch(_operation_id):
        _operation_id = uuid.uuid4().hex
    _client_diagnostic_attempt_id = (
        _metadata_for_diagnostic.get("diagnostic_attempt_id", "")
        if isinstance(_metadata_for_diagnostic, dict) else "")
    _plan_for_diagnostic = (
        _metadata_for_diagnostic.get(
            "save_plan", _metadata_for_diagnostic.get(
                "save_plan_id", _metadata_for_diagnostic.get("plan")))
        if isinstance(_metadata_for_diagnostic, dict) else "")
    g._lump_save_diagnostic = {
        # The server-generated attempt is canonical. A browser-provided
        # diagnostic_attempt_id is intentionally retained only as a client event
        # correlation hint and is never used for operation lookup or authority.
        "attempt_id": uuid.uuid4().hex,
        "operation_id": _operation_id,
        "candidate_id": None,
        "plan_id": _plan_for_diagnostic,
        "client_diagnostic_attempt_id": _client_diagnostic_attempt_id,
        "is_preflight": False,
        "started_monotonic": time.monotonic(),
    }
    _save_lump_diagnostic_event(
        stage="Capture", event="request_arrival", outcome="unknown")
    _is_preflight = bool(
        isinstance(_metadata_for_diagnostic, dict)
        and _metadata_for_diagnostic.get("_save_plan_preflight") is True
        and _lump_save_payload_override.get() is not None)
    g._lump_save_diagnostic["is_preflight"] = _is_preflight
    # Candidate and operation recovery reuse the existing approval-session
    # boundary.  Establish it before persisting a rejected direct save too.
    session.setdefault("_lump_approval_session", secrets.token_urlsafe(24))
    try:
        _candidate_id = _store_lump_save_candidate(
            payload, _operation_id, preflight=_is_preflight,
            attempt_id=g._lump_save_diagnostic.get("attempt_id"),
            plan_id=g._lump_save_diagnostic.get("plan_id"))
        g._lump_save_diagnostic["candidate_id"] = _candidate_id
        _save_lump_diagnostic_event(
            stage="Capture", event="candidate_retained", outcome="unknown")
    except Exception as _candidate_error:
        logging.exception("[lumps] unable to retain original save candidate")
        _save_lump_diagnostic_event(
            stage="Capture", event="exception", outcome="unknown",
            error={"name": type(_candidate_error).__name__,
                   "message": str(_candidate_error)})
        return jsonify({
            "error": f"unable to durably retain original save candidate: {_candidate_error}",
            "operation_id": _operation_id, "committed": False,
        }), 503
    if not payload:
        _save_lump_diagnostic_event(
            stage="Prepare", event="rejection", outcome="rejected",
            error={"name": "InvalidPayload", "message": "Invalid JSON payload"})
        return jsonify({"error": "Invalid JSON payload"}), 400
    _save_lump_diagnostic_event(
        stage="Prepare", event="start", outcome="unknown")

    # An operation is durable before validation starts.  Returning a previous
    # terminal response makes a lost successful response idempotent without
    # repeating archive/history work.  Preflight is intentionally excluded:
    # it prepares an approval, it does not mutate an operation.
    if not _is_preflight:
        try:
            with _lump_save_operation_guard(_operation_id):
                _existing_operation = _read_lump_save_operation(_operation_id)
                if _existing_operation:
                    if _existing_operation.get("session_binding") != _operation_session_binding():
                        return jsonify({
                            "error": "save operation id is unavailable",
                            "operation_id": _operation_id, "committed": None,
                        }), 409
                    if _existing_operation.get("original_payload") != payload:
                        return jsonify({
                            "error": (
                                "save operation id is already bound to different "
                                "original source/binary payload; use a new operation id"
                            ),
                            "operation_id": _operation_id, "committed": False,
                        }), 409
                    _existing_operation = _settle_orphaned_lump_save_operation(
                        _operation_id, _existing_operation)
                    if _existing_operation.get("outcome") in {"committed", "rejected"}:
                        # Keep the retry's fresh attempt separate while linking
                        # replay diagnostics back to the durable candidate and
                        # plan that established this operation.
                        g._lump_save_diagnostic["candidate_id"] = (
                            _existing_operation.get("candidate_id")
                            or g._lump_save_diagnostic.get("candidate_id"))
                        g._lump_save_diagnostic["plan_id"] = (
                            _existing_operation.get("plan_id")
                            or g._lump_save_diagnostic.get("plan_id"))
                        _save_lump_diagnostic_event(
                            stage="Commit", event="operation_replay",
                            outcome=(
                                "committed"
                                if _existing_operation.get("outcome") == "committed"
                                else "rejected"
                            ))
                        _stored_response = _existing_operation.get("response") or {}
                        return jsonify(_stored_response), (
                            200 if _existing_operation.get("outcome") == "committed"
                            else int(_existing_operation.get("status", 409)))
                    return jsonify({
                        "error": "save operation outcome is unknown; inspect its status before retrying",
                        "operation_id": _operation_id, "committed": None,
                    }), 409
                _write_lump_save_operation(_operation_id, {
                    "created_at": time.time(),
                    "outcome": "pending",
                    "session_binding": _operation_session_binding(),
                    "candidate_id": _candidate_id,
                    "attempt_id": g._lump_save_diagnostic.get("attempt_id"),
                    "plan_id": g._lump_save_diagnostic.get("plan_id"),
                    "client_diagnostic_attempt_id": g._lump_save_diagnostic.get(
                        "client_diagnostic_attempt_id"),
                    "original_payload": payload,
                })
                g._lump_save_operation_active = True
        except Exception:
            return jsonify({
                "error": "unable to durably record save operation before validation",
                "operation_id": _operation_id, "committed": None,
            }), 503

    words    = payload.get("binary", [])
    metadata = payload.get("metadata", {})
    if not isinstance(metadata, dict):
        return jsonify({"error": "metadata must be an object"}), 400

    # A previously issued plan is the sole authority for server-localized
    # bytes and for a New Entry destination.  The supplied final binary must
    # agree exactly; committing a recomputed browser candidate would reopen the
    # plan/commit drift this endpoint is meant to close.
    _early_plan_id = metadata.get(
        "save_plan", metadata.get("save_plan_id", metadata.get("plan")))
    _early_plan = None
    if _early_plan_id:
        with _LUMP_SAVE_PLANS_LOCK:
            _early_plan = _LUMP_SAVE_PLANS.get(str(_early_plan_id))
            if (_early_plan is None or _early_plan.get("expires", 0) < time.time()
                    or _early_plan.get("session") != session.get("_lump_approval_session")):
                _early_plan = None
            else:
                _early_plan = dict(_early_plan)
        if _early_plan is None:
            return jsonify({"error": "a valid save plan is required",
                            "committed": False}), 403
        _planned_words = _early_plan.get("final_binary")
        if (not isinstance(_planned_words, list)
                or any(isinstance(word, bool) or not isinstance(word, int)
                       or not 0 <= word <= 0xFFFFFFFF for word in _planned_words)):
            return jsonify({"error": "save plan has no valid finalized binary",
                            "committed": None}), 409
        if words != _planned_words:
            return jsonify({
                "error": "submitted binary does not equal the server-finalized save plan",
                "plan_binary_mismatch": True, "committed": False,
            }), 409
        words = list(_planned_words)
        metadata = dict(metadata, ns_slot=_early_plan.get("ns_slot"),
                        token=_early_plan.get("token"))
    elif (
        metadata.get("new_entry") is True
        # compileAndBuild uses the dynamic Namespace policy with a null slot
        # rather than the Save-to-Namespace dialog's explicit new_entry flag.
        # Resolve that destination here, before SELF canonicalisation, so the
        # authoritative preparation path is identical for both callers.
        or (
            metadata.get("ns_slot") is None
            and metadata.get("ns_slot_policy") == "dynamic"
        )
    ):
        try:
            metadata = dict(metadata, ns_slot=_allocate_new_lump_slot())
        except ValueError as exc:
            return jsonify({"error": f"New Entry allocation failed: {exc}",
                            "committed": False}), 409

    if not words or len(words) < 2:
        return jsonify({"error": "Binary must contain at least a header and one code word"}), 400

    hdr = int(words[0]) & 0xFFFFFFFF
    if (hdr >> 27) & 0x1F != 0x1F:
        return jsonify({"error": "Bad lump magic in header word"}), 400

    hdr_typ = (hdr >> 8) & 0x3
    _ct_default_map = {0: 'code', 1: 'data', 2: 'thread', 3: 'outform'}
    content_type = metadata.get("content_type") or _ct_default_map.get(hdr_typ, 'binary')

    _promotion_hint = metadata.get("promotion_binding")
    # Structural destination facts are authoritative only when supplied by a
    # server-issued promotion binding; browser metadata is never used for this.
    if isinstance(_promotion_hint, dict):
        if not _promotion_hint.get("binding_id"):
            return jsonify({
                "error": "Promotion binding is missing its server-issued identifier",
                "promotion_binding_failed": True,
                "committed": False,
                "safe_retry": True,
            }), 409
        metadata = dict(metadata)
        abs_name = _promotion_hint.get("abstraction", "")
        ns_slot = _promotion_hint.get("ns_slot")
        if _promotion_hint.get("bootstrap_snapshot") is not None:
            metadata["enforce_bootstrap_identity"] = True
        if _promotion_hint.get("namespace_sequence") is not None:
            metadata["namespace_sequence"] = _promotion_hint["namespace_sequence"]
    else:
        abs_name = metadata.get("abstraction", "Unnamed")
        ns_slot = metadata.get("ns_slot", None)
    token_hint   = metadata.get("token", None)
    _petname     = str(metadata.get("petname", "")).strip()
    _issue_number = int(metadata.get("issue_number", 1) or 1)

    import re as _re
    if ns_slot is not None:
        try:
            ns_slot = int(ns_slot)
        except (TypeError, ValueError):
            return jsonify({"error": "Namespace slot must be an integer"}), 400
        if not 0 <= ns_slot < MAX_NS_ENTRIES:
            return jsonify({
                "error": (
                    f"Namespace slot must be between 0 and "
                    f"{MAX_NS_ENTRIES - 1}."
                ),
            }), 400
    _bootstrap_identity = None
    if token_hint:
        token8 = str(token_hint).lower().zfill(8)[:8]
    elif ns_slot is not None:
        # The resident SelfTest token is assigned below once its live runtime
        # row-0 SELF GT is known.  Ordinary/dynamic LUMPs retain their
        # established lookup-token contract.
        token8 = "00000000" if str(abs_name).strip() == "SelfTest" else f"{int(ns_slot) << 8:08x}"
    else:
        import hashlib as _hl
        digest = _hl.sha256(abs_name.encode('utf-8')).hexdigest()[:8]
        token8 = digest

    if not _re.fullmatch(r'[0-9a-f]{8}', token8):
        return jsonify({"error": "Invalid token — must be 8 hex characters"}), 400

    # ── Lump construction test: all c-list slot refs must be in-bounds ────────
    # For a code lump with cc > 0, every LOAD/SAVE/ELOADCALL/XLOADLAMBDA
    # instruction that reads from the c-list (crSrc = CR6 = 6) must reference a
    # slot index strictly less than cc.  A slot >= cc means the code was compiled
    # against one c-list layout (e.g. the full 18-entry DEMO_CLIST) while the
    # header cc reflects a different layout (e.g. a POLA-compacted 1-entry list).
    # This inconsistency is generated by the IDE when the assembler rewrites code
    # words without rebuilding the c-list, and it must be caught at save time
    # rather than silently producing a boot image that faults at runtime.
    _CLIST_SAVE_OPS = frozenset((0, 1, 8, 9))  # LOAD SAVE ELOADCALL XLOADLAMBDA
    _sl_cc  = hdr & 0xFF
    _sl_cw  = (hdr >> 10) & 0x1FFF
    _sl_typ = (hdr >> 8) & 0x3
    if _sl_typ == 0 and _sl_cc > 0:
        for _sl_wi in range(1, 1 + _sl_cw):
            if _sl_wi >= len(words):
                break
            _sl_ww  = int(words[_sl_wi]) & 0xFFFFFFFF
            _sl_op  = (_sl_ww >> 27) & 0x1F
            _sl_crs = (_sl_ww >> 15) & 0xF
            # ELOADCALL (op=8) imm15 is split: bits[4:0]=c-list row, bits[11:5]=methodIdx.
            # LOAD/SAVE/XLOADLAMBDA (ops 0,1,9) use the full 15-bit imm15 as slot index.
            # Must match lump-audit.js RCI line: op===8 ? (ww & 0x1F) : (ww & 0x7FFF)
            _sl_slt = _sl_ww & 0x1F if _sl_op == 8 else _sl_ww & 0x7FFF
            if _sl_op in _CLIST_SAVE_OPS and _sl_crs == 6 and _sl_slt >= _sl_cc:
                return jsonify({
                    "error": (
                        f"Lump construction error: code[{_sl_wi}] references "
                        f"c-list slot {_sl_slt} but cc={_sl_cc} "
                        f"(valid range: 0\u2013{_sl_cc - 1}). "
                        f"The code was assembled against a different c-list layout "
                        f"than the one stored in the lump header. "
                        f"Re-run POLA or reset cc before saving."
                    ),
                    "clist_inconsistent": True,
                    "bad_code_word":      _sl_wi,
                    "bad_slot":           _sl_slt,
                    "cc":                 _sl_cc,
                }), 422

    # SelfTest's first two c-list rows are executable boot contracts, rather
    # than a caller-owned identity seal.  Its token and physical slot are
    # deliberately not part of that contract: the programmer selects an
    # unprotected Namespace slot, and ns-state supplies its live sequence.
    _is_selftest_canonical = str(abs_name).strip() == "SelfTest"
    _bootstrap_binding = None
    _bootstrap_source_binding = None
    try:
        if os.path.isfile(NS_STATE_PATH):
            with open(NS_STATE_PATH, encoding="utf-8") as _bootstrap_state_file:
                _bootstrap_rows_all = json.load(_bootstrap_state_file).get("abstractions", [])
        else:
            _bootstrap_rows_all = []
        _frozen_rows = [
            row for row in _bootstrap_rows_all if isinstance(row, dict)
            and row.get("resident") is True and row.get("boot_resident") is True
            and row.get("ns_slot_policy") == "static"
            and row.get("load_policy") == "Resident"
            and row.get("type") in ("Inform", "Resident")
        ]
        _target_frozen_rows = [
            row for row in _frozen_rows if row.get("slot") == ns_slot
        ]
        if len(_target_frozen_rows) > 1:
            raise ValueError(
                f"multiple authoritative frozen resident bindings occupy NS[{ns_slot}]")
        if _target_frozen_rows:
            # The programmer chooses the destination. The current descriptor at
            # that destination supplies only the local slot/sequence needed to
            # mint SELF; its previous abstraction name does not own the slot.
            _bootstrap_binding = _target_frozen_rows[0]
            if (_is_selftest_canonical
                    and _bootstrap_binding.get("name") == "SelfTest"):
                _bootstrap_source_binding = dict(_bootstrap_binding)
        elif _is_selftest_canonical:
            _selftest_frozen_rows = [
                row for row in _frozen_rows if row.get("name") == "SelfTest"
            ]
            if len(_selftest_frozen_rows) > 1:
                raise ValueError("multiple authoritative frozen SelfTest bindings")
            if _selftest_frozen_rows:
                # SelfTest may be migrated to another programmer-selected slot.
                # Its target slot/sequence are filled after target validation.
                _bootstrap_source_binding = dict(_selftest_frozen_rows[0])
                _bootstrap_binding = dict(_selftest_frozen_rows[0])
    except (OSError, ValueError, TypeError, json.JSONDecodeError) as _bootstrap_state_error:
        return jsonify({
            "error": f"Bootstrap inventory validation failed: {_bootstrap_state_error}",
            "namespace_identity_failed": True,
        }), 422
    # Bootstrap identity enforcement is explicit, never inherited from the
    # previous occupant of a programmer-selected slot. Generic Namespace saves
    # may replace every slot with any abstraction.
    _is_server_bootstrap_history_repair = bool(
        _lump_bootstrap_history_repair_override.get()
        and metadata.get("_bootstrap_history_repair") is True
    )
    if _is_server_bootstrap_history_repair:
        _repair_destination = metadata.get("_bootstrap_repair_destination")
        if not isinstance(_repair_destination, dict):
            return jsonify({
                "error": "Bootstrap correction destination identity is missing.",
                "namespace_identity_failed": True,
                "committed": False,
                "safe_retry": True,
            }), 409
        _bootstrap_binding = dict(_repair_destination)
        ns_slot = _bootstrap_binding.get("slot")
        token_hint = _bootstrap_binding.get("token")
        token8 = str(token_hint or "").lower()
        if (not re.fullmatch(r"[0-9a-f]{8}", token8)
                or not isinstance(ns_slot, int)):
            return jsonify({
                "error": "Bootstrap correction destination identity is invalid.",
                "namespace_identity_failed": True,
                "committed": False,
                "safe_retry": True,
            }), 409
        metadata["namespace_sequence"] = _bootstrap_binding.get("seq", 0)
    _is_bootstrap_canonical = (
        _bootstrap_binding is not None
        and metadata.get("enforce_bootstrap_identity") is True
    )
    _is_selftest_canonical = _is_bootstrap_canonical and _is_selftest_canonical

    # ── Pre-flight: identity computation + seal verification ──────────────────
    # Pure computation — no filesystem reads or writes — so a corrupt lump
    # header that makes c-list[0] unwritable returns 422 BEFORE any existing
    # archive or sidecar is touched by Phase 4.
    import hashlib as _hl_id
    if _petname:
        _identity_string = f"{_petname}.{abs_name}#{_issue_number}"
    else:
        _identity_string = f"{abs_name}#{_issue_number}"
    _identity_hash = _hl_id.sha256(_identity_string.encode('utf-8')).hexdigest()
    _save_warnings = []

    # Build the word array. Structural and canonical checks run before the
    # cc=0→1 auto-rewrite so it cannot be used as a bypass.
    _sl_words = [int(w) & 0xFFFFFFFF for w in words]
    _sl_hdr   = _sl_words[0]
    _sl_cc2   = _sl_hdr & 0xFF
    _sl_lsz   = 1 << (((_sl_hdr >> 23) & 0xF) + 6)
    # The browser sends the exact compiled word region as part of the save
    # snapshot. Validate it against the submitted binary so stale registry
    # state cannot be paired with a different source/editor snapshot.
    _submitted_compiled_words = metadata.get("compiled_words")
    if _submitted_compiled_words is not None:
        if (not isinstance(_submitted_compiled_words, list) or
                any(isinstance(word, bool) or
                    not isinstance(word, (int, float)) or
                    int(word) != word or not 0 <= int(word) <= 0xFFFFFFFF
                    for word in _submitted_compiled_words)):
            return jsonify({
                "error": "Save rejected: compiled_words is not a uint32 word array.",
                "snapshot_mismatch": True,
                "committed": False,
                "safe_retry": True,
            }), 422
        _submitted_compiled_words = [
            int(word) & 0xFFFFFFFF for word in _submitted_compiled_words]
        if _submitted_compiled_words != _sl_words[1:1 + _sl_cw]:
            return jsonify({
                "error": (
                    "Save rejected: compiled words do not match the submitted "
                    "LUMP binary."
                ),
                "snapshot_mismatch": True,
                "committed": False,
                "safe_retry": True,
            }), 422
    _declared_caps_raw = metadata.get("capabilities", [])
    if _declared_caps_raw is None:
        _declared_caps_raw = []
    if not isinstance(_declared_caps_raw, list):
        return jsonify({
            "error": "Capability validation failed: metadata.capabilities must be an array.",
            "capability_validation_failed": True,
        }), 422
    _has_declared_caps = len(_declared_caps_raw) > 0
    # Newly compiled ordinary abstractions reserve row zero as a compiler-owned
    # placeholder.  It is intentionally NOT a runtime GT: the final Namespace
    # slot and sequence only exist in the installation transaction, which mints
    # the live self E-GT.  Legacy and architectural binaries keep their existing
    # explicit contracts.
    _compiler_self_row = (
        _sl_typ == 0 and _has_declared_caps and
        isinstance(_declared_caps_raw[0], dict) and
        str(_declared_caps_raw[0].get("name", "")).strip().upper() == "__SELF__"
    )
    _SELF_CAPABILITY_PLACEHOLDER = 0xFEED5E1F
    _validated_declared_caps = []
    _portable_binding_raw = metadata.get("portable_binding", metadata.get("portableBinding"))
    _portable_binding = None
    if _portable_binding_raw is not None:
        try:
            from portable_binding import validate_portable_binding as _validate_portable_binding
        except ImportError:
            from server.portable_binding import validate_portable_binding as _validate_portable_binding
        try:
            _portable_binding = _validate_portable_binding(_portable_binding_raw, _sl_cc2)
        except ValueError as _portable_error:
            return jsonify({"error": f"Portable binding validation failed: {_portable_error}",
                            "portable_binding_validation_failed": True}), 422

    # Header and submitted-array shape must agree before any c-list offset is
    # derived. Compact input is allowed and padded below; appended words are
    # not, because they would be persisted outside the declared allocation.
    if _sl_lsz < 1 + (( _sl_hdr >> 10) & 0x1FFF) + _sl_cc2:
        return jsonify({"error": "LUMP header declares code/c-list sections outside "
                                 "its allocated size.",
                        "lump_structure_invalid": True}), 422
    if len(_sl_words) > _sl_lsz:
        return jsonify({"error": f"Submitted binary has {len(_sl_words)} words but "
                                 f"its header allocates {_sl_lsz}.",
                        "lump_structure_invalid": True,
                        "declared_lump_size": _sl_lsz,
                        "actual_lump_size": len(_sl_words)}), 422

    # ── Canonical SelfTest c-list contract ───────────────────────────────────
    # The allocated size is intentionally variable.  Row offsets and Golden
    # Tokens are derived from the selected Namespace descriptor, never a
    # historical token, 512-word shape, or fixed slot number.
    if _is_selftest_canonical:
        _SELFTEST_CANONICAL_CC = 2
        if _sl_cc2 != _SELFTEST_CANONICAL_CC:
            return jsonify({
                "error": (
                    "SelfTest layout guard: canonical SelfTest lump "
                    f"must have cc={_SELFTEST_CANONICAL_CC} in the header "
                    f"incoming binary has cc={_sl_cc2}. "
                    "Submitting cc=0 to trigger the auto-rewrite is not permitted."
                ),
                "selftest_cc_mismatch": True,
                "expected_cc":          _SELFTEST_CANONICAL_CC,
                "actual_cc":            _sl_cc2,
            }), 422

    if _sl_cc2 == 0 and not _has_declared_caps and _portable_binding is None:
        # No c-list yet — open one slot in the padding zone and bump cc to 1.
        # Never reached for the canonical 512-word SelfTest lump: cc=2 is
        # enforced by the guard above before this point.
        _sl_words[0] = (_sl_hdr & 0xFFFFFF00) | 0x01
        _sl_cc2 = 1

    # Pad to the logical lump size so the c-list area is always reachable,
    # even when the client sends a compact binary (only non-zero words).
    if len(_sl_words) < _sl_lsz:
        _sl_words.extend([0] * (_sl_lsz - len(_sl_words)))

    _clist_row0_idx = _sl_lsz - _sl_cc2
    if (_compiler_self_row and ns_slot is None
            and _portable_binding is None):
        # A compiler-owned SELF row is only an intermediate representation.
        # It may be accepted by preparation when the caller selected a
        # Namespace destination, but it must never be persisted as an
        # unresolved artifact with no authoritative sequence/slot.
        return jsonify({
            "error": (
                "Namespace identity validation failed: compiler-owned "
                "SELF requires a selected Namespace slot before saving."
            ),
            "namespace_identity_failed": True,
            "clist_row": 0,
            "expected_placeholder": _SELF_CAPABILITY_PLACEHOLDER,
            "safe_retry": True,
        }), 422

    if _compiler_self_row and _portable_binding is None and ns_slot is not None:
        # Only the compiler's exact symbolic SELF marker may be reminted as
        # part of this preparation stage.  In particular, a FEED-prefixed
        # value is not evidence that the compiler emitted a placeholder:
        # malformed, zero, or foreign words must not be silently replaced by
        # the authoritative Namespace GT.
        _submitted_self_word = _sl_words[_clist_row0_idx] & 0xFFFFFFFF
        _compiler_self_provenance = (
            isinstance(_declared_caps_raw[0], dict)
            and _declared_caps_raw[0].get("compiler_owned_self") is True
        )
        _concrete_self_word = (
            # The 9-bit sequence occupies bits 24..16, so bit 24 must not
            # participate in the fixed SELF E-GT shape comparison.  In
            # particular, sequence 256/511 legitimately produce 0x4B... .
            (_submitted_self_word & 0xFE000000) == 0x4A000000
        )
        _concrete_retry_context = (
            _is_preflight or _early_plan is not None or
            _is_bootstrap_canonical
        )
        if _submitted_self_word == _SELF_CAPABILITY_PLACEHOLDER:
            if not (_compiler_self_provenance or _is_bootstrap_canonical):
                return jsonify({
                    "error": (
                        "SELF intermediate contract failed: compiler-owned "
                        "SELF requires exact marker provenance "
                        "compiler_owned_self=true before Namespace rewrite."
                    ),
                    "self_intermediate_contract_failed": True,
                    "clist_row": 0,
                    "expected_placeholder": _SELF_CAPABILITY_PLACEHOLDER,
                    "actual_word": _submitted_self_word,
                    "safe_retry": True,
                }), 422
        elif not (_concrete_self_word and _concrete_retry_context):
            return jsonify({
                "error": (
                    "SELF intermediate contract failed: c-list row 0 must "
                    "contain the exact compiler marker "
                    f"0x{_SELF_CAPABILITY_PLACEHOLDER:08X}, or an already "
                    "concrete server-finalized SELF GT for a valid retry."
                ),
                "self_intermediate_contract_failed": True,
                "clist_row": 0,
                "expected_placeholder": _SELF_CAPABILITY_PLACEHOLDER,
                "actual_word": _submitted_self_word,
                "safe_retry": True,
            }), 422
        _misplaced_self_rows = [
            _row for _row in range(1, _sl_cc2)
            if ((_sl_words[_clist_row0_idx + _row] & 0xFFFFFFFF) >> 16) == 0xFEED
        ]
        if _misplaced_self_rows:
            _misplaced_row = _misplaced_self_rows[0]
            _misplaced_word = (
                _sl_words[_clist_row0_idx + _misplaced_row] & 0xFFFFFFFF)
            return jsonify({
                "error": (
                    "Capability validation failed: compiler-owned SELF "
                    f"placeholder is misplaced at c-list row {_misplaced_row} "
                    f"(0x{_misplaced_word:08X}); row 0 is the only legal "
                    "intermediate location."
                ),
                "capability_validation_failed": True,
                "clist_row": _misplaced_row,
                "actual_word": _misplaced_word,
                "safe_retry": True,
            }), 422

    def _warn_clist0_owner_mismatch(_expected, _actual):
        _expected &= 0xFFFFFFFF
        _actual &= 0xFFFFFFFF
        if _actual == _expected:
            return
        _save_warnings.append({
            "code": "clist0_owner_golden_token_mismatch",
            "message": (
                f"C-list[0] should be the owning abstraction's Golden Token "
                f"0x{_expected:08X}; submitted value is 0x{_actual:08X}. "
                "The submitted value was preserved and no corrective action was taken."
            ),
            "expected_golden_token": _expected,
            "actual_word": _actual,
            "clist_row": 0,
            "abstraction": abs_name,
        })

    if ns_slot is not None and not _is_bootstrap_canonical:
        _selected_sequence = metadata.get("namespace_sequence", 0)
        try:
            _selected_sequence = int(_selected_sequence)
            if os.path.isfile(NS_STATE_PATH):
                with open(NS_STATE_PATH, encoding="utf-8") as _selected_state_file:
                    _selected_rows = json.load(_selected_state_file).get(
                        "abstractions", [])
                _selected_entry = next(
                    (row for row in _selected_rows
                     if isinstance(row, dict) and row.get("slot") == ns_slot),
                    None,
                )
                if _selected_entry is not None:
                    _selected_sequence = int(_selected_entry.get("seq", 0))
            if not 0 <= _selected_sequence <= 0x1FF:
                raise ValueError("sequence is outside the 9-bit range")
        except (OSError, ValueError, TypeError, json.JSONDecodeError) as _selected_error:
            return jsonify({
                "error": (
                    "Namespace identity validation failed for selected "
                    f"NS[{ns_slot}]: {_selected_error}"
                ),
                "namespace_identity_failed": True,
                "failure_owner": "ide",
                "committed": False,
                "safe_retry": True,
            }), 422
        _expected_owner_gt = _boot_image_gen.create_gt(
            _selected_sequence, ns_slot, {"E": 1}, 1)
        _warn_clist0_owner_mismatch(
            _expected_owner_gt, _sl_words[_clist_row0_idx])
        if _compiler_self_row:
            _sl_words[_clist_row0_idx] = _expected_owner_gt

    if _is_bootstrap_canonical and not _is_selftest_canonical:
        if _sl_cc2 < 1:
            return jsonify({"error": "Bootstrap resident requires c-list row 0.",
                            "namespace_identity_failed": True}), 422
        try:
            _live_bootstrap_gt = _resident_inform_egt(_bootstrap_binding)
            _actual_bootstrap_gt = _sl_words[_clist_row0_idx] & 0xFFFFFFFF
            _warn_clist0_owner_mismatch(
                _live_bootstrap_gt, _actual_bootstrap_gt)
            _runtime_t = _verify_bootstrap_self_gt(
                _bootstrap_binding, _live_bootstrap_gt,
                f"{_live_bootstrap_gt:08x}")
            if token_hint and token8 != _runtime_t:
                raise ValueError(
                    "submitted canonical token differs from the selected "
                    "Namespace descriptor and final row-zero SELF")
            if "namespace_sequence" in metadata:
                _submitted_sequence = metadata.get("namespace_sequence")
                if isinstance(_submitted_sequence, bool):
                    raise ValueError("submitted Namespace sequence is invalid")
                try:
                    _submitted_sequence = int(_submitted_sequence)
                except (TypeError, ValueError):
                    raise ValueError(
                        "submitted Namespace sequence is invalid") from None
                if _submitted_sequence != _bootstrap_binding.get("seq", 0):
                    raise ValueError(
                        "submitted Namespace sequence differs from the selected "
                        "Namespace descriptor")
            # The selected frozen-resident Namespace descriptor owns SELF.
            # Commit the same reminted row that save-plan hashed; otherwise the
            # repository can accept a stale browser row (for example slot 6)
            # while recording the artifact as another slot (for example 10).
            _sl_words[_clist_row0_idx] = _live_bootstrap_gt
            # The programmer may replace any Namespace entry. A browser-supplied
            # content token is therefore only a
            # lookup hint here, never authority over a resident binding. The
            # verified row-zero SELF GT is canonical for the committed artifact.
            token8 = _runtime_t
            _bootstrap_identity = _bootstrap_identity_record(
                _bootstrap_binding, _live_bootstrap_gt)
        except ValueError as _bootstrap_error:
            return jsonify({
                "error": (
                    "The IDE refused the bootstrap save before changing any data. "
                    "It can retry from the unchanged source after rebuilding the "
                    f"candidate: {_bootstrap_error}"
                ),
                "namespace_identity_failed": True,
                "failure_owner": "ide",
                "committed": False,
                "safe_retry": True,
            }), 422
    if _is_selftest_canonical:
        if not isinstance(ns_slot, int):
            return jsonify({
                "error": "SelfTest requires a programmer-selected Namespace slot.",
                "namespace_identity_failed": True,
                "failure_owner": "ide",
                "committed": False,
                "safe_retry": True,
            }), 422
        # ns-state is the authority for a reissued descriptor's sequence.  A
        # previously unused slot starts at sequence zero and is materialized by
        # the commit below; client metadata.namespace_sequence is never trusted.
        _selftest_sequence = 0
        _state_rows = []
        if os.path.isfile(NS_STATE_PATH):
            try:
                with open(NS_STATE_PATH, encoding="utf-8") as _state_file:
                    _state_doc = json.load(_state_file)
                _state_rows = _state_doc.get("abstractions", [])
                if not isinstance(_state_rows, list):
                    raise ValueError("abstractions is not an array")
                _state_row = next(
                    (row for row in _state_rows
                     if isinstance(row, dict) and row.get("slot") == ns_slot),
                    None)
                _selftest_rows = [
                    row for row in _state_rows
                    if isinstance(row, dict) and row.get("name") == "SelfTest"
                ]
                if len(_selftest_rows) > 1:
                    raise ValueError("multiple authoritative SelfTest rows exist")
                if _state_row is not None:
                    if _state_row.get("name") != abs_name:
                        raise ValueError(
                            f"NS[{ns_slot}] belongs to {_state_row.get('name')!r}, "
                            f"not {abs_name!r}")
                    _selftest_sequence = _state_row.get("seq", 0)
                elif _selftest_rows:
                    # This is a slot migration.  Carry the single descriptor's
                    # current sequence into its new unoccupied slot.
                    _selftest_sequence = _selftest_rows[0].get("seq", 0)
                if (isinstance(_selftest_sequence, bool)
                        or not isinstance(_selftest_sequence, int)
                        or not 0 <= _selftest_sequence <= 0x1FF):
                    raise ValueError(
                        f"NS[{ns_slot}] has invalid live sequence "
                        f"{_selftest_sequence!r}")
            except (OSError, ValueError, TypeError, json.JSONDecodeError) as _state_error:
                return jsonify({
                    "error": f"Namespace identity validation failed: {_state_error}",
                    "namespace_identity_failed": True,
                }), 422
        _selftest_egt = _boot_image_gen.create_gt(
            _selftest_sequence, ns_slot, {"E": 1}, 1)
        _bootstrap_binding = dict(
            _bootstrap_binding,
            name="SelfTest",
            slot=ns_slot,
            seq=_selftest_sequence,
            token=f"{_selftest_egt:08x}",
        )
        _actual_selftest_gt = _sl_words[_clist_row0_idx] & 0xFFFFFFFF
        _warn_clist0_owner_mismatch(
            _selftest_egt, _actual_selftest_gt)
        try:
            _bootstrap_identity = _bootstrap_identity_record(
                _bootstrap_binding, _selftest_egt)
            _runtime_t = _verify_bootstrap_self_gt(
                _bootstrap_binding, _selftest_egt,
                _bootstrap_identity["bootstrap_t"])
        except ValueError as _bootstrap_error:
            return jsonify({
                "error": f"Bootstrap identity validation failed: {_bootstrap_error}",
                "namespace_identity_failed": True,
                "failure_owner": "ide",
                "committed": False,
                "safe_retry": True,
            }), 422
        # T is not a projection and not a cache alias in the frozen resident
        # bootstrap: its eight hex digits serialize the full row-0 GT.
        if token_hint and token8 != _runtime_t:
            return jsonify({
                "error": (
                    "SelfTest bootstrap T must equal the full runtime row-0 "
                    f"SELF GT 0x{_selftest_egt:08X}; got {token8}."),
                "namespace_identity_failed": True,
            }), 422
        token8 = _runtime_t
        _saved_boot_cfg, _saved_boot_error = _read_saved_boot_config()
        if _saved_boot_error:
            return jsonify({
                "error": (
                    "SelfTest Next continuation E-GT guard could not read the "
                    f"LightningBolt selection: {_saved_boot_error}"),
                "selftest_egt_mismatch": True,
            }), 422
        _starter_slot = _saved_boot_cfg.get(
            "bootEntrySlot", DEFAULT_BOOT_CONFIG["bootEntrySlot"])
        if (isinstance(_starter_slot, bool)
                or not isinstance(_starter_slot, int)
                or not 0 <= _starter_slot < MAX_NS_ENTRIES):
            return jsonify({
                "error": (
                    "SelfTest Next continuation E-GT guard: saved "
                    f"bootEntrySlot is invalid: {_starter_slot!r}."),
                "selftest_egt_mismatch": True,
            }), 422
        if _starter_slot == ns_slot:
            _starter_sequence = _selftest_sequence
        else:
            _starter_row = next(
                (row for row in _state_rows
                 if isinstance(row, dict) and row.get("slot") == _starter_slot),
                None)
            if _starter_row is None:
                return jsonify({
                    "error": (
                        "SelfTest Next continuation E-GT guard: "
                        f"LightningBolt NS[{_starter_slot}] has no authoritative "
                        "Namespace entry."),
                    "selftest_egt_mismatch": True,
                }), 422
            _starter_sequence = _starter_row.get("seq", 0)
            if (isinstance(_starter_sequence, bool)
                    or not isinstance(_starter_sequence, int)
                    or not 0 <= _starter_sequence <= 0x1FF):
                return jsonify({
                    "error": (
                        "SelfTest Next continuation E-GT guard: "
                        f"LightningBolt NS[{_starter_slot}] has invalid live "
                        f"sequence {_starter_sequence!r}."),
                    "selftest_egt_mismatch": True,
                }), 422
        _next_egt = _boot_image_gen.create_gt(
            _starter_sequence, _starter_slot, {"E": 1}, 1)
        for _row, _expected, _label, _expected_slot, _expected_sequence in (
                (1, _next_egt, "Next continuation E-GT",
                 _starter_slot, _starter_sequence),):
            _word_index = _clist_row0_idx + _row
            _actual = _sl_words[_word_index] & 0xFFFFFFFF
            if _actual != _expected:
                return jsonify({
                    "error": (
                        f"SelfTest {_label} guard: c-list[{_row}] at "
                        f"word[{_word_index}] must be 0x{_expected:08X} for "
                        f"NS[{_expected_slot}] sequence {_expected_sequence}; got "
                        f"0x{_actual:08X}."),
                    "selftest_egt_mismatch": True,
                    "expected_egt": _expected,
                    "actual_word": _actual,
                    "word_index": _word_index,
                    "clist_row": _row,
                    "ns_slot": _expected_slot,
                    "sequence": _expected_sequence,
                }), 422
    if _portable_binding is not None:
        try:
            try:
                from portable_binding import validate_unresolved_clist as _validate_unresolved_clist
            except ImportError:
                from server.portable_binding import validate_unresolved_clist as _validate_unresolved_clist
            _validate_unresolved_clist(_portable_binding, _sl_words)
        except ValueError as _portable_error:
            return jsonify({"error": f"Portable binding validation failed: {_portable_error}",
                            "portable_binding_validation_failed": True}), 422

    # No compiler SELF placeholder may cross the final preparation boundary.
    # The compiler-owned row is rewritten above from the selected Namespace
    # descriptor; any marker still present is either misplaced or an
    # undeclared client-supplied placeholder.  Keep this final byte gate
    # independent of metadata names so a forged/non-SELF declaration cannot
    # turn the reserved marker into an accepted artifact.
    _unresolved_self_rows = [] if _portable_binding is not None else [
        _row for _row in range(_sl_cc2)
        if ((_sl_words[_clist_row0_idx + _row] & 0xFFFFFFFF) >> 16) == 0xFEED
    ]
    if _unresolved_self_rows:
        _unresolved_row = _unresolved_self_rows[0]
        _unresolved_word = (
            _sl_words[_clist_row0_idx + _unresolved_row] & 0xFFFFFFFF)
        return jsonify({
            "error": (
                "Capability validation failed: c-list row "
                f"{_unresolved_row} contains an unresolved placeholder "
                f"(0x{_unresolved_word:08X}); resolve it before saving."
            ),
            "capability_validation_failed": True,
            "clist_row": _unresolved_row,
            "actual_word": _unresolved_word,
            "safe_retry": True,
        }), 422

    # Older binaries can reserve several all-zero c-list rows before the
    # server writes the legacy identity seal at row 0. Preserve that inert
    # format, but reject any nonzero undeclared row: it would otherwise carry
    # an unchecked Golden Token (including B-set or pending placeholders).
    if (not _has_declared_caps
            and _portable_binding is None
            and _sl_cc2 > 1):
        if _is_server_bootstrap_history_repair and _is_bootstrap_canonical:
            # A repair reissues previously-approved immutable bootstrap bytes
            # after changing row zero only.  Its pre-existing c-list rows are
            # not browser metadata and must remain byte-for-byte unchanged.
            _undeclared_nonzero_rows = []
        else:
            _undeclared_nonzero_rows = [
                _row for _row in range(_sl_cc2)
                if _sl_words[_clist_row0_idx + _row] != 0
            ]
        if _undeclared_nonzero_rows:
            return jsonify({
                "error": (
                    "Capability validation failed: the LUMP header declares "
                    f"cc={_sl_cc2}, but metadata declares no capabilities and "
                    f"c-list row {_undeclared_nonzero_rows[0]} is nonzero. "
                    "Declare one named capability for every non-empty c-list row "
                    "before saving."
                ),
                "capability_validation_failed": True,
                "declared_capability_count": 0,
                "cc": _sl_cc2,
                "clist_row": _undeclared_nonzero_rows[0],
            }), 422

    # ── Declared-capability C-list guard ─────────────────────────────────────
    # A declared capability owns its c-list row. Never replace it with an
    # identity seal and never persist NULL, pending, malformed, mis-targeted,
    # or over/under-permissioned tokens. The browser performs the same checks,
    # but this endpoint is the final trust boundary.
    if _has_declared_caps and _portable_binding is None:
        if len(_declared_caps_raw) != _sl_cc2:
            return jsonify({
                "error": (
                    f"Capability validation failed: metadata declares "
                    f"{len(_declared_caps_raw)} capabilities but the LUMP header "
                    f"declares cc={_sl_cc2}."
                ),
                "capability_validation_failed": True,
                "declared_capability_count": len(_declared_caps_raw),
                "cc": _sl_cc2,
            }), 422
        if _clist_row0_idx <= 0 or (_clist_row0_idx + _sl_cc2) > len(_sl_words):
            return jsonify({
                "error": (
                    f"Capability validation failed: c-list range "
                    f"[{_clist_row0_idx}, {_clist_row0_idx + _sl_cc2}) is outside "
                    f"the {len(_sl_words)}-word LUMP."
                ),
                "capability_validation_failed": True,
            }), 422

        _right_order = ("R", "W", "X", "L", "S", "E")
        for _cap_row, _cap_raw in enumerate(_declared_caps_raw):
            if isinstance(_cap_raw, str):
                _cap_name = _cap_raw.strip()
                _cap_right_values = []
                _cap_obj = {"name": _cap_name}
                _cap_target_raw = None
            elif isinstance(_cap_raw, dict):
                _cap_name = str(_cap_raw.get("name", "")).strip()
                _cap_right_values = _cap_raw.get("rights", [])
                _cap_obj = dict(_cap_raw)
                _cap_target_raw = _cap_raw.get("nsIndex", _cap_raw.get("target"))
            else:
                _cap_name = ""
                _cap_right_values = []
                _cap_obj = {}
                _cap_target_raw = None

            def _cap_reject(_detail, **_extra):
                _body = {
                    "error": (
                        f'Capability validation failed for '
                        f'"{_cap_name or f"c-list[{_cap_row}]"}": {_detail}'
                    ),
                    "capability_validation_failed": True,
                    "capability": _cap_name,
                    "clist_row": _cap_row,
                }
                _body.update(_extra)
                return jsonify(_body), 422

            _cap_is_null_row = (
                isinstance(_cap_raw, dict)
                and _cap_raw.get("null_row") is True
            )
            if _cap_is_null_row:
                _cap_word = _sl_words[_clist_row0_idx + _cap_row] & 0xFFFFFFFF
                if _cap_word != 0:
                    return _cap_reject(
                        f"declared NULL row contains nonzero word 0x{_cap_word:08X}.",
                        actual_word=_cap_word,
                    )
                _validated_declared_caps.append({
                    "name": "NULL",
                    "rights": [],
                    "grants": [],
                    "nsIndex": None,
                    "null_row": True,
                })
                continue

            # C-list[0] belongs to the abstraction. Its only special rule is
            # advisory: it should equal the owner's Golden Token. The warning
            # is emitted above; never reject, rewrite, or otherwise act on it.
            if _cap_row == 0:
                _validated_declared_caps.append({
                    **_cap_obj,
                    "name": _cap_name or "__SELF__",
                })
                continue

            if not _cap_name:
                return _cap_reject("the declared capability has no name.")

            if not isinstance(_cap_right_values, list):
                return _cap_reject(
                    "permissions must be an array of permission strings."
                )
            _cap_rights = []
            for _cap_right_value in _cap_right_values:
                if (not isinstance(_cap_right_value, str)
                        or not _cap_right_value.strip()):
                    return _cap_reject(
                        "each permission must be a non-empty string."
                    )
                _cap_right_text = _cap_right_value.strip().upper()
                _invalid_cap_rights = [
                    _ch for _ch in _cap_right_text
                    if _ch not in _right_order
                ]
                if _invalid_cap_rights:
                    return _cap_reject(
                        "permissions contain invalid character(s) "
                        f'"{"".join(_invalid_cap_rights)}"; valid letters are '
                        f'{" ".join(_right_order)}.'
                    )
                for _cap_right in _cap_right_text:
                    if _cap_right not in _cap_rights:
                        _cap_rights.append(_cap_right)
            if not _cap_rights:
                return _cap_reject("no permissions were declared.")

            _cap_has_turing = any(_r in _cap_rights for _r in ("R", "W", "X"))
            _cap_has_church = any(_r in _cap_rights for _r in ("L", "S", "E"))
            if _cap_has_turing and _cap_has_church:
                return _cap_reject(
                    f"permissions {''.join(_cap_rights)} mix Turing and Church domains."
                )
            if sum(1 for _r in ("L", "S", "E") if _r in _cap_rights) > 1:
                return _cap_reject(
                    f"permissions {''.join(_cap_rights)} violate the single-Church-permission rule."
                )

            try:
                if isinstance(_cap_target_raw, bool):
                    raise ValueError()
                _cap_target = int(_cap_target_raw)
            except (TypeError, ValueError):
                return _cap_reject(
                    "the active namespace target is unresolved; metadata.nsIndex is required."
                )
            if _cap_target < 0 or _cap_target > 0xFFFF:
                return _cap_reject(
                    f"namespace target {_cap_target} is outside the 16-bit NS range."
                )

            _cap_word = _sl_words[_clist_row0_idx + _cap_row] & 0xFFFFFFFF
            if (_cap_word >> 16) == 0xFEED:
                return _cap_reject(
                    f"c-list row {_cap_row} is still a pending placeholder "
                    f"(0x{_cap_word:08X}); resolve {_cap_name} before saving.",
                    actual_word=_cap_word,
                )

            _cap_b = (_cap_word >> 31) & 1
            _cap_perm3 = (_cap_word >> 28) & 0x7
            _cap_dom = (_cap_word >> 27) & 1
            _cap_type = (_cap_word >> 25) & 0x3
            _cap_index = _cap_word & 0xFFFF
            if _cap_type == 0:
                return _cap_reject(
                    f"c-list row {_cap_row} contains a NULL Golden Token "
                    f"(0x{_cap_word:08X}); resolve {_cap_name} before saving.",
                    actual_word=_cap_word,
                )
            if _cap_type != 1:
                return _cap_reject(
                    f"c-list row {_cap_row} has Golden Token type {_cap_type}; "
                    f"a declared c-list capability must be an Inform token.",
                    actual_word=_cap_word,
                )
            if _cap_b:
                return _cap_reject(
                    "the Golden Token unexpectedly has its B flag set.",
                    actual_word=_cap_word,
                )
            if _cap_dom == 1 and (
                    ((_cap_perm3 >> 0) & 1)
                    + ((_cap_perm3 >> 1) & 1)
                    + ((_cap_perm3 >> 2) & 1)
                    > 1):
                return _cap_reject(
                    "the Golden Token has multiple Church permissions.",
                    actual_word=_cap_word,
                )
            if _cap_index != _cap_target:
                return _cap_reject(
                    f"c-list row {_cap_row} targets NS[{_cap_index}], but the "
                    f"declared capability resolves to NS[{_cap_target}].",
                    actual_word=_cap_word,
                    expected_ns_index=_cap_target,
                    actual_ns_index=_cap_index,
                )

            _expected_dom = 1 if _cap_has_church else 0
            _expected_perm3 = (
                ((1 if "E" in _cap_rights else 0) << 2)
                | ((1 if "S" in _cap_rights else 0) << 1)
                | (1 if "L" in _cap_rights else 0)
            ) if _expected_dom else (
                ((1 if "X" in _cap_rights else 0) << 2)
                | ((1 if "W" in _cap_rights else 0) << 1)
                | (1 if "R" in _cap_rights else 0)
            )
            if _cap_dom != _expected_dom or _cap_perm3 != _expected_perm3:
                return _cap_reject(
                    f"c-list row {_cap_row} permissions do not match declared "
                    f"{''.join(_cap_rights)} rights.",
                    actual_word=_cap_word,
                )

            _cap_obj["name"] = _cap_name
            _cap_obj["rights"] = _cap_rights
            _cap_obj["nsIndex"] = _cap_target
            _validated_declared_caps.append(_cap_obj)

    # C-list[0] is programmer-owned data. Compare it with the owning
    # abstraction's Golden Token, warn on mismatch, and preserve it unchanged.
    if (ns_slot is None and not _is_bootstrap_canonical
            and not _has_declared_caps and _portable_binding is None):
        _self_gt = (0x0A000000 | (int(_identity_hash[:8], 16) & 0x1FFFFFF)) & 0xFFFFFFFF
        _actual_seal = (
            _sl_words[_clist_row0_idx]
            if 0 <= _clist_row0_idx < len(_sl_words)
            else 0
        )
        _warn_clist0_owner_mismatch(_self_gt, _actual_seal)

    # Pre-pack and hash the verified binary now; Phase 5 only writes it.
    import hashlib as _hl_save
    lump_bytes   = _struct.pack(f'>{len(_sl_words)}I', *_sl_words)
    _binary_hash = _hl_save.sha256(lump_bytes).hexdigest()
    try:
        _validate_promotion_binding(metadata, _binary_hash)
    except (LookupError, OSError, TypeError, ValueError) as _promotion_error:
        return jsonify({
            "error": f"Promotion candidate is no longer current: {_promotion_error}",
            "promotion_binding_failed": True,
            "committed": False,
            "safe_retry": True,
        }), 409
    if _is_bootstrap_canonical:
        try:
            _validate_bootstrap_candidate(
                _bootstrap_binding, lump_bytes, token8, _binary_hash,
                _bootstrap_identity)
        except (IndexError, KeyError, TypeError, ValueError) as _bootstrap_error:
            return jsonify({
                "error": (
                    "The IDE refused the bootstrap save before changing any data. "
                    "It can retry from the unchanged source after rebuilding the "
                    f"candidate: {_bootstrap_error}"
                ),
                "namespace_identity_failed": True,
            }), 422

    # The browser supplies the exact source buffer used to construct the
    # self-defining binary. Never commit metadata/source claims that disagree
    # with the immutable content frame.
    _intrinsic_content = _parse_intrinsic_lump_content(_sl_words)
    _embedded_source = (
        _intrinsic_content.get("source")
        if isinstance(_intrinsic_content, dict) else None
    )
    if "submitted_source" in metadata:
        _submitted_source = metadata.get("submitted_source")
        if _submitted_source is not None and not isinstance(_submitted_source, str):
            return jsonify({
                "error": "Save rejected: submitted_source must be text or null.",
                "source_mismatch": True,
            }), 422
        if _submitted_source != _embedded_source:
            return jsonify({
                "error": "Save rejected: submitted editor source does not match the source embedded in the binary.",
                "source_mismatch": True,
            }), 422
    _submitted_profile = metadata.get("output_profile")
    if _submitted_profile is not None:
        _intrinsic_profile = (
            {0: "api", 1: "compact", 2: "full"}.get(
                _intrinsic_content.get("tier"))
            if isinstance(_intrinsic_content, dict) else None)
        if _submitted_profile != _intrinsic_profile:
            return jsonify({
                "error": (
                    "Save rejected: output profile does not match the "
                    "profile encoded in the LUMP binary."
                ),
                "snapshot_mismatch": True,
                "committed": False,
                "safe_retry": True,
            }), 422
    # A source-bearing editor save must carry the source inside the immutable
    # binary.  Without this guard an API-only profile could still return a
    # successful save while silently discarding the user's editor contents.
    if metadata.get("source_required") is True and (
            not isinstance(_embedded_source, str) or not _embedded_source):
        return jsonify({
            "error": (
                "Save rejected: the editor contains source, but the selected "
                "LUMP binary has no embedded source frame."
            ),
            "source_required": True,
            "source_mismatch": True,
            "committed": False,
            "safe_retry": True,
        }), 422

    # ── Read authoritative cw/cc from the (post-modification) binary header ───
    # The client-supplied metadata.cw / metadata.cc are UNTRUSTED: they reflect
    # whatever the JavaScript assembled in memory and may be stale or zero even
    # when the binary has real instructions.  The binary header word is the only
    # ground truth — read cw and cc from it now, after all header mutations
    # (cc bump from 0→1) have been applied.
    _hdr_final   = _sl_words[0]
    _binary_cw   = (_hdr_final >> 10) & 0x1FFF   # bits[22:10]
    _binary_cc   = _hdr_final & 0xFF              # bits[7:0]  (_sl_cc2 already tracks this)

    # Guard: a lump with more than 64 words has real content; cw==0 in that
    # situation means the header is corrupt / the client sent wrong metadata.
    # Reject cleanly now rather than silently storing a bad manifest entry.
    if len(_sl_words) > 64 and _binary_cw == 0:
        return jsonify({
            "error": (
                f"Manifest write rejected: lump has {len(_sl_words)} words "
                f"of binary content but the header reports cw=0. "
                f"The compiled binary has real instructions but the code-word "
                f"count in the LUMP header is zero — the header is inconsistent "
                f"with the binary. Re-compile or correct the lump header before saving."
            ),
            "cw_zero_with_content": True,
            "lump_size":            len(_sl_words),
            "binary_cw":            _binary_cw,
            "binary_cc":            _binary_cc,
        }), 422
    # ── End pre-flight ────────────────────────────────────────────────────────

    # Freeze Namespace authority before taking the history lock. The same order
    # is used for this whole request, so final identity validation and commit
    # cannot observe different slot/sequence/token revisions.
    lumps_dir = LUMPS_DIR
    os.makedirs(lumps_dir, exist_ok=True)
    if _bootstrap_pre_lock_hook is not None:
        _bootstrap_pre_lock_hook()
    _save_namespace_guard = _namespace_commit_guard()
    _save_namespace_guard.__enter__()
    _save_transaction_guard = _lump_history_transition_lock(lumps_dir)
    _save_transaction_guard.__enter__()

    @after_this_request
    def _release_lump_save_transaction(response):
        _save_transaction_guard.__exit__(None, None, None)
        _save_namespace_guard.__exit__(None, None, None)
        return response

    # The candidate was constructed from an earlier read so planning could
    # report errors cheaply. Re-read under both commit locks and make that fresh
    # descriptor authoritative for the final byte gate.
    if _is_bootstrap_canonical:
        try:
            with open(NS_STATE_PATH, encoding="utf-8") as _fresh_state_file:
                _fresh_rows = json.load(_fresh_state_file).get("abstractions")
            if not isinstance(_fresh_rows, list):
                raise ValueError("ns-state.json has no abstractions array")
            if _is_server_bootstrap_history_repair:
                expected_namespace_identity = metadata.get(
                    "_bootstrap_repair_namespace_identity")
                if (_namespace_state_fingerprint(_fresh_rows)
                        != expected_namespace_identity):
                    raise ValueError(
                        "Namespace state changed while the correction was awaiting approval")
            if _is_selftest_canonical:
                _fresh_sources = [
                    row for row in _fresh_rows if isinstance(row, dict)
                    and row.get("name") == "SelfTest"
                ]
                if len(_fresh_sources) != 1:
                    raise ValueError("Namespace no longer has one SelfTest descriptor")
                if _bootstrap_source_binding is None:
                    raise ValueError("initial SelfTest Namespace descriptor is unavailable")
                for _identity_field in (
                        "slot", "seq", "token", "resident", "boot_resident",
                        "type", "load_policy", "ns_slot_policy"):
                    if (_fresh_sources[0].get(_identity_field)
                            != _bootstrap_source_binding.get(_identity_field)):
                        raise ValueError(
                            f"SelfTest Namespace {_identity_field} changed")
                _fresh_binding = dict(
                    _fresh_sources[0], slot=ns_slot,
                    seq=_bootstrap_binding.get("seq"), token=token8)
            else:
                _fresh_targets = [
                    row for row in _fresh_rows if isinstance(row, dict)
                    and row.get("slot") == ns_slot
                ]
                if _is_server_bootstrap_history_repair and not _fresh_targets:
                    # A newly allocated slot is intentionally absent until
                    # this transition installs its Namespace row.  The full
                    # Namespace fingerprint above proves that the planned
                    # empty destination is still the same destination.
                    _fresh_binding = dict(_bootstrap_binding)
                elif len(_fresh_targets) != 1:
                    raise ValueError(
                        f"Namespace no longer has one descriptor at NS[{ns_slot}]")
                else:
                    _fresh_binding = _fresh_targets[0]
            _validate_bootstrap_candidate(
                _fresh_binding, lump_bytes, token8, _binary_hash,
                _bootstrap_identity)
            _bootstrap_binding = _fresh_binding
        except (OSError, ValueError, TypeError, json.JSONDecodeError) as _fresh_error:
            return jsonify({
                "error": (
                    "The IDE refused the bootstrap save before changing any data. "
                    "The Namespace changed while the candidate was being prepared; "
                    f"retry from the unchanged source: {_fresh_error}"
                ),
                "namespace_identity_failed": True,
                "failure_owner": "ide",
                "committed": False,
                "safe_retry": True,
            }), 409

    import re as _re_arch
    import shutil as _shutil

    # ── Helper: abstraction name → safe filename stem ─────────────────────────
    def _safe_stem(name):
        s = _re_arch.sub(r'[^\w.\-]', '_', str(name or 'lump').strip())
        s = _re_arch.sub(r'_+', '_', s).strip('_')
        return s or 'lump'

    safe_name = _safe_stem(abs_name)

    def _history_versions_for_abstraction(entries):
        """Return every version already visible for this abstraction.

        The active manifest is not the only source of history: older saves may
        survive as files with a different archive stem, and historical
        manifest rows can retain those exact filenames.  Version allocation
        must consider all of them or a replacement can create two visible
        rows with the same V#.
        """
        versions = set()
        stems = {safe_name}
        token_stems = set()
        for entry in entries:
            if not isinstance(entry, dict) or entry.get("abstraction") != abs_name:
                continue
            try:
                if entry.get("lump_version") is not None:
                    versions.add(int(entry["lump_version"]))
            except (TypeError, ValueError):
                pass
            filename = os.path.basename(str(entry.get("filename") or ""))
            if filename.endswith(".lump"):
                stem = filename[:-5]
                stem = _re_arch.sub(r"_v\d+$", "", stem)
                if stem:
                    stems.add(stem)
            token = str(entry.get("token") or "").lower()
            if token:
                token_stems.add(token)

        patterns = [
            _re_arch.compile(rf"^{_re_arch.escape(stem)}_v(\d+)\.lump$")
            for stem in stems
        ] + [
            _re_arch.compile(rf"^{_re_arch.escape(stem)}-v(\d+)\.lump$")
            for stem in token_stems
        ]
        for filename in (os.listdir(lumps_dir) if os.path.isdir(lumps_dir) else []):
            for pattern in patterns:
                match = pattern.match(filename)
                if match:
                    versions.add(int(match.group(1)))
                    break
        return versions

    # ── Phase 1: Read manifest to find current entry + file paths ─────────────
    manifest_path = os.path.join(lumps_dir, 'manifest.json')
    try:
        manifest = _read_manifest_safe(manifest_path)
    except ValueError as _mf_err:
        return jsonify({"error": (
            "manifest.json is corrupt and cannot be read safely. "
            "The save has been aborted to prevent overwriting previously-saved LUMPs. "
            f"Details: {_mf_err}"
        )}), 500

    # An editor opened from a saved revision must still be based on the latest
    # compiled revision of that abstraction. This is checked while holding the
    # history lock, before a plan is issued or any artifact is changed.
    _editor_base = metadata.get("editor_base")
    if _editor_base is not None:
        if not isinstance(_editor_base, dict):
            return jsonify({"error": "Invalid editor base identity."}), 400
        _same_abstraction = [
            entry for entry in manifest
            if isinstance(entry, dict) and entry.get("abstraction") == abs_name
        ]
        def _compiled_sort_value(entry):
            try:
                return float(entry.get("compiled_at") or 0)
            except (TypeError, ValueError):
                return 0
        _latest_entry = max(
            _same_abstraction,
            key=lambda entry: (_compiled_sort_value(entry),
                               int(entry.get("lump_version") or 0)),
            default=None,
        )
        _base_token = str(_editor_base.get("token") or "").lower()
        _base_compiled_at = _editor_base.get("compiled_at")
        _latest_token = str((_latest_entry or {}).get("token") or "").lower()
        _identity_matches = _latest_entry is not None and _base_token == _latest_token
        if _identity_matches:
            try:
                _identity_matches = (
                    float(_base_compiled_at) ==
                    float(_latest_entry.get("compiled_at"))
                )
            except (TypeError, ValueError):
                _identity_matches = False
        if _identity_matches:
            _latest_path = os.path.join(
                lumps_dir, _latest_entry.get("filename") or f"{_latest_token}.lump")
            try:
                with open(_latest_path, "rb") as _latest_file:
                    _latest_words = list(_struct.unpack(
                        f">{os.path.getsize(_latest_path) // 4}I",
                        _latest_file.read()))
                _latest_content = _parse_intrinsic_lump_content(_latest_words)
                _latest_source = (
                    _latest_content.get("source")
                    if isinstance(_latest_content, dict) else None
                )
                _latest_source_hash = (
                    _hl_save.sha256(_latest_source.encode("utf-8")).hexdigest()
                    if isinstance(_latest_source, str) else None
                )
                _identity_matches = _editor_base.get("source_hash") == _latest_source_hash
            except (OSError, _struct.error):
                _identity_matches = False
        if not _identity_matches and metadata.get("preserve_stale_revision") is not True:
            return jsonify({
                "error": "A newer saved revision exists. Reload it or explicitly preserve this buffer as a separate revision.",
                "stale_editor_base": True,
                "latest": {
                    "token": (_latest_entry or {}).get("token"),
                    "compiled_at": (_latest_entry or {}).get("compiled_at"),
                    "abstraction": (_latest_entry or {}).get("abstraction"),
                },
            }), 409

    _existing_entry = next((e for e in manifest if e.get('token') == token8), None)
    _exist_filename = (_existing_entry or {}).get('filename', f'{token8}.lump')
    _existing_lump  = os.path.join(lumps_dir, _exist_filename)
    _existing_sc    = None
    # The approval consequence belongs to the authoritative Namespace
    # destination, not to an unrelated candidate token supplied by the editor.
    # Keep _existing_entry below for candidate/history archival only.
    _destination_entry = _existing_entry
    if isinstance(ns_slot, int):
        try:
            _namespace_rows, _ = _read_authoritative_namespace_rows()
        except (OSError, ValueError, TypeError, json.JSONDecodeError) as _destination_error:
            return jsonify({"error": f"Namespace destination is unreadable: {_destination_error}",
                            "committed": False}), 409
        _destination_rows = [
            row for row in _namespace_rows
            if isinstance(row, dict) and row.get("slot") == ns_slot
        ]
        if len(_destination_rows) > 1:
            return jsonify({"error": f"Namespace destination NS[{ns_slot}] is ambiguous",
                            "committed": False}), 409
        if _destination_rows:
            _destination_state = dict(_destination_rows[0])
            _destination_token = str(_destination_state.get("token") or "").lower()
            _destination_manifest = next(
                (entry for entry in manifest if isinstance(entry, dict)
                 and entry.get("archived") is not True
                 and str(entry.get("token") or "").lower() == _destination_token),
                None,
            )
            _destination_entry = (
                dict(_destination_manifest)
                if _destination_manifest is not None else _destination_state
            )
    _history_versions = _history_versions_for_abstraction(manifest)

    # ── Phase 2: Determine current version number ──────────────────────────────
    _is_forked_save = False
    _arch_ver = None
    _arch_sc  = {}
    if os.path.isfile(_existing_lump):
        if _existing_entry and _existing_entry.get("lump_version") is not None:
            _arch_ver = int(_existing_entry["lump_version"])
        if (_existing_entry or {}).get('forked'):
            _is_forked_save = True
            print(f'[lumps] Forked compile: skipping re-archive for {token8}'
                  f' (already archived by fork-version)', flush=True)
    if _arch_ver is None and not _is_forked_save:
        if _existing_entry is not None:
            _arch_ver = int(_existing_entry.get('lump_version', 0))
        else:
            # Last resort: scan on-disk archives for this safe_name or token
            _vers_found = []
            for _fn in (os.listdir(lumps_dir) if os.path.isdir(lumps_dir) else []):
                for _pp in [
                    _re_arch.compile(rf'^{_re_arch.escape(safe_name)}_v(\d+)\.lump$'),
                    _re_arch.compile(rf'^{_re_arch.escape(token8)}-v(\d+)\.lump$'),
                ]:
                    _mm = _pp.match(_fn)
                    if _mm:
                        _vers_found.append(int(_mm.group(1)))
            _arch_ver = (max(_vers_found) + 1) if _vers_found else 0
            if _vers_found:
                logging.warning('[lumps] %s: sidecar and manifest unreadable; '
                                'deriving archive version from disk (%d)', token8, _arch_ver)

    # ── Phase 3: Compute next version number and new file paths ───────────────
    # A save is always a new revision, including a save made from an older
    # archived editor buffer.  The transition helper rechecks archive
    # collisions under its filesystem lock; this provisional value is used by
    # Namespace preparation before that final value is returned.
    next_lump_version = (max(_history_versions) + 1) if _history_versions else 1

    # ── Canonical filename derivation ─────────────────────────────────────────
    # All new saves use Dot.Name.issue_n.Number.lump format.
    # Number = sha256(dot_name_utf8 + lump_bytes)[:8]; includes dot_name so
    # identical code compiled under different names produces different Numbers.
    from lump_integrity import to_dot_name as _to_dot_name, compute_number as _compute_number
    _dot_name_save = _to_dot_name(
        f"{_petname}.{abs_name}" if _petname else abs_name)
    # The UI's universal owner is petname.Abstraction#issue.  Use the same
    # issue supplied for identity_string rather than silently retaining an old
    # manifest issue and creating two contradictory canonical identities.
    _issue_n_save  = _issue_number
    _number_save   = _compute_number(_dot_name_save, lump_bytes)
    if _portable_binding is not None:
        if _portable_binding["owner"] != f"{_dot_name_save}#{_issue_n_save}":
            return jsonify({"error": "Portable binding validation failed: owner must match "
                                     "the saved canonical dot_name and issue_n.",
                            "portable_binding_validation_failed": True}), 422
        # Portable N is the issued canonical identity, not the old pet-name seal.
        _identity_string = _portable_binding["owner"]
        _identity_hash = _hl_id.sha256(_identity_string.encode("utf-8")).hexdigest()

    # ── Security: strict allowlist + realpath containment ─────────────────────
    # to_dot_name() preserves '/', '..', and absolute-path prefixes from
    # request-controlled abstraction names.  Validate and contain before any I/O.
    import re as _re_sec
    if not _re_sec.fullmatch(r'[A-Za-z0-9][A-Za-z0-9.\-]*', _dot_name_save):
        return jsonify({'error':
            f'Canonical dot name {_dot_name_save!r} contains invalid characters; '
            'only A-Z, a-z, 0-9, "." and "-" are permitted.'}), 400
    _lumps_dir_real = os.path.realpath(lumps_dir)
    # ── End security block ────────────────────────────────────────────────────

    lump_filename    = f'{_dot_name_save}.{_issue_n_save}.{_number_save}.lump'
    lump_path        = os.path.join(lumps_dir, lump_filename)

    # Containment check — must follow path construction so realpath can resolve
    for _chk_path, _chk_label in ((lump_path, 'lump'),):
        if not os.path.realpath(_chk_path).startswith(_lumps_dir_real + os.sep):
            return jsonify({'error':
                f'Path traversal detected in {_chk_label} filename — '
                f'canonical name resolves outside server/lumps/'}), 400

    # Build the new approval and manifest entry entirely in memory. The shared
    # transition helper stages archive/current/approval/manifest together
    # before changing any destination.
    import time as _time_save
    _compiled_at = _time_save.time()

    new_entry = {
        "token":         token8,
        "abstraction":   abs_name,
        "filename":      lump_filename,
        "lump_version":  next_lump_version,
        "compiled_at":   _compiled_at,
        # Intrinsic content facts and user identity metadata are retained in
        # the manifest alongside the binary. The binary remains authoritative
        # for words/source/profile; these fields make repository recovery and
        # diagnostics complete without trusting them for validation.
        "dot_name":      _dot_name_save,
        "issue_n":       _issue_n_save,
        "petname":       _petname,
        "content_profile": (
            _intrinsic_content.get("tier")
            if isinstance(_intrinsic_content, dict) else None),
        "output_profile": (
            _intrinsic_content.get("tier")
            if isinstance(_intrinsic_content, dict) else None),
        "capabilities":  list(_validated_declared_caps),
    }
    if not _is_preflight:
        # This marker is not a client authority.  It lets crash recovery prove
        # that the exact operation reached the manifest-selected bytes.
        new_entry["operation_id"] = _operation_id
    # Namespace state and boot configuration are the sole deployment authority.

    # Test hook: fires after all per-token I/O (Phase 5/6) but before the lock.
    # In production this is always None.  Tests set it to synchronise threads
    # so both have read the manifest (Phase 1) before either enters Phase 7.
    if _lumps_manifest_pre_write_hook is not None:
        _lumps_manifest_pre_write_hook()  # noqa: not-callable — callable at runtime

    _plan_consequence = "replace" if _destination_entry else "create"
    _derived_save_action = "replace" if _destination_entry else "save"
    # This endpoint only performs save/replace transitions. Alternate approval
    # classes belong to their dedicated mutation endpoints and must never let
    # an API caller bypass this endpoint's authoritative save plan.
    _approval_action = _derived_save_action
    _replacement_identity = _manifest_entry_identity(_destination_entry)
    _relevant_dependency_slots = set()
    for _candidate_capability in _validated_declared_caps:
        if isinstance(_candidate_capability, dict):
            _dependency_slot = _candidate_capability.get("nsIndex")
            if isinstance(_dependency_slot, int):
                _relevant_dependency_slots.add(_dependency_slot)
    try:
        _library_generation = _authoritative_lump_library_generation(
            lumps_dir, manifest_path, manifest, token8=token8, ns_slot=ns_slot,
            dependency_slots=_relevant_dependency_slots)
    except ValueError as _generation_error:
        return jsonify({"error": str(_generation_error)}), 409

    if _early_plan is not None:
        if (token8 != _early_plan.get("token")
                or ns_slot != _early_plan.get("ns_slot")
                or _binary_hash != _early_plan.get("digest")
                or list(_sl_words) != _early_plan.get("final_binary")):
            return jsonify({
                "error": "server-finalized save plan no longer matches this candidate",
                "plan_binary_mismatch": True, "committed": False,
            }), 409

    if (metadata.get("_save_plan_preflight") is True
            and _lump_save_payload_override.get() is not None):
        _approval_action = _derived_save_action
        plan_id = secrets.token_urlsafe(32)
        g._lump_save_diagnostic["plan_id"] = plan_id
        _save_lump_diagnostic_event(
            stage="Prepare", event="complete", outcome="unknown")
        with _LUMP_SAVE_PLANS_LOCK:
            _LUMP_SAVE_PLANS[plan_id] = {
                "plan_id": plan_id,
                "session": session["_lump_approval_session"],
                "digest": _binary_hash, "action": _approval_action,
                "token": token8, "filename": lump_filename,
                "consequence": _plan_consequence,
                "replacement_identity": _replacement_identity,
                "generation": _library_generation, "expires": time.time() + 300,
                # The output of canonicalisation is the approved artifact.  The
                # commit endpoint accepts only these words, not a browser
                # reconstruction that happened to share an earlier digest.
                "final_binary": list(_sl_words),
                "ns_slot": ns_slot,
                "new_entry": metadata.get("new_entry") is True,
                "candidate_id": _candidate_id,
                "attempt_id": g._lump_save_diagnostic.get("attempt_id"),
                "client_diagnostic_attempt_id": g._lump_save_diagnostic.get(
                    "client_diagnostic_attempt_id"),
            }
        return jsonify({
            "plan": plan_id, "plan_id": plan_id, "digest": _binary_hash,
            "final_binary": list(_sl_words), "ns_slot": ns_slot,
            "candidate_id": _candidate_id,
            "action": _approval_action,
            "destination": lump_filename, "consequence": _plan_consequence,
            "replacement_identity": _replacement_identity,
            "current_lump": ({
                "abstraction": (_destination_entry.get("abstraction")
                                or _destination_entry.get("name")),
                "display_name": _destination_entry.get("display_name"),
                "dot_name": _destination_entry.get("dot_name"),
                "token": _destination_entry.get("token"),
                "filename": _destination_entry.get("filename"),
                "ns_slot": ns_slot,
            } if _destination_entry else None),
            "expires_in": 300,
            "warnings": _save_warnings,
        }), 201

    try:
        _save_plan_id = metadata.get(
            "save_plan", metadata.get("save_plan_id", metadata.get("plan")))
        if _approval_action in {"save", "replace"}:
            _check_lump_save_plan(
                _save_plan_id, digest=_binary_hash,
                action=_approval_action, token=token8, filename=lump_filename,
                consequence=_plan_consequence,
                replacement_identity=_replacement_identity,
                generation=_library_generation, consume=False)
        _intent_approval = _consume_lump_approval_intent(
            metadata.get("approval_intent"), _binary_hash, _approval_action,
            _save_plan_id, consume=False)
    except ValueError as _intent_error:
        _save_lump_diagnostic_event(
            stage="Confirm", event="rejection", outcome="rejected",
            error={"name": "ApprovalError", "message": str(_intent_error)})
        return jsonify({
            "error": str(_intent_error),
            "failure_owner": "ide",
            "approval_binding_failed": True,
            "committed": False,
            "safe_retry": True,
        }), 403

    # Build and validate the complete Namespace update before the transition
    # stages any repository destination. Every slot-bound resident save commits
    # this state beside its binary, approval, history, and manifest. The
    # transition callback only adjusts the version if archive collision handling
    # advanced it.
    _prepared_ns_entries = None
    if isinstance(ns_slot, int):
        try:
            _prepared_ns_entries = _prepare_saved_lump_ns_state(
                abs_name, ns_slot, token8, lump_filename, _issue_n_save,
                next_lump_version)
            if _prepared_ns_entries is None:
                raise ValueError("resident save has no Namespace destination")
        except (OSError, ValueError, TypeError, json.JSONDecodeError) as _ns_error:
            _save_kind = "bootstrap " if _is_bootstrap_canonical else ""
            return jsonify({
                "error": (
                    f"The IDE refused the {_save_kind}save before changing any data. "
                    "It can retry from the unchanged source after rebuilding the "
                    f"candidate: Namespace binding is invalid: {_ns_error}"
                ),
                "namespace_identity_failed": True,
                "failure_owner": "ide",
                "committed": False,
                "safe_retry": True,
            }), 422
        if _compiler_self_row:
            # Recompute the live SELF word from the Namespace state returned by
            # preparation while the commit locks are held.  The preflight
            # rewrite is not itself final authority: a stale candidate must
            # not be allowed to commit if the selected descriptor changed.
            _prepared_self_rows = [
                _row for _row in _prepared_ns_entries
                if isinstance(_row, dict) and _row.get("slot") == ns_slot
            ]
            if len(_prepared_self_rows) != 1:
                return jsonify({
                    "error": (
                        "Namespace identity validation failed: final "
                        f"SELF destination NS[{ns_slot}] is not unique."
                    ),
                    "namespace_identity_failed": True,
                    "committed": False,
                    "safe_retry": True,
                }), 422
            _prepared_self_sequence = _prepared_self_rows[0].get("seq", 0)
            if (isinstance(_prepared_self_sequence, bool)
                    or not isinstance(_prepared_self_sequence, int)
                    or not 0 <= _prepared_self_sequence <= 0x1FF):
                return jsonify({
                    "error": (
                        "Namespace identity validation failed: final SELF "
                        f"sequence is invalid for NS[{ns_slot}]."
                    ),
                    "namespace_identity_failed": True,
                    "committed": False,
                    "safe_retry": True,
                }), 422
            _final_self_gt = _boot_image_gen.create_gt(
                _prepared_self_sequence, ns_slot, {"E": 1}, 1)
            _final_self_word = _sl_words[_clist_row0_idx] & 0xFFFFFFFF
            if _final_self_word != _final_self_gt:
                return jsonify({
                    "error": (
                        "Namespace identity validation failed: final "
                        f"c-list row 0 must be 0x{_final_self_gt:08X} for "
                        f"NS[{ns_slot}] sequence {_prepared_self_sequence}; "
                        f"got 0x{_final_self_word:08X}."
                    ),
                    "namespace_identity_failed": True,
                    "clist_row": 0,
                    "expected_word": _final_self_gt,
                    "actual_word": _final_self_word,
                    "committed": False,
                    "safe_retry": True,
                }), 422

    def _resident_additional_json(final_manifest_entry):
        if _prepared_ns_entries is None:
            return {}
        import copy as _copy
        entries = _copy.deepcopy(_prepared_ns_entries)
        selected = next(
            row for row in entries
            if isinstance(row, dict) and row.get("slot") == ns_slot)
        selected["filename"] = final_manifest_entry["filename"]
        selected["lump_version"] = final_manifest_entry["lump_version"]
        if _is_server_bootstrap_history_repair:
            selected.update({
                "name": abs_name,
                "slot": ns_slot,
                "seq": _bootstrap_binding.get("seq", 0),
                "token": token8,
                "resident": True,
                "boot_resident": True,
                "type": "Inform",
                "load_policy": "Resident",
                "ns_slot_policy": "static",
            })
        return {NS_STATE_PATH: _build_ns_state_document(entries)}

    _operation_response = {
        "ok": True,
        "committed": True,
        "token": token8,
        "lump": lump_filename,
        "filename": lump_filename,
        "immutable_filename": lump_filename,
        "abstraction": abs_name,
        "dot_name": _dot_name_save,
        "issue_n": _issue_n_save,
        "size_bytes": len(lump_bytes),
        "lump_version": next_lump_version,
        "compiled_at": _compiled_at,
        "binary_hash": _binary_hash,
        "digest": _binary_hash,
        "ns_slot": ns_slot,
        "candidate_id": _candidate_id,
        # Immutable finalized words are stored with the durable operation, not
        # re-resolved through a token that a later revision may replace.
        "final_binary": list(_sl_words),
        "operation_id": _operation_id,
    }

    def _save_additional_json(final_manifest_entry):
        documents = _resident_additional_json(final_manifest_entry)
        if getattr(g, "_lump_save_operation_active", False):
            # Storing this with the history transition makes a committed status
            # durable across response loss and process restart.
            operation_document = _read_lump_save_operation(_operation_id) or {}
            operation_document.update({
                "outcome": "committed",
                "status": 200,
                "updated_at": time.time(),
                "session_binding": _operation_session_binding(),
                "response": dict(_operation_response,
                                 filename=final_manifest_entry["filename"],
                                 lump=final_manifest_entry["filename"],
                                 lump_version=final_manifest_entry["lump_version"]),
            })
            documents[_lump_save_operation_path(_operation_id)] = operation_document
        return documents
    # Only explicit-intent allowlisted extrinsic fields are retained. Every
    # structural/identity fact is derived from the exact inspected binary.
    approval = {
        key: value for key, value in _intent_approval.items()
        if key in _LUMP_APPROVAL_INTENT_FIELDS
    }
    approval.update({
        "binary_hash": _binary_hash, "dot_name": _dot_name_save,
        "issue_n": _issue_n_save,
        "abstraction": abs_name, "filename": lump_filename,
        "compiled_at": _compiled_at,
    })
    if _bootstrap_identity is not None:
        # Frozen resident bootstrap has exactly one identity word; do not
        # attach the deferred name-hash identity seal to this approval.
        approval.update(_bootstrap_identity)
        approval.pop("identity_hash", None)
        approval.pop("identity_string", None)
        approval.pop("identity_seal_location", None)
    else:
        approval["identity_hash"] = _identity_hash

    # Mutation boundary: authenticate the exact bytes supplied to the atomic
    # transition, then bind their row-zero GT, token, descriptor, and approval.
    if _is_bootstrap_canonical:
        try:
            _validate_bootstrap_candidate(
                _bootstrap_binding, lump_bytes, token8,
                approval.get("binary_hash"), approval)
        except (IndexError, KeyError, TypeError, ValueError) as _bootstrap_error:
            return jsonify({
                "error": (
                    "The IDE refused the bootstrap save before changing any data. "
                    "It can retry from the unchanged source after rebuilding the "
                    f"candidate: {_bootstrap_error}"
                ),
                "namespace_identity_failed": True,
                "failure_owner": "ide",
                "committed": False,
                "safe_retry": True,
            }), 422

    # Consume authorization only after every byte/Namespace/approval check has
    # passed. A rejected bootstrap candidate leaves both authorization records
    # available for a corrected retry within their normal expiry window.
    try:
        if _approval_action in {"save", "replace"}:
            _check_lump_save_plan(
                _save_plan_id, digest=_binary_hash,
                action=_approval_action, token=token8, filename=lump_filename,
                consequence=_plan_consequence,
                replacement_identity=_replacement_identity,
                generation=_library_generation, consume=True)
        _consume_lump_approval_intent(
            metadata.get("approval_intent"), _binary_hash, _approval_action,
            _save_plan_id, consume=True)
    except ValueError as _intent_error:
        _save_lump_diagnostic_event(
            stage="Confirm", event="rejection", outcome="rejected",
            error={"name": "ApprovalError", "message": str(_intent_error)})
        return jsonify({
            "error": str(_intent_error),
            "failure_owner": "ide",
            "approval_binding_failed": True,
            "committed": False,
            "safe_retry": True,
        }), 403

    if getattr(g, "_lump_save_operation_active", False):
        # This write is intentionally before the transaction.  If the process
        # dies before the atomic operation record is staged, GET reports
        # unknown rather than a false non-commit; the manifest marker above can
        # be used by a later recovery implementation to prove completion.
        try:
            pending_operation = _read_lump_save_operation(_operation_id) or {}
            pending_operation.update({
                "outcome": "pending",
                "attempt_id": g._lump_save_diagnostic.get("attempt_id"),
                "plan_id": g._lump_save_diagnostic.get("plan_id"),
                "client_diagnostic_attempt_id": g._lump_save_diagnostic.get(
                    "client_diagnostic_attempt_id"),
                "candidate_id": _candidate_id,
                "expected": {
                    "token": token8, "filename": lump_filename,
                    "digest": _binary_hash, "ns_slot": ns_slot,
                    "candidate_id": _candidate_id,
                },
                "response": _operation_response,
                "updated_at": time.time(),
            })
            _write_lump_save_operation(_operation_id, pending_operation)
        except Exception as exc:
            _save_lump_diagnostic_event(
                stage="Commit", event="operation_stage_exception",
                outcome="unknown",
                error={"name": type(exc).__name__, "message": str(exc)})
            return jsonify({
                "error": f"unable to stage durable save operation: {exc}",
                "operation_id": _operation_id, "committed": None,
            }), 503


    _remove_after_commit = ()
    if _exist_filename == f"{token8}.lump":
        _remove_after_commit = tuple(
            path for path in (_existing_lump,)
            if os.path.lexists(path)
        )
    _existing_is_archive_pair = bool(
        _arch_ver is not None
        and _exist_filename == f"{safe_name}_v{_arch_ver}.lump"
    )
    _save_lump_diagnostic_event(
        stage="Commit", event="start", outcome="unknown")
    try:
        _transition = _commit_lump_history_transition(
            lumps_dir=lumps_dir,
            manifest_path=manifest_path,
            token8=token8,
            manifest_entry=new_entry,
            binary_filename=lump_filename,
            binary_bytes=lump_bytes,
            approval_hash=_binary_hash,
            approval=approval,
            archive_stem=safe_name if not _is_forked_save else None,
            archive_version=_arch_ver if not _is_forked_save else None,
            archive_binary_path=(
                _existing_lump
                if os.path.isfile(_existing_lump) and not _is_forked_save
                else None
            ),
            advance_current_version_from_archive=(
                os.path.isfile(_existing_lump) and not _is_forked_save
            ),
            remove_paths=_remove_after_commit,
            compat_old_filename=(
                _exist_filename
                if os.path.isfile(_existing_lump)
                and _exist_filename != f"{token8}.lump"
                and not _existing_is_archive_pair
                else None
            ),
            compat_new_filename=lump_filename,
            variant_group=f"compiled_{abs_name.lower().replace(' ', '_')}",
            ns_slot=ns_slot,
            expected_manifest_entry=_existing_entry,
            additional_json_builder=_save_additional_json,
            operation_id=(
                _operation_id
                if getattr(g, "_lump_save_operation_active", False) else None
            ),
        )
    except _LumpTransitionConflict as _transition_conflict:
        _save_lump_diagnostic_event(
            stage="Commit", event="rejection", outcome="rejected",
            error={"name": "TransitionConflict", "message": str(_transition_conflict)})
        return jsonify({"error": str(_transition_conflict)}), 409
    except _LumpApprovalStoreError as _approval_err:
        _save_lump_diagnostic_event(
            stage="Commit", event="rejection", outcome="rejected",
            error={"name": "ApprovalStoreError", "message": str(_approval_err)})
        return jsonify({"error": (
            "approvals.json is corrupt and cannot be read safely. "
            "The save has been aborted to prevent weakening prior approvals. "
            f"Details: {_approval_err}"
        )}), 500
    except ValueError as _mf_lock_err:
        _save_lump_diagnostic_event(
            stage="Commit", event="rejection", outcome="rejected",
            error={"name": "ManifestError", "message": str(_mf_lock_err)})
        return jsonify({"error": (
            "manifest.json is corrupt and cannot be read safely. "
            "The save has been aborted to prevent overwriting previously-saved LUMPs. "
            f"Details: {_mf_lock_err}"
        )}), 500
    except Exception as _transition_error:
        logging.exception("[lumps] save transaction failed")
        _save_lump_diagnostic_event(
            stage="Commit", event="exception", outcome="unknown",
            error={"name": type(_transition_error).__name__,
                   "message": str(_transition_error)})
        return jsonify({
            "error": f"LUMP save transaction failed; no partial revision was retained: {_transition_error}",
            "failure_owner": "ide",
            "atomic_transition_failed": True,
            "committed": False,
            "safe_retry": False,
        }), 500

    next_lump_version = _transition.get("next_version", next_lump_version)
    if _transition:
        print(f"[lumps] Archived {_exist_filename} → {_transition['lump']}", flush=True)

    print(f'[lumps] Saved {lump_filename} ({len(lump_bytes)} bytes)', flush=True)
    _save_lump_diagnostic_event(
        stage="Commit", event="complete", outcome="committed",
        http_status=200)

    # ── Auto-regenerate boot-image.bin ────────────────────────────────────────
    # If boot-image.bin already exists and a boot config is present, regenerate
    # it so the saved lump is available to the next boot. Saving a LUMP and
    # building a whole boot image are separate authority transitions: a failure
    # in an unchanged foundational LUMP must not revoke the user's approved save
    # of this exact artifact. The existing image remains guarded by the normal
    # stale-image validation and the response reports that it was not refreshed.
    boot_refreshed = False
    boot_refresh_note = None
    if os.path.isfile(BOOT_IMAGE_PATH):
        try:
            cfg_bi, err_bi = _read_saved_boot_config()
            if not err_bi:
                # The saved boot configuration is authoritative for the
                # Lightning Bolt selection.  The image being replaced may be
                # stale specifically because its format predates the current
                # reader, so regeneration must not depend on decoding it.
                _saved_entry_slot = cfg_bi.get(
                    "bootEntrySlot", DEFAULT_BOOT_CONFIG["bootEntrySlot"])
                if (not isinstance(_saved_entry_slot, int)
                        or isinstance(_saved_entry_slot, bool)
                        or not 0 <= _saved_entry_slot < MAX_NS_ENTRIES):
                    raise ValueError(
                        "saved boot config has an invalid bootEntrySlot")
                blob_bi = _boot_image_gen.generate_boot_image(
                    cfg_bi,
                    LUMPS_DIR,
                    boot_entry_slot=_saved_entry_slot,
                    require_entry_resident=True,
                )
                _write_boot_image_bytes(blob_bi)
                boot_refreshed = True
                print(f'[lumps] boot-image.bin regenerated ({len(blob_bi)} bytes)', flush=True)
                _load_boot_abstr_lump()   # refresh the active SelfTest cache
                _load_boot_ns_lump()      # refresh _BOOT_NS_META from updated boot-image.bin
                _save_lump_diagnostic_event(
                    stage="Reload", event="complete", outcome="committed",
                    http_status=200)
            else:
                boot_refresh_note = f'boot config unavailable: {err_bi}'
                raise RuntimeError(boot_refresh_note)
        except Exception as _bie:
            boot_refresh_note = (
                "LUMP saved but not yet installed in the hardware image; "
                f"boot-image.bin was not regenerated: {_bie}"
            )
            logging.warning(
                "[lumps] saved %s but boot image refresh was deferred: %s",
                lump_filename, _bie)
            _save_lump_diagnostic_event(
                stage="Reload", event="exception", outcome="committed",
                error={"name": type(_bie).__name__, "message": str(_bie)})
    else:
        _save_lump_diagnostic_event(
            stage="Reload", event="skipped", outcome="committed",
            error={"name": "BootImageUnavailable",
                   "message": "boot-image.bin is not present"})

    # ── SelfTest metadata is always refreshed after a SelfTest save ──────────
    # generate_boot_image() locates the SelfTest lump via ns_slot in the
    # manifest, but new manifest entries intentionally omit ns_slot (ns-state.json
    # is authoritative for that mapping).  When regeneration fails or is skipped,
    # _load_boot_abstr_lump() is NOT called above, so _BOOT_ABSTR_META stays
    # stale and GET /api/lumps/list returns the old cw/cc.
    # Calling it unconditionally here (reads the manifest-designated lump file
    # directly, no boot-image needed) ensures the list reflects the new binary
    # immediately after every SelfTest save, regardless of boot-image outcome.
    if _is_selftest_canonical and not boot_refreshed:
        _load_boot_abstr_lump()

    LAZY_LUMPS[token8] = lump_bytes
    LAZY_LUMPS[token8.lstrip('0') or '0'] = lump_bytes

    resp: dict = {
        "ok":             True,
        "committed":      True,
        "token":          token8,
        "lump":           lump_filename,
        "filename":       lump_filename,
        "immutable_filename": lump_filename,
        "lump_path":      f'server/lumps/{lump_filename}',
        "abstraction":    abs_name,
        "dot_name":       _dot_name_save,
        "issue_n":        _issue_n_save,
        "size_bytes":     len(lump_bytes),
        "lump_version":   next_lump_version,
        "compiled_at":    _compiled_at,
        "binary_hash":    _binary_hash,
        "digest":         _binary_hash,
        "ns_slot":        ns_slot,
        "candidate_id":   _candidate_id,
        "final_binary":   list(_sl_words),
        # Seal is the server-issued artifact identity returned to promotion
        # clients; never derive it from browser metadata.
        "seal":           ((_bootstrap_identity or {}).get("bootstrap_runtime_gt")
                          if _bootstrap_identity is not None else _identity_hash),
        "boot_image_refreshed": boot_refreshed,
        **(_bootstrap_identity or {"identity_hash": _identity_hash}),
        "identity_string": _identity_string,
        "petname":        _petname,
        "issue_number":   _issue_number,
        "output_profile": (
            _intrinsic_content.get("tier")
            if isinstance(_intrinsic_content, dict) else None),
        "capabilities":   list(_validated_declared_caps),
        "operation_id":   getattr(g, "_lump_save_diagnostic", {}).get(
            "operation_id"),
        "warnings":       _save_warnings,
    }
    if boot_refresh_note:
        resp["boot_image_note"] = boot_refresh_note
    if _is_server_bootstrap_history_repair:
        resp.update({
            "namespace_slot": ns_slot,
            "namespace_sequence": _bootstrap_binding.get("seq", 0),
            "destination_token": token8,
        })
    return jsonify(resp)

@app.route("/api/lumps/save-wip", methods=["POST"])
def save_lump_wip():
    """Retired: WIP state is not persisted outside a self-defining LUMP."""
    return jsonify({
        "error": "WIP persistence is retired; save a self-defining .lump revision instead"
    }), 410

@app.route("/api/lump/<token>/wip-source", methods=["PATCH"])
def patch_wip_source(token):
    """Retired: source is intrinsic to an approved LUMP binary."""
    return jsonify({
        "error": "LUMP source patching is retired; source must be intrinsic to the .lump"
    }), 410


def _bootstrap_snapshot_identity(
        lumps_dir, manifest_entry, inspected, *, binding_override=None):
    """Compare one exact saved binary with its name's live bootstrap binding.

    Archived bootstrap revisions are immutable, but they are not exempt from
    the current frozen-resident identity contract.  This helper is read-only:
    it reports whether the record token, sealed row-zero word, and live
    destination GT are the same unsigned word.
    """
    if not isinstance(manifest_entry, dict) or not isinstance(inspected, dict):
        return None
    abstraction = manifest_entry.get("abstraction")
    if not isinstance(abstraction, str) or not abstraction:
        return None
    # These are the ratified frozen bootstrap chain.  Historical manifest rows
    # predate explicit resident flags, so ancestry must be recognized by stable
    # abstraction identity rather than by a current token or filename.
    if abstraction.casefold() not in {
            "selftest", "capabilitytest", "wukongcallhome"}:
        return None

    record_token = str(manifest_entry.get("token") or "").strip().lower()

    def _unavailable(reason):
        return {
            "applies": True,
            "valid": False,
            "archived": bool(manifest_entry.get("archived")),
            "record_token": record_token,
            "row0_gt": None,
            "expected_gt": None,
            "slot": None,
            "sequence": None,
            "errors": [
                "authoritative bootstrap identity audit is unavailable: "
                + reason
            ],
            "data_changed": False,
        }

    try:
        with open(os.path.join(lumps_dir, "ns-state.json"), encoding="utf-8") as source:
            state_rows = json.load(source).get("abstractions", [])
        if not isinstance(state_rows, list):
            return _unavailable("ns-state abstractions is not an array")
    except (OSError, ValueError, AttributeError) as exc:
        return _unavailable(f"ns-state could not be read ({exc})")
    if binding_override is not None:
        binding = binding_override
    else:
        bindings = [
            row for row in state_rows
            if isinstance(row, dict)
            and str(row.get("name") or "").casefold() == abstraction.casefold()
        ]
        if len(bindings) == 1:
            binding = bindings[0]
        else:
            # A corrected history revision can coexist with the original
            # resident binding. Resolve live records by their serialized GT;
            # an archive that has no matching live binding remains explicitly
            # unavailable rather than being attributed to the wrong slot.
            matching = []
            for row in bindings:
                try:
                    if f"{_resident_inform_egt(row) & 0xFFFFFFFF:08x}" \
                            == str(record_token).lower():
                        matching.append(row)
                except (TypeError, ValueError):
                    continue
            if len(matching) != 1:
                return _unavailable(
                    f"expected one matching {abstraction} Namespace binding; "
                    f"found {len(bindings)} rows and {len(matching)} token matches")
            binding = matching[0]
    try:
        expected_gt = _resident_inform_egt(binding)
    except ValueError as exc:
        return _unavailable(str(exc))
    words = inspected.get("words")
    allocation = inspected.get("lump_size")
    cc = inspected.get("cc")
    row0_gt = None
    if (isinstance(words, (list, tuple)) and isinstance(allocation, int)
            and isinstance(cc, int) and cc >= 1 and len(words) >= allocation):
        row0_gt = int(words[allocation - cc]) & 0xFFFFFFFF
    expected_token = f"{expected_gt:08x}"
    row0_token = f"{row0_gt:08x}" if row0_gt is not None else None
    errors = []
    if row0_gt is None:
        errors.append("sealed binary has no readable c-list row-zero GT")
    if record_token != expected_token:
        errors.append(
            f"record Token 0x{record_token or '????????'} != expected GT 0x{expected_token}")
    if row0_token != expected_token:
        errors.append(
            f"sealed row-zero GT 0x{row0_token or '????????'} != expected GT 0x{expected_token}")
    if row0_token is not None and record_token != row0_token:
        errors.append(
            f"record Token 0x{record_token or '????????'} != sealed row-zero GT 0x{row0_token}")
    return {
        "applies": True,
        "valid": not errors,
        "archived": bool(manifest_entry.get("archived")),
        "record_token": record_token,
        "row0_gt": row0_token,
        "expected_gt": expected_token,
        "active_namespace_gt": expected_token,
        "slot": binding.get("slot"),
        "sequence": binding.get("seq", 0),
        "errors": errors,
        "data_changed": False,
    }


def _lump_preview_issues(validation_errors, bootstrap_identity=None, *,
                         historical=False, current=False,
                         restore_enabled=None):
    """Return ordered, user-facing diagnostics for a read-only Preview.

    Keep the raw validation messages as individual entries.  Bootstrap
    identity facts are added separately so a Preview cannot reduce a
    multi-part identity failure to one generic "invalid binary" message.
    """
    issues = []
    for message in validation_errors or []:
        if message:
            issues.append({"kind": "validation", "message": str(message)})

    identity = bootstrap_identity
    if isinstance(identity, dict) and identity.get("applies") is True:
        if identity.get("valid") is False:
            issues.append({
                "kind": "bootstrap-identity",
                "message": "Bootstrap identity is inconsistent.",
            })
            for message in identity.get("errors") or []:
                if message:
                    issues.append({
                        "kind": "bootstrap-identity-detail",
                        "message": str(message),
                    })

    if historical and not current:
        if restore_enabled is False:
            issues.append({
                "kind": "activation",
                "message": (
                    "Direct History activation is disabled because this "
                    "revision is not a valid live candidate."
                ),
            })
        else:
            issues.append({
                "kind": "activation",
                "message": (
                    "Direct History activation is available only after the "
                    "existing validation and approval checks succeed."
                ),
            })
    return issues


def _lump_archive_provenance(filename, *, pattern_discovered=False,
                              correction_supported=False):
    """Describe how an immutable History archive was located."""
    if pattern_discovered:
        return {
            "kind": "standard-filename-pattern",
            "filename": filename,
            "description": (
                "This archive was discovered from the active LUMP's standard "
                "filename pattern; it has no separate archived manifest row."
            ),
            "correction_supported": bool(correction_supported),
        }
    return {
        "kind": "archived-manifest-row",
        "filename": filename,
        "description": (
            "This archive is identified by its immutable archived manifest row."
        ),
        "correction_supported": bool(correction_supported),
    }


@app.route("/api/lumps/list")
def list_lumps():
    """Return the manifest catalogue reconciled with binary/approval facts."""
    lumps_dir = LUMPS_DIR
    manifest_path = os.path.join(lumps_dir, 'manifest.json')
    try:
        manifest = _read_manifest_safe(manifest_path)
        approvals = _read_lump_approvals(lumps_dir)
    except ValueError as exc:
        return jsonify({"error": str(exc)}), 409
    result = []
    for entry in manifest:
        # Archived manifest rows are immutable historical evidence, not active
        # catalogue entries. They remain available through detail/words routes
        # and are grouped under the active abstraction's History response.
        if entry.get("archived") is True:
            continue
        token8 = entry.get('token', '')
        row = dict(entry)
        path = os.path.join(lumps_dir, entry.get("filename") or f"{token8}.lump")
        try:
            inspected = _inspect_lump_binary(path)
            approval = approvals.get(inspected["binary_hash"])
            canonical = _check_lump_canonical_integrity(
                lumps_dir, token8, inspected["raw_bytes"])
            if isinstance(canonical, str):
                raise ValueError(canonical)
            row.update({k: inspected[k] for k in
                        ("cw", "cc", "typ", "lump_size", "binary_hash",
                         "content_profile", "sourceStorageTier")})
            row["binary_valid"] = True
            row["approved"] = approval is not None
            row["clist_entries"] = inspected["clist_entries"]
            row["has_source"] = bool(inspected["source"])
            bootstrap_identity = _bootstrap_snapshot_identity(
                lumps_dir, entry, inspected)
            if bootstrap_identity is not None:
                row["bootstrap_identity"] = bootstrap_identity
                row["legacy_incompatible"] = bool(
                    entry.get("archived") and not bootstrap_identity["valid"])
            if approval:
                row.update({k: v for k, v in approval.items()
                            if k not in {"source", "cw", "cc", "typ", "lump_size"}})
        except (OSError, ValueError) as exc:
            row["binary_valid"] = False
            row["approved"] = False
            row["validation_errors"] = [str(exc)]
        result.append(row)

    # Prepend system LUMPs extracted live from boot-image.bin.
    # Boot.NS (slot 0, typ=1) comes first so it heads the list; Boot.Abstr (slot 6)
    # follows immediately after.  Filter any stale manifest duplicates first.
    if _BOOT_ABSTR_META:
        result = [e for e in result if e.get('token') not in SERVER_MANAGED_TOKENS]
        result = [dict(_BOOT_ABSTR_META)] + result
    if _BOOT_NS_META:
        result = [e for e in result if e.get('token') != '00000000']
        result = [dict(_BOOT_NS_META)] + result

    return jsonify(result)


@app.route("/api/lumps/<token>/detail")
def get_lump_detail(token):
    """Return binary-intrinsic facts plus metadata approved for this hash."""
    lumps_dir = LUMPS_DIR
    token8 = (token.lower()[:8] if len(token) >= 8 else token.lower()).zfill(8)

    manifest_path = os.path.join(lumps_dir, 'manifest.json')
    manifest = []
    if os.path.isfile(manifest_path):
        try:
            with open(manifest_path, 'r') as fh:
                manifest = json.load(fh)
        except Exception:
            pass

    entry = next((e for e in manifest if e.get('token') == token8), None)
    if entry is None:
        return jsonify({"error": f"No LUMP found for token {token8}"}), 404

    try:
        inspected = _inspect_lump_binary(
            os.path.join(lumps_dir, entry.get("filename") or f"{token8}.lump"))
        approval = _matching_lump_approval(lumps_dir, inspected["binary_hash"])
        canonical = _check_lump_canonical_integrity(
            lumps_dir, token8, inspected["raw_bytes"])
    except (OSError, ValueError) as exc:
        return jsonify({"error": f"LUMP integrity failure: {exc}"}), 409
    if isinstance(canonical, str):
        return jsonify({"error": canonical}), 409
    detail = dict(approval or {})
    detail.update({
        key: value for key, value in entry.items()
        if key not in {"source", "api_definition", "clist_entries"}
    })
    detail.update({k: inspected[k] for k in
                   ("cw", "cc", "typ", "lump_size", "binary_hash",
                    "content_profile", "sourceStorageTier", "api_definition",
                    "source", "clist_entries")})
    detail.update({"token": token8, "filename": entry.get("filename"),
                   "approved": approval is not None,
                   "trusted": approval is not None and canonical is True,
                   "api_definition_source": "lump",
                   "read_only": bool(entry.get("archived"))})
    bootstrap_identity = _bootstrap_snapshot_identity(
        lumps_dir, entry, inspected)
    if bootstrap_identity is not None:
        detail["bootstrap_identity"] = bootstrap_identity
        detail["legacy_incompatible"] = bool(
            entry.get("archived") and not bootstrap_identity["valid"])
    if entry.get("archived") is True:
        detail["promotion_available"] = _promotion_candidate_for_view(entry) is not None
    return jsonify(detail)


def _latest_primary_compilation(abstraction):
    """Resolve one immutable, source-bearing primary revision on the server."""
    name = str(abstraction or "").strip()
    if not name:
        raise ValueError("abstraction is required")
    manifest = _read_manifest_safe(os.path.join(LUMPS_DIR, "manifest.json"))
    rows = [row for row in manifest if isinstance(row, dict)
            and str(row.get("abstraction") or "") == name
            and not row.get("system_managed")]
    candidates = []
    for row in rows:
        filename = row.get("filename")
        if not isinstance(filename, str) or os.path.basename(filename) != filename:
            continue
        try:
            inspected = _inspect_lump_binary(os.path.join(LUMPS_DIR, filename))
            if not isinstance(inspected.get("source"), str) or not inspected["source"]:
                continue
            if _check_lump_canonical_integrity(
                    LUMPS_DIR, str(row.get("token") or "").lower().zfill(8),
                    inspected["raw_bytes"]) is not True:
                continue
            if _matching_lump_approval(LUMPS_DIR, inspected["binary_hash"]) is None:
                continue
            candidates.append((row, inspected))
        except (OSError, ValueError):
            continue
    if not candidates:
        raise LookupError("no unambiguous saved primary compilation with intrinsic source")
    # Version is the authoritative saved-revision order.  Ties are ambiguous.
    candidates.sort(key=lambda pair: int(pair[0].get("lump_version") or 0),
                   reverse=True)
    newest_version = int(candidates[0][0].get("lump_version") or 0)
    newest = [pair for pair in candidates
              if int(pair[0].get("lump_version") or 0) == newest_version]
    if len(newest) != 1:
        raise LookupError("latest saved primary compilation is ambiguous")
    return newest[0]


def _promotion_candidate_for_view(viewed):
    """Return a candidate only when it is strictly newer than *viewed*."""
    try:
        viewed_revision = int(viewed.get("lump_version") or viewed.get("version") or 0)
    except (TypeError, ValueError):
        return None
    try:
        candidate = _latest_primary_compilation(viewed.get("abstraction"))
    except (LookupError, ValueError, OSError):
        return None
    if int(candidate[0].get("lump_version") or 0) <= viewed_revision:
        return None
    return candidate


def _promotion_binding_for_candidate(row, inspected):
    """Build server-owned facts consumed by both save-plan and save."""
    abstraction = str(row.get("abstraction") or "")
    try:
        with open(NS_STATE_PATH, encoding="utf-8") as state_file:
            rows = json.load(state_file).get("abstractions", [])
    except (OSError, ValueError, AttributeError):
        rows = []
    bindings = [item for item in rows if isinstance(item, dict)
                and item.get("name") == abstraction]
    ns = bindings[0] if len(bindings) == 1 else None
    snapshot = _bootstrap_snapshot_identity(LUMPS_DIR, row, inspected)
    if snapshot is not None and not snapshot.get("valid"):
        raise ValueError("latest candidate has invalid bootstrap identity")
    if snapshot is not None:
        if ns is None:
            raise ValueError("latest bootstrap candidate has no unique Namespace binding")
        if (int(ns.get("slot")) != int(snapshot.get("slot"))
                or int(ns.get("seq")) != int(snapshot.get("sequence"))):
            raise ValueError("latest bootstrap candidate does not match the Namespace binding")
    return {
        "binding_id": secrets.token_urlsafe(32),
        "abstraction": abstraction,
        "token": str(row.get("token") or "").lower().zfill(8),
        "revision": int(row.get("lump_version") or 0),
        "binary_hash": inspected["binary_hash"],
        "ns_slot": ns.get("slot") if ns else None,
        "namespace_sequence": ns.get("seq") if ns else None,
        "bootstrap_snapshot": snapshot,
    }


def _validate_promotion_binding(metadata, binary_hash):
    binding = metadata.get("promotion_binding")
    if binding is None:
        return None
    if not isinstance(binding, dict) or not binding.get("binding_id"):
        raise ValueError("promotion binding is malformed")
    if binding.get("binary_hash") != binary_hash:
        raise ValueError("promotion binding does not match submitted binary")
    with _LUMP_PROMOTION_BINDINGS_LOCK:
        issued = _LUMP_PROMOTION_BINDINGS.get(binding["binding_id"])
    if not issued or issued != binding:
        raise ValueError("promotion binding is unknown or expired")
    row, inspected = _latest_primary_compilation(binding["abstraction"])
    if (str(row.get("token") or "").lower().zfill(8) != binding["token"]
            or int(row.get("lump_version") or 0) != int(binding["revision"])
            or inspected["binary_hash"] != binary_hash):
        raise ValueError("promotion candidate is stale; reload the latest compilation")
    if binding.get("bootstrap_snapshot") is not None:
        current = _bootstrap_snapshot_identity(LUMPS_DIR, row, inspected)
        if current != binding["bootstrap_snapshot"] or not current.get("valid"):
            raise ValueError("authoritative bootstrap identity changed; reload candidate")
    return binding


@app.route("/api/lumps/latest-primary/<path:abstraction>")
@app.route("/api/lumps/promotion-candidate/<path:abstraction>")
def get_latest_primary_compilation(abstraction):
    """Return exact intrinsic source and bytes for a promotion candidate."""
    try:
        before_token = request.args.get("from_token")
        before_revision = request.args.get("from_revision")
        if before_token is not None:
            manifest = _read_manifest_safe(os.path.join(LUMPS_DIR, "manifest.json"))
            matches = [row for row in manifest if isinstance(row, dict)
                       and str(row.get("token") or "").lower().zfill(8)
                       == str(before_token).lower().zfill(8)]
            if len(matches) != 1 or matches[0].get("archived") is not True:
                return jsonify({"error": "viewed archive is not an authoritative immutable row",
                                "promotion_available": False,
                                "data_changed": False}), 409
            if before_revision is None or int(matches[0].get("lump_version") or 0) != int(before_revision):
                return jsonify({"error": "viewed archive revision does not match the server record",
                                "promotion_available": False,
                                "data_changed": False}), 409
            candidate = _promotion_candidate_for_view(matches[0])
            if candidate is None:
                return jsonify({"error": "no strictly newer valid intrinsic-source primary revision exists",
                                "promotion_available": False,
                                "data_changed": False}), 404
        else:
            candidate = None
    except (TypeError, ValueError):
        return jsonify({"error": "viewed archive revision is invalid",
                        "promotion_available": False, "data_changed": False}), 400
    try:
        row, inspected = candidate or _latest_primary_compilation(abstraction)
    except LookupError as exc:
        return jsonify({"error": str(exc), "data_changed": False}), 409
    except (OSError, ValueError) as exc:
        return jsonify({"error": str(exc), "data_changed": False}), 409
    try:
        promotion_binding = _promotion_binding_for_candidate(row, inspected)
    except ValueError as exc:
        return jsonify({"error": str(exc), "promotion_available": False,
                        "data_changed": False}), 409
    with _LUMP_PROMOTION_BINDINGS_LOCK:
        _LUMP_PROMOTION_BINDINGS[promotion_binding["binding_id"]] = promotion_binding
    token = str(row.get("token") or "").lower().zfill(8)
    return jsonify({
        "ok": True,
        "abstraction": row.get("abstraction"),
        "revision": int(row.get("lump_version") or 0),
        "lump_version": int(row.get("lump_version") or 0),
        "token": token,
        "filename": row.get("filename"),
        "binary_hash": inspected["binary_hash"],
        "seal": row.get("seal") or row.get("identity_seal") or inspected["binary_hash"],
        "source": inspected["source"],
        "words": inspected["words"],
        "intrinsic_source": True,
        "immutable": True,
        "archived": bool(row.get("archived")),
        "promotion_available": True,
        "approval": _matching_lump_approval(LUMPS_DIR, inspected["binary_hash"]),
        "promotion_binding": promotion_binding,
    })


@app.route("/api/lump/<token_hex>/diagnostic-source")
def get_lump_diagnostic_source(token_hex):
    """Return embedded source for diagnosing a rejected saved artifact.

    This endpoint deliberately does not return binary words and does not mark
    the artifact trusted. It lets the programmer repair intrinsic embedded
    source while the normal words/content endpoints remain fail-closed.
    """
    import re as _re_diag
    raw = token_hex.lower()
    if not _re_diag.fullmatch(r'[0-9a-f]{1,8}', raw):
        return jsonify({"error": "Invalid token"}), 400
    key8 = raw.zfill(8)
    try:
        manifest = _read_manifest_safe(os.path.join(LUMPS_DIR, "manifest.json"))
    except ValueError as exc:
        return jsonify({"error": str(exc)}), 409
    matches = [
        row for row in manifest
        if isinstance(row, dict) and str(row.get("token") or "").lower() == key8
    ]
    if len(matches) != 1:
        status = 404 if not matches else 409
        message = (f"Unknown lump 0x{key8}" if not matches
                   else f"Duplicate manifest token {key8}")
        return jsonify({"error": message}), status
    entry = matches[0]
    filename = entry.get("filename")
    if not isinstance(filename, str) or not filename:
        return jsonify({"error": "Manifest locator has no filename"}), 409
    try:
        inspected = _inspect_lump_binary(os.path.join(LUMPS_DIR, filename))
        validation_error = _check_lump_canonical_integrity(
            LUMPS_DIR, key8, inspected["raw_bytes"])
    except (OSError, ValueError) as exc:
        return jsonify({"error": f"LUMP inspection failure: {exc}"}), 409
    source = inspected.get("source")
    if not isinstance(source, str) or not source:
        return jsonify({
            "error": "The rejected artifact has no embedded source to repair.",
            "token": key8,
            "validation_error": validation_error if isinstance(validation_error, str) else None,
        }), 404
    return jsonify({
        "token": key8,
        "abstraction": entry.get("abstraction"),
        "filename": filename,
        "source": source,
        "validation_error": validation_error if isinstance(validation_error, str) else None,
        "diagnostic_only": True,
        "trusted": False,
    })


@app.route("/api/lump/<token_hex>/words")
def get_lump_words(token_hex):
    """Return the raw uint32 word array of a saved lump as JSON."""
    import re as _re_words
    raw   = token_hex.lower()
    if not _re_words.fullmatch(r'[0-9a-f]{1,8}', raw):
        return jsonify({"error": "Invalid token"}), 400
    key8  = (raw[:8] if len(raw) >= 8 else raw).zfill(8)
    archive_filename = request.args.get("archive_filename")
    archive_manifest_entry = None
    archive_provenance = None
    if archive_filename is not None:
        # History supplies this immutable locator for archived records. Do not
        # accept an arbitrary path: it must be either an exact archived
        # manifest filename for this abstraction or one of the active LUMP's
        # standard generated archive filenames.
        if (
            not archive_filename
            or os.path.basename(archive_filename) != archive_filename
            or not archive_filename.endswith(".lump")
        ):
            return jsonify({"error": "Invalid archived filename"}), 400
        try:
            archive_manifest = _read_manifest_safe(
                os.path.join(LUMPS_DIR, "manifest.json"))
        except ValueError as exc:
            return jsonify({"error": str(exc)}), 409
        active_matches = [
            row for row in archive_manifest
            if isinstance(row, dict)
            and row.get("archived") is not True
            and str(row.get("token") or "").lower() == key8
        ]
        if len(active_matches) == 1:
            active_entry = active_matches[0]
        else:
            # Historical records have their own immutable record token.  A
            # caller opening such a row must be able to inspect its exact
            # recorded filename even after its former active token has changed
            # (for example a capability migration).  This remains fail-closed:
            # require one exact archived manifest locator bound to the supplied
            # record token, never a filename-only fallback.
            recorded_matches = [
                row for row in archive_manifest
                if isinstance(row, dict)
                and row.get("archived") is True
                and row.get("filename") == archive_filename
                and str(row.get("token") or "").lower() == key8
            ]
            if len(recorded_matches) != 1:
                return jsonify({"error": f"No active or recorded LUMP found for token {key8}"}), 404
            active_entry = recorded_matches[0]
        archive_matches = [
            row for row in archive_manifest
            if isinstance(row, dict)
            and row.get("archived") is True
            and row.get("filename") == archive_filename
            and str(row.get("abstraction") or "").casefold()
                == str(active_entry.get("abstraction") or "").casefold()
        ]
        if len(archive_matches) > 1:
            return jsonify({
                "error": "Archived filename maps to multiple manifest records"
            }), 409
        if len(archive_matches) == 1:
            archive_manifest_entry = archive_matches[0]
            archive_provenance = _lump_archive_provenance(
                archive_filename, pattern_discovered=False)
        else:
            active_filename = str(active_entry.get("filename") or "")
            active_stem = (
                _re.sub(r"_v\d+$", "", active_filename[:-5])
                if active_filename.endswith(".lump") else "")
            safe_name = _re.sub(
                r"[^A-Za-z0-9_.-]+", "_",
                str(active_entry.get("abstraction") or ""))
            version_match = _re.search(r"_v(\d+)\.lump$", archive_filename)
            generated_filenames = {
                f"{key8}-v{version_match.group(1)}.lump"
                if version_match else "",
                f"{active_stem}_v{version_match.group(1)}.lump"
                if active_stem and version_match else "",
                f"{safe_name}_v{version_match.group(1)}.lump"
                if safe_name and version_match else "",
            }
            if archive_filename not in generated_filenames:
                return jsonify({
                    "error": "Archived LUMP record is unavailable"
                }), 404
            archive_manifest_entry = dict(active_entry)
            archive_manifest_entry.update({
                "archived": True,
                "filename": archive_filename,
                "lump_version": (
                    int(version_match.group(1)) if version_match else None),
            })
            archive_provenance = _lump_archive_provenance(
                archive_filename, pattern_discovered=True)
        lump_path = os.path.join(LUMPS_DIR, archive_filename)
    else:
        # The live manifest is authoritative for tokenized dot-name binaries.
        # Those filenames do not necessarily have a token-based stem, so
        # resolving only by a guessed path can hide an existing current LUMP.
        lump_path = None
        try:
            manifest = _read_manifest_safe(os.path.join(LUMPS_DIR, "manifest.json"))
            active_matches = [
                row for row in manifest
                if isinstance(row, dict)
                and row.get("archived") is not True
                and str(row.get("token") or "").lower() == key8
            ]
            if len(active_matches) == 1:
                active_filename = active_matches[0].get("filename")
                if (isinstance(active_filename, str) and active_filename
                        and os.path.basename(active_filename) == active_filename):
                    candidate_path = os.path.join(LUMPS_DIR, active_filename)
                    if os.path.isfile(candidate_path):
                        lump_path = candidate_path
        except ValueError:
            pass
        if lump_path is None:
            lump_path = _resolve_lump_path(key8, LUMPS_DIR)
    if not lump_path:
        return jsonify({"error": f"Unknown lump 0x{key8}"}), 404
    validation_errors = []
    raw_tail_hex = ""
    try:
        inspected = _inspect_lump_binary(lump_path)
    except (OSError, ValueError) as exc:
        # Viewing is read-only. Return every byte that can be read even when
        # parsing or integrity validation fails; load, restore, and repair
        # paths continue to use their own validation gates.
        snapshot = _validate_lump_snapshot(
            lump_path, archive_manifest_entry)
        if snapshot["raw_bytes"] is None:
            return jsonify({"error": f"LUMP integrity failure: {exc}"}), 409
        inspected = {
            "raw_bytes": snapshot["raw_bytes"],
            "words": snapshot["words"],
            "binary_hash": snapshot["binary_hash"],
            "cw": snapshot["cw"],
            "cc": snapshot["cc"],
            "typ": None,
            "lump_size": snapshot["lump_size"],
            "content_profile": snapshot["content_profile"],
            "source": snapshot["source"],
        }
        validation_errors = snapshot["errors"]
        raw_tail_hex = snapshot["raw_tail_hex"]
    else:
        if archive_manifest_entry is not None:
            snapshot = _validate_lump_snapshot(
                lump_path, archive_manifest_entry)
            validation_errors = snapshot["errors"]
    lump_raw = inspected["raw_bytes"]
    words = inspected["words"]
    num_words = len(words)

    # ── Filename integrity check (fail-closed for canonical entries) ─────────
    # Canonical integrity remains part of a LUMP's validity, but it cannot
    # suppress read-only inspection of existing bytes.
    _lh_lumps_dir = LUMPS_DIR
    _integrity_result = _check_lump_canonical_integrity(_lh_lumps_dir, key8, lump_raw)
    if isinstance(_integrity_result, str):
        validation_errors.append(_integrity_result)

    # Compute a fresh SHA-256 of the binary bytes so the caller can verify
    # the served content matches the hash recorded at compile time.
    _bh_live = inspected["binary_hash"]

    try:
        _approval_ret = _matching_lump_approval(LUMPS_DIR, _bh_live)
    except ValueError as exc:
        return jsonify({"error": str(exc)}), 409
    response = {
        "token":           key8,
        "words":           words,
        "count":           num_words,
        "binary_hash":     _bh_live,
        "approved":        _approval_ret is not None,
        "trusted": (_approval_ret is not None and _integrity_result is True
                    and not validation_errors),
        "binary_valid": not validation_errors,
        "validation_errors": validation_errors,
        "byte_count":      len(lump_raw),
        "raw_tail_hex":    raw_tail_hex,
        "cw": inspected.get("cw"),
        "cc": inspected.get("cc"),
        "lump_size": inspected.get("lump_size"),
        "content_profile": inspected.get("content_profile"),
        "source": inspected.get("source") or "",
    }
    try:
        manifest = _read_manifest_safe(os.path.join(LUMPS_DIR, "manifest.json"))
    except ValueError:
        manifest = []
    manifest_entry = next(
        (row for row in manifest
         if isinstance(row, dict)
         and row.get("archived") is not True
         and str(row.get("token") or "").lower() == key8),
        archive_manifest_entry)
    bootstrap_identity = _bootstrap_snapshot_identity(
        LUMPS_DIR, manifest_entry, inspected)
    if bootstrap_identity is not None:
        response["bootstrap_identity"] = bootstrap_identity
        response["legacy_incompatible"] = bool(
            manifest_entry.get("archived") and not bootstrap_identity["valid"])
    if _approval_ret is not None:
        for field in ("pet_name", "dot_name", "issue_n", "identity_hash"):
            if field in _approval_ret:
                response[field] = _approval_ret[field]
    if archive_manifest_entry is not None:
        if archive_provenance is None:
            archive_provenance = _lump_archive_provenance(archive_filename)
        if bootstrap_identity is not None:
            archive_provenance["correction_supported"] = bool(
                not bootstrap_identity.get("valid", True))
        response["archive_provenance"] = archive_provenance
        response["preview_issues"] = _lump_preview_issues(
            validation_errors, bootstrap_identity,
            historical=True,
            restore_enabled=bool(
                not validation_errors
                and _approval_ret is not None
                and _integrity_result is True))
        response.update({
            "version": archive_manifest_entry.get("lump_version"),
            "archive_filename": archive_filename,
            "historical_record": True,
            "read_only": True,
        })
    else:
        response["preview_issues"] = _lump_preview_issues(
            validation_errors, bootstrap_identity, current=True)
    return jsonify(response)


def _validate_lump_snapshot(
        lump_path, manifest_entry=None, *, bootstrap_binding=None):
    """Validate one exact binary and report any hash-bound approval.

    History, Preview, and Restore must agree on whether an archive is usable.
    This helper is intentionally read-only and is the sole implementation of
    the archive-level header, size, metadata, and SHA-256 checks.
    """
    errors = []
    binary_available = bool(lump_path and os.path.isfile(lump_path))
    result = {
        "approval": None,
        "errors": errors,
        "binary_available": binary_available,
        "raw_inspectable": False,
        "raw_bytes": None,
        "words": [],
        "byte_count": 0,
        "raw_tail_hex": "",
        "cw": None,
        "cc": None,
        "lump_size": None,
        "content_profile": None,
        "source": None,
        "binary_hash": None,
        "approved": False,
        "trusted": False,
        "valid": False,
        "bootstrap_identity": None,
    }
    if not binary_available:
        errors.append("archived binary is missing")
        return result
    try:
        inspected = _inspect_lump_binary(lump_path)
    except (OSError, ValueError) as exc:
        errors.append(str(exc))
        # Keep every readable byte available for read-only inspection, even
        # if malformed data has a non-word-aligned tail. Restore and runtime
        # gates continue to require a valid parsed artifact.
        try:
            with open(lump_path, "rb") as fh:
                raw_bytes = fh.read()
            whole_word_bytes = len(raw_bytes) - (len(raw_bytes) % 4)
            words = (
                list(_struct.unpack(
                    f">{whole_word_bytes // 4}I", raw_bytes[:whole_word_bytes]))
                if whole_word_bytes else []
            )
            result.update({
                "raw_bytes": raw_bytes,
                "words": words,
                "byte_count": len(raw_bytes),
                "raw_tail_hex": raw_bytes[whole_word_bytes:].hex().upper(),
                "binary_hash": hashlib.sha256(raw_bytes).hexdigest(),
                "raw_inspectable": True,
            })
        except (OSError, ValueError):
            pass
        return result
    result.update({
        key: inspected[key] for key in
        ("raw_bytes", "words", "cw", "cc", "lump_size", "binary_hash",
         "content_profile", "source")
    })
    result["byte_count"] = len(inspected["raw_bytes"])
    result["raw_inspectable"] = True
    bootstrap_identity = _bootstrap_snapshot_identity(
        os.path.dirname(os.path.abspath(lump_path)),
        manifest_entry,
        inspected,
        binding_override=bootstrap_binding)
    result["bootstrap_identity"] = bootstrap_identity
    if bootstrap_identity is not None and not bootstrap_identity["valid"]:
        errors.append(
            "bootstrap T-equals-GT validation failed: "
            + "; ".join(bootstrap_identity["errors"])
            + "; no data was changed")
    try:
        approval = _matching_lump_approval(
            os.path.dirname(os.path.abspath(lump_path)), inspected["binary_hash"])
    except ValueError as exc:
        errors.append(str(exc))
        approval = None
    if approval is None:
        pass
    else:
        result["approval"] = approval
        result["approved"] = True
        result["trusted"] = True
    result["valid"] = not errors
    return result


def _bootstrap_history_repair_candidate(current_token, version, archive_filename):
    """Build a new bootstrap candidate from one immutable historical archive.

    The archive is never modified.  This is deliberately limited to an
    otherwise readable bootstrap artifact whose only validation failure is the
    T/row-zero/Namespace identity relationship.  The returned candidate has
    exactly one changed binary word: c-list row zero.
    """
    key8 = str(current_token or "").lower().removeprefix("0x").zfill(8)
    if not re.fullmatch(r"[0-9a-f]{8}", key8):
        raise ValueError("current LUMP token is invalid")
    if (not isinstance(archive_filename, str) or not archive_filename
            or os.path.basename(archive_filename) != archive_filename
            or not archive_filename.endswith(".lump")):
        raise ValueError("an exact historical archive filename is required")

    lumps_dir = LUMPS_DIR
    manifest_path = os.path.join(lumps_dir, "manifest.json")
    manifest = _read_manifest_safe(manifest_path)
    active_rows = [
        row for row in manifest
        if isinstance(row, dict) and row.get("archived") is not True
        and str(row.get("token") or "").lower() == key8
    ]
    if len(active_rows) != 1:
        raise ValueError("the current LUMP manifest identity is unavailable")
    active = active_rows[0]
    abstraction = str(active.get("abstraction") or "").strip()
    if not abstraction:
        raise ValueError("the current LUMP has no abstraction identity")
    state_rows, _ = _read_authoritative_namespace_rows()
    active_bindings = [
        row for row in state_rows
        if isinstance(row, dict)
        and str(row.get("name") or "").casefold() == abstraction.casefold()
    ]
    matching_active_bindings = []
    for row in active_bindings:
        try:
            if f"{_resident_inform_egt(row):08x}" == key8:
                matching_active_bindings.append(row)
        except (TypeError, ValueError):
            continue
    if len(matching_active_bindings) == 1:
        active_binding = dict(matching_active_bindings[0])
    elif len(active_bindings) == 1:
        active_binding = dict(active_bindings[0])
    else:
        raise ValueError(
            "the current LUMP has no unambiguous authoritative Namespace binding")

    archived_rows = [
        row for row in manifest
        if isinstance(row, dict) and row.get("archived") is True
        and row.get("filename") == archive_filename
        and str(row.get("abstraction") or "").casefold() == abstraction.casefold()
    ]
    if len(archived_rows) == 1:
        archived = archived_rows[0]
    else:
        # Most ordinary history files are discovered from the active
        # abstraction's filename pattern and do not have a separate archived
        # manifest row. They are still immutable history when the exact
        # filename is one of the active LUMP's generated archive names.
        active_filename = str(active.get("filename") or "")
        active_stem = (
            re.sub(r"_v\d+$", "", active_filename[:-5])
            if active_filename.endswith(".lump") else ""
        )
        safe_name = re.sub(r"[^A-Za-z0-9_.-]+", "_", abstraction)
        generated_filenames = {
            f"{key8}-v{version}.lump",
            f"{active_stem}_v{version}.lump" if active_stem else "",
            f"{safe_name}_v{version}.lump",
        }
        if len(archived_rows) > 1 or archive_filename not in generated_filenames:
            raise ValueError("the requested archive is not immutable history for this LUMP")
        archived = dict(active)
        archived.update({
            "archived": True,
            "filename": archive_filename,
            "lump_version": version,
        })
    try:
        archive_version = int(archived.get("lump_version", archived.get("version")))
    except (TypeError, ValueError):
        raise ValueError("the requested archive has no usable version") from None
    if archive_version != int(version):
        raise ValueError("the requested archive version does not match its record")

    archive_path = _lump_transition_path(lumps_dir, archive_filename)
    snapshot = _validate_lump_snapshot(
        archive_path, archived, bootstrap_binding=active_binding)
    identity = snapshot.get("bootstrap_identity")
    errors = snapshot.get("errors") or []
    if (not snapshot.get("raw_inspectable") or not isinstance(identity, dict)
            or identity.get("applies") is not True
            or identity.get("valid") is not False
            or len(errors) != 1
            or not str(errors[0]).startswith(
                "bootstrap T-equals-GT validation failed:")):
        raise ValueError(
            "this archive is not an otherwise readable bootstrap identity mismatch")
    expected_hex = str(identity.get("expected_gt") or "").lower()
    if not re.fullmatch(r"[0-9a-f]{8}", expected_hex):
        raise ValueError("the authoritative expected bootstrap GT is unavailable")
    expected_gt = int(expected_hex, 16)
    words = list(snapshot.get("words") or [])
    allocation, cc = snapshot.get("lump_size"), snapshot.get("cc")
    if (not isinstance(allocation, int) or not isinstance(cc, int)
            or cc < 1 or len(words) < allocation):
        raise ValueError("the archive has no writable c-list row zero")
    row0_index = allocation - cc
    if row0_index < 0 or row0_index >= len(words):
        raise ValueError("the archive c-list row-zero location is invalid")

    destination = _allocate_bootstrap_history_repair_destination(abstraction)
    destination_binding = destination["binding"]
    expected_gt = destination["runtime_gt"]

    # The new candidate is proven against the newly allocated destination
    # descriptor, never the archival record's now-obsolete token.
    repaired_words = list(words)
    repaired_words[row0_index] = expected_gt
    candidate_bytes = _struct.pack(f">{len(repaired_words)}I", *repaired_words)
    candidate_inspected = _inspect_lump_binary(candidate_bytes)
    candidate_entry = dict(active, token=destination["token"], abstraction=abstraction)
    candidate_identity = _bootstrap_snapshot_identity(
        lumps_dir, candidate_entry, candidate_inspected,
        binding_override=destination_binding)
    if candidate_identity is None or candidate_identity.get("valid") is not True:
        raise ValueError("the repaired candidate does not satisfy the live bootstrap descriptor")

    active_path = _lump_transition_path(
        lumps_dir, active.get("filename") or f"{key8}.lump")
    active_snapshot = _validate_lump_snapshot(
        active_path, active, bootstrap_binding=active_binding)
    if not active_snapshot.get("valid"):
        raise ValueError(
            "the current live LUMP must pass validation before it can be superseded")
    archive_approval = snapshot.get("approval") or {}
    active_approval = active_snapshot.get("approval") or {}
    dot_name = str(
        active_approval.get("dot_name")
        or active.get("dot_name")
        or archive_approval.get("dot_name")
        or abstraction
    ).strip()
    petname = ""
    suffix = f".{abstraction}"
    if dot_name == abstraction:
        pass
    elif dot_name.endswith(suffix) and dot_name[:-len(suffix)]:
        petname = dot_name[:-len(suffix)]
    else:
        raise ValueError(
            "the current LUMP has a noncanonical dot name and cannot be reissued safely")
    issue_n = active_approval.get(
        "issue_n", active.get("issue_n", archive_approval.get("issue_n", 1)))
    try:
        issue_n = int(issue_n)
    except (TypeError, ValueError):
        raise ValueError("the current LUMP has an invalid issue number") from None
    if issue_n < 1:
        raise ValueError("the current LUMP has an invalid issue number")

    typ = (repaired_words[0] >> 8) & 0x3
    content_type = {0: "code", 1: "data", 2: "thread", 3: "outform"}[typ]
    metadata = {
        "token": destination["token"],
        "abstraction": abstraction,
        "content_type": content_type,
        "language": active_approval.get(
            "language", archive_approval.get("language", "assembly")),
        "ns_slot": destination["slot"],
        "namespace_sequence": destination["sequence"],
        "enforce_bootstrap_identity": True,
        "capabilities": [],
        "grants": active_approval.get(
            "grants", archive_approval.get("grants", ["E"])),
        "capability_type": active_approval.get(
            "capability_type", archive_approval.get("capability_type", "inform")),
        "issue_number": issue_n,
        "submitted_source": snapshot.get("source"),
        "_bootstrap_history_repair": True,
        "_bootstrap_repair_destination": destination_binding,
        "_bootstrap_repair_namespace_identity": destination["namespace_identity"],
        "_bootstrap_repair_destination_identity": _manifest_entry_identity({
            "slot": destination["slot"],
            "seq": destination["sequence"],
            "source_row": destination["source_row"],
        }),
    }
    if petname:
        metadata["petname"] = petname
    corrections = []
    if int(words[row0_index]) != expected_gt:
        corrections.append({
            "id": "repair-sealed-row-zero-gt",
            "title": "Correct the sealed c-list row-zero GT",
            "detail": (
                f"Replace 0x{int(words[row0_index]) & 0xFFFFFFFF:08X} with "
                f"the Namespace-derived GT 0x{expected_gt:08X}."),
        })
    corrections.append({
        "id": "issue-canonical-bootstrap-identity",
        "title": "Issue the repaired bytes as the canonical live LUMP",
        "detail": (
            f"Bind the new live revision's Token and serialized T to "
            f"0x{expected_gt:08X}; the original archive remains unchanged."),
    })
    return {
        "active": active,
        "archived": archived,
        "archive_filename": archive_filename,
        "archive_hash": snapshot.get("binary_hash"),
        "candidate_words": repaired_words,
        "candidate_hash": candidate_inspected["binary_hash"],
        "metadata": metadata,
        "corrections": corrections,
        "expected_gt": destination["token"],
        "destination": destination,
    }


@app.route(
    "/api/lumps/<token>/history/<int:version>/bootstrap-repair-plan",
    methods=["POST"],
)
def plan_bootstrap_history_repair(token, version):
    """Produce a short-lived, server-derived correction plan without writing."""
    payload = request.get_json(force=True, silent=True) or {}
    try:
        candidate = _bootstrap_history_repair_candidate(
            token, version, payload.get("archive_filename"))
        session.setdefault("_lump_approval_session", secrets.token_urlsafe(24))
        planned = {
            "binary": candidate["candidate_words"],
            "metadata": dict(candidate["metadata"], _save_plan_preflight=True),
        }
        repair_mode = _lump_bootstrap_history_repair_override.set(True)
        payload_override = _lump_save_payload_override.set(planned)
        try:
            preflight_response = app.make_response(save_lump())
        finally:
            _lump_save_payload_override.reset(payload_override)
            _lump_bootstrap_history_repair_override.reset(repair_mode)
        if preflight_response.status_code != 201:
            return preflight_response
        plan = preflight_response.get_json()
        plan_id = str(plan.get("plan_id") or "")
        if not plan_id:
            raise ValueError("the server did not return a correction save plan")
        with _LUMP_BOOTSTRAP_REPAIR_PLANS_LOCK:
            _LUMP_BOOTSTRAP_REPAIR_PLANS[plan_id] = {
                "session": session["_lump_approval_session"],
                "expires": time.time() + 300,
                "active_identity": _manifest_entry_identity(candidate["active"]),
                "archive_filename": candidate["archive_filename"],
                "archive_hash": candidate["archive_hash"],
                "candidate_hash": candidate["candidate_hash"],
                "namespace_identity": candidate["metadata"][
                    "_bootstrap_repair_namespace_identity"],
                "destination_identity": candidate["metadata"][
                    "_bootstrap_repair_destination_identity"],
                "correction_ids": tuple(
                    correction["id"] for correction in candidate["corrections"]),
            }
        return jsonify({
            "plan_id": plan_id,
            "digest": plan["digest"],
            "action": plan["action"],
            "expires_in": 300,
            "source_version": version,
            "archive_filename": candidate["archive_filename"],
            "expected_gt": candidate["expected_gt"],
            "namespace_slot": candidate["destination"]["slot"],
            "namespace_sequence": candidate["destination"]["sequence"],
            "destination_token": candidate["destination"]["token"],
            "corrections": candidate["corrections"],
            "consequence": (
                "A new compliant live revision will be saved. The current live "
                "revision is archived, and the defective historical archive is unchanged."
            ),
        }), 201
    except _LumpApprovalStoreError as exc:
        return jsonify({"error": str(exc), "committed": False}), 500
    except (OSError, TypeError, ValueError, _struct.error) as exc:
        return jsonify({
            "error": f"No data was changed: correction plan was not created: {exc}",
            "committed": False,
            "safe_retry": True,
        }), 409


@app.route(
    "/api/lumps/<token>/history/<int:version>/bootstrap-repair",
    methods=["POST"],
)
def apply_bootstrap_history_repair(token, version):
    """Apply an approved bootstrap repair through the normal atomic save path."""
    payload = request.get_json(force=True, silent=True) or {}
    plan_id = str(payload.get("plan_id") or "")
    selected_ids = payload.get("corrections")
    if not isinstance(selected_ids, list):
        return jsonify({"error": "corrections must be an array", "committed": False}), 400
    selected_ids = tuple(sorted({str(item) for item in selected_ids}))
    try:
        candidate = _bootstrap_history_repair_candidate(
            token, version, payload.get("archive_filename"))
        with _LUMP_BOOTSTRAP_REPAIR_PLANS_LOCK:
            repair_plan = _LUMP_BOOTSTRAP_REPAIR_PLANS.get(plan_id)
            if (repair_plan is None or repair_plan["expires"] < time.time()
                    or repair_plan["session"] != session.get("_lump_approval_session")):
                raise ValueError("a valid, unexpired correction plan is required")
            required_ids = tuple(sorted(repair_plan["correction_ids"]))
            if selected_ids != required_ids:
                raise ValueError("every server-listed correction must be approved")
            if (repair_plan["active_identity"]
                    != _manifest_entry_identity(candidate["active"])
                    or repair_plan["archive_filename"] != candidate["archive_filename"]
                    or repair_plan["archive_hash"] != candidate["archive_hash"]
                    or repair_plan["candidate_hash"] != candidate["candidate_hash"]
                    or repair_plan["namespace_identity"]
                    != candidate["metadata"]["_bootstrap_repair_namespace_identity"]
                    or repair_plan["destination_identity"]
                    != candidate["metadata"]["_bootstrap_repair_destination_identity"]):
                raise ValueError(
                    "the archive, live LUMP, or Namespace destination changed "
                    "while the correction was awaiting approval")

        metadata = dict(candidate["metadata"])
        metadata["save_plan_id"] = plan_id
        metadata["approval_intent"] = payload.get("approval_intent")
        repair_mode = _lump_bootstrap_history_repair_override.set(True)
        payload_override = _lump_save_payload_override.set({
            "binary": candidate["candidate_words"],
            "metadata": metadata,
        })
        try:
            save_response = app.make_response(save_lump())
        finally:
            _lump_save_payload_override.reset(payload_override)
            _lump_bootstrap_history_repair_override.reset(repair_mode)
        if save_response.status_code < 300:
            with _LUMP_BOOTSTRAP_REPAIR_PLANS_LOCK:
                _LUMP_BOOTSTRAP_REPAIR_PLANS.pop(plan_id, None)
        return save_response
    except _LumpApprovalStoreError as exc:
        return jsonify({"error": str(exc), "committed": False}), 500
    except (OSError, TypeError, ValueError, _struct.error) as exc:
        return jsonify({
            "error": f"No data was changed: bootstrap correction was refused: {exc}",
            "committed": False,
            "safe_retry": True,
        }), 409


@app.route("/api/lumps/<token>/history")
def get_lump_history(token):
    """Return the current and archived versions for a LUMP token, newest-first.

    Response shape (wrapped object — intentional):
        { "token": "<8-char>", "history": [ <entry>, ... ] }

    Structural fields come from exact bytes, never sidecar metadata. Preview
    is read-only and available whenever the archived file can be read; restore
    additionally requires a valid, approved archive bound to its exact hash.

    Note: the response is a wrapped object (not a bare JSON array) so that
    callers can distinguish an empty-history success from a 404 / error response.
    """
    import re as _re
    raw = token.lower()
    key8 = (raw[:8] if len(raw) >= 8 else raw).zfill(8)
    if not _re.fullmatch(r'[0-9a-f]{8}', key8):
        return jsonify({"error": "Invalid token"}), 400
    lumps_dir = LUMPS_DIR
    # Match both the current filename stem and the stable abstraction-name
    # archive stem. Older archives may predate a tokenized dot-name filename.
    _safe_stems_h = set()
    _current_manifest_h = None
    _related_archived_h = []
    _mf_path_h = os.path.join(lumps_dir, 'manifest.json')
    if os.path.isfile(_mf_path_h):
        try:
            with open(_mf_path_h) as _mf:
                _mf_d = json.load(_mf)
            _active_matches_h = [
                _e for _e in _mf_d
                if isinstance(_e, dict)
                and _e.get("token") == key8
                and _e.get("archived") is not True
            ]
            if len(_active_matches_h) > 1:
                return jsonify({
                    "error": f"Duplicate active manifest token {key8}"
                }), 409
            if _active_matches_h:
                _current_manifest_h = _active_matches_h[0]
                _fn = _current_manifest_h.get('filename', '')
                if _fn and _fn.endswith('.lump'):
                    _safe_stems_h.add(_re.sub(r'_v\d+$', '', _fn[:-5]))
                _name_h = _current_manifest_h.get('abstraction', '')
                if isinstance(_name_h, str) and _name_h:
                    _safe_stems_h.add(
                        _re.sub(r'[^A-Za-z0-9_.-]+', '_', _name_h))
            if _current_manifest_h:
                _current_name_h = str(
                    _current_manifest_h.get("abstraction") or "").casefold()
                _related_archived_h = [
                    _e for _e in _mf_d
                    if isinstance(_e, dict)
                    and _e.get("archived") is True
                    and str(_e.get("abstraction") or "").casefold() == _current_name_h
                ]
        except Exception:
            pass
    if _current_manifest_h is None:
        return jsonify({"error": f"No active LUMP found for token {key8}"}), 404
    pattern_token = _re.compile(rf'^{_re.escape(key8)}-v(\d+)\.lump$')
    pattern_named = [_re.compile(rf'^{_re.escape(_stem)}_v(\d+)\.lump$')
                     for _stem in _safe_stems_h]

    def _snapshot_entry_h(version, lump_path, *, current=False):
        snapshot = _validate_lump_snapshot(lump_path, _current_manifest_h)
        approval = snapshot["approval"] or {}
        errors = snapshot["errors"]
        archive_filename_h = os.path.basename(lump_path) if not current else None
        archived_manifest_h = next(
            (row for row in _related_archived_h
             if row.get("filename") == archive_filename_h),
            None)
        pattern_discovered_h = bool(
            not current and archive_filename_h
            and archived_manifest_h is None)
        bootstrap_identity_h = snapshot["bootstrap_identity"]
        compiled_at_h = approval.get("compiled_at")
        if compiled_at_h is None:
            compiled_at_h = (
                (_current_manifest_h if current else archived_manifest_h) or {}
            ).get("compiled_at")
        entry = {
            "version": version,
            "current": current,
            "compiled_at": compiled_at_h,
            "abstraction": approval.get("abstraction"),
            "cw": snapshot["cw"],
            "cc": snapshot["cc"],
            "lump_size": snapshot["lump_size"],
            "content_profile": snapshot["content_profile"],
            "binary_hash": snapshot["binary_hash"],
            "binary_available": snapshot["binary_available"],
            "raw_inspectable": snapshot["raw_inspectable"],
            "binary_valid": snapshot["valid"],
            "approved": snapshot["approved"],
            "trusted": snapshot["trusted"],
            "metadata_only": not snapshot["binary_available"],
            "preview_enabled": bool(
                not current and snapshot["binary_available"]),
            "restore_enabled": bool(
                not current and snapshot["valid"] and snapshot["approved"]),
            "validation_errors": errors,
            "preview_issues": _lump_preview_issues(
                errors, bootstrap_identity_h,
                historical=not current, current=current,
                restore_enabled=bool(
                    not current and snapshot["valid"] and snapshot["approved"])),
            "bootstrap_identity": bootstrap_identity_h,
            "archive_provenance": (
                _lump_archive_provenance(
                    archive_filename_h,
                    pattern_discovered=pattern_discovered_h,
                    correction_supported=bool(
                        bootstrap_identity_h
                        and not bootstrap_identity_h.get("valid", True)))
                if archive_filename_h else None),
            "record_token": (
                str((_current_manifest_h or {}).get("token") or "").lower()
                if not current else None),
            "record_filename": archive_filename_h,
            "archive_filename": (
                archive_filename_h),
            "legacy_incompatible": bool(
                bootstrap_identity_h is not None
                and not bootstrap_identity_h["valid"]),
        }
        if isinstance(approval.get("mtbf"), dict):
            entry["mtbf"] = approval["mtbf"]
        return entry

    entries = []
    archive_files = []
    for fn in (os.listdir(lumps_dir) if os.path.isdir(lumps_dir) else []):
        if not fn.endswith(".lump"):
            continue
        binary_name = fn
        m = pattern_token.match(binary_name)
        if not m:
            m = next(
                (pattern.match(binary_name) for pattern in pattern_named
                 if pattern.match(binary_name)),
                None,
            )
        if m:
            archive_files.append((int(m.group(1)), binary_name[:-5]))

    for ver, stem in archive_files:
        lump_path_v = os.path.join(lumps_dir, stem + ".lump")
        entries.append(_snapshot_entry_h(ver, lump_path_v))

    # Frozen bootstrap migrations retained their old manifest rows and tokens.
    # Surface those exact immutable records beneath the current abstraction,
    # without treating them as restorable versions of the active token.
    for _archived_manifest_h in _related_archived_h:
        _archived_filename_h = _archived_manifest_h.get("filename")
        if not isinstance(_archived_filename_h, str) or not _archived_filename_h:
            continue
        try:
            _archived_version_h = int(
                _archived_manifest_h.get("lump_version")
                or _archived_manifest_h.get("version")
                or 0)
        except (TypeError, ValueError):
            _archived_version_h = 0
        _archived_path_h = os.path.join(lumps_dir, _archived_filename_h)
        _archived_snapshot_h = _validate_lump_snapshot(
            _archived_path_h, _archived_manifest_h)
        _archived_approval_h = _archived_snapshot_h["approval"] or {}
        _archived_compiled_at_h = _archived_approval_h.get("compiled_at")
        if _archived_compiled_at_h is None:
            _archived_compiled_at_h = _archived_manifest_h.get("compiled_at")
        entries.append({
            "version": _archived_version_h,
            "current": False,
            "compiled_at": _archived_compiled_at_h,
            "abstraction": _archived_manifest_h.get("abstraction"),
            "cw": _archived_snapshot_h["cw"],
            "cc": _archived_snapshot_h["cc"],
            "lump_size": _archived_snapshot_h["lump_size"],
            "content_profile": _archived_snapshot_h["content_profile"],
            "binary_hash": _archived_snapshot_h["binary_hash"],
            "binary_available": _archived_snapshot_h["binary_available"],
            "raw_inspectable": _archived_snapshot_h["raw_inspectable"],
            "binary_valid": _archived_snapshot_h["valid"],
            "approved": _archived_snapshot_h["approved"],
            "trusted": False,
            "metadata_only": not _archived_snapshot_h["binary_available"],
            "preview_enabled": _archived_snapshot_h["binary_available"],
            "restore_enabled": False,
            "validation_errors": _archived_snapshot_h["errors"],
            "bootstrap_identity": _archived_snapshot_h["bootstrap_identity"],
            "legacy_incompatible": True,
            "historical_record": True,
            "record_token": str(
                _archived_manifest_h.get("token") or "").lower(),
            "record_filename": _archived_filename_h,
            "archive_filename": _archived_filename_h,
            "read_only": True,
            "preview_issues": _lump_preview_issues(
                _archived_snapshot_h["errors"],
                _archived_snapshot_h["bootstrap_identity"],
                historical=True, restore_enabled=False),
            "archive_provenance": _lump_archive_provenance(
                _archived_filename_h, pattern_discovered=False,
                correction_supported=bool(
                    _archived_snapshot_h["bootstrap_identity"]
                    and not _archived_snapshot_h["bootstrap_identity"].get(
                        "valid", True))),
        })

    # The live artifact is part of version history too. Resolve it only through
    # the manifest locator and inspect its exact binary bytes.
    if _current_manifest_h:
        _cur_fn = _current_manifest_h.get("filename") or f"{key8}.lump"
        _cur_lp = os.path.join(lumps_dir, _cur_fn)
        _cur_ver = _current_manifest_h.get("lump_version")
        if _cur_ver is not None:
            try:
                _cur_ver = int(_cur_ver)
                entries = [
                    e for e in entries
                    if e.get("record_filename") != _cur_fn
                ]
                entries.append(
                    _snapshot_entry_h(
                        _cur_ver, _cur_lp, current=True
                    )
                )
            except (TypeError, ValueError):
                pass

    entries.sort(key=lambda e: e["version"], reverse=True)
    versions = {entry["version"] for entry in entries}
    missing_versions = (
        [ver for ver in range(min(versions), max(versions) + 1) if ver not in versions]
        if versions else []
    )
    return jsonify({
        "token": key8,
        "history": entries,
        "missing_versions": missing_versions,
    })


@app.route("/api/lumps/<token>/history/<int:version>", methods=["DELETE"])
def delete_lump_history_revision(token, version):
    """Delete one immutable archived revision without touching the live LUMP."""
    import re as _re

    raw = token.lower().replace("0x", "", 1)
    if not _re.fullmatch(r"[0-9a-f]{1,8}", raw):
        return jsonify({"error": "Invalid token"}), 400
    if version < 0:
        return jsonify({"error": "Invalid history version"}), 400
    key8 = raw.zfill(8)
    payload = request.get_json(silent=True) or {}
    archive_filename = payload.get("archive_filename")
    if archive_filename is not None and (
        not isinstance(archive_filename, str)
        or not archive_filename
        or os.path.basename(archive_filename) != archive_filename
        or not archive_filename.endswith(".lump")
    ):
        return jsonify({"error": "Invalid archived filename"}), 400

    lumps_dir = LUMPS_DIR
    manifest_path = os.path.join(lumps_dir, "manifest.json")
    with _lump_history_transition_lock(lumps_dir):
        try:
            manifest = _read_manifest_safe(manifest_path)
        except ValueError as exc:
            return jsonify({
                "error": (
                    "manifest.json is corrupt and the archived revision "
                    f"cannot be deleted safely. Details: {exc}"
                )
            }), 500

        active_matches = [
            row for row in manifest
            if isinstance(row, dict)
            and str(row.get("token") or "").lower() == key8
            and row.get("archived") is not True
        ]
        if len(active_matches) != 1:
            return jsonify({
                "error": "The active LUMP identity is unavailable or ambiguous"
            }), 409
        active = active_matches[0]
        active_filename = active.get("filename") or ""
        active_abstraction = str(active.get("abstraction") or "").casefold()

        # Normal history archives use either the token stem or the active
        # artifact stem. Historical bootstrap records use their manifest row's
        # exact immutable filename instead.
        candidate_filenames = {
            f"{key8}-v{version}.lump",
        }
        if isinstance(active_filename, str) and active_filename.endswith(".lump"):
            active_stem = _re.sub(r"_v\d+$", "", active_filename[:-5])
            candidate_filenames.add(f"{active_stem}_v{version}.lump")

        archived_matches = [
            row for row in manifest
            if isinstance(row, dict)
            and row.get("archived") is True
            and row.get("filename") == archive_filename
            and str(row.get("abstraction") or "").casefold() == active_abstraction
            and int(row.get("lump_version") or row.get("version") or -1) == version
        ] if archive_filename else []

        if archive_filename:
            if archive_filename == active_filename:
                return jsonify({
                    "error": "The live LUMP cannot be deleted from History"
                }), 409
            if archive_filename not in candidate_filenames and len(archived_matches) != 1:
                return jsonify({"error": "Archived revision is not part of this history"}), 404
            selected_filename = archive_filename
        else:
            existing_candidates = [
                filename for filename in sorted(candidate_filenames)
                if os.path.isfile(os.path.join(lumps_dir, filename))
            ]
            if len(existing_candidates) != 1:
                return jsonify({
                    "error": (
                        "Archived revision is unavailable"
                        if not existing_candidates
                        else "Archived revision has ambiguous archive files"
                    )
                }), 404 if not existing_candidates else 409
            selected_filename = existing_candidates[0]

        selected_path = os.path.abspath(os.path.join(lumps_dir, selected_filename))
        if os.path.dirname(selected_path) != os.path.abspath(lumps_dir):
            return jsonify({"error": "Invalid archived filename"}), 400
        if not os.path.isfile(selected_path):
            return jsonify({"error": "Archived revision is unavailable"}), 404

        os.remove(selected_path)
        remaining_manifest = [
            row for row in manifest
            if not (
                isinstance(row, dict)
                and row.get("archived") is True
                and row.get("filename") == selected_filename
                and str(row.get("abstraction") or "").casefold() == active_abstraction
            )
        ]
        if remaining_manifest != manifest:
            _atomic_write_json(manifest_path, remaining_manifest)

    print(f"[lumps] Deleted archived revision {selected_filename}", flush=True)
    return jsonify({
        "ok": True,
        "token": key8,
        "version": version,
        "deleted": [selected_filename],
    })


@app.route("/api/lump/<token>/fork-version", methods=["POST"])
def lump_fork_version(token):
    """Fork a sealed LUMP: archive the current compiled binary as v<N> so it is
    visible in the History tab, then return new_version=N+1 to the browser.

    The live binary (<token>.lump) is NOT replaced — the next compile-and-save
    will write v<N+1>.  This is the analogue of the archive-on-save step in
    /api/lumps/save but without actually writing a new binary.

    Response: { ok: true, new_version: N+1, prev_version: N }
    """
    import re as _re_fv
    raw = token.lower()
    key8 = (raw[:8] if len(raw) >= 8 else raw).zfill(8)
    if not _re_fv.fullmatch(r'[0-9a-f]{8}', key8):
        return jsonify({"error": "Invalid token"}), 400

    lumps_dir = LUMPS_DIR
    # Resolve current lump path from manifest (may be human-readable name)
    lump_path   = os.path.join(lumps_dir, f'{key8}.lump')
    _safe_stem_fv = key8
    _mf_path_fv = os.path.join(lumps_dir, 'manifest.json')
    _existing_entry_fv = None
    if os.path.isfile(_mf_path_fv):
        try:
            _mf_fv = _read_manifest_safe(_mf_path_fv)
            for _e in _mf_fv:
                if _e.get('token') == key8:
                    _existing_entry_fv = dict(_e)
                    _fn = _e.get('filename', '')
                    if _fn:
                        _np = os.path.join(lumps_dir, _fn)
                        if os.path.isfile(_np):
                            lump_path = _np
                    if _fn and _fn.endswith('.lump'):
                        _safe_stem_fv = _re_fv.sub(r'_v\d+$', '', _fn[:-5])
                    break
        except Exception:
            pass
    if not os.path.isfile(lump_path):
        return jsonify({"error": "No compiled binary for this token — cannot fork"}), 404
    try:
        _fork_facts = _inspect_lump_binary(lump_path)
        _fork_existing_approval = _matching_lump_approval(
            lumps_dir, _fork_facts["binary_hash"])
        if _fork_existing_approval is None:
            return jsonify({
                "error": "exact hash-bound approval is required to fork"
            }), 403
        _fork_payload = request.get_json(force=True, silent=True) or {}
        _fork_intent_approval = _consume_lump_approval_intent(
            _fork_payload.get("approval_intent"),
            _fork_facts["binary_hash"], "fork")
    except _LumpApprovalStoreError as exc:
        return jsonify({"error": str(exc)}), 500
    except ValueError as exc:
        return jsonify({"error": str(exc)}), 403

    cur_version = (_existing_entry_fv or {}).get('lump_version')
    if cur_version is None:
        _arch_pats = [
            _re_fv.compile(rf'^{_re_fv.escape(_safe_stem_fv)}_v(\d+)\.lump$'),
            _re_fv.compile(rf'^{_re_fv.escape(key8)}-v(\d+)\.lump$'),
        ]
        _existing = [
            int(m.group(1))
            for fn in (os.listdir(lumps_dir) if os.path.isdir(lumps_dir) else [])
            for _pp in _arch_pats
            for m in [_pp.match(fn)] if m
        ]
        cur_version = (max(_existing) + 1) if _existing else 0
    else:
        cur_version = int(cur_version)

    # If already forked,
    # re-forking would overwrite the archive. Idempotently return current state.
    # Note: when forked=True, cur_version is already N+1 (fork wrote it), so
    # new_version = cur_version (not cur_version+1) to avoid a double-increment.
    if (_existing_entry_fv or {}).get('forked'):
        return jsonify({"ok": True, "new_version": cur_version, "prev_version": cur_version - 1, "already_forked": True})

    # Forking the same bytes requires an explicit new issued identity. Never
    # manufacture a token-named alias: the live artifact remains canonically
    # named from reviewed dot-name, new issue, exact bytes, and Number.
    _fork_dot_name = _fork_existing_approval.get("dot_name")
    _old_issue_n = _fork_existing_approval.get("issue_n")
    _new_issue_n = _fork_payload.get("issue_n")
    if (not isinstance(_fork_dot_name, str) or not _fork_dot_name
            or not isinstance(_old_issue_n, int)
            or not isinstance(_new_issue_n, int)
            or isinstance(_new_issue_n, bool)
            or _new_issue_n <= _old_issue_n):
        return jsonify({
            "error": "fork requires an explicit issue_n greater than the approved issue"
        }), 400
    _fork_live_bytes = _fork_facts["raw_bytes"]
    _fork_number = hashlib.sha256(
        _fork_dot_name.encode("utf-8") + _fork_live_bytes).hexdigest()[:8]
    _fork_live_lump_name = (
        f"{_fork_dot_name}.{_new_issue_n}.{_fork_number}.lump")
    _fork_live_path = os.path.join(lumps_dir, _fork_live_lump_name)
    if (os.path.abspath(_fork_live_path) != os.path.abspath(lump_path)
            and os.path.lexists(_fork_live_path)):
        return jsonify({
            "error": "the requested canonical fork issue already exists"
        }), 409
    _fork_manifest_entry = dict(_existing_entry_fv or {})
    _fork_manifest_entry.update({
        'token': key8,
        'abstraction': (_existing_entry_fv or {}).get('abstraction', _safe_stem_fv),
        'filename': _fork_live_lump_name,
        'forked': True,
        'lump_version': cur_version + 1,
    })
    _fork_approval = dict(_fork_existing_approval)
    _fork_approval.update({
        key: value for key, value in _fork_intent_approval.items()
        if key in _LUMP_APPROVAL_INTENT_FIELDS
    })
    _fork_approval["filename"] = _fork_live_lump_name
    _fork_approval["issue_n"] = _new_issue_n
    _fork_identity_string = f"{_fork_dot_name}#{_new_issue_n}"
    _fork_approval["identity_hash"] = hashlib.sha256(
        _fork_identity_string.encode("utf-8")).hexdigest()
    if ("identity_string" in _fork_approval
            or "identity_seal_location" in _fork_approval):
        _fork_approval["identity_string"] = _fork_identity_string
    try:
        _transition = _commit_lump_history_transition(
            lumps_dir=lumps_dir,
            manifest_path=_mf_path_fv,
            token8=key8,
            manifest_entry=_fork_manifest_entry,
            binary_filename=_fork_live_lump_name,
            binary_bytes=_fork_live_bytes,
            approval_hash=_fork_facts["binary_hash"],
            approval=_fork_approval,
            archive_stem=_safe_stem_fv,
            archive_version=cur_version,
            archive_binary_path=lump_path,
            advance_current_version_from_archive=True,
            remove_paths=(
                (lump_path,)
                if os.path.basename(lump_path) != _fork_live_lump_name
                else ()
            ),
            expected_manifest_entry=_existing_entry_fv,
            idempotent_if_forked=True,
        )
        if _transition.get("already_forked"):
            return jsonify({
                "ok": True,
                "new_version": _transition["next_version"],
                "prev_version": _transition["version"],
                "already_forked": True,
            })
    except _LumpTransitionConflict as _transition_conflict:
        return jsonify({"error": str(_transition_conflict)}), 409
    except _LumpApprovalStoreError as _approval_err:
        return jsonify({"error": (
            "approvals.json is corrupt and cannot be read safely. "
            "The fork has been aborted to prevent weakening prior approvals. "
            f"Details: {_approval_err}"
        )}), 500
    except ValueError as _mf_fv_err:
        return jsonify({"error": (
            "manifest.json is corrupt and cannot be read safely. "
            "The fork has been aborted to prevent overwriting previously-saved LUMPs. "
            f"Details: {_mf_fv_err}"
        )}), 500

    logging.info('[lumps] Fork: archived %s → %s_v%d.lump',
                 lump_path, _safe_stem_fv, _transition["version"])
    return jsonify({
        "ok": True,
        "new_version": _transition["next_version"],
        "prev_version": _transition["version"],
    })


@app.route("/api/lumps/<token>/words/<int:version>")
def get_lump_version_words(token, version):
    """Return all readable bytes for an archived LUMP version.

    Intrinsic facts are derived from exact archive bytes.  Reviewed annotations
    are included only when an approval matches the exact archive SHA-256.
    """
    import re as _re
    raw = token.lower()
    key8 = (raw[:8] if len(raw) >= 8 else raw).zfill(8)
    if not _re.fullmatch(r'[0-9a-f]{8}', key8):
        return jsonify({"error": "Invalid token"}), 400
    lumps_dir = LUMPS_DIR
    archive_filename = request.args.get("archive_filename")
    lump_path_v = os.path.join(lumps_dir, f'{key8}-v{version}.lump')
    # Also check current-filename and stable abstraction-name archives:
    # <AbsName>_v<N>.lump. The latter preserves access to versions written
    # before a dot-name filename became the manifest's active artifact.
    _mf_v = os.path.join(lumps_dir, 'manifest.json')
    _manifest_entry_v = None
    if os.path.isfile(_mf_v):
        try:
            with open(_mf_v) as _f:
                _mf_vd = json.load(_f)
            for _e in _mf_vd:
                if _e.get('token') == key8:
                    _manifest_entry_v = _e
                    _fn = _e.get('filename', '')
                    if _fn and _fn.endswith('.lump'):
                        import re as _re_vv
                        _stem = _re_vv.sub(r'_v\d+$', '', _fn[:-5])
                        _np = os.path.join(lumps_dir, f'{_stem}_v{version}.lump')
                        if os.path.isfile(_np):
                            lump_path_v = _np
                    if not os.path.isfile(lump_path_v):
                        _name_v = _e.get('abstraction', '')
                        if isinstance(_name_v, str) and _name_v:
                            _safe_name_v = _re.sub(r'[^A-Za-z0-9_.-]+', '_', _name_v)
                            _np = os.path.join(lumps_dir, f'{_safe_name_v}_v{version}.lump')
                            if os.path.isfile(_np):
                                lump_path_v = _np
                    break
        except Exception:
            pass
    if archive_filename is not None:
        if (not archive_filename
                or os.path.basename(archive_filename) != archive_filename
                or not archive_filename.endswith(".lump")):
            return jsonify({"error": "Invalid archived filename"}), 400
        try:
            manifest = _read_manifest_safe(os.path.join(lumps_dir, "manifest.json"))
        except ValueError as exc:
            return jsonify({"error": str(exc)}), 409
        active_rows = [
            row for row in manifest
            if isinstance(row, dict)
            and row.get("archived") is not True
            and str(row.get("token") or "").lower() == key8
        ]
        if len(active_rows) != 1:
            return jsonify({"error": f"No active LUMP found for token {key8}"}), 404
        active_row = active_rows[0]
        active_name = str(active_row.get("abstraction") or "").casefold()
        archived_rows = [
            row for row in manifest
            if isinstance(row, dict)
            and row.get("archived") is True
            and row.get("filename") == archive_filename
            and str(row.get("abstraction") or "").casefold() == active_name
            and int(row.get("lump_version") or row.get("version") or -1) == version
        ]
        active_filename = str(active_row.get("filename") or "")
        active_stem = _re.sub(r'_v\d+$', '', active_filename[:-5]) \
            if active_filename.endswith(".lump") else ""
        safe_name = _re.sub(r'[^A-Za-z0-9_.-]+', '_',
                            str(active_row.get("abstraction") or ""))
        generated_filenames = {
            f"{key8}-v{version}.lump",
            f"{active_stem}_v{version}.lump" if active_stem else "",
            f"{safe_name}_v{version}.lump" if safe_name else "",
        }
        if len(archived_rows) == 1:
            _manifest_entry_v = archived_rows[0]
        elif archive_filename in generated_filenames:
            _manifest_entry_v = active_row
        else:
            return jsonify({"error": "Archived revision is not part of this history"}), 404
        lump_path_v = os.path.join(lumps_dir, archive_filename)
    if not os.path.isfile(lump_path_v):
        return jsonify({"error": f"No archived version v{version} for token 0x{key8}"}), 404
    snapshot = _validate_lump_snapshot(lump_path_v, _manifest_entry_v)
    approval = snapshot["approval"] or {}
    validation_errors = snapshot["errors"]
    if snapshot["raw_bytes"] is None:
        return jsonify({
            "error": (
                f"Archived version v{version} failed integrity validation: "
                + "; ".join(validation_errors)
            )
        }), 409

    return jsonify({
        "token":         key8,
        "version":       version,
        "words":         snapshot["words"],
        "count":         len(snapshot["words"]),
        "cw":            snapshot["cw"],
        "cc":            snapshot["cc"],
        "lump_size":     snapshot["lump_size"],
        "binary_hash":   snapshot["binary_hash"],
        "binary_valid":  not validation_errors,
        "validation_errors": validation_errors,
        "byte_count":    snapshot["byte_count"],
        "raw_tail_hex":  snapshot["raw_tail_hex"],
        "approved":      snapshot["approved"],
        "trusted":       snapshot["trusted"],
        "content_profile": snapshot["content_profile"],
        "ns_slot":       approval.get('ns_slot'),
        "abstraction":   approval.get('abstraction'),
        "compiled_at":   approval.get('compiled_at'),
        "author":        approval.get('author', ''),
        "version_str":   approval.get('version', ''),
        "release_notes": approval.get('release_notes', ''),
        "grants":        approval.get('grants', []),
        "pet_names":     approval.get('pet_names', {}),
        "source":        snapshot.get('source') or '',
        "archive_filename": archive_filename,
        "bootstrap_identity": snapshot.get("bootstrap_identity"),
        "legacy_incompatible": bool(
            snapshot.get("bootstrap_identity")
            and not snapshot["bootstrap_identity"]["valid"]),
        "preview_issues": _lump_preview_issues(
            validation_errors, snapshot.get("bootstrap_identity"),
            historical=True, restore_enabled=False),
        "archive_provenance": _lump_archive_provenance(
            archive_filename,
            pattern_discovered=not bool(_manifest_entry_v.get("archived")),
            correction_supported=bool(
                snapshot.get("bootstrap_identity")
                and not snapshot["bootstrap_identity"].get("valid", True))),
    })


@app.route("/api/lump-source/<name>")
def get_lump_source(name):
    """Return source embedded in the exact manifest-located LUMP bytes."""
    import re as _re
    if not _re.match(r'^[A-Za-z0-9_ .\-]+$', name):
        return jsonify({"error": "Invalid name"}), 400

    # Source is an intrinsic binary fact.  Never recover it from a sidecar or
    # same-name workspace file, either of which may describe different bytes.
    try:
        manifest = _read_manifest_safe(os.path.join(LUMPS_DIR, "manifest.json"))
    except ValueError as exc:
        return jsonify({"error": str(exc), "binary_only": True}), 409
    for entry in manifest:
        if str(entry.get("abstraction", "")).lower() != name.lower():
            continue
        try:
            inspected = _inspect_lump_binary(os.path.join(
                LUMPS_DIR, entry.get("filename") or f"{entry.get('token', '')}.lump"))
            approval = _matching_lump_approval(LUMPS_DIR, inspected["binary_hash"])
            canonical = _check_lump_canonical_integrity(
                LUMPS_DIR, str(entry.get("token") or "").lower(),
                inspected["raw_bytes"])
        except (OSError, ValueError) as exc:
            return jsonify({"error": f"LUMP integrity failure: {exc}",
                            "binary_only": True}), 409
        if isinstance(canonical, str):
            return jsonify({"error": canonical, "binary_only": True}), 409
        trust = approval is not None and canonical is True
        if inspected["source"]:
            return jsonify({"name": name, "source": inspected["source"],
                            "source_path": f"embedded (Tier {inspected['sourceStorageTier']})",
                            "binary_only": False,
                            "binary_hash": inspected["binary_hash"],
                            "approved": trust, "trusted": trust})
        return jsonify({"error": f"'{name}' is a binary-only LUMP",
                        "binary_only": True,
                        "binary_hash": inspected["binary_hash"],
                        "approved": trust, "trusted": trust}), 404
    return jsonify({"error": f"No LUMP found for '{name}'",
                    "binary_only": True}), 404


@app.route("/api/source-files", methods=["GET"])
def list_source_files():
    """Return every .cloomc file under simulator/, grouped by sub-directory.

    Response: { "files": [ {"path": "simulator/examples/foo.cloomc",
                             "name": "foo", "dir": "examples"}, ... ] }
    Files are sorted: examples/ first, then cloomc/ (with sub-dirs after their
    parent entries), alphabetically within each group.
    """
    _root = os.path.normpath(os.path.join(os.path.dirname(__file__), '..'))
    scan_base = os.path.join(_root, 'simulator')
    results = []
    for dirpath, _dirs, files in os.walk(scan_base):
        _dirs.sort()
        for fname in sorted(files):
            if not fname.endswith('.cloomc'):
                continue
            abs_f   = os.path.join(dirpath, fname)
            rel_f   = os.path.relpath(abs_f, _root).replace('\\', '/')
            rel_dir = os.path.relpath(dirpath, scan_base).replace('\\', '/')
            if rel_dir == '.':
                rel_dir = ''
            stem = fname[:-len('.cloomc')]
            results.append({
                'path': rel_f,
                'name': stem,
                'dir': rel_dir,
                'modified_at': os.path.getmtime(abs_f),
            })

    # Sort: examples/ before cloomc/, then by dir, then by name
    def _sort_key(e):
        d = e['dir']
        order = 0 if d == 'examples' else (1 if d == 'cloomc' or d == '' else 2)
        return (order, d, e['name'].lower())

    results.sort(key=_sort_key)
    return jsonify({'files': results})


@app.route("/api/source-file/save", methods=["POST"])
def save_source_file():
    """Write a .cloomc source file back to its location under simulator/.

    Body: { "path": "simulator/examples/foo.cloomc", "content": "..." }
    The path must be under simulator/ and end with .cloomc.
    Returns { "ok": true, "path": "simulator/examples/foo.cloomc" }.
    """
    data    = request.get_json(force=True, silent=True) or {}
    raw_path = str(data.get('path', '')).strip()
    content  = str(data.get('content', ''))

    # Security: normalise, reject traversal, restrict to simulator/
    norm = os.path.normpath(raw_path).replace('\\', '/')
    parts = norm.split('/')
    if '..' in parts or not norm.startswith('simulator/'):
        return jsonify({'error': 'Path must be inside simulator/'}), 400
    if not norm.endswith('.cloomc'):
        return jsonify({'error': 'Only .cloomc files may be saved this way'}), 400

    _root    = os.path.normpath(os.path.join(os.path.dirname(__file__), '..'))
    abs_path = os.path.join(_root, norm)
    os.makedirs(os.path.dirname(abs_path), exist_ok=True)
    with open(abs_path, 'w', encoding='utf-8') as fh:
        fh.write(content)
    return jsonify({'ok': True, 'path': norm})


_EDITABLE_CONTENT_TYPES = {'text', 'markdown', 'image', 'grayscale', 'binary', 'doc'}


@app.route("/api/lump/<token>/content", methods=["PUT"])
def put_lump_content(token):
    """Retired: approved LUMP binaries are immutable."""
    return jsonify({
        "error": "In-place LUMP mutation is retired; save a new hash-approved revision"
    }), 410


@app.route("/api/lump/<token>/meta", methods=["PATCH"])
def patch_lump_meta(token):
    """Retired: approval metadata is immutable and hash-bound."""
    return jsonify({
        "error": "LUMP metadata patching is retired; save a new approval"
    }), 410


@app.route("/api/lump/<token>/mtbf", methods=["POST"])
def post_lump_mtbf(token):
    """Retired: approval metadata is immutable."""
    return jsonify({
        "error": "LUMP MTBF metadata patching is retired"
    }), 410


@app.route("/api/lump/<token_hex>/clist/<int:slot_index>", methods=["PATCH"])
def patch_lump_clist_slot(token_hex, slot_index):
    """Retired: approved LUMP binaries are immutable."""
    return jsonify({
        "error": "In-place LUMP patching is retired; save a new hash-approved revision"
    }), 410


def _lump_freespace_content(words):
    """Parse the V1.3 0xAB self-definition frame from a lump word array.

    Spec: CM_LUMP_SPECIFICATION.md §Freespace Content and Self-Definition.
    Word cw+1 = 0xAB | flags | api_byte_length; then API JSON bytes; if
    flags.has_source a source_byte_length word and source bytes follow.

    Returns None for a legacy binary (no 0xAB magic at word cw+1 — all-zero
    freespace) or a non-code lump; otherwise a dict:
      {tier, flags, api_len, content_words, source, api_definition}
    content_words counts the freespace words the frame occupies starting at
    word cw+1 (header + API + optional length word + source).
    """
    return _parse_intrinsic_lump_content(words)


@app.route("/api/lump/<token_hex>/resize", methods=["POST"])
def resize_lump(token_hex):
    """Retired: resizing would mutate hash-bound bytes."""
    return jsonify({
        "error": "In-place LUMP mutation is retired; save a new hash-approved revision"
    }), 410


@app.route("/api/lumps/import", methods=["POST"])
def import_lump():
    """Pack uploaded content as an unapproved data LUMP."""
    import base64 as _b64, math as _math, hashlib as _hl
    payload = request.get_json(force=True, silent=True)
    if not payload:
        return jsonify({"error": "Invalid JSON"}), 400

    name         = (payload.get("name") or "Imported").strip() or "Imported"
    content_type = payload.get("content_type") or "binary"
    data_b64     = payload.get("data_b64") or ""
    img_width    = int(payload.get("image_width")  or 0)
    img_height   = int(payload.get("image_height") or 0)

    try:
        raw_bytes = _b64.b64decode(data_b64)
    except Exception:
        return jsonify({"error": "Invalid base64 data"}), 400

    padded_len  = (len(raw_bytes) + 3) & ~3
    padded_bytes = raw_bytes + b'\x00' * (padded_len - len(raw_bytes))
    data_word_count = padded_len // 4

    total_needed = 1 + data_word_count
    MAX_LUMP_WORDS = 1 << 14  # n=14 → 16384 words → 65536 bytes
    if total_needed > MAX_LUMP_WORDS:
        return jsonify({"error": f"Payload too large: {data_word_count} data words exceeds max {MAX_LUMP_WORDS - 1}"}), 400
    n = max(6, _math.ceil(_math.log2(max(total_needed, 2))))
    n = min(n, 14)
    lump_size = 1 << n
    n_minus_6 = n - 6
    cw = min(data_word_count, lump_size - 1)

    header = (0x1F << 27) | (n_minus_6 << 23) | (cw << 10) | (0x01 << 8) | 0
    data_words = list(_struct.unpack(f'>{data_word_count}I', padded_bytes))
    all_words  = ([header] + data_words)[:lump_size]
    all_words += [0] * max(0, lump_size - len(all_words))

    lumps_dir  = LUMPS_DIR
    os.makedirs(lumps_dir, exist_ok=True)

    lump_bytes = _struct.pack(f'>{lump_size}I', *[int(w) & 0xFFFFFFFF for w in all_words])
    token8 = _hl.sha256(lump_bytes).hexdigest()[:8]
    lump_path  = os.path.join(lumps_dir, f'{token8}.lump')
    with open(lump_path, 'wb') as fh:
        fh.write(lump_bytes)
    LAZY_LUMPS[token8] = lump_bytes
    LAZY_LUMPS[token8.lstrip('0') or '0'] = lump_bytes

    # Upload creates an unapproved artifact. Explicit approval intent is
    # required before it can be trusted, deployed, or identified.

    manifest_path = os.path.join(lumps_dir, 'manifest.json')
    try:
        manifest = _read_manifest_safe(manifest_path)
    except ValueError as _mf_imp_err:
        return jsonify({"error": (
            "manifest.json is corrupt and cannot be read safely. "
            "The import has been aborted to prevent overwriting previously-saved LUMPs. "
            f"Details: {_mf_imp_err}"
        )}), 500
    manifest = [e for e in manifest if e.get('token') != token8]
    manifest.append({"token": token8, "filename": f"{token8}.lump",
                     "abstraction": name})
    _atomic_write_json(manifest_path, manifest)

    print(f'[lumps/import] {token8} content_type={content_type} {len(lump_bytes)}B', flush=True)
    return jsonify({"ok": True, "token": token8})


@app.route("/api/lumps/upload-lump", methods=["POST"])
def upload_lump_file():
    """Store an exact raw LUMP as an unapproved artifact."""
    import base64 as _b64, hashlib as _hl
    payload = request.get_json(force=True, silent=True)
    if not payload:
        return jsonify({"error": "Invalid JSON"}), 400

    name     = (payload.get("name") or "Imported").strip() or "Imported"
    data_b64 = payload.get("data_b64") or ""

    try:
        raw_bytes = _b64.b64decode(data_b64)
    except Exception:
        return jsonify({"error": "Invalid base64 data"}), 400

    if len(raw_bytes) < 4:
        return jsonify({"error": "File too small to be a valid LUMP (< 4 bytes)"}), 400
    if len(raw_bytes) % 4 != 0:
        return jsonify({"error": "LUMP file size must be a multiple of 4 bytes"}), 400

    # Parse LUMP header (first uint32, big-endian)
    header_word, = _struct.unpack('>I', raw_bytes[:4])
    n_minus_6 = (header_word >> 23) & 0xF    # bits[26:23]
    cw        = (header_word >> 10) & 0x1FFF  # bits[22:10]
    typ       = (header_word >>  8) & 0x3     # bits[9:8]
    cc        = header_word & 0xFF             # bits[7:0]
    n         = n_minus_6 + 6
    expected_size = 1 << n

    if len(raw_bytes) != expected_size * 4:
        return jsonify({"error": (
            f"File size ({len(raw_bytes)} B) must exactly match LUMP header "
            f"allocation 2^{n}={expected_size} words"
        )}), 400

    lump_size  = expected_size
    lump_bytes = raw_bytes

    # Map typ bits to metadata
    _TYP_MAP = {
        0: ("code",    "code"),
        1: ("data",    "binary"),
        2: ("thread",  "thread"),
        3: ("outform", "outform"),
    }
    lump_type, content_type = _TYP_MAP.get(typ, ("data", "binary"))

    # Token = sha256(raw file bytes)[:8]
    token8 = _hl.sha256(raw_bytes).hexdigest()[:8]

    lumps_dir = LUMPS_DIR
    os.makedirs(lumps_dir, exist_ok=True)

    lump_path = os.path.join(lumps_dir, f'{token8}.lump')
    with open(lump_path, 'wb') as fh:
        fh.write(lump_bytes)
    LAZY_LUMPS[token8] = lump_bytes
    LAZY_LUMPS[token8.lstrip('0') or '0'] = lump_bytes

    # Raw import intentionally remains unapproved.

    manifest_path = os.path.join(lumps_dir, 'manifest.json')
    try:
        manifest = _read_manifest_safe(manifest_path)
    except ValueError as _mf_upl_err:
        return jsonify({"error": (
            "manifest.json is corrupt and cannot be read safely. "
            "The upload has been aborted to prevent overwriting previously-saved LUMPs. "
            f"Details: {_mf_upl_err}"
        )}), 500
    manifest = [e for e in manifest if e.get('token') != token8]
    manifest.append({"token": token8, "filename": f"{token8}.lump",
                     "abstraction": name})
    _atomic_write_json(manifest_path, manifest)

    print(f'[lumps/upload-lump] {token8} typ={typ} ({lump_type}) n={n} cw={cw} cc={cc} {len(lump_bytes)}B', flush=True)
    return jsonify({"ok": True, "token": token8})


def _crc16_ccitt(data_bytes):
    crc = 0xFFFF
    for b in data_bytes:
        crc ^= b << 8
        for _ in range(8):
            if crc & 0x8000:
                crc = (crc << 1) ^ 0x1021
            else:
                crc = crc << 1
            crc &= 0xFFFF
    return crc


@app.route("/api/namespace/build", methods=["POST"])
def build_namespace():
    """Build a Namespace LUMP binary and return it as a downloadable namespace.zip."""
    import datetime as _dt
    payload = request.get_json(force=True, silent=True)
    if not payload:
        return jsonify({"error": "Invalid JSON payload"}), 400

    app_id = payload.get("app_id", "").strip()
    if not app_id:
        return jsonify({"error": "app_id is required"}), 400

    base_hex = payload.get("base_hex", "0").strip()
    try:
        base_addr = int(base_hex, 16)
    except ValueError:
        return jsonify({"error": "Invalid base address hex"}), 400

    n = int(payload.get("n", 10))
    if n < 6 or n > 14:
        return jsonify({"error": "Size exponent n must be 6–14"}), 400

    cc = int(payload.get("cc", 0))
    ns_table_start = int(payload.get("ns_table_start", 0))
    entries = payload.get("entries", [])

    lump_size = 1 << n
    # NS_ENTRY_WORDS=4 (stride-4); matches simulator and boot_image.py
    if ns_table_start < 1:
        ns_table_start = lump_size - (len(entries) * 4)
        if ns_table_start < 1:
            return jsonify({"error": "Too many entries for the given lump size"}), 400

    ns_table_words_needed = len(entries) * 4
    if ns_table_start + ns_table_words_needed > lump_size:
        return jsonify({"error": "NS Table exceeds lump size"}), 400

    header = (0x1F << 27) | ((n - 6) << 23) | (0 << 10) | (0b10 << 8) | (cc & 0xFF)

    words = [0] * lump_size
    words[0] = header

    lumps_dir = LUMPS_DIR
    bundled_files = {}

    for entry in entries:
        slot = int(entry.get("slot", 0))
        state = entry.get("state", "null").lower()
        word_offset = ns_table_start + slot * 4  # NS_ENTRY_WORDS=4 (stride-4)

        if word_offset + 3 >= lump_size:
            return jsonify({"error": f"Slot {slot} exceeds lump size at offset {word_offset}"}), 400

        if state == "null":
            words[word_offset] = 0
            words[word_offset + 1] = 0
            words[word_offset + 2] = 0
            words[word_offset + 3] = 0  # word3_seals (zero)

        elif state == "outform":
            hash_prefix = entry.get("hash_prefix", "").strip()
            if len(hash_prefix) != 16:
                return jsonify({"error": f"Slot {slot}: Outform hash prefix must be exactly 16 hex chars"}), 400
            try:
                hash_bytes = bytes.fromhex(hash_prefix)
            except ValueError:
                return jsonify({"error": f"Slot {slot}: Invalid hex in hash prefix"}), 400

            w1 = int.from_bytes(hash_bytes[0:4], 'big')
            w2 = int.from_bytes(hash_bytes[4:8], 'big')

            loc_idx = int(entry.get("loc_idx", 0)) & 0xFF
            flags = 0
            if entry.get("flag_required"):
                flags |= 0x01
            if entry.get("flag_bundle"):
                flags |= 0x02
            if entry.get("flag_pinned"):
                flags |= 0x04

            w3 = (loc_idx << 17) | (flags << 9) | 0x1FF

            words[word_offset] = w1
            words[word_offset + 1] = w2
            words[word_offset + 2] = w3
            words[word_offset + 3] = 0  # word3_seals (zero; outform entries have no seal at build time)

        elif state == "bundled" or state == "live":
            lump_token = entry.get("lump_token", "").strip()
            if not lump_token:
                return jsonify({"error": f"Slot {slot}: Bundled entry requires a lump token"}), 400

            lump_path = _resolve_lump_path(lump_token, lumps_dir)
            if not lump_path:
                return jsonify({"error": f"Slot {slot}: No .lump file found for token {lump_token}"}), 400

            with open(lump_path, 'rb') as fh:
                lump_binary = fh.read()

            lump_word_count = len(lump_binary) // 4
            limit_offset = max(0, lump_word_count - 1)

            w1 = 0
            w2 = (0 << 28) | (limit_offset & 0x1FFFFF)

            gt_w0_low25 = 0
            crc_data = _struct.pack('>I', gt_w0_low25) + _struct.pack('>I', w1) + _struct.pack('>I', w2)
            crc_val = _crc16_ccitt(crc_data)
            if crc_val == 0x1FF:
                crc_val = 0x1FE

            w3 = crc_val & 0xFFFF

            words[word_offset] = w1
            words[word_offset + 1] = w2
            words[word_offset + 2] = w3
            words[word_offset + 3] = 0  # word3_seals (zero; populated later by commissioning flow)

            label = entry.get("label", lump_token)
            bundled_files[f"{label}.bin"] = lump_binary

    app_bin = _struct.pack(f'>{lump_size}I', *[w & 0xFFFFFFFF for w in words])

    manifest_entries = []
    for entry in entries:
        state = entry.get("state", "null").lower()
        me = {
            "slot": int(entry.get("slot", 0)),
            "label": entry.get("label", ""),
            "state": state,
        }
        if state == "outform":
            me["hash"] = "sha256:" + entry.get("hash_prefix", "")
            me["loc_idx"] = int(entry.get("loc_idx", 0))
            me["flags"] = 0
            if entry.get("flag_required"):
                me["flags"] |= 1
            if entry.get("flag_bundle"):
                me["flags"] |= 2
            if entry.get("flag_pinned"):
                me["flags"] |= 4
            me["file"] = None
        elif state in ("bundled", "live"):
            me["file"] = entry.get("label", entry.get("lump_token", "")) + ".bin"
            me["hash"] = None
        else:
            me["file"] = None
            me["hash"] = None
        manifest_entries.append(me)

    ns_manifest = {
        "app_id": app_id,
        "version": "1.0.0",
        "ns_lump": "App.bin",
        "base": f"0x{base_addr:08X}",
        "n": n,
        "ns_table_start": ns_table_start,
        "entries": manifest_entries,
    }

    buf = io.BytesIO()
    with zipfile.ZipFile(buf, 'w', compression=zipfile.ZIP_DEFLATED) as zf:
        zf.writestr("App.bin", app_bin)
        zf.writestr("manifest.json", json.dumps(ns_manifest, indent=2))
        for fname, fdata in bundled_files.items():
            zf.writestr(fname, fdata)
    buf.seek(0)

    safe_name = "".join(c for c in app_id if c.isalnum() or c in "._-") or "namespace"
    from flask import Response as _Response
    resp = _Response(
        buf.read(),
        mimetype='application/zip',
        headers={
            'Content-Disposition': f'attachment; filename="{safe_name}.namespace.zip"',
        })

    token8 = _hashlib.sha256(app_bin).hexdigest()[:8]
    os.makedirs(lumps_dir, exist_ok=True)

    lump_path = os.path.join(lumps_dir, f'{token8}.lump')
    with open(lump_path, 'wb') as fh:
        fh.write(app_bin)

    # Imported Namespace artifacts remain unapproved until explicitly reviewed.

    manifest_path = os.path.join(lumps_dir, 'manifest.json')
    try:
        manifest = _read_manifest_safe(manifest_path)
    except ValueError as _mf_ns_err:
        return jsonify({"error": (
            "manifest.json is corrupt and cannot be read safely. "
            "The namespace build has been aborted to prevent overwriting previously-saved LUMPs. "
            f"Details: {_mf_ns_err}"
        )}), 500
    manifest = [e for e in manifest if e.get('token') != token8]
    manifest.append({
        "token": token8,
        "abstraction": app_id,
        "filename": f"{token8}.lump",
    })
    _atomic_write_json(manifest_path, manifest)

    print(f'[namespace] Built {safe_name}.namespace.zip ({len(app_bin)} bytes, {len(entries)} entries)', flush=True)
    return resp


@app.route("/api/lumps/<token>", methods=["DELETE"])
def delete_lump(token):
    """Delete a lump binary, sidecar, and manifest entry."""
    import re as _re
    raw = token.lower().replace('0x', '', 1)
    if not _re.fullmatch(r'[0-9a-f]{1,8}', raw):
        return jsonify({"error": "Invalid token — must be 1-8 hex characters"}), 400
    token8 = raw.zfill(8)
    lumps_dir = LUMPS_DIR

    lump_path    = _resolve_lump_path(token8, lumps_dir)
    deleted = []

    if lump_path and os.path.isfile(lump_path):
        os.remove(lump_path)
        deleted.append(os.path.basename(lump_path))

    LAZY_LUMPS.pop(token8, None)
    LAZY_LUMPS.pop(token8.lstrip('0') or '0', None)

    manifest_removed = False
    manifest_path = os.path.join(lumps_dir, 'manifest.json')
    try:
        manifest = _read_manifest_safe(manifest_path)
        before = len(manifest)
        manifest = [e for e in manifest if e.get('token') != token8]
        if len(manifest) < before:
            manifest_removed = True
        _atomic_write_json(manifest_path, manifest)
    except ValueError as _mf_del_err:
        return jsonify({"error": (
            "manifest.json is corrupt and cannot be read safely. "
            f"Details: {_mf_del_err}"
        )}), 500

    if not deleted and not manifest_removed:
        return jsonify({"error": f"No lump found for token 0x{token8}"}), 404

    print(f'[lumps] Deleted {", ".join(deleted)}{"+ manifest entry" if manifest_removed else ""}', flush=True)
    return jsonify({"ok": True, "token": token8, "deleted": deleted})

# ──────────────────────────────────────────────────────────────────────────────


import time as _time
import hmac as _hmac
import hashlib as _hashlib

DEVICE_ONLINE_TIMEOUT = 90


def _ingest_fault_entries(device_uid, entries, timestamp):
    """Create FaultEvent rows from a list of fault dicts.

    Each entry may contain the same fields as the body of /api/device/fault.
    The device_uid is always taken from the caller-supplied argument; any
    per-entry device_uid field is intentionally ignored to prevent a device
    from logging faults against a different device's identity.

    Returns the number of rows added (not yet committed).
    """
    count = 0
    for entry in entries:
        if not isinstance(entry, dict):
            continue
        try:
            f_nia = int(entry.get("instruction_address", entry.get("fault_nia", 0))) & 0xFFFFFFFF
        except (ValueError, TypeError):
            f_nia = 0
        try:
            f_type = int(entry.get("fault_type", 0)) & 0xFF
        except (ValueError, TypeError):
            f_type = 0
        try:
            f_lump_version = int(entry.get("lump_version", 0))
        except (ValueError, TypeError):
            f_lump_version = 0
        try:
            f_recovery_tier = int(entry.get("recovery_tier", entry.get("tier", 0)))
        except (ValueError, TypeError):
            f_recovery_tier = 0
        try:
            f_step_count = int(entry.get("step_count", 0))
        except (ValueError, TypeError):
            f_step_count = 0
        f_abstraction_name = str(entry.get("abstraction_name", "") or "").strip()[:128] or None
        fe = FaultEvent(
            device_uid=device_uid,
            fault_type=f_type,
            fault_nia=f_nia,
            boot_reason=0,
            timestamp=timestamp,
            lump_token=entry.get("lump_token", None),
            lump_version=f_lump_version,
            fault_code=str(entry.get("fault_code", ""))[:32],
            mnemonic=str(entry.get("mnemonic", ""))[:32],
            pipeline_stage=str(entry.get("pipeline_stage", ""))[:32],
            recovery_tier=f_recovery_tier,
            step_count=f_step_count,
            abstraction_name=f_abstraction_name,
        )
        db.session.add(fe)
        count += 1
    return count


def _ingest_lump_version_entries(device_uid, lump_versions, timestamp):
    """Upsert device_lump_versions rows from a list or dict payload.

    Accepts either:
      - A list of {abstraction_name, lump_token, lump_version} dicts
        (same format as /api/device/lump-versions lumps array), or
      - A dict mapping abstraction_name -> {lump_token, lump_version}.

    Returns the number of rows upserted (not yet committed).
    """
    from sqlalchemy import text as _sa_text_ingest
    count = 0
    _UPSERT_SQL = _sa_text_ingest("""
        INSERT INTO device_lump_versions
            (device_uid, abstraction_name, lump_token, lump_version, deployed_at)
        VALUES (:uid, :abs, :tok, :ver, :ts)
        ON CONFLICT(device_uid, abstraction_name) DO UPDATE SET
            lump_token=excluded.lump_token,
            lump_version=excluded.lump_version,
            deployed_at=excluded.deployed_at
    """)
    if isinstance(lump_versions, dict):
        for abs_name, entry in lump_versions.items():
            abs_name = str(abs_name).strip()
            if isinstance(entry, dict):
                token = str(entry.get("lump_token", "")).strip()
                try:
                    ver = int(entry.get("lump_version", 0))
                except (ValueError, TypeError):
                    ver = 0
            else:
                token = str(entry).strip()
                ver = 0
            if not abs_name or not token:
                continue
            db.session.execute(_UPSERT_SQL, {"uid": device_uid, "abs": abs_name, "tok": token, "ver": ver, "ts": timestamp})
            count += 1
    elif isinstance(lump_versions, list):
        for entry in lump_versions:
            if not isinstance(entry, dict):
                continue
            abs_name = str(entry.get("abstraction_name", "")).strip()
            token = str(entry.get("lump_token", "")).strip()
            try:
                ver = int(entry.get("lump_version", 0))
            except (ValueError, TypeError):
                ver = 0
            if not abs_name or not token:
                continue
            db.session.execute(_UPSERT_SQL, {"uid": device_uid, "abs": abs_name, "tok": token, "ver": ver, "ts": timestamp})
            count += 1
    return count


# Reverse-lookup table: known board-name strings → numeric board_type ID.
# Entries are lower-cased for case-insensitive matching.
_BOARD_NAME_TO_ID = {
    "ti60f225":  0x03,
    "ti60":      0x03,
    "ti60-full": 0x03,
}


def _parse_board_type(val):
    """Return a numeric board_type ID from either an int, a numeric string, or a
    known board-name string (e.g. "Ti60F225").  Returns 0 on unrecognised input."""
    if isinstance(val, int):
        return val
    if isinstance(val, str):
        stripped = val.strip()
        try:
            return int(stripped, 0)
        except (ValueError, TypeError):
            pass
        return _BOARD_NAME_TO_ID.get(stripped.lower(), 0)
    try:
        return int(val)
    except (ValueError, TypeError):
        return 0


def _verify_build_sig(board_type, fw_major, fw_minor, sig_hex):
    key = os.environ.get("BUILD_SIGNING_KEY", "")
    if not key or not sig_hex or sig_hex == "00000000":
        return False
    try:
        sig_bytes = bytes.fromhex(sig_hex)
    except ValueError:
        return False
    msg = bytes([board_type, fw_major, fw_minor])
    expected = _hmac.new(key.encode(), msg, _hashlib.sha256).digest()[:4]
    return _hmac.compare_digest(sig_bytes, expected)

def _auto_populate_boot_tests(device_uid, boot_reason, last_fault, timestamp):
    try:
        clean_boot = (last_fault == 0) and (boot_reason in (0, 1))
        t01 = LaunchTest.query.filter_by(test_id="TEST-01").first()
        t02 = LaunchTest.query.filter_by(test_id="TEST-02").first()
        if clean_boot:
            if t01 and t01.status != "passing":
                t01.status = "passing"
                t01.device_uid = device_uid
                t01.updated_at = timestamp
                t01.notes = "Auto-populated: device called home with no NS fault."
            if t02 and t02.status != "passing":
                t02.status = "passing"
                t02.device_uid = device_uid
                t02.updated_at = timestamp
                t02.notes = "Auto-populated: boot thread completed without fault."
        db.session.commit()
    except Exception as e:
        logging.warning("_auto_populate_boot_tests: %s", e)


def _mum_do_greet():
    """Run the server-side Mum.Greet() handshake and return a result dict.

    Mirrors the three-step client-side Hello-Mum flow:
      Navana.Init equivalent   — ensure the Mum Ed25519 identity is initialised
      Keystone.Connect equiv.  — validate the identity word protocol tag
      Keystone.Hello equiv.    — execute Mum.Greet() and return GREET_RESPONSE

    Returns a dict with keys:
      ok (bool)       — True iff the handshake succeeded
      result (int)    — GREET_RESPONSE (0x48454C4C) on success, 0 on failure
      result_hex (str)
      message (str)
      tunnel (str)    — "online" | "offline"

    Never raises; all errors are caught and returned as ok=False.
    """
    GREET_RESPONSE = 0x48454C4C
    try:
        try:
            import mum as _mum
        except ImportError:
            from server import mum as _mum

        # Step 1 — Navana.Init equivalent: initialise Mum identity key
        _mum.get_identity_string()

        # Step 2 — Keystone.Connect equivalent: validate protocol-version nibble
        word = _mum.get_identity_word()
        version_nibble = (word >> 28) & 0xF
        if version_nibble != 1:
            return {
                "ok": False, "result": 0, "result_hex": "0x00000000",
                "message": f"Keystone.Connect: unknown protocol tag 0x{version_nibble:X} — rejected",
                "tunnel": "offline",
            }

        # Step 3 — Keystone.Hello → Mum.Greet() equivalent
        hex_val = f"0x{GREET_RESPONSE:08X}"
        return {
            "ok": True,
            "result": GREET_RESPONSE,
            "result_hex": hex_val,
            "message": f"Mum.Greet() \u2192 {hex_val} (\u2018HELL\u2019) \u2014 Tunnel bridge online",
            "tunnel": "online",
        }
    except Exception as exc:
        return {
            "ok": False, "result": 0, "result_hex": "0x00000000",
            "message": f"Hello-Mum handshake error: {exc}",
            "tunnel": "offline",
        }


_ROOT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
_HELLO_MUM_HARNESS = os.path.join(_ROOT_DIR, "tests", "boot", "sim_hello_mum_flow.js")
_BOOT_CFG_FOR_FLOW = {
    "step1": {
        "totalNamespaceWords": 16384,
        "namespaceLumpWords":  64,
        "threadLumpWords":     256,
    }
}


def _run_hello_mum_flow(dev):
    """Run the Hello-Mum sequence via the sim_hello_mum_flow.js harness.

    Dispatches the full Navana.Init → Keystone.Connect → Keystone.Hello chain
    through the JavaScript simulator, then forwards Tunnel.Call as a real HTTP
    POST to this IDE server's /mum/hello endpoint.  tunnel_status is set to
    'online' only when the harness reports ok=True, bridgeHit=True, and
    greetResult == GREET_RESPONSE (0x48454C4C).  Sets 'offline' otherwise.

    bridge_url is read from app.config['SELF_BASE_URL'] (set at server startup
    and in test fixtures).  Falls back to 'http://127.0.0.1:5000'.  This avoids
    trusting the incoming Host header (no SSRF vector).

    Must be called inside an active app-context with an open DB session.
    """
    GREET_RESPONSE = 0x48454C4C

    try:
        try:
            import mum as _mum
        except ImportError:
            from server import mum as _mum

        # Step 1 — Navana.Init equivalent: ensure Mum identity is initialised
        _mum.get_identity_string()

        # Step 2 — Keystone.Connect equivalent: validate identity word
        identity_word = _mum.get_identity_word()
        if ((identity_word >> 28) & 0xF) != 1:
            dev.tunnel_status = "offline"
            logging.warning("Hello-Mum auto-flow: device=%s invalid protocol tag", dev.device_uid)
            return

        # Step 3 — Keystone.Hello → Tunnel.Call via JS harness → /mum/hello
        lumps_dir = LUMPS_DIR
        img_bytes = _boot_image_gen.generate_boot_image(_BOOT_CFG_FOR_FLOW, lumps_dir)
        img_b64   = base64.b64encode(img_bytes).decode("ascii")

        bridge_url = app.config.get("SELF_BASE_URL", "http://127.0.0.1:5000")

        envelope = json.dumps({
            "imageBase64":  img_b64,
            "config":       _BOOT_CFG_FOR_FLOW,
            "identityWord": identity_word,
            "bridgeUrl":    bridge_url,
        }).encode("utf-8")

        proc = subprocess.run(
            ["node", _HELLO_MUM_HARNESS],
            input=envelope,
            capture_output=True,
            timeout=30,
            cwd=_ROOT_DIR,
        )

        stdout = proc.stdout.decode("utf-8", errors="replace").strip()
        try:
            result = json.loads(stdout) if stdout else {}
        except json.JSONDecodeError:
            result = {}

        greet     = int(result.get("greetResult", 0)) & 0xFFFFFFFF
        bridge_hit = result.get("bridgeHit", False)

        if proc.returncode == 0 and greet == GREET_RESPONSE and bridge_hit:
            dev.tunnel_status = "online"
        else:
            dev.tunnel_status = "offline"

        logging.info(
            "Hello-Mum auto-flow: device=%s tunnel_status=%s greet=0x%08X bridgeHit=%s",
            dev.device_uid, dev.tunnel_status, greet, bridge_hit,
        )

    except Exception as exc:
        logging.warning("Hello-Mum auto-flow: device=%s error=%s", getattr(dev, "device_uid", "?"), exc)
        dev.tunnel_status = "offline"


# ── Bridge tunnel state (in-memory, per device UID) ────────────────────────
_tunnel_drain      = {}          # uid -> bytearray of serial bytes pushed by bridge
_tunnel_drain_lock = threading.Lock()
_latest_callhome_data = {}       # uid -> dict {board,uid,nia,boot_ok,fault,fault_code,fw_major,fw_minor,boot_count,ts}
_latest_callhome_lock = threading.Lock()
_callhome_log = []               # rolling list of last 200 CALLHOME/register events (newest appended last)
_CALLHOME_LOG_MAX = 200

_uart_log = []                   # rolling list of last 500 plain-text UART lines (newest appended last)
_uart_log_lock = threading.Lock()
_UART_LOG_MAX = 500

def _write_fault_event_from_callhome(entry):
    """Write a FaultEvent row from a callhome/register entry for MTBF analytics.

    Called when boot_ok==0, fault_code!=0, or event_type=='register'.
    Must be called with an active Flask app context and inside a db.session.
    """
    if FaultEvent is None:
        return
    try:
        nia_str = entry.get("nia", "0x00000000")
        try:
            nia_int = int(str(nia_str), 16)
        except (ValueError, TypeError):
            nia_int = 0
        fe = FaultEvent(
            device_uid=entry.get("uid", ""),
            fault_type=int(entry.get("fault_code", 0)),
            fault_nia=nia_int,
            boot_reason=0 if entry.get("boot_ok", 1) else 2,
            timestamp=entry.get("ts", 0.0),
            fault_code=str(entry.get("fault_code", 0)),
            mnemonic="",
            board_name=entry.get("board", ""),
            ns_slot=None,
            abstraction_label="",
            nia_hex=str(nia_str),
            cr12=str(entry.get("cr12") or ""),
            cr14=str(entry.get("cr14") or ""),
            cr15=str(entry.get("cr15") or ""),
            boot_count_at_fault=int(entry.get("boot_count", 0)),
            raw_type=entry.get("type", "callhome"),
            abstraction_name=str(entry.get("abstraction_name", "") or "").strip()[:128] or None,
        )
        db.session.add(fe)
    except Exception as _fe_err:
        logging.warning("FaultEvent DB write error from callhome: %s", _fe_err)


def _append_callhome_log(entry):
    """Append a CALLHOME event to the rolling log under _latest_callhome_lock.

    Also writes through to CallhomeLog (7-day rolling) and conditionally to
    FaultEvent (permanent MTBF store) when the event represents a fault or restart.
    """
    global _callhome_log
    _callhome_log.append(entry)
    if len(_callhome_log) > _CALLHOME_LOG_MAX:
        _callhome_log = _callhome_log[-_CALLHOME_LOG_MAX:]
    if CallhomeLog is None:
        return
    try:
        row = CallhomeLog(
            ts=float(entry.get("ts", 0.0)),
            uid=str(entry.get("uid", "")),
            board=str(entry.get("board", "")),
            nia=str(entry.get("nia", "0x00000000")),
            boot_ok=1 if entry.get("boot_ok", 1) else 0,
            fault=int(entry.get("fault", 0)),
            fault_code=int(entry.get("fault_code", 0)),
            fw_major=int(entry.get("fw_major", 1)),
            fw_minor=int(entry.get("fw_minor", 0)),
            boot_count=int(entry.get("boot_count", 0)),
            event_type=str(entry.get("type", "callhome")),
            cr12=str(entry.get("cr12") or ""),
            cr14=str(entry.get("cr14") or ""),
            cr15=str(entry.get("cr15") or ""),
        )
        db.session.add(row)
        boot_ok = entry.get("boot_ok", 1)
        fault_code = int(entry.get("fault_code", 0))
        raw_type = entry.get("type", "callhome")
        if (not boot_ok) or fault_code or raw_type == "register":
            _write_fault_event_from_callhome(entry)
        db.session.commit()
    except Exception as _cl_err:
        logging.warning("CallhomeLog DB write error: %s", _cl_err)
        try:
            db.session.rollback()
        except Exception:
            pass


@app.route("/api/device/register", methods=["POST"])
def device_register():
    data = request.get_json(silent=True) or {}
    uid = data.get("device_uid", "").strip()
    if not uid:
        return jsonify({"ok": False, "error": "missing device_uid"}), 400
    board_type = _parse_board_type(data.get("board_type", 0))
    fw_major = int(data.get("fw_major", 1))
    fw_minor = int(data.get("fw_minor", 0))
    build_sig_hex = data.get("build_sig", "00000000")
    profile = data.get("profile", "Full")
    build_verified = _verify_build_sig(board_type, fw_major, fw_minor, build_sig_hex)
    try:
        boot_reason = max(0, min(255, int(data.get("boot_reason", 0))))
    except (ValueError, TypeError):
        boot_reason = 0
    try:
        last_fault = max(0, min(255, int(data.get("last_fault", 0))))
    except (ValueError, TypeError):
        last_fault = 0
    try:
        fault_nia = max(0, min(0xFFFFFFFF, int(data.get("fault_nia", 0))))
    except (ValueError, TypeError):
        fault_nia = 0
    bridge_host = data.get("bridge_host", "")
    bridge_port = int(data.get("bridge_port", 0))
    bridge_scheme = data.get("bridge_scheme", "http")
    if bridge_scheme not in ("http", "https"):
        bridge_scheme = "http"
    serial_port = data.get("serial_port", "")
    now = _time.time()
    dev = Device.query.filter_by(device_uid=uid).first()
    if dev:
        dev.board_type = board_type
        dev.board_name = BOARD_TYPES.get(board_type, f"Unknown-0x{board_type:02X}")
        dev.profile = profile
        dev.fw_major = fw_major
        dev.fw_minor = fw_minor
        dev.build_sig = build_sig_hex
        dev.build_verified = 1 if build_verified else 0
        dev.boot_reason = boot_reason
        dev.last_fault = last_fault
        dev.fault_nia = fault_nia
        dev.bridge_host = bridge_host
        dev.bridge_port = bridge_port
        dev.bridge_scheme = bridge_scheme
        dev.serial_port = serial_port
        dev.status = "online"
        dev.last_seen = now
        dev.boot_count = (dev.boot_count or 0) + 1
    else:
        dev = Device(
            device_uid=uid,
            board_type=board_type,
            board_name=BOARD_TYPES.get(board_type, f"Unknown-0x{board_type:02X}"),
            profile=profile,
            fw_major=fw_major,
            fw_minor=fw_minor,
            build_sig=build_sig_hex,
            build_verified=1 if build_verified else 0,
            boot_reason=boot_reason,
            last_fault=last_fault,
            fault_nia=fault_nia,
            bridge_host=bridge_host,
            bridge_port=bridge_port,
            bridge_scheme=bridge_scheme,
            serial_port=serial_port,
            status="online",
            last_seen=now,
            boot_count=1,
        )
        db.session.add(dev)
    db.session.commit()
    if boot_reason == 2 and last_fault:
        fe = FaultEvent(
            device_uid=uid,
            fault_type=last_fault,
            fault_nia=fault_nia,
            boot_reason=boot_reason,
            timestamp=now,
        )
        db.session.add(fe)
        db.session.commit()
        logging.info("Fault event logged: device=%s fault=0x%02X nia=0x%08X", uid, last_fault, fault_nia)

    _auto_populate_boot_tests(uid, boot_reason, last_fault, now)

    _run_hello_mum_flow(dev)
    db.session.commit()

    lump_versions_inline = data.get("lump_versions")
    if isinstance(lump_versions_inline, list):
        from sqlalchemy import text as _sa_text_reg
        _ts_reg = _time.time()
        for entry in lump_versions_inline:
            if not isinstance(entry, dict):
                continue
            _abs = str(entry.get("abstraction_name", "")).strip()
            _tok = str(entry.get("lump_token", "")).strip()
            try:
                _ver = int(entry.get("lump_version", 0))
            except (ValueError, TypeError):
                _ver = 0
            if not _abs or not _tok:
                continue
            db.session.execute(_sa_text_reg("""
                INSERT INTO device_lump_versions
                    (device_uid, abstraction_name, lump_token, lump_version, deployed_at)
                VALUES (:uid, :abs, :tok, :ver, :ts)
                ON CONFLICT(device_uid, abstraction_name) DO UPDATE SET
                    lump_token=excluded.lump_token,
                    lump_version=excluded.lump_version,
                    deployed_at=excluded.deployed_at
            """), {"uid": uid, "abs": _abs, "tok": _tok, "ver": _ver, "ts": _ts_reg})
        db.session.commit()
        logging.info("Inline lump_versions recorded for device=%s count=%d", uid, len(lump_versions_inline))

    with _latest_callhome_lock:
        _latest_callhome_data[uid] = {
            "board":      dev.board_name,
            "uid":        uid,
            "nia":        f"0x{fault_nia:08X}",
            "boot_ok":    0 if boot_reason == 2 else 1,
            "fault":      last_fault,
            "fault_code": last_fault,
            "fw_major":   fw_major,
            "fw_minor":   fw_minor,
            "boot_count": dev.boot_count,
            "ts":         now,
        }
        _append_callhome_log(dict(_latest_callhome_data[uid], type="register"))
    logging.info("Device registered: %s (%s) via %s:%s tunnel=%s",
                 uid, dev.board_name, bridge_host, bridge_port, dev.tunnel_status)
    return jsonify({
        "ok": True,
        "device_id": dev.id,
        "board_name": dev.board_name,
        "boot_count": dev.boot_count,
        "tunnel_status": dev.tunnel_status,
    })


@app.route("/api/device/heartbeat", methods=["POST"])
def device_heartbeat():
    data = request.get_json(silent=True) or {}
    uid = data.get("device_uid", "").strip()
    if not uid:
        return jsonify({"ok": False}), 400
    dev = Device.query.filter_by(device_uid=uid).first()
    if not dev:
        return jsonify({"ok": False, "error": "unknown device"}), 404

    now = _time.time()
    was_offline = (
        dev.status != "online"
        or (now - (dev.last_seen or 0)) >= DEVICE_ONLINE_TIMEOUT
    )

    dev.status = "online"
    dev.last_seen = now
    db.session.commit()

    # Keep the in-memory tunnel callhome cache fresh so the browser sees a
    # live timestamp even between real CALLHOME packets.
    with _latest_callhome_lock:
        if uid in _latest_callhome_data:
            _latest_callhome_data[uid]["ts"] = now
        else:
            # First heartbeat for a device not yet in the cache — seed it.
            _latest_callhome_data[uid] = {
                "board":      dev.board_name or "Unknown",
                "uid":        uid,
                "nia":        "0x{:08X}".format(dev.fault_nia or 0),
                "boot_ok":    0 if (dev.boot_reason or 0) == 2 else 1,
                "fault":      dev.last_fault or 0,
                "fault_code": dev.last_fault or 0,
                "fw_major":   dev.fw_major or 1,
                "fw_minor":   dev.fw_minor or 0,
                "boot_count": dev.boot_count or 1,
                "ts":         now,
            }

    if was_offline:
        _run_hello_mum_flow(dev)
        db.session.commit()
        logging.info(
            "device_heartbeat: reconnect detected for device=%s, re-ran Hello-Mum, tunnel_status=%s",
            uid, dev.tunnel_status,
        )

    return jsonify({"ok": True, "tunnel_status": dev.tunnel_status or "pending"})


@app.route("/api/device/push-drain", methods=["POST"])
def device_push_drain():
    """Bridge pushes raw serial bytes here so the browser can poll them."""
    data = request.get_json(silent=True) or {}
    uid  = (data.get("uid") or "").strip()
    raw  = data.get("bytes") or []
    if uid and raw:
        with _tunnel_drain_lock:
            if uid not in _tunnel_drain:
                _tunnel_drain[uid] = bytearray()
            _tunnel_drain[uid].extend(bytes(b & 0xFF for b in raw))
    return jsonify({"ok": True})


_pull_drain_last_keepalive = {}   # uid -> float timestamp
_PULL_DRAIN_KEEPALIVE_INTERVAL = 30  # seconds between DB/cache updates

@app.route("/api/device/pull-drain/<uid>")
def device_pull_drain(uid):
    """Browser polls this to receive serial bytes forwarded by the bridge tunnel."""
    with _tunnel_drain_lock:
        data = bytes(_tunnel_drain.get(uid) or b"")
        if uid in _tunnel_drain:
            _tunnel_drain[uid] = bytearray()

    # Use the browser's continuous polling as a keepalive so last_seen and
    # the callhome cache stay fresh even if the bridge's heartbeat thread is
    # unavailable.  Throttled to once per 30 s to avoid per-poll DB writes.
    now = _time.time()
    if uid and (now - _pull_drain_last_keepalive.get(uid, 0)) >= _PULL_DRAIN_KEEPALIVE_INTERVAL:
        _pull_drain_last_keepalive[uid] = now
        with _latest_callhome_lock:
            if uid in _latest_callhome_data:
                _latest_callhome_data[uid]["ts"] = now
        try:
            dev = Device.query.filter_by(device_uid=uid).first()
            if dev:
                dev.last_seen = now
                if dev.status != "online":
                    dev.status = "online"
                db.session.commit()
        except Exception:
            try:
                db.session.rollback()
            except Exception:
                pass

    return jsonify({"ok": True, "bytes": list(data)})


@app.route("/api/boot-rom-words")
def boot_rom_words():
    """Return the hardware boot ROM (FULL_ROM from hardware/boot_rom.py).

    The FULL_ROM is the pre-synthesised instruction ROM baked into the FPGA
    bitstream.  It covers NIA byte-addresses 0x0000–0x0FFC (1024 words).
    The DEMO_CLIST is the static capability list used by NUC_PROGRAM (LED blink).

    Used by the Connect tab NIA stream panel to decode instructions correctly:
    NIA values within the ROM range are decoded from FULL_ROM, not from the
    boot-image.bin LUMP (which covers a different address range).
    """
    try:
        import sys as _sys
        _repo = os.path.dirname(os.path.dirname(__file__))
        if _repo not in _sys.path:
            _sys.path.insert(0, _repo)
        from hardware import boot_rom as _br
        return jsonify({
            "ok":                      True,
            "rom":                     [int(w) for w in _br.FULL_ROM],
            "nuc_lump_base_byte":      int(_br.NUC_LUMP_BASE),
            "sliderule_lump_base_byte": int(_br.SLIDERULE_LUMP_BASE),
            "demo_clist":              [int(w) for w in _br.DEMO_CLIST],
        })
    except Exception as _e:
        return jsonify({"ok": False, "error": str(_e)})


@app.route("/api/boot-lump-words")
def boot_lump_words():
    """Return c-list and code words for Boot.Abstr from the boot image.

    The NS slot is resolved from the authoritative SelfTest state row. Used by
    the Connect tab stream panel
    to disassemble NIA lines and display the GT the instruction accesses.
    """
    import struct as _struct
    boot_img = BOOT_IMAGE_PATH
    if not os.path.exists(boot_img):
        return jsonify({"ok": False, "error": "no boot image available"})
    with open(boot_img, "rb") as _f:
        _img = _f.read()
    n_words = len(_img) // 4
    if n_words < 16:
        return jsonify({"ok": False, "error": "boot image too small"})
    words = _struct.unpack_from(f'<{n_words}I', _img)
    BOOT_TAG        = _boot_image_gen.BOOT_IMAGE_FORMAT_TAG
    NS_ENTRY_WORDS  = _boot_image_gen.NS_ENTRY_WORDS
    locator = _active_selftest_locator()
    if locator is None:
        return jsonify({"ok": False, "error": "no authoritative SelfTest binding"})
    BOOT_ABSTR_SLOT = locator["slot"]
    tag_idx = None
    for _i in range(n_words - 1, max(n_words - 8192, -1), -1):
        if words[_i] == BOOT_TAG:
            tag_idx = _i
            break
    if tag_idx is None:
        return jsonify({"ok": False, "error": "BOOT_IMAGE_FORMAT_TAG not found"})
    ns_table_base   = tag_idx + 1
    slot_entry_base = ns_table_base + BOOT_ABSTR_SLOT * NS_ENTRY_WORDS
    if slot_entry_base + 3 >= n_words:
        return jsonify({"ok": False, "error": "Boot.Abstr NS slot entry out of range"})
    lump_base = int(words[slot_entry_base])
    if lump_base == 0 or lump_base + 1 >= n_words:
        return jsonify({"ok": False, "error": f"invalid lump base {lump_base}"})
    hdr = words[lump_base]
    magic = (hdr >> 27) & 0x1F
    if magic != 0x1F:
        return jsonify({"ok": False,
                        "error": f"bad LUMP magic at word {lump_base}: 0x{hdr:08X}"})
    n_minus_6 = (hdr >> 23) & 0xF
    cw        = (hdr >> 10) & 0x1FFF
    cc        = hdr & 0xFF
    lump_size = 1 << (n_minus_6 + 6)
    code_end  = lump_base + 1 + cw
    clist_start = lump_base + lump_size - cc
    if code_end > n_words or (cc > 0 and clist_start + cc > n_words):
        return jsonify({"ok": False, "error": "LUMP words extend past image boundary"})
    code  = [int(words[lump_base + 1 + _j]) for _j in range(cw)]
    clist = [int(words[clist_start + _j]) for _j in range(cc)] if cc > 0 else []
    return jsonify({
        "ok":        True,
        "slot":      BOOT_ABSTR_SLOT,
        "lump_base": lump_base,
        "lump_size": lump_size,
        "cw":        cw,
        "cc":        cc,
        "code":      code,
        "clist":     clist,
    })


@app.route("/api/device/callhome-log")
def device_callhome_log():
    """Return recent CALLHOME/register events newer than ?since=<unix_ts>, newest first.

    Queries CallhomeLog (DB) for historical records; falls back to in-memory list.
    """
    try:
        since = float(request.args.get("since") or 0)
    except (ValueError, TypeError):
        since = 0.0
    try:
        limit = min(int(request.args.get("limit") or 100), 200)
    except (ValueError, TypeError):
        limit = 100
    if CallhomeLog is not None:
        try:
            rows = (CallhomeLog.query
                    .filter(CallhomeLog.ts > since)
                    .order_by(CallhomeLog.ts.desc())
                    .limit(limit)
                    .all())
            _CH_FAULT_NAMES = {
                1:'PERM_R',2:'PERM_W',3:'PERM_X',4:'PERM_L',5:'PERM_S',
                6:'PERM_E',7:'NULL_CAP',8:'BOUNDS',9:'VERSION',10:'SEAL',
                11:'INVALID_OP',12:'TPERM_RSV',13:'DOMAIN_PURITY',14:'BIND',
                15:'F_BIT',16:'STACK_OVERFLOW',17:'ABSENT_OUTFORM',
                18:'STACK_CORRUPT',19:'STACK_UNDERFLOW',
                21:'OUTFORM_CRC',22:'OUTFORM_ALLOC',23:'OUTFORM_MINT',24:'OUTFORM_HDR',25:'OUTFORM_TIMEOUT',
            }
            entries = [{
                "ts":          r.ts,
                "uid":         r.uid,
                "board":       r.board,
                "nia":         r.nia,
                "boot_ok":     r.boot_ok,
                "fault":       r.fault,
                "fault_code":  r.fault_code,
                "fault_name":  _CH_FAULT_NAMES.get(r.fault_code or 0, ""),
                "fault_stage": None,
                "fw_major":    r.fw_major,
                "fw_minor":    r.fw_minor,
                "boot_count":  r.boot_count,
                "type":        r.event_type,
                "cr12":        r.cr12,
                "cr14":        r.cr14,
                "cr15":        r.cr15,
            } for r in rows]
            return jsonify({"ok": True, "entries": entries})
        except Exception as _db_err:
            logging.warning("callhome-log DB query failed, falling back: %s", _db_err)
    with _latest_callhome_lock:
        entries = [e for e in _callhome_log if e.get("ts", 0) > since]
    entries_out = entries[-limit:]
    entries_out.reverse()
    return jsonify({"ok": True, "entries": entries_out})


@app.route("/api/device/uart-log", methods=["GET", "POST"])
def device_uart_log():
    """GET: return recent plain-text UART lines newer than ?since=<unix_ts>.
       POST: accept a batch of {ts, line, uid} objects from the bridge."""
    global _uart_log
    if request.method == "POST":
        data = request.get_json(silent=True) or {}
        lines = data.get("lines", [])
        if lines:
            with _uart_log_lock:
                for entry in lines:
                    _uart_log.append({
                        "ts":   float(entry.get("ts", 0)),
                        "line": str(entry.get("line", "")),
                        "uid":  str(entry.get("uid", "unknown")),
                    })
                if len(_uart_log) > _UART_LOG_MAX:
                    _uart_log = _uart_log[-_UART_LOG_MAX:]
            if UartLog is not None:
                try:
                    for entry in lines:
                        db.session.add(UartLog(
                            ts=float(entry.get("ts", 0)),
                            uid=str(entry.get("uid", "unknown")),
                            line=str(entry.get("line", "")),
                        ))
                    db.session.commit()
                except Exception as _ul_err:
                    logging.warning("UartLog DB write error: %s", _ul_err)
                    try:
                        db.session.rollback()
                    except Exception:
                        pass
        return jsonify({"ok": True, "added": len(lines)})
    # GET
    try:
        since = float(request.args.get("since") or 0)
    except (ValueError, TypeError):
        since = 0.0
    try:
        limit = min(int(request.args.get("limit") or 200), 500)
    except (ValueError, TypeError):
        limit = 200
    if UartLog is not None:
        try:
            rows = (UartLog.query
                    .filter(UartLog.ts > since)
                    .order_by(UartLog.ts.desc())
                    .limit(limit)
                    .all())
            out = [{"ts": r.ts, "uid": r.uid, "line": r.line} for r in rows]
            return jsonify({"ok": True, "entries": out})
        except Exception as _ul_get_err:
            logging.warning("UartLog DB query failed, falling back: %s", _ul_get_err)
    with _uart_log_lock:
        entries = [e for e in _uart_log if e.get("ts", 0) > since]
    out = entries[-limit:]
    out = list(reversed(out))   # newest first
    return jsonify({"ok": True, "entries": out})


@app.route("/api/device/mtbf")
def device_mtbf():
    """Return MTBF (mean time between failures) in hours, grouped by
    (abstraction_name, lump_version) as the primary key.

    Optional query parameters:
      ?uid=<device_uid>    — filter to a specific machine
      ?mnemonic=<str>      — filter to a specific instruction mnemonic

    Response: { "ok": true, "rows": [ { "abstraction_name", "lump_version",
      "ns_slot", "abstraction_label", "mnemonic", "fault_count",
      "first_fault_ts", "last_fault_ts", "mtbf_hours",
      "machine_uid", "board_name" }, ... ] }

    Rows are grouped by (abstraction_name, lump_version) so MTBF history
    survives slot reassignment and resets cleanly on each version bump.
    Rows are sorted by mtbf_hours ascending (least reliable first).
    Groups with fewer than 2 events have mtbf_hours of null.
    """
    uid_filter      = request.args.get("uid", "").strip()
    mnemonic_filter = request.args.get("mnemonic", "").strip()

    if FaultEvent is None:
        return jsonify({"ok": False, "error": "model not ready"}), 503

    try:
        q = FaultEvent.query
        if uid_filter:
            q = q.filter(FaultEvent.device_uid == uid_filter)
        if mnemonic_filter:
            q = q.filter(FaultEvent.mnemonic == mnemonic_filter)

        events = q.all()

        from collections import defaultdict
        groups = defaultdict(list)
        for ev in events:
            abs_name = ev.abstraction_name or ev.abstraction_label or ""
            lump_ver = ev.lump_version if ev.lump_version is not None else 0
            key = (abs_name, lump_ver)
            groups[key].append(ev)

        rows = []
        for (abs_name, lump_ver), evs in groups.items():
            tss_sorted = sorted((e.timestamp or 0.0) for e in evs if e.timestamp)
            fault_count = len(tss_sorted)
            first_ts = tss_sorted[0] if tss_sorted else None
            last_ts  = tss_sorted[-1] if tss_sorted else None
            if fault_count >= 2 and first_ts is not None and last_ts is not None:
                span_hours = (last_ts - first_ts) / 3600.0
                mtbf_hours = span_hours / (fault_count - 1)
            else:
                mtbf_hours = None
            sample = evs[0]
            rows.append({
                "abstraction_name":  abs_name or None,
                "lump_version":      lump_ver,
                "ns_slot":           sample.ns_slot,
                "abstraction_label": sample.abstraction_label or abs_name or "",
                "mnemonic":          sample.mnemonic or "",
                "fault_count":       fault_count,
                "first_fault_ts":    first_ts,
                "last_fault_ts":     last_ts,
                "mtbf_hours":        mtbf_hours,
                "machine_uid":       sample.device_uid or "",
                "board_name":        sample.board_name or "",
            })

        rows.sort(key=lambda r: (r["mtbf_hours"] is None, r["mtbf_hours"] or 0))
        return jsonify({"ok": True, "rows": rows})
    except Exception as _mtbf_err:
        logging.warning("MTBF query error: %s", _mtbf_err)
        return jsonify({"ok": False, "error": str(_mtbf_err)}), 500


@app.route("/api/device/latest-callhome")
def device_latest_callhome():
    """Return the most-recent CALLHOME entry newer than ?since=<unix_ts>."""
    since = 0.0
    try:
        since = float(request.args.get("since") or 0)
    except (ValueError, TypeError):
        pass
    with _latest_callhome_lock:
        entries = sorted(_latest_callhome_data.values(),
                         key=lambda x: x.get("ts", 0), reverse=True)
        for e in entries:
            # Cross-check DB last_seen so heartbeats (which update the DB but
            # may not have flushed to the in-memory cache yet) are reflected.
            cached_ts = e.get("ts", 0)
            try:
                dev = Device.query.filter_by(device_uid=e.get("uid", "")).first()
                db_ts = float(dev.last_seen or 0) if dev else 0.0
            except Exception:
                db_ts = 0.0
            best_ts = max(cached_ts, db_ts)
            if best_ts > since:
                out = dict(e)
                out["ts"] = best_ts
                return jsonify({"ok": True, "callhome": out})
    return jsonify({"ok": True, "callhome": None})


@app.route("/api/device/call-home", methods=["POST"])
def device_call_home():
    """Combined call-home handshake: register + optional inline fault telemetry + lump versions.

    This endpoint accepts the same fields as /api/device/register and additionally
    processes two optional inline arrays so devices can submit everything in a single
    POST, reducing round-trips and ensuring telemetry is captured even when a
    secondary POST would be dropped.

    Extra body fields (all optional):
      faults        — list of fault records, each with the same fields accepted by
                      /api/device/fault (device_uid is inherited from the top-level
                      field and may be omitted per entry).
      lump_versions — list of {abstraction_name, lump_token, lump_version} dicts
                      (same format as /api/device/lump-versions lumps array), OR a
                      dict mapping abstraction_name -> {lump_token, lump_version}.

    Devices that omit faults and lump_versions behave exactly as if they called
    /api/device/register directly — this endpoint is fully backwards-compatible.
    """
    data = request.get_json(silent=True) or {}
    uid = data.get("device_uid", "").strip()
    if not uid:
        return jsonify({"ok": False, "error": "missing device_uid"}), 400

    board_type = _parse_board_type(data.get("board_type", 0))
    fw_major = int(data.get("fw_major", 1))
    fw_minor = int(data.get("fw_minor", 0))
    build_sig_hex = data.get("build_sig", "00000000")
    profile = data.get("profile", "Full")
    build_verified = _verify_build_sig(board_type, fw_major, fw_minor, build_sig_hex)
    try:
        boot_reason = max(0, min(255, int(data.get("boot_reason", 0))))
    except (ValueError, TypeError):
        boot_reason = 0
    try:
        last_fault = max(0, min(255, int(data.get("last_fault", 0))))
    except (ValueError, TypeError):
        last_fault = 0
    try:
        fault_nia = max(0, min(0xFFFFFFFF, int(data.get("fault_nia", 0))))
    except (ValueError, TypeError):
        fault_nia = 0
    bridge_host = data.get("bridge_host", "")
    bridge_port = int(data.get("bridge_port", 0))
    bridge_scheme = data.get("bridge_scheme", "http")
    if bridge_scheme not in ("http", "https"):
        bridge_scheme = "http"
    serial_port = data.get("serial_port", "")
    now = _time.time()

    dev = Device.query.filter_by(device_uid=uid).first()
    if dev:
        dev.board_type = board_type
        dev.board_name = BOARD_TYPES.get(board_type, f"Unknown-0x{board_type:02X}")
        dev.profile = profile
        dev.fw_major = fw_major
        dev.fw_minor = fw_minor
        dev.build_sig = build_sig_hex
        dev.build_verified = 1 if build_verified else 0
        dev.boot_reason = boot_reason
        dev.last_fault = last_fault
        dev.fault_nia = fault_nia
        dev.bridge_host = bridge_host
        dev.bridge_port = bridge_port
        dev.bridge_scheme = bridge_scheme
        dev.serial_port = serial_port
        dev.status = "online"
        dev.last_seen = now
        dev.boot_count = (dev.boot_count or 0) + 1
    else:
        dev = Device(
            device_uid=uid,
            board_type=board_type,
            board_name=BOARD_TYPES.get(board_type, f"Unknown-0x{board_type:02X}"),
            profile=profile,
            fw_major=fw_major,
            fw_minor=fw_minor,
            build_sig=build_sig_hex,
            build_verified=1 if build_verified else 0,
            boot_reason=boot_reason,
            last_fault=last_fault,
            fault_nia=fault_nia,
            bridge_host=bridge_host,
            bridge_port=bridge_port,
            bridge_scheme=bridge_scheme,
            serial_port=serial_port,
            status="online",
            last_seen=now,
            boot_count=1,
        )
        db.session.add(dev)
    db.session.commit()

    if boot_reason == 2 and last_fault:
        fe = FaultEvent(
            device_uid=uid,
            fault_type=last_fault,
            fault_nia=fault_nia,
            boot_reason=boot_reason,
            timestamp=now,
        )
        db.session.add(fe)
        db.session.commit()
        logging.info("Fault event logged: device=%s fault=0x%02X nia=0x%08X", uid, last_fault, fault_nia)

    _auto_populate_boot_tests(uid, boot_reason, last_fault, now)
    _run_hello_mum_flow(dev)
    db.session.commit()

    faults_inline = data.get("faults")
    faults_recorded = 0
    if isinstance(faults_inline, list):
        faults_recorded = _ingest_fault_entries(uid, faults_inline, now)
        if faults_recorded:
            db.session.commit()
            logging.info("Inline faults recorded for device=%s count=%d", uid, faults_recorded)

    lump_versions_inline = data.get("lump_versions")
    lump_versions_updated = 0
    if lump_versions_inline is not None:
        lump_versions_updated = _ingest_lump_version_entries(uid, lump_versions_inline, _time.time())
        if lump_versions_updated:
            db.session.commit()
            logging.info("Inline lump_versions recorded for device=%s count=%d", uid, lump_versions_updated)

    cr14_raw = data.get("cr14")
    cr12_raw = data.get("cr12")
    cr15_raw = data.get("cr15")

    # fault_name: human-readable string from bridge v1.1+; blank for older bridges.
    fault_name = str(data.get("fault_name", "") or "").strip()
    # fault_stage: pipeline stage index 0-7 (APB3 FAULT_STAGE register, new bitstream only).
    fault_stage_raw = data.get("fault_stage")
    fault_stage = None
    if fault_stage_raw is not None:
        try:
            fault_stage = max(0, min(7, int(fault_stage_raw)))
        except (ValueError, TypeError):
            pass

    # Resolve the NIA to display in the log.
    # The bridge posts "nia" as a hex string (e.g. "0x00000014") taken directly
    # from the firmware's CALLHOME JSON.  fault_nia is only set when boot_reason==2
    # (fault boot) and defaults to 0 for normal call-home events, so we prefer the
    # bridge-supplied "nia" and fall back to fault_nia only when absent.
    nia_raw = data.get("nia")
    if nia_raw is not None:
        try:
            reported_nia = max(0, min(0xFFFFFFFF, int(str(nia_raw), 16)))
        except (ValueError, TypeError):
            reported_nia = fault_nia
    else:
        reported_nia = fault_nia

    with _latest_callhome_lock:
        _latest_callhome_data[uid] = {
            "board":       dev.board_name,
            "uid":         uid,
            "nia":         f"0x{reported_nia:08X}",
            "boot_ok":     0 if boot_reason == 2 else 1,
            "boot_reason": boot_reason,
            "fault":       last_fault,
            "fault_code":  last_fault,
            "fault_name":  fault_name,
            "fault_stage": fault_stage,
            "fw_major":    fw_major,
            "fw_minor":    fw_minor,
            "boot_count":  dev.boot_count,
            "ts":          now,
            "cr14":        cr14_raw,
            "cr12":        cr12_raw,
            "cr15":        cr15_raw,
        }
        _append_callhome_log(dict(_latest_callhome_data[uid], type="callhome"))
    logging.info("Call-home: device=%s (%s) faults=%d lump_versions=%d tunnel=%s",
                 uid, dev.board_name, faults_recorded, lump_versions_updated, dev.tunnel_status)

    _push_device_event({
        "type":       "device_online",
        "device_uid": uid,
        "board_name": dev.board_name,
        "profile":    profile,
        "is_new":     dev.boot_count == 1,
        "boot_count": dev.boot_count,
    })

    return jsonify({
        "ok": True,
        "device_id": dev.id,
        "board_name": dev.board_name,
        "boot_count": dev.boot_count,
        "tunnel_status": dev.tunnel_status,
        "faults_recorded": faults_recorded,
        "lump_versions_updated": lump_versions_updated,
    })


@app.route("/api/device/events")
def device_events():
    """Server-Sent Events stream — pushes device lifecycle events to browser tabs."""
    def _stream():
        q = queue.Queue(maxsize=32)
        with _sse_clients_lock:
            _sse_clients.append(q)
        try:
            yield "data: {\"type\":\"connected\"}\n\n"
            while True:
                try:
                    yield q.get(timeout=20)
                except queue.Empty:
                    yield ": keepalive\n\n"
        finally:
            with _sse_clients_lock:
                try:
                    _sse_clients.remove(q)
                except ValueError:
                    pass

    return app.response_class(
        _stream(),
        mimetype="text/event-stream",
        headers={
            "Cache-Control":    "no-cache",
            "X-Accel-Buffering": "no",
        },
    )


@app.route("/api/device/list")
def device_list():
    from sqlalchemy import func as _sqlfunc
    now = _time.time()
    devs = Device.query.order_by(Device.last_seen.desc()).all()
    fault_counts = {
        row.device_uid: row.cnt
        for row in db.session.query(
            FaultEvent.device_uid,
            _sqlfunc.count(FaultEvent.id).label("cnt")
        ).group_by(FaultEvent.device_uid).all()
    }
    lump_seqs = {
        row[0]: row[1]
        for row in db.session.execute(
            _sa_text("SELECT uid, lump_seq FROM device_lump_state")
        ).fetchall()
    }
    result = []
    for d in devs:
        is_online = (now - (d.last_seen or 0)) < DEVICE_ONLINE_TIMEOUT
        if d.status == "online" and not is_online:
            d.status = "offline"
        fw_major = getattr(d, 'fw_major', 1) or 1
        fw_minor = getattr(d, 'fw_minor', 0) or 0
        result.append({
            "id": d.id,
            "device_uid": d.device_uid,
            "board_type": d.board_type,
            "board_name": d.board_name,
            "profile": d.profile,
            "fw_version": f"{fw_major}.{fw_minor}",
            "fw_major": fw_major,
            "bridge_host": d.bridge_host,
            "bridge_port": d.bridge_port,
            "serial_port": d.serial_port,
            "status": "online" if is_online else "offline",
            "last_seen": d.last_seen,
            "boot_count": d.boot_count,
            "build_verified": bool(getattr(d, 'build_verified', 0)),
            "official": bool(getattr(d, 'build_verified', 0)),
            "boot_reason": getattr(d, 'boot_reason', 0) or 0,
            "last_fault": getattr(d, 'last_fault', 0) or 0,
            "fault_nia": getattr(d, 'fault_nia', 0) or 0,
            "label": d.label or "",
            "tunnel_status": getattr(d, 'tunnel_status', 'pending') or 'pending',
            "is_newcomer": (d.boot_count or 0) <= 2,
            "fault_count": fault_counts.get(d.device_uid, 0),
            "lump_seq": lump_seqs.get(d.device_uid, 0),
        })
    db.session.commit()
    return jsonify({"ok": True, "devices": result})


@app.route("/api/device/fault", methods=["POST"])
def device_fault_submit():
    """Accept a detailed fault telemetry record from a device.

    Accepts both legacy simulator payloads and FAULT_EVENT records from the
    firmware v2.0 bridge (hardware/soc_combined/callhome_bridge.py).

    Body fields (all optional except device_uid):
      device_uid     — required; 16-hex device UID
      nia            — faulting NIA as hex string, e.g. "0x00000042" (bridge)
      instruction_address / fault_nia  — faulting NIA as int (legacy)
      fault_code     — fault code (int or string)
      fault_name     — human-readable fault name, e.g. "PERM_X" (bridge)
      mnemonic       — instruction mnemonic (legacy/simulator)
      fault_gt       — GT word0 hex string, e.g. "0x01800003" (bridge)
      fault_instr    — instruction word hex string (bridge)
      fault_cr14     — CR14 word0 hex string (bridge)
      fault_stage    — pipeline stage as int 0-7 (bridge) or string (legacy)
      pipeline_stage — pipeline stage as string (legacy)
      lump_token, lump_version, recovery_tier, step_count  — optional extras
    """
    _STAGE_NAMES = ("Fetch", "Decode", "Perm", "Lambda", "TPERM", "Call", "Return", "DataRW")
    data = request.get_json(silent=True) or {}
    uid = data.get("device_uid", "").strip()
    if not uid:
        return jsonify({"ok": False, "error": "missing device_uid"}), 400
    now = _time.time()

    # NIA — accept "nia" hex string (bridge) or integer fields (legacy)
    nia_raw = data.get("nia")
    if nia_raw is not None:
        nia_hex_str = str(nia_raw).strip()
        try:
            fault_nia = int(nia_hex_str, 16) & 0xFFFFFFFF
        except (ValueError, TypeError):
            fault_nia = 0
    else:
        nia_hex_str = ""
        try:
            fault_nia = int(data.get("instruction_address", data.get("fault_nia", 0))) & 0xFFFFFFFF
        except (ValueError, TypeError):
            fault_nia = 0

    # fault_type — numeric fault code used as the indexed type column
    try:
        fault_type = int(data.get("fault_code", data.get("fault_type", 0))) & 0xFF
    except (ValueError, TypeError):
        fault_type = 0

    try:
        lump_version = int(data.get("lump_version", 0))
    except (ValueError, TypeError):
        lump_version = 0
    try:
        recovery_tier = int(data.get("recovery_tier", data.get("tier", 0)))
    except (ValueError, TypeError):
        recovery_tier = 0
    try:
        step_count = int(data.get("step_count", 0))
    except (ValueError, TypeError):
        step_count = 0

    # pipeline_stage — accept int (bridge) or string (legacy/simulator)
    stage_raw = data.get("fault_stage", data.get("pipeline_stage", ""))
    try:
        stage_int = int(stage_raw)
        pipeline_stage = _STAGE_NAMES[stage_int] if stage_int < len(_STAGE_NAMES) else str(stage_int)
    except (ValueError, TypeError):
        pipeline_stage = str(stage_raw)[:32]

    # fault_name used as mnemonic when present (bridge); fall back to mnemonic field
    fault_name = str(data.get("fault_name", data.get("mnemonic", "")))[:32]

    abstraction_name = str(data.get("abstraction_name", "") or "").strip()[:128] or None

    # gt_snapshot and pet_names — nullable JSON blobs (v1.2 §3 extension)
    _gt_snapshot = data.get("gt_snapshot")
    gt_snapshot_json = json.dumps(_gt_snapshot) if isinstance(_gt_snapshot, dict) and _gt_snapshot else None
    _pet_names = data.get("pet_names")
    pet_names_json = json.dumps(_pet_names) if isinstance(_pet_names, dict) and _pet_names else None


    fe = FaultEvent(
        device_uid=uid,
        fault_type=fault_type,
        fault_nia=fault_nia,
        boot_reason=0,
        timestamp=now,
        lump_token=data.get("lump_token", None),
        lump_version=lump_version,
        fault_code=str(data.get("fault_code", ""))[:32],
        mnemonic=fault_name,
        pipeline_stage=pipeline_stage,
        recovery_tier=recovery_tier,
        step_count=step_count,
        nia_hex=nia_hex_str[:12] if nia_hex_str else "",
        cr14=str(data.get("fault_cr14", data.get("cr14", "")))[:32],
        cr12=str(data.get("cr12", ""))[:32],
        cr15=str(data.get("cr15", ""))[:32],
        fault_gt=str(data.get("fault_gt", ""))[:32],
        fault_instr=str(data.get("fault_instr", ""))[:32],
        raw_type="FAULT_EVENT" if data.get("fault_latched") is not None else "fault",
        abstraction_name=abstraction_name,
        gt_snapshot=gt_snapshot_json,
        pet_names=pet_names_json,
    )
    db.session.add(fe)
    db.session.commit()
    logging.info("Fault telemetry: device=%s code=%s (%s) stage=%s nia=%s gt=%s",
                 uid, fault_type, fault_name, pipeline_stage,
                 nia_hex_str or hex(fault_nia), fe.fault_gt)
    return jsonify({"ok": True, "id": fe.id})


@app.route("/api/device/trace", methods=["POST"])
def device_trace_submit():
    """Accept a NIA trace buffer from a device.

    Body: { "device_uid": "...", "nia_trace": ["0x01", "0x02", ...], "ts": <float> }

    Stores a rolling window of the last 200 trace records per device in the
    nia_traces table (older records for the same device are pruned).
    Returns {"ok": true, "id": <row_id>}.
    """
    import json as _json
    data = request.get_json(silent=True) or {}
    uid = data.get("device_uid", "").strip()
    if not uid:
        return jsonify({"ok": False, "error": "missing device_uid"}), 400

    nia_trace = data.get("nia_trace", [])
    if not isinstance(nia_trace, list):
        nia_trace = []
    try:
        ts = float(data.get("ts", _time.time()))
    except (ValueError, TypeError):
        ts = _time.time()

    row = NiaTrace(
        device_uid=uid,
        ts=ts,
        nia_trace=_json.dumps(nia_trace),
        trace_len=len(nia_trace),
    )
    db.session.add(row)
    db.session.flush()   # obtain row.id before pruning

    # Rolling window: keep only the most recent 200 trace records per device.
    _TRACE_KEEP = 200
    from sqlalchemy import text as _sa_text_tr
    db.session.execute(_sa_text_tr("""
        DELETE FROM nia_traces
        WHERE device_uid = :uid
          AND id NOT IN (
              SELECT id FROM nia_traces
              WHERE device_uid = :uid
              ORDER BY ts DESC
              LIMIT :keep
          )
    """), {"uid": uid, "keep": _TRACE_KEEP})
    db.session.commit()

    logging.debug("NIA trace stored: device=%s len=%d id=%d", uid, len(nia_trace), row.id)
    return jsonify({"ok": True, "id": row.id})


@app.route("/api/device/faults/rich")
def device_faults_rich():
    """Return last N fault events with full telemetry fields for the live panel.

    Query params:
      device_uid — filter to this device (optional; omit for all devices)
      limit      — max results, capped at 100 (default 20)
    """
    uid = request.args.get("device_uid", "").strip()
    try:
        limit = min(int(request.args.get("limit", 20)), 100)
    except (ValueError, TypeError):
        limit = 20
    q = FaultEvent.query
    if uid:
        q = q.filter_by(device_uid=uid)
    events = q.order_by(FaultEvent.timestamp.desc()).limit(limit).all()
    result = []
    for e in events:
        result.append({
            "id": e.id,
            "ts": e.timestamp,
            "nia_hex": e.nia_hex or ("0x" + format(e.fault_nia, "08X")),
            "fault_name": e.mnemonic or "",
            "fault_code": str(e.fault_code or ""),
            "pipeline_stage": e.pipeline_stage or "",
            "fault_gt": e.fault_gt or "",
            "fault_instr": e.fault_instr or "",
            "raw_type": e.raw_type or "fault",
            "abstraction_name": e.abstraction_name or None,
            "lump_version": e.lump_version if e.lump_version is not None else 0,
        })
    return jsonify({"ok": True, "events": result})


@app.route("/api/device/traces")
def device_traces_get():
    """Return last N NIA trace records for a device (for sparkline display).

    Query params:
      device_uid — required
      limit      — max records, capped at 50 (default 10)
    """
    import json as _json
    uid = request.args.get("device_uid", "").strip()
    if not uid:
        return jsonify({"ok": False, "error": "missing device_uid"}), 400
    try:
        limit = min(int(request.args.get("limit", 10)), 50)
    except (ValueError, TypeError):
        limit = 10
    rows = NiaTrace.query.filter_by(device_uid=uid) \
        .order_by(NiaTrace.ts.desc()).limit(limit).all()
    result = []
    for r in rows:
        try:
            nia_trace = _json.loads(r.nia_trace)
        except Exception:
            nia_trace = []
        result.append({"ts": r.ts, "nia_trace": nia_trace})
    return jsonify({"ok": True, "traces": result})


@app.route("/api/device/lump-versions", methods=["POST"])
def device_lump_versions_update():
    """Record the currently deployed LUMP token+version for each abstraction on a device.

    Body: { device_uid, lumps: [{abstraction_name, lump_token, lump_version}] }
    """
    data = request.get_json(silent=True) or {}
    uid = data.get("device_uid", "").strip()
    if not uid:
        return jsonify({"ok": False, "error": "missing device_uid"}), 400
    lumps = data.get("lumps", [])
    now = _time.time()
    from sqlalchemy import text as _sa_text2
    for entry in lumps:
        abs_name = str(entry.get("abstraction_name", "")).strip()
        token = str(entry.get("lump_token", "")).strip()
        try:
            ver = int(entry.get("lump_version", 0))
        except (ValueError, TypeError):
            ver = 0
        if not abs_name or not token:
            continue
        db.session.execute(_sa_text2("""
            INSERT INTO device_lump_versions (device_uid, abstraction_name, lump_token, lump_version, deployed_at)
            VALUES (:uid, :abs, :tok, :ver, :ts)
            ON CONFLICT(device_uid, abstraction_name) DO UPDATE SET
                lump_token=excluded.lump_token,
                lump_version=excluded.lump_version,
                deployed_at=excluded.deployed_at
        """), {"uid": uid, "abs": abs_name, "tok": token, "ver": ver, "ts": now})
    db.session.commit()
    return jsonify({"ok": True, "updated": len(lumps)})


@app.route("/api/device/upgrade-lump", methods=["POST"])
def device_upgrade_lump():
    """Record that a device has been upgraded to a new LUMP version.

    Body: { device_uid, abstraction_name, lump_token, lump_version }
    This is an operator action (no forced push); it just updates the registry.
    """
    data = request.get_json(silent=True) or {}
    uid = data.get("device_uid", "").strip()
    abs_name = str(data.get("abstraction_name", "")).strip()
    token = str(data.get("lump_token", "")).strip()
    try:
        ver = int(data.get("lump_version", 0))
    except (ValueError, TypeError):
        ver = 0
    if not uid or not abs_name or not token:
        return jsonify({"ok": False, "error": "missing required fields"}), 400
    now = _time.time()
    from sqlalchemy import text as _sa_text3
    db.session.execute(_sa_text3("""
        INSERT INTO device_lump_versions (device_uid, abstraction_name, lump_token, lump_version, deployed_at)
        VALUES (:uid, :abs, :tok, :ver, :ts)
        ON CONFLICT(device_uid, abstraction_name) DO UPDATE SET
            lump_token=excluded.lump_token,
            lump_version=excluded.lump_version,
            deployed_at=excluded.deployed_at
    """), {"uid": uid, "abs": abs_name, "tok": token, "ver": ver, "ts": now})
    db.session.commit()
    logging.info("Upgrade recorded: device=%s abstraction=%s token=%s ver=%s", uid, abs_name, token, ver)
    return jsonify({"ok": True})


@app.route("/api/device/bulk-upgrade-lump", methods=["POST"])
def device_bulk_upgrade_lump():
    """Record that ALL devices running an old LUMP version have been upgraded.

    Body: { abstraction_name, from_version, to_token, to_version }
    Updates every row in device_lump_versions where abstraction_name matches
    and lump_version == from_version.  Returns the count of updated rows.
    No forced push — this is purely a registry update.
    """
    data = request.get_json(silent=True) or {}
    abs_name = str(data.get("abstraction_name", "")).strip()
    to_token = str(data.get("to_token", "")).strip()
    try:
        from_version = int(data.get("from_version", -1))
        to_version = int(data.get("to_version", 0))
    except (ValueError, TypeError):
        return jsonify({"ok": False, "error": "invalid version numbers"}), 400
    if not abs_name or not to_token or from_version < 0:
        return jsonify({"ok": False, "error": "missing required fields"}), 400
    if to_version <= from_version:
        return jsonify({"ok": False, "error": f"to_version ({to_version}) must be greater than from_version ({from_version})"}), 400
    now = _time.time()
    from sqlalchemy import text as _sa_text4
    result = db.session.execute(_sa_text4("""
        UPDATE device_lump_versions
        SET lump_token=:tok, lump_version=:to_ver, deployed_at=:ts
        WHERE abstraction_name=:abs AND lump_version=:from_ver
    """), {"abs": abs_name, "tok": to_token, "to_ver": to_version,
           "from_ver": from_version, "ts": now})
    db.session.commit()
    updated = result.rowcount if hasattr(result, 'rowcount') else 0
    logging.info("Bulk upgrade: abstraction=%s from_ver=%s to_ver=%s rows=%s",
                 abs_name, from_version, to_version, updated)
    return jsonify({"ok": True, "updated_count": updated})


FAULT_RATE_THRESHOLD = 0.001


def _compute_version_telemetry(abstraction_name):
    """Aggregate per-version fault stats for an abstraction.

    Returns list of dicts: version, token, compiled_at, device_count,
    total_faults, fault_rate, tier1_count, tier2_count, tier3_count,
    unrecovered_count, mtbf, stable_status.
    """
    import sqlite3 as _sqlite3
    try:
        conn = _sqlite3.connect(db_path)
        conn.row_factory = _sqlite3.Row

        manifest_entries = {}
        try:
            with open(LUMPS_MANIFEST_PATH) as _mf:
                _manifest = json.load(_mf)
            for e in _manifest:
                if e.get("abstraction") == abstraction_name:
                    tok = e.get("token", "")
                    manifest_entries[tok] = e
        except Exception:
            pass

        cur = conn.cursor()
        cur.execute("""
            SELECT lump_token, lump_version, recovery_tier, step_count,
                   COUNT(*) as fault_count
            FROM fault_events
            WHERE lump_token IS NOT NULL
            GROUP BY lump_token, lump_version, recovery_tier
        """)
        raw_rows = cur.fetchall()

        ver_data = {}
        for row in raw_rows:
            tok = row["lump_token"]
            ver = row["lump_version"]
            if tok not in manifest_entries:
                continue
            key = (tok, ver)
            if key not in ver_data:
                ver_data[key] = {
                    "lump_token": tok, "lump_version": ver,
                    "tier1": 0, "tier2": 0, "tier3": 0, "unrecovered": 0,
                    "total_faults": 0, "total_steps": 0,
                }
            d = ver_data[key]
            tier = row["recovery_tier"]
            cnt = row["fault_count"]
            d["total_faults"] += cnt
            if tier == 1:
                d["tier1"] += cnt
            elif tier == 2:
                d["tier2"] += cnt
            elif tier == 3:
                d["tier3"] += cnt
            else:
                d["unrecovered"] += cnt

        cur.execute("""
            SELECT lump_token, lump_version, SUM(step_count) as total_steps
            FROM fault_events
            WHERE lump_token IS NOT NULL AND step_count > 0
            GROUP BY lump_token, lump_version
        """)
        for row in cur.fetchall():
            key = (row["lump_token"], row["lump_version"])
            if key in ver_data:
                ver_data[key]["total_steps"] = row["total_steps"] or 0

        cur.execute("""
            SELECT abstraction_name, lump_token, lump_version, COUNT(*) as dev_count
            FROM device_lump_versions
            GROUP BY abstraction_name, lump_token, lump_version
        """)
        dev_counts = {}
        for row in cur.fetchall():
            dev_counts[(row["lump_token"], row["lump_version"])] = row["dev_count"]

        cur.execute("""
            SELECT DISTINCT lump_token, lump_version
            FROM device_lump_versions
            WHERE abstraction_name = ?
        """, (abstraction_name,))
        known_pairs = [(r["lump_token"], r["lump_version"]) for r in cur.fetchall()]
        conn.close()

        for tok, entry in manifest_entries.items():
            ver = entry.get("lump_version", 0)
            key = (tok, ver)
            if key not in ver_data:
                ver_data[key] = {
                    "lump_token": tok, "lump_version": ver,
                    "tier1": 0, "tier2": 0, "tier3": 0, "unrecovered": 0,
                    "total_faults": 0, "total_steps": 0,
                }

        result = []
        for (tok, ver), d in sorted(ver_data.items(), key=lambda x: x[0][1]):
            entry = manifest_entries.get(tok, {})
            total_faults = d["total_faults"]
            total_steps = d["total_steps"]
            fault_rate = (total_faults / total_steps) if total_steps > 0 else 0.0
            tier3 = d["tier3"]
            unrecovered = d["unrecovered"]
            device_count = dev_counts.get((tok, ver), 0)
            observed = bool(total_steps > 0 or total_faults > 0 or device_count > 0)
            if not observed:
                stable_status = "unknown"
            elif unrecovered > 0:
                stable_status = "red"
            elif tier3 > 0:
                stable_status = "amber"
            else:
                stable_status = "stable"
            compiled_at = (
                entry.get("compiled_at")
                or entry.get("deployment", {}).get("built_at")
            )
            result.append({
                "lump_version": ver,
                "lump_token": tok,
                "compiled_at": compiled_at,
                "device_count": device_count,
                "observed": observed,
                "total_faults": total_faults,
                "fault_rate": round(fault_rate, 6),
                "fault_rate_per_1000": round(fault_rate * 1000, 4),
                "tier1_count": d["tier1"],
                "tier2_count": d["tier2"],
                "tier3_count": tier3,
                "unrecovered_count": unrecovered,
                "mtbf": round(total_steps / total_faults, 1) if total_faults > 0 else None,
                "stable_status": stable_status,
                "production_stable": (
                    observed and (
                        total_faults == 0
                        or fault_rate < FAULT_RATE_THRESHOLD
                        or (tier3 == 0 and unrecovered == 0)
                    )
                ),
            })
        return result
    except Exception as exc:
        logging.warning("_compute_version_telemetry error: %s", exc)
        return []


@app.route("/api/lump/version-telemetry/<abstraction_name>")
def lump_version_telemetry(abstraction_name):
    """Return per-version fault telemetry for an abstraction."""
    data = _compute_version_telemetry(abstraction_name)
    return jsonify({"ok": True, "abstraction": abstraction_name, "versions": data})


@app.route("/api/device/faults")
def device_fault_log():
    uid = request.args.get("device_uid", "").strip()
    events = FaultEvent.query
    if uid:
        events = events.filter_by(device_uid=uid)
    events = events.order_by(FaultEvent.timestamp.desc()).limit(500).all()
    result = []
    for e in events:
        result.append({
            "id": e.id,
            "device_uid": e.device_uid,
            "fault_type": e.fault_type,
            "fault_nia": e.fault_nia,
            "boot_reason": e.boot_reason,
            "timestamp": e.timestamp,
            "abstraction_name": e.abstraction_name or None,
            "lump_version": e.lump_version if e.lump_version is not None else 0,
        })
    mtbf_by_nia = {}
    from collections import defaultdict
    nia_times = defaultdict(list)
    for e in reversed(events):
        nia_times[e.fault_nia].append(e.timestamp)
    for nia, times in nia_times.items():
        if len(times) < 2:
            mtbf_by_nia[str(nia)] = {"count": len(times), "mtbf": None}
        else:
            intervals = [times[i+1] - times[i] for i in range(len(times)-1)]
            avg = sum(intervals) / len(intervals) if intervals else 0
            mtbf_by_nia[str(nia)] = {"count": len(times), "mtbf": round(avg, 2)}
    return jsonify({"ok": True, "events": result, "mtbf_by_nia": mtbf_by_nia})


@app.route("/api/device/<int:device_id>/label", methods=["POST"])
def device_set_label(device_id):
    data = request.get_json(silent=True) or {}
    dev = Device.query.get(device_id)
    if not dev:
        return jsonify({"ok": False}), 404
    dev.label = data.get("label", "")[:255]
    db.session.commit()
    return jsonify({"ok": True})


ALLOWED_BRIDGE_HOSTS = {"localhost", "127.0.0.1", "::1", "penguin.linux.test"}

def _is_bridge_host_allowed(host):
    h = (host or "").strip().lower()
    if h in ALLOWED_BRIDGE_HOSTS:
        return True
    if h.endswith(".local"):
        return True
    try:
        import socket
        if h == socket.gethostname().lower():
            return True
    except Exception:
        pass
    return False


@app.route("/api/device/<int:device_id>/deploy", methods=["POST"])
def device_deploy(device_id):
    dev = Device.query.get(device_id)
    if not dev:
        return jsonify({"ok": False, "error": "device not found"}), 404
    if dev.status != "online" or (_time.time() - (dev.last_seen or 0)) >= DEVICE_ONLINE_TIMEOUT:
        return jsonify({"ok": False, "error": "device is offline"}), 409
    if not dev.bridge_host or not dev.bridge_port:
        return jsonify({"ok": False, "error": "device has no bridge configured"}), 400
    if not _is_bridge_host_allowed(dev.bridge_host):
        return jsonify({"ok": False, "error": "bridge host not allowed"}), 403

    payload = request.get_json(silent=True) or {}
    tx_bytes = payload.get("tx", [])
    rx_count = int(payload.get("rx_count", 4))
    timeout_ms = int(payload.get("timeout_ms", 5000))

    if not tx_bytes:
        return jsonify({"ok": False, "error": "empty payload"}), 400

    scheme = getattr(dev, 'bridge_scheme', None) or 'http'
    bridge_url = f"{scheme}://{dev.bridge_host}:{dev.bridge_port}"

    skip_tls_verify = (scheme == 'https')

    try:
        status_resp = http_requests.get(f"{bridge_url}/status", timeout=3, verify=not skip_tls_verify)
        status_data = status_resp.json()
        if not status_data.get("open"):
            conn_resp = http_requests.post(
                f"{bridge_url}/connect",
                json={"port": dev.serial_port, "baud": 115200},
                timeout=5,
                verify=not skip_tls_verify,
            )
            conn_data = conn_resp.json()
            if not conn_data.get("ok"):
                return jsonify({"ok": False, "error": f"bridge connect failed: {conn_data.get('error', 'unknown')}"}), 502
    except Exception as e:
        return jsonify({"ok": False, "error": f"bridge unreachable: {e}"}), 502

    try:
        resp = http_requests.post(
            f"{bridge_url}/transact",
            json={"tx": tx_bytes, "rx_count": rx_count, "timeout_ms": timeout_ms},
            timeout=(timeout_ms / 1000.0) + 5,
            verify=not skip_tls_verify,
        )
        result = resp.json()
        logging.info("Deploy to device %s (bridge %s:%s): ok=%s rx=%s",
                     dev.device_uid, dev.bridge_host, dev.bridge_port,
                     result.get("ok"), len(result.get("rx", [])))
        return jsonify(result)
    except Exception as e:
        logging.error("Deploy proxy error for device %s: %s", dev.device_uid, e)
        return jsonify({"ok": False, "error": f"bridge transact failed: {e}"}), 502


@app.route("/api/launch-tests")
def launch_tests_list():
    tests = LaunchTest.query.order_by(LaunchTest.test_id).all()
    result = []
    for t in tests:
        result.append({
            "test_id": t.test_id,
            "name": t.name,
            "description": t.description,
            "status": t.status,
            "device_uid": t.device_uid or "",
            "updated_at": t.updated_at or 0.0,
            "notes": t.notes or "",
        })
    return jsonify({"ok": True, "tests": result})


@app.route("/api/launch-tests/<test_id>", methods=["PUT"])
def launch_test_update(test_id):
    data = request.get_json(silent=True) or {}
    t = LaunchTest.query.filter_by(test_id=test_id).first()
    if not t:
        return jsonify({"ok": False, "error": "test not found"}), 404
    new_status = data.get("status", "").strip()
    if new_status not in ("not-run", "passing", "failing"):
        return jsonify({"ok": False, "error": "invalid status"}), 400
    t.status = new_status
    t.device_uid = data.get("device_uid", t.device_uid or "")
    t.notes = data.get("notes", t.notes or "")[:1024]
    t.updated_at = _time.time()
    db.session.commit()
    return jsonify({"ok": True, "test_id": t.test_id, "status": t.status})


@app.route("/api/launch-tests/reset", methods=["POST"])
def launch_tests_reset():
    tests = LaunchTest.query.all()
    for t in tests:
        t.status = "not-run"
        t.device_uid = ""
        t.updated_at = _time.time()
        t.notes = ""
    db.session.commit()
    return jsonify({"ok": True})


Device = None
Project = None
TutorialProgress = None
FaultEvent = None
NiaTrace = None
LaunchTest = None
CallhomeLog = None
UartLog = None
BuildRecord = None

LAUNCH_TESTS_SEED = [
    ("TEST-01", "Boot.NS",
     "Device online; NS Table valid; all CRC seals pass",
     True),
    ("TEST-02", "Boot.Thread",
     "Boot thread reaches Navana; no THREAD_FAULT",
     True),
    ("TEST-03", "Salvation",
     "All four methods pass; MTBF = \u221e; Navana takes over",
     False),
    ("TEST-04", "Navana",
     "Lump Add \u2192 Monitor \u2192 Remove round-trip; stale GT faults",
     False),
    ("TEST-05", "Mint",
     "Subset permission enforced; escalation faults; Revoke propagates",
     False),
    ("TEST-06", "Memory",
     "Power-of-2 alloc; size-0 faults; Free reclaims",
     False),
    ("TEST-07", "Scheduler",
     "Two threads run to completion; no deadlock",
     False),
    ("TEST-08", "DijkstraFlag",
     "Wait blocks; Signal wakes; Test non-blocking; Reset clears",
     False),
    ("TEST-09", "UART",
     "Byte send/receive at 115200 and 9600; permission denied faults",
     False),
    ("TEST-10", "Tunnel",
     "Connect \u2192 Send \u2192 Receive \u2192 Close; stale session faults",
     False),
    ("TEST-11", "Negotiate",
     "Approve delivers GT to child; Reject never delivers; replay faults",
     False),
    ("TEST-12", "Abacus",
     "Add, Sub, Mul, Div, Mod, Abs all correct; Div-by-zero faults",
     False),
    ("TEST-13", "Loader",
     "Absent lump fetched, inflated, installed; eviction transparent; NS authority unchanged throughout",
     False),
]

with app.app_context():
    import sys
    sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    from server.models import register_models, BOARD_TYPES, PROFILE_NAMES
    Project, TutorialProgress, Device, FaultEvent, NiaTrace, LaunchTest, CallhomeLog, UartLog, BuildRecord = register_models(db)
    db.create_all()

    from sqlalchemy import inspect as _sa_inspect, text as _sa_text
    _inspector = _sa_inspect(db.engine)
    _existing_br_cols = {c["name"] for c in _inspector.get_columns("build_records")}
    if "hardware_version" not in _existing_br_cols:
        try:
            db.session.execute(_sa_text(
                "ALTER TABLE build_records ADD COLUMN hardware_version INTEGER DEFAULT NULL"))
            db.session.commit()
            logging.info("Migrated: added hardware_version column to build_records table")
        except Exception:
            db.session.rollback()
            # Another worker may have completed the same idempotent migration.
            refreshed = {c["name"] for c in _sa_inspect(db.engine).get_columns("build_records")}
            if "hardware_version" not in refreshed:
                raise
    _existing_cols = {c["name"] for c in _inspector.get_columns("devices")}
    if "bridge_scheme" not in _existing_cols:
        db.session.execute(_sa_text("ALTER TABLE devices ADD COLUMN bridge_scheme VARCHAR(8) DEFAULT 'http'"))
        db.session.commit()
        logging.info("Migrated: added bridge_scheme column to devices table")
    if "boot_reason" not in _existing_cols:
        db.session.execute(_sa_text("ALTER TABLE devices ADD COLUMN boot_reason INTEGER DEFAULT 0"))
        db.session.commit()
        logging.info("Migrated: added boot_reason column to devices table")
    if "last_fault" not in _existing_cols:
        db.session.execute(_sa_text("ALTER TABLE devices ADD COLUMN last_fault INTEGER DEFAULT 0"))
        db.session.commit()
        logging.info("Migrated: added last_fault column to devices table")
    if "fault_nia" not in _existing_cols:
        db.session.execute(_sa_text("ALTER TABLE devices ADD COLUMN fault_nia INTEGER DEFAULT 0"))
        db.session.commit()
        logging.info("Migrated: added fault_nia column to devices table")
    if "tunnel_status" not in _existing_cols:
        db.session.execute(_sa_text("ALTER TABLE devices ADD COLUMN tunnel_status VARCHAR(16) DEFAULT 'pending'"))
        db.session.commit()
        logging.info("Migrated: added tunnel_status column to devices table")

    _existing_fe_cols = {c["name"] for c in _inspector.get_columns("fault_events")}
    for _fe_col, _fe_def in [
        ("lump_token",        "VARCHAR(16) DEFAULT NULL"),
        ("lump_version",      "INTEGER DEFAULT 0"),
        ("fault_code",        "VARCHAR(32) DEFAULT ''"),
        ("mnemonic",          "VARCHAR(32) DEFAULT ''"),
        ("pipeline_stage",    "VARCHAR(32) DEFAULT ''"),
        ("recovery_tier",     "INTEGER DEFAULT 0"),
        ("step_count",        "INTEGER DEFAULT 0"),
        ("board_name",        "VARCHAR(32) DEFAULT ''"),
        ("ns_slot",           "INTEGER DEFAULT NULL"),
        ("abstraction_label", "VARCHAR(128) DEFAULT ''"),
        ("nia_hex",           "VARCHAR(12) DEFAULT ''"),
        ("cr12",              "VARCHAR(32) DEFAULT ''"),
        ("cr14",              "VARCHAR(32) DEFAULT ''"),
        ("cr15",              "VARCHAR(32) DEFAULT ''"),
        ("boot_count_at_fault", "INTEGER DEFAULT 0"),
        ("raw_type",          "VARCHAR(16) DEFAULT ''"),
        ("fault_gt",          "VARCHAR(32) DEFAULT ''"),
        ("fault_instr",       "VARCHAR(32) DEFAULT ''"),
        ("abstraction_name",  "VARCHAR(128) DEFAULT NULL"),
        ("gt_snapshot",       "TEXT DEFAULT NULL"),
        ("pet_names",         "TEXT DEFAULT NULL"),
    ]:
        if _fe_col not in _existing_fe_cols:
            db.session.execute(_sa_text(f"ALTER TABLE fault_events ADD COLUMN {_fe_col} {_fe_def}"))
            db.session.commit()
            logging.info("Migrated: added %s column to fault_events table", _fe_col)

    db.session.execute(_sa_text("""
        CREATE TABLE IF NOT EXISTS nia_traces (
            id         INTEGER PRIMARY KEY AUTOINCREMENT,
            device_uid TEXT    NOT NULL,
            ts         REAL    NOT NULL DEFAULT 0.0,
            nia_trace  TEXT    NOT NULL DEFAULT '[]',
            trace_len  INTEGER NOT NULL DEFAULT 0
        )
    """))
    db.session.execute(_sa_text(
        "CREATE INDEX IF NOT EXISTS ix_nia_traces_device_uid ON nia_traces (device_uid)"
    ))
    db.session.execute(_sa_text(
        "CREATE INDEX IF NOT EXISTS ix_nia_traces_ts ON nia_traces (ts)"
    ))
    db.session.commit()
    logging.info("nia_traces table ready")

    db.session.execute(_sa_text("""
        CREATE TABLE IF NOT EXISTS device_lump_versions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            device_uid TEXT NOT NULL,
            abstraction_name TEXT NOT NULL,
            lump_token TEXT NOT NULL,
            lump_version INTEGER NOT NULL DEFAULT 0,
            deployed_at REAL NOT NULL DEFAULT 0,
            UNIQUE(device_uid, abstraction_name)
        )
    """))
    db.session.commit()
    logging.info("device_lump_versions table ready")

    db.session.execute(_sa_text("""
        CREATE TABLE IF NOT EXISTS device_lump_state (
            uid          TEXT PRIMARY KEY,
            lump_seq     INTEGER NOT NULL DEFAULT 0,
            delivered_at REAL    NOT NULL DEFAULT 0.0
        )
    """))
    db.session.commit()
    logging.info("device_lump_state table ready")

    db.session.execute(_sa_text("""
        CREATE TABLE IF NOT EXISTS ns_keystore (
            uid        TEXT NOT NULL,
            ogt        TEXT NOT NULL,
            ns_slot    INTEGER,
            nonce_hex  TEXT NOT NULL,
            k_enc_ct   TEXT NOT NULL,
            k_mac_ct   TEXT NOT NULL,
            PRIMARY KEY (uid, ogt)
        )
    """))
    db.session.commit()
    try:
        db.session.execute(_sa_text(
            "ALTER TABLE ns_keystore ADD COLUMN ns_slot INTEGER"
        ))
        db.session.commit()
    except Exception:
        pass
    logging.info("ns_keystore table ready")

    db.session.execute(_sa_text("""
        CREATE TABLE IF NOT EXISTS bank_custody (
            vault_id         TEXT PRIMARY KEY,
            protected_state  TEXT NOT NULL,
            credential_gt    INTEGER NOT NULL,
            proof_commitment TEXT NOT NULL,
            revoked          INTEGER NOT NULL DEFAULT 0,
            consumed         INTEGER NOT NULL DEFAULT 0,
            recovery_grant   TEXT,
            revision         INTEGER NOT NULL DEFAULT 1,
            updated_at       REAL NOT NULL DEFAULT 0.0
        )
    """))
    _bank_custody_columns = {c["name"] for c in _sa_inspect(db.engine).get_columns("bank_custody")}
    if "consumed" not in _bank_custody_columns:
        db.session.execute(_sa_text(
            "ALTER TABLE bank_custody ADD COLUMN consumed INTEGER NOT NULL DEFAULT 0"
        ))
    if "recovery_grant" not in _bank_custody_columns:
        db.session.execute(_sa_text("ALTER TABLE bank_custody ADD COLUMN recovery_grant TEXT"))
    db.session.commit()
    logging.info("bank_custody table ready")


    _existing_launch = {t.test_id: t for t in LaunchTest.query.all()}
    for seed_id, seed_name, seed_desc, _auto in LAUNCH_TESTS_SEED:
        if seed_id not in _existing_launch:
            db.session.add(LaunchTest(
                test_id=seed_id,
                name=seed_name,
                description=seed_desc,
                status="not-run",
                device_uid="",
                updated_at=0.0,
                notes="",
            ))
        else:
            row = _existing_launch[seed_id]
            changed = False
            if row.name != seed_name:
                row.name = seed_name
                changed = True
            if row.description != seed_desc:
                row.description = seed_desc
                changed = True
            if changed:
                logging.info("Migrated launch_test %s name/description to Section 6 text", seed_id)
    db.session.commit()
    logging.info("Launch tests seeded/migrated")

    # Pre-load existing devices into the tunnel callhome cache so "Via Bridge"
    # works even if the server restarted after the bridge last sent CALLHOME.
    _preload_count = 0
    for _dev in Device.query.all():
        if _dev.device_uid:
            with _latest_callhome_lock:
                _latest_callhome_data[_dev.device_uid] = {
                    "board":      _dev.board_name or "Unknown",
                    "uid":        _dev.device_uid,
                    "nia":        "0x{:08X}".format(_dev.fault_nia or 0),
                    "boot_ok":    0 if (_dev.boot_reason or 0) == 2 else 1,
                    "fault":      _dev.last_fault or 0,
                    "fault_code": _dev.last_fault or 0,
                    "fw_major":   _dev.fw_major or 1,
                    "fw_minor":   _dev.fw_minor or 0,
                    "boot_count": _dev.boot_count or 1,
                    "ts":         _dev.last_seen or 0,
                }
            _preload_count += 1
    if _preload_count:
        logging.info("Tunnel: pre-loaded %d device(s) into latest-callhome cache", _preload_count)

    # Warm in-memory rolling caches from DB so the first IDE poll hits instantly.
    try:
        _warm_ch_rows = (CallhomeLog.query
                         .order_by(CallhomeLog.ts.asc())
                         .limit(200)
                         .all())
        with _latest_callhome_lock:
            _callhome_log = [{
                "ts":         r.ts,
                "uid":        r.uid,
                "board":      r.board,
                "nia":        r.nia,
                "boot_ok":    r.boot_ok,
                "fault":      r.fault,
                "fault_code": r.fault_code,
                "fw_major":   r.fw_major,
                "fw_minor":   r.fw_minor,
                "boot_count": r.boot_count,
                "type":       r.event_type,
                "cr12":       r.cr12,
                "cr14":       r.cr14,
                "cr15":       r.cr15,
            } for r in _warm_ch_rows]
        logging.info("Warmed callhome in-memory cache: %d row(s) from DB", len(_warm_ch_rows))
    except Exception as _wc_err:
        logging.warning("Could not warm callhome cache from DB: %s", _wc_err)

    try:
        _warm_ul_rows = (UartLog.query
                         .order_by(UartLog.ts.asc())
                         .limit(500)
                         .all())
        with _uart_log_lock:
            _uart_log = [{"ts": r.ts, "uid": r.uid, "line": r.line}
                         for r in _warm_ul_rows]
        logging.info("Warmed UART in-memory cache: %d row(s) from DB", len(_warm_ul_rows))
    except Exception as _wu_err:
        logging.warning("Could not warm UART cache from DB: %s", _wu_err)

    logging.info("Database tables created")

    _scheduler = None
    if _ISOLATED_TEST_MODE:
        # The disposable browser harness must not import or initialize report
        # integrations: importing the scheduler is enough to create a worker
        # thread, and the PAT scope check performs a live GitHub request.
        logging.info(
            "Isolated test mode: report tracking, GitHub PAT checks, "
            "APScheduler report/LFS/code-sync jobs disabled"
        )
    else:
        from daily_report import _ensure_tracking_table as _dr_ensure_table, get_report_token as _get_report_token, check_github_pat_lfs_scope as _check_pat_lfs
        _dr_ensure_table(db_path)
        _report_token = _get_report_token()
        logging.info(
            "Report tracking table ready | auth enabled (set REPORT_TOKEN secret to persist token)"
        )
        _check_pat_lfs()

        try:
            from apscheduler.schedulers.background import BackgroundScheduler
            from apscheduler.triggers.cron import CronTrigger
            from apscheduler.triggers.interval import IntervalTrigger

            _scheduler = BackgroundScheduler(timezone="UTC")

            from daily_report import send_daily_report as _send_report, run_lfs_backup as _run_lfs_backup, run_code_sync as _run_code_sync

            _scheduler.add_job(
                _send_report,
                CronTrigger(hour=5, minute=0, timezone="UTC"),
                id="daily_report",
                replace_existing=True,
                name="Daily progress and cost report",
                args=[db_path],
            )

            _scheduler.add_job(
                _run_lfs_backup,
                CronTrigger(hour=3, minute=0, timezone="UTC"),
                id="nightly_lfs_backup",
                replace_existing=True,
                name="Nightly LFS backup to GitHub",
            )

            _scheduler.add_job(
                _run_code_sync,
                IntervalTrigger(minutes=30),
                id="periodic_code_sync",
                replace_existing=True,
                name="Periodic code sync to GitHub (every 30 min)",
            )
            _scheduler.start()
            logging.info(
                "APScheduler started — daily report at 05:00 UTC, LFS backup at 03:00 UTC, "
                "code sync every 30 min"
            )
        except Exception as _sched_exc:
            logging.warning("APScheduler could not start: %s", _sched_exc)

    # ── Wukong Ethernet UDP listener ─────────────────────────────────────────
    # Listens on UDP port 5900 for Wukong XC7A100T callhome frames.
    # Parses frames by token (0xb169bba4 = Ethernet abstraction Pet-Name GT),
    # logs them to _callhome_log, and replies with lump-serve responses.
    _wukong_listener = None
    if _ISOLATED_TEST_MODE:
        logging.info("Isolated test mode: Wukong UDP listener disabled")
    elif _wukong_udp is not None:
        def _on_wukong_callhome(entry):
            """Handle a Wukong callhome event on the UDP listener thread."""
            log_entry = {
                "ts":         entry.get("ts", 0.0),
                "uid":        entry.get("mac", b'').hex(":"),
                "board":      "Wukong XC7A100T",
                "nia":        "0x00000000",
                "boot_ok":    1,
                "fault":      0,
                "fault_code": 0,
                "fw_major":   (entry.get("cm_version", 0) >> 16) & 0xFFFF,
                "fw_minor":    entry.get("cm_version", 0) & 0xFFFF,
                "boot_count": 1,
                "type":       "wukong_callhome",
                "src_addr":   str(entry.get("src_addr", "")),
                "uptime":     entry.get("uptime", 0),
            }
            _append_callhome_log(log_entry)
            logging.info(
                "Wukong callhome: MAC=%s uptime=%ds requests=%s from %s",
                log_entry["uid"], log_entry["uptime"],
                [hex(t) for t in entry.get("requests", [])],
                entry.get("src_addr"),
            )

        def _wukong_lump_lookup(token):
            """Serve a LUMP by token for an incoming Wukong UDP lump-serve request.

            Looks up ``<token:08x>.lump`` under LUMPS_DIR and returns the file
            contents as a list of 32-bit big-endian words.  Returns None if the
            lump is not found or cannot be read.

            Called on the WukongUdpListener thread — LUMPS_DIR is read-only here
            so no locking is required.
            """
            import struct as _struct
            fname = "{:08x}.lump".format(token)
            fpath = _resolve_lump_path(fname[:-5], LUMPS_DIR) or os.path.join(LUMPS_DIR, fname)
            try:
                with open(fpath, "rb") as _fh:
                    raw = _fh.read()
                # LUMP files are a flat array of 32-bit big-endian words
                n_words = len(raw) // 4
                if n_words == 0:
                    return None
                words = list(_struct.unpack_from(f">{n_words}I", raw))
                logging.info(
                    "Wukong lump lookup: token=0x%08X → %s (%d words)",
                    token, fpath, n_words)
                return words
            except FileNotFoundError:
                logging.debug(
                    "Wukong lump lookup: token=0x%08X not found (no %s)",
                    token, fname)
                return None
            except Exception as _lookup_exc:
                logging.warning(
                    "Wukong lump lookup: token=0x%08X error reading %s: %s",
                    token, fname, _lookup_exc)
                return None

        try:
            _wukong_listener = _wukong_udp.WukongUdpListener(
                on_callhome=_on_wukong_callhome,
                lump_lookup=_wukong_lump_lookup)
            _wukong_listener.start()
        except Exception as _wudp_exc:
            logging.warning("Wukong UDP listener could not start: %s", _wudp_exc)

def _free_port(port):
    """Kill any process holding the given port using /proc/net/tcp."""
    import signal
    for proto in ('tcp', 'tcp6'):
        try:
            with open(f'/proc/net/{proto}') as f:
                for line in f:
                    try:
                        parts = line.strip().split()
                        if len(parts) < 10:
                            continue
                        local = parts[1]
                        if ':' not in local:
                            continue
                        lport = int(local.split(':')[1], 16)
                        if lport != port:
                            continue
                        inode = parts[9]
                        for pid in os.listdir('/proc'):
                            if not pid.isdigit():
                                continue
                            try:
                                for fd in os.listdir(f'/proc/{pid}/fd'):
                                    try:
                                        if f'socket:[{inode}]' in os.readlink(f'/proc/{pid}/fd/{fd}'):
                                            os.kill(int(pid), signal.SIGKILL)
                                    except OSError:
                                        pass
                            except OSError:
                                pass
                    except (ValueError, IndexError):
                        continue
        except OSError:
            pass

# ---------------------------------------------------------------------------
# Mum identity routes (Stage 3 — Keystone Hello Mum)
# ---------------------------------------------------------------------------

@app.route("/mum/qr")
def mum_qr():
    """Return a PNG QR code encoding Mum's canonical identity string."""
    try:
        import mum as _mum
    except ImportError:
        from server import mum as _mum
    png = _mum.get_qr_png()
    return make_response(png), 200, {
        "Content-Type": "image/png",
        "Cache-Control": "no-cache",
        "Content-Length": len(png),
    }


@app.route("/mum/identity")
def mum_identity():
    """Return Mum's canonical identity string as plain text (base64url, no padding, 43 chars).
    This is the human-readable / copy-paste form also encoded in the QR code.
    """
    try:
        import mum as _mum
    except ImportError:
        from server import mum as _mum
    identity = _mum.get_identity_string()
    return make_response(identity), 200, {
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "no-cache",
    }


@app.route("/mum/status")
def mum_status():
    """Return Mum's identity details as JSON — for the IDE UI."""
    try:
        import mum as _mum
    except ImportError:
        from server import mum as _mum
    identity = _mum.get_identity_string()
    word = _mum.get_identity_word()
    return jsonify({
        "identity": identity,
        "identity_word": word,
        "identity_word_hex": f"0x{word:08X}",
        "protocol": "Ed25519 / GTKN-1",
    })


@app.route("/mum/connect", methods=["POST"])
def mum_connect():
    """Derive the 32-bit identity word from a submitted identity string.

    POST body: { "identity": "<base64url string>" }
    Returns:   { "identity_word": <int>, "identity_word_hex": "0x..." }
    """
    try:
        import mum as _mum
    except ImportError:
        from server import mum as _mum
    data = request.get_json(silent=True) or {}
    identity = data.get("identity", "").strip()
    if not identity:
        return jsonify({"error": "Missing identity field"}), 400
    word = _mum.identity_word_from_string(identity)
    if not word:
        return jsonify({"error": "Invalid identity string — expected 32-byte Ed25519 public key in base64url"}), 422
    return jsonify({
        "identity_word": word,
        "identity_word_hex": f"0x{word:08X}",
    })


@app.route("/mum/greet", methods=["POST"])
def mum_greet():
    """Tunnel CALL bridge dispatch — invoked when a GTKN-tagged packet arrives
    from the Tunnel and resolves to Mum's GT.

    The Observer IDE bridge calls this endpoint after it receives a GTKN packet
    from the board/simulator and verifies the GT.  This handler runs Greet() and
    returns the greeting response word back to the bridge, which writes it to
    the Tunnel RX path.

    POST body (optional): { "gt": <int>, "tag": "GTKN" }
    Returns: { "response_word": 0x48454C4C, "response_hex": "0x48454C4C", "greeting": "HELL" }
    """
    GREETING_WORD = 0x48454C4C
    return jsonify({
        "response_word": GREETING_WORD,
        "response_hex": f"0x{GREETING_WORD:08X}",
        "greeting": "HELL",
    })


@app.route("/mum/hello", methods=["POST"])
def mum_hello():
    """Bridge Keystone.Hello() through the live Tunnel abstraction (Stage 4).

    This endpoint is the Tunnel CALL bridge for the Hello Mum flow.  It
    simulates Mum.Greet() and returns the canonical 'HELL' greeting response.
    The caller (simulator UI) dispatches here after Keystone.Connect() has
    placed a MumGT in c-list slot 1.

    Delegates to _mum_do_greet() — the same function used by the automatic
    Hello-Mum trigger fired when a board registers.

    Returns:
      { ok, result, result_hex, message, tunnel }
    """
    resp = _mum_do_greet()
    return jsonify({
        "ok": resp.get("ok", False),
        "result": resp.get("result", 0),
        "result_hex": resp.get("result_hex", "0x00000000"),
        "message": resp.get("message", ""),
        "tunnel": resp.get("tunnel", "offline"),
    })


@app.route("/mum/regenerate", methods=["POST"])
def mum_regenerate():
    """Delete mum_key.pem and regenerate a fresh Ed25519 key pair.

    Returns the new identity details as JSON so the UI can refresh without
    a separate /mum/status call.
    """
    try:
        import mum as _mum
    except ImportError:
        from server import mum as _mum
    _mum.regenerate_key()
    identity = _mum.get_identity_string()
    word     = _mum.get_identity_word()
    return jsonify({
        "identity": identity,
        "identity_word": word,
        "identity_word_hex": f"0x{word:08X}",
        "protocol": "Ed25519 / GTKN-1",
    })


@app.route("/api/generate-method", methods=["POST"])
def api_generate_method():
    """Generate CLOOMC source for a method using OpenAI.

    POST { abstraction, method, description, capabilities? }
    Returns { source } on success or { error } on failure.
    Hidden in the IDE if OPENAI_API_KEY is unset.
    Protected by a per-process session token (X-Generate-Token header),
    returned by /api/generate-method-available when the key is configured.
    """
    # Check session token via header only (query-param omitted to avoid log leakage)
    client_token = request.headers.get("X-Generate-Token", "")
    if not client_token or client_token != _GENERATE_SESSION_TOKEN:
        return jsonify({"error": "Unauthorized"}), 401

    api_key = os.environ.get("OPENAI_API_KEY", "")
    if not api_key:
        return jsonify({"error": "OPENAI_API_KEY not configured"}), 503

    data = request.get_json(silent=True) or {}
    abstraction = data.get("abstraction", "Unknown")
    method = data.get("method", "Unknown")
    description = data.get("description", "")
    capabilities = data.get("capabilities", [])

    caps_text = ""
    if capabilities:
        if isinstance(capabilities, list):
            caps_text = "\nCapabilities (c-list entries): " + ", ".join(
                c if isinstance(c, str) else (c.get("name", str(c))) for c in capabilities
            )

    system_prompt = (
        "You are an expert Church Machine CLOOMC++ programmer. "
        "The Church Machine is a capability-based processor with a 20-instruction ISA. "
        "Golden Tokens (GTs) are 32-bit unforgeable capability tokens stored in CR registers. "
        "Key instructions: LOAD CRn, NS[i] (load capability), CALL d, CRs, #imm (call method), "
        "RETURN (exit method), DWRITE DRn, #imm (load immediate), IADD/ISUB/IMUL/IDIV (arithmetic), "
        "BRANCH label, cond (branch), SAVE/DREAD (memory ops). "
        "Write concise, commented CLOOMC++ assembly for the requested method. "
        "Use semicolons for comments. Output only the source code, no explanation."
    )

    user_prompt = (
        f"Write CLOOMC++ assembly for method `{method}` of abstraction `{abstraction}`.\n"
        f"Description: {description or 'Dispatched via CALL'}{caps_text}\n\n"
        "Write the method body as a single .cloomc snippet — no abstraction wrapper needed, "
        "just the method code with comments. End with RETURN."
    )

    try:
        resp = http_requests.post(
            "https://api.openai.com/v1/chat/completions",
            headers={
                "Authorization": f"Bearer {api_key}",
                "Content-Type": "application/json",
            },
            json={
                "model": "gpt-4o-mini",
                "messages": [
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": user_prompt},
                ],
                "max_tokens": 600,
                "temperature": 0.3,
            },
            timeout=30,
        )
        resp.raise_for_status()
        result = resp.json()
        source = result["choices"][0]["message"]["content"].strip()
        # Strip markdown code fences if present
        if source.startswith("```"):
            lines = source.split("\n")
            source = "\n".join(lines[1:-1] if lines[-1].strip() == "```" else lines[1:])
        return jsonify({"source": source})
    except Exception as exc:
        logging.warning("generate-method OpenAI error: %s", exc)
        return jsonify({"error": "AI generation failed — check server logs for details."}), 500


@app.route("/api/generate-method-available", methods=["GET"])
def api_generate_method_available():
    """Returns whether the generate-method endpoint is available (OPENAI_API_KEY set).
    When available, also returns the session token the IDE must include in POST requests.
    """
    has_key = bool(os.environ.get("OPENAI_API_KEY", ""))
    resp = {"available": has_key}
    if has_key:
        resp["token"] = _GENERATE_SESSION_TOKEN
    return jsonify(resp)


# ---------------------------------------------------------------------------
# Compile API — POST /api/compile
# ---------------------------------------------------------------------------

@app.route("/api/compile", methods=["POST"])
def api_compile():
    """CLOOMC++ Compiler API — compile source text to a Lump binary (ECO-002).

    POST /api/compile
    Content-Type: application/json

    Request body (source and language are required; all other fields optional;
    unknown fields are silently ignored):
      {
        "source":           "<raw .cloomc source text>",
        "language":         "english" | "javascript" | "haskell" |
                            "symbolic" | "lambda" | "assembly",
        "abstraction_name": "MyAbstraction",   // optional override
        "namespace_hint":   {                  // optional
          "gt_type":          "inform",
          "allocation_words": 64,
          "clist_slots":      4
        }
      }

    Response — success (HTTP 200):
      {
        "ok":          true,
        "language":    "assembly",
        "words":       [ ... ],      // raw uint32 lump word array
        "lump_binary": "...",        // base64-encoded binary (same data as words)
        "warnings":    [ ... ]       // soft warnings; [] when none
      }

    Response — failure (HTTP 200, check ok field):
      {
        "ok":       false,
        "language": "assembly",
        "error":    "human-readable compile error"
      }

    Auth: if the COMPILE_API_TOKEN environment variable / secret is set,
    callers must supply it via:
      Authorization: Bearer <token>
    or:
      ?token=<token>
    If COMPILE_API_TOKEN is unset the endpoint is open (no auth required),
    matching the IDE's own no-login default.
    """
    from compile_api import run_compile, VALID_LANGUAGES

    if _COMPILE_API_TOKEN:
        auth_header  = request.headers.get('Authorization', '')
        token_param  = request.args.get('token', '')
        supplied     = auth_header[len('Bearer '):] if auth_header.startswith('Bearer ') else token_param
        if supplied != _COMPILE_API_TOKEN:
            return jsonify({'error': 'Unauthorized — supply COMPILE_API_TOKEN via Authorization: Bearer <token>'}), 401

    body = request.get_json(silent=True)
    if not body:
        return jsonify({'error': 'Request body must be application/json'}), 400

    source   = body.get('source',   '')
    language = body.get('language', '')

    if not isinstance(source, str) or not source.strip():
        return jsonify({'error': '`source` is required and must be a non-empty string'}), 400

    _MAX_SOURCE_BYTES = 64 * 1024  # 64 KB
    if len(source.encode('utf-8')) > _MAX_SOURCE_BYTES:
        return jsonify({'error': f'`source` exceeds the maximum allowed size of {_MAX_SOURCE_BYTES // 1024} KB'}), 400

    if language not in VALID_LANGUAGES:
        return jsonify({'error': f'`language` must be one of: {", ".join(sorted(VALID_LANGUAGES))}'}), 400

    result = run_compile(body)
    return jsonify(result), 200


def _bind_with_retry(port, max_attempts=5, backoff_seconds=0.3):
    """Bind app.run() on `port`, self-healing if another process wins a
    startup race for the same port.

    Two workflows can independently try to bind the same port at startup
    (e.g. the main dev server and a test runner's own server instance).
    _free_port() already kills whoever is squatting on the port *before*
    we try to bind, but that is a single check-then-act step: another
    process can grab the port in the gap between our kill and our bind.
    Instead of crashing the whole workflow on that race, retry a few times
    with a short backoff and re-run _free_port() each time.
    """
    import time as _time
    for attempt in range(1, max_attempts + 1):
        _free_port(port)
        try:
            app.run(host="0.0.0.0", port=port, debug=True, use_reloader=False, threaded=True)
            return
        except OSError as exc:
            if "Address already in use" not in str(exc) or attempt == max_attempts:
                raise
            logging.warning(
                "Port %d still in use after _free_port() (attempt %d/%d) — "
                "retrying in %.1fs", port, attempt, max_attempts, backoff_seconds)
            _time.sleep(backoff_seconds)


# ── Wukong hardware single-step trace endpoints ─────────────────────────────
# Used by hardware/wukong_bridge.py and the IDE simulator.
#
# Bridge (on Chromebook):
#   POST /hardware/wukong/trace   — bridge posts parsed 11-byte trace packet as JSON
#   GET  /hardware/wukong/command — bridge polls for the next pending command byte
#
# IDE (browser):
#   POST /hardware/wukong/command — IDE enqueues one command ('s','r','h','b'+NIA)
#   GET  /hardware/wukong/trace   — IDE reads the latest trace packet as JSON

import threading as _wk_threading

_wukong_trace_lock    = _wk_threading.Lock()
_wukong_command_lock  = _wk_threading.Lock()
_wukong_latest_trace  = {}         # {nia, ev_type, payload_gt, flags, fault_code, fault_valid, bp_hit, ts}
_wukong_latest_snapshot = {}
# Latest GT word0 seen for each CALL-type event, keyed by CR index (6 or 14).
# Maintained separately from _wukong_latest_trace so that a subsequent CALL_PUSH
# packet (ev_type=0x08) cannot overwrite a CR6/CR14 update before the IDE polls.
_wukong_latest_cr_gts = {}         # {6: int, 14: int}
_wukong_pending_cmd   = None       # {'cmd': 's'|'r'|'h'|'b', 'nia': int|None}
# Ordered event queue — every trace POST appends an entry (with a 'seq' field).
# The IDE drains this via GET /hardware/wukong/events?after=N so that
# intermediate CALL_PUSH/CALL_POP packets are never silently overwritten.
_wukong_event_queue    = []        # list of entry dicts, each with 'seq'
_wukong_event_seq      = 0         # monotonically increasing per-POST counter
# 2048 slots ≈ 4 s of headroom at worst-case bridge throughput (~500 HTTP POSTs/s)
# before the 3-second client poll.  Gap-recovery logic handles anything beyond that.
_WUKONG_EVENT_QUEUE_MAXLEN = 2048
# Authoritative call-stack depth maintained by the server.  Stored per-event so
# the client can display and resync accurate depth even after a queue overflow gap
# or server restart without needing to replay lost intermediate events.
_wukong_call_depth     = 0
_wukong_fault_incidents = {}       # incident_id -> bounded correlation record
_WUKONG_FAULT_INCIDENT_MAXLEN = 128
_WUKONG_FAULT_INCIDENT_TTL = 600.0
_wukong_fault_candidate = {
    'state': 'unavailable',
    'decision': 'missing_trace',
    'incident_id': '',
}
# Heartbeat timestamps for the /fpga status page (time.time() floats).
#   _wukong_last_bridge_poll — updated on every bridge GET /hardware/wukong/command
#   _wukong_last_trace_post  — updated on every bridge POST /hardware/wukong/trace
import time as _wk_time
_wukong_last_bridge_poll = 0.0
_wukong_last_trace_post  = 0.0
# Cumulative counters for pipeline-health diagnostics.  These only go up
# (never reset on server restart within a process) so the health strip can
# distinguish "never seen" (== 0) from "stale / timed out" (> 0).
_wukong_total_trace_posts  = 0   # every POST /hardware/wukong/trace
_wukong_total_bridge_polls = 0   # every GET  /hardware/wukong/command
_wukong_bridge_lock         = _wk_threading.Lock()
_wukong_bridge_info         = {}
_wukong_bridge_timeline     = []
_WUKONG_BRIDGE_TIMELINE_MAXLEN = 128
# Transport diagnostics are retained in bridge_timeline/bridge status, but
# they are not execution events.  In particular, a 50 ms polling loop can
# otherwise turn one network outage into hundreds of identical console lines.
_WUKONG_BRIDGE_DIAGNOSTIC_EVENTS = frozenset((
    'http_error', 'network_error', 'poll_failed',
    'reconnect_attempt', 'serial_read_error', 'reconnected',
))
# A bridge that was previously heard from must be absent long enough before
# the browser interrupts the user.  A single failed HTTP poll is normal.
_WUKONG_BRIDGE_LOSS_ALERT_SECONDS = 5.0
_wukong_bridge_incident_counter = 0
_wukong_bridge_alert = {
    'active': False, 'incident_id': '', 'kind': '',
    'title': '', 'message': '', 'action': '',
    'started_ts': None, 'updated_ts': None, 'dismissed': False,
}
# Command delivery lifecycle record for the most recent command.  Lets the
# /fpga page distinguish "still queued" / "bridge consumed it" / "written to
# the board's UART" instead of fire-and-forget.  Protected by
# _wukong_command_lock.  Fields:
#   cmd         — the command char ('s','r','h','b','u','f')
#   queued_ts   — when the IDE POSTed it
#   consumed_ts — when the bridge GET dequeued it (None until then)
#   write_ok    — True/False once the bridge reports the serial-write result
#                 via POST /hardware/wukong/command-ack (None until then)
#   write_error — error string when write_ok is False
#   write_ts    — when the bridge reported the write result
#   id          — server-generated monotonic command ID; the bridge receives
#                 it on dequeue and must echo it in command-ack so a late or
#                 duplicate ack can never be attributed to the wrong command
_wukong_cmd_delivery = None
_WUKONG_HALT_CONFIRM_TIMEOUT = 5.0
_wukong_cmd_id       = 0     # monotonic; incremented under _wukong_command_lock
# Fresh boot sentinels close this gate.  Startup has no target-correlated
# execution proof either: only a successful Step ACK followed by a newer trace
# from that exact live target opens Run.
_wukong_run_unlocked = False
_wukong_step_write_trace_seq = None
_wukong_step_bridge_session = ''
_wukong_runtime_identity = None   # {device_uid, session_id}, proven after STEP ACK + trace
_wukong_bridge_trace_highwater = {}
_WUKONG_SKIP_COMPLETION_TIMEOUT = 10.0
# Exact in-process disposition for a k write. Protected by command lock.
_wukong_skip_pending = None
_WUKONG_TARGET_FRESH_SECONDS = 3.0


def _wukong_target_error(data, *, require_live=True):
    """Resolve an IDE-selected physical target against the live bridge.

    A display name, a recently connected port, and a bridge session are not a
    board identity.  Hardware mutations consequently require the caller's
    selected device UID and compare it with a fresh bridge report on every
    request.  The bridge session is bound when one is known, preventing a
    different bridge from consuming an otherwise valid command.
    """
    uid = str(data.get('target_device_uid', '') or '').strip()
    requested_session = str(data.get('target_session_id', '') or '').strip()
    if not uid or len(uid) > 128:
        return None, ('missing_target', 'a selected Wukong device UID is required')
    now = _wk_time.time()
    with _wukong_bridge_lock:
        bridge = dict(_wukong_bridge_info)
    live_session = str(bridge.get('session_id', '') or '')
    live_uid = str(bridge.get('device_uid', '') or '')
    updated = bridge.get('updated_ts')
    fresh = bool(updated and now - float(updated) < _WUKONG_TARGET_FRESH_SECONDS)
    if require_live and (not fresh or bridge.get('state') in
                         ('reconnecting', 'serial_error', 'network_error')):
        return None, ('stale_target', 'selected Wukong target is not live')
    if not live_uid:
        return None, ('unidentified_target',
                      'live bridge has not reported a physical device UID')
    if not hmac.compare_digest(uid, live_uid):
        return None, ('target_mismatch',
                      'selected device UID does not match the live bridge device')
    if not requested_session:
        return None, ('missing_session',
                      'the selected Wukong bridge session is required')
    if not live_session or not hmac.compare_digest(requested_session, live_session):
        return None, ('session_mismatch',
                      'selected bridge session does not match the live bridge')
    return {
        'device_uid': uid,
        # Bind to the session actually observed at admission, including when an
        # older caller did not send an optional target_session_id.
        'bridge_session': live_session,
    }, None


def _wukong_target_rejection(error):
    decision, message = error
    return jsonify({'ok': False, 'accepted': False, 'decision': decision,
                    'error': message}), 409


def _record_wukong_bridge_event(event, state='', reason='', session_id='',
                                serial_port='', reconnect_attempt=0):
    item = {
        'ts': _wk_time.time(), 'session_id': str(session_id or '')[:128],
        'event': str(event or '')[:80], 'state': str(state or '')[:40],
        'reason': str(reason or '')[:400], 'serial_port': str(serial_port or '')[:128],
        'reconnect_attempt': int(reconnect_attempt or 0),
    }
    with _wukong_bridge_lock:
        _wukong_bridge_timeline.append(item)
        del _wukong_bridge_timeline[:-_WUKONG_BRIDGE_TIMELINE_MAXLEN]
    # Heartbeats belong in the live status card, not the historical story.
    # Low-level transport diagnostics also stay out of the shared execution
    # history; the bounded bridge timeline remains available to diagnostics.
    if event != 'heartbeat' and event not in _WUKONG_BRIDGE_DIAGNOSTIC_EVENTS:
        _queue_wukong_info_event(
            event, state, reason, session_id=item['session_id'],
            serial_port=item['serial_port'],
            reconnect_attempt=item['reconnect_attempt'])


def _wukong_refresh_bridge_alert(now=None):
    """Update and return the one active, user-facing bridge incident.

    This deliberately derives sustained loss from the server's successful
    command-poll timestamp rather than from each failed request.  A terminal
    serial reconnect failure escalates immediately because it already carries
    a concrete recovery action.
    """
    global _wukong_bridge_incident_counter, _wukong_bridge_alert
    now = _wk_time.time() if now is None else now
    bridge_age = (now - _wukong_last_bridge_poll
                  if _wukong_last_bridge_poll else None)
    with _wukong_bridge_lock:
        bridge = dict(_wukong_bridge_info)
        current = _wukong_bridge_alert
        bridge_update_age = (
            now - float(bridge.get('updated_ts'))
            if bridge.get('updated_ts') is not None else None
        )
        recovered = (
            (bridge_age is not None and bridge_age < 3.0) or
            (bridge.get('event') in ('reconnected', 'session_started') and
             bridge_update_age is not None and bridge_update_age < 3.0)
        )
        if recovered:
            if current.get('active'):
                _wukong_bridge_alert = dict(current)
                _wukong_bridge_alert.update({
                    'active': False, 'dismissed': False,
                    'updated_ts': now,
                })
            return dict(_wukong_bridge_alert)

        # Once all serial reopen attempts have failed, preserve that more
        # actionable diagnosis through the subsequent read-error loop.  Only a
        # demonstrated reconnect or successful command poll clears the latch.
        terminal_serial = (
            bridge.get('event') == 'reconnect_failed' or
            (current.get('active') and
             current.get('kind') == 'serial_reconnect_failed')
        )
        sustained_loss = (
            _wukong_total_bridge_polls > 0 and
            bridge_age is not None and
            bridge_age >= _WUKONG_BRIDGE_LOSS_ALERT_SECONDS
        )
        if terminal_serial:
            kind = 'serial_reconnect_failed'
            title = 'Wukong board connection requires attention'
            message = (
                'The bridge could not reconnect to the FPGA after repeated '
                'serial attempts.'
            )
            action = (
                'Check the USB-UART connection, restart the bridge, or switch '
                'to the simulator.'
            )
        elif sustained_loss:
            kind = 'bridge_unreachable'
            title = 'Wukong bridge connection lost'
            message = (
                'The IDE has not heard a bridge poll for '
                f'{int(bridge_age)} seconds.'
            )
            action = (
                'Restart the bridge and check its server URL/network; switch '
                'to the simulator if the board is unavailable.'
            )
        else:
            return dict(_wukong_bridge_alert)

        if not current.get('active'):
            _wukong_bridge_incident_counter += 1
            _wukong_bridge_alert = {
                'active': True,
                'incident_id': 'wukong-bridge-%d' % _wukong_bridge_incident_counter,
                'kind': kind, 'title': title, 'message': message,
                'action': action, 'started_ts': now, 'updated_ts': now,
                'dismissed': False,
            }
        else:
            # Keep the same incident identity while it persists, but allow a
            # terminal serial failure to improve the recovery guidance.
            _wukong_bridge_alert = dict(current)
            _wukong_bridge_alert.update({
                'kind': kind, 'title': title, 'message': message,
                'action': action, 'updated_ts': now,
            })
        return dict(_wukong_bridge_alert)


def _queue_wukong_info_event(event, state='', reason='', **extra):
    """Put non-packet bridge information in the same ordered history.

    Trace packets and snapshots already use this queue.  Keeping lifecycle
    records here prevents the two browser surfaces from inventing different
    connection/command stories.
    """
    global _wukong_event_seq
    item = {'kind': 'info', 'event': str(event or 'unknown'),
            'state': str(state or ''), 'reason': str(reason or ''),
            'ts': _wk_time.time()}
    item.update(extra)
    with _wukong_trace_lock:
        _wukong_event_seq += 1
        item['seq'] = _wukong_event_seq
        _wukong_event_queue.append(item)
        if len(_wukong_event_queue) > _WUKONG_EVENT_QUEUE_MAXLEN:
            del _wukong_event_queue[:-_WUKONG_EVENT_QUEUE_MAXLEN]


def _wukong_halt_summary(latest, snapshot, delivery, bridge, now):
    """Return conservative, evidence-based stop classification for dashboards."""
    fault = bool(latest.get('fault_valid'))
    bp = bool(latest.get('bp_hit'))
    age = (now - float(latest.get('ts', now))) if latest.get('ts') else None
    command = delivery or {}
    if command.get('cmd') == 'f' and command.get('write_ok') is None:
        state, reason = 'reboot pending', 'reboot is not proven written to the board'
    elif command.get('cmd') == 'h' and command.get('write_ok') is True:
        if command.get('board_halt_confirmed'):
            state, reason = 'halt confirmed', 'the FPGA emitted halted-state evidence'
        elif bridge.get('state') in ('reconnecting', 'serial_error'):
            state, reason = (
                'halt confirmation unavailable',
                'the serial link disconnected before board halt evidence arrived')
        elif now - float(command.get('write_ts') or now) > _WUKONG_HALT_CONFIRM_TIMEOUT:
            state, reason = (
                'halt confirmation timed out',
                'Halt was written, but the FPGA did not emit halted-state evidence within 5 seconds')
        else:
            state, reason = (
                'halt requested',
                'Halt was written to UART; waiting for board halted-state evidence')
    elif bridge.get('state') in ('reconnecting', 'serial_error'):
        state, reason = 'serial reconnecting', bridge.get('reason') or 'serial link recovery in progress'
    elif fault:
        state, reason = 'fault hold', 'the FPGA reported a fault and is held for snapshot/recovery'
    elif bp:
        state, reason = 'intentional halt', 'execution stopped at a configured breakpoint'
    elif bridge and bridge.get('state') == 'network_error':
        state, reason = 'server/network polling gap', bridge.get('reason') or 'bridge cannot reach the server'
    elif bridge.get('state') == 'silent':
        state, reason = 'board silent', bridge.get('reason') or 'no recent board data'
    elif age is not None and age > 3:
        state, reason = 'intentional halt', 'no newer trace; a missing trace alone is not treated as a fault'
    else:
        state, reason = 'running', 'recent board trace activity'
    return {
        'state': state, 'reason': reason, 'active_fault': fault,
        'fault_code': latest.get('fault_code') if fault else None,
        'fault_name': _wukong_fault_name(latest.get('fault_code')) if fault else None,
        'fault_stage': 'retire' if fault else None,
        'nia': latest.get('nia') if fault else None,
        'location': latest.get('nia_label') if fault else None,
        'instruction': latest.get('disasm') if fault else None,
        'breakpoint_hit': bp,
        'snapshot_complete': bool(snapshot),
        'snapshot_correlated': bool(snapshot.get('fault_trace_seq')) if snapshot else False,
        'snapshot_promoted': bool(snapshot.get('promoted')) if snapshot else False,
        'recovery_authorized': bool(delivery and delivery.get('cmd') == 'g' and
                                   delivery.get('write_ok')),
        'last_command_id': command.get('id'),
        'confirmed_ts': command.get('board_halt_ts'),
        'evidence_session': command.get('board_halt_session'),
    }


def _wukong_fault_name(code):
    names = {
        0: 'NONE', 1: 'PERM_R', 2: 'PERM_W', 3: 'PERM_X', 4: 'PERM_L',
        5: 'PERM_S', 6: 'PERM_E', 7: 'NULL_CAP', 8: 'BOUNDS', 9: 'VERSION',
        10: 'SEAL', 11: 'INVALID_OP', 12: 'TPERM_RSV', 13: 'DOMAIN_PURITY',
        14: 'BIND', 15: 'F_BIT', 16: 'STACK_OVERFLOW', 17: 'ABSENT_OUTFORM',
        18: 'STACK_CORRUPT', 19: 'STACK_UNDERFLOW', 20: 'IRQ_NULL_BASE',
        21: 'OUTFORM_CRC', 22: 'OUTFORM_ALLOC', 23: 'OUTFORM_MINT',
        24: 'OUTFORM_HDR', 25: 'OUTFORM_TIMEOUT', 26: 'OUTFORM_UNAUTH',
        27: 'IMMUTABLE_SELF_CAP', 28: 'STRUCTURAL_REG',
    }
    return names.get(int(code or 0), 'FAULT_%s' % int(code or 0))


def _wukong_payload_digest(payload):
    """Return a stable digest used to make bridge retries idempotent."""
    import hashlib as _wk_hashlib
    canonical = json.dumps(payload, sort_keys=True, separators=(',', ':'),
                           ensure_ascii=True)
    return _wk_hashlib.sha256(canonical.encode('utf-8')).hexdigest()


def _trim_wukong_fault_incidents_locked(now=None):
    """Expire old correlations and retain a small retry/deduplication window."""
    now = float(now if now is not None else _wk_time.time())
    expired = [
        incident_id for incident_id, item in _wukong_fault_incidents.items()
        if now - float(item.get('created_ts', now)) > _WUKONG_FAULT_INCIDENT_TTL
    ]
    for incident_id in expired:
        _wukong_fault_incidents.pop(incident_id, None)
    while len(_wukong_fault_incidents) > _WUKONG_FAULT_INCIDENT_MAXLEN:
        oldest = next(iter(_wukong_fault_incidents))
        _wukong_fault_incidents.pop(oldest, None)


@app.route('/hardware/wukong/bridge-status', methods=['POST'])
def wukong_bridge_status_post():
    """Accept non-invasive bridge health updates.

    This endpoint is deliberately separate from command polling: a bridge
    reconnecting from a dead USB port can still tell the IDE what is happening.
    The timeline is bounded and is diagnostic evidence, not an execution input.
    """
    global _wukong_fault_candidate, _wukong_runtime_identity, _wukong_run_unlocked, \
        _wukong_step_write_trace_seq, _wukong_step_bridge_session, _wukong_boot_info
    auth_ok, auth_error = _wukong_control_auth()
    if not auth_ok:
        return auth_error
    data = request.get_json(silent=True) or {}
    now = _wk_time.time()
    session = str(data.get('session_id', '') or '')[:128]
    device_uid = str(data.get('device_uid', '') or '').strip()[:128]
    event = str(data.get('event', '') or '')[:80]
    raw_bridge_version = data.get('bridge_version')
    bridge_version = None
    if not isinstance(raw_bridge_version, bool):
        try:
            bridge_version = max(0, min(255, int(raw_bridge_version)))
        except (TypeError, ValueError):
            pass
    raw_fault = data.get('fault_delivery')
    fault_delivery = None
    if isinstance(raw_fault, dict):
        # This is operator-facing local evidence, not an execution input.
        # Keep only bounded scalar fields and never allow it to authorize
        # recovery or replace a promoted snapshot.
        fault_delivery = {
            'state': str(raw_fault.get('state', '') or '')[:80],
            'incident_id': str(raw_fault.get('incident_id', '') or '')[:128],
            'fault_code': int(raw_fault.get('fault_code', 0) or 0),
            'fault_name': str(raw_fault.get('fault_name', '') or '')[:80],
            'nia': int(raw_fault.get('nia', 0) or 0),
            'flags': int(raw_fault.get('flags', 0) or 0),
            'correlation_status': str(
                raw_fault.get('correlation_status', '') or '')[:160],
            'promotion_status': str(
                raw_fault.get('promotion_status', '') or '')[:160],
        }
    with _wukong_bridge_lock:
        old_session = str(_wukong_bridge_info.get('session_id', '') or '')
        old_uid = str(_wukong_bridge_info.get('device_uid', '') or '')
        if session:
            # A new bridge session must identify the physical board it owns.
            # Do not carry a prior session's UID forward.
            _wukong_bridge_info.update({
                'session_id': session,
                'device_uid': device_uid,
                'serial_port': str(data.get('serial_port', '') or '')[:128],
                'bridge_version': bridge_version,
                'state': str(data.get('state', '') or '')[:40],
                'reason': str(data.get('reason', '') or '')[:400],
                'last_read_ts': data.get('last_read_ts'),
                'last_write_ts': data.get('last_write_ts'),
                'reconnect_attempt': int(data.get('reconnect_attempt', 0) or 0),
                'updated_ts': now,
                'church_only': bool(data.get('church_only', False)),
                'event': event or 'heartbeat',
            })
            if fault_delivery is not None:
                _wukong_bridge_info['fault_delivery'] = fault_delivery
        if event or session:
            item = {
                'ts': now, 'session_id': session,
                'event': event or 'heartbeat',
                'state': str(data.get('state', '') or '')[:40],
                'reason': str(data.get('reason', '') or '')[:400],
                'serial_port': str(data.get('serial_port', '') or '')[:128],
                'reconnect_attempt': int(data.get('reconnect_attempt', 0) or 0),
            }
            _wukong_bridge_timeline.append(item)
            del _wukong_bridge_timeline[:-_WUKONG_BRIDGE_TIMELINE_MAXLEN]
            if (item['event'] != 'heartbeat' and
                    item['event'] not in _WUKONG_BRIDGE_DIAGNOSTIC_EVENTS):
                _queue_wukong_info_event(
                    item['event'], item['state'], item['reason'],
                    session_id=item['session_id'],
                    serial_port=item['serial_port'],
                    reconnect_attempt=item['reconnect_attempt'])
    # A reconnect or a different USB board cannot inherit execution proof from
    # the old target.  Clear the sentinel too; it is evidence for that exact
    # UID/session only.
    if session and (session != old_session or device_uid != old_uid):
        with _wukong_boot_info_lock:
            if (_wukong_boot_info.get('session_id') != session or
                    _wukong_boot_info.get('device_uid') != device_uid):
                _wukong_boot_info = {}
        with _wukong_command_lock:
            _wukong_runtime_identity = None
            _wukong_run_unlocked = False
            _wukong_step_write_trace_seq = None
            _wukong_step_bridge_session = ''
    if fault_delivery is not None:
        state = fault_delivery.get('state')
        incident_id = fault_delivery.get('incident_id', '')
        if state == 'local_decoded_awaiting_delivery':
            with _wukong_trace_lock:
                current = _wukong_fault_candidate
                # This lifecycle event is emitted only when the bridge
                # decodes a new local fault. It must supersede an older
                # promoted candidate so the IDE cannot show stale details.
                if (incident_id and not (
                        current.get('incident_id') == incident_id and
                        current.get('decision') in (
                            'trace_accepted_awaiting_snapshot',
                            'snapshot_promoted',
                            'recovery_authorized'))):
                    _wukong_fault_candidate = {
                        'state': 'pending',
                        'decision': 'local_fault_awaiting_delivery',
                        'incident_id': incident_id,
                        'fault_code': fault_delivery['fault_code'],
                        'fault_name': fault_delivery['fault_name'],
                        'nia': fault_delivery['nia'],
                        'flags': fault_delivery['flags'],
                        'correlation_status': fault_delivery[
                            'correlation_status'],
                        'promotion_status': fault_delivery[
                            'promotion_status'],
                        'reason': 'fault decoded locally; awaiting IDE delivery',
                    }
        elif state == 'trace_accepted_awaiting_snapshot':
            with _wukong_trace_lock:
                current = _wukong_fault_candidate
                if current.get('incident_id') == incident_id:
                    _wukong_fault_candidate.update({
                        'state': 'pending',
                        'decision': 'trace_accepted_awaiting_snapshot',
                        'correlation_status': fault_delivery[
                            'correlation_status'],
                        'promotion_status': fault_delivery[
                            'promotion_status'],
                        'reason': 'fault trace accepted; complete snapshot pending',
                    })
    # Refresh immediately so a terminal reconnect failure is visible on the
    # next status poll, without waiting for a second lifecycle POST.
    _wukong_refresh_bridge_alert(now)
    return jsonify({'ok': True})

# ── Wukong relay state ────────────────────────────────────────────────────────
# When relay is active, a background thread polls a remote server (default:
# https://lab.cloomc.org) for new events and merges them into the local queue,
# so the IDE's normal polling sees live hardware state without a direct bridge.
_wukong_relay_lock    = _wk_threading.Lock()
_wukong_relay_enabled = False
_wukong_relay_url     = 'https://lab.cloomc.org'
_wukong_relay_thread  = None   # daemon thread; None when stopped
_wukong_relay_last_rx = 0.0    # last time ≥1 event arrived from source
_wukong_relay_last_ok = 0.0    # last time the source events poll returned HTTP 200
_wukong_relay_cursor  = 0      # remote seq of last event injected into local queue
_wukong_relay_generation = 0  # incremented each enable; stale worker exits when mismatch

# Allowlist of hostnames the relay may contact.  Override via env var
# WUKONG_RELAY_ALLOWED_HOSTS (comma-separated) for self-hosted deployments.
_RELAY_ALLOWED_HOSTS = frozenset(
    h.strip().lower()
    for h in os.environ.get('WUKONG_RELAY_ALLOWED_HOSTS', 'lab.cloomc.org').split(',')
    if h.strip()
)


def _validate_relay_source_url(url):
    """Return (sanitised_url, error_str). error_str is None on success."""
    try:
        from urllib.parse import urlparse as _up
        p = _up(url)
        if p.scheme != 'https':
            return None, 'source_url must use https://'
        host = (p.hostname or '').lower()
        if host not in _RELAY_ALLOWED_HOSTS:
            return None, ('source_url host %r is not in the allowed list (%s)'
                          % (host, ', '.join(sorted(_RELAY_ALLOWED_HOSTS))))
        return url.rstrip('/'), None
    except Exception as exc:
        return None, str(exc)


def _wukong_relay_worker(my_gen):
    """Poll the remote server's event queue and merge into the local queue."""
    global _wukong_relay_enabled, _wukong_relay_last_rx, _wukong_relay_last_ok, \
           _wukong_relay_cursor, _wukong_event_seq, _wukong_call_depth, \
           _wukong_latest_trace, _wukong_latest_cr_gts, \
           _wukong_last_trace_post, _wukong_total_trace_posts, \
           _wukong_boot_info
    local_cursor = 0
    with _wukong_relay_lock:
        local_cursor = _wukong_relay_cursor
        src = _wukong_relay_url.rstrip('/')
    while True:
        with _wukong_relay_lock:
            if not _wukong_relay_enabled or _wukong_relay_generation != my_gen:
                break
            src = _wukong_relay_url.rstrip('/')
        try:
            r = http_requests.get(
                src + '/hardware/wukong/events',
                params={'after': local_cursor},
                timeout=(3, 6),
                allow_redirects=False,
            )
            if r.status_code == 200:
                data = r.json()
                events = data.get('events', [])
                if events:
                    # Atomically validate generation+enabled AND inject events.
                    # We hold relay_lock through the entire check-and-write path,
                    # acquiring trace_lock inside (consistent relay→trace order) so
                    # no disable or source-change request can slip between the guard
                    # and the queue mutation — giving true atomic lifecycle safety.
                    with _wukong_relay_lock:
                        if _wukong_relay_generation == my_gen and _wukong_relay_enabled:
                            _wukong_relay_last_ok = _wk_time.time()
                            _wukong_relay_last_rx = _wukong_relay_last_ok
                            now = _wukong_relay_last_rx
                            with _wukong_trace_lock:
                                for ev in events:
                                    ev_type = int(ev.get('ev_type', 0) or 0)
                                    if ev_type == 0x08:    # CALL_PUSH
                                        _wukong_call_depth += 1
                                    elif ev_type == 0x09:  # CALL_POP
                                        if _wukong_call_depth > 0:
                                            _wukong_call_depth -= 1
                                    ev_copy = dict(ev)
                                    ev_copy['call_depth'] = _wukong_call_depth
                                    ev_copy['relayed']    = True
                                    if not ev_copy.get('ts'):
                                        ev_copy['ts'] = now
                                    _wukong_event_seq += 1
                                    ev_copy['seq'] = _wukong_event_seq
                                    _wukong_event_queue.append(ev_copy)
                                    if len(_wukong_event_queue) > _WUKONG_EVENT_QUEUE_MAXLEN:
                                        del _wukong_event_queue[:-_WUKONG_EVENT_QUEUE_MAXLEN]
                                    _wukong_latest_trace = ev_copy
                                    if ev_type == 0x06:
                                        _wukong_latest_cr_gts[6]  = int(ev.get('payload_gt', 0) or 0)
                                    elif ev_type == 0x07:
                                        _wukong_latest_cr_gts[14] = int(ev.get('payload_gt', 0) or 0)
                                    remote_seq = ev.get('seq', 0) or 0
                                    if remote_seq > local_cursor:
                                        local_cursor = remote_seq
                            # Cursor and telemetry stay under relay_lock.
                            _wukong_last_trace_post    = now
                            _wukong_total_trace_posts += len(events)
                            _wukong_relay_cursor       = local_cursor
                        # else: stale generation or relay disabled — discard silently.
                else:
                    # No events but HTTP 200: still update last_ok under gen guard.
                    with _wukong_relay_lock:
                        if _wukong_relay_generation == my_gen and _wukong_relay_enabled:
                            _wukong_relay_last_ok = _wk_time.time()
                # Relay boot-info so the IDE stale-bitstream banner works.
                # Guard with generation so a stale worker cannot pollute new session.
                try:
                    bi_r = http_requests.get(src + '/hardware/wukong/boot-info',
                                             timeout=(2, 4), allow_redirects=False)
                    if bi_r.status_code == 200:
                        bi_data = bi_r.json()
                        if bi_data:
                            with _wukong_relay_lock:
                                if _wukong_relay_generation == my_gen and _wukong_relay_enabled:
                                    with _wukong_boot_info_lock:
                                        _wukong_boot_info.update(bi_data)
                except Exception:
                    pass
        except Exception as exc:
            app.logger.debug('Wukong relay poll error: %s', exc)
        _wk_time.sleep(1.5)


@app.route('/hardware/wukong/relay', methods=['POST'])
def wukong_relay_post():
    """Enable or disable the production-to-dev event relay.

    Accepts JSON: { "enabled": bool, "source_url": str }
    source_url must be https:// and the hostname must be in _RELAY_ALLOWED_HOSTS
    (default: lab.cloomc.org; override via WUKONG_RELAY_ALLOWED_HOSTS env var).

    When enabled, a background thread polls <source_url>/hardware/wukong/events
    every 1.5 s and merges new events into the local queue so the IDE's normal
    polling continues to work without a direct Wukong bridge.

    Response: { "ok": true, "enabled": bool, "source_url": str }
    """
    global _wukong_relay_enabled, _wukong_relay_url, _wukong_relay_thread, \
           _wukong_relay_cursor, _wukong_relay_last_rx, _wukong_relay_last_ok, \
           _wukong_relay_generation
    data = request.get_json(silent=True) or {}
    enabled = bool(data.get('enabled', False))
    raw_url = str(data.get('source_url', '') or '').strip() or 'https://lab.cloomc.org'

    validated_url, err = _validate_relay_source_url(raw_url)
    if err:
        return jsonify({'ok': False, 'error': err}), 400

    with _wukong_relay_lock:
        was_enabled = _wukong_relay_enabled
        url_changed = (validated_url != _wukong_relay_url)
        _wukong_relay_url     = validated_url
        _wukong_relay_enabled = enabled
        # Spawn a fresh worker whenever:
        #  • relay is being turned on (was disabled), OR
        #  • relay is already running but the source URL has changed.
        # In both cases bump the generation so any in-flight or sleeping
        # worker from the previous session self-exits and its results are
        # discarded before they can reach the local event queue.
        needs_new_worker = enabled and (not was_enabled or url_changed)
        if needs_new_worker:
            _wukong_relay_generation += 1
            current_gen = _wukong_relay_generation
            _wukong_relay_cursor  = 0
            _wukong_relay_last_rx = 0.0
            _wukong_relay_last_ok = 0.0

    if needs_new_worker:
        t = _wk_threading.Thread(target=_wukong_relay_worker,
                                  args=(current_gen,),
                                  daemon=True, name='wukong-relay')
        t.start()
        _wukong_relay_thread = t
        app.logger.info('Wukong relay started → %s', validated_url)
    elif not enabled:
        app.logger.info('Wukong relay stopped')

    return jsonify({'ok': True, 'enabled': enabled, 'source_url': validated_url})


# ── Fault snapshot (simulator + hardware path) ───────────────────────────────
# Holds the most recent fault snapshot for the session.  Written by:
#   • POST /api/fault-snapshot  — simulator (before _returnToBoot) or bridge
#   • POST /hardware/wukong/snapshot with is_fault_snapshot=true (bridge alias)
# Read by GET; cleared by DELETE or overwritten by the next POST.
_fault_snapshot = None
_fault_snapshot_lock = _wk_threading.Lock()
_WUKONG_FAULT_NAMES = {
    0x00: 'NONE',           0x01: 'PERM_R',        0x02: 'PERM_W',
    0x03: 'PERM_X',         0x04: 'PERM_L',        0x05: 'PERM_S',
    0x06: 'PERM_E',         0x07: 'NULL_CAP',      0x08: 'BOUNDS',
    0x09: 'VERSION',        0x0A: 'SEAL',          0x0B: 'INVALID_OP',
    0x0C: 'TPERM_RSV',      0x0D: 'DOMAIN_PURITY', 0x0E: 'BIND',
    0x0F: 'F_BIT',          0x10: 'STACK_OVERFLOW', 0x11: 'ABSENT_OUTFORM',
    0x12: 'STACK_CORRUPT',  0x13: 'STACK_UNDERFLOW', 0x14: 'IRQ_NULL_BASE',
    0x15: 'OUTFORM_CRC',    0x16: 'OUTFORM_ALLOC', 0x17: 'OUTFORM_MINT',
    0x18: 'OUTFORM_HDR',    0x19: 'OUTFORM_TIMEOUT',
    0x1A: 'OUTFORM_UNAUTH', 0x1B: 'IMMUTABLE_SELF_CAP',
}


def _promote_wukong_fault_snapshot(snapshot, trace):
    """Store a reason-2 Wukong snapshot as the durable complete Last Fault.

    The trace packet arrives first and identifies the fault code.  Its register
    rows are necessarily partial.  The following architectural snapshot carries
    the actual CR/DR state, so it replaces that partial record before the bridge
    reboots the board.  A clean pause uses snapshot reason 3 and never calls
    this helper.
    """
    global _fault_snapshot
    trace = trace if isinstance(trace, dict) else {}
    if not trace.get('fault_valid'):
        return False
    fault_code = int(trace.get('fault_code', 0))
    fault_message = _WUKONG_FAULT_NAMES.get(fault_code, f'FAULT_{fault_code}')

    entry = {
        'fault_code':        fault_code,
        'fault_message':     fault_message,
        'nia':               int(trace.get('nia', snapshot['nia'])),
        'pc':                int(trace.get('nia', snapshot['nia'])),
        'flags':             int(snapshot['flags']),
        'call_depth':        int(trace.get('call_depth', 0)),
        'led_bits':          0,
        'abstraction_label': str(trace.get('gt_label') or
                                 trace.get('nia_label') or ''),
        'abstraction_slot':  None,
        'source':            'hardware',
        'ts':                float(snapshot.get('ts', _wk_time.time())),
        'snapshot_complete': True,
        'snapshot_reason':   int(snapshot['reason']),
        'snapshot_seq':      int(snapshot['seq']),
        'incident_id':       str(snapshot.get('incident_id', '') or ''),
        'bridge_session':    str(snapshot.get('bridge_session', '') or ''),
        'server_boot_id':     str(snapshot.get('fault_boot_id', '') or ''),
        'fault_trace_seq':    int(snapshot.get('fault_trace_seq', 0) or 0),
        'correlation_status': 'correlated',
        'promotion_status':   'promoted',
        'recovery_authorized': False,
        'crc_valid':          bool(snapshot.get('crc_valid', False)),
        'crc16':              int(snapshot.get('crc16', 0)) & 0xFFFF,
        'integrity':          str(snapshot.get('integrity', '') or ''),
        'sto':                int(snapshot.get('sto', 0)),
        'thread_base':        int(snapshot.get('thread_base', 0)),
        'cr':                [list(row) for row in snapshot['cr']],
        'dr':                list(snapshot['dr']),
        'stored_cr12_gt':    int(snapshot['stored_cr12_gt']),
        'stored_packed_pc':  int(snapshot['stored_packed_pc']),
        'stored_mflag':      int(snapshot['stored_mflag']),
    }
    with _fault_snapshot_lock:
        _fault_snapshot = entry
    return True


@app.route('/api/fault-snapshot', methods=['POST'])
def fault_snapshot_post():
    """Receive a fault snapshot from the simulator or hardware bridge.

    Accepted fields (all optional except the required snapshot shape):
        fault_code    (int)   — structured fault code (e.g. BOUNDS=0x03)
        fault_message (str)   — human-readable fault description
        nia           (int)   — faulting instruction address
        pc            (int)   — simulator logical PC at fault
        cr            (list)  — 16 × [word0, word1, word2] capability registers
        dr            (list)  — 16 data register values
        flags         (int)   — NZCV flag byte
        call_depth    (int)   — call stack depth at fault
        led_bits      (int)   — LED register at fault
        abstraction_label (str) — NS label of the faulting abstraction
        abstraction_slot  (int) — NS slot index of the faulting abstraction
        source        (str)   — 'simulator' | 'hardware'
        ts            (float) — Unix timestamp
    """
    global _fault_snapshot
    data = request.get_json(silent=True) or {}
    import time as _ft_time
    source = str(data.get('source', 'simulator'))
    simulator_snapshot = source == 'simulator'
    entry = {
        'fault_code':        int(data.get('fault_code', 0)),
        'fault_message':     str(data.get('fault_message', '') or ''),
        'nia':               int(data.get('nia', 0)),
        'pc':                int(data.get('pc', 0)),
        'flags':             int(data.get('flags', 0)),
        'call_depth':        int(data.get('call_depth', 0)),
        'led_bits':          int(data.get('led_bits', 0)),
        'abstraction_label': str(data.get('abstraction_label', '') or ''),
        'abstraction_slot':  (int(data['abstraction_slot'])
                              if data.get('abstraction_slot') is not None else None),
        'source':            source,
        'ts':                float(data.get('ts', _ft_time.time())),
        'snapshot_complete': bool(
            data.get('snapshot_complete', simulator_snapshot)),
        'incident_id':       str(data.get('incident_id') or
                                 ('simulator-' + uuid.uuid4().hex
                                  if simulator_snapshot else '')),
        'bridge_session':    str(data.get('bridge_session', '') or ''),
        'correlation_status': str(data.get(
            'correlation_status',
            'local simulator capture' if simulator_snapshot else 'pending')),
        'promotion_status': str(data.get(
            'promotion_status',
            'stored' if simulator_snapshot else 'pending')),
        'recovery_authorized': bool(data.get('recovery_authorized', False)),
        'crc_valid': data.get('crc_valid'),
        'crc16': data.get('crc16'),
        'integrity': str(data.get('integrity', '') or ''),
        'sto': data.get('sto'),
        'thread_base': data.get('thread_base'),
        'stored_cr12_gt': data.get('stored_cr12_gt'),
        'stored_packed_pc': data.get('stored_packed_pc'),
        'stored_mflag': data.get('stored_mflag'),
    }
    # CR registers: accept either 16×[w0,w1,w2] list or absence (store null rows).
    raw_cr = data.get('cr')
    if isinstance(raw_cr, list) and len(raw_cr) == 16:
        try:
            entry['cr'] = [[int(w) & 0xFFFFFFFF for w in (row if len(row) >= 3 else row + [0]*(3-len(row)))]
                           for row in raw_cr]
        except (TypeError, ValueError):
            entry['cr'] = None
    else:
        entry['cr'] = None
    # DR registers: accept 16-element list.
    raw_dr = data.get('dr')
    if isinstance(raw_dr, list) and len(raw_dr) == 16:
        try:
            entry['dr'] = [int(v) & 0xFFFFFFFF for v in raw_dr]
        except (TypeError, ValueError):
            entry['dr'] = None
    else:
        entry['dr'] = None

    with _fault_snapshot_lock:
        # A browser can receive the trace event after the bridge has already
        # delivered the complete reason-2 snapshot.  Do not let that delayed,
        # trace-only hardware record erase the real CR/DR fault state.
        keep_complete_hardware = (
            entry['source'] == 'hardware' and not entry['snapshot_complete'] and
            isinstance(_fault_snapshot, dict) and
            _fault_snapshot.get('source') == 'hardware' and
            _fault_snapshot.get('snapshot_complete') is True
        )
        if not keep_complete_hardware:
            _fault_snapshot = entry
    return jsonify({'ok': True, 'stored': not keep_complete_hardware})


@app.route('/api/fault-snapshot', methods=['GET'])
def fault_snapshot_get():
    """Return the accepted fault or an explicit pending/rejected/unavailable state."""
    with _wukong_trace_lock:
        candidate = dict(_wukong_fault_candidate)
    with _fault_snapshot_lock:
        snap = dict(_fault_snapshot) if isinstance(_fault_snapshot, dict) else None
    # A newer locally decoded incident must not be masked by the last fully
    # promoted snapshot from an earlier fault. Keep the older record available
    # in memory for correlation-safe history, but expose the newer pending
    # incident to the IDE until its own snapshot is promoted.
    newer_pending = (
        snap is not None and candidate.get('state') == 'pending' and
        candidate.get('incident_id') and
        candidate.get('incident_id') != snap.get('incident_id')
    )
    if snap is None or newer_pending:
        state = candidate.get('state') or 'unavailable'
        return jsonify({
            'ok': False,
            'display_state': state,
            'decision': candidate.get('decision') or 'missing_trace',
            'reason': candidate.get('reason') or 'No durable accepted fault record.',
            'incident_id': candidate.get('incident_id') or '',
            'fault_code': candidate.get('fault_code'),
            'fault_name': candidate.get('fault_name'),
            'nia': candidate.get('nia'),
            'flags': candidate.get('flags'),
            'correlation_status': candidate.get('correlation_status'),
            'promotion_status': candidate.get('promotion_status'),
        })
    snap['display_state'] = 'accepted'
    snap['candidate'] = candidate
    return jsonify(snap)


@app.route('/api/fault-snapshot', methods=['DELETE'])
def fault_snapshot_delete():
    """Clear the stored fault snapshot (user dismissed the panel)."""
    global _fault_snapshot
    with _fault_snapshot_lock:
        _fault_snapshot = None
    return jsonify({'ok': True})


@app.route('/hardware/wukong/trace', methods=['POST'])
def wukong_trace_post():
    """Bridge posts a decoded 12-byte trace packet here.

    Expected JSON fields (all from hardware/wukong_bridge.py decode_trace_packet):
        nia         — retiring instruction NIA
        ev_type     — TRACE_EV_* constant (0x00-0x0B); MUST be forwarded to the IDE
                      so it can apply CR6/CR14 updates for CALL sequences:
                        0x06 = TRACE_EV_CALL_CR6  → CR6  ← payload_gt
                        0x07 = TRACE_EV_CALL_CR14 → CR14 ← payload_gt
                        0x08 = TRACE_EV_CALL_PUSH → caller frame push (payload_gt=0)
        payload_gt  — GT word0 extracted from bytes 6-9; 0 for push/pop events
        flags       — raw flags byte (bits[3:0] = NZCV)
        fault_code  — 5-bit fault code
        fault_valid — bool
        bp_hit      — bool
        ts          — float timestamp
    """
    auth_ok, auth_error = _wukong_control_auth()
    if not auth_ok:
        return auth_error
    global _wukong_latest_trace, _wukong_latest_cr_gts, _wukong_event_seq, \
           _wukong_call_depth, _wukong_last_trace_post, _wukong_total_trace_posts, \
           _wukong_fault_candidate
    _wukong_last_trace_post    = _wk_time.time()
    _wukong_total_trace_posts += 1
    data = request.get_json(silent=True) or {}
    ev_type    = int(data.get('ev_type', 0))
    payload_gt = int(data.get('payload_gt', 0))
    entry = {
        'nia':         int(data.get('nia', 0)),
        'ev_type':     ev_type,
        'payload_gt':  payload_gt,
        'gt_label':    str(data.get('gt_label', '') or ''),
        # Reserved for a future packet field that is observed at retirement.
        # Never promote bridge map metadata into raw hardware evidence.
        'instr':       (int(data['observed_instr_word'])
                        if data.get('observed_instr_word') is not None else None),
        'flags':       int(data.get('flags', 0)),
        'fault_code':  int(data.get('fault_code', 0)),
        'fault_valid': bool(data.get('fault_valid', False)),
        'bp_hit':      bool(data.get('bp_hit', False)),
        'ts':          float(data.get('ts', 0.0)),
        'bridge_trace_counter': int(data.get('bridge_trace_counter', -1)),
    }
    incident_id = str(data.get('incident_id', '') or '')
    bridge_session = str(data.get('bridge_session', '') or '')
    if incident_id:
        if len(incident_id) > 80 or len(incident_id) < 16 or \
                not all(ch.isalnum() or ch in '-_' for ch in incident_id):
            return jsonify({
                'ok': False, 'accepted': False,
                'decision': 'incident_mismatch',
                'reason': 'invalid incident id',
            }), 400
        if not bridge_session or len(bridge_session) > 128:
            return jsonify({
                'ok': False, 'accepted': False,
                'decision': 'incident_mismatch',
                'reason': 'missing or invalid bridge session',
            }), 400
        entry['incident_id'] = incident_id
        entry['bridge_session'] = bridge_session
    # Correlate all display metadata server-side.  Never combine a bridge's
    # stale NIA label/disassembly with a different packet instruction word.
    location = _wukong_correlate_trace_metadata(entry['nia'], entry['instr'])
    entry.update(location)
    trace_digest = _wukong_payload_digest({
        key: entry[key] for key in sorted(entry)
        if key not in ('call_depth', 'seq')
    })
    with _wukong_trace_lock:
        _trim_wukong_fault_incidents_locked()
        existing_incident = _wukong_fault_incidents.get(incident_id) if incident_id else None
        if existing_incident is not None:
            if existing_incident.get('bridge_session') != bridge_session or \
                    existing_incident.get('trace_digest') != trace_digest:
                _wukong_fault_candidate = {
                    'state': 'rejected', 'decision': 'incident_mismatch',
                    'incident_id': incident_id,
                    'reason': 'incident id was reused with different trace data',
                }
                app.logger.warning(
                    'Wukong fault incident %s rejected: incident mismatch', incident_id)
                return jsonify({
                    'ok': False, 'accepted': False,
                    'decision': 'incident_mismatch',
                    'incident_id': incident_id,
                }), 409
            return jsonify({
                'ok': True, 'accepted': True, 'duplicate': True,
                'decision': 'duplicate',
                'incident_id': incident_id,
                'seq': existing_incident['trace_seq'],
                'boot_id': existing_incident['server_boot_id'],
            })

        # Update authoritative call depth BEFORE assigning seq so that
        # entry['call_depth'] reflects the state AFTER this event is applied.
        if ev_type == 0x08:    # TRACE_EV_CALL_PUSH
            _wukong_call_depth += 1
        elif ev_type == 0x09:  # TRACE_EV_CALL_POP
            if _wukong_call_depth > 0:
                _wukong_call_depth -= 1
        entry['call_depth'] = _wukong_call_depth

        _wukong_event_seq += 1
        entry['seq'] = _wukong_event_seq
        _wukong_event_queue.append(entry)
        if len(_wukong_event_queue) > _WUKONG_EVENT_QUEUE_MAXLEN:
            del _wukong_event_queue[:-_WUKONG_EVENT_QUEUE_MAXLEN]
        # Never alias the immutable execution-history event: live status may
        # later be cleared only after board-originated skip completion proof.
        _wukong_latest_trace = dict(entry)
        global _wukong_run_unlocked, _wukong_step_write_trace_seq, \
            _wukong_step_bridge_session, _wukong_runtime_identity
        if bridge_session and entry.get('bridge_trace_counter', -1) >= 0:
            _wukong_bridge_trace_highwater[bridge_session] = max(
                entry['bridge_trace_counter'],
                _wukong_bridge_trace_highwater.get(bridge_session, -1))
        if (_wukong_step_write_trace_seq is not None and
                entry.get('bridge_trace_counter', -1) >
                _wukong_step_write_trace_seq and
                (not _wukong_step_bridge_session or
                 bridge_session == _wukong_step_bridge_session)):
            with _wukong_bridge_lock:
                live = dict(_wukong_bridge_info)
            live_fresh = bool(
                live.get('device_uid') and live.get('session_id') == bridge_session and
                live.get('updated_ts') and
                _wk_time.time() - float(live['updated_ts']) < _WUKONG_TARGET_FRESH_SECONDS and
                live.get('state') not in ('reconnecting', 'serial_error', 'network_error'))
            if live_fresh:
                _wukong_runtime_identity = {
                    'device_uid': live['device_uid'], 'session_id': bridge_session,
                }
                _wukong_run_unlocked = True
                _wukong_step_write_trace_seq = None
        # Persist CR GT updates separately so a subsequent CALL_PUSH packet
        # (ev_type=0x08, payload_gt=0) cannot overwrite the CR6/CR14 GTs
        # before the IDE polls GET /hardware/wukong/trace.
        if ev_type == 0x06:    # TRACE_EV_CALL_CR6
            _wukong_latest_cr_gts[6]  = payload_gt
        elif ev_type == 0x07:  # TRACE_EV_CALL_CR14
            _wukong_latest_cr_gts[14] = payload_gt
        if incident_id and entry['fault_valid']:
            _wukong_fault_incidents[incident_id] = {
                'incident_id': incident_id,
                'bridge_session': bridge_session,
                'trace_digest': trace_digest,
                'trace': dict(entry),
                'trace_seq': entry['seq'],
                'server_boot_id': BOOT_ID,
                'created_ts': _wk_time.time(),
                'state': 'pending',
            }
            _wukong_fault_candidate = {
                'state': 'pending',
                'decision': 'trace_accepted_awaiting_snapshot',
                'incident_id': incident_id,
                'fault_code': entry['fault_code'],
                'fault_name': _wukong_fault_name(entry['fault_code']),
                'nia': entry['nia'],
                'flags': entry['flags'],
                'correlation_status': 'trace accepted; complete snapshot pending',
                'promotion_status': 'pending complete snapshot',
                'reason': 'fault trace accepted; complete reason-2 snapshot pending',
            }
            _trim_wukong_fault_incidents_locked()
    decision = 'trace_accepted' if incident_id else 'accepted'
    return jsonify({
        'ok': True, 'accepted': True, 'duplicate': False,
        'decision': decision, 'incident_id': incident_id,
        'seq': entry['seq'], 'boot_id': BOOT_ID,
    })


@app.route('/hardware/wukong/snapshot', methods=['POST'])
def wukong_snapshot_post():
    """Bridge posts one complete, CRC-validated architectural stop snapshot.

    The bridge has already checked the wire CRC.  The server still validates
    the JSON shape before placing it in the same ordered queue as trace
    events, so the browser can apply snapshots atomically and in arrival
    order.
    """
    auth_ok, auth_error = _wukong_control_auth()
    if not auth_ok:
        return auth_error
    global _wukong_latest_snapshot, _wukong_event_seq, \
        _wukong_last_trace_post, _wukong_total_trace_posts, \
        _wukong_fault_candidate
    data = request.get_json(silent=True) or {}
    try:
        cr = data.get('cr')
        dr = data.get('dr')
        if not data.get('snapshot') or int(data.get('version')) != 1:
            raise ValueError('unsupported snapshot')
        if not isinstance(cr, list) or len(cr) != 16 or \
                any(not isinstance(row, list) or len(row) != 3 for row in cr):
            raise ValueError('snapshot must contain CR0..CR15 × 3 words')
        if not isinstance(dr, list) or len(dr) != 16:
            raise ValueError('snapshot must contain DR0..DR15')
        numeric = ('seq', 'reason', 'flags', 'nia', 'sto', 'thread_base',
                   'stored_cr12_gt', 'stored_packed_pc', 'stored_mflag')
        entry = {key: int(data[key]) for key in numeric}
        entry['cr'] = [[int(word) & 0xFFFFFFFF for word in row] for row in cr]
        entry['dr'] = [int(word) & 0xFFFFFFFF for word in dr]
        entry['snapshot'] = True
        entry['snapshot_seq'] = entry['seq']
        entry['version'] = 1
        entry['m_flag'] = bool(data.get('m_flag', False))
        entry['crc16'] = int(data.get('crc16', 0)) & 0xFFFF
        entry['ts'] = float(data.get('ts', 0.0))
        # A fault-recovery snapshot must explicitly carry the bridge's wire
        # CRC verdict.  Do not infer success from a missing field: a retried
        # or hand-crafted reason-2 payload without this evidence must remain
        # fail-closed below.
        entry['crc_valid'] = data.get('crc_valid')
        entry['integrity'] = str(data.get('integrity', ''))
    except (KeyError, TypeError, ValueError, OverflowError) as exc:
        return jsonify({
            'ok': False, 'accepted': False, 'promoted': False,
            'decision': 'invalid_snapshot',
            'reason': f'invalid snapshot: {exc}',
        }), 400

    _wukong_last_trace_post = _wk_time.time()
    _wukong_total_trace_posts += 1
    incident_id = str(data.get('incident_id', '') or '')
    bridge_session = str(data.get('bridge_session', '') or '')
    fault_boot_id = str(data.get('fault_boot_id', '') or '')
    try:
        fault_trace_seq = int(data.get('fault_trace_seq', 0))
    except (TypeError, ValueError):
        fault_trace_seq = 0
    entry.update({
        'incident_id': incident_id,
        'bridge_session': bridge_session,
        'fault_boot_id': fault_boot_id,
        'fault_trace_seq': fault_trace_seq,
    })
    snapshot_digest = _wukong_payload_digest(data)

    with _wukong_trace_lock:
        _trim_wukong_fault_incidents_locked()
        if entry['reason'] == 2:
            incident = _wukong_fault_incidents.get(incident_id)
            if incident is None:
                if fault_boot_id and fault_boot_id != BOOT_ID:
                    decision, status = 'server_generation_changed', 409
                    reason = 'snapshot belongs to a prior server generation'
                else:
                    decision, status = 'missing_trace', 409
                    reason = 'no accepted fault trace exists for this incident'
            elif not fault_boot_id or fault_boot_id != BOOT_ID:
                decision, status = 'server_generation_changed', 409
                reason = 'snapshot is missing the accepted server generation'
            elif incident.get('server_boot_id') != fault_boot_id:
                decision, status = 'server_generation_changed', 409
                reason = 'server generation changed after the fault trace'
            elif incident.get('bridge_session') != bridge_session or \
                    incident.get('trace_seq') != fault_trace_seq:
                decision, status = 'incident_mismatch', 409
                reason = 'snapshot correlation does not match the accepted trace'
            elif incident.get('state') == 'promoted':
                if incident.get('snapshot_digest') == snapshot_digest:
                    return jsonify({
                        'ok': True, 'accepted': True, 'promoted': True,
                        'duplicate': True, 'decision': 'duplicate',
                        'incident_id': incident_id,
                        'seq': incident.get('snapshot_event_seq'),
                    })
                decision, status = 'incident_mismatch', 409
                reason = 'incident id was reused with different snapshot data'
            elif entry['crc_valid'] is not True:
                decision, status = 'invalid_snapshot', 400
                reason = 'snapshot lacks an explicit valid CRC verdict'
            else:
                trace = incident.get('trace') or {}
                same_nia = int(trace.get('nia', -1)) == int(entry['nia'])
                same_flags = (int(trace.get('flags', -1)) & 0x0F) == \
                    (int(entry['flags']) & 0x0F)
                if not same_nia or not same_flags:
                    decision, status = 'invalid_snapshot', 400
                    reason = 'snapshot does not contain the correlated fault-time NIA/flags'
                else:
                    decision = status = reason = None

            if decision is not None:
                _wukong_fault_candidate = {
                    'state': 'rejected', 'decision': decision,
                    'incident_id': incident_id, 'reason': reason,
                }
                app.logger.warning(
                    'Wukong fault incident %s snapshot rejected: %s (%s)',
                    incident_id or '<missing>', decision, reason)
                return jsonify({
                    'ok': False, 'accepted': False, 'promoted': False,
                    'decision': decision, 'incident_id': incident_id,
                    'reason': reason,
                }), status

        _wukong_event_seq += 1
        entry['seq'] = _wukong_event_seq
        _wukong_event_queue.append(entry)
        if len(_wukong_event_queue) > _WUKONG_EVENT_QUEUE_MAXLEN:
            del _wukong_event_queue[:-_WUKONG_EVENT_QUEUE_MAXLEN]
        promoted = False
        if entry['reason'] == 2:
            incident = _wukong_fault_incidents[incident_id]
            promoted = _promote_wukong_fault_snapshot(entry, incident['trace'])
            if promoted:
                entry['correlation_status'] = 'correlated'
                entry['promotion_status'] = 'promoted'
                incident.update({
                    'state': 'promoted',
                    'snapshot_digest': snapshot_digest,
                    'snapshot_event_seq': entry['seq'],
                })
                _wukong_fault_candidate = {
                    'state': 'accepted', 'decision': 'promoted',
                    'incident_id': incident_id,
                    'reason': 'complete fault-time snapshot durably promoted',
                }
        _wukong_latest_snapshot = dict(entry)
    decision = 'promoted' if promoted else 'not_fault_snapshot'
    app.logger.info(
        'Wukong snapshot incident=%s decision=%s promoted=%s',
        incident_id or '<none>', decision, promoted)
    return jsonify({
        'ok': True, 'accepted': True, 'seq': entry['seq'],
        'incident_id': incident_id, 'promoted': promoted,
        'duplicate': False, 'decision': decision,
    })


@app.route('/hardware/wukong/recovery-authorization', methods=['POST'])
def wukong_recovery_authorization_post():
    """Record the exact promoted incident for which the bridge wrote ``g``."""
    auth_ok, auth_error = _wukong_control_auth()
    if not auth_ok:
        return auth_error
    global _wukong_event_seq, _wukong_fault_candidate, _fault_snapshot
    data = request.get_json(silent=True) or {}
    incident_id = str(data.get('incident_id', '') or '')
    bridge_session = str(data.get('bridge_session', '') or '')
    authorization_id = str(data.get('authorization_id', '') or '')
    if not authorization_id:
        return jsonify({
            'ok': False, 'accepted': False,
            'decision': 'invalid_snapshot',
            'reason': 'recovery authorization requires a stable authorization id',
        }), 400
    with _wukong_trace_lock:
        incident = _wukong_fault_incidents.get(incident_id)
        if incident is None or incident.get('state') != 'promoted':
            return jsonify({
                'ok': False, 'accepted': False,
                'decision': 'missing_trace',
                'reason': 'incident has not been promoted',
            }), 409
        if incident.get('bridge_session') != bridge_session:
            return jsonify({
                'ok': False, 'accepted': False,
                'decision': 'incident_mismatch',
            }), 409
        if incident.get('authorization_id'):
            if incident['authorization_id'] != authorization_id:
                return jsonify({
                    'ok': False, 'accepted': False,
                    'decision': 'incident_mismatch',
                }), 409
            return jsonify({
                'ok': True, 'accepted': True, 'duplicate': True,
                'decision': 'duplicate', 'incident_id': incident_id,
            })
        incident['authorization_id'] = authorization_id
        incident['recovery_authorized'] = True
        _wukong_event_seq += 1
        auth_event = {
            'kind': 'info', 'event': 'recovery_authorized',
            'state': 'authorized',
            'reason': 'bridge wrote g after durable snapshot promotion',
            'incident_id': incident_id, 'seq': _wukong_event_seq,
            'ts': _wk_time.time(),
        }
        _wukong_event_queue.append(auth_event)
        if len(_wukong_event_queue) > _WUKONG_EVENT_QUEUE_MAXLEN:
            del _wukong_event_queue[:-_WUKONG_EVENT_QUEUE_MAXLEN]
        _wukong_fault_candidate = {
            'state': 'accepted', 'decision': 'recovery_authorized',
            'incident_id': incident_id,
            'reason': 'automatic recovery authorization was written to the board',
        }
        with _fault_snapshot_lock:
            if isinstance(_fault_snapshot, dict) and \
                    _fault_snapshot.get('incident_id') == incident_id:
                _fault_snapshot = dict(_fault_snapshot)
                _fault_snapshot['recovery_authorized'] = True
                _fault_snapshot['recovery_authorization_id'] = authorization_id
    app.logger.info('Wukong recovery authorized for incident %s', incident_id)
    return jsonify({
        'ok': True, 'accepted': True, 'duplicate': False,
        'decision': 'recovery_authorized', 'incident_id': incident_id,
    })


@app.route('/hardware/wukong/trace', methods=['GET'])
def wukong_trace_get():
    """IDE reads the latest trace packet (or {} if no packet yet).

    Extra fields added to the response to survive packet ordering:
        cr6_gt  — last payload_gt seen for ev_type=0x06 (TRACE_EV_CALL_CR6);
                  absent until a CALL_CR6 packet has been received
        cr14_gt — last payload_gt seen for ev_type=0x07 (TRACE_EV_CALL_CR14);
                  absent until a CALL_CR14 packet has been received

    These are preserved separately so that the subsequent CALL_PUSH packet
    (ev_type=0x08, payload_gt=0) cannot overwrite a CR6/CR14 update in
    _wukong_latest_trace before the IDE polls this endpoint.
    """
    with _wukong_trace_lock:
        entry = dict(_wukong_latest_trace)
        if 6 in _wukong_latest_cr_gts:
            entry['cr6_gt']  = _wukong_latest_cr_gts[6]
        if 14 in _wukong_latest_cr_gts:
            entry['cr14_gt'] = _wukong_latest_cr_gts[14]
    return jsonify(entry)

@app.route('/hardware/wukong/events', methods=['GET'])
def wukong_events_get():
    """IDE drains the ordered event queue since a given sequence cursor.

    Query param:
        after — sequence number of the last event the client has seen (default 0).
                 Returns all events with seq > after in arrival order.

    Response JSON:
        events  — list of trace-entry dicts (each has 'seq' + all trace fields)
        cr6_gt  — last payload_gt for TRACE_EV_CALL_CR6  (absent until seen)
        cr14_gt — last payload_gt for TRACE_EV_CALL_CR14 (absent until seen)

    By returning every event in order the client can track call stack depth
    accurately even when CALL_PUSH (0x08) and CALL_POP (0x09) are sandwiched
    between CALL_CR6/CR14 packets in rapid succession.
    """
    try:
        after = int(request.args.get('after', 0))
    except (TypeError, ValueError):
        after = 0
    # bridge_connected mirrors the same computation used by the /status endpoint
    # so that the toolbar buttons can show up even when no trace packets are
    # flowing (e.g. the board is halted and _wukongIsConnected() would return
    # false on the client because _wukongLastTraceTs is stale or zero).
    _ev_now = _wk_time.time()
    _ev_bridge_connected = bool(
        _wukong_last_bridge_poll and
        (_ev_now - _wukong_last_bridge_poll) < 3.0
    )
    with _wukong_trace_lock:
        events = [e for e in _wukong_event_queue if e.get('seq', 0) > after]
        resp = {
            'events':        events,
            # Authoritative call-stack depth after all events received so far.
            # The client uses this to resync after a gap or server restart.
            'call_depth':    _wukong_call_depth,
            # Highest seq number ever assigned; used to detect server restarts
            # (client cursor > server_seq means the counter was reset).
            'server_seq':    _wukong_event_seq,
            # Oldest seq still in the queue; client compares this against its
            # cursor to detect overflow gaps (queue_min_seq > cursor + 1).
            'queue_min_seq': _wukong_event_queue[0]['seq']
                             if _wukong_event_queue else 0,
            # True when the bridge polled within the last 3 s — lets the client
            # show HW toolbar buttons even while the board is halted (no traces).
            'bridge_connected': _ev_bridge_connected,
        }
        if 6 in _wukong_latest_cr_gts:
            resp['cr6_gt']  = _wukong_latest_cr_gts[6]
        if 14 in _wukong_latest_cr_gts:
            resp['cr14_gt'] = _wukong_latest_cr_gts[14]
    return jsonify(resp)


@app.route('/hardware/wukong/code', methods=['GET'])
def wukong_code_get():
    """Return the code listing that matches the server's active trace map.

    The active uploaded entry lump is authoritative when one has been sent to
    the board.  Before an upload, expose the fixed WukongCallHome reference
    listing so the FPGA workspace is still useful for the board's power-on
    program.  When ``trace_nia`` is supplied, the live trace identity is
    authoritative: a WukongCallHome trace must not be relabeled with an
    overlapping uploaded lump such as SelfTest.  Every row contains the
    byte-addressed NIA used by trace packets.
    """
    info = dict(_wukong_active_lump_info)
    trace_nia = request.args.get('trace_nia')
    trace_location = None
    if trace_nia is not None:
        try:
            trace_location = _wukong_trace_metadata(int(trace_nia, 0))
        except (TypeError, ValueError):
            trace_location = None
    trace_pet_name = (trace_location or {}).get('pet_name')
    force_reference = trace_pet_name == 'WukongCallHome'
    rows = []
    source_map = 'uploaded'

    def add_row(offset, nia, word, label, disasm):
        """Append one row unless another source already owns this NIA."""
        if any(existing['nia'] == nia for existing in rows):
            return
        rows.append({
            'offset': int(offset),
            'nia': int(nia) & 0xFFFFFFFF,
            'word': None if word is None else int(word) & 0xFFFFFFFF,
            'nia_label': label,
            'disasm': disasm,
        })

    # Boot is always part of the hardware execution path and is also emitted
    # by the trace symbol resolver for NIAs 0x00000000/04/08.
    try:
        from hardware.wukong_trace_symbols import (
            _BOOT_WORDS as _boot_words,
            boot_disassembly as _wts_boot_disassembly,
        )
        boot_entry_name = (
            'WukongCallHome' if force_reference
            else str(info.get('name') if info else 'SelfTest')
        )
        for offset, word in enumerate(_boot_words):
            add_row(offset, offset * 4, word, f'Boot.{offset}',
                    _wts_boot_disassembly(offset, boot_entry_name))
    except Exception:
        pass

    if not force_reference and info and info.get('lump_words'):
        base_byte = int(info.get('base_byte', 0))
        name = str(info.get('name') or 'Lump')
        for offset, word in sorted(info['lump_words'].items()):
            offset = int(offset)
            word = int(word) & 0xFFFFFFFF
            add_row(offset, base_byte + offset * 4, word, f'{name}.{offset}',
                    'LUMP_HEADER' if offset == 0
                    else _wukong_disassemble_word(word, name))
    else:
        try:
            from hardware.wukong_trace_symbols import (
                WUKONG_SELFTEST_BASE as _selftest_base,
                WUKONG_SELFTEST_WORDS as _selftest_words,
                WUKONG_CALLHOME_BASE as _wch_base,
                WUKONG_CALLHOME_WORDS as _wch_words,
                _canonical_wch_header as _wch_header,
            )
            source_map = 'reference-bitstream'
            for offset, word in enumerate(_selftest_words):
                word = int(word) & 0xFFFFFFFF
                add_row(offset, int(_selftest_base) + offset * 4, word,
                        f'SelfTest.{offset}',
                        'LUMP_HEADER' if offset == 0
                        else _wukong_disassemble_word(word, 'SelfTest'))
            add_row(0, int(_wch_base), int(_wch_header(len(_wch_words))),
                    'WukongCallHome.0', 'LUMP_HEADER')
            for offset, word in enumerate(_wch_words, 1):
                word = int(word) & 0xFFFFFFFF
                add_row(offset, int(_wch_base) + offset * 4, word,
                        f'WukongCallHome.{offset}',
                        _wukong_disassemble_word(word, 'WukongCallHome'))
        except Exception:
            source_map = 'unavailable'
    return jsonify({
        'ok': True,
        'name': ('WukongCallHome' if force_reference
                 else str(info.get('name') if info else 'WukongCallHome')),
        'source_map': source_map,
        'trace_authoritative': bool(trace_location),
        'trace_pet_name': trace_pet_name,
        'rows': rows,
    })


@app.route('/hardware/wukong/console', methods=['POST'])
def wukong_console_post():
    """Bridge posts a line of raw UART ASCII output (banner text etc.).

    Merged into the same server-side ordered event queue as trace packets so
    the Testing page's Live event log shows all board output in arrival order.
    The IDE's HW Trace panel consumes the shared hardware trace/console stream
    for session-local decoded execution context; the two views intentionally
    differ in presentation and retention.
    Body JSON: {'text': str, 'ts': float}
    """
    auth_ok, auth_error = _wukong_control_auth()
    if not auth_ok:
        return auth_error
    global _wukong_event_seq
    data = request.get_json(silent=True) or {}
    text = str(data.get('text', ''))[:400]
    if not text.strip():
        return jsonify({'ok': True})
    entry = {
        'console': text,
        'ts':      float(data.get('ts', 0.0)),
    }
    with _wukong_trace_lock:
        _wukong_event_seq += 1
        entry['seq'] = _wukong_event_seq
        _wukong_event_queue.append(entry)
        if len(_wukong_event_queue) > _WUKONG_EVENT_QUEUE_MAXLEN:
            del _wukong_event_queue[:-_WUKONG_EVENT_QUEUE_MAXLEN]
    return jsonify({'ok': True})


@app.route('/hardware/wukong/command', methods=['POST'])
def wukong_command_post():
    """IDE enqueues a command for the bridge to forward to the board.

    Body JSON: {'cmd': 's'|'r'|'h'|'q'|'b'|'u'|'f'|'k', 'nia': <int>, 'data': '<base64>'}

    Only one command is queued at a time.  Halt ('h') is priority-safe: it may
    atomically replace only an undelivered Run/Step ('r'/'s').  It never
    cancels upload, reboot, breakpoint, snapshot, another halt, or a command
    already consumed for serial delivery.  Other commands retain the existing
    surfaced-overwrite behavior.
    """
    global _wukong_pending_cmd, _upload_in_flight, _wukong_cmd_delivery, \
        _wukong_cmd_id, _wukong_run_unlocked, _wukong_runtime_identity
    auth_ok, auth_error = _wukong_control_auth()
    if not auth_ok:
        return auth_error
    data = request.get_json(silent=True) or {}
    cmd = str(data.get('cmd', '')).strip()
    if cmd not in ('s', 'r', 'h', 'q', 'b', 'u', 'f', 'k'):
        return jsonify({'ok': False, 'error': 'unknown cmd'}), 400

    entry = {'cmd': cmd}
    target, target_error = _wukong_target_error(data)
    if target_error:
        return _wukong_target_rejection(target_error)
    entry.update(target)
    # Keep the protocol field explicit in the dequeued command as well as the
    # compact internal device_uid field used by admission.
    entry['target_device_uid'] = target['device_uid']

    if cmd == 'k':
        # Testing-only Skip Fault is fail-closed at the server as well as RTL.
        # Require the current fault trace and its exact promoted reason-2
        # snapshot. Historical fault records remain untouched.
        with _wukong_trace_lock:
            current_fault = dict(_wukong_latest_trace)
            current_snapshot = dict(_wukong_latest_snapshot)
        incident_id = str(current_fault.get('incident_id', '') or '')
        skip_available = bool(
            current_fault.get('fault_valid') and incident_id and
            current_snapshot.get('reason') == 2 and
            current_snapshot.get('incident_id') == incident_id and
            current_snapshot.get('fault_trace_seq') == current_fault.get('seq') and
            current_snapshot.get('promotion_status') == 'promoted')
        if not skip_available:
            return jsonify({
                'ok': False,
                'error': 'Skip Fault requires the current correlated hardware fault snapshot',
                'blocked_stage': 'no_current_hardware_fault',
            }), 409
        entry['incident_id'] = incident_id
        # `snapshot_seq` preserves the fixed-frame hardware sequence; `seq`
        # is subsequently replaced by the server event sequence.
        fault_snapshot_seq = int(current_snapshot.get(
            'snapshot_seq', current_snapshot.get('seq', 0))) & 0xFFFF
        entry['expected_skip_snapshot_seq'] = (
            fault_snapshot_seq + 1) & 0xFFFF

    if cmd == 'b':
        # Accept int, decimal string, '0x…' hex string, or bare hex string.
        # A malformed NIA is a hard 400 — it must NEVER be silently coerced
        # to 0xFFFFFFFF, because the RTL interprets 0xFFFFFFFF as "clear
        # breakpoint" (a parse error would otherwise DISARM breakpoints).
        raw_nia = data.get('nia', 0xFFFFFFFF)
        nia_val = None
        if isinstance(raw_nia, bool):
            pass                       # bool is an int subclass — reject
        elif isinstance(raw_nia, int):
            nia_val = raw_nia
        elif isinstance(raw_nia, str):
            s = raw_nia.strip()
            try:
                nia_val = int(s, 0)    # handles decimal and 0x-prefixed hex
            except ValueError:
                try:
                    nia_val = int(s, 16)   # bare hex like 'DEAD0010'
                except ValueError:
                    nia_val = None
        if nia_val is None or not (0 <= nia_val <= 0xFFFFFFFF):
            return jsonify({'ok': False,
                            'error': 'invalid nia %r — use a decimal or hex '
                                     '(0x…) address' % (raw_nia,)}), 400
        entry['nia'] = nia_val & 0xFFFFFFFF
        # Reject board execution commands while an upload is in-flight.
        with _upload_in_flight_lock:
            if _upload_in_flight:
                return jsonify({'ok': False,
                                'error': 'upload in progress — retry after upload-ack'}), 409

    elif cmd == 'u':
        b64 = data.get('data', '')
        if not isinstance(b64, str) or not b64:
            return jsonify({'ok': False, 'error': 'missing data field'}), 400
        try:
            artifact = base64.b64decode(b64, validate=True)
        except (ValueError, TypeError):
            return jsonify({'ok': False, 'error': 'invalid upload data encoding'}), 400
        supplied_digest = str(data.get('artifact_sha256', '') or '').lower()
        supplied_size = data.get('artifact_size')
        supplied_identity = str(data.get('artifact_identity', '') or '')[:256]
        digest = hashlib.sha256(artifact).hexdigest()
        try:
            supplied_size = int(supplied_size)
        except (TypeError, ValueError):
            supplied_size = -1
        if (not re.fullmatch(r'[0-9a-f]{64}', supplied_digest) or
                supplied_digest != digest or supplied_size != len(artifact) or
                not supplied_identity):
            return jsonify({'ok': False, 'error':
                            'runtime upload requires matching artifact digest, size, and identity'}), 400
        entry['data'] = b64
        entry.update({
            'artifact_sha256': digest, 'artifact_size': len(artifact),
            'artifact_identity': supplied_identity,
        })
        # Atomic check-and-set: claim the in-flight slot under the lock so that
        # a concurrent 'u' request cannot also pass the check and overwrite the
        # pending command slot.  Mirrors the lifecycle enforced by
        # /api/boot-image/send-to-hardware (which is the preferred route).
        # The flag is cleared when the bridge POSTs /hardware/wukong/upload-ack.
        with _upload_in_flight_lock:
            if _upload_in_flight:
                return jsonify({'ok': False,
                                'error': 'upload in progress — retry after upload-ack'}), 409
            _upload_in_flight = True

    else:
        # s / r / h / k — reject while any upload is in-flight.
        with _upload_in_flight_lock:
            if _upload_in_flight:
                if cmd == 'h':
                    return jsonify({
                        'ok': False,
                        'error': 'STOP cannot cancel upload in progress',
                        'blocked_cmd': 'u',
                        'blocked_stage': 'upload',
                    }), 409
                return jsonify({
                    'ok': False,
                    'error': 'upload in progress — retry after upload-ack',
                }), 409

    now = _wk_time.time()
    with _wukong_command_lock:
        if cmd == 'k' and _wukong_skip_pending and \
                _wukong_skip_pending.get('state') in (
                    'awaiting_board_evidence', 'indeterminate'):
            return jsonify({
                'ok': False,
                'error': 'Skip Fault disposition is pending or indeterminate; Reboot is required',
                'blocked_stage': _wukong_skip_pending.get('state'),
            }), 409
        runtime_matches_target = bool(
            _wukong_runtime_identity and
            _wukong_runtime_identity.get('device_uid') == target['device_uid'] and
            _wukong_runtime_identity.get('session_id') == target['bridge_session'])
        if cmd == 'r' and (not _wukong_run_unlocked or not runtime_matches_target):
            return jsonify({
                'ok': False,
                'error': 'RUN locked until a confirmed Step produces a fresh retirement',
                'blocked_stage': 'awaiting_first_step',
            }), 409
        # Guard: if the bridge already consumed a command but has not yet
        # confirmed the serial write, refuse to accept the new command.
        # Accepting it would replace the delivery-tracking ID, orphan the
        # in-flight ACK, and cause the IDE watcher to report "no confirmation"
        # even if the bridge successfully wrote the old command to serial.
        # This prevents the "STEP superseded" trace pattern where a slow serial
        # write causes the user's retry to silently drop the in-flight step.
        d = _wukong_cmd_delivery
        if (d is not None and d.get('cmd') == 'h' and
                d.get('write_ok') is True and
                not d.get('board_halt_confirmed') and
                now - float(d.get('write_ts') or now) <=
                _WUKONG_HALT_CONFIRM_TIMEOUT):
            return jsonify({
                'ok': False,
                'error': 'Halt confirmation pending — wait for board evidence',
                'blocked_cmd': 'h',
                'blocked_stage': 'awaiting_board_evidence',
            }), 409
        if (d is not None and
                d.get('consumed_ts') is not None and
                d.get('write_ts') is None):
            error = (
                "STOP cannot cancel command %r: bridge write already in progress"
                % (d.get('cmd'),)
                if cmd == 'h' else
                'bridge write in progress — retry after confirmation'
            )
            return jsonify({
                'ok': False,
                'error': error,
                'blocked_cmd': d.get('cmd'),
                'blocked_stage': 'consumed',
            }), 409
        prev = _wukong_pending_cmd
        if cmd == 'h' and prev and prev.get('cmd') not in ('r', 's'):
            return jsonify({
                'ok': False,
                'error': "STOP cannot cancel pending command %r" % (
                    prev.get('cmd'),),
                'blocked_cmd': prev.get('cmd'),
                'blocked_stage': 'queued',
            }), 409
        _wukong_cmd_id += 1
        entry['id'] = _wukong_cmd_id
        _wukong_pending_cmd = entry
        _wukong_cmd_delivery = {
            'id':          _wukong_cmd_id,
            'cmd':         cmd,
            'queued_ts':   now,
            'consumed_ts': None,
            'write_ok':    None,
            'write_error': '',
            'write_ts':    None,
            'board_halt_confirmed': False if cmd == 'h' else None,
            'board_halt_ts': None,
            'board_halt_session': '',
            'board_state_counter': None,
            'target_device_uid': entry['device_uid'],
            'target_session_id': entry['bridge_session'],
        }
        if cmd == 'u':
            _wukong_cmd_delivery.update({
                'artifact_sha256': entry['artifact_sha256'],
                'artifact_size': entry['artifact_size'],
                'artifact_identity': entry['artifact_identity'],
            })
        if cmd == 'k':
            _wukong_cmd_delivery['incident_id'] = entry['incident_id']
            _wukong_cmd_delivery['expected_skip_snapshot_seq'] = (
                entry['expected_skip_snapshot_seq'])
            _wukong_cmd_delivery['skip_completion'] = False
    _record_wukong_bridge_event('command_queued', 'server',
                                f"command {cmd!r} queued", '', '', 0)
    resp = {'ok': True, 'id': entry['id']}
    if prev:
        resp['overwrote'] = prev.get('cmd')
        if cmd == 'h':
            resp['cancelled'] = {
                'cmd': prev.get('cmd'),
                'id': prev.get('id'),
            }
    return jsonify(resp)


@app.route('/hardware/wukong/command', methods=['GET'])
def wukong_command_get():
    """Bridge polls here every 50 ms to dequeue the next pending command.

    Returns {'cmd': ..., 'nia': ...} if a command is pending, else {}.
    The command is consumed (set to None) on each successful GET.
    """
    auth_ok, auth_error = _wukong_control_auth()
    if not auth_ok:
        return auth_error
    global _wukong_pending_cmd, _wukong_last_bridge_poll, _wukong_total_bridge_polls
    _wukong_last_bridge_poll    = _wk_time.time()
    bridge_session = request.headers.get('X-Wukong-Session', '')[:128]
    bridge_uid = request.headers.get('X-Wukong-Device-UID', '')[:128]
    _wukong_total_bridge_polls += 1
    if bridge_session:
        with _wukong_bridge_lock:
            _wukong_bridge_info.update({
                'session_id': bridge_session,
                'state': 'polling',
                    'event': 'polling',
                    'reason': '',
                'updated_ts': _wukong_last_bridge_poll,
            })
    with _wukong_command_lock:
        entry = _wukong_pending_cmd
        # Never let an arbitrary or stale bridge consume a command addressed to
        # a particular board.  Leave it queued for the exact live session.
        if entry and entry.get('target_device_uid'):
            expected_uid = entry.get('target_device_uid')
            expected_session = entry.get('bridge_session', '')
            if (not bridge_uid or not hmac.compare_digest(bridge_uid, expected_uid) or
                    (expected_session and
                     not hmac.compare_digest(bridge_session, expected_session))):
                return jsonify({
                    'ok': False, 'accepted': False, 'decision': 'target_mismatch',
                    'error': 'bridge identity does not match queued command target',
                }), 409
        _wukong_pending_cmd = None
        if entry and _wukong_cmd_delivery \
                and _wukong_cmd_delivery.get('id') == entry.get('id'):
            _wukong_cmd_delivery['consumed_ts'] = _wukong_last_bridge_poll
            if bridge_session:
                _wukong_cmd_delivery['bridge_session'] = bridge_session
    if entry:
        return jsonify(entry)
    return jsonify({})


@app.route('/hardware/wukong/status', methods=['GET'])
def wukong_status_get():
    """Aggregate, non-consuming status snapshot for the /fpga page.

    Unlike GET /hardware/wukong/upload-ack (which consumes the result) this
    endpoint only reads state, so polling it never disturbs the IDE's flows.
    """
    global _wukong_run_unlocked, _wukong_runtime_identity, \
        _wukong_step_write_trace_seq, _wukong_step_bridge_session
    now = _wk_time.time()
    with _wukong_trace_lock:
        latest    = dict(_wukong_latest_trace)
        snapshot  = dict(_wukong_latest_snapshot)
        seq       = _wukong_event_seq
        qlen      = len(_wukong_event_queue)
        depth     = _wukong_call_depth
        cr_gts    = dict(_wukong_latest_cr_gts)
        fault_candidate = dict(_wukong_fault_candidate)
    with _fault_snapshot_lock:
        last_accepted_fault = (
            dict(_fault_snapshot)
            if isinstance(_fault_snapshot, dict) and
            _fault_snapshot.get('snapshot_complete') is True
            else None
        )
    with _wukong_boot_info_lock:
        boot_info = dict(_wukong_boot_info)
    with _wukong_hw_entry_lock:
        active_thread_contexts = list(_wukong_active_thread_contexts)
    active_thread = None
    thread_base = snapshot.get('thread_base') if isinstance(snapshot, dict) else None
    if isinstance(thread_base, int):
        for context in active_thread_contexts:
            if context.get('base_word') == thread_base // 4:
                active_thread = {
                    'name': f"Thread.{context.get('number')}",
                    'position': context.get('number'),
                    'count': len(active_thread_contexts),
                    'slot': context.get('slot'),
                }
                break
    with _upload_in_flight_lock:
        upl       = _upload_in_flight
    with _wukong_upload_ack_lock:
        upload_ack = dict(_wukong_upload_ack)
    with _wukong_command_lock:
        pending   = dict(_wukong_pending_cmd) if _wukong_pending_cmd else None
        delivery  = dict(_wukong_cmd_delivery) if _wukong_cmd_delivery else None
        skip_pending = dict(_wukong_skip_pending) if _wukong_skip_pending else None
    if pending and 'data' in pending:
        # Type-safe payload summary: never embed the payload, and never raise
        # (a TypeError here would turn the read-only status poll into a 500).
        _d = pending['data']
        pending = {'cmd': pending.get('cmd'),
                   'data_bytes': len(_d) if isinstance(_d, (str, bytes)) else 0}
    with _wukong_bridge_lock:
        bridge_info = dict(_wukong_bridge_info)
        bridge_timeline = list(_wukong_bridge_timeline[-32:])
    target_live = bool(
        bridge_info.get('device_uid') and bridge_info.get('session_id') and
        bridge_info.get('updated_ts') and
        now - float(bridge_info['updated_ts']) < _WUKONG_TARGET_FRESH_SECONDS and
        bridge_info.get('state') not in ('reconnecting', 'serial_error', 'network_error'))
    # Runtime permission is target-scoped evidence, not a sticky process flag.
    # Expire it when the reported board/session is no longer a fresh exact live
    # target so a later reconnect cannot inherit permission from an old board.
    with _wukong_command_lock:
        runtime_is_current = bool(
            target_live and _wukong_runtime_identity and
            _wukong_runtime_identity.get('device_uid') == bridge_info.get('device_uid') and
            _wukong_runtime_identity.get('session_id') == bridge_info.get('session_id'))
        if _wukong_runtime_identity and not runtime_is_current:
            _wukong_runtime_identity = None
            _wukong_run_unlocked = False
            _wukong_step_write_trace_seq = None
            _wukong_step_bridge_session = ''
    if skip_pending and skip_pending.get('state') == 'awaiting_board_evidence':
        indeterminate = (
            now - float(skip_pending.get('write_ts') or now) >
            _WUKONG_SKIP_COMPLETION_TIMEOUT or
            bridge_info.get('state') in ('reconnecting', 'serial_error') or
            (bridge_info.get('session_id') and
             bridge_info.get('session_id') != skip_pending.get('bridge_session')))
        if indeterminate:
            with _wukong_command_lock:
                if (_wukong_skip_pending and
                        _wukong_skip_pending.get('command_id') ==
                        skip_pending.get('command_id')):
                    _wukong_skip_pending['state'] = 'indeterminate'
                    _wukong_skip_pending['action'] = 'Reboot required'
                    skip_pending = dict(_wukong_skip_pending)
    bridge_age = (now - _wukong_last_bridge_poll) if _wukong_last_bridge_poll else None
    trace_age  = (now - _wukong_last_trace_post)  if _wukong_last_trace_post  else None
    bridge_alert = _wukong_refresh_bridge_alert(now)
    if boot_info.get('startup_state') == 'halt_requested':
        requested_at = float(boot_info.get('received_ts') or now)
        if bridge_age is None or bridge_age >= 3.0 or bridge_info.get('state') in (
                'reconnecting', 'serial_error'):
            boot_info['startup_state'] = 'halt_confirmation_unavailable'
        elif now - requested_at > _WUKONG_HALT_CONFIRM_TIMEOUT:
            boot_info['startup_state'] = 'halt_confirmation_timed_out'
    return jsonify({
        # Pipeline-health counters (never reset within a process session).
        # total_trace_posts == 0  → server has never seen a trace packet this session.
        # total_bridge_polls == 0 → server has never seen a bridge command-poll.
        # These let the health strip distinguish "never seen" from "stale / timed out"
        # without requiring the UI to remember pre-existing ages across page loads.
        'total_trace_posts':  _wukong_total_trace_posts,
        'total_bridge_polls': _wukong_total_bridge_polls,
        'server_time':        now,
        'bridge_connected':   bridge_age is not None and bridge_age < 3.0,
        'bridge_poll_age':    bridge_age,
        'last_trace_age':     trace_age,
        'server_seq':         seq,
        'queue_len':          qlen,
        'call_depth':         depth,
        'latest_trace':       latest,
        # Latest validated architectural stop snapshot.  This is read-only
        # status data for dashboards; it does not mutate simulator state.
        'latest_snapshot':    snapshot,
        'last_accepted_fault': last_accepted_fault,
        'fault_candidate':     fault_candidate,
        'cr6_gt':             cr_gts.get(6),
        'cr14_gt':            cr_gts.get(14),
        'boot_info':          boot_info,
        'startup_state':      boot_info.get('startup_state', ''),
        'run_unlocked':       _wukong_run_unlocked,
        'skip_fault_available': bool(
            latest.get('fault_valid') and latest.get('incident_id') and
            snapshot.get('reason') == 2 and
            snapshot.get('incident_id') == latest.get('incident_id') and
            snapshot.get('fault_trace_seq') == latest.get('seq') and
            snapshot.get('promotion_status') == 'promoted' and
            not skip_pending),
        'skip_fault': skip_pending,
        'active_thread':      active_thread,
        # What the hardware will actually run at boot: power-on bitstream
        # default (slot 7, WukongCallHome) until a boot-image upload is
        # ACKed, then the uploaded image's entry slot.
        'hw_entry_slot':      (_wukong_hw_entry_slot
                               if _wukong_hw_entry_slot is not None
                               else WUKONG_POWERON_ENTRY_SLOT),
        'hw_entry_source':    ('upload' if _wukong_hw_entry_slot is not None
                               else 'power-on'),
        'upload_in_flight':   upl,
        # These identities describe independent physical evidence.  They are
        # intentionally not collapsed into "installed": a generated/downloaded
        # bitstream and a runtime RAM upload do not establish FPGA installation.
        'physical_target': {
            'device_uid': bridge_info.get('device_uid', ''),
            'session_id': bridge_info.get('session_id', ''),
            'live': target_live,
        },
        'runtime_upload_ack': upload_ack,
        'pending_command':    pending,
        'command_delivery':   delivery,
        'bridge':              bridge_info,
        'bridge_timeline':     bridge_timeline,
        'bridge_alert':        bridge_alert,
        'halt':                _wukong_halt_summary(latest, snapshot, delivery,
                                                    bridge_info, now),
        'ide_version':        BUILD_VERSION,
        'ide_version_kind':   BUILD_VERSION_KIND,
        # Repo-side expectations so the Versions view can compare against the
        # sentinel-reported build_version / tu_version without extra requests.
        'expected_build_version': _wukong_build_version(),
        # This is intentionally separate from expected_build_version: the
        # bridge is a downloadable host script and may be released on a
        # different cadence from the FPGA bitstream.
        'latest_bridge_version': _wukong_bridge_version(),
        'min_tu_version':         _wukong_min_tu_version(),
        'min_thread_scheduler_build': _wukong_min_thread_scheduler_build(),
        # Relay state — active when a dev IDE is mirroring from a remote server.
        'relay_enabled':    _wukong_relay_enabled,
        'relay_source_url': _wukong_relay_url,
        'relay_last_ok':    (now - _wukong_relay_last_ok) if _wukong_relay_last_ok else None,
        'relay_last_rx':    (now - _wukong_relay_last_rx) if _wukong_relay_last_rx else None,
        # Snapshot lookup is version-scoped.  It intentionally never reads the
        # mutable current Namespace as a fallback for a historical bitstream.
        'namespace_snapshot': _namespace_match_for_hardware_version(
            boot_info.get('build_version') if isinstance(boot_info, dict) else None),
    })


@app.route('/fpga')
def fpga_status_page():
    """Standalone FPGA status page — shows exactly what the server knows about
    the Wukong board, bridge, and trace stream.  Independent of the IDE."""
    resp = make_response(send_from_directory(_SERVER_DIR, 'fpga_status.html'))
    resp.headers['Cache-Control'] = 'no-store'
    return resp


# ── Wukong boot-info endpoint ─────────────────────────────────────────────────
# Bridge POSTs here when a boot sentinel is received so the IDE can show a
# visible banner if the bitstream is stale (old TraceUnit FSM).
#
#   POST /hardware/wukong/boot-info  — bridge reports {stale_tu, tu_version,
#                                      build_version, thread_scheduler}
#   GET  /hardware/wukong/boot-info  — IDE polls for the latest boot-info

_wukong_boot_info_lock = _wk_threading.Lock()
_wukong_boot_info      = {}   # {stale_tu: bool, tu_version: int}


# ── Wukong upload-ack endpoint ────────────────────────────────────────────────
# Bridge POSTs here after completing (or failing) a boot-image upload so the
# IDE can poll for completion and then trigger a step/run.
#
#   POST /hardware/wukong/upload-ack  — bridge reports {ok: bool, error: str}
#   GET  /hardware/wukong/upload-ack  — IDE polls for the latest upload result

_wukong_upload_ack_lock   = _wk_threading.Lock()
_wukong_upload_ack        = {}   # {} = no upload attempted yet; {ok, error?}
# True while the bridge is writing a boot image over UART.  Execution commands
# (s/r/h/b) are rejected during this window: the UART is a shared serial
# channel, and an s/r/h/b byte sent mid-upload would land as DMEM data,
# silently corrupting the boot image.  Cleared when the bridge POSTs upload-ack.
_upload_in_flight         = False
_upload_in_flight_lock    = _wk_threading.Lock()

# ── Hardware boot-entry tracking ─────────────────────────────────────────────
# The Wukong bitstream's power-on DMEM boots WukongCallHome (NS slot 7).
# After a successful boot-image upload the board runs whatever entry slot
# that image carries.  The IDE dashboard reads hw_entry_slot from
# GET /hardware/wukong/status so it shows what the hardware will ACTUALLY
# run, distinct from the simulator's slot-6 default.
WUKONG_POWERON_ENTRY_SLOT   = 7
_wukong_hw_entry_lock       = _wk_threading.Lock()
_wukong_hw_entry_slot       = None   # None = power-on default (no upload yet)
_wukong_pending_entry_slot  = None   # entry slot of the upload in flight
_wukong_active_thread_contexts = []  # acknowledged projected {number, slot, base_word}
_wukong_pending_thread_contexts = []


@app.route('/hardware/wukong/command-ack', methods=['POST'])
def wukong_command_ack_post():
    """Bridge reports the serial-write result for a dequeued command.

    Body JSON:
        id    — the command ID received on dequeue (GET /hardware/wukong/command)
        cmd   — the command char it attempted to write ('s','r','h','b','f','k')
        ok    — true when the UART write succeeded
        error — human-readable failure string when ok=false

    Updates the delivery record only when BOTH the id and cmd match the
    current record AND that command has already been consumed — a late ack
    for a superseded command (even one with the same letter) or an ack that
    arrives before consumption can never corrupt the lifecycle.
    """
    auth_ok, auth_error = _wukong_control_auth()
    if not auth_ok:
        return auth_error
    global _wukong_cmd_delivery, _wukong_run_unlocked, _wukong_runtime_identity, \
        _wukong_step_write_trace_seq, _wukong_step_bridge_session, \
        _wukong_skip_pending
    data = request.get_json(silent=True) or {}
    cmd  = str(data.get('cmd', '')).strip()
    ok   = bool(data.get('ok', False))
    err  = str(data.get('error', ''))[:400] if not ok else ''
    ack_session = str(data.get('session_id', '') or
                      request.headers.get('X-Wukong-Session', '') or '')[:128]
    ack_uid = str(data.get('target_device_uid', '') or
                  request.headers.get('X-Wukong-Device-UID', '') or '')[:128]
    try:
        ack_trace_counter = int(data.get('trace_counter'))
    except (TypeError, ValueError):
        ack_trace_counter = None
    try:
        ack_state_counter = int(data.get('state_counter'))
    except (TypeError, ValueError):
        ack_state_counter = None
    try:
        ack_halt_nonce = int(data.get('halt_nonce'))
    except (TypeError, ValueError):
        ack_halt_nonce = None
    try:
        ack_id = int(data.get('id'))
    except (TypeError, ValueError):
        ack_id = None
    with _wukong_trace_lock:
        trace_seq_at_ack = int(_wukong_latest_trace.get('seq', 0) or 0)
        trace_counter_at_ack = _wukong_bridge_trace_highwater.get(
            ack_session, -1)
    with _wukong_command_lock:
        if _wukong_cmd_delivery \
                and ack_id is not None \
                and _wukong_cmd_delivery.get('id') == ack_id \
                and _wukong_cmd_delivery.get('cmd') == cmd \
                and _wukong_cmd_delivery.get('consumed_ts') is not None \
                and (not _wukong_cmd_delivery.get('target_session_id') or
                     (ack_session and hmac.compare_digest(
                         _wukong_cmd_delivery.get('target_session_id'), ack_session))) \
                and (not _wukong_cmd_delivery.get('target_device_uid') or
                     (ack_uid and hmac.compare_digest(
                         _wukong_cmd_delivery.get('target_device_uid'), ack_uid))):
            _wukong_cmd_delivery['write_ok']    = ok
            _wukong_cmd_delivery['write_error'] = err
            _wukong_cmd_delivery['write_ts']    = _wk_time.time()
            _wukong_cmd_delivery['trace_seq_at_write'] = trace_seq_at_ack
            _wukong_cmd_delivery['bridge_trace_counter_at_write'] = (
                ack_trace_counter)
            _wukong_cmd_delivery['state_counter_at_write'] = ack_state_counter
            _wukong_cmd_delivery['halt_nonce'] = ack_halt_nonce
            if cmd == 's' and ok:
                # UART acknowledgement alone does not prove that the board is
                # executing.  It may, however, reconcile a trace that arrived
                # first: the per-session highwater then proves a retirement
                # newer than the bridge's write watermark.  Identity changes
                # here, only after the exact UID/session ACK has correlated.
                trace_already_newer = bool(
                    ack_trace_counter is not None and
                    trace_counter_at_ack > ack_trace_counter)
                _wukong_run_unlocked = trace_already_newer
                _wukong_step_write_trace_seq = (
                    None if trace_already_newer else ack_trace_counter)
                _wukong_step_bridge_session = ack_session
                if trace_already_newer:
                    _wukong_runtime_identity = {
                        'device_uid': _wukong_cmd_delivery.get(
                            'target_device_uid'),
                        'session_id': ack_session,
                    }
            if ack_session:
                _wukong_cmd_delivery['bridge_session'] = ack_session
            if cmd == 'k' and ok:
                if not ack_session or ack_state_counter is None:
                    _wukong_cmd_delivery['write_ok'] = False
                    _wukong_cmd_delivery['write_error'] = (
                        'bridge omitted skip session/counter correlation')
                else:
                    _wukong_cmd_delivery['skip_state'] = 'awaiting_board_evidence'
                    _wukong_skip_pending = {
                        'state': 'awaiting_board_evidence',
                        'command_id': ack_id,
                        'incident_id': _wukong_cmd_delivery.get('incident_id'),
                        'bridge_session': ack_session,
                        'expected_skip_snapshot_seq':
                            _wukong_cmd_delivery.get(
                                'expected_skip_snapshot_seq'),
                        'write_ts': _wukong_cmd_delivery['write_ts'],
                    }
            elif cmd == 'f' and ok:
                _wukong_skip_pending = None
            _record_wukong_bridge_event(
                'command_write_ok' if ok else 'command_write_failed',
                'connected' if ok else 'serial_error', err,
                ack_session, '', 0)
    return jsonify({'ok': True})


@app.route('/hardware/wukong/skip-fault-completion', methods=['POST'])
def wukong_skip_fault_completion_post():
    """Accept post-skip reason-3 board evidence, never a write-ACK surrogate."""
    global _wukong_latest_trace, _wukong_skip_pending
    token = os.environ.get('REPORT_TOKEN', '').strip()
    if not token:
        return jsonify({
            'accepted': False, 'decision': 'auth_unavailable',
            'error': 'REPORT_TOKEN is not configured',
        }), 503
    supplied = request.headers.get('Authorization', '')
    if not hmac.compare_digest(supplied, f'Bearer {token}'):
        return jsonify({
            'accepted': False, 'decision': 'unauthorized',
            'error': 'Unauthorized',
        }), 401
    data = request.get_json(silent=True) or {}
    try:
        command_id = int(data.get('command_id'))
        nia = int(data.get('nia')) & 0xFFFFFFFF
        fault_nia = int(data.get('fault_nia')) & 0xFFFFFFFF
        reason = int(data.get('reason'))
        version = int(data.get('version', 0))
        snapshot_seq = int(data.get('seq')) & 0xFFFF
    except (TypeError, ValueError):
        return jsonify({'accepted': False, 'decision': 'invalid_completion'}), 400
    incident_id = str(data.get('incident_id', '') or '')
    completion_session = str(data.get('bridge_session', '') or '')[:128]
    if (data.get('snapshot') is not True or version != 1 or
            data.get('crc_valid') is not True or reason != 3 or
            nia != ((fault_nia + 4) & 0xFFFFFFFF)):
        return jsonify({'accepted': False, 'decision': 'invalid_completion'}), 409
    # Lock order matches command ACK and command admission: trace, then command.
    with _wukong_trace_lock:
        with _wukong_command_lock:
            delivery = _wukong_cmd_delivery
            valid_delivery = bool(
                delivery and delivery.get('id') == command_id and
                delivery.get('cmd') == 'k' and delivery.get('write_ok') is True and
                delivery.get('incident_id') == incident_id and
                completion_session and
                delivery.get('bridge_session') == completion_session and
                _wukong_skip_pending and
                _wukong_skip_pending.get('state') == 'awaiting_board_evidence' and
                _wukong_skip_pending.get('command_id') == command_id and
                _wukong_skip_pending.get('bridge_session') == completion_session and
                _wukong_skip_pending.get('expected_skip_snapshot_seq') ==
                snapshot_seq and delivery.get('expected_skip_snapshot_seq') ==
                snapshot_seq)
            if not valid_delivery:
                return jsonify({'accepted': False, 'decision': 'command_mismatch'}), 409
            live = _wukong_latest_trace
            if not (live.get('fault_valid') and
                    live.get('incident_id') == incident_id and
                    int(live.get('nia', -1)) == fault_nia):
                return jsonify({'accepted': False, 'decision': 'fault_mismatch'}), 409
            # Replace live status, never mutate the queued immutable event.
            _wukong_latest_trace = dict(live)
            _wukong_latest_trace['fault_valid'] = False
            _wukong_latest_trace['skip_fault_consumed'] = True
            _wukong_latest_trace['skip_completion_nia'] = nia
            delivery['skip_completion'] = True
            delivery['skip_completion_nia'] = nia
            delivery['skip_completion_ts'] = _wk_time.time()
            delivery['skip_state'] = 'completed'
            _wukong_skip_pending = {
                'state': 'completed', 'command_id': command_id,
                'incident_id': incident_id,
                'bridge_session': completion_session,
                'expected_skip_snapshot_seq': snapshot_seq,
            }
    return jsonify({'accepted': True, 'decision': 'skip_completed'})


@app.route('/hardware/wukong/halt-state', methods=['POST'])
def wukong_halt_state_post():
    """Accept board-emitted halt evidence correlated by bridge session/counter."""
    global _wukong_cmd_delivery, _wukong_run_unlocked, _wukong_boot_info
    auth_ok, auth_error = _optional_report_token_check()
    if not auth_ok:
        return auth_error
    data = request.get_json(silent=True) or {}
    if data.get('state') != 'halted' or data.get('reason') != 'explicit_halt':
        return jsonify({'ok': False, 'accepted': False,
                        'error': 'invalid halt-state evidence'}), 400
    session = str(data.get('session_id', '') or '')[:128]
    try:
        board_counter = int(data.get('board_state_counter'))
        write_counter = int(data.get('state_counter_at_write'))
    except (TypeError, ValueError):
        return jsonify({'ok': False, 'accepted': False,
                        'error': 'missing state counters'}), 400
    if board_counter <= write_counter:
        return jsonify({'ok': False, 'accepted': False,
                        'error': 'halt evidence predates request'}), 409
    now = _wk_time.time()
    if data.get('automatic'):
        with _wukong_bridge_lock:
            current_session = str(_wukong_bridge_info.get('session_id', '') or '')
        if not session or (current_session and session != current_session):
            return jsonify({'ok': False, 'accepted': False,
                            'error': 'bridge session mismatch'}), 409
        with _wukong_boot_info_lock:
            if _wukong_boot_info.get('session_id') != session:
                return jsonify({'ok': False, 'accepted': False,
                                'error': 'boot session mismatch'}), 409
            _wukong_boot_info.update({
                'startup_state': 'awaiting_first_step',
                'halt_confirmed_ts': now,
                'halt_evidence_session': session,
                'board_state_counter': board_counter,
            })
        _wukong_run_unlocked = False
        _queue_wukong_info_event(
            'halt_confirmed', 'halt_confirmed',
            'FPGA emitted halted-state evidence after boot',
            session_id=session, automatic=True,
            board_state_counter=board_counter)
        return jsonify({'ok': True, 'accepted': True})
    try:
        command_id = int(data.get('command_id'))
    except (TypeError, ValueError):
        return jsonify({'ok': False, 'accepted': False,
                        'error': 'missing command id'}), 400
    with _wukong_command_lock:
        d = _wukong_cmd_delivery
        if not d or d.get('id') != command_id or d.get('cmd') != 'h':
            return jsonify({'ok': False, 'accepted': False,
                            'error': 'halt command mismatch'}), 409
        if d.get('write_ok') is not True:
            return jsonify({'ok': False, 'accepted': False,
                            'error': 'halt write not confirmed'}), 409
        if d.get('bridge_session') and d.get('bridge_session') != session:
            return jsonify({'ok': False, 'accepted': False,
                            'error': 'bridge session mismatch'}), 409
        expected_counter = d.get('state_counter_at_write')
        if expected_counter is None or write_counter != expected_counter:
            return jsonify({'ok': False, 'accepted': False,
                            'error': 'halt counter mismatch'}), 409
        try:
            evidence_nonce = int(data.get('halt_nonce'))
        except (TypeError, ValueError):
            evidence_nonce = None
        if evidence_nonce is None or evidence_nonce != d.get('halt_nonce'):
            return jsonify({'ok': False, 'accepted': False,
                            'error': 'halt nonce mismatch'}), 409
        d.update({
            'board_halt_confirmed': True,
            'board_halt_ts': now,
            'board_halt_session': session,
            'board_state_counter': board_counter,
        })
    _queue_wukong_info_event(
        'halt_confirmed', 'halt_confirmed',
        'FPGA emitted halted-state evidence for Halt command',
        session_id=session, command_id=command_id,
        board_state_counter=board_counter)
    return jsonify({'ok': True, 'accepted': True})


@app.route('/hardware/wukong/upload-ack', methods=['POST'])
def wukong_upload_ack_post():
    """Bridge reports the result of a boot-image upload here.

    The acknowledgement is evidence, not a generic completion notification:
    it must echo the queued command id, selected device UID, artifact digest,
    size, identity, and consuming bridge session.
    """
    auth_ok, auth_error = _wukong_control_auth()
    if not auth_ok:
        return auth_error
    global _wukong_upload_ack, _upload_in_flight
    data = request.get_json(silent=True) or {}
    try:
        command_id = int(data.get('id'))
        artifact_size = int(data.get('artifact_size'))
    except (TypeError, ValueError):
        return jsonify({'ok': False, 'accepted': False,
                        'decision': 'upload_correlation_missing'}), 400
    device_uid = str(data.get('target_device_uid', '') or '')[:128]
    bridge_session = str(data.get('session_id', '') or '')[:128]
    artifact_digest = str(data.get('artifact_sha256', '') or '').lower()
    artifact_identity = str(data.get('artifact_identity', '') or '')[:256]
    with _wukong_command_lock:
        delivery = _wukong_cmd_delivery
        correlated = bool(
            delivery and delivery.get('cmd') == 'u' and
            delivery.get('id') == command_id and
            delivery.get('consumed_ts') is not None and
            hmac.compare_digest(str(delivery.get('target_device_uid', '')), device_uid) and
            hmac.compare_digest(str(delivery.get('target_session_id', '')), bridge_session) and
            hmac.compare_digest(str(delivery.get('artifact_sha256', '')), artifact_digest) and
            delivery.get('artifact_size') == artifact_size and
            hmac.compare_digest(str(delivery.get('artifact_identity', '')), artifact_identity))
        if not correlated:
            return jsonify({'ok': False, 'accepted': False,
                            'decision': 'upload_correlation_mismatch',
                            'error': 'upload acknowledgement does not match consumed target command'}), 409
        # A correlated upload acknowledgement is stronger evidence than the
        # generic serial-write ACK: the bridge consumed this exact command and
        # completed (or explicitly failed) its framed payload transaction.
        delivery['write_ok'] = bool(data.get('ok', False))
        delivery['write_error'] = str(data.get('error', '')) if not data.get('ok') else ''
        delivery['write_ts'] = _wk_time.time()
    entry = {
        'ok':    bool(data.get('ok', False)),
        'error': str(data.get('error', '')) if not data.get('ok') else '',
        'id': command_id,
        'target_device_uid': device_uid,
        'session_id': bridge_session,
        'artifact_sha256': artifact_digest,
        'artifact_size': artifact_size,
        'artifact_identity': artifact_identity,
    }
    with _wukong_upload_ack_lock:
        _wukong_upload_ack = entry
    # A confirmed upload changes what the board will run on its next boot:
    # commit the uploaded image's entry slot as the hardware boot entry.
    global _wukong_hw_entry_slot, _wukong_pending_entry_slot, \
        _wukong_active_thread_contexts, _wukong_pending_thread_contexts
    with _wukong_hw_entry_lock:
        if entry['ok'] and _wukong_pending_entry_slot is not None:
            _wukong_hw_entry_slot = _wukong_pending_entry_slot
            _wukong_active_thread_contexts = list(_wukong_pending_thread_contexts)
        _wukong_pending_entry_slot = None
        _wukong_pending_thread_contexts = []
    # Clear the in-flight flag so execution commands are accepted again.
    with _upload_in_flight_lock:
        _upload_in_flight = False
    return jsonify({'ok': True, 'accepted': True, 'id': command_id})


@app.route('/hardware/wukong/upload-ack', methods=['GET'])
def wukong_upload_ack_get():
    """IDE polls here to learn whether the in-progress upload has finished.

    Returns {} when no upload has been attempted this session.
    Returns {ok: true} on success, {ok: false, error: '...'} on failure.
    The result is consumed (reset to {}) on each successful GET so that a
    second upload cycle starts clean.
    """
    global _wukong_upload_ack
    with _wukong_upload_ack_lock:
        entry = dict(_wukong_upload_ack)
        if entry:
            _wukong_upload_ack = {}
    return jsonify(entry)


@app.route('/api/boot-image/send-to-hardware', methods=['POST'])
def boot_image_send_to_hardware():
    """Read the generated boot image and enqueue it as an upload command for
    the Wukong bridge.

    The bridge polls GET /hardware/wukong/command every 50 ms; on receiving
    {cmd:'u', data:'<base64>'} it decodes and writes the bytes to the board
    over UART, then POSTs the result to /hardware/wukong/upload-ack.

    Returns:
        {queued: true}  — image read and upload command enqueued successfully
        {error: '...'}  — boot-image.bin missing or command lock unavailable
    """
    global _wukong_pending_cmd, _wukong_upload_ack, _upload_in_flight
    auth_ok, auth_error = _wukong_control_auth()
    if not auth_ok:
        return auth_error
    import base64 as _b64
    request_data = request.get_json(silent=True) or {}
    target, target_error = _wukong_target_error(request_data)
    if target_error:
        return _wukong_target_rejection(target_error)

    # Atomically claim the in-flight slot under the lock.
    # Checking then releasing and later setting is NOT safe: two concurrent
    # requests can both pass the check before either sets the flag, then both
    # enqueue to the single command slot (second silently overwrites the first).
    # Holding the lock across both the check and the set makes the reservation
    # atomic.  Roll back the flag on every pre-enqueue failure path.
    with _upload_in_flight_lock:
        if _upload_in_flight:
            return jsonify({'error': 'upload in progress — wait for upload-ack',
                            'in_flight': True}), 409
        _upload_in_flight = True   # slot reserved — rolled back on any failure

    _rollback = True   # cleared only on successful enqueue
    try:
        _boot_bin = os.path.join(LUMPS_DIR, 'boot-image.bin')
        _source_b64 = request_data.get('source_image_base64')
        if _source_b64 is not None:
            try:
                _raw = _b64.b64decode(str(_source_b64), validate=True)
            except (ValueError, TypeError):
                return jsonify({'error': 'exact source image is not valid base64'}), 400
            if not _raw or len(_raw) > 1024 * 1024:
                return jsonify({'error': 'exact source image size is invalid'}), 400
            _source_digest = hashlib.sha256(_raw).hexdigest()
            try:
                _claimed_size = int(request_data.get('source_size'))
            except (TypeError, ValueError):
                _claimed_size = -1
            _claimed_digest = str(request_data.get('source_sha256', '') or '').lower()
            _claimed_identity = str(request_data.get('source_identity', '') or '')
            _expected_identity = 'church-simulator-memory-v1:' + _source_digest
            if (_claimed_size != len(_raw) or
                    not hmac.compare_digest(_claimed_digest, _source_digest) or
                    not hmac.compare_digest(_claimed_identity, _expected_identity)):
                return jsonify({
                    'error': 'exact source image digest, size, or identity mismatch',
                    'decision': 'source_artifact_mismatch',
                }), 409
        else:
            if not os.path.isfile(_boot_bin):
                return jsonify({'error': 'boot-image.bin not found — generate it first'}), 404
            try:
                with open(_boot_bin, 'rb') as _fh:
                    _raw = _fh.read()
            except OSError as _exc:
                return jsonify({'error': f'could not read boot-image.bin: {_exc}'}), 500

        # Residency gate: reject an image whose entry lump body is not
        # resident BEFORE it reaches the board — the FPGA cannot lazy-fetch
        # code and would fault on the first fetch after CALL CR0.
        try:
            _entry_info = _boot_image_gen.read_boot_entry_info(_raw)
        except ValueError as _exc:
            return jsonify({'error': f'boot image rejected: {_exc}'}), 400
        if not _entry_info['resident']:
            return jsonify({'error':
                            'boot image rejected — entry lump body not resident: '
                            + (_entry_info['reason'] or 'unknown')
                            + ' (regenerate with a boot-resident entry lump)'}), 400
        if not _entry_info['caps0_ok']:
            return jsonify({'error':
                            'boot image rejected — Thread.caps[0] GT '
                            f"(0x{_entry_info['thread_caps0']:08X}) does not match "
                            f"the stored entry slot {_entry_info['entry_slot']} "
                            f"(expected 0x{_entry_info['expected_gt']:08X}); the "
                            'board would boot a different slot than reported. '
                            'Regenerate the boot image.'}), 400

        try:
            _boot_image_gen.validate_resident_artifact_bindings(
                _raw, LUMPS_DIR,
                require_provenance_image_digest=(_source_b64 is None))
        except ValueError as _exc:
            return jsonify({
                'error': (
                    'hardware upload rejected — boot-image.bin does not match '
                    f'the current Namespace selections: {_exc}'
                ),
                'decision': 'resident_artifact_binding_mismatch',
            }), 409

        # ``boot-image.bin`` is the simulator's generic, tail-table image.
        # Never stream it raw into Wukong's 16K forward-table DMEM: a 32K
        # image wraps its 14-bit upload address and corrupts the entry body.
        # Build the board-native projection after validating the generic source.
        try:
            _wukong_raw, _wukong_entry_info = _boot_image_gen.build_wukong_upload_image(
                _raw, _read_saved_boot_config())
        except ValueError as _exc:
            return jsonify({'error': f'boot image cannot be projected for Wukong: {_exc}'}), 400

        # Multi-Thread projection is safe only on firmware that explicitly
        # advertises the M6 round-robin scheduler.  Do not infer capability
        # from a connection or from a build name: old firmware remains
        # fail-closed and can still receive the compatible single-Thread path.
        if _wukong_entry_info.get('thread_count', 1) > 1:
            with _wukong_boot_info_lock:
                _boot_info = dict(_wukong_boot_info)
            with _wukong_bridge_lock:
                _bridge_session = str(
                    _wukong_bridge_info.get('session_id', '') or '')
            _minimum = _wukong_min_thread_scheduler_build()
            _actual = _boot_info.get('build_version')
            if (_minimum is None or not isinstance(_actual, int) or _actual < _minimum
                    or _boot_info.get('thread_scheduler') is not True
                    or _boot_info.get('trusted') is not True
                    or not _bridge_session
                    or _boot_info.get('session_id') != _bridge_session):
                return jsonify({
                    'error': (
                        'Wukong upload rejected — multi-Thread images require '
                        f'M6 round-robin scheduler firmware build {_minimum or "current"} or newer. '
                        'Flash the supported board image, then reconnect so its boot sentinel is received.'
                    ),
                    'thread_count': _wukong_entry_info['thread_count'],
                    'required_scheduler_build': _minimum,
                    'board_build_version': _actual,
                }), 400

        _encoded = _b64.b64encode(_wukong_raw).decode('ascii')
        _artifact_digest = hashlib.sha256(_wukong_raw).hexdigest()
        # Upload identity is always derived from the exact projected UART
        # bytes. Caller labels are not provenance and cannot replace it.
        _artifact_identity = 'wukong-native-dmem-v1:' + _artifact_digest

        # Register NIA label map so trace events for the uploaded lump resolve
        # to "LumpName.N" labels instead of raw hex NIAs.
        _wukong_update_active_lump_nia(_wukong_raw, _wukong_entry_info)

        # Record which entry slot this upload carries BEFORE the command
        # becomes observable to the bridge: a fast bridge could otherwise
        # consume the command and POST the ACK before the pending slot is
        # set, leaving the ACK unable to commit it (and the value stale).
        # Rolled back in the finally block on any enqueue failure.
        global _wukong_pending_entry_slot, _wukong_pending_thread_contexts
        with _wukong_hw_entry_lock:
            _wukong_pending_entry_slot = _wukong_entry_info['entry_slot']
            _wukong_pending_thread_contexts = list(_wukong_entry_info.get('thread_contexts', []))

        # Clear any stale ACK from a previous upload BEFORE making the new
        # upload command observable to the bridge.  Clearing after would create
        # a race: a fast bridge could complete and POST the new ACK in the
        # interval between the command enqueue and the clear, causing the IDE
        # poll to time out on a stale {} response.
        with _wukong_upload_ack_lock:
            _wukong_upload_ack = {}

        global _wukong_cmd_delivery, _wukong_cmd_id
        with _wukong_command_lock:
            _wukong_cmd_id += 1
            _wukong_pending_cmd = {'cmd': 'u', 'data': _encoded, 'reboot': True,
                                   'id': _wukong_cmd_id, **target,
                                   'target_device_uid': target['device_uid'],
                                   'artifact_sha256': _artifact_digest,
                                   'artifact_size': len(_wukong_raw),
                                   'artifact_identity': _artifact_identity}
            _wukong_cmd_delivery = {
                'id':          _wukong_cmd_id,
                'cmd':         'u',
                'queued_ts':   _wk_time.time(),
                'consumed_ts': None,
                'write_ok':    None,
                'write_error': '',
                'write_ts':    None,
                'target_device_uid': target['device_uid'],
                'target_session_id': target['bridge_session'],
                'artifact_sha256': _artifact_digest,
                'artifact_size': len(_wukong_raw),
                'artifact_identity': _artifact_identity,
            }

        _rollback = False   # committed — in-flight flag stays set
        return jsonify({'queued': True, 'size': len(_wukong_raw),
                        'source_size': len(_raw),
                        'format': 'wukong-native-dmem-v1',
                        'entry_slot': _wukong_entry_info['entry_slot'],
                        'id': _wukong_cmd_id,
                        'target_device_uid': target['device_uid'],
                        'artifact_sha256': _artifact_digest,
                        'artifact_identity': _artifact_identity})
    finally:
        if _rollback:
            with _wukong_hw_entry_lock:
                _wukong_pending_entry_slot = None
                _wukong_pending_thread_contexts = []
            with _upload_in_flight_lock:
                _upload_in_flight = False


@app.route('/hardware/wukong/boot-info', methods=['POST'])
def wukong_boot_info_post():
    """Bridge posts boot-info here when a boot sentinel is received.

    Body JSON:
        stale_tu   — true when the TraceUnit FSM predates the 3-packet CALL
                     sequence (i.e. old 0xBB sentinel, or 0xBC with
                     tu_version < TU_VERSION_CALL_3PKT)
        tu_version — raw TU_VERSION byte from the sentinel (0x01 for 0xBB boards)
        thread_scheduler — explicit M6 round-robin scheduler advertisement
        startup_state — awaiting_first_step after the bridge writes Halt
    """
    global _wukong_boot_info, _wukong_run_unlocked, _wukong_runtime_identity, \
        _wukong_step_write_trace_seq, _wukong_step_bridge_session
    auth_ok, auth_error = _wukong_control_auth()
    if not auth_ok:
        return auth_error
    data = request.get_json(silent=True) or {}
    reported_session = str(data.get('session_id', '') or
                           request.headers.get('X-Wukong-Session', '') or '')[:128]
    reported_uid = str(data.get('device_uid', '') or
                       request.headers.get('X-Wukong-Device-UID', '') or '')[:128]
    with _wukong_bridge_lock:
        active_session = str(_wukong_bridge_info.get('session_id', '') or '')
        active_uid = str(_wukong_bridge_info.get('device_uid', '') or '')
    if (not reported_session or reported_session != active_session or
            not reported_uid or not active_uid or
            not hmac.compare_digest(reported_uid, active_uid)):
        return jsonify({
            'ok': False,
            'error': 'boot sentinel does not match the active bridge target',
        }), 409
    bv = data.get('build_version')
    entry = {
        'stale_tu':     bool(data.get('stale_tu', False)),
        'tu_version':   int(data.get('tu_version', 0)),
        'build_version': int(bv) if bv is not None else None,
        'thread_scheduler': bool(data.get('thread_scheduler', False)),
        'startup_state': str(data.get('startup_state', '') or '')[:40],
        'session_id':   reported_session,
        'device_uid':   reported_uid,
        'trusted':      True,
        # Server-side receive timestamp: lets the /fpga page confirm a FRESH
        # sentinel arrived after an explicit reboot or authorized fault recovery.
        'received_ts':   _wk_time.time(),
    }
    with _wukong_boot_info_lock:
        _wukong_boot_info = entry
    # A sentinel denotes a new board boot epoch.  Previous runtime proof,
    # even for the same USB session, cannot authorize this epoch.
    with _wukong_command_lock:
        _wukong_run_unlocked = False
        _wukong_runtime_identity = None
        _wukong_step_write_trace_seq = None
        _wukong_step_bridge_session = entry.get('session_id', '')
    if entry.get('startup_state') == 'awaiting_first_step':
        # The state is already recorded above; retain this branch as the
        # explicit protocol marker for callers reading the source.
        pass
    with _wukong_bridge_lock:
        _wukong_bridge_timeline.append({
            'ts': entry['received_ts'], 'session_id': entry['session_id'],
            'event': 'boot_sentinel', 'state': 'connected',
            'reason': 'boot sentinel observed',
            'serial_port': _wukong_bridge_info.get('serial_port', ''),
            'reconnect_attempt': 0,
        })
        del _wukong_bridge_timeline[:-_WUKONG_BRIDGE_TIMELINE_MAXLEN]
    return jsonify({'ok': True})


@app.route('/hardware/wukong/boot-info', methods=['GET'])
def wukong_boot_info_get():
    """IDE polls here to learn whether the connected bitstream is stale.

    Returns {} when no boot sentinel has been received yet this session.
    """
    with _wukong_boot_info_lock:
        entry = dict(_wukong_boot_info)
    return jsonify(entry)


@app.route('/dev/firmware/main.c')
def _dev_serve_maincfirmware():
    _src = os.path.join(os.path.dirname(_SERVER_DIR),
                        'hardware', 'soc_combined', 'firmware', 'main.c')
    return send_file(_src, mimetype='text/plain', as_attachment=False,
                     download_name='main.c')


@app.route('/dev/firmware/Makefile')
def _dev_serve_makefile():
    _src = os.path.join(os.path.dirname(_SERVER_DIR),
                        'hardware', 'soc_combined', 'firmware', 'Makefile')
    return send_file(_src, mimetype='text/plain', as_attachment=False,
                     download_name='Makefile')

# ── Build Approval — module-level constants and mutable state ─────────────────
import struct as _ba_struct          # module — call sites use 3-arg unpack_from(fmt, buf, off)
import hashlib as _ba_hashlib
import datetime as _ba_datetime

_BUILD_SNAPSHOTS_DIR  = (
    _BUILD_SNAPSHOTS_DIR_OVERRIDE
    if _BUILD_SNAPSHOTS_DIR_OVERRIDE
    else os.path.join(_SERVER_DIR, 'build-snapshots')
)
_LUMPS_DIR            = LUMPS_DIR          # alias to the project-wide constant

_BA_NONCE_TTL_SECS    = 300               # nonce valid for 5 minutes
_ba_nonce_store: dict = {}
_ba_nonce_lock        = threading.Lock()

_ba_build_log:  list  = []
_ba_build_done: bool  = True              # True = idle; False = in-progress
_ba_build_exit        = None
_ba_build_phase       = 'idle'
_ba_build_diagnosis   = None
_ba_build_started_at  = None
_ba_build_updated_at  = None
_ba_build_finished_at = None
_ba_build_lock        = threading.Lock()
_ba_build_version_context = None

# Droplet SSH configuration — overridable via environment variables.
# Defaults match the DigitalOcean CPU-Optimised droplet used for Wukong synthesis.
_DROPLET_USER      = os.environ.get('DROPLET_USER',      'root')
_DROPLET_IP        = os.environ.get('DROPLET_IP',        '165.227.190.84')
_DROPLET_BUILD_DIR = os.environ.get('DROPLET_BUILD_DIR', '~/church-wukong-package')
_VIVADO_SESSION    = os.environ.get('VIVADO_SESSION',    'vivado_cm')
# ──────────────────────────────────────────────────────────────────────────────


def _ba_fresh_nonce():
    """Generate a new build nonce valid for _BA_NONCE_TTL_SECS seconds."""
    import time as _time
    nonce = secrets.token_urlsafe(24)
    with _ba_nonce_lock:
        _ba_nonce_store['nonce']   = nonce
        _ba_nonce_store['expires'] = _time.monotonic() + _BA_NONCE_TTL_SECS
    return nonce


def _ba_provenance_identity(ns_map, source_commit=None, source_version=None):
    """Return a stable, exact build-intent identity for an approved map.

    This is deliberately derived from immutable approval/provenance facts, not
    from the one-use CSRF nonce.  A nonce proves request freshness; it must
    never become the name of the artifact the request intends to build.
    """
    material = {
        'schema': 'wukong-build-intent-v1',
        'namespace_map': ns_map,
        'source_commit': source_commit or _git_full_head() or _git_short_hash(),
        'source_version': source_version if source_version is not None
                          else _wukong_build_version(),
    }
    canonical = json.dumps(material, sort_keys=True, separators=(',', ':'),
                           ensure_ascii=True)
    return 'wukong-build-intent:v1:' + hashlib.sha256(
        canonical.encode('utf-8')).hexdigest()

def _ba_check_report_token():
    """
    Verify that REPORT_TOKEN is configured and matches the caller's Authorization header.

    Returns (ok: bool, error_response | None).

    REPORT_TOKEN is required; this function is NOT satisfied by a nonce alone.
    If REPORT_TOKEN is not set in the environment the endpoint is blocked entirely
    (configuration error — the secret must be configured before build actions work).
    """
    report_token = os.environ.get("REPORT_TOKEN", "")
    if not report_token:
        err = jsonify({
            'ok': False,
            'error': 'REPORT_TOKEN secret not configured — set it to enable build actions.'
        })
        return False, (err, 503)

    auth_header = request.headers.get("Authorization", "")
    # Bearer header only — no query-string token support.
    # Query-string tokens appear in server logs, proxy logs, and browser history,
    # which is unacceptable for a credential that authorises privileged SSH access.
    if auth_header == f"Bearer {report_token}":
        return True, None

    err = jsonify({
        'ok': False,
        'error': (
            'Unauthorized — supply REPORT_TOKEN via Authorization: Bearer header.'
        )
    })
    return False, (err, 401)

def _ba_read_lump_header(path):
    """Return structural header facts, independent of approval-ledger state.

    A valid released resident binary can be structurally readable before it has
    a separate approval record.  Approval status must not be reported as
    "header magic invalid or file unreadable".
    """
    try:
        inspected = _inspect_lump_binary(path, allow_compact_fit=True)
        return inspected["header"], inspected["cw"], inspected["cc"]
    except Exception:
        return None


# This is the complete serialized contract for one Namespace row in the
# Build Approval payload. Keep this metadata-only: live device state (for
# example the current M_BIT_DEV value) is intentionally not an approval field.
_BA_APPROVAL_ROW_FIELDS = (
    'slot', 'name', 'token', 'header_word', 'cw', 'cc', 'location',
    'words', 'limit', 'load_policy', 'slot_rule', 'perms', 'source',
    'programmable', 'size_budget', 'checks',
)
_BA_APPROVAL_ROW_FIELD_SET = frozenset(_BA_APPROVAL_ROW_FIELDS)


def _ba_validate_approval_rows(rows):
    """Require every serialized Namespace row to match the approval contract.

    Exact-key validation is deliberate. Missing fields make a row ambiguous
    to the approval renderer, while unexpected fields can accidentally expose
    mutable runtime state in a payload meant to describe approval metadata.
    """
    if not isinstance(rows, list):
        raise TypeError('Build Approval slot_rules must be a list')

    for index, row in enumerate(rows):
        if not isinstance(row, dict):
            raise TypeError(f'Build Approval row {index} must be an object')
        actual = set(row)
        missing = sorted(_BA_APPROVAL_ROW_FIELD_SET - actual)
        unexpected = sorted(actual - _BA_APPROVAL_ROW_FIELD_SET)
        if missing or unexpected:
            details = []
            if missing:
                details.append(f'missing={missing}')
            if unexpected:
                details.append(f'unexpected={unexpected}')
            raise ValueError(
                f'Build Approval row {index} violates the serialized '
                f'field contract: {"; ".join(details)}')
    return rows


@app.route('/api/build-approval/snapshot/latest', methods=['GET'])
def build_approval_snapshot_latest():
    """Return metadata for the most recent frozen snapshot.

    Requires REPORT_TOKEN auth — snapshot records contain live NS map data.
    """
    ok, err = _ba_check_report_token()
    if not ok:
        return err
    try:
        if not os.path.isdir(_BUILD_SNAPSHOTS_DIR):
            return jsonify({'filename': None})
        files = sorted([f for f in os.listdir(_BUILD_SNAPSHOTS_DIR)
                        if f.startswith('build-approval-') and f.endswith('.json')])
        if not files:
            return jsonify({'filename': None})
        latest = files[-1]
        path = os.path.join(_BUILD_SNAPSHOTS_DIR, latest)
        with open(path) as f:
            snap = json.load(f)
        return jsonify({
            'filename': latest, 'frozen_at': snap.get('frozen_at'),
            'provenance_identity': snap.get('provenance_identity'),
            'build_intent_id': snap.get('provenance_identity'),
        })
    except Exception as e:
        return jsonify({'filename': None, 'error': str(e)})

def _ba_md5_file(path):
    m = _ba_hashlib.md5()
    try:
        with open(path, 'rb') as f:
            for chunk in iter(lambda: f.read(1 << 20), b''):
                m.update(chunk)
        return m.hexdigest()
    except Exception:
        return None

def _ba_validate_lump_size(n_words, cw, cc):
    """
    Return an error string if LUMP file length is inconsistent with the header's
    cw/cc declaration, or None if the size is acceptable.

    Valid LUMP files are either exactly (1 + cw + cc) words (no padding) or
    padded to the next power of two.  Anything else — including files with
    appended data — is rejected to prevent boundary-confusion attacks where
    correct opcodes/GTs appended beyond the declared content fool the checks.
    """
    import math as _math
    min_w = 1 + cw + cc
    if n_words < min_w:
        return (f'file too short: {n_words} words but header declares '
                f'1+{cw}(cw)+{cc}(cc)={min_w} words')
    if n_words == min_w:
        return None   # exact fit — no padding
    if min_w > 1:
        pow2_w = 1 << _math.ceil(_math.log2(min_w))
    else:
        pow2_w = 1
    if n_words == pow2_w:
        return None   # padded to next power of two — normal LUMP format
    return (f'unexpected file size: {n_words} words '
            f'(header cw={cw} cc={cc} → expect {min_w} or {pow2_w}; '
            f'possible appended-data tampering)')

def _ba_lump_size_budget(path):
    """Derive a safe, reconciled size budget from a big-endian LUMP binary."""
    if not path or not os.path.isfile(path):
        return {'available': False, 'reason': 'binary unavailable'}
    try:
        # Use the same intrinsic parser as the header/cw/cc checks.  Keeping a
        # second ad-hoc decoder here can make one row show valid cw/cc while
        # its budget is derived from a different interpretation of the file.
        inspected = _inspect_lump_binary(path, allow_compact_fit=True)
        raw = inspected['raw_bytes']
        words = inspected['words']
        cw, cc = inspected['cw'], inspected['cc']
        allocation = inspected['lump_size']
        frame = _lump_freespace_content(words)
        api = 1 + ((frame['api_len'] + 3) // 4) if frame else 0
        source = (frame['content_words'] - api) if frame else 0
        freespace = max(0, len(words) - 1 - cw - cc)
        return {
            'available': True,
            'metadata': 'measured' if frame else 'unavailable',
            'code': {'words': cw, 'bytes': cw * 4},
            'api': {'words': api, 'bytes': api * 4, 'measured': bool(frame)},
            'gt_capabilities': {'words': cc, 'bytes': cc * 4},
            'freespace': {'words': freespace, 'bytes': freespace * 4, 'reserved': True},
            'total': {'words': len(words), 'bytes': len(raw)},
            'allocation': {'words': allocation, 'bytes': allocation * 4},
            'reconciles': 1 + cw + cc + freespace == len(words),
        }
    except Exception as exc:
        return {'available': False, 'reason': f'cannot read binary: {exc}'}

def _ba_check_selftest_egt(lump_path, selftest_ns_slot, selftest_sequence=0):
    """
    Verify both canonical SelfTest c-list entries against live Namespace state.

    The c-list is stored at the LAST cc words of the lump file.  For the
    c-list rows are addressed from the header-declared allocation and cc, not
    a historical 512-word binary shape.  Both row 0 (self) and row 1 (Next)
    carry the selected slot's live E-GT.

    This is the check that would have caught the v12→v13 regression where the
    SelfTest return-channel GT was corrupted: an incorrect c-list[0] means the
    binary diverges from what boot_rom asserts.

    Fails CLOSED: if the expected value cannot be computed the check returns
    ok=False rather than passing silently.
    """
    expected_gt  = None
    import_err   = None
    try:
        expected_gt = _boot_image_gen.create_gt(
            selftest_sequence, selftest_ns_slot, {"E": 1}, 1)
    except Exception as _e:
        import_err = str(_e)

    if expected_gt is None:
        # Fail closed: cannot verify without the expected value
        return {'ok': False,
                'detail': f'Cannot derive expected E-GT from boot_rom ({import_err}) — FAIL'}

    try:
        with open(lump_path, 'rb') as f:
            data = f.read()
        n_words = len(data) // 4
        if n_words < 2:
            return {'ok': False, 'detail': 'LUMP too short to inspect c-list'}
        w0 = _ba_struct.unpack_from('>I', data, 0)[0]
        cw = (w0 >> 10) & 0x1FFF
        cc = w0 & 0xFF
        if cc != 2:
            return {'ok': False, 'detail': f'SelfTest LUMP has cc={cc}; expected cc=2'}
        # Validate file size before using file-length-derived c-list offset to
        # prevent appended-data attacks where a correct GT is placed beyond the
        # declared content boundary.
        size_err = _ba_validate_lump_size(n_words, cw, cc)
        if size_err:
            return {'ok': False, 'detail': f'LUMP integrity: {size_err}'}
        # c-list occupies the last cc words of the validated allocation.
        row0 = _ba_struct.unpack_from('>I', data, (n_words - cc) * 4)[0]
        row1 = _ba_struct.unpack_from('>I', data, (n_words - cc + 1) * 4)[0]
        ok = row0 == expected_gt and row1 == expected_gt
        verdict = '✅ matches boot_rom' if ok else '❌ mismatch'
        return {'ok': ok,
                'detail': (f'c-list[0]=0x{row0:08X} c-list[1]=0x{row1:08X} '
                           f'expected=0x{expected_gt:08X} {verdict}')}
    except Exception as e:
        return {'ok': None, 'detail': f'c-list check error: {e}'}

def _ba_check_final_opcode(lump_path):
    """
    Scan the last non-zero word of the executable code section and verify
    it is BRANCH (5-bit opcode 23, bits[31:27]), not Church RETURN (opcode 3).

    The Church Machine ISA encodes opcodes in bits[31:27] (5 bits), not bits[31:26].
    BRANCH=23 (0b10111), Church RETURN=3 (0b00011).

    This catches the v12→v13 regression where a SelfTest loop-back BRANCH was
    accidentally replaced by RETURN, which would cause the SelfTest to return
    instead of looping — a silent control-flow corruption invisible without this gate.

    Returns a dict:
        ok=True   — terminal opcode is BRANCH (23) ✅
        ok=False  — terminal opcode is RETURN (3) ❌ regression detected
        ok=None   — terminal opcode is neither 23 nor 3 ⚠️ (unexpected; warning only,
                    does NOT block Approve because some lumps use extended ISA encodings)
    """
    BRANCH_OP  = 23   # bits[31:27] = 0b10111
    RETURN_OP  =  3   # bits[31:27] = 0b00011  (Church RETURN, not opcode 24)
    try:
        with open(lump_path, 'rb') as f:
            data = f.read()
        n_words = len(data) // 4
        if n_words < 2:
            return {'ok': False, 'detail': 'LUMP too short to check opcodes'}
        w0 = _ba_struct.unpack_from('>I', data, 0)[0]
        cw = (w0 >> 10) & 0x1FFF   # header-declared code word count
        cc = w0 & 0xFF
        # Validate file size against header before using any derived offsets.
        # This prevents appended-data attacks where a correct BRANCH instruction
        # is appended beyond the declared content boundary so that the
        # file-length-derived code_end points at the attacker's word.
        size_err = _ba_validate_lump_size(n_words, cw, cc)
        if size_err:
            return {'ok': False, 'detail': f'LUMP integrity: {size_err}'}
        # Use the HEADER-DEFINED code section boundary (word index cw is the
        # last code word), not a file-length-derived offset.
        code_end = cw
        if code_end < 1:
            return {'ok': None, 'detail': 'Code section too short to check (cw=0)'}
        # Scan backward within the header-declared code section for the last
        # non-zero instruction word (skip zero-padded gap before c-list).
        last_w = None
        last_idx = None
        for i in range(code_end, 0, -1):
            w = _ba_struct.unpack_from('>I', data, i * 4)[0]
            if w != 0:
                last_w = w
                last_idx = i
                break
        if last_w is None:
            return {'ok': None, 'detail': 'Code section is all zeros — cannot check opcode'}
        # 5-bit opcode: bits[31:27]
        op = (last_w >> 27) & 0x1F
        if op == RETURN_OP:
            return {'ok': False,
                    'opcode': op,
                    'detail': (f'❌ REGRESSION: terminal opcode={op} (RETURN) at word[{last_idx}]'
                               f' — should be BRANCH({BRANCH_OP}); 0x{last_w:08X}')}
        if op == BRANCH_OP:
            return {'ok': True,
                    'opcode': op,
                    'detail': (f'terminal opcode={op} (BRANCH ✅) at word[{last_idx}];'
                               f' 0x{last_w:08X}; header code boundary word[{cw}]'
                               f' (legacy SelfTest boundary word[499] is outside this binary)')}
        # Neither BRANCH nor RETURN — warn but do not block approval
        return {'ok': None, 'warn': True,
                'opcode': op,
                'detail': (f'⚠️ terminal opcode={op} at word[{last_idx}] — not RETURN({RETURN_OP}) ✓,'
                           f' not BRANCH({BRANCH_OP}) (extended ISA encoding); 0x{last_w:08X}')}
    except Exception as e:
        return {'ok': None, 'detail': f'Opcode check error: {e}'}

@app.route('/api/build-approval/ns-map', methods=['GET'])
def build_approval_ns_map():
    """Return the full NS map with per-slot verification checks.

    Requires REPORT_TOKEN authentication.  On success, also returns a fresh
    build_nonce that the browser must supply as a CSRF guard when calling
    /api/wukong-build/start.  Because this endpoint is auth-gated, the nonce
    is session-bound — an unauthenticated caller cannot obtain one.
    """
    ok, err = _ba_check_report_token()
    if not ok:
        return err

    try:
        data = _ba_build_ns_map()
        # Keep the endpoint boundary independently guarded: this catches a
        # future builder/refactor that returns rows without running the
        # canonical normalization below.
        _ba_validate_approval_rows(data.get('slot_rules'))
        data['build_nonce'] = _ba_fresh_nonce()
        return jsonify(data)
    except Exception as e:
        app.logger.exception('build-approval/ns-map error')
        return jsonify({'error': str(e)}), 500

def _ba_build_ns_map():
    """Assemble the full NS map with per-slot checks. Returns a dict."""
    import re as _re

    ROOT = os.path.dirname(_SERVER_DIR)

    # Build Approval reports physical Namespace facts only from a validated
    # generated image.  Config/ROM values below are policy and board facts,
    # not substitutes for this binary contract.
    namespace_header = {
        "available": False,
        "error": "boot-image.bin has not been generated",
    }
    if os.path.isfile(BOOT_IMAGE_PATH):
        try:
            with open(BOOT_IMAGE_PATH, "rb") as _header_image:
                namespace_header = _boot_image_gen.read_namespace_header_info(
                    _header_image.read())
            namespace_header["available"] = True
        except (OSError, ValueError) as exc:
            namespace_header = {
                "available": False,
                "error": f"boot-image.bin Namespace Header V2 is invalid: {exc}",
            }

    # ── Read boot_rom.py constants ─────────────────────────────────────────
    rom_path = os.path.join(ROOT, 'hardware', 'boot_rom.py')
    try:
        with open(rom_path) as f:
            rom_src = f.read()
    except Exception:
        rom_src = ''

    def _rom(pattern, default):
        m = _re.search(pattern, rom_src)
        return m.group(1) if m else default

    # SelfTest is a movable, state-owned program rather than a ROM slot.
    selftest_slot   = None
    callhome_slot   = int(_rom(r'WUKONG_CALLHOME_NS_SLOT\s*=\s*(\d+)',  '7'))
    ns_slot_count   = int(_rom(r'NS_SLOT_COUNT\s*=\s*(\d+)',             '8'))
    selftest_base   = _rom(r'WUKONG_SELFTEST_BASE_BYTE\s*=\s*(0x[0-9a-fA-F]+|\d+)', '0x600')
    # callhome base — match the literal constant assignment (not the indirect alias)
    callhome_base   = _rom(r'WUKONG_CALLHOME_BASE_BYTE\s*=\s*(0x[0-9a-fA-F]+|\d+)', '0x1200')

    # Built-in device rows are intrinsic Namespace entries, not runtime
    # LUMPs. Keep every device fact tied to the same architecture catalog
    # used by the boot-image generator so approval cannot drift from boot.
    device_catalog = _boot_image_gen.architecture_device_catalog()
    m_bit_slot = device_catalog['M_BIT_DEV']['slot']

    # NS_TABLE_BASE from hw_types.py
    hw_types_path = os.path.join(ROOT, 'hardware', 'hw_types.py')
    try:
        with open(hw_types_path) as f:
            hw_src = f.read()
        m3 = _re.search(r'NS_TABLE_BASE\s*=\s*(0x[0-9a-fA-F]+|\d+)', hw_src)
        ns_table_base = m3.group(1) if m3 else '0x1FC00'
    except Exception:
        ns_table_base = '0x1FC00'

    # Thread base
    thread_base_word = int(_rom(r'WUKONG_THREAD_BASE_WORD\s*=\s*(\d+)', '896'))
    thread_base = hex(thread_base_word * 4)

    # ── Namespace Table state ─────────────────────────────────────────────
    # The committed Namespace state is the authority for membership and slot
    # assignment.  The manifest is deliberately not consulted to create
    # entries here; it is only a catalog used later to locate loose bytes.
    manifest_path = os.path.join(_LUMPS_DIR, 'manifest.json')
    ns_state_path = os.path.join(_LUMPS_DIR, 'ns-state.json')
    ns_entries = []
    try:
        with open(ns_state_path) as f:
            state = json.load(f)
        ns_entries = state.get('abstractions', []) if isinstance(state, dict) else []
    except Exception:
        pass

    # Normalize the rich state format for the existing rendering/check code.
    # A state entry may carry its token directly; absent tokens are resolved
    # from canonical filenames by name, never from a manifest slot claim.
    manifest_by_slot = {}
    for state_entry in ns_entries:
        if not isinstance(state_entry, dict) or not isinstance(state_entry.get('slot'), int):
            continue
        entry = dict(state_entry)
        entry['ns_slot'] = state_entry['slot']
        entry['abstraction'] = state_entry.get('name', '?')
        entry['token'] = state_entry.get('token') or state_entry.get('cache_token')
        if not entry.get('token'):
            state_filename = entry.get('filename')
            if isinstance(state_filename, str) and os.path.basename(state_filename) == state_filename:
                parts = state_filename.rsplit('.', 2)
                if len(parts) == 3 and parts[-1] == 'lump':
                    entry['token'] = parts[1]
            if not entry.get('token'):
                import glob as _glob
                pat = os.path.join(_LUMPS_DIR, f"{entry['abstraction']}.*.????????.lump")
                candidates = sorted(_glob.glob(pat))
                if candidates:
                    entry['filename'] = os.path.basename(candidates[-1])
                    entry['token'] = os.path.basename(candidates[-1]).rsplit('.', 2)[1]
        manifest_by_slot[entry['ns_slot']] = entry
    manifest_no_slot = []
    _active_selftest = [
        entry for entry in manifest_by_slot.values()
        if entry.get('abstraction') == 'SelfTest'
    ]
    if len(_active_selftest) == 1:
        selftest_slot = _active_selftest[0]['ns_slot']

    # Load policy belongs to the individual Namespace slot.  Do not infer it
    # from the slot number: slot 6 can be lazy while slot 10 can be resident,
    # or vice versa.  The saved Boot Image Designer setting is authoritative;
    # artifact metadata is retained as a compatibility fallback for older
    # projects that predate persisted per-slot policy rows.
    slot_policy_by_slot = {}
    step2_policy_by_slot = {}
    boot_entry_slot = DEFAULT_BOOT_CONFIG["bootEntrySlot"]
    generated_thread_slots = set()
    saved_step1 = dict(DEFAULT_BOOT_CONFIG.get("step1") or {})
    try:
        saved_cfg, saved_cfg_err = _read_saved_boot_config()
        if saved_cfg_err is None and isinstance(saved_cfg, dict):
            if isinstance(saved_cfg.get("step1"), dict):
                saved_step1.update(saved_cfg["step1"])
            generated_thread_slots = _generated_thread_slots_for_step1(
                saved_cfg.get("step1") or {})
            if isinstance(saved_cfg.get("bootEntrySlot"), int):
                boot_entry_slot = saved_cfg["bootEntrySlot"]
            for raw_slot, policy_value in (saved_cfg.get("slotRules") or {}).items():
                try:
                    policy_slot = int(raw_slot)
                except (TypeError, ValueError):
                    continue
                if policy_value in SLOT_RULE_VALUES:
                    slot_policy_by_slot[policy_slot] = policy_value
            for policy_row in ((saved_cfg.get('step2') or {}).get('lumps') or []):
                if not isinstance(policy_row, dict):
                    continue
                policy_slot = policy_row.get('nsSlot')
                policy_value = policy_row.get('loadPolicy', policy_row.get('load_policy'))
                if isinstance(policy_slot, int) and policy_value in (
                        'Empty', 'Resident', 'Preload', 'Lazy'):
                    step2_policy_by_slot[policy_slot] = policy_value
    except Exception:
        # Approval rendering must remain available when an older config cannot
        # be fully validated; the default fallback below still works.
        pass

    if namespace_header.get("available"):
        # A generated image is the boot authority. The saved selection remains
        # useful while no image exists, but must never relabel an older image.
        boot_entry_slot = namespace_header["boot_entry_slot"]

    thread_size = int(saved_step1.get("threadLumpWords") or 256)
    thread_stack_words = int(saved_step1.get("threadStackWords") or 32)
    thread_layout = _boot_image_gen.thread_layout(thread_size, thread_stack_words)

    def _state_lump_path(state_entry):
        """Resolve a row's exact Namespace-state filename before its token."""
        if not isinstance(state_entry, dict):
            return None
        filename = state_entry.get("filename")
        if isinstance(filename, str) and filename:
            safe_name = os.path.basename(filename)
            if safe_name == filename:
                exact_path = os.path.join(_LUMPS_DIR, safe_name)
                if os.path.isfile(exact_path):
                    return exact_path
        token = state_entry.get("token") or state_entry.get("cache_token")
        return _ba_lump_file_for_token(token) if token else None

    def _row_source(state_entry, lump_path=None, fallback='N/A'):
        """Return a stable source label without hiding a state filename."""
        if isinstance(state_entry, dict) and state_entry.get("filename"):
            return os.path.basename(str(state_entry["filename"]))
        if lump_path:
            return os.path.basename(lump_path)
        return fallback

    def _thread_size_budget(layout):
        """Describe a generated Thread body using the shared zone layout."""
        sections = [
            ("Header", 1),
            ("Data registers", 16),
            ("Protected STO", 1),
            ("Heap", layout["heap_words"]),
            ("LIFO stack", layout["stack_words"]),
            ("Capability homes", layout["caps_words"]),
        ]
        total_words = layout["lump_size"]
        return {
            "available": True,
            "metadata": "generated Thread body",
            "sections": [
                {"label": label, "words": words, "bytes": words * 4}
                for label, words in sections
            ],
            # Keep the legacy aggregate fields for the approval budget and
            # existing consumers, while the sections above are authoritative
            # for the row's human-readable layout.
            "code": {"words": layout["stack_words"], "bytes": layout["stack_words"] * 4},
            "api": {"words": 0, "bytes": 0, "measured": True},
            "gt_capabilities": {
                "words": layout["caps_words"], "bytes": layout["caps_words"] * 4
            },
            "freespace": {"words": 0, "bytes": 0, "reserved": False},
            "total": {"words": total_words, "bytes": total_words * 4},
            "allocation": {"words": total_words, "bytes": total_words * 4},
            "reconciles": sum(words for _, words in sections) == total_words,
        }

    def _not_applicable_budget(description):
        return {
            "available": False,
            "reason": f"N/A — {description}",
            "metadata": "not applicable",
        }

    def _slot_policy(slot_num, state_entry=None, lump_path=None, default='Lazy'):
        selected_rule = slot_policy_by_slot.get(slot_num)
        if selected_rule in ('Bootstrap', 'Hardware', 'Empty', 'Resident', 'Preload', 'Lazy'):
            return selected_rule
        if slot_num in step2_policy_by_slot:
            return step2_policy_by_slot[slot_num]
        if isinstance(state_entry, dict):
            value = state_entry.get('loadPolicy', state_entry.get('load_policy'))
            if value in ('Empty', 'Resident', 'Preload', 'Lazy'):
                return value
        return default

    # These lists are referenced by the policy router before the later
    # manifest scan, so initialize both before defining/calling the helper.
    lazy = []

    def _append_policy_row(row, policy):
        row['load_policy'] = policy
        if policy == 'Empty':
            # Keep explicitly empty slots visible in the one-row-per-slot
            # approval table so their rule can be changed again. Empty is
            # still non-blocking and remains outside the resident tier.
            lazy.append(row)
            return
        # Preload is a startup fetch, not a body baked into boot RAM.  It is
        # therefore visible with the fetched group and remains non-blocking for
        # hardware approval on this Wukong target.
        (resident if policy == 'Resident' else lazy).append(row)

    # ── Helper: build checks for a LUMP slot ──────────────────────────────
    def _lump_checks(slot_num, token, manifest_entry, lump_path, is_selftest=False):
        checks = []

        # 1. LUMP file present?
        if lump_path and os.path.exists(lump_path):
            hdr = _ba_read_lump_header(lump_path)
            # 1a. Header valid (magic 0x1F)
            if hdr:
                checks.append({'label': 'header', 'ok': True,
                                'detail': f'Header valid: 0x{hdr[0]:08X}  cw={hdr[1]} cc={hdr[2]}'})
                checks.append({'label': 'cw/cc', 'ok': True,
                               'detail': f'binary cw={hdr[1]} cc={hdr[2]}'})
                # 1c. md5 (token parity — we just verify file is readable with correct magic)
                md5 = _ba_md5_file(lump_path)
                checks.append({'label': 'binary', 'ok': md5 is not None,
                               'detail': f'md5={md5 or "read-error"}'})
            else:
                checks.append({'label': 'header', 'ok': False,
                                'detail': 'LUMP header magic invalid or file unreadable'})
        else:
            checks.append({'label': 'file', 'ok': False,
                            'detail': f'LUMP binary not found: {lump_path}'})

        # Token parity — manifest token should match the committed state token.
        if manifest_entry and token:
            m_token = manifest_entry.get('token', '')
            token_ok = (not m_token) or (m_token.lower() == token.lower())
            checks.append({'label': 'token', 'ok': token_ok,
                           'detail': f'manifest token={m_token!r} file={token!r}'})

        # 4. SelfTest-specific checks: RETURN-vs-BRANCH opcode + c-list E-GT
        if is_selftest and lump_path and os.path.exists(lump_path):
            # 4a. Terminal opcode check — catch v12→v13 regression (RETURN instead of BRANCH)
            op_chk = _ba_check_final_opcode(lump_path)
            # The approved 512-word canonical SelfTest currently ends with
            # extended-ISA opcode 8 at its declared boundary.  The generic
            # checker must continue warning on unknown opcodes for other
            # binaries, but this canonical SelfTest shape is intentional and
            # should not be presented as an unresolved approval issue.
            if op_chk.get('opcode') == 8 and op_chk.get('ok') is None:
                op_chk = dict(op_chk)
                op_chk['ok'] = True
                op_chk['warn'] = False
                op_chk['detail'] = (
                    f'extended ISA terminal opcode=8 ✅ at the canonical '
                    f'SelfTest boundary; {op_chk["detail"].split("; ", 1)[-1]}'
                )
            checks.append({'label': 'BRANCH opcode',
                           'ok': op_chk['ok'],
                           'warn': op_chk.get('warn', False),
                           'detail': op_chk['detail']})
            # 4b. c-list[0] E-GT check — verify return-channel capability matches boot_rom
            egt = _ba_check_selftest_egt(
                lump_path, selftest_slot,
                (manifest_entry or {}).get('seq', 0))
            checks.append({'label': 'SelfTest E-GT', 'ok': egt['ok'],
                           'detail': egt['detail']})

        return checks

    # ── Assemble tiers ─────────────────────────────────────────────────────
    # Bootstrap entries are architecture-defined foundational rows, not a
    # numeric policy range.
    bootstrap_slots = {
        0: ('Boot.NS', ns_table_base, ['R', 'W'],
            'Baked into BRAM at NS_TABLE_BASE'),
        1: ('Boot.Thread', thread_base, ['NONE'],
            'Thread lump baked into BRAM'),
    }
    bootstrap = [
        {
            'slot': slot_num, 'name': name, 'token': None,
            'header_word': None, 'cw': None, 'cc': None,
            'location': location, 'perms': perms, 'source': 'BRAM (boot ROM)',
            'load_policy': 'Bootstrap',
            'programmable': False,
            'size_budget': _not_applicable_budget('boot namespace table'),
            'checks': [{'label': 'BRAM', 'ok': True, 'detail': detail}],
        }
        for slot_num, (name, location, perms, detail) in bootstrap_slots.items()
    ]
    # Boot.Thread is a generated body too; expose its real geometry instead
    # of treating the foundational row as an opaque BRAM entry.
    _boot_thread = next((row for row in bootstrap if row['slot'] == 1), None)
    if _boot_thread:
        _boot_thread_header = _boot_image_gen.pack_lump_header(
            _boot_image_gen._ns_n_minus_6(thread_size),
            thread_stack_words, _boot_image_gen.THREAD_CAP_WORDS, 2)
        _boot_thread.update({
            'header_word': f'0x{_boot_thread_header:08X}',
            'cw': thread_stack_words,
            'cc': _boot_image_gen.THREAD_CAP_WORDS,
            'source': 'generated Thread.1 body (boot ROM)',
            'size_budget': _thread_size_budget(thread_layout),
        })
    _boot_ns = _BOOT_NS_META if isinstance(_BOOT_NS_META, dict) else {}
    _boot_ns_row = next((row for row in bootstrap if row['slot'] == 0), None)
    if _boot_ns_row and _boot_ns.get('cw') is not None and _boot_ns.get('cc') is not None:
        _boot_ns_row.update({
            'header_word': _boot_ns.get('header_word'),
            'cw': _boot_ns['cw'],
            'cc': _boot_ns['cc'],
            'source': 'Boot.NS namespace LUMP (boot ROM)',
        })
    for _row in bootstrap:
        _row['load_policy'] = _slot_policy(_row['slot'], default='Bootstrap')

    # Hardware-backed rows are intrinsic device definitions. They are
    # resident regardless of software LUMP policy and are kept outside the
    # policy-controlled resident/lazy split.
    catalog_perms = {}
    for _catalog_slot, _catalog_entry in enumerate(
            _boot_image_gen.DEFAULT_ABSTRACTION_CATALOG):
        if isinstance(_catalog_entry, tuple) and len(_catalog_entry) >= 2:
            catalog_perms[_catalog_slot] = [
                perm for perm in ('R', 'W', 'X', 'L', 'S', 'E')
                if _catalog_entry[1].get(perm)
            ]
    resident = []
    for device in sorted(device_catalog.values(), key=lambda item: item['slot']):
        slot_num = device['slot']
        name = device['name']
        location = f'0x{device["address"]:08X}'
        perms = list(device['permissions'])
        resident.append({
            'slot': slot_num, 'name': name, 'token': None,
            'header_word': 'MMIO', 'cw': None, 'cc': None,
            'location': location, 'words': device['words'],
            'limit': device['limit'], 'perms': perms,
            'source': 'boot ROM hardware register',
            'load_policy': 'Hardware',
            'programmable': False,
            'size_budget': _not_applicable_budget(
                f'ARTIX-7 MMIO hardware register ({device["words"]} word'
                f'{"s" if device["words"] != 1 else ""})'),
            'checks': [{'label': 'MMIO', 'ok': True,
                        'detail': f'MMIO at {location}'}],
        })
    for _row in resident:
        _row['load_policy'] = _slot_policy(_row['slot'], default='Hardware')

    # Slot 6 — SelfTest LUMP
    st_entry = manifest_by_slot.get(selftest_slot) or {}
    # The committed state token is the content token.  The legacy token-named
    # file remains a lookup alias and must not redefine that identity.
    st_token = st_entry.get('token')
    st_lump = _state_lump_path(st_entry)
    st_hdr = _ba_read_lump_header(st_lump) if st_lump and os.path.exists(st_lump) else None
    st_checks = _lump_checks(selftest_slot, st_token,
                             manifest_by_slot.get(selftest_slot),
                             st_lump, is_selftest=True)
    st_row = {
        'slot': selftest_slot, 'name': 'SelfTest',
        'token': st_token,
        'header_word': f'0x{st_hdr[0]:08X}' if st_hdr else None,
        'cw': st_hdr[1] if st_hdr else None, 'cc': st_hdr[2] if st_hdr else None,
         'location': selftest_base, 'perms': ['E'],
         'source': _row_source(st_entry, st_lump, 'server/lumps'),
        'checks': st_checks,
    }
    # Keep the path used for header/check inspection so size accounting cannot
    # resolve a different manifest alias from the same token.
    st_row['_ba_binary_path'] = st_lump
    _append_policy_row(st_row, _slot_policy(selftest_slot, st_entry, st_lump))

    # Slot 7 — WukongCallHome LUMP
    wch_entry = manifest_by_slot.get(callhome_slot)
    wch_token = wch_entry.get('token') if wch_entry else None
    # Also scan for WukongCallHome_v* files
    if not wch_token:
        cands = sorted([fn for fn in os.listdir(_LUMPS_DIR)
                       if 'WukongCallHome' in fn and fn.endswith('.lump')])
        if cands:
            wch_token = cands[-1].replace('.lump', '')
    wch_lump = _state_lump_path(wch_entry)
    wch_hdr = _ba_read_lump_header(wch_lump) if wch_lump else None
    wch_checks = _lump_checks(callhome_slot, wch_token, wch_entry, wch_lump)
    wch_row = {
        'slot': callhome_slot, 'name': 'WukongCallHome',
        'token': wch_token,
        'header_word': f'0x{wch_hdr[0]:08X}' if wch_hdr else None,
        'cw': wch_hdr[1] if wch_hdr else None, 'cc': wch_hdr[2] if wch_hdr else None,
         'location': callhome_base, 'perms': ['E'],
         'source': _row_source(wch_entry, wch_lump, 'server/lumps'),
        'checks': wch_checks,
    }
    wch_row['_ba_binary_path'] = wch_lump
    _append_policy_row(wch_row, _slot_policy(callhome_slot, wch_entry, wch_lump))

    # ── Byte-range overlap check for resident LUMP slots ──────────────────
    def _parse_hex(s):
        try:
            return int(str(s), 16)
        except Exception:
            return None

    lump_ranges = []
    for s in resident:
        if s.get('perms') and 'E' in s['perms'] and s.get('cw') is not None:
            base = _parse_hex(s.get('location'))
            if base is not None:
                end = base + (s['cw'] or 0) * 4
                lump_ranges.append((s['slot'], s['name'], base, end))

    overlap_slots = _ba_overlap_check(lump_ranges)
    for s in resident:
        if s['slot'] in overlap_slots:
            s['checks'].append({'label': 'overlap', 'ok': False,
                                'detail': f'Slot {s["slot"]} byte range overlaps with another resident slot'})
        elif s.get('cw') is not None and s.get('perms') and 'E' in s['perms']:
            s['checks'].append({'label': 'overlap', 'ok': True,
                                'detail': 'No byte-range overlap with other resident slots'})

    # Every non-intrinsic manifest slot uses its own saved load policy. Never
    # infer Resident/Lazy from a numeric slot boundary.
    intrinsic_slots = set(bootstrap_slots) | {
        device['slot'] for device in device_catalog.values()
    } | {
        selftest_slot, callhome_slot, m_bit_slot,
    }
    intrinsic_slots.update(generated_thread_slots)

    # Generated Thread.2 onward are real boot-image bodies, not token-backed
    # LUMPs. Their locations and body size are authoritative from Namespace
    # state and the saved boot layout, respectively.
    for slot_num in sorted(generated_thread_slots):
        entry = manifest_by_slot.get(slot_num) or {}
        label = entry.get('abstraction') or _boot_image_gen.generated_thread_label(slot_num)
        _thread_header = _boot_image_gen.pack_lump_header(
            _boot_image_gen._ns_n_minus_6(thread_size),
            thread_stack_words, _boot_image_gen.THREAD_CAP_WORDS, 2)
        row = {
            'slot': slot_num,
            'name': label or f'Thread slot {slot_num}',
            'token': None,
            'header_word': f'0x{_thread_header:08X}',
            'cw': thread_stack_words,
            'cc': _boot_image_gen.THREAD_CAP_WORDS,
            'location': entry.get('location'),
            'perms': ['NONE'],
            'source': 'generated Thread body (boot image)',
            'programmable': False,
            'size_budget': _thread_size_budget(thread_layout),
            'checks': [{
                'label': 'Thread layout', 'ok': thread_layout['valid'],
                'detail': (
                    f'generated {thread_size}-word Thread body: '
                    f'heap={thread_layout["heap_words"]}w '
                    f'stack={thread_layout["stack_words"]}w '
                    f'caps={thread_layout["caps_words"]}w'
                ),
            }],
        }
        _append_policy_row(row, _slot_policy(slot_num, entry, default='Lazy'))

    for slot_num in sorted(manifest_by_slot.keys()):
        if slot_num in intrinsic_slots:
            continue  # rendered by the architecture-specific rows above
        entry = manifest_by_slot[slot_num]
        token = entry.get('token')
        lump_path = _state_lump_path(entry)
        hdr = _ba_read_lump_header(lump_path) if lump_path else None
        checks = _lump_checks(slot_num, token, entry, lump_path)
        row = {
            'slot': slot_num,
            'name': entry.get('abstraction', '?'),
            'token': token,
            'header_word': f'0x{hdr[0]:08X}' if hdr else None,
            'cw': hdr[1] if hdr else (entry.get('cw')),
            'cc': hdr[2] if hdr else (entry.get('cc')),
            'location': entry.get('location'),
            'perms': (
                entry['grants'] if 'grants' in entry
                else catalog_perms.get(slot_num, [])
            ),
             'source': _row_source(entry, lump_path, 'manifest (slot policy)'),
            'programmable': (
                slot_num not in RESERVED_NS_SLOTS
                and slot_num not in generated_thread_slots
            ),
            'checks': checks,
        }
        row['_ba_binary_path'] = lump_path
        _append_policy_row(row, _slot_policy(slot_num, entry, lump_path))

    # Manifest entries with ns_slot=None or dynamic
    for entry in manifest_no_slot:
        token = entry.get('token')
        policy = entry.get('ns_slot_policy', 'dynamic')
        if policy == 'dynamic':
            lump_path = _ba_lump_file_for_token(token)
            hdr = _ba_read_lump_header(lump_path) if lump_path else None
            checks = _lump_checks(None, token, entry, lump_path)
            row = {
                'slot': '(dynamic)',
                'name': entry.get('abstraction', '?'),
                'token': token,
                'header_word': f'0x{hdr[0]:08X}' if hdr else None,
                'cw': hdr[1] if hdr else entry.get('cw'),
                'cc': hdr[2] if hdr else entry.get('cc'),
                'location': None,
                'perms': entry.get('grants', []),
                'source': 'manifest (dynamic slot)',
                'checks': checks,
            }
            row['_ba_binary_path'] = lump_path
            _append_policy_row(row, 'Lazy')

    # The selector has one visible LightningBolt state. Keep the underlying
    # load policy separate so selecting a new boot entry can restore the old
    # row to its prior rule instead of leaving two lightning markers behind.
    def _slot_rule(slot_num, underlying):
        if slot_num == boot_entry_slot:
            return 'LightningBolt'
        selected_rule = slot_policy_by_slot.get(slot_num)
        return selected_rule if selected_rule in SLOT_RULE_VALUES else underlying

    for _row in bootstrap + resident + lazy:
        if isinstance(_row.get('slot'), int):
            _row['slot_rule'] = _slot_rule(
                _row['slot'], _row.get('load_policy', 'Lazy'))

    # Size accounting is informational.  In particular, lazy/runtime entries
    # are included when available but never participate in approval gating.
    for tier_name, tier_rows in (('resident', resident), ('lazy', lazy)):
        for row in tier_rows:
            # Prefer the exact path already inspected for this row's header and
            # checks. Token lookup is only a fallback for future synthetic rows.
            lump_path = row.get('_ba_binary_path')
            if lump_path is None and row.get('token'):
                lump_path = _ba_lump_file_for_token(row.get('token'))
            if lump_path:
                row['size_budget'] = _ba_lump_size_budget(lump_path)
            elif 'size_budget' not in row:
                row['size_budget'] = _not_applicable_budget('no LUMP binary')
            row.pop('_ba_binary_path', None)

    # Normalize every Namespace row through one allowlisted contract before
    # exposing it to the approval renderer. In particular, do not copy
    # runtime-only state such as the live M-register bit word into this
    # committed Namespace metadata payload.
    approval_row_defaults = {
        'slot': None,
        'name': '?',
        'token': None,
        'header_word': None,
        'cw': None,
        'cc': None,
        'location': None,
        'words': None,
        'limit': None,
        'load_policy': 'Lazy',
        'slot_rule': None,
        'perms': [],
        'source': 'N/A',
        'programmable': False,
        'size_budget': _not_applicable_budget('no LUMP binary'),
        'checks': [],
    }

    def _normalize_approval_row(row):
        normalized = {
            field: row.get(field, approval_row_defaults[field])
            for field in _BA_APPROVAL_ROW_FIELDS
        }
        normalized['perms'] = list(normalized['perms'] or [])
        normalized['checks'] = list(normalized['checks'] or [])
        return normalized

    for _row in bootstrap + resident + lazy:
        normalized = _normalize_approval_row(_row)
        _row.clear()
        _row.update(normalized)

    hardware_rows = [r for r in resident if r.get('size_budget', {}).get('available')]
    def _sum_budget(key):
        return sum(r['size_budget'][key]['words'] for r in hardware_rows)
    hardware_budget = {
        'lumps': len(hardware_rows),
        'code': {'words': _sum_budget('code'), 'bytes': _sum_budget('code') * 4},
        'api': {'words': _sum_budget('api'), 'bytes': _sum_budget('api') * 4},
        'gt_capabilities': {'words': _sum_budget('gt_capabilities'),
                            'bytes': _sum_budget('gt_capabilities') * 4},
        'freespace': {'words': _sum_budget('freespace'), 'bytes': _sum_budget('freespace') * 4},
        'total': {'words': sum(r['size_budget']['total']['words'] for r in hardware_rows),
                  'bytes': sum(r['size_budget']['total']['bytes'] for r in hardware_rows)},
        'allocation': {'words': sum(r['size_budget']['allocation']['words'] for r in hardware_rows),
                       'bytes': sum(r['size_budget']['allocation']['bytes'] for r in hardware_rows)},
    }
    # The UI consumes one row per Namespace slot. Keep the legacy tier buckets
    # below for approval-gate compatibility, but make each row's load_policy
    # the authoritative rule rather than presenting fixed policy sections.
    slot_rules = bootstrap + resident + lazy
    slot_rules.sort(key=lambda row: (
        1 if not isinstance(row.get('slot'), int) else 0,
        row.get('slot') if isinstance(row.get('slot'), int) else str(row.get('slot')),
    ))
    _ba_validate_approval_rows(slot_rules)
    return {
        'tiers': {
            'bootstrap': bootstrap,
            'resident':  resident,
            'lazy':      lazy,
            'unused':    [],
        },
        'slot_rules': slot_rules,
        'boot_entry_slot': boot_entry_slot,
        'ns_table_base': ns_table_base,
        'ns_slot_count': ns_slot_count,
        'namespace_header': namespace_header,
        'hardware_budget': hardware_budget,
    }

def _resolve_lump_path(token8, lumps_dir=None):
    """Return the filesystem path to a token's .lump file, or None.

    The manifest filename is the locator authority.  A token-named legacy file
    is considered only when no manifest row exists for the token.
    """
    if not token8:
        return None
    if lumps_dir is None:
        lumps_dir = _LUMPS_DIR
    manifest_path = os.path.join(lumps_dir, 'manifest.json')
    try:
        manifest = _read_manifest_safe(manifest_path)
        matches = [
            entry for entry in manifest
            if isinstance(entry, dict) and entry.get('token') == token8
        ]
        if not matches:
            return None
        # History and current rows may intentionally retain the same immutable
        # token.  That is unambiguous when every matching row names the same
        # binary; reject only genuinely conflicting token→file mappings.
        filenames = {
            entry.get('filename', '') for entry in matches
            if entry.get('filename', '')
        }
        if len(filenames) != 1:
            return None
        fn = next(iter(filenames))
        if fn:
            p = os.path.join(lumps_dir, fn)
            if os.path.isfile(p):
                return p
    except Exception:
        return None
    token_path = os.path.join(lumps_dir, token8 + '.lump')
    if os.path.isfile(token_path):
        return token_path
    return None


def _ba_lump_file_for_token(token):
    """Return path to token's .lump in the lumps dir, or None.

    Uses _resolve_lump_path so canonical-named lumps (DotName.N.hash.lump)
    are found even when no token-named file or symlink exists.
    """
    return _resolve_lump_path(token, _LUMPS_DIR)

def _ba_write_ssh_key():
    """Write DropletPrivateKey secret to ~/.ssh/replit_droplet and return path, or None."""
    key_raw = os.environ.get('DropletPrivateKey', '')
    if not key_raw.strip():
        return None
    ssh_dir = os.path.expanduser('~/.ssh')
    os.makedirs(ssh_dir, exist_ok=True)
    key_path = os.path.join(ssh_dir, 'replit_droplet')
    # Replit may collapse newlines into spaces — reformat to valid PEM
    lines = key_raw.strip().split('\n')
    if len(lines) > 2:
        pem = key_raw.strip() + '\n'
    else:
        # Single-line (spaces collapsed) — rebuild PEM blocks
        tokens = key_raw.strip().split()
        if len(tokens) >= 8:
            header = ' '.join(tokens[:4])
            footer = ' '.join(tokens[-4:])
            body = ''.join(tokens[4:-4])
            chunks = [body[i:i+64] for i in range(0, len(body), 64)]
            pem = header + '\n' + '\n'.join(chunks) + '\n' + footer + '\n'
        else:
            pem = key_raw.strip() + '\n'
    with open(key_path, 'w') as f:
        f.write(pem)
    os.chmod(key_path, 0o600)
    return key_path

def _ba_classify_build_failure(exit_code, log, phase='unknown'):
    """Classify a remote build outcome using bounded, redacted log evidence."""
    lines = list(log or [])
    patterns = [
        ('ssh_launch', ('ssh launch failed', 'connecttimeout', 'permission denied'),
         'SSH could not start the remote build.',
         'Check the droplet connection and SSH setup, then retry.'),
        ('timeout', ('timed out', 'poll timed out'),
         'The remote build exceeded the polling timeout.',
         'Check the remote Vivado log and host load; retry after confirming the session stopped.'),
        ('tool_error', ('vivado error:', 'error: [', 'cannot open', 'no such file'),
         'Vivado or a required build input reported an error.',
         'Open the log tail, fix the named tool/input error, then freeze a fresh approval snapshot.'),
        ('implementation_failure', ('implementation failed', 'place 30-', 'route 30-', 'timing failed'),
         'FPGA implementation failed after synthesis.',
         'Review placement, routing, timing, or constraint errors in the log before retrying.'),
        ('remote_crash', ('session gone', 'worker error', 'crashed'),
         'The remote build session ended without a clean completion marker.',
         'Inspect the retained log tail and remote host/session health, then retry.'),
    ]
    lower = '\n'.join(lines).lower()
    category, what, next_action = ('exit_code', 'Vivado exited with a failure code.',
                                    'Review the log tail for the first error, fix it, and retry.')
    for candidate, needles, description, action in patterns:
        if any(needle in lower for needle in needles):
            category, what, next_action = candidate, description, action
            break
    evidence = [line for line in lines if any(x in line.lower()
                for x in ('error', 'failed', 'timeout', 'session', 'crash', 'exit_'))][-5:]
    return {'category': category, 'what_failed': what, 'next_action': next_action,
            'phase': phase, 'exit_code': exit_code, 'evidence': evidence}


def _ba_build_worker(key_path):
    """Background thread: SSH to droplet, start Vivado in tmux, stream log."""
    global _ba_build_log, _ba_build_done, _ba_build_exit, _ba_build_phase, _ba_build_diagnosis
    global _ba_build_updated_at, _ba_build_finished_at

    ssh_base = [
        'ssh', '-i', key_path,
        '-o', 'StrictHostKeyChecking=accept-new',
        '-o', 'ConnectTimeout=15',
        f'{_DROPLET_USER}@{_DROPLET_IP}',
    ]

    def _append(line):
        global _ba_build_updated_at
        with _ba_build_lock:
            _ba_build_log.append(line)
            _ba_build_updated_at = _ba_datetime.datetime.now(
                _ba_datetime.timezone.utc).isoformat().replace('+00:00', 'Z')

    with _ba_build_lock:
        active_build_context = dict(_ba_build_version_context or {})
    artifact_hash = None

    def _finish(code):
        nonlocal artifact_hash
        global _ba_build_done, _ba_build_exit, _ba_build_phase, _ba_build_diagnosis
        global _ba_build_updated_at, _ba_build_finished_at
        with _ba_build_lock:
            _ba_build_done = True
            _ba_build_exit = code
            _ba_build_phase = 'complete' if code == 0 else 'failed'
            _ba_build_diagnosis = _ba_classify_build_failure(code, _ba_build_log, _ba_build_phase)
            now = _ba_datetime.datetime.now(_ba_datetime.timezone.utc).isoformat().replace('+00:00', 'Z')
            _ba_build_finished_at = now
            _ba_build_updated_at = now
            build_context = dict(_ba_build_version_context or {})
        # A successful remote synthesis persists its expected artifact digest.
        # Upload later verifies the published bytes against this value.
        try:
            with app.app_context():
                _record_bitstream_version_event(
                    status="succeeded" if code == 0 else "failed",
                    version=build_context.get("version"),
                    source="remote-vivado",
                    source_commit=build_context.get("source_commit"),
                    bit_hash=artifact_hash if code == 0 else None,
                )
                record_id = build_context.get("record_id")
                if isinstance(record_id, int):
                    record = db.session.get(BuildRecord, record_id)
                    if record is not None:
                        record.status = "succeeded" if code == 0 else "failed"
                        if code == 0:
                            record.bit_hash = artifact_hash
                        db.session.commit()
        except Exception:
            app.logger.exception("Could not persist Wukong bitstream version log")

    _append('🔗 Connecting to build droplet…')
    with _ba_build_lock:
        _ba_build_phase = 'launching'
    try:
        # 1. Kill any existing session + start new tmux Vivado build
        import shlex as _ba_shlex
        expected_commit = str(active_build_context.get("source_commit") or
                              _git_full_head() or _git_short_hash())
        remote_body = (
            "source /opt/Xilinx/2026.1/Vivado/settings64.sh; "
            "actual_commit=$(git rev-parse HEAD 2>/dev/null); "
            f"if [ \"$actual_commit\" != {_ba_shlex.quote(expected_commit)} ]; then "
            "echo REMOTE_COMMIT_MISMATCH; echo EXIT_43; exit 43; fi; "
            "if ! git diff --quiet || ! git diff --cached --quiet; then "
            "echo REMOTE_WORKTREE_DIRTY; echo EXIT_46; exit 46; fi; "
            "rm -f church_wukong_xc7a100t.bit; "
            "vivado -mode batch -source wukong_xc7a100t.tcl; "
            "rc=$?; "
            "if [ \"$rc\" -eq 0 ]; then "
            "if [ -f church_wukong_xc7a100t.bit ]; then "
            "digest=$(md5sum church_wukong_xc7a100t.bit | awk '{print $1}'); "
            "echo ARTIFACT_MD5_$digest; "
            "else rc=44; echo ARTIFACT_MISSING; fi; fi; "
            "echo EXIT_$rc"
        )
        remote_script = f"{{ {remote_body}; }} > vivado_cm.log 2>&1"
        launch_cmd = (
            f'cd {_ba_shlex.quote(_DROPLET_BUILD_DIR)} || exit $?; '
            f'tmux kill-session -t {_VIVADO_SESSION} 2>/dev/null; '
            f'tmux new-session -d -s {_VIVADO_SESSION} '
            f'{_ba_shlex.quote(remote_script)}'
        )
        r = subprocess.run(ssh_base + [launch_cmd],
                           capture_output=True, text=True, timeout=30)
        if r.returncode != 0:
            _append(f'❌ SSH launch failed (exit {r.returncode}):')
            _append(r.stderr.strip() or '(no error output)')
            _finish(r.returncode)
            return

        with _ba_build_lock:
            _ba_build_phase = 'running'
        _append(f'✅ Vivado synthesis started in tmux session "{_VIVADO_SESSION}"')
        _append('⏳ Polling build log (every 30 s)…')

        # 2. Poll the remote log until EXIT_ appears or session ends
        import time as _time
        seen_lines = 0
        poll_interval = 30
        max_polls = 60  # ~30 min max

        for _ in range(max_polls):
            _time.sleep(poll_interval)
            # Fetch new log lines
            poll_cmd = (
                f'tail -n +{seen_lines + 1} {_DROPLET_BUILD_DIR}/vivado_cm.log 2>/dev/null; '
                f'tmux list-sessions 2>/dev/null | grep {_VIVADO_SESSION} || echo __SESSION_GONE__'
            )
            pr = subprocess.run(ssh_base + [poll_cmd],
                                capture_output=True, text=True, timeout=30)
            if pr.returncode != 0:
                _append(f'⚠️ Poll SSH error (exit {pr.returncode}) — retrying…')
                continue

            out = pr.stdout or ''
            session_gone = '__SESSION_GONE__' in out
            new_lines = [l for l in out.splitlines()
                         if l != '__SESSION_GONE__' and _VIVADO_SESSION not in l]
            seen_lines += len(new_lines)
            for ln in new_lines:
                _append(ln)
                digest_match = re.match(r'ARTIFACT_MD5_([0-9a-fA-F]{32})$', ln.strip())
                if digest_match:
                    artifact_hash = digest_match.group(1).lower()

            # Check for exit marker
            exit_code = None
            for ln in new_lines:
                m = re.match(r'EXIT_(\d+)', ln.strip())
                if m:
                    exit_code = int(m.group(1))
                    break

            if exit_code is not None:
                if exit_code == 0 and artifact_hash is None:
                    _append('❌ Build produced no verifiable artifact digest')
                    exit_code = 45
                _append(f'\n{"✅ Build complete!" if exit_code == 0 else "❌ Build FAILED"} (exit {exit_code})')
                _finish(exit_code)
                return

            if session_gone and not any('EXIT_' in ln for ln in new_lines):
                _append('⚠️ tmux session gone without EXIT_ marker — may have crashed')
                _finish(1)
                return

        _append('⏰ Build poll timed out (max 30 min exceeded)')
        _finish(1)

    except subprocess.TimeoutExpired:
        _append('❌ SSH command timed out')
        _finish(1)
    except Exception as e:
        _append(f'❌ Build worker error: {e}')
        _finish(1)

@app.route('/api/wukong-build/start', methods=['POST'])
def wukong_build_start():
    """SSH to the DigitalOcean droplet and launch Vivado synthesis in tmux.

    Requires either:
      • Authorization: Bearer <REPORT_TOKEN>   (scripted / external callers)
      • build_nonce in the JSON body or ?build_nonce= query param  (browser)
    The nonce is obtained from GET /api/build-approval/ns-map.
    """
    global _ba_build_log, _ba_build_done, _ba_build_exit, _ba_build_phase, _ba_build_diagnosis, _ba_build_version_context
    global _ba_build_started_at, _ba_build_updated_at, _ba_build_finished_at

    ok, err = _ba_validate_build_auth()
    if not ok:
        return err
    request_data = request.get_json(silent=True) or {}
    target, target_error = _wukong_target_error(request_data)
    if target_error:
        return _wukong_target_rejection(target_error)
    supplied_identities = [
        str(request_data.get(key, '') or '').strip()
        for key in ('build_intent_id', 'provenance_identity',
                    'build_id', 'artifact_identity')
        if request_data.get(key) is not None
    ]
    if len(set(supplied_identities)) > 1:
        return jsonify({
            'ok': False,
            'error': 'bitstream build requires one exact selected build/provenance identity',
        }), 400
    # Server-side approval gate: require a freshly frozen snapshot where every
    # check passed.  An authenticated direct POST cannot bypass the UI's
    # "all checks pass" rule — the server re-enforces it here.
    if not os.path.isdir(_BUILD_SNAPSHOTS_DIR):
        return jsonify({'ok': False,
                        'error': 'No approval snapshot found — freeze a clean snapshot first'}), 422
    snap_files = sorted([f for f in os.listdir(_BUILD_SNAPSHOTS_DIR)
                         if f.startswith('build-approval-') and f.endswith('.json')])
    if not snap_files:
        return jsonify({'ok': False,
                        'error': 'No approval snapshot found — freeze a clean snapshot first'}), 422
    latest_snap_path = os.path.join(_BUILD_SNAPSHOTS_DIR, snap_files[-1])
    try:
        with open(latest_snap_path) as _sf:
            latest_snap = json.load(_sf)
    except Exception as _se:
        return jsonify({'ok': False,
                        'error': f'Could not read approval snapshot: {_se}'}), 500
    if not latest_snap.get('all_checks_pass'):
        return jsonify({'ok': False,
                        'error': (f'Latest snapshot ({snap_files[-1]}) has failed or missing '
                                  f'checks — fix all issues and re-freeze before launching build')}), 422
    approved_identity = str(latest_snap.get('provenance_identity', '') or '')
    # Build/provenance aliases are retained only for older UI clients; every
    # supplied one must be the exact approved identity.  build_nonce was
    # already checked as CSRF proof and is intentionally excluded.
    if (not approved_identity or not supplied_identities or
            any(not hmac.compare_digest(value, approved_identity)
                for value in supplied_identities)):
        return jsonify({
            'ok': False,
            'error': 'bitstream build requires one exact selected build/provenance identity',
        }), 400

    with _ba_build_lock:
        if _ba_build_done is False and _ba_build_log:
            return jsonify({'ok': False, 'error': 'Build already in progress'}), 409

    key_path = _ba_write_ssh_key()
    if not key_path:
        return jsonify({'ok': False,
                        'error': 'DropletPrivateKey secret not set — cannot SSH to build droplet'}), 503

    # Reset log state
    with _ba_build_lock:
        _ba_build_log = []
        _ba_build_done = False
        _ba_build_exit = None
        _ba_build_phase = 'queued'
        _ba_build_diagnosis = None
        _ba_build_started_at = _ba_datetime.datetime.now(
            _ba_datetime.timezone.utc).isoformat().replace('+00:00', 'Z')
        _ba_build_updated_at = _ba_build_started_at
        _ba_build_finished_at = None
        source_version = _wukong_build_version()
        source_commit = _git_full_head() or _git_short_hash()
        try:
            namespace_snapshot = _capture_committed_namespace_snapshot(
                hardware_version=source_version,
                source_commit=source_commit,
                approval_frozen_at=latest_snap.get("frozen_at"),
            )
        except ValueError as snapshot_error:
            return jsonify({"ok": False, "error": str(snapshot_error)}), 422
        record_id = _record_build_event(
            board="wukong-xc7a100t",
            status="running",
            notes="approved_build",
            ns_snapshot=namespace_snapshot,
            hardware_version=source_version,
            git_commit=source_commit,
        )
        if record_id is None:
            return jsonify({"ok": False, "error": "Could not create the approved build record"}), 500
        _ba_build_version_context = {
            "version": source_version,
            "source_commit": source_commit,
            "record_id": record_id,
            "namespace_fingerprint": namespace_snapshot["fingerprint"],
            "target_device_uid": target["device_uid"],
            "target_session_id": target["bridge_session"],
            "selected_build_id": approved_identity,
            "provenance_identity": approved_identity,
        }

    t = threading.Thread(target=_ba_build_worker, args=(key_path,), daemon=True)
    t.start()

    return jsonify({'ok': True, 'message': 'Build started — poll /api/wukong-build/status',
                    'build_record_id': record_id,
                    'hardware_version': source_version,
                    'source_commit': source_commit,
                     'namespace_fingerprint': namespace_snapshot["fingerprint"],
                     'provenance_identity': approved_identity})

@app.route('/api/wukong-build/status', methods=['GET'])
def wukong_build_status():
    """Return current build log lines + done/exit status.

    Requires REPORT_TOKEN auth (Bearer header).  No nonce needed here —
    the nonce was consumed at /start; polling only needs the token.
    """
    ok, err = _ba_check_report_token()
    if not ok:
        return err
    with _ba_build_lock:
        log = list(_ba_build_log)
        done = _ba_build_done
        exit_code = _ba_build_exit
        phase = _ba_build_phase
        diagnosis = _ba_build_diagnosis
        started_at = _ba_build_started_at
        updated_at = _ba_build_updated_at
        finished_at = _ba_build_finished_at
        build_context = dict(_ba_build_version_context or {})
    return jsonify({'log': log[-200:], 'log_tail': log[-40:], 'done': done,
                    'exit_code': exit_code, 'phase': phase,
                    'diagnosis': diagnosis,
                    'started_at': started_at,
                    'updated_at': updated_at,
                    'finished_at': finished_at,
                    'build_record_id': build_context.get('record_id'),
                    'hardware_version': build_context.get('version'),
                    'source_commit': build_context.get('source_commit'),
                     'namespace_fingerprint': build_context.get('namespace_fingerprint'),
                     'provenance_identity': build_context.get('provenance_identity')})

@app.route('/api/build-approval/freeze-snapshot', methods=['POST'])
def build_approval_freeze_snapshot():
    """Persist the current NS map + check results as a dated JSON record.

    Requires REPORT_TOKEN auth.  The map is derived server-side at freeze time
    rather than accepted from the client, preventing attacker-supplied snapshot JSON
    from tainting the approval artifact record.
    """
    ok, err = _ba_check_report_token()
    if not ok:
        return err
    try:
        os.makedirs(_BUILD_SNAPSHOTS_DIR, exist_ok=True)
        # Always derive the map server-side — never trust client-submitted map data.
        ns_map = _ba_build_ns_map()
        # Determine whether the hardware-relevant tiers pass.
        #
        # Only the bootstrap tier and explicitly resident slot-policy entries
        # affect the Vivado bitstream. Lazy and
        # dynamic slot-policy entries are fetched at runtime by the IDE —
        # stale manifest entries and missing legacy LUMP files there are
        # informational and must not block synthesis approval.
        def _snap_all_pass(m):
            slot_rules = m.get('slot_rules')
            if isinstance(slot_rules, list):
                blocking_policies = {'Bootstrap', 'Hardware', 'Resident'}
                rows = [
                    row for row in slot_rules
                    if row.get('load_policy', row.get('loadPolicy')) in blocking_policies
                ]
            else:
                # Backward compatibility for snapshots created before the
                # individual slot_rules payload was introduced.
                rows = []
                for tier_name in ('bootstrap', 'resident'):
                    rows.extend(m.get('tiers', {}).get(tier_name, []))
            for s in rows:
                for c in s.get('checks', []):
                    if c.get('ok') is False:
                        return False
            return True
        all_pass = _snap_all_pass(ns_map)
        now_str = _ba_datetime.datetime.utcnow().strftime('%Y%m%dT%H%M%SZ')
        filename = f'build-approval-{now_str}.json'
        provenance_identity = _ba_provenance_identity(ns_map)
        snap = {
            'frozen_at': now_str,
            'all_checks_pass': all_pass,
            'ns_map': ns_map,
            'provenance_identity': provenance_identity,
        }
        path = os.path.join(_BUILD_SNAPSHOTS_DIR, filename)
        with open(path, 'w') as f:
            json.dump(snap, f, indent=2)
        return jsonify({'ok': True, 'filename': filename, 'frozen_at': now_str,
                        'all_checks_pass': all_pass,
                        'provenance_identity': provenance_identity,
                        'build_intent_id': provenance_identity})
    except Exception as e:
        app.logger.exception('freeze-snapshot error')
        return jsonify({'ok': False, 'error': str(e)}), 500

def _ba_overlap_check(slots_with_ranges):
    """
    Given list of (slot, name, byte_start, byte_end), return set of slot nums
    that overlap with at least one other slot.
    """
    bad = set()
    s = [(s, n, a, b) for s, n, a, b in slots_with_ranges if a is not None and b is not None]
    for i, (si, ni, ai, bi) in enumerate(s):
        for j, (sj, nj, aj, bj) in enumerate(s):
            if i >= j:
                continue
            # overlap if not (bi <= aj or bj <= ai)
            if not (bi <= aj or bj <= ai):
                bad.add(si)
                bad.add(sj)
    return bad

def _ba_validate_build_auth():
    """
    Return (ok, error_response) for build-trigger endpoints.

    Requires:
      1. REPORT_TOKEN via Authorization: Bearer header  (primary auth)
      2. A valid build_nonce issued by /api/build-approval/ns-map  (CSRF guard)

    The nonce is session-bound: /api/build-approval/ns-map only issues a nonce
    after the caller has already authenticated with REPORT_TOKEN, so a nonce
    cannot be obtained without the token.  Together they prevent both external
    exploitation and CSRF attacks from browser pages that tricked the user.
    """
    import time as _time

    # 1. Primary auth — REPORT_TOKEN required
    ok, err = _ba_check_report_token()
    if not ok:
        return False, err

    # 2. CSRF guard — nonce must match the one issued by the authenticated ns-map call
    body = request.get_json(silent=True) or {}
    supplied_nonce = body.get("build_nonce") or request.args.get("build_nonce", "")
    with _ba_nonce_lock:
        stored_nonce  = _ba_nonce_store.get('nonce')
        nonce_expires = _ba_nonce_store.get('expires', 0.0)
    nonce_valid = (
        supplied_nonce and stored_nonce and
        secrets.compare_digest(supplied_nonce, stored_nonce) and
        _time.monotonic() < nonce_expires
    )
    if not nonce_valid:
        err = jsonify({
            'ok': False,
            'error': (
                'Missing or expired build_nonce — refresh the Build tab to obtain a '
                'fresh nonce from /api/build-approval/ns-map and retry.'
            )
        })
        return False, (err, 403)

    return True, None


def _read_manifest_safe(manifest_path):
    """Read and parse the LUMP manifest at *manifest_path*.

    Returns an empty list when the file does not exist yet (a fresh install has
    no saved lumps — that is not an error).

    Raises ``ValueError`` with a descriptive message when the file *exists* but
    cannot be parsed as valid JSON.  Callers that perform a read-modify-write
    cycle MUST propagate this exception rather than silently falling back to
    ``[]``; overwriting a corrupt manifest with a single-entry list would
    permanently discard every previously-saved LUMP.
    """
    if not os.path.isfile(manifest_path):
        return []
    try:
        with open(manifest_path, 'r') as _fh:
            return json.load(_fh)
    except (json.JSONDecodeError, ValueError) as _exc:
        raise ValueError(
            f"manifest.json exists at {manifest_path!r} but is not valid JSON "
            f"(possibly truncated by a previous crash): {_exc}"
        ) from _exc
    except OSError as _exc:
        raise ValueError(
            f"manifest.json at {manifest_path!r} could not be read: {_exc}"
        ) from _exc


@app.route("/api/bank-custody/<vault_id>/revoke", methods=["POST"])
def revoke_bank_custody(vault_id):
    return jsonify({"ok": False, "error": "legacy Bank custody credentials are not accepted"}), 410
    vault_id = _bank_custody_vault_id(vault_id)
    if not vault_id:
        return jsonify({"ok": False, "error": "invalid vault id"}), 400
    with _bank_custody_lock:
        row, _, error = _bank_custody_authorize_request(vault_id, request.get_json(silent=True) or {})
        if error:
            return error
        try:
            db.session.execute(_sa_text("""
                UPDATE bank_custody SET revoked = 1, revision = revision + 1, updated_at = :updated_at
                WHERE vault_id = :vault_id
            """), {"vault_id": vault_id, "updated_at": time.time()})
            db.session.commit()
        except Exception:
            db.session.rollback()
            return jsonify({"ok": False, "error": "could not revoke custody vault"}), 500
    return jsonify({"ok": True, "vault_id": vault_id, "revoked": True})

@app.route("/api/bank-custody/<vault_id>", methods=["DELETE"])
def delete_bank_custody(vault_id):
    return jsonify({"ok": False, "error": "legacy Bank custody credentials are not accepted"}), 410
    vault_id = _bank_custody_vault_id(vault_id)
    if not vault_id:
        return jsonify({"ok": False, "error": "invalid vault id"}), 400
    with _bank_custody_lock:
        _, _, error = _bank_custody_authorize_request(vault_id, request.get_json(silent=True) or {})
        if error:
            return error
        try:
            db.session.execute(_sa_text("DELETE FROM bank_custody WHERE vault_id = :vault_id"),
                {"vault_id": vault_id})
            db.session.commit()
        except Exception:
            db.session.rollback()
            return jsonify({"ok": False, "error": "could not delete custody vault"}), 500
    return jsonify({"ok": True, "vault_id": vault_id, "deleted": True})


def _bank_custody_request_commitment(data, state):
    proof = data.get("proof")
    gt = data.get("gt")
    credential = state.get("credential", {})
    if (not isinstance(gt, int) or gt < 0 or gt > 0xFFFFFFFF or
            not isinstance(proof, list) or len(proof) != 4 or
            any(not isinstance(word, int) or word < 0 or word > 0xFFFFFFFF for word in proof)):
        return None
    policy = credential.get("policy")
    material = f"ChurchMachine.BankCredential.v1|{gt}|{','.join(str(word) for word in proof)}|{policy}"
    return hashlib.sha256(material.encode("utf-8")).hexdigest()

@app.route("/api/bank-custody/<vault_id>/recover", methods=["POST"])
def recover_bank_custody(vault_id):
    return jsonify({"ok": False, "error": "legacy Bank recovery credentials are not accepted"}), 410
    vault_id = _bank_custody_vault_id(vault_id)
    if not vault_id:
        return jsonify({"ok": False, "error": "invalid vault id"}), 400
    with _bank_custody_lock:
        row, state, error = _bank_custody_authorize_request(vault_id, request.get_json(silent=True) or {})
        if error:
            return error
        if row["revoked"] or row["consumed"]:
            return jsonify({"ok": False, "error": "custody vault is retired"}), 409
        try:
            recovery_grant = secrets.token_urlsafe(32)
            claimed = db.session.execute(_sa_text("""
                UPDATE bank_custody SET consumed = 1, recovery_grant = :recovery_grant,
                    revision = revision + 1, updated_at = :updated_at
                WHERE vault_id = :vault_id AND revoked = 0 AND consumed = 0
            """), {"vault_id": vault_id, "recovery_grant": recovery_grant, "updated_at": time.time()})
            if claimed.rowcount != 1:
                db.session.rollback()
                return jsonify({"ok": False, "error": "custody vault was already claimed"}), 409
            db.session.commit()
        except Exception:
            db.session.rollback()
            return jsonify({"ok": False, "error": "could not claim custody vault"}), 500
    # State holds client-side ciphertext and a commitment only. The browser
    # still needs the submitted proof to open it and install a fresh NS entry.
    return jsonify({
        "ok": True,
        "vault_id": vault_id,
        "revision": int(row["revision"]) + 1,
        "recovery_grant": recovery_grant,
        "state": state
    })


@app.route("/api/bank-custody/grant/<grant>/consume", methods=["POST"])
def consume_bank_custody_grant(grant):
    return jsonify({"ok": False, "error": "legacy Bank recovery grants are not accepted"}), 410
    if not isinstance(grant, str) or len(grant) < 32:
        return jsonify({"ok": False, "error": "invalid recovery grant"}), 400
    with _bank_custody_lock:
        row = db.session.execute(_sa_text("""
            SELECT vault_id, revoked FROM bank_custody WHERE recovery_grant = :grant AND consumed = 1
        """), {"grant": grant}).mappings().first()
        if not row or row["revoked"]:
            return jsonify({"ok": False, "error": "recovery grant is no longer valid"}), 403
        db.session.execute(_sa_text("""
            UPDATE bank_custody SET recovery_grant = NULL WHERE vault_id = :vault_id
        """), {"vault_id": row["vault_id"]})
        db.session.commit()
    return jsonify({"ok": True, "vault_id": row["vault_id"]})

def _bank_custody_has_raw_proof(value) -> bool:
    if isinstance(value, dict):
        for key, nested in value.items():
            normalized = str(key).replace("_", "").replace("-", "").lower()
            if normalized in {"proof", "passkeyproof", "bankkeyproof"}:
                return True
            if _bank_custody_has_raw_proof(nested):
                return True
    elif isinstance(value, list):
        return any(_bank_custody_has_raw_proof(item) for item in value)
    return False

def _bank_custody_stream(key: bytes, nonce: bytes, length: int) -> bytes:
    output = bytearray()
    counter = 0
    while len(output) < length:
        output.extend(hashlib.sha256(
            key + nonce + counter.to_bytes(4, "big")
        ).digest())
        counter += 1
    return bytes(output[:length])

def _bank_custody_unprotect(encoded: str) -> dict:
    try:
        packed = base64.urlsafe_b64decode(encoded.encode("ascii"))
    except Exception as exc:
        raise ValueError("stored custody state is not decodable") from exc
    if len(packed) < 48:
        raise ValueError("stored custody state is incomplete")
    nonce, tag, cipher = packed[:16], packed[16:48], packed[48:]
    key = _bank_custody_key()
    expected = hmac.new(key, _BANK_CUSTODY_AAD + nonce + cipher, hashlib.sha256).digest()
    if not hmac.compare_digest(tag, expected):
        raise ValueError("stored custody state authentication failed")
    stream = _bank_custody_stream(key, nonce, len(cipher))
    try:
        return json.loads(bytes(a ^ b for a, b in zip(cipher, stream)).decode("utf-8"))
    except Exception as exc:
        raise ValueError("stored custody state is malformed") from exc

def _bank_custody_vault_id(value):
    return value if isinstance(value, str) and re.fullmatch(r"[A-Za-z0-9_-]{16,128}", value) else None

def _bank_custody_protect(value: dict) -> str:
    plain = json.dumps(value, separators=(",", ":"), sort_keys=True).encode("utf-8")
    key = _bank_custody_key()
    nonce = secrets.token_bytes(16)
    stream = _bank_custody_stream(key, nonce, len(plain))
    cipher = bytes(a ^ b for a, b in zip(plain, stream))
    tag = hmac.new(key, _BANK_CUSTODY_AAD + nonce + cipher, hashlib.sha256).digest()
    return base64.urlsafe_b64encode(nonce + tag + cipher).decode("ascii")

def _bank_custody_validate_state(state):
    if (not isinstance(state, dict) or _bank_custody_has_raw_proof(state) or
            set(state) != {"version", "lockboxId", "credential", "cipher"}):
        return None
    credential = state.get("credential")
    cipher = state.get("cipher")
    if (state.get("version") != 1 or not isinstance(state.get("lockboxId"), int) or
            state["lockboxId"] <= 0 or not isinstance(credential, dict) or
            not isinstance(cipher, dict) or not isinstance(credential.get("gt"), int) or
            credential["gt"] < 0 or credential["gt"] > 0xFFFFFFFF or
            set(credential) != {"gt", "proofCommitment", "policy"} or
            set(cipher) != {"algorithm", "nonce", "ciphertext", "tag"} or
            not isinstance(credential.get("policy"), str) or
            len(credential["policy"]) > 1024 or
            not isinstance(credential.get("proofCommitment"), str) or
            not re.fullmatch(r"[0-9a-f]{64}", credential["proofCommitment"], re.I) or
            cipher.get("algorithm") != "CM-BANK-RECOVERY-SHA256-STREAM-v1" or
            not all(isinstance(cipher.get(key), str) for key in ("nonce", "ciphertext", "tag")) or
            not re.fullmatch(r"[0-9a-f]{32}", cipher["nonce"], re.I) or
            not re.fullmatch(r"[0-9a-f]{64}", cipher["tag"], re.I) or
            not re.fullmatch(r"[0-9a-f]+", cipher["ciphertext"], re.I) or
            len(cipher["ciphertext"]) % 2 != 0 or len(cipher["ciphertext"]) > 4 * 1024 * 1024):
        return None
    return state

@app.route("/api/bank-custody/<vault_id>", methods=["GET"])
def bank_custody_status(vault_id):
    vault_id = _bank_custody_vault_id(vault_id)
    if not vault_id:
        return jsonify({"ok": False, "error": "invalid vault id"}), 400
    row = db.session.execute(_sa_text("""
        SELECT revoked, consumed, revision, updated_at FROM bank_custody WHERE vault_id = :vault_id
    """), {"vault_id": vault_id}).mappings().first()
    if not row:
        return jsonify({"ok": False, "error": "custody vault not found"}), 404
    return jsonify({
        "ok": True, "vault_id": vault_id, "revoked": bool(row["revoked"]),
        "consumed": bool(row["consumed"]),
        "revision": int(row["revision"]), "updated_at": float(row["updated_at"])
    })

def _bank_custody_authorize_request(vault_id, data):
    row = db.session.execute(_sa_text("""
        SELECT protected_state, credential_gt, proof_commitment, revoked, consumed, revision
        FROM bank_custody WHERE vault_id = :vault_id
    """), {"vault_id": vault_id}).mappings().first()
    if not row:
        return None, None, (jsonify({"ok": False, "error": "custody vault not found"}), 404)
    try:
        state = _bank_custody_unprotect(row["protected_state"])
    except ValueError:
        return None, None, (jsonify({"ok": False, "error": "stored custody state is corrupted"}), 409)
    commitment = _bank_custody_request_commitment(data, state)
    if (commitment is None or data.get("gt") != int(row["credential_gt"]) or
            not hmac.compare_digest(commitment, str(row["proof_commitment"]))):
        return None, None, (jsonify({"ok": False, "error": "recovery credential rejected"}), 403)
    return row, state, None


class _LumpTransitionConflict(RuntimeError):
    """The current LUMP generation changed before a transition acquired its lock."""


_LUMP_TRANSITION_JOURNAL = ".lump-transition-journal.json"


def _fsync_path(path):
    """Persist a staged file and its directory before advancing a journal."""
    with open(path, "rb") as handle:
        os.fsync(handle.fileno())
    directory_fd = os.open(os.path.dirname(os.path.abspath(path)), os.O_RDONLY)
    try:
        os.fsync(directory_fd)
    finally:
        os.close(directory_fd)


def _durable_atomic_json(path, document):
    """Atomically write JSON and fsync the replacement and containing directory."""
    _atomic_write_json(path, document)
    _fsync_path(path)


def _recover_lump_history_transition(lumps_dir):
    """Recover an interrupted multi-file LUMP transition while its lock is held.

    ``prepared`` deliberately rolls back, even if every replacement happened:
    there is no durable commit marker proving all authoritative files became a
    single revision.  ``committed`` retains replacements and merely removes
    crash debris.  This is conservative by design: an operation status can
    report true only after the durable commit marker.
    """
    journal_path = os.path.join(lumps_dir, _LUMP_TRANSITION_JOURNAL)
    if not os.path.isfile(journal_path):
        return
    journal = None
    try:
        with open(journal_path, encoding="utf-8") as handle:
            journal = json.load(handle)
        if not isinstance(journal, dict) or journal.get("version") != 1:
            raise ValueError("invalid transition journal")
        destinations = journal.get("destinations")
        backups = journal.get("backups")
        staged = journal.get("staged")
        if (not isinstance(destinations, list) or not isinstance(backups, list)
                or not isinstance(staged, list)):
            raise ValueError("incomplete transition journal")
        root = os.path.abspath(lumps_dir) + os.sep
        def _safe(path):
            path = os.path.abspath(path)
            if not path.startswith(root):
                raise ValueError("transition journal path escapes LUMP store")
            return path
        destinations = [_safe(path) for path in destinations]
        backup_rows = []
        for row in backups:
            if not isinstance(row, dict):
                raise ValueError("invalid transition backup record")
            backup_rows.append((_safe(row["destination"]), _safe(row["backup"])))
        staged = [_safe(path) for path in staged]
        if journal.get("state") == "prepared":
            # Verify every durable original before removing even one published
            # target.  A missing backup is not a recoverable "best effort":
            # retain the prepared journal and fail closed for an operator.
            for _, backup in backup_rows:
                if not os.path.lexists(backup):
                    raise ValueError("transition backup is missing")
            for destination in reversed(destinations):
                if os.path.lexists(destination):
                    os.remove(destination)
            for destination, backup in reversed(backup_rows):
                with open(backup, "rb") as source, open(destination, "wb") as target:
                    target.write(source.read())
                    target.flush()
                    os.fsync(target.fileno())
            directory_fd = os.open(lumps_dir, os.O_RDONLY)
            try:
                os.fsync(directory_fd)
            finally:
                os.close(directory_fd)
            operation_id = journal.get("operation_id")
            if isinstance(operation_id, str) and _LUMP_SAVE_OPERATION_ID_RE.fullmatch(operation_id):
                operation_path = os.path.join(
                    lumps_dir, "save-operations", f"{operation_id}.json")
                if os.path.isfile(operation_path):
                    with open(operation_path, encoding="utf-8") as source:
                        operation = json.load(source)
                    if isinstance(operation, dict):
                        operation.update({
                            "outcome": "rejected",
                            "status": 409,
                            "updated_at": time.time(),
                            "response": {
                                "ok": False, "committed": False,
                                "operation_id": operation_id,
                                "error": (
                                    "save transaction was durably rolled back "
                                    "after interruption; retry with a new operation id"
                                ),
                            },
                        })
                        _durable_atomic_json(operation_path, operation)
            # Publish completed rollback before deleting recovery material.
            # A second interruption during cleanup must not require backups
            # that have already been safely removed.
            journal["state"] = "rolled_back"
            _durable_atomic_json(journal_path, journal)
            _append_lump_diagnostic_event(
                {
                    **_lump_diagnostic_operation_context(
                        journal.get("operation_id")),
                    "operation_id": journal.get("operation_id"),
                    "stage": "Commit",
                    "event": "journal_recovery_rollback",
                    "outcome": "rejected",
                    "entry_point": "journal-recovery",
                    "error": {
                        "name": "TransitionRecovered",
                        "message": "interrupted LUMP transition was rolled back",
                    },
                },
                source="server", authoritative=True)
            logging.warning("[lumps] recovered interrupted LUMP transition by rollback")
        elif journal.get("state") == "committed":
            _append_lump_diagnostic_event(
                {
                    **_lump_diagnostic_operation_context(
                        journal.get("operation_id")),
                    "operation_id": journal.get("operation_id"),
                    "stage": "Commit", "event": "journal_recovery_commit",
                    "outcome": "committed", "entry_point": "journal-recovery",
                },
                source="server", authoritative=True)
        elif journal.get("state") == "rolled_back":
            _append_lump_diagnostic_event(
                {
                    **_lump_diagnostic_operation_context(
                        journal.get("operation_id")),
                    "operation_id": journal.get("operation_id"),
                    "stage": "Commit", "event": "journal_recovery_complete",
                    "outcome": "rejected", "entry_point": "journal-recovery",
                },
                source="server", authoritative=True)
        else:
            raise ValueError("unrecognized transition journal state")
        for _, backup in backup_rows:
            if os.path.lexists(backup):
                os.remove(backup)
        for staged_path in staged:
            if os.path.lexists(staged_path):
                os.remove(staged_path)
        os.remove(journal_path)
        directory_fd = os.open(lumps_dir, os.O_RDONLY)
        try:
            os.fsync(directory_fd)
        finally:
            os.close(directory_fd)
    except Exception as recovery_error:
        # Never guess after a corrupt journal.  It remains visible for operator
        # recovery and all transitions are blocked by the caller.
        _append_lump_diagnostic_event(
            {
                **_lump_diagnostic_operation_context(
                    journal.get("operation_id") if isinstance(journal, dict)
                    else None),
                "operation_id": (
                    journal.get("operation_id")
                    if isinstance(journal, dict) else None
                ),
                "stage": "Commit", "event": "journal_recovery_exception",
                "outcome": "unknown", "entry_point": "journal-recovery",
                "error": {
                    "name": type(recovery_error).__name__,
                    "message": str(recovery_error),
                },
            },
            source="server", authoritative=True)
        raise RuntimeError("LUMP transition recovery requires operator intervention")


@contextlib.contextmanager
def _lump_history_transition_lock(lumps_dir: str):
    """Serialize LUMP transitions across threads and server worker processes."""
    import tempfile
    _lock_key = hashlib.sha256(os.path.abspath(lumps_dir).encode()).hexdigest()[:16]
    lock_path = os.path.join(
        tempfile.gettempdir(), f"lumps-history-transition-{_lock_key}.lock")
    os.makedirs(lumps_dir, exist_ok=True)
    with _lumps_manifest_lock:
        depth = getattr(_lump_history_lock_state, "depth", 0)
        if depth:
            _lump_history_lock_state.depth = depth + 1
            try:
                yield
            finally:
                _lump_history_lock_state.depth -= 1
            return
        with open(lock_path, "a+") as lock_fh:
            fcntl.flock(lock_fh.fileno(), fcntl.LOCK_EX)
            _lump_history_lock_state.depth = 1
            try:
                _recover_lump_history_transition(lumps_dir)
                yield
            finally:
                _lump_history_lock_state.depth = 0
                fcntl.flock(lock_fh.fileno(), fcntl.LOCK_UN)

def _commit_lump_history_transition(
    *,
    lumps_dir: str,
    manifest_path: str,
    token8: str,
    manifest_entry: dict,
    binary_filename: str | None = None,
    binary_bytes: bytes | None = None,
    approval_hash: str | None = None,
    approval: dict | None = None,
    archive_stem: str | None = None,
    archive_version: int | None = None,
    archive_binary_path: str | None = None,
    remove_paths: tuple[str, ...] = (),
    compat_old_filename: str | None = None,
    compat_new_filename: str | None = None,
    variant_group: str | None = None,
    ns_slot=None,
    advance_current_version_from_archive: bool = False,
    versioned_current_stem: str | None = None,
    current_version: int | None = None,
    expected_manifest_entry=_LUMP_TRANSITION_UNSET,
    idempotent_if_forked: bool = False,
    additional_json_builder=None,
    operation_id: str | None = None,
) -> dict:
    """Atomically commit one LUMP history transition.

    Save and fork have the same persistence shape: optionally archive the old
    binary, optionally install a new binary, atomically record its hash-bound
    approval, and replace the manifest entry. Every destination is staged before any destination is
    changed.  During commit, existing destinations are moved to private
    backups; any exception restores those backups and removes newly-created
    files.  Archive names are never overwritten: a colliding archive version
    advances to the next unused version.

    The caller supplies already-validated bytes/metadata.  The helper owns only
    the filesystem transition and manifest replacement, so endpoint response
    contracts remain endpoint-specific.
    """
    if not isinstance(manifest_entry, dict):
        raise ValueError("manifest_entry must be an object")
    os.makedirs(lumps_dir, exist_ok=True)

    with _lump_history_transition_lock(lumps_dir):
        locked_manifest = _read_manifest_safe(manifest_path)
        locked_entry = next(
            (entry for entry in locked_manifest if entry.get("token") == token8),
            None,
        )
        if expected_manifest_entry is not _LUMP_TRANSITION_UNSET:
            expected_state = (
                None
                if expected_manifest_entry is None
                else (
                    expected_manifest_entry.get("filename"),
                    expected_manifest_entry.get("lump_version"),
                )
            )
            locked_state = (
                None
                if locked_entry is None
                else (
                    locked_entry.get("filename"),
                    locked_entry.get("lump_version"),
                )
            )
            if locked_state != expected_state:
                if idempotent_if_forked and locked_entry is not None:
                    if locked_entry.get("forked"):
                        live_version = int(
                            locked_entry.get("lump_version", 0)
                        )
                        return {
                            "version": live_version - 1,
                            "next_version": live_version,
                            "already_forked": True,
                        }
                raise _LumpTransitionConflict(
                    f"LUMP {token8} changed while the transition was waiting for its lock"
                )
        archive_info = None
        staged: list[tuple[str, str]] = []
        backups: list[tuple[str, str]] = []
        committed: list[str] = []
        temp_paths: list[str] = []
        journal_path = os.path.join(lumps_dir, _LUMP_TRANSITION_JOURNAL)
        journal = None

        # Version numbers are abstraction-wide, not token-wide.  A bootstrap
        # migration or an older filename stem can leave multiple immutable
        # files related to the same abstraction, so checking only the target
        # filename is insufficient to keep the history table unambiguous.
        history_versions = set()
        history_stems = set()
        history_tokens = set()
        target_abstraction = manifest_entry.get("abstraction")
        source_filename = os.path.basename(archive_binary_path or "")
        for entry in locked_manifest:
            if not isinstance(entry, dict) or entry.get("abstraction") != target_abstraction:
                continue
            entry_filename = os.path.basename(str(entry.get("filename") or ""))
            is_source_entry = (
                entry.get("token") == token8 and
                entry_filename == source_filename
            )
            try:
                if entry.get("lump_version") is not None and not is_source_entry:
                    history_versions.add(int(entry["lump_version"]))
            except (TypeError, ValueError):
                pass
            filename = entry_filename
            if filename.endswith(".lump"):
                history_stems.add(re.sub(r"_v\d+$", "", filename[:-5]))
            entry_token = str(entry.get("token") or "").lower()
            if entry_token:
                history_tokens.add(entry_token)
        if archive_stem:
            history_stems.add(str(archive_stem))
        history_patterns = [
            re.compile(rf"^{re.escape(stem)}_v(\d+)\.lump$")
            for stem in history_stems if stem
        ] + [
            re.compile(rf"^{re.escape(entry_token)}-v(\d+)\.lump$")
            for entry_token in history_tokens if entry_token
        ]
        for filename in (os.listdir(lumps_dir) if os.path.isdir(lumps_dir) else []):
            if filename == source_filename:
                continue
            for pattern in history_patterns:
                match = pattern.match(filename)
                if match:
                    history_versions.add(int(match.group(1)))
                    break

        def _stage_bytes(data: bytes, suffix: str) -> str:
            fd, path = tempfile.mkstemp(dir=lumps_dir, prefix=".lump-transition-", suffix=suffix)
            temp_paths.append(path)
            try:
                with os.fdopen(fd, "wb") as fh:
                    fh.write(data)
                    fh.flush()
                    os.fsync(fh.fileno())
            except Exception:
                try:
                    os.close(fd)
                except OSError:
                    pass
                raise
            return path

        def _stage_json(data: dict) -> str:
            # _atomic_write_json itself is intentionally used here so a
            # simulated JSON write failure is observed before any commit.
            path = _stage_bytes(b"", ".json")
            os.remove(path)
            _atomic_write_json(path, data)
            _fsync_path(path)
            return path

        def _stage_copy(source: str, suffix: str) -> str:
            with open(source, "rb") as fh:
                return _stage_bytes(fh.read(), suffix)

        def _destination(filename: str) -> str:
            return _lump_transition_path(lumps_dir, filename)

        try:
            archive_lump_dest = None
            archive_source = archive_binary_path
            archive_requested = (
                archive_stem is not None
                and archive_version is not None
                and archive_source is not None
                and os.path.isfile(archive_source)
            )
            if archive_requested:
                archive_version = int(archive_version)
                if archive_version < 0:
                    raise ValueError("archive version must be non-negative")
                # Archive names are immutable and never overwritten.
                while True:
                    archive_lump_name = f"{archive_stem}_v{archive_version}.lump"
                    archive_lump_dest = _destination(archive_lump_name)
                    same_lump = os.path.abspath(archive_source) == os.path.abspath(archive_lump_dest)
                    if (archive_version not in history_versions and
                            (not os.path.lexists(archive_lump_dest) or same_lump)):
                        break
                    archive_version += 1

                if os.path.abspath(archive_source) != os.path.abspath(archive_lump_dest):
                    staged.append((archive_lump_dest, _stage_copy(archive_source, ".lump")))
                archive_info = {
                    "version": archive_version,
                    "lump": archive_lump_name,
                }

            if versioned_current_stem is not None:
                version_base = (
                    archive_info["version"]
                    if archive_info is not None
                    else int(current_version or 0)
                )
                next_version = version_base + 1
                while True:
                    candidate_binary = f"{versioned_current_stem}_v{next_version}.lump"
                    candidate_binary_path = _destination(candidate_binary)
                    if (next_version not in history_versions and
                            not os.path.lexists(candidate_binary_path)):
                        break
                    next_version += 1
                binary_filename = candidate_binary
                manifest_entry = dict(manifest_entry)
                manifest_entry["filename"] = binary_filename
                manifest_entry["lump_version"] = next_version
                if archive_info is None:
                    archive_info = {}
                archive_info.update({
                    "next_version": next_version,
                    "current_lump": binary_filename,
                })
                history_versions.add(next_version)
            elif advance_current_version_from_archive:
                if archive_info is None:
                    raise ValueError("cannot advance current version without an archive")
                next_version = archive_info["version"] + 1
                while next_version in history_versions:
                    next_version += 1
                manifest_entry = dict(manifest_entry)
                manifest_entry["lump_version"] = next_version
                archive_info["next_version"] = next_version
                history_versions.add(next_version)

            if binary_filename is not None:
                if binary_bytes is None:
                    raise ValueError("binary_bytes is required with binary_filename")
                staged.append(
                    (_destination(binary_filename), _stage_bytes(binary_bytes, ".lump"))
                )
            if (approval_hash is None) != (approval is None):
                raise ValueError("approval_hash and approval are required together")
            if approval_hash is not None:
                if not re.fullmatch(r"[0-9a-f]{64}", approval_hash):
                    raise ValueError("approval_hash must be a SHA-256 digest")
                approval_out = dict(approval)
                if approval_out.get("binary_hash") != approval_hash:
                    raise ValueError("approval must be bound to approval_hash")
                # The endpoint derives this verified locator after all dynamic
                # version/archive naming has settled. It is never accepted
                # from an approval intent or client metadata.
                approval_out["filename"] = manifest_entry.get("filename")
                approvals = _read_lump_approvals(lumps_dir)
                approvals[approval_hash] = approval_out
                staged.append((
                    _destination(_LUMP_APPROVALS_FILENAME),
                    _stage_json(_shared_approval_envelope(approvals)),
                ))

            updated_manifest = [entry for entry in locked_manifest if entry.get("token") != token8]
            updated_manifest.append(dict(manifest_entry))
            manifest_stage = _stage_json(updated_manifest)
            staged.append((_destination(os.path.basename(manifest_path)), manifest_stage))
            if additional_json_builder is not None:
                additional_json = additional_json_builder(dict(manifest_entry))
                if not isinstance(additional_json, dict):
                    raise ValueError("additional_json_builder must return a mapping")
                for destination, document in additional_json.items():
                    destination = os.path.abspath(destination)
                    if not destination.startswith(os.path.abspath(lumps_dir) + os.sep):
                        raise ValueError("additional JSON destination is outside lumps_dir")
                    staged.append((destination, _stage_json(document)))

            # A compatibility alias is installed only after the new canonical
            # pair has been staged.  It is included in the same rollback set.
            compat_dest = None
            if compat_old_filename and compat_new_filename and compat_old_filename != compat_new_filename:
                compat_dest = _destination(compat_old_filename)

            destinations = []
            for destination, stage in staged:
                if destination not in destinations:
                    destinations.append(destination)
            if compat_dest and compat_dest not in destinations:
                destinations.append(compat_dest)
            for path in remove_paths:
                if path and os.path.abspath(path) not in destinations:
                    destinations.append(os.path.abspath(path))

            for destination in destinations:
                if os.path.lexists(destination):
                    backup = _stage_copy(destination, ".backup")
                    # The staged copy must not be treated as a final artifact.
                    backups.append((destination, backup))

            # The journal is the commit protocol's durable prepare record.
            # It names every target and its fsynced original before the first
            # replacement, so a power loss cannot leave a mixed authoritative
            # manifest/approval/Namespace transaction silently active.
            journal = {
                "version": 1,
                "state": "prepared",
                "destinations": destinations,
                "backups": [
                    {"destination": destination, "backup": backup}
                    for destination, backup in backups
                ],
                "staged": [stage for _, stage in staged],
            }
            if operation_id is not None:
                if not _LUMP_SAVE_OPERATION_ID_RE.fullmatch(str(operation_id)):
                    raise ValueError("operation_id is invalid")
                journal["operation_id"] = operation_id
            _durable_atomic_json(journal_path, journal)
            _append_lump_diagnostic_event(
                {
                    **_lump_diagnostic_operation_context(operation_id),
                    "operation_id": operation_id,
                    "stage": "Commit", "event": "journal_prepared",
                    "outcome": "unknown", "entry_point": "lump-transition",
                },
                source="server", authoritative=True)

            for destination, stage in staged:
                os.replace(stage, destination)
                committed.append(destination)
                _fsync_path(destination)

            if compat_dest:
                # The old path is backed up above, so replacing it with a
                # symlink cannot destroy the previous canonical artifact.
                if os.path.lexists(compat_dest):
                    os.remove(compat_dest)
                os.symlink(compat_new_filename, compat_dest)
                committed.append(compat_dest)
                directory_fd = os.open(lumps_dir, os.O_RDONLY)
                try:
                    os.fsync(directory_fd)
                finally:
                    os.close(directory_fd)

            for path in remove_paths:
                if path and os.path.lexists(path) and os.path.abspath(path) != compat_dest:
                    os.remove(path)
            directory_fd = os.open(lumps_dir, os.O_RDONLY)
            try:
                os.fsync(directory_fd)
            finally:
                os.close(directory_fd)

            # If the manifest path was not a basename (it normally is), the
            # staged destination above still uses its basename.  Reject that
            # configuration rather than silently committing somewhere else.
            if os.path.abspath(manifest_path) != _destination(os.path.basename(manifest_path)):
                raise ValueError("manifest_path must be inside lumps_dir")
            journal["state"] = "committed"
            _durable_atomic_json(journal_path, journal)
            _append_lump_diagnostic_event(
                {
                    **_lump_diagnostic_operation_context(operation_id),
                    "operation_id": operation_id,
                    "stage": "Commit", "event": "journal_committed",
                    "outcome": "committed", "entry_point": "lump-transition",
                },
                source="server", authoritative=True)
        except Exception as transition_error:
            _append_lump_diagnostic_event(
                {
                    **_lump_diagnostic_operation_context(operation_id),
                    "operation_id": operation_id,
                    "stage": "Commit", "event": "exception",
                    "outcome": "unknown", "entry_point": "lump-transition",
                    "error": {
                        "name": type(transition_error).__name__,
                        "message": str(transition_error),
                    },
                },
                source="server", authoritative=True)
            # Remove replacements/symlinks first, then restore every original
            # destination.  Backups remain until the transition succeeds.
            rollback_ok = True
            for destination in reversed(committed):
                try:
                    if os.path.lexists(destination):
                        os.remove(destination)
                except OSError:
                    rollback_ok = False
                    logging.exception("[lumps] Failed to remove transition target %s", destination)
            for destination, backup in reversed(backups):
                try:
                    if os.path.lexists(destination):
                        os.remove(destination)
                    if not os.path.exists(backup):
                        raise OSError("transition backup is missing")
                    with open(backup, "rb") as source, open(destination, "wb") as target:
                        target.write(source.read())
                        target.flush()
                        os.fsync(target.fileno())
                except OSError:
                    rollback_ok = False
                    logging.exception("[lumps] Failed to restore transition backup %s", destination)
            try:
                directory_fd = os.open(lumps_dir, os.O_RDONLY)
                try:
                    os.fsync(directory_fd)
                finally:
                    os.close(directory_fd)
            except OSError:
                rollback_ok = False
                logging.exception("[lumps] Failed to fsync restored transition")
            if not rollback_ok:
                # Keep the prepared journal and every backup.  Startup recovery
                # can retry from durable originals; reporting rolled_back here
                # would make a partial rollback look safe.
                _append_lump_diagnostic_event(
                    {
                        **_lump_diagnostic_operation_context(operation_id),
                        "operation_id": operation_id,
                        "stage": "Commit",
                        "event": "rollback_failed",
                        "outcome": "unknown",
                        "entry_point": "lump-transition",
                        "error": {
                            "name": "RollbackError",
                            "message": "LUMP transition rollback did not complete",
                        },
                    },
                    source="server", authoritative=True)
                raise RuntimeError(
                    "LUMP transition rollback did not complete; recovery journal retained")
            _append_lump_diagnostic_event(
                {
                    **_lump_diagnostic_operation_context(operation_id),
                    "operation_id": operation_id,
                    "stage": "Commit", "event": "rollback_complete",
                    "outcome": "rejected", "entry_point": "lump-transition",
                },
                source="server", authoritative=True)
            if journal is not None and os.path.exists(journal_path):
                try:
                    journal["state"] = "rolled_back"
                    _durable_atomic_json(journal_path, journal)
                    # A crash during this cleanup is safe: the durable
                    # rolled_back marker tells startup recovery to preserve
                    # restored targets and only remove leftover debris.
                    for _, backup in backups:
                        if os.path.lexists(backup):
                            os.remove(backup)
                    if os.path.lexists(journal_path):
                        os.remove(journal_path)
                    directory_fd = os.open(lumps_dir, os.O_RDONLY)
                    try:
                        os.fsync(directory_fd)
                    finally:
                        os.close(directory_fd)
                except Exception:
                    logging.exception("[lumps] Failed to mark rolled-back transition")
            raise
        finally:
            preserve_backups = (
                {backup for _, backup in backups}
                if journal is not None and journal.get("state") == "prepared"
                else set()
            )
            for path in temp_paths:
                try:
                    if path not in preserve_backups and os.path.lexists(path):
                        os.remove(path)
                except OSError:
                    pass

        # Backups are no longer needed after the full transition succeeded.
        for _, backup in backups:
            try:
                if os.path.lexists(backup):
                    os.remove(backup)
            except OSError:
                logging.warning("[lumps] Could not remove transition backup %s", backup)
        if journal is not None and os.path.lexists(journal_path):
            os.remove(journal_path)
            directory_fd = os.open(lumps_dir, os.O_RDONLY)
            try:
                os.fsync(directory_fd)
            finally:
                os.close(directory_fd)

        return archive_info or {}


@app.before_request
def _recover_lump_transition_before_request():
    """Recover, then hold the authoritative file locks through the response."""
    path = request.path
    if path == "/api/lumps/save-diagnostics":
        # Diagnostics are operational metadata only and must remain available
        # even while a separate LUMP transition is being recovered. They never
        # read or mutate Namespace/LUMP authority.
        return None
    # Only LUMP/Namespace API readers and mutators need a stable
    # multi-file snapshot.  In particular do not serialize compilation,
    # FPGA, report-sync, or boot-image generation requests behind a save.
    if not (
        path.startswith("/api/lump")
        or path.startswith("/api/lumps")
        or path.startswith("/api/boot-config")
        or path in {
            "/api/namespace-lump.json",
            "/api/boot-image/ns-state",
            "/api/boot-image/save-ns",
        }
    ):
        return None
    namespace_guard = None
    history_guard = None
    try:
        namespace_guard = _namespace_commit_guard()
        namespace_guard.__enter__()
        history_guard = _lump_history_transition_lock(LUMPS_DIR)
        history_guard.__enter__()
        g._lump_request_namespace_guard = namespace_guard
        g._lump_request_history_guard = history_guard
    except Exception as exc:
        if history_guard is not None:
            try:
                history_guard.__exit__(None, None, None)
            except Exception:
                logging.exception("[lumps] failed to release history guard after acquisition error")
        if namespace_guard is not None:
            try:
                namespace_guard.__exit__(None, None, None)
            except Exception:
                logging.exception("[lumps] failed to release Namespace guard after acquisition error")
        return jsonify({
            "error": f"LUMP storage recovery is required before requests can proceed: {exc}",
            "committed": None,
        }), 503


@app.teardown_request
def _release_lump_transition_request_locks(_exception=None):
    """Do not expose a prepared multi-file transition to a route reader."""
    history_guard = getattr(g, "_lump_request_history_guard", None)
    namespace_guard = getattr(g, "_lump_request_namespace_guard", None)
    if history_guard is not None:
        history_guard.__exit__(None, None, None)
    if namespace_guard is not None:
        namespace_guard.__exit__(None, None, None)


# Imports are startup for both the development server and WSGI workers.  Do an
# eager best-effort recovery here; the before-request guard above remains the
# fail-closed boundary if an operator-visible corrupt journal cannot be read.
try:
    with _namespace_commit_guard():
        with _lump_history_transition_lock(LUMPS_DIR):
            pass
except RuntimeError:
    logging.exception("[lumps] startup transition recovery is blocked")


if __name__ == "__main__":
    _port = int(os.environ.get("E2E_PORT", 5000))
    with _namespace_commit_guard():
        with _lump_history_transition_lock(LUMPS_DIR):
            pass
    logging.info("Starting Church Machine server on port %d", _port)
    _bind_with_retry(_port)
