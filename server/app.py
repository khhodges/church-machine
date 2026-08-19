import os
import re
import sys
import io
import json
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
import requests as http_requests

# ── SSE device-event bus ──────────────────────────────────────────────────────
_sse_clients     = []
_sse_clients_lock = threading.Lock()

# ── LUMP manifest write lock ───────────────────────────────────────────────────
# Guards the read/update/write cycle in save_lump() so concurrent saves never
# clobber each other's manifest entry.  The lump binary and sidecar files are
# written outside this lock (they are per-token and idempotent); only the
# shared manifest.json update is serialised.
_lumps_manifest_lock = threading.Lock()

# Test hook — set to a callable to be invoked inside save_lump() after all
# per-token file writes (Phase 5/6) complete but BEFORE the manifest lock is
# acquired (Phase 7).  This lets tests synchronise threads so both have
# finished their Phase-1 manifest read before either enters Phase 7, making
# the race window deterministic.  None in production (no overhead).
_lumps_manifest_pre_write_hook: "threading.Callable | None" = None


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
from flask import Flask, jsonify, send_from_directory, send_file, redirect, make_response, request

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
            'disasm':     disasm,
            'source_map': 'uploaded',
        }
    return _wukong_trace_metadata_static(nia)

_wukong_trace_metadata = _wukong_resolve_nia
from flask_sqlalchemy import SQLAlchemy
from sqlalchemy.orm import DeclarativeBase
from werkzeug.middleware.proxy_fix import ProxyFix

logging.basicConfig(level=logging.INFO)

class Base(DeclarativeBase):
    pass

db = SQLAlchemy(model_class=Base)

app = Flask(__name__)
app.secret_key = os.environ.get("SESSION_SECRET", "dev-secret-key")
app.wsgi_app = ProxyFix(app.wsgi_app, x_proto=1, x_host=1)

db_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "church_machine.db")
app.config["SQLALCHEMY_DATABASE_URI"] = f"sqlite:///{db_path}"
app.config["SQLALCHEMY_TRACK_MODIFICATIONS"] = False

db.init_app(app)

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SIMULATOR_DIR = os.path.join(BASE_DIR, "simulator")
DOCS_DIR = os.path.join(BASE_DIR, "docs")
WEB_DIR = os.path.join(BASE_DIR, "web")
RISCV_CAP_DIR = os.path.join(BASE_DIR, "riscv_cap")

BOOT_ID = str(uuid.uuid4())

def _git_short_hash():
    try:
        return subprocess.check_output(
            ["git", "rev-parse", "--short", "HEAD"],
            cwd=BASE_DIR, stderr=subprocess.DEVNULL
        ).decode().strip()
    except Exception:
        pass
    for env_key in ("REPL_DEPLOY_ID", "REPL_ID"):
        val = os.environ.get(env_key, "")
        if val:
            return val[:8]
    return "unknown"

BUILD_VERSION = _git_short_hash()

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

@app.route("/dl/wukong-bridge")
def download_wukong_bridge():
    # Serve the canonical bridge from hardware/ — server/wukong_bridge.py was a
    # stale duplicate that caused users to download an outdated bridge.
    p = os.path.join(os.path.dirname(__file__), "..", "hardware", "wukong_bridge.py")
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

def _wukong_build_dir():
    """Directory holding the pre-built Wukong bitstream (patchable in tests)."""
    return os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "build"))

def _bitstream_sidecar_path(bit_path):
    """Path of the JSON metadata sidecar next to a .bit file."""
    return bit_path + ".meta.json"

def _write_bitstream_sidecar(bit_path, version=None, source_commit=None):
    """Write a metadata sidecar describing the actual .bit file on disk.

    Records the declared build version (may be None if unknown), the md5 of
    the file contents (so staleness/tampering is detectable), a built_at
    timestamp, and the source commit when known.
    """
    import hashlib, datetime as _dt
    md5 = hashlib.md5()
    with open(bit_path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            md5.update(chunk)
    meta = {
        "version": version,
        "md5": md5.hexdigest(),
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
    md5 no longer matches the file on disk (i.e. the .bit was replaced
    without updating the sidecar — metadata cannot be trusted).
    """
    import hashlib
    sc = _bitstream_sidecar_path(bit_path)
    try:
        with open(sc) as f:
            meta = json.load(f)
        if not isinstance(meta, dict) or not meta.get("md5"):
            return None
        md5 = hashlib.md5()
        with open(bit_path, "rb") as f:
            for chunk in iter(lambda: f.read(1 << 20), b""):
                md5.update(chunk)
        if md5.hexdigest() != meta["md5"]:
            return None
        return meta
    except Exception:
        return None

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

@app.route("/dl/wukong-bit")
def download_wukong_bit():
    p = os.path.join(_wukong_build_dir(), "church_wukong_xc7a100t.bit")
    # Only advertise a version verified against the actual file's sidecar
    # metadata — never the current source version (the .bit on disk may be
    # older than the source right after a code push).
    meta = _read_bitstream_meta(p)
    ver = meta.get("version") if meta else None
    name = ("church_wukong_xc7a100t_v%d.bit" % ver) if ver else "church_wukong_xc7a100t.bit"
    return send_file(os.path.abspath(p), as_attachment=True,
                     download_name=name,
                     mimetype="application/octet-stream")

@app.route("/dl/wukong-bscan")
def download_wukong_bscan():
    p = os.path.join(os.path.dirname(__file__), "..", "build", "bscan_spi_xc7a100t_fgg676.bit")
    return send_file(os.path.abspath(p), as_attachment=True,
                     download_name="bscan_spi_xc7a100t_fgg676.bit",
                     mimetype="application/octet-stream")

@app.route("/dl/wukong-mcs")
def download_wukong_mcs():
    p = os.path.join(os.path.dirname(__file__), "..", "build", "church_wukong_xc7a100t.mcs")
    return send_file(os.path.abspath(p), as_attachment=True,
                     download_name="church_wukong_xc7a100t.mcs",
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
           -F "file=@church_wukong_xc7a100t.bit"
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
    _approver = request.form.get("approver", "") or request.args.get("approver", "")

    # ── filesystem flow — entirely wrapped so every failure is recorded ──────
    # Save to a temp file first, write its sidecar, then atomically move both
    # into place — a failed upload leaves the previous .bit + sidecar intact.
    tmp_path = bit_path + ".uploading"
    try:
        os.makedirs(build_dir, exist_ok=True)
        f.save(tmp_path)
        meta = _write_bitstream_sidecar(tmp_path, version=version, source_commit=source_commit)
        os.replace(_bitstream_sidecar_path(tmp_path), _bitstream_sidecar_path(bit_path))
        os.replace(tmp_path, bit_path)
        size = os.path.getsize(bit_path)
    except Exception as _fs_exc:
        for leftover in (tmp_path, _bitstream_sidecar_path(tmp_path)):
            try:
                os.remove(leftover)
            except OSError:
                pass
        # Record failure with a safe fixed code — never str(exception)
        _record_build_event(board="wukong-xc7a100t", status="failed",
                            notes="save_error", approver=_approver)
        app.logger.exception("Wukong bit upload filesystem error")
        return jsonify({"ok": False, "error": "Upload write failed"}), 500
    # ── end filesystem flow ──────────────────────────────────────────────────

    app.logger.info("Wukong bit uploaded: %d bytes (version=%s md5=%s)",
                    size, version, meta["md5"])

    # Record this upload as a build event so it appears in Build History.
    # Version is always set to the record's primary-key id (atomic, unique).
    # Caller-supplied version is NOT used for BuildRecord allocation.
    _record_build_event(
        board="wukong-xc7a100t",
        status="succeeded",
        notes="upload",
        bit_path=bit_path,
        bit_hash=meta["md5"],
        approver=_approver,
    )

    return jsonify({"ok": True, "size_bytes": size, "version": version, "md5": meta["md5"]})


@app.route("/api/bitstream-status")
def api_bitstream_status():
    """Return metadata about the pre-built Wukong bitstream for the IDE panel."""
    build_dir = _wukong_build_dir()
    bit_path = os.path.join(build_dir, "church_wukong_xc7a100t.bit")
    present = os.path.isfile(bit_path)
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
    })


def _record_build_event(board, status, notes="", bit_path="", bit_hash="", mcs_path="", approver=""):
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
            git_commit=_git_short_hash()[:64],
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
                # notes omitted: may contain internal error codes stored server-side
            })
        return jsonify({"ok": True, "builds": out})
    except Exception as e:
        logging.exception("api_builds_list failed")
        return jsonify({"ok": False, "error": "could not load build history"}), 500


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
        ns_snapshot  — JS object snapshot of NS table (optional)
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
    ns_snap = data.get("ns_snapshot")
    test_res = data.get("test_results")
    try:
        br = BuildRecord(
            version=0,   # placeholder; overwritten with id after flush
            timestamp=_dt.datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ"),
            board=str(data.get("board", ""))[:64],
            status=str(data.get("status", "unknown"))[:16],
            approver=str(data.get("approver", ""))[:128],
            git_commit=str(data.get("git_commit", "") or _git_short_hash())[:64],
            ns_snapshot=json.dumps(ns_snap) if ns_snap is not None else None,
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
      local_bridge.py            — UART bridge helper (reserved for future use)

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
        if os.path.exists(xdc):
            zf.write(xdc, "wukong_xc7a100t.xdc")
        if os.path.exists(tcl):
            zf.write(tcl, "wukong_xc7a100t.tcl")
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

@app.route("/robots.txt")
def robots_txt():
    content = "User-agent: *\nAllow: /\nSitemap: https://haskell-main-1.replit.app/sitemap.xml\n"
    return make_response(content, 200, {"Content-Type": "text/plain; charset=utf-8"})

@app.route("/sitemap.xml")
def sitemap_xml():
    content = (
        '<?xml version="1.0" encoding="UTF-8"?>\n'
        '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'
        '  <url><loc>https://haskell-main-1.replit.app/</loc><priority>1.0</priority></url>\n'
        '  <url><loc>https://haskell-main-1.replit.app/simulator/</loc><priority>0.9</priority></url>\n'
        '  <url><loc>https://haskell-main-1.replit.app/docs/</loc><priority>0.7</priority></url>\n'
        '  <url><loc>https://haskell-main-1.replit.app/python-demo/</loc><priority>0.6</priority></url>\n'
        '</urlset>\n'
    )
    return make_response(content, 200, {"Content-Type": "application/xml; charset=utf-8"})

@app.route("/api/health")
@app.route("/health")
def health():
    return jsonify({"status": "ok"})

@app.route("/favicon.ico")
def favicon():
    return make_response('', 204)

@app.route("/api/boot-id")
def boot_id():
    return jsonify({"bootId": BOOT_ID, "version": BUILD_VERSION})

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

@app.route("/internal/git-sync")
def internal_git_sync():
    """Trigger an immediate code push to both GitHub repos (non-LFS).

    Pushes to:
      • khhodges/s-ide-v1      (S-IDE v1 simplified entry-point IDE)
      • khhodges/church-machine (full Church Machine source)

    Requires Authorization: Bearer <REPORT_TOKEN> header or ?token=<REPORT_TOKEN>.

    Returns JSON: {success, returncode, output, sha, branch, repos}
      repos: {"s-ide-v1": "ok"|"fail", "church-machine": "ok"|"fail"}
    """
    import subprocess
    from daily_report import check_report_auth as _check_auth
    if not _check_auth(request):
        return jsonify({"error": "Unauthorized — supply token via Authorization header or ?token="}), 401

    pat = os.environ.get("GITHUB_PAT", "").strip()
    if not pat:
        return jsonify({"success": False, "message": "GITHUB_PAT secret is not set"}), 503

    script = os.path.join(
        os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
        "scripts", "sync-to-github.sh",
    )
    if not os.path.isfile(script):
        return jsonify({"success": False, "message": "sync-to-github.sh not found"}), 500

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

        logging.info(
            "Manual git-sync triggered: success=%s sha=%s repos=%s",
            success, sha, repos,
        )
        return jsonify({
            "success": success,
            "returncode": result.returncode,
            "output": output[-2000:],
            "sha": sha,
            "branch": branch,
            "repos": repos,
        })
    except Exception as exc:
        logging.exception("Error in /internal/git-sync")
        return jsonify({"success": False, "message": str(exc)}), 500


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
BOOT_CONFIG_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)),
                                "boot-config.json")
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
        "totalRamWords": 65536,
        "addressBits": 18,
        "addressRange": "0x0000_0000 – 0x0003_FFFF (256 KB byte-addressable)",
        "notes": "QMTECH Wukong XC7A100T — 256 KB block-RAM namespace window",
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
    "step1": {
        "totalNamespaceWords": 16384,
        "namespaceLumpWords": 64,
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

# Hard ceiling on how many entries the NS table may hold.
# GT bits[15:0] supports up to 65535 slots; 1024 is the practical cap.
# At 4 words per entry this reserves up to 4096 words of the namespace LUMP.
MAX_NS_ENTRIES = 1024
# How many named NS entries are present after a cold boot.
# The 8-slot boot model populates exactly slots 0–7 during
# _initNamespaceTable(): Boot.NS (0), Boot.Thread (1), UART_DEV (2),
# LED_DEV (3), BTN_DEV (4), TIMER_DEV (5), SelfTest (6),
# WukongCallHome (7).
# Slots 2–5 are MMIO device windows backed by hardware registers, not RAM.
# The ⚡ lightning bolt sets Thread.CR0 to whichever slot the programmer
# chooses as boot entry (default 6 = SelfTest; Wukong boards use 7).
# Keep in sync with simulator.js _getHardwareBootCatalog() and
# server/boot_image.py DEFAULT_ABSTRACTION_CATALOG.
BASE_NAMED_NS_COUNT = 11

# Slots reserved for foundational lumps (Step 1) and device MMIO regions —
# the programmer cannot place an additional resident lump body here.
# Slots 0–1: Boot.NS, Boot.Thread (foundational RAM lumps).
# Slots 2–5: UART_DEV, LED_DEV, BTN_DEV, TIMER_DEV (MMIO windows; NS entries
#            point at physical hardware addresses, no lump body in RAM).
# Slots 2–3 are included in range(0, 4); 4–5 not yet in this set (pre-existing).
RESERVED_NS_SLOTS = set(range(0, 4)) | set(range(11, 16))
LUMP_MAX_ARCHIVE_VERSIONS = 20  # max archived versions kept per token; oldest are pruned
if LUMP_MAX_ARCHIVE_VERSIONS < 0:
    raise ValueError(f"LUMP_MAX_ARCHIVE_VERSIONS must be >= 0, got {LUMP_MAX_ARCHIVE_VERSIONS}")
LUMPS_MANIFEST_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)),
                                   "lumps", "manifest.json")

def _load_lump_catalog():
    """Return the subset of server/lumps/manifest.json suitable for Step 2.

    Fixed-slot lumps (ns_slot is an integer) and entries that target reserved
    slots (foundational + device MMIO) are dropped. The rest is what the
    programmer can choose to bake in.

    Floating lumps (ns_slot_policy == "dynamic", ns_slot == null) are included
    with a "floating": True flag and nsSlot: None so the IDE can surface them
    in diagnostic/utility catalog sections without treating them as Step 2
    resident candidates (the _validate_step2 path still filters by nsSlot).
    """
    try:
        with open(LUMPS_MANIFEST_PATH, "r") as f:
            raw = json.load(f)
    except Exception:
        return []
    out = []
    floating = []
    for entry in raw if isinstance(raw, list) else []:
        slot = entry.get("ns_slot")
        policy = entry.get("ns_slot_policy", "dynamic" if not isinstance(slot, int) else "static")
        if not isinstance(slot, int):
            # Floating lump — include in catalog with floating flag
            if policy == "dynamic" and entry.get("token"):
                e = {
                    "abstraction": entry.get("abstraction"),
                    "nsSlot": None,
                    "lumpSize": entry.get("lump_size"),
                    "token": entry.get("token"),
                    "nsSlotPolicy": policy,
                    "hasExecutableMethods": bool(entry.get("methods")),
                    "floating": True,
                    "grants": entry.get("grants", []),
                    "description": entry.get("description"),
                }
                floating.append(e)
            continue
        if slot in RESERVED_NS_SLOTS:
            continue
        e = {
            "abstraction": entry.get("abstraction"),
            "nsSlot": slot,
            "lumpSize": entry.get("lump_size"),
            "token": entry.get("token"),
            "nsSlotPolicy": policy,
            "hasExecutableMethods": bool(entry.get("methods")),
        }
        if entry.get("media_tags"):
            e["mediaTags"] = entry["media_tags"]
        out.append(e)
    # Stable ordering: by ns_slot, then abstraction name.
    out.sort(key=lambda e: (e["nsSlot"], e["abstraction"] or ""))
    # Floating lumps appended after fixed-slot entries, sorted by name.
    floating.sort(key=lambda e: e["abstraction"] or "")
    return out + floating

def _validate_step2(step2, step1, target_board):
    """Validate the optional Step 2 (resident lumps) section.

    `step2.lumps` is a list of {nsSlot, resident, physAddr?, lumpSize?}.
    Lazy entries (resident=False) need only nsSlot; resident entries must
    specify a physAddr inside the usable region and not collide with
    another resident lump or with the foundational layout.
    """
    if step2 is None:
        return None
    if not isinstance(step2, dict):
        return "step2 must be an object"
    lumps = step2.get("lumps") or []
    if not isinstance(lumps, list):
        return "step2.lumps must be a list"
    catalog = {e["nsSlot"]: e for e in _load_lump_catalog()}
    _ns_slots_max_v2 = int(step1.get("nsSlotsMax") or _boot_image_gen.DEFAULT_NS_SLOTS_MAX)
    NS_TABLE_RESERVE = _boot_image_gen.ns_table_reserve_words(_ns_slots_max_v2)
    total = step1["totalNamespaceWords"]
    # Determine actual Boot.Abstr size from the saved SelfTest lump (looked up via
    # manifest.json).  A resident step-2 lump must not overlap whichever Boot.Abstr
    # will actually be placed.
    _abstr_size_for_validation = BOOT_ABSTR_DEFAULT_SIZE
    _saved_abstr_path = _boot_image_gen.find_lump_file_by_abstraction(
        LUMPS_DIR, "SelfTest", _boot_image_gen.BOOT_ABSTR_NS_SLOT)
    if _saved_abstr_path is not None:
        try:
            import struct as _vstruct
            with open(_saved_abstr_path, "rb") as _fh:
                _raw = _fh.read()
            _n_words = len(_raw) // 4
            if _n_words >= 1:
                _hdr       = _vstruct.unpack(">I", _raw[:4])[0]
                _magic     = (_hdr >> 27) & 0x1F
                _n_minus_6 = (_hdr >> 23) & 0xF
                _cw        = (_hdr >> 10) & 0x1FFF
                _cc        = _hdr & 0xFF
                _declared  = 1 << (_n_minus_6 + 6)
                # Use the same validation criteria as generate_boot_image()
                # so that "placed size" is computed consistently between generation
                # and validation; an invalid/truncated lump falls back to the default.
                if (_magic == 0x1F and
                        64 <= _declared <= 16384 and
                        _n_words >= _declared and
                        _cw >= 1 and _cc >= 1 and _cc <= _declared):
                    _abstr_size_for_validation = _declared
        except OSError:
            pass
    foundation_end = (step1["namespaceLumpWords"] +
                      step1["threadLumpWords"] * int(step1.get("threadCount") or 1) +
                      _abstr_size_for_validation)       # Boot.Abstr: saved lump size or 64w default
    # NS slots 2–5 are MMIO (no RAM body) — they do not contribute to foundation_end.
    usable_end = total - NS_TABLE_RESERVE
    seen_slots = set()
    occupied = []  # list of (start, end_exclusive, label) for resident lumps
    for entry in lumps:
        if not isinstance(entry, dict):
            return "each step2.lumps entry must be an object"
        slot = entry.get("nsSlot")
        if not isinstance(slot, int) or slot < 0 or slot >= MAX_NS_ENTRIES:
            return f"step2.lumps entry has invalid nsSlot: {slot!r}"
        if slot in RESERVED_NS_SLOTS:
            return (f"NS slot {slot} is reserved (foundational lump or device "
                    f"MMIO) and cannot host a resident lump")
        if slot in seen_slots:
            return f"duplicate step2.lumps entry for NS slot {slot}"
        seen_slots.add(slot)
        if slot not in catalog:
            return f"NS slot {slot} is not present in the lump catalog"
        resident = bool(entry.get("resident"))
        if not resident:
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
    # The simulator's _initNamespaceTable() writes BASE_NAMED_NS_COUNT named
    # entries from the default abstraction catalog regardless of what Step 2
    # contains. Step 3 reserves additional empty entries on top of that
    # baseline, so the cap is BASE_NAMED_NS_COUNT + n <= MAX_NS_ENTRIES.
    end = BASE_NAMED_NS_COUNT + n
    # Validate against the *configured* capacity (step1.nsSlotsMax, legacy
    # default 256) so save-time and generation-time contracts agree — the
    # generator rejects overflow of the configured table, not the 1024 cap.
    _cap = MAX_NS_ENTRIES
    try:
        _cap = int((step1 or {}).get("nsSlotsMax") or _boot_image_gen.DEFAULT_NS_SLOTS_MAX)
    except Exception:
        pass
    _cap = min(_cap, MAX_NS_ENTRIES)
    if end > _cap:
        return (f"step3.emptySlotCount ({n}) plus the {BASE_NAMED_NS_COUNT} "
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
    foundation_sum = (step1["namespaceLumpWords"] +
                      step1["threadLumpWords"] * int(step1.get("threadCount") or 1) +
                      BOOT_ABSTR_DEFAULT_SIZE)        # Boot.Abstr (slot 6) — always 64w minimum
    # NS slots 2–5 are MMIO (no RAM body) — they do not contribute to foundation_sum.
    if foundation_sum > total:
        return (f"Sum of foundational lump sizes ({foundation_sum}) exceeds "
                f"totalNamespaceWords ({total})")
    # Optional nsSlotsMax — validated here, persisted by boot_config_post (Task #1244).
    _raw_ns_slots_max = step1.get("nsSlotsMax")
    if _raw_ns_slots_max is not None:
        if not isinstance(_raw_ns_slots_max, int) or _raw_ns_slots_max < 1:
            return "step1.nsSlotsMax must be a positive integer when provided"
        if _raw_ns_slots_max > MAX_NS_ENTRIES:
            return (f"step1.nsSlotsMax ({_raw_ns_slots_max}) exceeds the maximum "
                    f"supported NS slot count ({MAX_NS_ENTRIES})")
    # Optional threadCount (Task #2562): V20 Thread.1..Thread.n resident stack
    # objects. Each thread costs threadLumpWords of resident RAM.
    _raw_thread_count = step1.get("threadCount")
    if _raw_thread_count is not None:
        if not isinstance(_raw_thread_count, int) or not (1 <= _raw_thread_count <= 9):
            return "step1.threadCount must be an integer between 1 and 9 when provided"
    # The Thread capability zone sits at a fixed +244 offset, so any thread
    # body smaller than 256 words cannot contain its own CR0 boot-entry GT.
    if step1["threadLumpWords"] < 256:
        return ("step1.threadLumpWords must be at least 256: the Thread "
                "capability zone lives at fixed offset +244 inside the lump")
    # The simulator reserves the top NS_TABLE_RESERVE words of the namespace
    # window for the namespace table itself.  Reserve size is now dynamic:
    # nextPow2(nsSlotsMax × 4).
    _ns_slots_max_v1 = int(_raw_ns_slots_max or _boot_image_gen.DEFAULT_NS_SLOTS_MAX)
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
        "lumpCatalog": _load_lump_catalog(),
        "limits": {
            "maxNsEntries": MAX_NS_ENTRIES,
            "baseNamedNsCount": BASE_NAMED_NS_COUNT,
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
    err2 = _validate_step2(step2, step1, target_board)
    if err2:
        return jsonify({"ok": False, "error": err2}), 400
    step3 = data.get("step3")
    err3 = _validate_step3(step3, step1, step2)
    if err3:
        return jsonify({"ok": False, "error": err3}), 400
    cfg = {
        "schemaVersion": BOOT_CONFIG_SCHEMA_VERSION,
        "targetBoard": target_board,
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
    if step2 is not None:
        norm = []
        for e in (step2.get("lumps") or []):
            row = {"nsSlot": int(e["nsSlot"]),
                   "resident": bool(e.get("resident"))}
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
    if os.path.exists(BOOT_CONFIG_PATH):
        try:
            with open(BOOT_CONFIG_PATH) as _f:
                _existing = json.load(_f)
            if isinstance(_existing.get("slotLabels"), dict):
                cfg["slotLabels"] = _existing["slotLabels"]
            # Preserve nextAfterSelfTestSlot — written by the "→ Next" secondary ⚡
            # in the abstractions panel; must not be wiped by a Boot Image Designer save.
            _n = _existing.get("nextAfterSelfTestSlot")
            if isinstance(_n, int) and _n >= 0:
                cfg["nextAfterSelfTestSlot"] = _n
        except Exception:
            pass
    try:
        with open(BOOT_CONFIG_PATH, "w") as f:
            json.dump(cfg, f, indent=2)
    except Exception as e:
        return jsonify({"ok": False, "error": f"Failed to write boot-config.json: {e}"}), 500
    return jsonify({"ok": True, "config": cfg})


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


@app.route("/api/boot-config/next-after-selftest", methods=["POST"])
def boot_config_next_after_selftest():
    """Write nextAfterSelfTestSlot to boot-config.json.

    Called by the "→ Next" secondary ⚡ button in the abstractions panel.
    Persisting the slot here means generate_boot_image() bakes the correct
    Next.GT (E-GT targeting that slot) into DEMO_CLIST idx 1 automatically.

    body: {"nextAfterSelfTestSlot": <int ≥ 0> | null}
    null (or absent)  → remove the field → SelfTest self-loops back to itself.

    Requires Authorization: Bearer <REPORT_TOKEN> when REPORT_TOKEN is set.
    In dev sessions without a configured token the check is skipped so the
    abstractions-panel button keeps working without credentials.
    """
    ok, err = _optional_report_token_check()
    if not ok:
        return err
    data = request.get_json(silent=True) or {}
    slot = data.get("nextAfterSelfTestSlot")
    cfg = {}
    if os.path.isfile(BOOT_CONFIG_PATH):
        try:
            with open(BOOT_CONFIG_PATH) as _f:
                cfg = json.load(_f) or {}
        except Exception:
            pass
    if slot is None:
        cfg.pop("nextAfterSelfTestSlot", None)
    elif isinstance(slot, int) and 0 <= slot < MAX_NS_ENTRIES:
        cfg["nextAfterSelfTestSlot"] = slot
    else:
        return jsonify({"ok": False, "error":
                        f"nextAfterSelfTestSlot must be a non-negative integer "
                        f"< {MAX_NS_ENTRIES} (V20 maximum) or null"}), 400
    try:
        with open(BOOT_CONFIG_PATH, "w") as _f:
            json.dump(cfg, _f, indent=2)
    except Exception as e:
        return jsonify({"ok": False, "error": f"Failed to write boot-config.json: {e}"}), 500
    return jsonify({"ok": True})


@app.route("/api/boot-config/slot-label", methods=["POST"])
def boot_config_slot_label():
    """Merge a single NS slot → label mapping into boot-config.json.
    Called by +Add LUMP so the label survives hard resets without touching
    the step1/step2/step3 fields written by the Boot Image Designer."""
    data = request.get_json(silent=True) or {}
    slot = data.get("slot")
    label = str(data.get("label", "") or "").strip()
    if not isinstance(slot, int) or slot < 0 or slot >= 256:
        return jsonify({"ok": False, "error": "slot must be an integer 0–255"}), 400
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
BOOT_IMAGE_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)),
                               "lumps", "boot-image.bin")
NS_STATE_PATH   = os.path.join(os.path.dirname(os.path.abspath(__file__)),
                               "lumps", "ns-state.json")
LUMPS_DIR = os.path.dirname(LUMPS_MANIFEST_PATH)

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
        return frozenset({'00000600'})

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
    entry_slot = body.get("entrySlot", None)
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
        with open(BOOT_IMAGE_PATH, "wb") as f:
            f.write(blob)
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
    try:
        _boot_image_gen.validate_boot_image(_image_bytes)
    except ValueError as _e:
        logging.error("boot_image_download: stale or invalid boot image on disk: %s", _e)
        return jsonify({"error": f"Boot image on disk is stale or invalid: {_e}"}), 500
    return send_file(io.BytesIO(_image_bytes), mimetype="application/octet-stream",
                     as_attachment=True, download_name="boot-image.bin")

def _boot_image_is_stale():
    """Return True if any tracked LUMP source is newer than boot-image.bin.

    Checked files: 00000600.lump (Boot.Abstr binary) and manifest.json
    (controls boot_resident flag).  If boot-image.bin does not exist the
    function returns False so callers fall through to their own 404 path.
    """
    if not os.path.isfile(BOOT_IMAGE_PATH):
        return False
    try:
        _img_mtime = os.path.getmtime(BOOT_IMAGE_PATH)
        _lumps_dir = os.path.dirname(BOOT_IMAGE_PATH)
        for _fname in ("00000600.lump", "manifest.json"):
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
        _blob = _boot_image_gen.generate_boot_image(_cfg, LUMPS_DIR)
        with open(BOOT_IMAGE_PATH, "wb") as _fh:
            _fh.write(_blob)
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
    if _boot_image_is_stale():
        _new_bytes, _regen_err = _auto_regen_boot_image()
        if _regen_err:
            logging.warning("boot_image_binary: staleness regen failed (%s); serving cached copy", _regen_err)
    with open(BOOT_IMAGE_PATH, "rb") as _f:
        _image_bytes = _f.read()
    try:
        _boot_image_gen.validate_boot_image(_image_bytes)
    except ValueError as _e:
        logging.error("boot_image_binary: stale or invalid boot image on disk: %s", _e)
        return jsonify({"error": f"Boot image on disk is stale or invalid: {_e}"}), 500
    resp = send_file(io.BytesIO(_image_bytes), mimetype="application/octet-stream")
    resp.headers["Cache-Control"] = "no-store, no-cache, must-revalidate, max-age=0"
    resp.headers["Pragma"] = "no-cache"
    return resp

@app.route("/api/boot-image/exists", methods=["GET"])
def boot_image_exists():
    """Return whether a boot-image.bin currently exists on disk."""
    return jsonify({"exists": os.path.isfile(BOOT_IMAGE_PATH)})


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
    _ns_slots_max_mf = int(step1.get("nsSlotsMax") or _boot_image_gen.DEFAULT_NS_SLOTS_MAX)
    ns_table_base  = total - _boot_image_gen.ns_table_reserve_words(_ns_slots_max_mf)
    ns_entry_words = _boot_image_gen.NS_ENTRY_WORDS
    catalog        = _boot_image_gen.DEFAULT_ABSTRACTION_CATALOG

    hdr       = words[0]
    hdr_magic = (hdr >> 27) & 0x1F
    hdr_nm6   = (hdr >> 23) & 0xF
    hdr_cw    = (hdr >> 10) & 0x1FFF
    hdr_cc    = hdr & 0xFF
    ns_lump_size = 1 << (hdr_nm6 + 6) if hdr_magic == 0x1F else ns_size

    slot_count = max(hdr_cc, len(catalog))
    slots = []
    for i in range(slot_count):
        ns_base = ns_table_base + i * ns_entry_words
        if ns_base + ns_entry_words > total:
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
        if hdr_magic == 0x1F and hdr_cc > 0 and i < hdr_cc:
            clist_start = ns_lump_size - hdr_cc
            if 0 <= clist_start + i < total:
                gt_word = words[clist_start + i]

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
        "physicalBase":    0,
        "physicalSize":    ns_lump_size if hdr_magic == 0x1F else ns_size,
        "cc":              hdr_cc if hdr_magic == 0x1F else 0,
        "cw":              hdr_cw if hdr_magic == 0x1F else 0,
        "totalMemoryWords": total,
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

    try:
        _boot_image_gen.validate_boot_image(image_bytes)
    except ValueError as exc:
        return jsonify({"ok": False, "error": str(exc)}), 400

    try:
        with open(BOOT_IMAGE_PATH, "wb") as f:
            f.write(image_bytes)
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

    try:
        _boot_image_gen.validate_boot_image(_img_bytes)
    except ValueError as _exc:
        return jsonify({"ok": False, "error": str(_exc)}), 400

    # Write boot-image.bin
    try:
        with open(BOOT_IMAGE_PATH, "wb") as _fh:
            _fh.write(_img_bytes)
    except Exception as _exc:
        return jsonify({"ok": False, "error": f"Failed to write boot-image.bin: {_exc}"}), 500

    # Write ns-state.json (rich per-slot format)
    try:
        _raw_abs = _ns_state.get("abstractions") or []
        # Accept list of rich dicts; silently drop any malformed element.
        _ns_entries = [
            _a for _a in _raw_abs
            if isinstance(_a, dict) and _a.get("name") and isinstance(_a.get("slot"), int)
        ]
        _write_ns_state(_ns_entries)
    except Exception as _nse:
        print(f"[ns-state] save-ns: failed to write ns-state.json: {_nse}", flush=True)

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
    ("ctmm-r1-11-switch-lifecycle.pdf",     "SWITCH Lifecycle & PassKey Install","Security & Capabilities"),
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
        CRC seal, bounds, and permission bits. No code can read or write memory without a valid token.
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
        <li>The pipeline checks: version, CRC seal, bounds, and permission bits — in that order</li>
        <li>An out-of-bounds or permission-denied access fires a capability fault, not a crash</li>
        <li>Domain purity keeps capabilities strictly separate from code and data words</li>
      </ul>
      <div class="concept-box">
        <strong>Golden Token format:</strong> bits [31:28] version · [27:16] CRC seal ·
        [15:8] upper bound · [7:0] lower bound. The <strong>E</strong> (execute) bit is the only
        permission in a C-List entry; data tokens carry <strong>R</strong> and/or <strong>W</strong>.
      </div>
      <div class="quiz" id="quiz-2">
        <div class="quiz-label">Quick Check</div>
        <div class="quiz-prompt">In what order does the mLoad pipeline perform its four checks?</div>
        <div class="quiz-options">
          <button class="quiz-opt" onclick="checkAnswer(2,this,false)">Bounds → CRC seal → version → permissions</button>
          <button class="quiz-opt" onclick="checkAnswer(2,this,true)">Version → CRC seal → bounds → permissions</button>
          <button class="quiz-opt" onclick="checkAnswer(2,this,false)">Permissions → bounds → CRC seal → version</button>
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
        that packages compiled code, its C-List of capabilities, and a header with CRC-sealed metadata.
        Once built, you commit the LUMP to the Mum Tunnel repository so others can lazy-load it.
      </p>
      <div class="code-block">
        <div class="code-label">LUMP anatomy (simplified)</div>
        <pre><span class="cm">; Word 0  — header: magic, version, lump_size</span>
<span class="cm">; Word 1  — bounds: cw (code words), cc (clist capacity)</span>
<span class="cm">; Word 2  — CRC seal over words 0–1</span>
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
        <div class="quiz-prompt">Which LUMP word holds the CRC seal, and what does it cover?</div>
        <div class="quiz-options">
          <button class="quiz-opt" onclick="checkAnswer(4,this,false)">Word 0 — seals the entire compiled instruction list</button>
          <button class="quiz-opt" onclick="checkAnswer(4,this,true)">Word 2 — seals Words 0 and 1 (the header)</button>
          <button class="quiz-opt" onclick="checkAnswer(4,this,false)">The last word — seals the C-List capability slots</button>
        </div>
        <div class="quiz-hint" id="hint-4">Look at the LUMP anatomy above: the seal appears third in the layout and protects the two words that precede it.</div>
        <div class="quiz-ok" id="ok-4">&#10003; Correct! Word 2 is the CRC seal over Words 0–1 (magic/version/size and bounds).</div>
      </div>
    </div>

    <!-- Page 5: Lazy Load Approval -->
    <div class="page" data-page="5">
      <div class="page-eyebrow">Step 5 of 6</div>
      <h1 class="page-title">Lazy Load Approval</h1>
      <p class="page-desc">
        Church Machine abstractions are loaded <em>on demand</em> — not at boot time. The
        <strong>Locator</strong> intercepts a call to an unloaded namespace slot, fetches the LUMP
        from the Mum Tunnel, validates its CRC seal, and maps it into RAM before execution resumes.
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
<title>CM Release 1 — Document Set</title>
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
  <div class="hero-meta">Includes Verilog netlist &middot; XDC pin constraints &middot; Vivado build script</div>
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
      card.innerHTML = '<div style="background:#071a0e;border:1px solid #166534;border-radius:8px;padding:14px 16px;display:flex;align-items:center;gap:14px;margin-bottom:0">'
        +'<span style="font-size:1.5rem">✅</span>'
        +'<div style="flex:1"><div style="color:#4ade80;font-weight:700;font-size:.9rem">Pre-built bitstream available</div>'
        +'<div style="font-size:.75rem;color:#64748b;margin-top:2px">'+sz+' &middot; '+fw+(dt?' &middot; built '+dt:'')+'</div></div>'
        +'<a href="/dl/wukong-bit" style="padding:.4rem 1rem;background:#166534;border-radius:5px;color:#4ade80;text-decoration:none;font-size:.82rem;font-weight:700;white-space:nowrap">&#x2B07; Download .bit</a>'
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
  <div><span class="file">BUILD.md</span><span class="note"> — full instructions</span></div>
</div>

<div class="box-title">&#x26A1; Flash the pre-built bitstream</div>
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
      <strong>Flash the board</strong>
      <pre>openFPGALoader church_wukong_xc7a100t.bit</pre>
      <p>Download the pre-built <code>.bit</code> from the card above (when available).</p>
      <p class="alt">Or via Vivado: <strong>Hardware Manager</strong> → Open target → Auto Connect → Program Device → select the <code>.bit</code>.</p>
    </div>
  </div>
  <div class="step">
    <div class="step-num">3</div>
    <div class="step-body">
      <strong>Power-cycle the board</strong>
      <p>Unplug and re-plug the USB cable. The board stores the bitstream permanently.</p>
    </div>
  </div>
  <div class="step">
    <div class="step-num">4</div>
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
        "instruction_matrix.md",
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
        {"type": "figure", "name": "Lumps Directory.html", "label": "Lump Viewer"},
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
            if isinstance(item, dict):
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
                payload["boot_id"] = data.get("bootId")
                payload["local_version"] = BUILD_VERSION
                payload["in_sync"] = (data.get("version") == BUILD_VERSION)
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

Vivado project files for the QMTECH Wukong (Artix-7 XC7A100T-1FGG676C).
Synthesise on any machine with Vivado 2020.x or later (WebPACK edition — free).

### Files
- `church_wukong_xc7a100t.v`  — Church Machine Verilog (Amaranth → Yosys)
- `church_wukong_xc7a100t.il` — Amaranth RTLIL (authoritative source)
- `wukong_xc7a100t.xdc`       — Vivado XDC pin constraints
- `wukong_xc7a100t.tcl`       — Vivado project creation + build script
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

Open Vivado Hardware Manager → Connect → Open Target → Program Device →
select `church_wukong_xc7a100t.bit`.

Requires a JTAG adapter (Digilent JTAG-HS2 or compatible) connected
to the Wukong board's 14-pin JTAG header.

## Expected LED Behaviour After Programming

- D1 (J4): solid ON during boot (~microseconds), then blinks ~1 Hz
- D2 (H6): 1 Hz heartbeat during boot, then OFF (lit = fault latched)
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
        for key in ('xdc', 'tcl'):
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
    """Decode a 32-bit Golden Token word.

    GT layout (mirrors simulator.js parseGT):
      [31]=b_flag  [30:28]=perm3  [27]=dom  [26]=spare  [25]=f_flag
      [24:23]=gt_type  [22:16]=gt_seq  [15:0]=ns_index
    """
    gt32 = int(gt32) & 0xFFFFFFFF
    if gt32 == 0:
        return {"null": True, "gt_word": "0x00000000", "ns_index": 0,
                "perms": "", "gt_type": "NULL"}
    ns_index = gt32 & 0xFFFF
    gt_type  = (gt32 >> 23) & 0x3
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
    from lump_integrity import check_lump_canonical_integrity as _check_lump_canonical_integrity
except ImportError:
    # Fallback: try with server package prefix (when imported as a sub-module)
    from server.lump_integrity import check_lump_canonical_integrity as _check_lump_canonical_integrity


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
    lumps_dir = os.path.join(os.path.dirname(__file__), 'lumps')
    if not os.path.isdir(lumps_dir):
        return
    for path in sorted(_glob.glob(os.path.join(lumps_dir, '*.lump'))):
        stem = os.path.splitext(os.path.basename(path))[0].lower()
        token8 = stem.zfill(8)[:8]
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
    """Build rich NS-entry list from boot-image.bin + manifest (cold-start fallback).

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

        # Build slot→name from manifest ns_slot fields.
        _slot_names = {}
        _mf = os.path.join(LUMPS_DIR, "manifest.json")
        try:
            with open(_mf) as _mf_fh:
                _mf_entries = json.load(_mf_fh)
            for _me in (_mf_entries if isinstance(_mf_entries, list) else []):
                _ms = _me.get("ns_slot")
                _mn = _me.get("abstraction")
                if isinstance(_ms, int) and isinstance(_mn, str) and _mn:
                    _slot_names.setdefault(_ms, _mn)
        except Exception:
            pass

        # Hardware boot catalog names for fixed slots (fallback when not in manifest).
        _HW_CATALOG = {
            0: "Boot.NS", 1: "Boot.Thread",
            2: "UART_DEV", 3: "LED_DEV", 4: "BTN_DEV", 5: "TIMER_DEV",
            6: "SelfTest", 7: "WukongCallHome",
            8: "Tunnel", 9: "Ethernet", 10: "CapabilityTest",
        }

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
            _typ = _GT_TYPE_NAMES.get(_r["gt_type"], "Inform")
            _lim = _r["limit17"]
            _seq = _r["seq"]
            _seal = _r["seal"]
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
# synthesis detail owned by boot_image.py (via manifest ns_slot fields) and
# are NOT stored here.

def _derive_ns_state_names():
    """Build ordered dot-name list from manifest.json ns_slot fields (cold-start fallback)."""
    _out = {}   # slot → name (collect then sort for stable ordering)
    _mf  = os.path.join(LUMPS_DIR, "manifest.json")
    if not os.path.isfile(_mf):
        return []
    try:
        with open(_mf) as _fh:
            _entries = json.load(_fh)
        for _e in (_entries if isinstance(_entries, list) else []):
            _slot = _e.get("ns_slot")
            _name = _e.get("abstraction")
            if isinstance(_slot, int) and isinstance(_name, str) and _name:
                _out[_slot] = _name
    except Exception:
        pass
    return [_out[k] for k in sorted(_out)]


def _wukong_lump_name_for_slot(slot):
    """Return the abstraction name for NS *slot* from ns-state.json or manifest."""
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
    try:
        _mf = os.path.join(LUMPS_DIR, 'manifest.json')
        with open(_mf) as _fh:
            _entries = json.load(_fh)
        for _e in (_entries if isinstance(_entries, list) else []):
            if _e.get('ns_slot') == slot:
                _n = _e.get('abstraction')
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


def _read_boot_entry_name_from_image():
    """Return the boot-entry abstraction dot-name derived from the binary sentinel + manifest."""
    _slot = _read_boot_entry_slot_from_image()
    if _slot is None:
        return None
    _mf = os.path.join(LUMPS_DIR, "manifest.json")
    try:
        with open(_mf) as _fh:
            _entries = json.load(_fh)
        for _e in (_entries if isinstance(_entries, list) else []):
            if _e.get("ns_slot") == _slot:
                return _e.get("abstraction") or None
    except Exception:
        pass
    return None

def _write_ns_state(entries):
    """Write ns-state.json atomically — rich list of NS row objects."""
    import time as _tm_ns
    _state = {
        "abstractions": list(entries or []),
        "generated_at": _tm_ns.time(),
    }
    _tmp = NS_STATE_PATH + ".tmp"
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

def _migrate_sidecars_drop_group_doc_refs():
    """One-pass idempotent migration (Lump V1.3): remove the removed curatorial
    fields 'group' and 'doc_refs' from every live sidecar JSON in server/lumps/.

    V1.3 removed these fields from the sidecar schema — the binary is the sole
    source of truth and the sidecar carries no curatorial fields.  Runs at
    startup; a clean catalogue is a no-op.  In debug mode a leftover key after
    migration is treated as an assertion failure.
    """
    lumps_dir = os.path.join(os.path.dirname(__file__), 'lumps')
    if not os.path.isdir(lumps_dir):
        return
    cleaned = 0
    for fn in sorted(os.listdir(lumps_dir)):
        if not fn.endswith('.json') or fn == 'manifest.json':
            continue
        path = os.path.join(lumps_dir, fn)
        try:
            with open(path) as fh:
                data = json.load(fh)
        except Exception:
            continue  # non-object / unreadable sidecars are out of scope here
        if not isinstance(data, dict):
            continue
        if 'group' in data or 'doc_refs' in data:
            data.pop('group', None)
            data.pop('doc_refs', None)
            _atomic_write_json(path, data)
            cleaned += 1
            print(f'[lumps-migrate] removed group/doc_refs from {fn}', flush=True)
        if app.debug:
            assert 'group' not in data and 'doc_refs' not in data, (
                f'sidecar {fn} still carries group/doc_refs after V1.3 migration'
            )
    if cleaned:
        print(f'[lumps-migrate] V1.3 sidecar cleanup: {cleaned} file(s) cleaned',
              flush=True)


_migrate_sidecars_drop_group_doc_refs()


def _load_boot_abstr_lump():
    """Parse boot-image.bin, extract Boot.Abstr (NS slot 6) and cache in LAZY_LUMPS.

    boot-image.bin is stored little-endian (matching validate_boot_image / simulator.js).
    The extracted word array is re-packed big-endian for LAZY_LUMPS, matching the
    convention used by all other *.lump files and the get_lump_words endpoint.
    """
    boot_path = os.path.join(os.path.dirname(__file__), 'lumps', 'boot-image.bin')
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
        BOOT_ABSTR_NS_SLOT = 6  # Task #1918: Boot.Abstr/SelfTest at slot 6 (was slot 3)
        boot_ns_base = ns_table_base + BOOT_ABSTR_NS_SLOT * NS_ENTRY_WORDS
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
        LAZY_LUMPS['00000600'] = _struct.pack(f'>{lump_size}I', *lump_words)
        _BOOT_ABSTR_META.update({
            "token":       "00000600",
            "abstraction": "SelfTest",
            "ns_slot":     BOOT_ABSTR_NS_SLOT,
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
        # Manifest override: if manifest.json names a canonical file for token
        # 00000600 (the compiled SelfTest binary), prefer it over the boot-image
        # stub (which is just a lazy placeholder with cw=0, cc=0).  The manifest
        # file IS the real SelfTest code; the stub in boot-image.bin merely marks
        # the slot reserved so the boot ROM can lazy-load it on demand.
        _lumps_dir_mo = os.path.join(os.path.dirname(__file__), 'lumps')
        _mf_mo_path = os.path.join(_lumps_dir_mo, 'manifest.json')
        _canonical_loaded = False
        if os.path.isfile(_mf_mo_path):
            try:
                with open(_mf_mo_path) as _mf_mo_f:
                    _mf_mo = json.load(_mf_mo_f)
                for _me_mo in _mf_mo:
                    if _me_mo.get('token') == '00000600':
                        _fn_mo = _me_mo.get('filename', '')
                        _np_mo = os.path.join(_lumps_dir_mo, _fn_mo) if _fn_mo else ''
                        if _fn_mo and os.path.isfile(_np_mo):
                            with open(_np_mo, 'rb') as _fh_mo:
                                _d_mo = _fh_mo.read()
                            _n_mo = len(_d_mo) // 4
                            if _n_mo >= 1:
                                _h_mo = _struct.unpack('>I', _d_mo[:4])[0]
                                if (_h_mo >> 27) & 0x1F == 0x1F:
                                    LAZY_LUMPS['00000600'] = _d_mo
                                    LAZY_LUMPS['600'] = _d_mo
                                    _cw_mo  = (_h_mo >> 10) & 0x1FFF
                                    _cc_mo  = _h_mo & 0xFF
                                    _ls_mo  = 1 << (((_h_mo >> 23) & 0xF) + 6)
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
                                    print(f'[boot] SelfTest canonical binary loaded: {_fn_mo} '
                                          f'cw={_cw_mo} cc={_cc_mo}', flush=True)
                        # Merge sidecar annotation fields from the manifest-designated sidecar
                        _sc_mo_file = _me_mo.get('sidecar_file', '')
                        _sc_mo_path = os.path.join(_lumps_dir_mo, _sc_mo_file) if _sc_mo_file else ''
                        if _sc_mo_path and os.path.isfile(_sc_mo_path):
                            try:
                                with open(_sc_mo_path) as _sc_mo_f:
                                    _sc_mo = json.load(_sc_mo_f)
                                for _fld in ('author', 'version', 'pet_names', 'capabilities',
                                             'description', 'methods'):
                                    if _fld in _sc_mo and _sc_mo[_fld] is not None:
                                        _BOOT_ABSTR_META[_fld] = _sc_mo[_fld]
                                _BOOT_ABSTR_META['has_source'] = bool(
                                    (_sc_mo.get('source', '') or '').strip()
                                )
                            except Exception:
                                pass
                        break
            except Exception as _e_mo:
                print(f'[boot] manifest override for 00000600 failed: {_e_mo}', flush=True)
        if not _canonical_loaded:
            # Fall back to annotation-only merge from legacy sidecar files
            _lumps_dir_sc = os.path.dirname(__file__)
            _sidecar_003 = os.path.join(_lumps_dir_sc, 'lumps', '00000003.json')
            if os.path.isfile(_sidecar_003):
                try:
                    with open(_sidecar_003) as _s03f:
                        _s03 = json.load(_s03f)
                    for _f03 in ('author', 'version', 'pet_names', 'capabilities'):
                        if _f03 in _s03:
                            _BOOT_ABSTR_META[_f03] = _s03[_f03]
                except Exception:
                    pass
    except Exception as exc:
        print(f'[boot] Failed to extract Boot.Abstr lump: {exc}', flush=True)

_load_boot_abstr_lump()


def _load_boot_ns_lump():
    """Parse boot-image.bin, extract Boot.NS (NS slot 0) metadata and cache in _BOOT_NS_META.

    Boot.NS (typ=1, Namespace LUMP) lives at word[0] of the image.  We extract its
    header and walk the NS table to build the namespace_meta.entries array that the
    Lump Repository panel uses to render the SVG dependency graph and NS Table view.
    """
    boot_path = os.path.join(os.path.dirname(__file__), 'lumps', 'boot-image.bin')
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

    # Accept 96-bit (24-hex) tokens: compare against word0_location (first 8 chars).
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

    Accepts both 8-hex (32-bit) and 24-hex (96-bit IDE) tokens.  For 96-bit
    tokens the first 8 hex chars encode word0_location (the lump identity);
    the remaining 16 chars carry word1_limit and word2_seals from the NS entry
    and are used only for cross-validation in the library fallback.

    §8 answer (GT v2.0 spec open question): Content verifiability.
    The response includes both a CRC-32 preamble word (prepended to the payload
    by _lump_with_crc) for corruption detection and an X-Lump-Hash: sha256:<hex>
    response header carrying the SHA-256 of the raw lump bytes (before CRC prefix).
    The caller can verify the lump is authentic by computing sha256(raw_lump_bytes)
    and comparing against the X-Lump-Hash header value.
    """
    from flask import Response
    # 96-bit IDE token = 24 hex chars (word0||word1||word2 of NS Outform entry).
    # Extract word0_location (first 8 chars) as the canonical lump identity key.
    raw    = token_hex.lower()
    lump_id = raw[:8] if len(raw) >= 8 else raw
    key    = lump_id.lstrip('0') or '0'
    key8   = lump_id.zfill(8)

    data   = LAZY_LUMPS.get(key) or LAZY_LUMPS.get(key8)
    source = 'local'

    if data is None:
        # Fall back to the Mum Tunnel Library
        data, lib_name = _fetch_lump_from_library(token_hex)
        if data is not None:
            LAZY_LUMPS[key8] = data           # cache for future requests
            source = f'library:{lib_name}'
        else:
            github_hint = '' if (GITHUB_TOKEN and GITHUB_LIBRARY_REPO) else \
                          ' (GitHub not configured — Mum Tunnel Library unavailable)'
            return jsonify({"error": f"Unknown lump token 0x{key8}{github_hint}"}), 404

    # ── Canonical integrity check — fail-closed for canonical manifest entries ──
    # Entries with a dot_name MUST pass hash validation before bytes are served.
    # Returns None (legacy / library / unknown — serve freely), True (OK),
    # or an error string (→ 409, no skip path).
    _gl_lumps_dir = os.path.join(os.path.dirname(__file__), 'lumps')
    _gl_integrity = _check_lump_canonical_integrity(_gl_lumps_dir, key8, data)
    if isinstance(_gl_integrity, str):
        return jsonify({"error": _gl_integrity}), 409

    import hashlib as _hashlib_lump
    payload = _lump_with_crc(data)
    lump_sha256 = _hashlib_lump.sha256(data).hexdigest()
    resp = Response(payload, mimetype='application/octet-stream',
                    headers={'Content-Length': str(len(payload)),
                             'X-Lump-Source': source,
                             'X-Lump-Hash': f'sha256:{lump_sha256}'})
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

    lumps_dir = os.path.join(os.path.dirname(__file__), 'lumps')
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


@app.route("/api/lumps/save", methods=["POST"])
def save_lump():
    """Save a compiled LUMP binary + metadata sidecar to server/lumps/.

    Expects JSON body with:
      binary   — array of uint32 words (big-endian will be packed server-side)
      metadata — object with abstraction name, methods, pet names, MTBF,
                 deployment info, capabilities, etc.
    Returns the token and saved file paths.
    """
    import datetime as _dt
    payload = request.get_json(force=True, silent=True)
    if not payload:
        return jsonify({"error": "Invalid JSON payload"}), 400

    words    = payload.get("binary", [])
    metadata = payload.get("metadata", {})

    if not words or len(words) < 2:
        return jsonify({"error": "Binary must contain at least a header and one code word"}), 400

    hdr = int(words[0]) & 0xFFFFFFFF
    if (hdr >> 27) & 0x1F != 0x1F:
        return jsonify({"error": "Bad lump magic in header word"}), 400

    hdr_typ = (hdr >> 8) & 0x3
    _ct_default_map = {0: 'code', 1: 'data', 2: 'thread', 3: 'outform'}
    content_type = metadata.get("content_type") or _ct_default_map.get(hdr_typ, 'binary')

    abs_name     = metadata.get("abstraction", "Unnamed")
    ns_slot      = metadata.get("ns_slot", None)
    token_hint   = metadata.get("token", None)
    _petname     = str(metadata.get("petname", "")).strip()
    _issue_number = int(metadata.get("issue_number", 1) or 1)

    import re as _re
    if token_hint:
        token8 = str(token_hint).lower().zfill(8)[:8]
    elif ns_slot is not None:
        token8 = f"{int(ns_slot) << 8:08x}"
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

    # ── SelfTest canonical E-GT guard (token 00000600) ───────────────────────
    # Token 00000600 is the canonical SelfTest lump whose c-list[0] must equal
    # 0x4A000006 — the SelfTest E-GT (Church domain, E permission, NS slot 6).
    # This value is asserted at module-load time by hardware/boot_rom.py, so a
    # corrupt save is only discovered on the next server restart (when the whole
    # IDE fails to launch).  Flag it early here before any file is touched.
    #
    # NOTE: The self-GT identity-seal injection below does NOT apply to this
    # token because c-list[0] is the hardware-specified E-GT, not a petname
    # identity seal.  The two concepts are distinct; mixing them corrupts the
    # boot binary.
    _SELFTEST_CANONICAL_TOKEN  = '00000600'
    _SELFTEST_EXPECTED_EGT     = 0x4A000006  # Inform E-GT, NS slot 6, Church domain
    _is_selftest_canonical = (token8 == _SELFTEST_CANONICAL_TOKEN)

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

    # Self Inform GT: bits[31:25] = 0b0000_101 (dom=1, gt_type=Inform, perm=0),
    # bits[24:0] = low 25 bits of sha256(identity_string).
    _id_hash_int = int(_identity_hash[:8], 16)
    _self_gt     = (0x0A000000 | (_id_hash_int & 0x1FFFFFF)) & 0xFFFFFFFF

    # Build the word array. The canonical SelfTest guard below runs BEFORE the
    # cc=0→1 auto-rewrite so the rewrite cannot be used as a bypass.
    _sl_words = [int(w) & 0xFFFFFFFF for w in words]
    _sl_hdr   = _sl_words[0]
    _sl_cc2   = _sl_hdr & 0xFF
    _sl_lsz   = 1 << (((_sl_hdr >> 23) & 0xF) + 6)
    _declared_caps_raw = metadata.get("capabilities", [])
    if _declared_caps_raw is None:
        _declared_caps_raw = []
    if not isinstance(_declared_caps_raw, list):
        return jsonify({
            "error": "Capability validation failed: metadata.capabilities must be an array.",
            "capability_validation_failed": True,
        }), 422
    _has_declared_caps = len(_declared_caps_raw) > 0
    _validated_declared_caps = []

    # ── SelfTest canonical layout guard (ALL token 00000600 saves) ───────────
    # Runs BEFORE the cc=0→1 auto-rewrite so the rewrite cannot be used to
    # bypass the cc check.  The canonical SelfTest binary is invariant:
    #
    #   lump_size = 512 words   (n_minus_6 = 3, asserted by boot_rom.py:656)
    #   cc        = 2           (asserted by boot_rom.py:656)
    #   word[510] = 0x4A000006  (c-list[0] E-GT, asserted by boot_rom.py:658)
    #
    # ALL saves of token 00000600 are subject to this guard — including those
    # that declare a non-512-word lump_size in the header.  A non-512-word save
    # with this token silently bypasses both the self-GT injection and all
    # layout checks, then updates the manifest/canonical-compatibility chain,
    # so the IDE server cannot boot on next restart.
    # word[510] is checked at the fixed hardware-asserted index (not via
    # lump_size−cc) so the check is immune to a wrong cc pointing the cursor
    # elsewhere.
    if _is_selftest_canonical:
        # ── Step 1: exact array-length check (BEFORE header decode or padding) ──
        # The submitted word array must contain exactly 512 entries.  Checking
        # the raw array length catches oversized payloads (e.g. 513 words) that
        # carry a valid 512-word header but extra trailing words: those words
        # would be serialized to disk and produce a >2048-byte file that
        # hardware/boot_rom.py's `struct.unpack(">512I", raw)` rejects on the
        # next server start, breaking IDE boot.
        if len(_sl_words) != 512:
            return jsonify({
                "error": (
                    f"SelfTest size guard: token 00000600 requires exactly 512 "
                    f"entries in the submitted word array ({512 * 4} bytes on disk); "
                    f"got {len(_sl_words)} entries. "
                    f"Re-compile from the canonical SelfTest source."
                ),
                "selftest_size_mismatch": True,
                "expected_lump_size":     512,
                "actual_lump_size":       len(_sl_words),
            }), 422
        # ── Step 2: header-declared lump_size ────────────────────────────────────
        # The header must also declare 512 words (n_minus_6=3).  A 512-entry
        # array with a 64-word header (n_minus_6=0) would write 512 words to disk
        # but claim to be a 64-word lump — incoherent and rejected.
        if _sl_lsz != 512:
            return jsonify({
                "error": (
                    f"SelfTest layout guard: token 00000600 must declare "
                    f"lump_size=512 in the header (n_minus_6=3, asserted by "
                    f"hardware/boot_rom.py line 656); header declares {_sl_lsz} words. "
                    f"Re-compile from the canonical SelfTest source."
                ),
                "selftest_size_mismatch": True,
                "expected_lump_size":     512,
                "actual_lump_size":       _sl_lsz,
            }), 422
        # ── Step 3: cc must equal the canonical value ─────────────────────────
        _SELFTEST_CANONICAL_CC = 2
        if _sl_cc2 != _SELFTEST_CANONICAL_CC:
            return jsonify({
                "error": (
                    f"SelfTest layout guard: canonical SelfTest lump (token 00000600) "
                    f"must have cc={_SELFTEST_CANONICAL_CC} in the header "
                    f"(asserted by hardware/boot_rom.py line 656); "
                    f"incoming binary has cc={_sl_cc2}. "
                    f"Submitting cc=0 to trigger the auto-rewrite is not permitted "
                    f"for this token. "
                    f"Re-compile from the canonical SelfTest source."
                ),
                "selftest_cc_mismatch": True,
                "expected_cc":          _SELFTEST_CANONICAL_CC,
                "actual_cc":            _sl_cc2,
            }), 422
        # ── Step 4: word[510] must be the hardware-asserted E-GT ─────────────
        # Array length is exactly 512 (verified in Step 1), so word[510] is safe
        # to access directly without padding or bounds checks.
        _st_w510 = _sl_words[510]
        if _st_w510 != _SELFTEST_EXPECTED_EGT:
            return jsonify({
                "error": (
                    f"SelfTest E-GT guard: canonical SelfTest lump (token 00000600) "
                    f"must have word[510] = 0x{_SELFTEST_EXPECTED_EGT:08X} "
                    f"(SelfTest E-GT — Inform, Church domain, E permission, NS slot 6; "
                    f"asserted by hardware/boot_rom.py line 658). "
                    f"Incoming binary has 0x{_st_w510:08X} at word[510]. "
                    f"Re-compile from the canonical SelfTest source to restore it."
                ),
                "selftest_egt_mismatch": True,
                "expected_egt":          _SELFTEST_EXPECTED_EGT,
                "actual_word_510":       _st_w510,
                "word_index":            510,
            }), 422

    if _sl_cc2 == 0 and not _has_declared_caps:
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

    # Older binaries can reserve several all-zero c-list rows before the
    # server writes the legacy identity seal at row 0. Preserve that inert
    # format, but reject any nonzero undeclared row: it would otherwise carry
    # an unchecked Golden Token (including B-set or pending placeholders).
    if not _has_declared_caps and _sl_cc2 > 1:
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
    if _has_declared_caps:
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

    # Inject the self-GT identity seal at c-list[0].
    # Skipped for token 00000600: its c-list[0] is the hardware-asserted SelfTest
    # E-GT (validated above) and must not be overwritten with the petname seal.
    # Also skipped when c-list rows belong to declared capabilities; in that
    # case identity_string + identity_hash are the canonical metadata seal.
    if not _is_selftest_canonical and not _has_declared_caps:
        if 0 < _clist_row0_idx < len(_sl_words):
            _sl_words[_clist_row0_idx] = _self_gt

        # Verify the injection landed before touching any file on disk.
        # Two failure modes: index out of range (lump_size/cc mismatch) or future
        # code accidentally overwrites the slot.  Either way: reject, don't save.
        _actual_seal = (
            _sl_words[_clist_row0_idx]
            if 0 < _clist_row0_idx < len(_sl_words)
            else 0
        )
        if _actual_seal != _self_gt:
            return jsonify({
                "error": (
                    f"Identity seal mismatch: expected self-GT {_self_gt:#010x} "
                    f"but c-list[0] contains {_actual_seal:#010x}. "
                    f"identity_string used: {_identity_string!r}. "
                    f"The LUMP has not been saved. "
                    f"Re-compile and ensure cc >= 1 and lump_size is consistent."
                ),
                "identity_seal_mismatch": True,
                "expected_self_gt":       _self_gt,
                "actual_clist0":          _actual_seal,
                "identity_string":        _identity_string,
            }), 422

    # Pre-pack and hash the verified binary now; Phase 5 only writes it.
    import hashlib as _hl_save
    lump_bytes   = _struct.pack(f'>{len(_sl_words)}I', *_sl_words)
    _binary_hash = _hl_save.sha256(lump_bytes).hexdigest()

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

    lumps_dir = os.path.join(os.path.dirname(__file__), 'lumps')
    os.makedirs(lumps_dir, exist_ok=True)

    import re as _re_arch
    import shutil as _shutil

    # ── Helper: abstraction name → safe filename stem ─────────────────────────
    def _safe_stem(name):
        s = _re_arch.sub(r'[^\w.\-]', '_', str(name or 'lump').strip())
        s = _re_arch.sub(r'_+', '_', s).strip('_')
        return s or 'lump'

    safe_name = _safe_stem(abs_name)

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

    _existing_entry = next((e for e in manifest if e.get('token') == token8), None)
    _exist_filename = (_existing_entry or {}).get('filename', f'{token8}.lump')
    _exist_sc_file  = (_existing_entry or {}).get('sidecar_file', f'{token8}.json')
    _existing_lump  = os.path.join(lumps_dir, _exist_filename)
    _existing_sc    = os.path.join(lumps_dir, _exist_sc_file)

    # ── Phase 2: Determine current version number ──────────────────────────────
    _is_forked_save = False
    _arch_ver = None
    _arch_sc  = {}
    if os.path.isfile(_existing_lump):
        if os.path.isfile(_existing_sc):
            try:
                with open(_existing_sc, 'r') as _sfh:
                    _arch_sc = json.load(_sfh)
                _raw_ver = _arch_sc.get('lump_version')
                if _raw_ver is not None:
                    _arch_ver = int(_raw_ver)
            except Exception:
                pass
        if _arch_sc.get('forked'):
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
    if _is_forked_save and _arch_ver is not None:
        next_lump_version = _arch_ver
    elif _arch_ver is not None:
        next_lump_version = _arch_ver + 1
    else:
        existing_versions_for_abs = [
            int(e.get("lump_version", 0))
            for e in manifest
            if e.get("abstraction") == abs_name
            and e.get("lump_version") is not None
            and e.get("token") != token8
        ]
        next_lump_version = (max(existing_versions_for_abs) + 1) if existing_versions_for_abs else 1

    # ── Canonical filename derivation ─────────────────────────────────────────
    # All new saves use Dot.Name.issue_n.Number.lump format.
    # Number = sha256(dot_name_utf8 + lump_bytes)[:8]; includes dot_name so
    # identical code compiled under different names produces different Numbers.
    from lump_integrity import to_dot_name as _to_dot_name, compute_number as _compute_number
    _dot_name_save = _to_dot_name(abs_name)
    _issue_n_save  = int((_existing_entry or {}).get('issue_n', 1) or 1)
    _number_save   = _compute_number(_dot_name_save, lump_bytes)

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
    sidecar_filename = f'{_dot_name_save}.{_issue_n_save}.{_number_save}.json'
    lump_path        = os.path.join(lumps_dir, lump_filename)
    sidecar_path     = os.path.join(lumps_dir, sidecar_filename)

    # Containment check — must follow path construction so realpath can resolve
    for _chk_path, _chk_label in ((lump_path, 'lump'), (sidecar_path, 'sidecar')):
        if not os.path.realpath(_chk_path).startswith(_lumps_dir_real + os.sep):
            return jsonify({'error':
                f'Path traversal detected in {_chk_label} filename — '
                f'canonical name resolves outside server/lumps/'}), 400

    # ── Phase 4: Archive existing binary with human-readable name ─────────────
    if os.path.isfile(_existing_lump) and not _is_forked_save:
        _arch_lump_fn   = f'{safe_name}_v{_arch_ver}.lump'
        _arch_sc_fn     = f'{safe_name}_v{_arch_ver}.json'
        _arch_lump_path = os.path.join(lumps_dir, _arch_lump_fn)
        _arch_sc_path   = os.path.join(lumps_dir, _arch_sc_fn)
        if os.path.abspath(_existing_lump) != os.path.abspath(_arch_lump_path):
            _shutil.copy2(_existing_lump, _arch_lump_path)
            _arch_sc_out = dict(_arch_sc)
            _arch_sc_out['archived_version'] = _arch_ver
            with open(_arch_sc_path, 'w') as _afh:
                json.dump(_arch_sc_out, _afh, indent=2)
            # Migration: delete old token-named file once safely copied to readable name
            if _exist_filename == f'{token8}.lump':
                try:
                    os.remove(_existing_lump)
                    if os.path.isfile(_existing_sc) and _exist_sc_file == f'{token8}.json':
                        os.remove(_existing_sc)
                except OSError:
                    pass
        print(f'[lumps] Archived {_exist_filename} → {_arch_lump_fn}', flush=True)

        # ── Prune oldest archives beyond LUMP_MAX_ARCHIVE_VERSIONS ────────────
        _all_arc = []
        for _fn in (os.listdir(lumps_dir) if os.path.isdir(lumps_dir) else []):
            for _pp in [
                _re_arch.compile(rf'^{_re_arch.escape(safe_name)}_v(\d+)\.lump$'),
                _re_arch.compile(rf'^{_re_arch.escape(token8)}-v(\d+)\.lump$'),
            ]:
                _pm = _pp.match(_fn)
                if _pm:
                    _all_arc.append((int(_pm.group(1)), _fn))
        _all_arc.sort()
        _excess = len(_all_arc) - LUMP_MAX_ARCHIVE_VERSIONS
        if _excess > 0:
            for _, _old_fn in _all_arc[:_excess]:
                _old_lump = os.path.join(lumps_dir, _old_fn)
                _old_json = os.path.join(lumps_dir, _old_fn[:-5] + '.json')
                try:
                    os.remove(_old_lump)
                    logging.info('[lumps] Pruned old archive %s', _old_fn)
                except OSError as _e:
                    logging.warning('[lumps] Could not prune %s: %s', _old_fn, _e)
                try:
                    if os.path.isfile(_old_json):
                        os.remove(_old_json)
                        logging.info('[lumps] Pruned old archive sidecar %s', _old_json)
                except OSError as _e:
                    logging.warning('[lumps] Could not prune sidecar %s: %s', _old_json, _e)

    # ── Phase 5: Write pre-verified binary ────────────────────────────────────
    # lump_bytes, _binary_hash, _identity_string, _identity_hash, and _self_gt
    # were all computed and seal-verified in the pre-flight block above, before
    # any filesystem mutation took place.
    with open(lump_path, 'wb') as fh:
        fh.write(lump_bytes)

    LAZY_LUMPS[token8] = lump_bytes
    LAZY_LUMPS[token8.lstrip('0') or '0'] = lump_bytes

    # ── Backward-compat symlink ───────────────────────────────────────────────
    # If a previous canonical file existed under a different Number (because the
    # binary changed), replace it with a symlink to the new canonical name so
    # any cached URL for the old Number still resolves during the transition.
    if (_exist_filename and _exist_filename != lump_filename):
        _old_compat = os.path.join(lumps_dir, _exist_filename)
        if os.path.isfile(_old_compat) and not os.path.islink(_old_compat):
            try:
                os.remove(_old_compat)
                os.symlink(lump_filename, _old_compat)
                print(f'[lumps] Backward-compat symlink: {_exist_filename} → {lump_filename}',
                      flush=True)
            except OSError as _e:
                logging.warning('[lumps] Backward-compat symlink %s→%s failed: %s',
                                _exist_filename, lump_filename, _e)

    # ── Phase 6: Build and write sidecar JSON ─────────────────────────────────
    sidecar = {
        "token":         token8,
        "abstraction":   abs_name,
        "filename":      lump_filename,
        "sidecar_file":  sidecar_filename,
        "ns_slot":       ns_slot,
        "lump_size":     len(_sl_words),
        "typ":           hdr_typ,
        "content_type":  content_type,
        # Use values read directly from the verified binary header — never the
        # client-supplied metadata, which can be stale or zero even when the
        # binary has real instructions.
        "cw":            _binary_cw,
        "cc":            _binary_cc,
        "profile":       metadata.get("profile", "IoT"),
        "language":      metadata.get("language", "unknown"),
        "author":        metadata.get("author", ""),
        "version":       metadata.get("version", ""),
        "release_notes": metadata.get("release_notes", ""),
        "methods":       metadata.get("methods", []),
        "capabilities":  (
            _validated_declared_caps
            if _has_declared_caps
            else metadata.get("capabilities", [])
        ),
        "pet_names": {
            "DR": metadata.get("pet_names_dr", {}),
            "CR": metadata.get("pet_names_cr", {})
        },
        "mtbf": {
            "consecutive_clean": metadata.get("mtbf_clean_runs", 0),
            "total_runs":        metadata.get("mtbf_total_runs", 0),
            "status":            metadata.get("mtbf_status", "unknown"),
            "source_hash":       metadata.get("source_hash", "")
        },
        "deployment": {
            "target_board": metadata.get("target_board", "wukong-xc7a100t"),
            "profile":      metadata.get("profile", "IoT"),
            "built_at":     _dt.datetime.utcnow().isoformat() + "Z",
            "builder":      "CLOOMC++ IDE v1.0"
        },
        "grants": metadata.get("grants", ["E"]),
        "source":        metadata.get("source", ""),
        "binary_hash":   _binary_hash,
        "petname":         _petname,
        "issue_number":    _issue_number,
        "identity_string": _identity_string,
        "identity_hash":   _identity_hash,
        "identity_seal_location": (
            "sidecar"
            if _has_declared_caps
            else ("canonical-c-list" if _is_selftest_canonical else "c-list[0]")
        ),
        "dot_name":        _dot_name_save,
        "issue_n":         _issue_n_save,
    }

    import time as _time_save
    _compiled_at = _time_save.time()
    sidecar["lump_version"] = next_lump_version
    sidecar["compiled_at"]  = _compiled_at

    # V1.3: derive sourceStorageTier from the binary's freespace content
    # header (word cw+1), read back from the bytes just written.  Absent =
    # legacy (all-zero freespace, not self-defining).
    _fs_save = _lump_freespace_content(
        list(_struct.unpack(f'>{len(lump_bytes) // 4}I', lump_bytes)))
    if _fs_save is not None:
        sidecar["sourceStorageTier"] = _fs_save["tier"]

    with open(sidecar_path, 'w') as fh:
        json.dump(sidecar, fh, indent=2)

    # ── Phase 7: Update manifest (serialised) ─────────────────────────────────
    # Re-read manifest.json inside the lock so any concurrent save that wrote
    # between Phase 1 and now is not silently discarded.
    new_entry = {
        "token":         token8,
        "abstraction":   abs_name,
        "filename":      lump_filename,
        "sidecar_file":  sidecar_filename,
        # ns_slot intentionally omitted from new entries — ns-state.json is now
        # the authoritative slot→token map; existing entries left as-is.
        "lump_size":     len(_sl_words),  # padded size (matches on-disk file)
        "cw":            sidecar["cw"],
        "cc":            sidecar["cc"],
        "author":        sidecar.get("author", ""),
        "version":       sidecar.get("version", ""),
        "lump_version":  next_lump_version,
        "compiled_at":   _compiled_at,
        "methods":       sidecar["methods"],
        "grants":        sidecar["grants"],
        "binary_hash":   _binary_hash,
        "petname":       _petname,
        "issue_number":  _issue_number,
        "identity_hash": _identity_hash,
        "dot_name":      _dot_name_save,
        "issue_n":       _issue_n_save,
    }

    # Test hook: fires after all per-token I/O (Phase 5/6) but before the lock.
    # In production this is always None.  Tests set it to synchronise threads
    # so both have read the manifest (Phase 1) before either enters Phase 7.
    if _lumps_manifest_pre_write_hook is not None:
        _lumps_manifest_pre_write_hook()  # noqa: not-callable — callable at runtime

    with _lumps_manifest_lock:
        # Fresh read under lock — picks up any entry written by a concurrent save.
        try:
            _locked_manifest = _read_manifest_safe(manifest_path)
        except ValueError as _mf_lock_err:
            return jsonify({"error": (
                "manifest.json is corrupt and cannot be read safely. "
                "The save has been aborted to prevent overwriting previously-saved LUMPs. "
                f"Details: {_mf_lock_err}"
            )}), 500

        _locked_manifest = [e for e in _locked_manifest if e.get('token') != token8]

        vg_key = f"compiled_{abs_name.lower().replace(' ', '_')}"
        if ns_slot is not None:
            for prev_entry in _locked_manifest:
                if (prev_entry.get("abstraction") == abs_name
                        and prev_entry.get("ns_slot") == ns_slot
                        and not prev_entry.get("variant_group")):
                    prev_entry["variant_group"] = vg_key

        _locked_manifest.append(new_entry)

        _atomic_write_json(manifest_path, _locked_manifest)

    print(f'[lumps] Saved {lump_filename} ({len(lump_bytes)} bytes) + {sidecar_filename}', flush=True)

    # ── Auto-regenerate boot-image.bin ────────────────────────────────────────
    # If boot-image.bin already exists and a boot config is present, regenerate
    # it so the saved lump is persisted across server reboots.  Failures are
    # non-fatal — the lump is safely on disk regardless.
    boot_refreshed = False
    boot_refresh_note = None
    if os.path.isfile(BOOT_IMAGE_PATH):
        try:
            cfg_bi, err_bi = _read_saved_boot_config()
            if not err_bi:
                blob_bi = _boot_image_gen.generate_boot_image(cfg_bi, LUMPS_DIR)
                with open(BOOT_IMAGE_PATH, 'wb') as _bif:
                    _bif.write(blob_bi)
                boot_refreshed = True
                print(f'[lumps] boot-image.bin regenerated ({len(blob_bi)} bytes)', flush=True)
                _load_boot_abstr_lump()   # refresh _BOOT_ABSTR_META / LAZY_LUMPS['00000600']
                _load_boot_ns_lump()      # refresh _BOOT_NS_META from updated boot-image.bin
            else:
                boot_refresh_note = f'boot config unavailable: {err_bi}'
        except Exception as _bie:
            boot_refresh_note = str(_bie)
            logging.warning('[lumps] boot-image.bin regeneration failed: %s', _bie)

    # ── SelfTest metadata always refreshed on token 00000600 save ────────────
    # generate_boot_image() locates the SelfTest lump via ns_slot in the
    # manifest, but new manifest entries intentionally omit ns_slot (ns-state.json
    # is authoritative for that mapping).  When regeneration fails or is skipped,
    # _load_boot_abstr_lump() is NOT called above, so _BOOT_ABSTR_META stays
    # stale and GET /api/lumps/list returns the old cw/cc.
    # Calling it unconditionally here (reads the manifest-designated lump file
    # directly, no boot-image needed) ensures the list reflects the new binary
    # immediately after every SelfTest save, regardless of boot-image outcome.
    if token8 == '00000600' and not boot_refreshed:
        _load_boot_abstr_lump()

    resp: dict = {
        "ok":             True,
        "token":          token8,
        "lump":           lump_filename,
        "lump_path":      f'server/lumps/{lump_filename}',
        "sidecar":        sidecar_filename,
        "size_bytes":     len(lump_bytes),
        "lump_version":   next_lump_version,
        "boot_image_refreshed": boot_refreshed,
        "identity_hash":  _identity_hash,
        "identity_string": _identity_string,
        "petname":        _petname,
        "issue_number":   _issue_number,
    }
    if boot_refresh_note:
        resp["boot_image_note"] = boot_refresh_note
    return jsonify(resp)

@app.route("/api/lumps/save-wip", methods=["POST"])
def save_lump_wip():
    """Save a WIP (work-in-progress) LUMP skeleton — no compiled code yet.

    Called by the /start page 'Code Edit →' button.  Creates a minimal stub
    binary (one RETURN per declared method) + a sidecar JSON with status='wip'
    and the CLOOMC++ source text embedded.  Subsequent compile-and-save will
    overwrite the live binary and clear the wip status.

    Body JSON:
      name        – abstraction name (required)
      source      – CLOOMC++ skeleton text
      description – one-line description
      methods     – [{name, desc, deps}, ...]
      token       – existing 8-hex token (optional; omit for new abstractions)

    Response: { ok, token, version, filename, sidecar }
    """
    import re as _re_wip
    import datetime as _dt_wip
    import hashlib as _hl_wip
    import shutil as _sh_wip

    payload     = request.get_json(force=True, silent=True) or {}
    abs_name    = (payload.get('name') or '').strip()
    source_text = payload.get('source', '')
    description = payload.get('description', '')
    methods_in  = payload.get('methods') or []
    token_hint  = (payload.get('token') or '').strip().lower()

    if not abs_name:
        return jsonify({'error': 'name is required'}), 400

    def _safe_stem_wip(name):
        s = _re_wip.sub(r'[^\w.\-]', '_', str(name).strip())
        return _re_wip.sub(r'_+', '_', s).strip('_') or 'lump'

    safe_name = _safe_stem_wip(abs_name)

    if token_hint and _re_wip.fullmatch(r'[0-9a-f]{8}', token_hint):
        token8 = token_hint
    else:
        token8 = _hl_wip.sha256(abs_name.encode()).hexdigest()[:8]

    # ── Load manifest ─────────────────────────────────────────────────────────
    lumps_dir     = os.path.join(os.path.dirname(__file__), 'lumps')
    os.makedirs(lumps_dir, exist_ok=True)
    manifest_path = os.path.join(lumps_dir, 'manifest.json')
    try:
        manifest = _read_manifest_safe(manifest_path)
    except ValueError as _mf_wip_err:
        return jsonify({"error": (
            "manifest.json is corrupt and cannot be read safely. "
            "The save has been aborted to prevent overwriting previously-saved LUMPs. "
            f"Details: {_mf_wip_err}"
        )}), 500

    existing_entry = next((e for e in manifest if e.get('token') == token8), None)

    # ── Determine next version ────────────────────────────────────────────────
    cur_version = None
    if existing_entry:
        v = existing_entry.get('lump_version')
        if v is not None:
            cur_version = int(v)
    if cur_version is None:
        _av = []
        for _fn in (os.listdir(lumps_dir) if os.path.isdir(lumps_dir) else []):
            for _pp in [
                _re_wip.compile(rf'^{_re_wip.escape(safe_name)}_v(\d+)\.(lump|json)$'),
                _re_wip.compile(rf'^{_re_wip.escape(token8)}-v(\d+)\.lump$'),
            ]:
                _mm = _pp.match(_fn)
                if _mm:
                    _av.append(int(_mm.group(1)))
        cur_version = max(_av) if _av else 0

    next_version     = cur_version + 1
    lump_filename    = f'{safe_name}_v{next_version}.lump'
    sidecar_filename = f'{safe_name}_v{next_version}.json'
    lump_path        = os.path.join(lumps_dir, lump_filename)
    sidecar_path     = os.path.join(lumps_dir, sidecar_filename)

    # ── Archive previous live files ───────────────────────────────────────────
    if existing_entry:
        _prev_fn  = existing_entry.get('filename',     f'{token8}.lump')
        _prev_sfn = existing_entry.get('sidecar_file', f'{token8}.json')
        _prev_lp  = os.path.join(lumps_dir, _prev_fn)
        _prev_sp  = os.path.join(lumps_dir, _prev_sfn)
        _arch_lp  = os.path.join(lumps_dir, f'{safe_name}_v{cur_version}.lump')
        _arch_sp  = os.path.join(lumps_dir, f'{safe_name}_v{cur_version}.json')
        if os.path.isfile(_prev_lp) and os.path.abspath(_prev_lp) != os.path.abspath(_arch_lp):
            _sh_wip.copy2(_prev_lp, _arch_lp)
            logging.info('[lumps] WIP archive: %s → %s', _prev_fn, f'{safe_name}_v{cur_version}.lump')
        if os.path.isfile(_prev_sp) and os.path.abspath(_prev_sp) != os.path.abspath(_arch_sp):
            _sh_wip.copy2(_prev_sp, _arch_sp)

    # ── Build stub binary ─────────────────────────────────────────────────────
    RETURN_AL = 0x1F000000   # RETURN with AL condition (matches _build_lazy_lumps)
    n_methods = max(1, len(methods_in))
    cw        = n_methods    # one RETURN stub per method
    cc        = 1            # self capability placeholder (NULL GT)
    n_m6      = 0            # 64-word lump (minimum)
    lump_size = 64

    _wip_words = [0] * lump_size
    _wip_words[0] = _pack_lump_header(n_minus_6=n_m6, cw=cw, cc=cc, typ=0)
    for _i in range(cw):
        _wip_words[1 + _i] = RETURN_AL
    # c-list slot 0 at position lump_size-1 = NULL GT placeholder
    _wip_words[lump_size - 1] = 0

    lump_bytes = _struct.pack(f'>{lump_size}I', *[int(w) & 0xFFFFFFFF for w in _wip_words])
    with open(lump_path, 'wb') as fh:
        fh.write(lump_bytes)

    # ── Build sidecar methods list ────────────────────────────────────────────
    sidecar_methods = []
    for _mi, _m in enumerate(methods_in):
        _entry = {
            'name':   (_m.get('name') or '').strip(),
            'offset': _mi,
            'length': 1,
        }
        _desc = (_m.get('desc') or '').strip()
        if _desc:
            _entry['description'] = _desc
        sidecar_methods.append(_entry)

    # ── Write sidecar JSON ────────────────────────────────────────────────────
    import datetime as _dtwip
    now_ts  = _dtwip.datetime.utcnow().timestamp()
    sidecar = {
        'token':        token8,
        'abstraction':  abs_name,
        'filename':     lump_filename,
        'sidecar_file': sidecar_filename,
        'ns_slot':      None,
        'lump_size':    lump_size,
        'typ':          0,
        'content_type': 'code',
        'cw':           cw,
        'cc':           cc,
        'status':       'wip',
        'source':       source_text,
        'description':  description,
        'methods':      sidecar_methods,
        'capabilities': [{'name': 'self', 'rights': ['E'], 'grants': ['E'], 'nsIndex': -1}],
        'pet_names':    {'DR': {}, 'CR': {}},
        'mtbf':         {'consecutive_clean': 0, 'total_runs': 0, 'status': 'unknown'},
        'lump_version': next_version,
        'compiled_at':  now_ts,
    }
    with open(sidecar_path, 'w') as fh:
        json.dump(sidecar, fh, indent=2)

    # ── Update manifest ───────────────────────────────────────────────────────
    new_entry = {
        'token':        token8,
        'abstraction':  abs_name,
        'filename':     lump_filename,
        'sidecar_file': sidecar_filename,
        'ns_slot':      None,
        'lump_size':    lump_size,
        'cw':           cw,
        'cc':           cc,
        'lump_version': next_version,
        'compiled_at':  now_ts,
        'status':       'wip',
        'methods':      sidecar_methods,
    }
    manifest = [e for e in manifest if e.get('token') != token8]
    manifest.append(new_entry)
    _atomic_write_json(manifest_path, manifest)

    # Cache binary in LAZY_LUMPS so it can be served immediately
    try:
        LAZY_LUMPS[token8] = lump_bytes
    except Exception:
        pass

    logging.info('[lumps] WIP saved: %s v%d → %s', abs_name, next_version, lump_filename)
    return jsonify({
        'ok':      True,
        'token':   token8,
        'version': next_version,
        'filename':  lump_filename,
        'sidecar':   sidecar_filename,
        'status':  'wip',
    })


@app.route("/api/lump/<token>/wip-source", methods=["PATCH"])
def patch_wip_source(token):
    """Patch the source field in a WIP sidecar JSON.

    Called by the editor's debounced auto-save (every ~3 s) while the
    programmer is typing.  Only updates `source` and `last_edited_at` —
    no version bump, no new binary, no manifest change.

    Body: { source: <string> }
    Response: { ok: true }
    """
    import re as _re_ps
    import datetime as _dt_ps

    raw = (token or '').strip().lower()
    key8 = raw[:8].zfill(8) if len(raw) >= 8 else raw.zfill(8)
    if not _re_ps.fullmatch(r'[0-9a-f]{8}', key8):
        return jsonify({'error': 'Invalid token'}), 400

    payload = request.get_json(force=True, silent=True) or {}
    source  = payload.get('source', '')

    lumps_dir     = os.path.join(os.path.dirname(__file__), 'lumps')
    manifest_path = os.path.join(lumps_dir, 'manifest.json')

    # Resolve the sidecar file path via manifest first, fall back to bare token
    sidecar_path = None
    try:
        with open(manifest_path) as _fh:
            _manifest = json.load(_fh)
        _entry = next((e for e in _manifest if e.get('token') == key8), None)
        if _entry:
            _sfn = _entry.get('sidecar_file', f'{key8}.json')
            sidecar_path = os.path.join(lumps_dir, _sfn)
    except Exception:
        pass

    if sidecar_path is None:
        sidecar_path = os.path.join(lumps_dir, f'{key8}.json')

    if not os.path.isfile(sidecar_path):
        return jsonify({'error': 'WIP sidecar not found'}), 404

    try:
        with open(sidecar_path) as _fh:
            sc = json.load(_fh)
    except Exception as exc:
        return jsonify({'error': f'Could not read sidecar: {exc}'}), 500

    sc['source']         = source
    sc['last_edited_at'] = _dt_ps.datetime.utcnow().timestamp()

    try:
        with open(sidecar_path, 'w') as _fh:
            json.dump(sc, _fh, indent=2)
    except Exception as exc:
        return jsonify({'error': f'Could not write sidecar: {exc}'}), 500

    return jsonify({'ok': True})


@app.route("/api/lumps/list")
def list_lumps():
    """Return JSON array of all saved lumps with lean sidecar metadata.

    The 'source' field is intentionally omitted from every entry so the IDE
    can download the full catalogue without transmitting large source strings.
    Use GET /api/lumps/<token>/detail to retrieve the full sidecar including
    the source field for a specific lump.
    """
    lumps_dir = os.path.join(os.path.dirname(__file__), 'lumps')

    manifest_path = os.path.join(lumps_dir, 'manifest.json')
    manifest = []
    if os.path.isfile(manifest_path):
        try:
            with open(manifest_path, 'r') as fh:
                manifest = json.load(fh)
        except Exception:
            manifest = []

    result = []
    for entry in manifest:
        token8 = entry.get('token', '')
        # Prefer named sidecar (filename field) over legacy token-named sidecar
        _sc_filename = entry.get('sidecar_file', f'{token8}.json')
        sidecar_path = os.path.join(lumps_dir, _sc_filename)
        if not os.path.isfile(sidecar_path):
            sidecar_path = os.path.join(lumps_dir, f'{token8}.json')
        if os.path.isfile(sidecar_path):
            try:
                with open(sidecar_path, 'r') as fh:
                    sidecar = json.load(fh)
                lean = {k: v for k, v in sidecar.items() if k != 'source'}
                lean['has_source'] = bool(sidecar.get('source', '').strip())
                # Overwrite canonical identity fields from the manifest — the
                # manifest is the authority for dot_name / issue_n / filename
                # after migration; sidecar copies of these fields may be stale.
                for _mkey in ('dot_name', 'issue_n', 'filename'):
                    _mv = entry.get(_mkey)
                    if _mv is not None:
                        lean[_mkey] = _mv
                result.append(lean)
                continue
            except Exception:
                pass
        result.append(entry)

    # Prepend system LUMPs extracted live from boot-image.bin.
    # Boot.NS (slot 0, typ=1) comes first so it heads the list; Boot.Abstr (slot 6)
    # follows immediately after.  Filter any stale manifest duplicates first.
    if _BOOT_ABSTR_META:
        result = [e for e in result if e.get('token') not in SERVER_MANAGED_TOKENS]
        result = [dict(_BOOT_ABSTR_META)] + result
    if _BOOT_NS_META:
        result = [e for e in result if e.get('token') != '00000000']
        result = [dict(_BOOT_NS_META)] + result

    # Add binary_valid: True when the .lump binary has a valid header magic
    # (bits [31:27] of word 0 == 0x1F).  Boot.Abstr and Boot.NS are always
    # valid — they are live in-memory copies from boot-image.bin.
    for _e in result:
        _tk = _e.get('token', '')
        if _tk in ('00000600', '00000000'):
            _e['binary_valid'] = True
        elif _tk:
            _lp = os.path.join(lumps_dir, _e.get('filename') or f'{_tk}.lump')
            _e['binary_valid'] = False
            if os.path.isfile(_lp):
                try:
                    with open(_lp, 'rb') as _fh:
                        _b = _fh.read(4)
                    if len(_b) == 4:
                        _w0 = int.from_bytes(_b, 'big')
                        _e['binary_valid'] = ((_w0 >> 27) & 0x1F) == 0x1F
                except Exception:
                    pass
        else:
            _e['binary_valid'] = False

    # Inject clist_entries for every LUMP with cc > 0 and a readable binary.
    # Boot.NS (00000000): C-List is already in namespace_meta — skip.
    # Boot.Abstr (00000600): clist_entries already set inside _BOOT_ABSTR_META — skip.
    # All other LUMPs: read from the .lump file.
    for _e in result:
        _tk = _e.get('token', '')
        if _tk in ('00000000', '00000600') or 'clist_entries' in _e:
            continue
        _cc = int(_e.get('cc', 0) or 0)
        if _cc == 0:
            continue
        _lp = os.path.join(lumps_dir, _e.get('filename') or f'{_tk}.lump')
        if os.path.isfile(_lp):
            _e['clist_entries'] = _extract_clist_from_lump_file(_lp)

    return jsonify(result)


@app.route("/api/lumps/<token>/detail")
def get_lump_detail(token):
    """Return the full sidecar JSON for a single LUMP, including the source field.

    The list endpoint (/api/lumps) omits 'source' to stay lean.  This endpoint
    is called lazily by the IDE editor when the user clicks 'Edit ✎' so it can
    restore the exact source text that was compiled.
    """
    lumps_dir = os.path.join(os.path.dirname(__file__), 'lumps')
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

    sc_file = entry.get('sidecar_file', f'{token8}.json')
    sc_path = os.path.join(lumps_dir, sc_file)
    if not os.path.isfile(sc_path):
        return jsonify({"error": "Sidecar not found"}), 404

    try:
        with open(sc_path, 'r') as fh:
            sidecar = json.load(fh)
    except Exception as exc:
        return jsonify({"error": f"Could not read sidecar: {exc}"}), 500

    # If the 'source' field is a file-path reference (no newlines, ends in .cloomc)
    # rather than actual source text, resolve it to the file's content so the
    # editor can populate itself correctly.  The sidecar on disk is left unchanged.
    _src_raw = sidecar.get('source', '')
    if _src_raw and '\n' not in _src_raw and _src_raw.strip().endswith('.cloomc'):
        _repo_root = os.path.normpath(os.path.join(os.path.dirname(__file__), '..'))
        _src_abs = os.path.normpath(os.path.join(_repo_root, _src_raw.strip()))
        if os.path.isfile(_src_abs):
            try:
                with open(_src_abs, 'r', encoding='utf-8', errors='replace') as _sfh:
                    sidecar = dict(sidecar)
                    sidecar['source'] = _sfh.read()
                    sidecar['source_path'] = _src_raw.strip()
            except OSError:
                pass  # serve the path string as fallback; client will show disasm instead

    # V1.3 self-defining binaries: extract the source from freespace when the
    # binary carries Tier 1/2 content, and report sourceStorageTier.  The
    # sidecar 'source' field remains the fallback for legacy binaries.
    _bin_fn = entry.get('filename') or f'{token8}.lump'
    _bin_path = os.path.join(lumps_dir, _bin_fn)
    if os.path.isfile(_bin_path):
        try:
            with open(_bin_path, 'rb') as _bfh:
                _braw = _bfh.read()
            _bn = len(_braw) // 4
            _bwords = list(_struct.unpack(f'>{_bn}I', _braw[:_bn * 4]))
            _fs_det = _lump_freespace_content(_bwords)
            if _fs_det is not None:
                sidecar = dict(sidecar)
                sidecar['sourceStorageTier'] = _fs_det['tier']
                if _fs_det['source']:
                    sidecar['source'] = _fs_det['source']
        except Exception:
            pass  # malformed frame — serve sidecar fields unchanged

    return jsonify(sidecar)


@app.route("/api/lump/<token_hex>/words")
def get_lump_words(token_hex):
    """Return the raw uint32 word array of a saved lump as JSON."""
    raw   = token_hex.lower()
    key8  = (raw[:8] if len(raw) >= 8 else raw).zfill(8)
    key   = key8.lstrip('0') or '0'
    data  = LAZY_LUMPS.get(key8) or LAZY_LUMPS.get(key)
    if data is None:
        lumps_dir  = os.path.join(os.path.dirname(__file__), 'lumps')
        lump_path  = os.path.join(lumps_dir, f'{key8}.lump')
        # Check manifest for a named (human-readable) filename
        _mf_path = os.path.join(lumps_dir, 'manifest.json')
        if os.path.isfile(_mf_path):
            try:
                with open(_mf_path) as _mf:
                    _mf_data = json.load(_mf)
                for _me in _mf_data:
                    if _me.get('token') == key8:
                        _fn = _me.get('filename', '')
                        if _fn:
                            _np = os.path.join(lumps_dir, _fn)
                            if os.path.isfile(_np):
                                lump_path = _np
                        break
            except Exception:
                pass
        if os.path.isfile(lump_path):
            with open(lump_path, 'rb') as fh:
                data = fh.read()
            LAZY_LUMPS[key8] = data
        else:
            return jsonify({"error": f"Unknown lump 0x{key8}"}), 404
    num_words = len(data) // 4
    lump_raw  = data[:num_words * 4]
    words = list(_struct.unpack(f'>{num_words}I', lump_raw))

    # ── Filename integrity check (fail-closed for canonical entries) ─────────
    # Entries with a dot_name in the manifest MUST pass canonical hash
    # validation before their bytes are served.  _check_lump_canonical_integrity
    # returns None (legacy/unknown — serve freely), True (validated OK), or a
    # string (error message — caller returns 409, no skip path).
    import hashlib as _hl_words
    _lh_lumps_dir = os.path.join(os.path.dirname(__file__), 'lumps')
    _integrity_result = _check_lump_canonical_integrity(_lh_lumps_dir, key8, lump_raw)
    if isinstance(_integrity_result, str):
        return jsonify({"error": _integrity_result}), 409

    # Compute a fresh SHA-256 of the binary bytes so the caller can verify
    # the served content matches the hash recorded at compile time.
    _bh_live = _hl_words.sha256(lump_raw).hexdigest()

    # Backfill sidecar with binary_hash if it was compiled before this field existed.
    _lumps_dir_bh = os.path.join(os.path.dirname(__file__), 'lumps')
    _sc_fn_bh = f'{key8}.json'
    _mf_bh_path = os.path.join(_lumps_dir_bh, 'manifest.json')
    if os.path.isfile(_mf_bh_path):
        try:
            with open(_mf_bh_path) as _mf_bh:
                for _me_bh in json.load(_mf_bh):
                    if _me_bh.get('token') == key8:
                        _sc_fn_bh = _me_bh.get('sidecar_file', _sc_fn_bh)
                        break
        except Exception:
            pass
    _sc_path_bh = os.path.join(_lumps_dir_bh, _sc_fn_bh)
    if os.path.isfile(_sc_path_bh):
        try:
            with open(_sc_path_bh) as _scf_bh:
                _sc_bh = json.load(_scf_bh)
            if not _sc_bh.get('binary_hash'):
                _sc_bh['binary_hash'] = _bh_live
                with open(_sc_path_bh, 'w') as _scwf_bh:
                    json.dump(_sc_bh, _scwf_bh, indent=2)
        except Exception:
            pass

    # Return identity fields from sidecar alongside hash; backfill legacy lumps.
    _petname_ret    = ''
    _issue_ret      = 1
    _id_str_ret     = ''
    _id_hash_ret    = ''
    if os.path.isfile(_sc_path_bh):
        try:
            with open(_sc_path_bh) as _scf_id:
                _sc_id = json.load(_scf_id)
            _petname_ret = _sc_id.get('petname', '')
            _issue_ret   = _sc_id.get('issue_number', 1)
            _id_str_ret  = _sc_id.get('identity_string', '')
            _id_hash_ret = _sc_id.get('identity_hash', '')
        except Exception:
            pass

    return jsonify({
        "token":           key8,
        "words":           words,
        "count":           num_words,
        "binary_hash":     _bh_live,
        "petname":         _petname_ret,
        "issue_number":    _issue_ret,
        "identity_string": _id_str_ret,
        "identity_hash":   _id_hash_ret,
    })


@app.route("/api/lumps/<token>/history")
def get_lump_history(token):
    """Return archived versions for a LUMP token, newest-first.

    Response shape (wrapped object — intentional):
        { "token": "<8-char>", "history": [ <entry>, ... ] }

    Each entry: { version, compiled_at, cw, cc, lump_size }
    Archived files live alongside the current lump as <token>-v<N>.lump + sidecar.

    Note: the response is a wrapped object (not a bare JSON array) so that
    callers can distinguish an empty-history success from a 404 / error response.
    """
    import re as _re
    raw = token.lower()
    key8 = (raw[:8] if len(raw) >= 8 else raw).zfill(8)
    if not _re.fullmatch(r'[0-9a-f]{8}', key8):
        return jsonify({"error": "Invalid token"}), 400
    lumps_dir = os.path.join(os.path.dirname(__file__), 'lumps')
    # Find safe stem from manifest so we can match human-readable archive files
    _safe_stem_h = None
    _mf_path_h = os.path.join(lumps_dir, 'manifest.json')
    if os.path.isfile(_mf_path_h):
        try:
            with open(_mf_path_h) as _mf:
                _mf_d = json.load(_mf)
            for _e in _mf_d:
                if _e.get('token') == key8:
                    _fn = _e.get('filename', '')
                    if _fn and _fn.endswith('.lump'):
                        _safe_stem_h = _re.sub(r'_v\d+$', '', _fn[:-5])
                    break
        except Exception:
            pass
    pattern_token = _re.compile(rf'^{_re.escape(key8)}-v(\d+)\.lump$')
    pattern_named = (
        _re.compile(rf'^{_re.escape(_safe_stem_h)}_v(\d+)\.lump$')
        if _safe_stem_h else None
    )
    entries = []
    for fn in (os.listdir(lumps_dir) if os.path.isdir(lumps_dir) else []):
        m = pattern_token.match(fn) or (pattern_named and pattern_named.match(fn))
        if not m:
            continue
        ver = int(m.group(1))
        lump_path_v = os.path.join(lumps_dir, fn)
        sc_path_v   = os.path.join(lumps_dir, fn[:-5] + '.json')
        size_words  = os.path.getsize(lump_path_v) // 4
        entry = {
            "version":     ver,
            "lump_size":   size_words,
            "compiled_at": None,
            "cw":          None,
            "cc":          None,
        }
        if os.path.isfile(sc_path_v):
            try:
                with open(sc_path_v, 'r') as fh:
                    sc = json.load(fh)
                entry["compiled_at"]  = sc.get("compiled_at")
                entry["cw"]           = sc.get("cw")
                entry["cc"]           = sc.get("cc")
                entry["abstraction"]  = sc.get("abstraction")
                entry["lump_size"]    = sc.get("lump_size") or size_words
            except Exception:
                pass
        entries.append(entry)
    entries.sort(key=lambda e: e["version"], reverse=True)
    return jsonify({"token": key8, "history": entries})


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

    lumps_dir = os.path.join(os.path.dirname(__file__), 'lumps')
    # Resolve current lump path from manifest (may be human-readable name)
    lump_path   = os.path.join(lumps_dir, f'{key8}.lump')
    sc_path     = os.path.join(lumps_dir, f'{key8}.json')
    _safe_stem_fv = key8
    _mf_path_fv = os.path.join(lumps_dir, 'manifest.json')
    if os.path.isfile(_mf_path_fv):
        try:
            with open(_mf_path_fv) as _f:
                _mf_fv = json.load(_f)
            for _e in _mf_fv:
                if _e.get('token') == key8:
                    _fn = _e.get('filename', '')
                    _sfn = _e.get('sidecar_file', '')
                    if _fn:
                        _np = os.path.join(lumps_dir, _fn)
                        if os.path.isfile(_np):
                            lump_path = _np
                    if _sfn:
                        _nsp = os.path.join(lumps_dir, _sfn)
                        if os.path.isfile(_nsp):
                            sc_path = _nsp
                    if _fn and _fn.endswith('.lump'):
                        _safe_stem_fv = _re_fv.sub(r'_v\d+$', '', _fn[:-5])
                    break
        except Exception:
            pass
    if not os.path.isfile(lump_path):
        return jsonify({"error": "No compiled binary for this token — cannot fork"}), 404

    sc = {}
    if os.path.isfile(sc_path):
        try:
            with open(sc_path, 'r') as fh:
                sc = json.load(fh)
        except Exception:
            pass

    cur_version = sc.get('lump_version')
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

    # If already forked (sidecar has forked=True and no new compiled_at set),
    # re-forking would overwrite the archive. Idempotently return current state.
    # Note: when forked=True, cur_version is already N+1 (fork wrote it), so
    # new_version = cur_version (not cur_version+1) to avoid a double-increment.
    if sc.get('forked'):
        return jsonify({"ok": True, "new_version": cur_version, "prev_version": cur_version - 1, "already_forked": True})

    import shutil as _shutil_fv
    arch_lump = os.path.join(lumps_dir, f'{_safe_stem_fv}_v{cur_version}.lump')
    arch_json = os.path.join(lumps_dir, f'{_safe_stem_fv}_v{cur_version}.json')
    _shutil_fv.copy2(lump_path, arch_lump)
    arch_sc = dict(sc)
    arch_sc['archived_version'] = cur_version
    with open(arch_json, 'w') as fh:
        json.dump(arch_sc, fh, indent=2)

    # Persist the forked state to the live sidecar so that:
    # 1) Reloading the page won't trigger another fork on the same binary.
    # 2) _lumpIsSealed() (client) sees forked=True and skips re-fork.
    # 3) lump_version is incremented server-side; save detects forked=True
    #    and uses this value directly (not +1) so the new binary lands at N+1.
    # The next compile-and-save rewrites the sidecar completely, clearing forked.
    sc['forked'] = True
    sc['lump_version'] = cur_version + 1
    with open(sc_path, 'w') as fh:
        json.dump(sc, fh, indent=2)

    logging.info('[lumps] Fork: archived %s → %s_v%d.lump (sidecar forked=True written)',
                 lump_path, _safe_stem_fv, cur_version)
    return jsonify({"ok": True, "new_version": cur_version + 1, "prev_version": cur_version})


@app.route("/api/lumps/<token>/words/<int:version>")
def get_lump_version_words(token, version):
    """Return the raw uint32 word array for an archived version of a LUMP.

    Reads <token>-v<version>.lump and its companion sidecar <token>-v<version>.json.
    Returns: { token, version, words, count, cw, cc, lump_size, abstraction, compiled_at }
    The metadata fields are populated from the sidecar when present, and fall back
    to values derived from the binary header.
    """
    import re as _re
    raw = token.lower()
    key8 = (raw[:8] if len(raw) >= 8 else raw).zfill(8)
    if not _re.fullmatch(r'[0-9a-f]{8}', key8):
        return jsonify({"error": "Invalid token"}), 400
    lumps_dir = os.path.join(os.path.dirname(__file__), 'lumps')
    lump_path_v = os.path.join(lumps_dir, f'{key8}-v{version}.lump')
    # Also check for human-readable versioned archive: <AbsName>_v<N>.lump
    _mf_v = os.path.join(lumps_dir, 'manifest.json')
    if os.path.isfile(_mf_v):
        try:
            with open(_mf_v) as _f:
                _mf_vd = json.load(_f)
            for _e in _mf_vd:
                if _e.get('token') == key8:
                    _fn = _e.get('filename', '')
                    if _fn and _fn.endswith('.lump'):
                        import re as _re_vv
                        _stem = _re_vv.sub(r'_v\d+$', '', _fn[:-5])
                        _np = os.path.join(lumps_dir, f'{_stem}_v{version}.lump')
                        if os.path.isfile(_np):
                            lump_path_v = _np
                    break
        except Exception:
            pass
    if not os.path.isfile(lump_path_v):
        return jsonify({"error": f"No archived version v{version} for token 0x{key8}"}), 404
    with open(lump_path_v, 'rb') as fh:
        data = fh.read()
    num_words = len(data) // 4
    words = list(_struct.unpack(f'>{num_words}I', data[:num_words * 4]))

    sc = {}
    sc_path_v = os.path.join(lumps_dir, lump_path_v[len(lumps_dir)+1:-5] + '.json')
    if os.path.isfile(sc_path_v):
        try:
            with open(sc_path_v, 'r') as fh:
                sc = json.load(fh)
        except Exception:
            pass

    hdr_cw  = sc.get('cw')
    hdr_cc  = sc.get('cc')
    if hdr_cw is None or hdr_cc is None:
        if num_words > 0:
            h0 = words[0]
            hdr_cw = (h0 >> 10) & 0x1FFF
            hdr_cc = h0 & 0xFF

    return jsonify({
        "token":         key8,
        "version":       version,
        "words":         words,
        "count":         num_words,
        "cw":            hdr_cw,
        "cc":            hdr_cc,
        "lump_size":     sc.get('lump_size') or num_words,
        "ns_slot":       sc.get('ns_slot'),
        "abstraction":   sc.get('abstraction'),
        "compiled_at":   sc.get('compiled_at'),
        "methods":       sc.get('methods', []),
        "capabilities":  sc.get('capabilities', []),
        "language":      sc.get('language'),
        "profile":       sc.get('profile'),
        "author":        sc.get('author', ''),
        "version_str":   sc.get('version', ''),
        "release_notes": sc.get('release_notes', ''),
        "grants":        sc.get('grants', ['E']),
        "content_type":  sc.get('content_type', 'code'),
        "pet_names":     sc.get('pet_names', {"DR": {}, "CR": {}}),
        "mtbf":          sc.get('mtbf', {}),
        "deployment":    sc.get('deployment', {}),
        "source_hash":   sc.get('mtbf', {}).get('source_hash', ''),
        "source":        sc.get('source', ''),
    })


@app.route("/api/lump-source/<name>")
def get_lump_source(name):
    """Return the CLOOMC++ functional source for a named lump.

    Search order:
      1. simulator/cloomc/<name>.cloomc  (case-insensitive)
      2. simulator/examples/<name>.cloomc or any *.cloomc whose
         'Abstraction:' header comment matches <name>  (case-insensitive)
      3. source_file path recorded in the matching sidecar JSON under
         server/lumps/ (the abstraction name is matched against sidecar
         "abstraction" field)

    Returns {"name": name, "source": "...", "source_path": "..."} on success.
    Returns {"error": "...", "binary_only": true} with 404 if not found.
    """
    import re as _re
    if not _re.match(r'^[A-Za-z0-9_ .\-]+$', name):
        return jsonify({"error": "Invalid name"}), 400

    _root = os.path.normpath(os.path.join(os.path.dirname(__file__), '..'))

    def _read_source(path):
        with open(path, 'r', encoding='utf-8', errors='replace') as fh:
            return fh.read()

    # 0. V1.3 self-defining binary — the embedded Tier 1/2 source is the
    # authoritative source and MUST precede all external/sidecar fallbacks:
    # a same-name .cloomc file on disk may be stale or a different program.
    lumps_dir = os.path.join(os.path.dirname(__file__), 'lumps')
    if os.path.isdir(lumps_dir):
        for fname in os.listdir(lumps_dir):
            if not fname.endswith('.json') or fname == 'manifest.json':
                continue
            try:
                with open(os.path.join(lumps_dir, fname), 'r') as fh:
                    sc = json.load(fh)
            except Exception:
                continue
            if sc.get('abstraction', '').lower() != name.lower():
                continue
            bin_path = os.path.join(lumps_dir, fname[:-len('.json')] + '.lump')
            if not os.path.isfile(bin_path):
                continue
            try:
                with open(bin_path, 'rb') as fh:
                    braw = fh.read()
                bn = len(braw) // 4
                fs = _lump_freespace_content(
                    list(_struct.unpack(f'>{bn}I', braw[:bn * 4])))
            except Exception:
                continue
            if fs and fs.get('source'):
                return jsonify({"name": name, "source": fs['source'],
                                "source_path": f"embedded (Tier {fs['tier']})",
                                "binary_only": False})

    # 1. simulator/cloomc/ — exact then case-insensitive scan
    cloomc_dir = os.path.join(_root, 'simulator', 'cloomc')
    candidate = os.path.join(cloomc_dir, f'{name}.cloomc')
    if os.path.isfile(candidate):
        return jsonify({"name": name, "source": _read_source(candidate),
                        "source_path": f"simulator/cloomc/{name}.cloomc",
                        "binary_only": False})
    if os.path.isdir(cloomc_dir):
        for fname in os.listdir(cloomc_dir):
            if fname.lower() == f'{name.lower()}.cloomc':
                p = os.path.join(cloomc_dir, fname)
                return jsonify({"name": name, "source": _read_source(p),
                                "source_path": f"simulator/cloomc/{fname}",
                                "binary_only": False})

    # 2. simulator/examples/ — exact filename match then header comment scan
    examples_dir = os.path.join(_root, 'simulator', 'examples')
    if os.path.isdir(examples_dir):
        for fname in os.listdir(examples_dir):
            if not fname.endswith('.cloomc'):
                continue
            p = os.path.join(examples_dir, fname)
            # Quick filename match (e.g. wukong_callhome → WukongCallHome)
            stem = fname[:-len('.cloomc')]
            if stem.lower().replace('_', '') == name.lower().replace('_', '').replace(' ', ''):
                return jsonify({"name": name, "source": _read_source(p),
                                "source_path": f"simulator/examples/{fname}",
                                "binary_only": False})
            # Check 'Abstraction:' header comment inside the file
            try:
                with open(p, 'r', encoding='utf-8', errors='replace') as fh:
                    for line in fh:
                        m = _re.match(r'[;#]\s*Abstraction\s*:\s*(.+)', line)
                        if m and m.group(1).strip().lower() == name.lower():
                            return jsonify({"name": name, "source": _read_source(p),
                                            "source_path": f"simulator/examples/{fname}",
                                            "binary_only": False})
                        if not line.startswith(';') and not line.startswith('#') and line.strip():
                            break  # past header block
            except OSError:
                pass

    # 3. Sidecar source_file field — scan server/lumps/*.json for matching abstraction
    lumps_dir = os.path.join(os.path.dirname(__file__), 'lumps')
    if os.path.isdir(lumps_dir):
        for fname in os.listdir(lumps_dir):
            if not fname.endswith('.json'):
                continue
            try:
                with open(os.path.join(lumps_dir, fname), 'r') as fh:
                    sc = json.load(fh)
            except Exception:
                continue
            if sc.get('abstraction', '').lower() != name.lower():
                continue
            sf = sc.get('source_file', '')
            if not sf:
                continue
            abs_sf = os.path.normpath(os.path.join(_root, sf))
            if os.path.isfile(abs_sf):
                return jsonify({"name": name, "source": _read_source(abs_sf),
                                "source_path": sf,
                                "binary_only": False})

    # 4. Sidecar 'source' text — last fallback before binary_only, which is
    # only returned when the freespace is all-zero (legacy) AND no sidecar
    # or external source exists.
    if os.path.isdir(lumps_dir):
        for fname in os.listdir(lumps_dir):
            if not fname.endswith('.json') or fname == 'manifest.json':
                continue
            try:
                with open(os.path.join(lumps_dir, fname), 'r') as fh:
                    sc = json.load(fh)
            except Exception:
                continue
            if sc.get('abstraction', '').lower() != name.lower():
                continue
            if sc.get('source') and '\n' in sc.get('source', ''):
                return jsonify({"name": name, "source": sc['source'],
                                "source_path": "sidecar",
                                "binary_only": False})

    return jsonify({
        "error": f"No functional CLOOMC++ source found for '{name}'",
        "binary_only": True
    }), 404


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
            results.append({'path': rel_f, 'name': stem, 'dir': rel_dir})

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
    """Overwrite the content of a text, markdown, or image lump in-place."""
    import base64 as _b64, math as _math

    raw  = token.lower()
    key8 = (raw[:8] if len(raw) >= 8 else raw).zfill(8)
    lumps_dir    = os.path.join(os.path.dirname(__file__), 'lumps')
    lump_path    = os.path.join(lumps_dir, f'{key8}.lump')
    sidecar_path = os.path.join(lumps_dir, f'{key8}.json')

    if not os.path.isfile(lump_path):
        return jsonify({"error": f"Lump {key8} not found"}), 404

    sidecar = {}
    if os.path.isfile(sidecar_path):
        try:
            with open(sidecar_path, 'r') as fh:
                sidecar = json.load(fh)
        except Exception:
            pass

    ct = (sidecar.get('content_type') or '').lower()
    if ct and ct not in _EDITABLE_CONTENT_TYPES:
        return jsonify({"error": f"Lump content_type '{ct}' is not editable via this endpoint"}), 400

    payload = request.get_json(force=True, silent=True) or {}

    if 'text' in payload:
        raw_bytes = payload['text'].encode('utf-8')
    elif 'data_b64' in payload:
        try:
            raw_bytes = _b64.b64decode(payload['data_b64'], validate=True)
        except Exception:
            return jsonify({"error": "Invalid base64 data"}), 400
    else:
        return jsonify({"error": "Payload must include 'text' or 'data_b64'"}), 400

    padded_len   = (len(raw_bytes) + 3) & ~3
    padded_bytes = raw_bytes + b'\x00' * (padded_len - len(raw_bytes))
    data_word_count = padded_len // 4

    total_needed = 1 + data_word_count
    MAX_LUMP_WORDS = 1 << 14
    if total_needed > MAX_LUMP_WORDS:
        return jsonify({"error": f"Payload too large: {data_word_count} data words"}), 400

    n = max(6, _math.ceil(_math.log2(max(total_needed, 2))))
    n = min(n, 14)
    lump_size   = 1 << n
    n_minus_6   = n - 6
    cw          = min(data_word_count, lump_size - 1)

    header = (0x1F << 27) | (n_minus_6 << 23) | (cw << 10) | (0x01 << 8) | 0
    data_words = list(_struct.unpack(f'>{data_word_count}I', padded_bytes))
    all_words  = ([header] + data_words)[:lump_size]
    all_words += [0] * max(0, lump_size - len(all_words))

    lump_bytes = _struct.pack(f'>{lump_size}I', *[int(w) & 0xFFFFFFFF for w in all_words])
    with open(lump_path, 'wb') as fh:
        fh.write(lump_bytes)
    LAZY_LUMPS[key8] = lump_bytes
    LAZY_LUMPS[key8.lstrip('0') or '0'] = lump_bytes

    sidecar['cw']        = cw
    sidecar['lump_size'] = lump_size
    with open(sidecar_path, 'w') as fh:
        json.dump(sidecar, fh, indent=2)

    print(f'[lumps/content PUT] {key8} cw={cw} lump_size={lump_size} {len(lump_bytes)}B', flush=True)
    return jsonify({"ok": True, "token": key8, "cw": cw, "lump_size": lump_size})


@app.route("/api/lump/<token>/meta", methods=["PATCH"])
def patch_lump_meta(token):
    """Update author and version metadata fields in a saved lump's sidecar JSON.

    Expects JSON body with any of:
      author  — string author name
      version — string version string
    Only the supplied fields are updated; others are left unchanged.
    Returns {"ok": true, "token": token8} on success.
    """
    raw   = token.lower()
    key8  = (raw[:8] if len(raw) >= 8 else raw).zfill(8)

    lumps_dir    = os.path.join(os.path.dirname(__file__), 'lumps')
    sidecar_path = os.path.join(lumps_dir, f'{key8}.json')

    payload = request.get_json(force=True, silent=True) or {}

    # ── Phase 1: validate payload (pure, no I/O, no lock needed) ─────────────
    # Validate ns_slot_policy before entering the lock so we can return 400
    # without holding any shared resource.
    if 'ns_slot_policy' in payload:
        if payload['ns_slot_policy'] not in ('static', 'dynamic'):
            return jsonify({"error": "ns_slot_policy must be 'static' or 'dynamic'"}), 400

    if 'ns_slot' in payload:
        slot_val = payload['ns_slot']
        if slot_val is not None:
            # Reject booleans: Python treats True/False as int subtypes, but the
            # API contract requires a plain integer.
            if isinstance(slot_val, bool) or not isinstance(slot_val, int) or slot_val < 0:
                return jsonify({"error": "ns_slot must be a non-negative integer or null"}), 400

    _updatable = ("author", "version", "pet_name_cr_slot", "ns_slot_policy", "ns_slot", "boot_resident")
    if not any(f in payload for f in _updatable):
        return jsonify({"ok": True, "token": key8, "message": "No fields updated"}), 200

    # ── Phase 2: serialised transaction under _lumps_manifest_lock ───────────
    # The lock covers the entire sidecar-bootstrap → fresh-read → apply →
    # sidecar-write → manifest-write → rollback sequence.  Holding it from
    # the moment we read the sidecar prevents two concurrent PATCHes from
    # both snapshotting an old version, then committing stale sidecars that
    # overwrite each other's fields.
    #
    # Rollback strategy: if the manifest write fails, the sidecar is restored
    # to the on-disk content we read at the start of the lock — the caller
    # receives a 500 and can retry.  Rollback failure is logged and the 500 is
    # still returned so the caller is never misled into thinking the write
    # succeeded.

    manifest_path = os.path.join(lumps_dir, 'manifest.json')
    with _lumps_manifest_lock:
        # Bootstrap sidecar if missing (inside lock to prevent concurrent creation).
        if not os.path.isfile(sidecar_path):
            seed = None
            if key8 == '00000600' and _BOOT_ABSTR_META:
                seed = dict(_BOOT_ABSTR_META)
            else:
                if os.path.isfile(manifest_path):
                    try:
                        with open(manifest_path, 'r') as _mf:
                            _manifest = json.load(_mf)
                        for _entry in _manifest:
                            if (_entry.get('token', '') or '').lower().zfill(8) == key8:
                                seed = dict(_entry)
                                break
                    except Exception:
                        pass
                if seed is None and (key8 in LAZY_LUMPS or
                                     os.path.isfile(os.path.join(lumps_dir, f'{key8}.lump'))):
                    seed = {'token': key8, 'abstraction': key8}
            if seed is None:
                return jsonify({"error": "Lump sidecar not found"}), 404
            try:
                _atomic_write_json(sidecar_path, seed)
            except Exception as _se:
                return jsonify({"error": f"Could not create sidecar: {_se}"}), 500

        # Fresh sidecar read inside the lock — picks up any commit by a
        # concurrent PATCH that took the lock before us.
        try:
            with open(sidecar_path, 'r') as _sf:
                _original_sidecar_json = _sf.read()
            sidecar = json.loads(_original_sidecar_json)
        except Exception as exc:
            return jsonify({"error": f"Could not read sidecar: {exc}"}), 500

        # Apply all validated changes to the freshly-read in-memory copy.
        for field in ("author", "version"):
            if field in payload:
                sidecar[field] = str(payload[field])

        if 'pet_name_cr_slot' in payload:
            cr_slot = str(payload['pet_name_cr_slot'])
            cr_value = (str(payload.get('pet_name_cr_value', '')) or '').strip()
            if 'pet_names' not in sidecar or not isinstance(sidecar.get('pet_names'), dict):
                sidecar['pet_names'] = {}
            if 'CR' not in sidecar['pet_names'] or not isinstance(sidecar['pet_names'].get('CR'), dict):
                sidecar['pet_names']['CR'] = {}
            if cr_value:
                sidecar['pet_names']['CR'][cr_slot] = cr_value
            else:
                sidecar['pet_names']['CR'].pop(cr_slot, None)

        if 'ns_slot_policy' in payload:
            sidecar['ns_slot_policy'] = payload['ns_slot_policy']  # already validated above

        if 'ns_slot' in payload:
            sidecar['ns_slot'] = payload['ns_slot']  # already validated above

        if 'boot_resident' in payload:
            sidecar['boot_resident'] = bool(payload['boot_resident'])

        # Write updated sidecar atomically.
        try:
            _atomic_write_json(sidecar_path, sidecar)
        except Exception as exc:
            return jsonify({"error": f"Could not write sidecar: {exc}"}), 500

        # Write manifest — roll back sidecar on any failure so both stores
        # stay consistent.
        try:
            manifest = _read_manifest_safe(manifest_path)
            changed = False
            for entry in manifest:
                if entry.get('token') == key8:
                    for field in ("author", "version", "ns_slot_policy", "ns_slot"):
                        if field in payload:
                            entry[field] = sidecar[field]
                    changed = True
            if changed:
                _atomic_write_json(manifest_path, manifest)
        except (ValueError, OSError) as _mf_err:
            app.logger.error(
                "patch_lump_meta: manifest write failed for %s (%s); rolling back sidecar",
                key8, _mf_err,
            )
            try:
                _orig = json.loads(_original_sidecar_json)
                _atomic_write_json(sidecar_path, _orig)
            except Exception as _rb_err:
                app.logger.error(
                    "patch_lump_meta: sidecar rollback also failed for %s: %s", key8, _rb_err
                )
            if isinstance(_mf_err, ValueError):
                msg = f"manifest.json is corrupt and cannot be read safely. Details: {_mf_err}"
            else:
                msg = f"Could not commit update to manifest.json: {_mf_err}"
            return jsonify({"error": msg}), 500

    # Keep _BOOT_ABSTR_META in sync so /api/lumps/list returns the new values
    # immediately.  Done outside the lock — in-memory update is non-critical.
    if key8 == '00000600':
        for field in ("author", "version"):
            if field in payload:
                _BOOT_ABSTR_META[field] = sidecar[field]

    print(f'[lumps/meta PATCH] {key8} author={sidecar.get("author","")} version={sidecar.get("version","")} ns_slot_policy={sidecar.get("ns_slot_policy","")} ns_slot={sidecar.get("ns_slot", "")}', flush=True)
    return jsonify({"ok": True, "token": key8})


@app.route("/api/lump/<token>/mtbf", methods=["POST"])
def post_lump_mtbf(token):
    """Record a selftest run outcome and update MTBF fields in the sidecar JSON.

    Expects JSON body: { "passed": true | false }

    Updates:
      mtbf.total_runs         — incremented by 1 on every call
      mtbf.consecutive_clean  — incremented on pass, reset to 0 on failure
      mtbf.status             — "green" when consecutive_clean >= 5,
                                "amber" when 1-4,
                                "red"   when 0 and total_runs > 0

    Returns {"ok": true, "token": token8, "mtbf": <updated mtbf object>}.
    """
    raw  = token.lower()
    key8 = (raw[:8] if len(raw) >= 8 else raw).zfill(8)

    lumps_dir    = os.path.join(os.path.dirname(__file__), 'lumps')
    sidecar_path = os.path.join(lumps_dir, f'{key8}.json')

    if not os.path.isfile(sidecar_path):
        return jsonify({"error": "Lump sidecar not found"}), 404

    payload = request.get_json(force=True, silent=True) or {}
    if "passed" not in payload:
        return jsonify({"error": "Missing required field: passed"}), 400

    if not isinstance(payload["passed"], bool):
        return jsonify({"error": "Field 'passed' must be a JSON boolean (true or false)"}), 400

    passed = payload["passed"]

    try:
        with open(sidecar_path, 'r') as fh:
            sidecar = json.load(fh)
    except Exception as exc:
        return jsonify({"error": f"Could not read sidecar: {exc}"}), 500

    mtbf = sidecar.get("mtbf", {})
    if not isinstance(mtbf, dict):
        mtbf = {}

    incoming_version = payload.get("lump_version")
    if incoming_version is not None:
        try:
            incoming_version = int(incoming_version)
        except (ValueError, TypeError):
            incoming_version = None
    stored_version = mtbf.get("lump_version")
    if stored_version is not None:
        try:
            stored_version = int(stored_version)
        except (ValueError, TypeError):
            stored_version = None
    if incoming_version is not None and stored_version is not None and incoming_version > stored_version:
        mtbf["consecutive_clean"] = 0
    if incoming_version is not None:
        mtbf["lump_version"] = incoming_version

    total_runs        = int(mtbf.get("total_runs", 0)) + 1
    consecutive_clean = int(mtbf.get("consecutive_clean", 0))

    if passed:
        consecutive_clean += 1
    else:
        consecutive_clean = 0

    if consecutive_clean >= 5:
        status = "green"
    elif consecutive_clean >= 1:
        status = "amber"
    else:
        status = "red"

    mtbf["total_runs"]        = total_runs
    mtbf["consecutive_clean"] = consecutive_clean
    mtbf["status"]            = status
    sidecar["mtbf"]           = mtbf

    try:
        with open(sidecar_path, 'w') as fh:
            json.dump(sidecar, fh, indent=2)
    except Exception as exc:
        return jsonify({"error": f"Could not write sidecar: {exc}"}), 500

    print(f'[lumps/mtbf POST] {key8} passed={passed} consecutive_clean={consecutive_clean} total_runs={total_runs} status={status}', flush=True)
    return jsonify({"ok": True, "token": key8, "mtbf": mtbf})


@app.route("/api/lump/<token_hex>/clist/<int:slot_index>", methods=["PATCH"])
def patch_lump_clist_slot(token_hex, slot_index):
    """Write a single GT word into a specific c-list slot of a standalone .lump binary.

    Expects JSON body: { "gt_word": <uint32> }

    The .lump binary is big-endian uint32 words.  The c-list occupies the last
    `cc` words of the lump; slot 0 is the last-cc-th word.

    Returns { "ok": true, "token": ..., "slot": ..., "gt_word": ... }
    """
    raw  = token_hex.lower()
    key8 = (raw[:8] if len(raw) >= 8 else raw).zfill(8)

    lumps_dir = os.path.join(os.path.dirname(__file__), 'lumps')
    lump_path = _resolve_lump_path(key8, lumps_dir)
    if not lump_path:
        return jsonify({"error": f"No .lump file for token {key8}"}), 404

    payload = request.get_json(force=True, silent=True) or {}
    gt_word = payload.get("gt_word")
    if gt_word is None:
        return jsonify({"error": "Missing 'gt_word' in request body"}), 400
    gt_word = int(gt_word) & 0xFFFFFFFF

    with open(lump_path, 'rb') as fh:
        raw_bytes = fh.read()
    n_words = len(raw_bytes) // 4
    if n_words < 2:
        return jsonify({"error": "Lump file too short"}), 400

    words = list(_struct.unpack(f'>{n_words}I', raw_bytes[:n_words * 4]))

    hdr = words[0]
    if (hdr >> 27) & 0x1F != 0x1F:
        return jsonify({"error": "Bad lump magic in header word"}), 400

    n_minus_6 = (hdr >> 23) & 0xF
    cc        = hdr & 0xFF
    lump_size = 1 << (n_minus_6 + 6)

    if cc == 0:
        return jsonify({"error": "Lump has no c-list (cc=0)"}), 400
    if slot_index < 0 or slot_index >= cc:
        return jsonify({"error": f"slot_index {slot_index} out of range (cc={cc})"}), 400
    if lump_size > n_words:
        return jsonify({"error": "Lump size exceeds file length"}), 400

    word_pos = lump_size - cc + slot_index
    words[word_pos] = gt_word

    new_bytes = _struct.pack(f'>{n_words}I', *words)
    with open(lump_path, 'wb') as fh:
        fh.write(new_bytes)

    LAZY_LUMPS[key8] = new_bytes
    LAZY_LUMPS[key8.lstrip('0') or '0'] = new_bytes

    print(f'[clist PATCH] {key8} slot={slot_index} gt_word=0x{gt_word:08x}', flush=True)
    return jsonify({"ok": True, "token": key8, "slot": slot_index, "gt_word": gt_word})


def _lump_freespace_content(words):
    """Parse the V1.3 0xAB self-definition frame from a lump word array.

    Spec: CM_LUMP_SPECIFICATION.md §Freespace Content and Self-Definition.
    Word cw+1 = 0xAB | flags | api_byte_length; then API JSON bytes; if
    flags.has_source a source_byte_length word and source bytes follow.

    Returns None for a legacy binary (no 0xAB magic at word cw+1 — all-zero
    freespace) or a non-code lump; otherwise a dict:
      {tier, flags, api_len, content_words, source}
    content_words counts the freespace words the frame occupies starting at
    word cw+1 (header + API + optional length word + source).
    """
    if not words:
        return None
    hdr0 = words[0] & 0xFFFFFFFF
    if (hdr0 >> 27) & 0x1F != 0x1F:
        return None
    size = 1 << (((hdr0 >> 23) & 0xF) + 6)
    cw   = (hdr0 >> 10) & 0x1FFF
    typ  = (hdr0 >> 8) & 0x3
    cc   = hdr0 & 0xFF
    if typ != 0:
        return None
    fs_start = 1 + cw
    fs_end   = size - cc
    if fs_start >= fs_end or fs_start >= len(words):
        return None
    h = words[fs_start] & 0xFFFFFFFF
    if (h >> 24) & 0xFF != 0xAB:
        return None
    flags = (h >> 16) & 0xFF
    # Valid flag bytes: 0x00 (Tier 0), 0x01/0x03 (Tier 1/2 uncompressed),
    # 0x05/0x07 (Tier 1/2 deflate-raw compressed; bit 2 = compressed flag).
    _tier_map = {0x00: 0, 0x01: 1, 0x03: 2, 0x05: 1, 0x07: 2}
    tier  = _tier_map.get(flags)
    if tier is None:
        return None
    api_len = h & 0xFFFF
    if api_len == 0:
        return None
    api_nw  = (api_len + 3) // 4
    content = 1 + api_nw
    source  = None
    if flags & 0x01:
        pos = fs_start + 1 + api_nw
        if pos >= fs_end or pos >= len(words):
            return None
        src_len = words[pos] & 0xFFFFFFFF
        src_nw  = (src_len + 3) // 4
        if src_len == 0 or pos + 1 + src_nw > fs_end:
            return None
        raw = _struct.pack(f'>{src_nw}I',
                           *[w & 0xFFFFFFFF for w in words[pos + 1:pos + 1 + src_nw]])[:src_len]
        try:
            if flags & 0x04:
                # deflate-raw compressed (flags 0x05 or 0x07) — wbits=-15 matches
                # the browser CompressionStream('deflate-raw') / JS _deflateRaw().
                # Guard against decompression bombs: bound output to 256 KiB
                # (far above the largest valid lump freespace of ~128 KiB).
                import zlib as _zlib_fs
                _MAX_DECOMP = 1 << 18   # 256 KiB
                _d = _zlib_fs.decompressobj(wbits=-15)
                _chunk = _d.decompress(raw, _MAX_DECOMP)
                if _d.unconsumed_tail:
                    return None   # reject oversized payloads silently
                _rest = _d.flush()
                if not _d.eof:
                    return None   # truncated stream — reject silently
                source = (_chunk + _rest).decode('utf-8')
            else:
                source = raw.decode('utf-8')
        except Exception:
            return None
        content += 1 + src_nw
    return {"tier": tier, "flags": flags, "api_len": api_len,
            "content_words": content, "source": source}


@app.route("/api/lump/<token_hex>/resize", methods=["POST"])
def resize_lump(token_hex):
    """Repack a LUMP to its minimum power-of-2 size by removing freespace.

    Keeps the code region (first cw words after the header) and c-list (last cc
    words) intact; removes the unused freespace words between them.  The new
    lump size is the smallest power of 2 >= (1 + cw + cc), minimum 64 words.

    Two paths are supported:

    * Standalone .lump files — read from the file, repack, write back, update
      the sidecar JSON and manifest.

    * Boot lump (token 00000600) embedded in boot-image.bin — repack the lump
      in-place inside the binary memory image, update NS slot 6 words 1 and 2
      (cr_limit and CRC-16/XMODEM seal), write boot-image.bin back, then
      refresh LAZY_LUMPS and _BOOT_ABSTR_META via _load_boot_abstr_lump().

    Lumps that do not fall into either category are rejected with a 400 error.
    """
    import math as _math
    raw   = token_hex.lower()
    key8  = (raw[:8] if len(raw) >= 8 else raw).zfill(8)
    lumps_dir    = os.path.join(os.path.dirname(__file__), 'lumps')
    lump_path    = _resolve_lump_path(key8, lumps_dir)
    sidecar_path = _resolve_sidecar_path(key8, lumps_dir)

    # Special branch: boot lump embedded in boot-image.bin (token 00000600).
    # There is no standalone .lump file for this token; resize it in-place inside
    # the binary, update NS slot 6, then write the file back.
    if not lump_path and key8 == '00000600' and _BOOT_ABSTR_META:
        boot_path = os.path.join(os.path.dirname(__file__), 'lumps', 'boot-image.bin')
        if not os.path.isfile(boot_path):
            return jsonify({"error": "boot-image.bin not found"}), 400
        with open(boot_path, 'rb') as fh:
            raw = fh.read()
        n_words = len(raw) // 4
        if n_words < 1024:
            return jsonify({"error": "boot-image.bin too small to contain NS table"}), 400
        # boot-image.bin is little-endian, mirroring _load_boot_abstr_lump()
        mem_bi = list(_struct.unpack(f'<{n_words}I', raw[:n_words * 4]))

        # Locate Boot.Abstr NS entry via symbolic constants (NS_ENTRY_WORDS=4, BOOT_ABSTR_NS_SLOT=6).
        # Never hardcode the slot number here — Boot.Abstr migrated from slot 3 to slot 6 and
        # any hardcoded integer would silently read the wrong NS entry on the next migration.
        _ns_entry_words  = _boot_image_gen.NS_ENTRY_WORDS      # 4 words per NS entry
        _boot_abstr_slot = _boot_image_gen.BOOT_ABSTR_NS_SLOT  # 6 (was 3 before slot migration)
        ns_table_base = n_words - 1024
        boot_ns_base  = ns_table_base + _boot_abstr_slot * _ns_entry_words
        word0_location = mem_bi[boot_ns_base]
        if word0_location == 0 or word0_location + 1 >= n_words:
            return jsonify({"error": f"Boot.Abstr (NS slot {_boot_abstr_slot}) location is invalid"}), 400

        # Parse lump header (little-endian word, same bit layout as big-endian .lump)
        hdr = mem_bi[word0_location]
        if (hdr >> 27) & 0x1F != 0x1F:
            return jsonify({"error": "Bad lump magic in boot lump header"}), 400
        n_minus_6 = (hdr >> 23) & 0xF
        cw        = (hdr >> 10) & 0x1FFF
        cc        = hdr & 0xFF
        typ       = (hdr >> 8) & 0x3
        old_size  = 1 << (n_minus_6 + 6)

        if word0_location + old_size > n_words:
            return jsonify({"error": "Boot lump region extends beyond boot-image.bin"}), 400

        # V1.3: a self-defining lump's 0xAB content frame (word cw+1 …) must
        # survive the repack — it is declared content, not reclaimable zeros.
        _lump_words_bi = mem_bi[word0_location:word0_location + old_size]
        _fs_bi = _lump_freespace_content(_lump_words_bi)
        _content_nw_bi = _fs_bi["content_words"] if _fs_bi else 0

        # Compute minimum size (same formula as standalone path, plus the
        # content frame when present)
        min_content = 1 + cw + _content_nw_bi + cc
        new_n = max(6, _math.ceil(_math.log2(max(min_content, 2))))
        new_n = min(new_n, 14)
        new_size = 1 << new_n

        if new_size >= old_size:
            return jsonify({"ok": True, "already_minimal": True,
                            "lump_size": old_size, "cw": cw, "cc": cc})

        # Capture code, content frame and c-list from the current lump region
        code_words  = mem_bi[word0_location + 1 : word0_location + 1 + cw]
        frame_words = (mem_bi[word0_location + 1 + cw :
                              word0_location + 1 + cw + _content_nw_bi]
                       if _content_nw_bi else [])
        clist_words = (mem_bi[word0_location + old_size - cc : word0_location + old_size]
                       if cc > 0 else [])

        # Repack lump in-place: header | code | content frame | zeros | c-list
        freespace = new_size - 1 - cw - _content_nw_bi - cc
        mem_bi[word0_location] = _pack_lump_header(new_n - 6, cw, cc, typ)
        for i, w in enumerate(code_words + frame_words):
            mem_bi[word0_location + 1 + i] = int(w) & 0xFFFFFFFF
        for i in range(freespace):
            mem_bi[word0_location + 1 + cw + _content_nw_bi + i] = 0
        for i, w in enumerate(clist_words):
            mem_bi[word0_location + new_size - cc + i] = int(w) & 0xFFFFFFFF
        # Zero the freed tail of the old lump region
        for i in range(new_size, old_size):
            mem_bi[word0_location + i] = 0

        # Update Boot.Abstr NS entry word 1 (new cr_limit) and word 2 (recomputed seal)
        new_cr_limit = new_size - cc - 1
        mem_bi[boot_ns_base + 1] = _boot_image_gen.pack_ns_word1(
            new_cr_limit, 0, 0, 0, 0, 1, cc)
        mem_bi[boot_ns_base + 2] = _boot_image_gen.make_version_seals(
            0, word0_location, new_cr_limit)

        # Serialize back to little-endian bytes and write boot-image.bin
        new_bytes = _struct.pack(f'<{n_words}I', *[int(w) & 0xFFFFFFFF for w in mem_bi])
        with open(boot_path, 'wb') as fh:
            fh.write(new_bytes)

        # Refresh LAZY_LUMPS and _BOOT_ABSTR_META / _BOOT_NS_META from the updated file
        _load_boot_abstr_lump()
        _load_boot_ns_lump()

        # Sanity check: validate the updated image
        try:
            _boot_image_gen.validate_boot_image(new_bytes)
        except ValueError as ve:
            return jsonify({"error": f"Post-resize validation failed: {ve}"}), 500

        saved = old_size - new_size
        print(f'[lump/resize] boot-image 00000600: {old_size}w → {new_size}w '
              f'(cw={cw}, cc={cc}, cr_limit={new_cr_limit}, saved {saved}w)', flush=True)
        return jsonify({"ok": True, "already_minimal": False,
                        "old_size": old_size, "lump_size": new_size,
                        "cw": cw, "cc": cc, "saved_words": saved})

    if not os.path.isfile(lump_path):
        return jsonify({"error": f"Lump {key8} has no standalone file — only standalone lumps can be resized"}), 400

    data = LAZY_LUMPS.get(key8)
    if data is None:
        with open(lump_path, 'rb') as fh:
            data = fh.read()

    num_words = len(data) // 4
    if num_words < 1:
        return jsonify({"error": "Lump data is too short"}), 400

    words = list(_struct.unpack(f'>{num_words}I', data[:num_words * 4]))
    hdr = words[0]
    if (hdr >> 27) & 0x1F != 0x1F:
        return jsonify({"error": "Bad lump magic in header word"}), 400

    n_minus_6 = (hdr >> 23) & 0xF
    cw        = (hdr >> 10) & 0x1FFF
    cc        = hdr & 0xFF
    typ       = (hdr >> 8) & 0x3
    old_size  = 1 << (n_minus_6 + 6)

    if old_size != num_words:
        return jsonify({"error": f"Header size mismatch: header says {old_size}w, file has {num_words}w"}), 400

    # V1.3: preserve the 0xAB self-definition frame (word cw+1 …) — declared
    # content is never zeroed, and the minimum size must accommodate it.
    _fs_rs = _lump_freespace_content(words)
    _content_nw = _fs_rs["content_words"] if _fs_rs else 0

    # Minimum lump size: header + code + content frame + c-list, rounded up
    # to next power of 2, min 64.
    min_content = 1 + cw + _content_nw + cc
    new_n = max(6, _math.ceil(_math.log2(max(min_content, 2))))
    new_n = min(new_n, 14)
    new_size = 1 << new_n

    if new_size >= old_size:
        return jsonify({"ok": True, "already_minimal": True,
                        "lump_size": old_size, "cw": cw, "cc": cc})

    # Re-pack: new header | code | content frame | freespace zeros | c-list.
    code_words  = words[1:1 + cw]
    frame_words = words[1 + cw:1 + cw + _content_nw] if _content_nw else []
    clist_words = words[old_size - cc:old_size] if cc > 0 else []
    freespace   = new_size - 1 - cw - _content_nw - cc
    new_words   = [_pack_lump_header(new_n - 6, cw, cc, typ)]
    new_words  += code_words
    new_words  += frame_words
    new_words  += [0] * freespace
    new_words  += clist_words

    if len(new_words) != new_size:
        return jsonify({"error": f"Internal repack error: got {len(new_words)} words, expected {new_size}"}), 500

    lump_bytes = _struct.pack(f'>{new_size}I', *[int(w) & 0xFFFFFFFF for w in new_words])
    with open(lump_path, 'wb') as fh:
        fh.write(lump_bytes)
    LAZY_LUMPS[key8] = lump_bytes
    LAZY_LUMPS[key8.lstrip('0') or '0'] = lump_bytes

    # Update sidecar JSON.
    sidecar = {}
    if os.path.isfile(sidecar_path):
        try:
            with open(sidecar_path, 'r') as fh:
                sidecar = json.load(fh)
        except Exception:
            pass
    sidecar['lump_size'] = new_size
    with open(sidecar_path, 'w') as fh:
        json.dump(sidecar, fh, indent=2)

    # Update manifest entry if present.
    manifest_path = os.path.join(lumps_dir, 'manifest.json')
    try:
        manifest = _read_manifest_safe(manifest_path)
    except ValueError as _mf_rsz_err:
        return jsonify({"error": (
            "manifest.json is corrupt and cannot be read safely. "
            f"Details: {_mf_rsz_err}"
        )}), 500
    for entry in manifest:
        if entry.get('token') == key8:
            entry['lump_size'] = new_size
            break
    _atomic_write_json(manifest_path, manifest)

    print(f'[lump/resize] {key8}: {old_size}w → {new_size}w (cw={cw}, cc={cc}, saved {old_size - new_size}w)', flush=True)
    return jsonify({"ok": True, "already_minimal": False,
                    "old_size": old_size, "lump_size": new_size,
                    "cw": cw, "cc": cc, "saved_words": old_size - new_size})


@app.route("/api/lumps/import", methods=["POST"])
def import_lump():
    """Pack an uploaded file (base64) into a data LUMP and save with sidecar."""
    import base64 as _b64, math as _math, datetime as _dt, hashlib as _hl
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

    payload_hash = _hl.sha256(raw_bytes).hexdigest()[:4]
    token8 = (_hl.sha256(name.encode('utf-8')).hexdigest()[:4] + payload_hash)

    lumps_dir  = os.path.join(os.path.dirname(__file__), 'lumps')
    os.makedirs(lumps_dir, exist_ok=True)

    lump_bytes = _struct.pack(f'>{lump_size}I', *[int(w) & 0xFFFFFFFF for w in all_words])
    lump_path  = os.path.join(lumps_dir, f'{token8}.lump')
    with open(lump_path, 'wb') as fh:
        fh.write(lump_bytes)
    LAZY_LUMPS[token8] = lump_bytes
    LAZY_LUMPS[token8.lstrip('0') or '0'] = lump_bytes

    sidecar = {
        "token":        token8,
        "abstraction":  name,
        "ns_slot":      None,
        "lump_size":    lump_size,
        "typ":          1,
        "content_type": content_type,
        "lump_type":    "data",
        "cw":           cw,
        "cc":           0,
        "profile":      "IoT",
        "language":     "imported",
        "methods":      [],
        "capabilities": [],
        "pet_names":    {"DR": {}, "CR": {}},
        "mtbf":         {"consecutive_clean": 0, "total_runs": 0, "status": "unknown", "source_hash": ""},
        "deployment":   {"target_board": "wukong-xc7a100t", "profile": "IoT",
                         "built_at": _dt.datetime.utcnow().isoformat() + "Z",
                         "builder": "IDE Import"},
        "grants":       ["E"],
    }
    if img_width  > 0: sidecar["image_width"]  = img_width
    if img_height > 0: sidecar["image_height"] = img_height

    sidecar_path = os.path.join(lumps_dir, f'{token8}.json')
    with open(sidecar_path, 'w') as fh:
        json.dump(sidecar, fh, indent=2)

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
    manifest.append({"token": token8, "abstraction": name, "ns_slot": None,
                      "lump_size": lump_size, "cw": cw, "cc": 0,
                      "methods": [], "grants": ["E"]})
    _atomic_write_json(manifest_path, manifest)

    print(f'[lumps/import] {token8} content_type={content_type} {len(lump_bytes)}B', flush=True)
    return jsonify({"ok": True, "token": token8})


@app.route("/api/lumps/upload-lump", methods=["POST"])
def upload_lump_file():
    """Import a raw .lump binary file as-is; parse its header to populate sidecar."""
    import base64 as _b64, datetime as _dt, hashlib as _hl
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

    if len(raw_bytes) > expected_size * 4:
        return jsonify({"error": f"File size ({len(raw_bytes)} B) exceeds LUMP header size 2^{n}={expected_size} words"}), 400
    if len(raw_bytes) < 4:
        return jsonify({"error": "LUMP must contain at least a header word"}), 400

    # Pad to full declared lump size
    lump_size  = expected_size
    lump_bytes = raw_bytes + b'\x00' * max(0, lump_size * 4 - len(raw_bytes))

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

    lumps_dir = os.path.join(os.path.dirname(__file__), 'lumps')
    os.makedirs(lumps_dir, exist_ok=True)

    lump_path = os.path.join(lumps_dir, f'{token8}.lump')
    with open(lump_path, 'wb') as fh:
        fh.write(lump_bytes)
    LAZY_LUMPS[token8] = lump_bytes
    LAZY_LUMPS[token8.lstrip('0') or '0'] = lump_bytes

    sidecar = {
        "token":        token8,
        "abstraction":  name,
        "ns_slot":      None,
        "lump_size":    lump_size,
        "typ":          typ,
        "content_type": content_type,
        "lump_type":    lump_type,
        "cw":           cw,
        "cc":           cc,
        "profile":      "IoT",
        "language":     "imported",
        "methods":      [],
        "capabilities": [],
        "pet_names":    {"DR": {}, "CR": {}},
        "mtbf":         {"consecutive_clean": 0, "total_runs": 0, "status": "unknown", "source_hash": ""},
        "deployment":   {"target_board": "wukong-xc7a100t", "profile": "IoT",
                         "built_at": _dt.datetime.utcnow().isoformat() + "Z",
                         "builder": "IDE LUMP Upload"},
        "grants":       ["E"],
    }
    # V1.3: derive sourceStorageTier from the uploaded binary's freespace
    # content header; absent = legacy (all-zero freespace).
    _fs_upl = _lump_freespace_content(
        list(_struct.unpack(f'>{lump_size}I', lump_bytes)))
    if _fs_upl is not None:
        sidecar["sourceStorageTier"] = _fs_upl["tier"]

    sidecar_path = os.path.join(lumps_dir, f'{token8}.json')
    with open(sidecar_path, 'w') as fh:
        json.dump(sidecar, fh, indent=2)

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
    manifest.append({"token": token8, "abstraction": name, "ns_slot": None,
                      "lump_size": lump_size, "cw": cw, "cc": cc,
                      "methods": [], "grants": ["E"]})
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

    lumps_dir = os.path.join(os.path.dirname(__file__), 'lumps')
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

    sidecar = {
        "token": _hashlib.sha256(app_id.encode()).hexdigest()[:8],
        "abstraction": app_id,
        "ns_slot": None,
        "lump_size": lump_size,
        "cw": 0,
        "cc": cc,
        "typ": 10,
        "lump_type": "namespace",
        "profile": "IoT",
        "language": "namespace",
        "methods": [],
        "capabilities": [],
        "pet_names": {"DR": {}, "CR": {}},
        "mtbf": {"consecutive_clean": 0, "total_runs": 0, "status": "unknown", "source_hash": ""},
        "deployment": {
            "target_board": "wukong-xc7a100t",
            "profile": "IoT",
            "built_at": _dt.datetime.utcnow().isoformat() + "Z",
            "builder": "CLOOMC++ IDE v1.0"
        },
        "grants": [],
        "namespace_meta": {
            "app_id": app_id,
            "base": f"0x{base_addr:08X}",
            "n": n,
            "cc": cc,
            "ns_table_start": ns_table_start,
            "entries": manifest_entries,
        }
    }
    token8 = sidecar["token"]
    os.makedirs(lumps_dir, exist_ok=True)

    lump_path = os.path.join(lumps_dir, f'{token8}.lump')
    with open(lump_path, 'wb') as fh:
        fh.write(app_bin)

    sidecar_path = os.path.join(lumps_dir, f'{token8}.json')
    with open(sidecar_path, 'w') as fh:
        json.dump(sidecar, fh, indent=2)

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
        "ns_slot": None,
        "lump_size": lump_size,
        "cw": 0,
        "cc": cc,
        "typ": 10,
        "methods": [],
        "grants": [],
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
    lumps_dir = os.path.join(os.path.dirname(__file__), 'lumps')

    lump_path    = _resolve_lump_path(token8, lumps_dir)
    sidecar_path = _resolve_sidecar_path(token8, lumps_dir)
    deleted = []

    if lump_path and os.path.isfile(lump_path):
        os.remove(lump_path)
        deleted.append(os.path.basename(lump_path))
    if sidecar_path and os.path.isfile(sidecar_path):
        os.remove(sidecar_path)
        deleted.append(os.path.basename(sidecar_path))

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
        lumps_dir = os.path.join(_SERVER_DIR, "lumps")
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

    The NS slot is read from boot_image_gen.BOOT_ABSTR_NS_SLOT (currently 6);
    never hardcode the slot number here.  Used by the Connect tab stream panel
    to disassemble NIA lines and display the GT the instruction accesses.
    """
    import struct as _struct
    boot_img = os.path.join(os.path.dirname(__file__), "lumps", "boot-image.bin")
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
    BOOT_ABSTR_SLOT = _boot_image_gen.BOOT_ABSTR_NS_SLOT
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
            if unrecovered > 0:
                stable_status = "red"
            elif tier3 > 0:
                stable_status = "amber"
            else:
                stable_status = "stable"
            device_count = dev_counts.get((tok, ver), 0)
            compiled_at = (
                entry.get("compiled_at")
                or entry.get("deployment", {}).get("built_at")
            )
            result.append({
                "lump_version": ver,
                "lump_token": tok,
                "compiled_at": compiled_at,
                "device_count": device_count,
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
                    total_faults == 0
                    or fault_rate < FAULT_RATE_THRESHOLD
                    or (tier3 == 0 and unrecovered == 0)
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
    if _wukong_udp is not None:
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
_wukong_cmd_id       = 0     # monotonic; incremented under _wukong_command_lock

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
        'source':            str(data.get('source', 'simulator')),
        'ts':                float(data.get('ts', _ft_time.time())),
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
        _fault_snapshot = entry
    return jsonify({'ok': True})


@app.route('/api/fault-snapshot', methods=['GET'])
def fault_snapshot_get():
    """Return the most recent fault snapshot, or 404 if none recorded."""
    with _fault_snapshot_lock:
        snap = _fault_snapshot
    if snap is None:
        return jsonify({'ok': False, 'error': 'no fault snapshot'}), 404
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
    global _wukong_latest_trace, _wukong_latest_cr_gts, _wukong_event_seq, \
           _wukong_call_depth, _wukong_last_trace_post, _wukong_total_trace_posts
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
        'instr':       int(data.get('instr', 0)),
        'flags':       int(data.get('flags', 0)),
        'fault_code':  int(data.get('fault_code', 0)),
        'fault_valid': bool(data.get('fault_valid', False)),
        'bp_hit':      bool(data.get('bp_hit', False)),
        'ts':          float(data.get('ts', 0.0)),
    }
    # The packet format intentionally remains backward-compatible.  Prefer
    # metadata supplied by a newer bridge, but derive it server-side as well
    # for old bridges that only POST the original packet fields.
    location = {
        key: data[key]
        for key in ('pet_name', 'offset', 'nia_label', 'disasm', 'source_map')
        if key in data
    }
    if not location:
        location = _wukong_trace_metadata(entry['nia']) or {}
    entry.update(location)
    with _wukong_trace_lock:
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
        _wukong_latest_trace = entry
        # Persist CR GT updates separately so a subsequent CALL_PUSH packet
        # (ev_type=0x08, payload_gt=0) cannot overwrite the CR6/CR14 GTs
        # before the IDE polls GET /hardware/wukong/trace.
        if ev_type == 0x06:    # TRACE_EV_CALL_CR6
            _wukong_latest_cr_gts[6]  = payload_gt
        elif ev_type == 0x07:  # TRACE_EV_CALL_CR14
            _wukong_latest_cr_gts[14] = payload_gt
    return jsonify({'ok': True})


@app.route('/hardware/wukong/snapshot', methods=['POST'])
def wukong_snapshot_post():
    """Bridge posts one complete, CRC-validated architectural stop snapshot.

    The bridge has already checked the wire CRC.  The server still validates
    the JSON shape before placing it in the same ordered queue as trace
    events, so the browser can apply snapshots atomically and in arrival
    order.
    """
    global _wukong_latest_snapshot, _wukong_event_seq, \
        _wukong_last_trace_post, _wukong_total_trace_posts
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
        entry['version'] = 1
        entry['m_flag'] = bool(data.get('m_flag', False))
        entry['crc16'] = int(data.get('crc16', 0)) & 0xFFFF
        entry['ts'] = float(data.get('ts', 0.0))
    except (KeyError, TypeError, ValueError, OverflowError) as exc:
        return jsonify({'ok': False, 'error': f'invalid snapshot: {exc}'}), 400

    _wukong_last_trace_post = _wk_time.time()
    _wukong_total_trace_posts += 1
    with _wukong_trace_lock:
        _wukong_event_seq += 1
        entry['seq'] = _wukong_event_seq
        _wukong_event_queue.append(entry)
        if len(_wukong_event_queue) > _WUKONG_EVENT_QUEUE_MAXLEN:
            del _wukong_event_queue[:-_WUKONG_EVENT_QUEUE_MAXLEN]
        _wukong_latest_snapshot = dict(entry)
    return jsonify({'ok': True, 'seq': entry['seq']})


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

    Merged into the same ordered event queue as trace packets so the /fpga
    page's live event log shows ALL board output in arrival order.
    Body JSON: {'text': str, 'ts': float}
    """
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

    Body JSON: {'cmd': 's'|'r'|'h'|'q'|'b'|'u'|'f', 'nia': <int>, 'data': '<base64>'}

    Only one command is queued at a time.  Overwrite policy (documented):
    a new POST overwrites any still-pending command, and the response
    surfaces the overwrite as {'ok': True, 'overwrote': '<prev cmd>'} so
    the caller can warn the user.  We surface rather than 409-reject so a
    Reboot ('f') can always displace a stale queued command when no bridge
    is polling.
    """
    global _wukong_pending_cmd, _upload_in_flight, _wukong_cmd_delivery, \
        _wukong_cmd_id
    data = request.get_json(silent=True) or {}
    cmd = str(data.get('cmd', '')).strip()
    if cmd not in ('s', 'r', 'h', 'q', 'b', 'u', 'f'):
        return jsonify({'ok': False, 'error': 'unknown cmd'}), 400

    entry = {'cmd': cmd}

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
        entry['data'] = b64
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
        # s / r / h — reject while any upload is in-flight.
        with _upload_in_flight_lock:
            if _upload_in_flight:
                return jsonify({'ok': False,
                                'error': 'upload in progress — retry after upload-ack'}), 409

    now = _wk_time.time()
    with _wukong_command_lock:
        prev = _wukong_pending_cmd
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
        }
    resp = {'ok': True, 'id': entry['id']}
    if prev:
        resp['overwrote'] = prev.get('cmd')
    return jsonify(resp)


@app.route('/hardware/wukong/command', methods=['GET'])
def wukong_command_get():
    """Bridge polls here every 50 ms to dequeue the next pending command.

    Returns {'cmd': ..., 'nia': ...} if a command is pending, else {}.
    The command is consumed (set to None) on each successful GET.
    """
    global _wukong_pending_cmd, _wukong_last_bridge_poll, _wukong_total_bridge_polls
    _wukong_last_bridge_poll    = _wk_time.time()
    _wukong_total_bridge_polls += 1
    with _wukong_command_lock:
        entry = _wukong_pending_cmd
        _wukong_pending_cmd = None
        if entry and _wukong_cmd_delivery \
                and _wukong_cmd_delivery.get('id') == entry.get('id'):
            _wukong_cmd_delivery['consumed_ts'] = _wukong_last_bridge_poll
    if entry:
        return jsonify(entry)
    return jsonify({})


@app.route('/hardware/wukong/status', methods=['GET'])
def wukong_status_get():
    """Aggregate, non-consuming status snapshot for the /fpga page.

    Unlike GET /hardware/wukong/upload-ack (which consumes the result) this
    endpoint only reads state, so polling it never disturbs the IDE's flows.
    """
    now = _wk_time.time()
    with _wukong_trace_lock:
        latest    = dict(_wukong_latest_trace)
        snapshot  = dict(_wukong_latest_snapshot)
        seq       = _wukong_event_seq
        qlen      = len(_wukong_event_queue)
        depth     = _wukong_call_depth
        cr_gts    = dict(_wukong_latest_cr_gts)
    with _wukong_boot_info_lock:
        boot_info = dict(_wukong_boot_info)
    with _upload_in_flight_lock:
        upl       = _upload_in_flight
    with _wukong_command_lock:
        pending   = dict(_wukong_pending_cmd) if _wukong_pending_cmd else None
        delivery  = dict(_wukong_cmd_delivery) if _wukong_cmd_delivery else None
    if pending and 'data' in pending:
        # Type-safe payload summary: never embed the payload, and never raise
        # (a TypeError here would turn the read-only status poll into a 500).
        _d = pending['data']
        pending = {'cmd': pending.get('cmd'),
                   'data_bytes': len(_d) if isinstance(_d, (str, bytes)) else 0}
    bridge_age = (now - _wukong_last_bridge_poll) if _wukong_last_bridge_poll else None
    trace_age  = (now - _wukong_last_trace_post)  if _wukong_last_trace_post  else None
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
        'cr6_gt':             cr_gts.get(6),
        'cr14_gt':            cr_gts.get(14),
        'boot_info':          boot_info,
        # What the hardware will actually run at boot: power-on bitstream
        # default (slot 7, WukongCallHome) until a boot-image upload is
        # ACKed, then the uploaded image's entry slot.
        'hw_entry_slot':      (_wukong_hw_entry_slot
                               if _wukong_hw_entry_slot is not None
                               else WUKONG_POWERON_ENTRY_SLOT),
        'hw_entry_source':    ('upload' if _wukong_hw_entry_slot is not None
                               else 'power-on'),
        'upload_in_flight':   upl,
        'pending_command':    pending,
        'command_delivery':   delivery,
        'ide_version':        BUILD_VERSION,
        # Repo-side expectations so the Versions view can compare against the
        # sentinel-reported build_version / tu_version without extra requests.
        'expected_build_version': _wukong_build_version(),
        'min_tu_version':         _wukong_min_tu_version(),
        # Relay state — active when a dev IDE is mirroring from a remote server.
        'relay_enabled':    _wukong_relay_enabled,
        'relay_source_url': _wukong_relay_url,
        'relay_last_ok':    (now - _wukong_relay_last_ok) if _wukong_relay_last_ok else None,
        'relay_last_rx':    (now - _wukong_relay_last_rx) if _wukong_relay_last_rx else None,
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
#   POST /hardware/wukong/boot-info  — bridge reports {stale_tu, tu_version}
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


@app.route('/hardware/wukong/command-ack', methods=['POST'])
def wukong_command_ack_post():
    """Bridge reports the serial-write result for a dequeued command.

    Body JSON:
        id    — the command ID received on dequeue (GET /hardware/wukong/command)
        cmd   — the command char it attempted to write ('s','r','h','b','f')
        ok    — true when the UART write succeeded
        error — human-readable failure string when ok=false

    Updates the delivery record only when BOTH the id and cmd match the
    current record AND that command has already been consumed — a late ack
    for a superseded command (even one with the same letter) or an ack that
    arrives before consumption can never corrupt the lifecycle.
    """
    global _wukong_cmd_delivery
    data = request.get_json(silent=True) or {}
    cmd  = str(data.get('cmd', '')).strip()
    ok   = bool(data.get('ok', False))
    err  = str(data.get('error', ''))[:400] if not ok else ''
    try:
        ack_id = int(data.get('id'))
    except (TypeError, ValueError):
        ack_id = None
    with _wukong_command_lock:
        if _wukong_cmd_delivery \
                and ack_id is not None \
                and _wukong_cmd_delivery.get('id') == ack_id \
                and _wukong_cmd_delivery.get('cmd') == cmd \
                and _wukong_cmd_delivery.get('consumed_ts') is not None:
            _wukong_cmd_delivery['write_ok']    = ok
            _wukong_cmd_delivery['write_error'] = err
            _wukong_cmd_delivery['write_ts']    = _wk_time.time()
    return jsonify({'ok': True})


@app.route('/hardware/wukong/upload-ack', methods=['POST'])
def wukong_upload_ack_post():
    """Bridge reports the result of a boot-image upload here.

    Body JSON:
        ok    — true on success, false on failure
        error — optional human-readable error string (present when ok=false)
    """
    global _wukong_upload_ack, _upload_in_flight
    data  = request.get_json(silent=True) or {}
    entry = {
        'ok':    bool(data.get('ok', False)),
        'error': str(data.get('error', '')) if not data.get('ok') else '',
    }
    with _wukong_upload_ack_lock:
        _wukong_upload_ack = entry
    # A confirmed upload changes what the board will run on its next boot:
    # commit the uploaded image's entry slot as the hardware boot entry.
    global _wukong_hw_entry_slot, _wukong_pending_entry_slot
    with _wukong_hw_entry_lock:
        if entry['ok'] and _wukong_pending_entry_slot is not None:
            _wukong_hw_entry_slot = _wukong_pending_entry_slot
        _wukong_pending_entry_slot = None
    # Clear the in-flight flag so execution commands are accepted again.
    with _upload_in_flight_lock:
        _upload_in_flight = False
    return jsonify({'ok': True})


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
    import base64 as _b64

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
        _boot_bin = os.path.join(_SERVER_DIR, 'lumps', 'boot-image.bin')
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

        _encoded = _b64.b64encode(_raw).decode('ascii')

        # Register NIA label map so trace events for the uploaded lump resolve
        # to "LumpName.N" labels instead of raw hex NIAs.
        _wukong_update_active_lump_nia(_raw, _entry_info)

        # Record which entry slot this upload carries BEFORE the command
        # becomes observable to the bridge: a fast bridge could otherwise
        # consume the command and POST the ACK before the pending slot is
        # set, leaving the ACK unable to commit it (and the value stale).
        # Rolled back in the finally block on any enqueue failure.
        global _wukong_pending_entry_slot
        with _wukong_hw_entry_lock:
            _wukong_pending_entry_slot = _entry_info['entry_slot']

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
            _wukong_pending_cmd = {'cmd': 'u', 'data': _encoded,
                                   'id': _wukong_cmd_id}
            _wukong_cmd_delivery = {
                'id':          _wukong_cmd_id,
                'cmd':         'u',
                'queued_ts':   _wk_time.time(),
                'consumed_ts': None,
                'write_ok':    None,
                'write_error': '',
                'write_ts':    None,
            }

        _rollback = False   # committed — in-flight flag stays set
        return jsonify({'queued': True, 'size': len(_raw),
                        'entry_slot': _entry_info['entry_slot']})
    finally:
        if _rollback:
            with _wukong_hw_entry_lock:
                _wukong_pending_entry_slot = None
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
    """
    global _wukong_boot_info
    data = request.get_json(silent=True) or {}
    bv = data.get('build_version')
    entry = {
        'stale_tu':     bool(data.get('stale_tu', False)),
        'tu_version':   int(data.get('tu_version', 0)),
        'build_version': int(bv) if bv is not None else None,
        # Server-side receive timestamp: lets the /fpga page confirm a FRESH
        # sentinel arrived after a Reboot ('f') — true end-to-end proof.
        'received_ts':   _wk_time.time(),
    }
    with _wukong_boot_info_lock:
        _wukong_boot_info = entry
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

_BUILD_SNAPSHOTS_DIR  = os.path.join(_SERVER_DIR, 'build-snapshots')
_LUMPS_DIR            = LUMPS_DIR          # alias to the project-wide constant

_BA_NONCE_TTL_SECS    = 300               # nonce valid for 5 minutes
_ba_nonce_store: dict = {}
_ba_nonce_lock        = threading.Lock()

_ba_build_log:  list  = []
_ba_build_done: bool  = True              # True = idle; False = in-progress
_ba_build_exit        = None
_ba_build_lock        = threading.Lock()

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
    """Return (header_word, cw, cc) or None if file is missing/invalid."""
    try:
        with open(path, 'rb') as f:
            raw = f.read(4)
        if len(raw) < 4:
            return None
        w = _ba_struct.unpack('>I', raw)[0]
        if ((w >> 27) & 0x1F) != 0x1F:
            return None
        cw = (w >> 10) & 0x1FFF
        cc = w & 0xFF
        return w, cw, cc
    except Exception:
        return None


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
        return jsonify({'filename': latest, 'frozen_at': snap.get('frozen_at')})
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

def _ba_check_selftest_egt(lump_path, selftest_ns_slot):
    """
    Verify SelfTest LUMP c-list[0] matches boot_rom's expected E-GT.

    The c-list is stored at the LAST cc words of the lump file.  For the
    canonical SelfTest binary (cc=1) the last file word should equal:
        boot_rom.make_gt(GT_TYPE_INFORM, PERM_MASK_E, SELFTEST_NS_SLOT, 0)

    This is the check that would have caught the v12→v13 regression where the
    SelfTest return-channel GT was corrupted: an incorrect c-list[0] means the
    binary diverges from what boot_rom asserts.

    Fails CLOSED: if the expected value cannot be computed the check returns
    ok=False rather than passing silently.
    """
    # Import hardware.boot_rom from the repo root (parent of server/).
    # boot_rom uses package-relative imports (from .hw_types import *) so it
    # must be loaded as part of the 'hardware' package, not as a standalone file.
    import sys as _sys
    _repo_root = os.path.dirname(_SERVER_DIR)
    expected_gt  = None
    import_err   = None
    _inserted = False
    try:
        if _repo_root not in _sys.path:
            _sys.path.insert(0, _repo_root)
            _inserted = True
        import hardware.boot_rom as _hw_boot_rom
        expected_gt = _hw_boot_rom.make_gt(
            _hw_boot_rom.GT_TYPE_INFORM, _hw_boot_rom.PERM_MASK_E, selftest_ns_slot, 0)
    except Exception as _e:
        import_err = str(_e)
    finally:
        if _inserted and _repo_root in _sys.path:
            _sys.path.remove(_repo_root)

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
        if cc == 0:
            return {'ok': None, 'detail': 'SelfTest LUMP has cc=0 (no c-list entries)'}
        # Validate file size before using file-length-derived c-list offset to
        # prevent appended-data attacks where a correct GT is placed beyond the
        # declared content boundary.
        size_err = _ba_validate_lump_size(n_words, cw, cc)
        if size_err:
            return {'ok': False, 'detail': f'LUMP integrity: {size_err}'}
        # c-list occupies the LAST cc words of the (validated) file
        actual_gt = _ba_struct.unpack_from('>I', data, (n_words - cc) * 4)[0]
        ok = (actual_gt == expected_gt)
        verdict = '✅ matches boot_rom' if ok else '❌ mismatch'
        return {'ok': ok,
                'detail': f'c-list[0]=0x{actual_gt:08X} expected=0x{expected_gt:08X} {verdict}'}
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
                    'detail': (f'❌ REGRESSION: terminal opcode={op} (RETURN) at word[{last_idx}]'
                               f' — should be BRANCH({BRANCH_OP}); 0x{last_w:08X}')}
        if op == BRANCH_OP:
            return {'ok': True,
                    'detail': (f'terminal opcode={op} (BRANCH ✅) at word[{last_idx}];'
                               f' 0x{last_w:08X}')}
        # Neither BRANCH nor RETURN — warn but do not block approval
        return {'ok': None, 'warn': True,
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
        data['build_nonce'] = _ba_fresh_nonce()
        return jsonify(data)
    except Exception as e:
        app.logger.exception('build-approval/ns-map error')
        return jsonify({'error': str(e)}), 500

def _ba_build_ns_map():
    """Assemble the full NS map with per-slot checks. Returns a dict."""
    import re as _re

    ROOT = os.path.dirname(_SERVER_DIR)

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

    selftest_slot   = int(_rom(r'SELFTEST_NS_SLOT\s*=\s*(\d+)',          '6'))
    callhome_slot   = int(_rom(r'WUKONG_CALLHOME_NS_SLOT\s*=\s*(\d+)',  '7'))
    ns_slot_count   = int(_rom(r'NS_SLOT_COUNT\s*=\s*(\d+)',             '8'))
    selftest_base   = _rom(r'WUKONG_SELFTEST_BASE_BYTE\s*=\s*(0x[0-9a-fA-F]+|\d+)', '0x600')
    # callhome base — match the literal constant assignment (not the indirect alias)
    callhome_base   = _rom(r'WUKONG_CALLHOME_BASE_BYTE\s*=\s*(0x[0-9a-fA-F]+|\d+)', '0x1200')

    mmio_uart  = _rom(r'MMIO_UART_ADDR\s*=\s*(0x[0-9a-fA-F]+)',  '0x40000014')
    mmio_led   = _rom(r'MMIO_LED_ADDR\s*=\s*(0x[0-9a-fA-F]+)',   '0x40000000')
    mmio_btn   = _rom(r'MMIO_BTN_ADDR\s*=\s*(0x[0-9a-fA-F]+)',   '0x40000028')
    mmio_timer = _rom(r'MMIO_TIMER_ADDR\s*=\s*(0x[0-9a-fA-F]+)', '0x4000002C')

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

    # ── manifest ───────────────────────────────────────────────────────────
    manifest_path = os.path.join(_LUMPS_DIR, 'manifest.json')
    manifest = []
    try:
        with open(manifest_path) as f:
            manifest = json.load(f)
    except Exception:
        pass

    # Map ns_slot → manifest entry
    manifest_by_slot = {}
    manifest_no_slot = []
    for entry in manifest:
        slot = entry.get('ns_slot')
        if slot is not None and isinstance(slot, int):
            manifest_by_slot[slot] = entry
        else:
            manifest_no_slot.append(entry)

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
                # 1b. cw/cc match manifest
                if manifest_entry:
                    m_cw = manifest_entry.get('cw')
                    m_cc = manifest_entry.get('cc')
                    cw_ok = (m_cw is None) or (hdr[1] == m_cw)
                    cc_ok = (m_cc is None) or (hdr[2] == m_cc)
                    checks.append({'label': 'cw/cc', 'ok': cw_ok and cc_ok,
                                   'detail': f'binary cw={hdr[1]} cc={hdr[2]} vs manifest cw={m_cw} cc={m_cc}'})
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

        # 2. Name parity (manifest abstraction vs JSON .json sidecar if present)
        if manifest_entry and token:
            json_path = os.path.join(_LUMPS_DIR, token + '.json')
            if os.path.exists(json_path):
                try:
                    with open(json_path) as jf:
                        jdata = json.load(jf)
                    m_name = manifest_entry.get('abstraction', '')
                    j_name = jdata.get('abstraction', jdata.get('name', ''))
                    name_ok = (not m_name or not j_name or m_name == j_name)
                    checks.append({'label': 'name parity', 'ok': name_ok,
                                   'detail': f'manifest="{m_name}" sidecar="{j_name}"'})
                except Exception:
                    pass

        # 3. Token parity — manifest token should match filename
        if manifest_entry and token:
            m_token = manifest_entry.get('token', '')
            token_ok = (not m_token) or (m_token.lower() == token.lower())
            checks.append({'label': 'token', 'ok': token_ok,
                           'detail': f'manifest token={m_token!r} file={token!r}'})

        # 4. SelfTest-specific checks: RETURN-vs-BRANCH opcode + c-list E-GT
        if is_selftest and lump_path and os.path.exists(lump_path):
            # 4a. Terminal opcode check — catch v12→v13 regression (RETURN instead of BRANCH)
            op_chk = _ba_check_final_opcode(lump_path)
            checks.append({'label': 'BRANCH opcode',
                           'ok': op_chk['ok'],
                           'warn': op_chk.get('warn', False),
                           'detail': op_chk['detail']})
            # 4b. c-list[0] E-GT check — verify return-channel capability matches boot_rom
            egt = _ba_check_selftest_egt(lump_path, selftest_slot)
            checks.append({'label': 'SelfTest E-GT', 'ok': egt['ok'],
                           'detail': egt['detail']})

        return checks

    # ── Assemble tiers ─────────────────────────────────────────────────────
    # Bootstrap: slots 0–1
    bootstrap = [
        {
            'slot': 0, 'name': 'Boot.NS', 'token': None,
            'header_word': None, 'cw': None, 'cc': None,
            'location': ns_table_base, 'perms': ['R', 'W'], 'source': 'BRAM (boot ROM)',
            'checks': [{'label': 'BRAM', 'ok': True, 'detail': 'Baked into BRAM at NS_TABLE_BASE'}],
        },
        {
            'slot': 1, 'name': 'Boot.Thread', 'token': None,
            'header_word': None, 'cw': None, 'cc': None,
            'location': thread_base, 'perms': ['R', 'W'], 'source': 'BRAM (boot ROM)',
            'checks': [{'label': 'BRAM', 'ok': True, 'detail': 'Thread lump baked into BRAM'}],
        },
    ]

    # Resident MMIO: slots 2–5
    resident = [
        {'slot': 2, 'name': 'UART_DEV',  'token': None, 'header_word': 'MMIO', 'cw': None, 'cc': None,
         'location': mmio_uart,  'perms': ['R', 'W'], 'source': 'boot ROM',
         'checks': [{'label': 'MMIO', 'ok': True, 'detail': f'MMIO at {mmio_uart}'}]},
        {'slot': 3, 'name': 'LED_DEV',   'token': None, 'header_word': 'MMIO', 'cw': None, 'cc': None,
         'location': mmio_led,   'perms': ['R', 'W'], 'source': 'boot ROM',
         'checks': [{'label': 'MMIO', 'ok': True, 'detail': f'MMIO at {mmio_led}'}]},
        {'slot': 4, 'name': 'BTN_DEV',   'token': None, 'header_word': 'MMIO', 'cw': None, 'cc': None,
         'location': mmio_btn,   'perms': ['R'],      'source': 'boot ROM',
         'checks': [{'label': 'MMIO', 'ok': True, 'detail': f'MMIO at {mmio_btn}'}]},
        {'slot': 5, 'name': 'TIMER_DEV', 'token': None, 'header_word': 'MMIO', 'cw': None, 'cc': None,
         'location': mmio_timer, 'perms': ['R', 'W'], 'source': 'boot ROM',
         'checks': [{'label': 'MMIO', 'ok': True, 'detail': f'MMIO at {mmio_timer}'}]},
    ]

    # Slot 6 — SelfTest LUMP
    st_token = '00000600'
    st_lump = os.path.join(_LUMPS_DIR, st_token + '.lump')
    st_hdr = _ba_read_lump_header(st_lump) if os.path.exists(st_lump) else None
    st_checks = _lump_checks(selftest_slot, st_token,
                             manifest_by_slot.get(selftest_slot),
                             st_lump, is_selftest=True)
    resident.append({
        'slot': selftest_slot, 'name': 'SelfTest ⚡',
        'token': st_token,
        'header_word': f'0x{st_hdr[0]:08X}' if st_hdr else None,
        'cw': st_hdr[1] if st_hdr else None, 'cc': st_hdr[2] if st_hdr else None,
        'location': selftest_base, 'perms': ['E'], 'source': 'server/lumps',
        'checks': st_checks,
    })

    # Slot 7 — WukongCallHome LUMP
    wch_entry = manifest_by_slot.get(callhome_slot)
    wch_token = wch_entry.get('token') if wch_entry else None
    # Also scan for WukongCallHome_v* files
    if not wch_token:
        cands = sorted([fn for fn in os.listdir(_LUMPS_DIR)
                       if 'WukongCallHome' in fn and fn.endswith('.lump')])
        if cands:
            wch_token = cands[-1].replace('.lump', '')
    wch_lump = _ba_lump_file_for_token(wch_token) if wch_token else None
    wch_hdr = _ba_read_lump_header(wch_lump) if wch_lump else None
    wch_checks = _lump_checks(callhome_slot, wch_token, wch_entry, wch_lump)
    resident.append({
        'slot': callhome_slot, 'name': 'WukongCallHome',
        'token': wch_token,
        'header_word': f'0x{wch_hdr[0]:08X}' if wch_hdr else None,
        'cw': wch_hdr[1] if wch_hdr else None, 'cc': wch_hdr[2] if wch_hdr else None,
        'location': callhome_base, 'perms': ['E'], 'source': 'server/lumps',
        'checks': wch_checks,
    })

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

    # ── Lazy-load (manifest ns_slot >= 8) ─────────────────────────────────
    lazy = []
    for slot_num in sorted(manifest_by_slot.keys()):
        if slot_num < ns_slot_count:
            continue  # already in resident
        entry = manifest_by_slot[slot_num]
        token = entry.get('token')
        lump_path = _ba_lump_file_for_token(token)
        hdr = _ba_read_lump_header(lump_path) if lump_path else None
        checks = _lump_checks(slot_num, token, entry, lump_path)
        lazy.append({
            'slot': slot_num,
            'name': entry.get('abstraction', '?'),
            'token': token,
            'header_word': f'0x{hdr[0]:08X}' if hdr else None,
            'cw': hdr[1] if hdr else (entry.get('cw')),
            'cc': hdr[2] if hdr else (entry.get('cc')),
            'location': None,
            'perms': entry.get('grants', []),
            'source': 'manifest (lazy)',
            'checks': checks,
        })

    # Manifest entries with ns_slot=None or dynamic
    for entry in manifest_no_slot:
        token = entry.get('token')
        policy = entry.get('ns_slot_policy', 'dynamic')
        if policy == 'dynamic':
            lump_path = _ba_lump_file_for_token(token)
            hdr = _ba_read_lump_header(lump_path) if lump_path else None
            checks = _lump_checks(None, token, entry, lump_path)
            lazy.append({
                'slot': '(dynamic)',
                'name': entry.get('abstraction', '?'),
                'token': token,
                'header_word': f'0x{hdr[0]:08X}' if hdr else None,
                'cw': hdr[1] if hdr else entry.get('cw'),
                'cc': hdr[2] if hdr else entry.get('cc'),
                'location': None,
                'perms': entry.get('grants', []),
                'source': 'manifest (dynamic)',
                'checks': checks,
            })

    return {
        'tiers': {
            'bootstrap': bootstrap,
            'resident':  resident,
            'lazy':      lazy,
            'unused':    [],
        },
        'ns_table_base': ns_table_base,
        'ns_slot_count': ns_slot_count,
    }

def _resolve_lump_path(token8, lumps_dir=None):
    """Return the filesystem path to a token's .lump file, or None.

    Checks the token-named file first (fast path for token-native lumps and
    symlinks), then falls back to the manifest 'filename' field for lumps that
    were migrated to canonical ``DotName.N.hash.lump`` names.
    """
    if not token8:
        return None
    if lumps_dir is None:
        lumps_dir = _LUMPS_DIR
    token_path = os.path.join(lumps_dir, token8 + '.lump')
    if os.path.isfile(token_path):
        return token_path
    # Fall back to manifest canonical filename
    manifest_path = os.path.join(lumps_dir, 'manifest.json')
    try:
        manifest = _read_manifest_safe(manifest_path)
        for entry in manifest:
            if entry.get('token') == token8:
                fn = entry.get('filename', '')
                if fn:
                    p = os.path.join(lumps_dir, fn)
                    if os.path.isfile(p):
                        return p
    except Exception:
        pass
    return None


def _resolve_sidecar_path(token8, lumps_dir=None):
    """Return the filesystem path to a token's .json sidecar, or None.

    Checks the token-named file first, then falls back to the manifest
    'sidecar_file' field for canonically-renamed lumps.
    """
    if not token8:
        return None
    if lumps_dir is None:
        lumps_dir = _LUMPS_DIR
    token_path = os.path.join(lumps_dir, token8 + '.json')
    if os.path.isfile(token_path):
        return token_path
    manifest_path = os.path.join(lumps_dir, 'manifest.json')
    try:
        manifest = _read_manifest_safe(manifest_path)
        for entry in manifest:
            if entry.get('token') == token8:
                sf = entry.get('sidecar_file', '')
                if sf:
                    p = os.path.join(lumps_dir, sf)
                    if os.path.isfile(p):
                        return p
    except Exception:
        pass
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


def _ba_build_worker(key_path):
    """Background thread: SSH to droplet, start Vivado in tmux, stream log."""
    global _ba_build_log, _ba_build_done, _ba_build_exit

    ssh_base = [
        'ssh', '-i', key_path,
        '-o', 'StrictHostKeyChecking=accept-new',
        '-o', 'ConnectTimeout=15',
        f'{_DROPLET_USER}@{_DROPLET_IP}',
    ]

    def _append(line):
        with _ba_build_lock:
            _ba_build_log.append(line)

    def _finish(code):
        global _ba_build_done, _ba_build_exit
        with _ba_build_lock:
            _ba_build_done = True
            _ba_build_exit = code

    _append('🔗 Connecting to build droplet…')

    try:
        # 1. Kill any existing session + start new tmux Vivado build
        launch_cmd = (
            f'cd {_DROPLET_BUILD_DIR} && '
            f'tmux kill-session -t {_VIVADO_SESSION} 2>/dev/null; '
            f'tmux new-session -d -s {_VIVADO_SESSION} '
            f"'source /opt/Xilinx/2026.1/Vivado/settings64.sh && "
            f"vivado -mode batch -source wukong_xc7a100t.tcl "
            f"> vivado_cm.log 2>&1; echo EXIT_$? >> vivado_cm.log'"
        )
        r = subprocess.run(ssh_base + [launch_cmd],
                           capture_output=True, text=True, timeout=30)
        if r.returncode != 0:
            _append(f'❌ SSH launch failed (exit {r.returncode}):')
            _append(r.stderr.strip() or '(no error output)')
            _finish(r.returncode)
            return

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

            # Check for exit marker
            exit_code = None
            for ln in new_lines:
                m = re.match(r'EXIT_(\d+)', ln.strip())
                if m:
                    exit_code = int(m.group(1))
                    break

            if exit_code is not None:
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
    global _ba_build_log, _ba_build_done, _ba_build_exit

    ok, err = _ba_validate_build_auth()
    if not ok:
        return err

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

    t = threading.Thread(target=_ba_build_worker, args=(key_path,), daemon=True)
    t.start()

    return jsonify({'ok': True, 'message': 'Build started — poll /api/wukong-build/status'})

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
    return jsonify({'log': log, 'done': done, 'exit_code': exit_code})

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
        # Only the bootstrap (slots 0-1, baked into BRAM) and resident (slots
        # 2-7, in the boot ROM) tiers affect the Vivado bitstream.  Lazy/dynamic
        # slots are fetched at runtime by the IDE — stale manifest entries and
        # missing legacy LUMP files in those tiers are informational and must not
        # block synthesis approval.
        def _snap_all_pass(m):
            for tier_name in ('bootstrap', 'resident'):
                for s in m.get('tiers', {}).get(tier_name, []):
                    for c in s.get('checks', []):
                        if c.get('ok') is False:
                            return False
            return True
        all_pass = _snap_all_pass(ns_map)
        now_str = _ba_datetime.datetime.utcnow().strftime('%Y%m%dT%H%M%SZ')
        filename = f'build-approval-{now_str}.json'
        snap = {
            'frozen_at': now_str,
            'all_checks_pass': all_pass,
            'ns_map': ns_map,
        }
        path = os.path.join(_BUILD_SNAPSHOTS_DIR, filename)
        with open(path, 'w') as f:
            json.dump(snap, f, indent=2)
        return jsonify({'ok': True, 'filename': filename, 'frozen_at': now_str,
                        'all_checks_pass': all_pass})
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


if __name__ == "__main__":
    _port = int(os.environ.get("E2E_PORT", 5000))
    logging.info("Starting Church Machine server on port %d", _port)
    _bind_with_retry(_port)
