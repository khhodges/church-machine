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

_SERVER_DIR = os.path.dirname(os.path.abspath(__file__))
if _SERVER_DIR not in sys.path:
    sys.path.insert(0, _SERVER_DIR)

import boot_image as _boot_image_gen
try:
    from boot_constants import NUC_CODE_WORDS, DEMO_CLIST_SIZE, BOOT_ABSTR_DEFAULT_SIZE
except ImportError:
    from server.boot_constants import NUC_CODE_WORDS, DEMO_CLIST_SIZE, BOOT_ABSTR_DEFAULT_SIZE
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
        response.headers["Cache-Control"] = "no-cache, must-revalidate"
        response.headers["Pragma"] = "no-cache"
        response.headers["Expires"] = "0"
    response.headers["Permissions-Policy"] = "serial=(self)"
    return response

@app.route("/dl/ti60v")
def download_ti60v():
    v_path = os.path.join(os.path.dirname(__file__), "..", "build", "church_ti60_f225.v")
    return send_file(os.path.abspath(v_path),
                     as_attachment=True,
                     download_name="church_ti60_f225.v",
                     mimetype="text/plain")

@app.route("/dl/pnr-sh")
def download_pnr_sh():
    p = os.path.join(os.path.dirname(__file__), "..", "hardware", "soc_combined", "run_efx_pnr.sh")
    return send_file(os.path.abspath(p),
                     as_attachment=True,
                     download_name="run_efx_pnr.sh",
                     mimetype="text/plain")

@app.route("/dl/pgm-sh")
def download_pgm_sh():
    p = os.path.join(os.path.dirname(__file__), "..", "hardware", "soc_combined", "run_efx_pgm.sh")
    return send_file(os.path.abspath(p),
                     as_attachment=True,
                     download_name="run_efx_pgm.sh",
                     mimetype="text/plain")

@app.route("/dl/patch-sapphire")
def download_patch_sapphire():
    p = os.path.join(os.path.dirname(__file__), "..", "scripts", "patch_sapphire_init.py")
    return send_file(os.path.abspath(p),
                     as_attachment=True,
                     download_name="patch_sapphire_init.py",
                     mimetype="text/plain")

@app.route("/dl/map-sh")
def download_map_sh():
    p = os.path.join(os.path.dirname(__file__), "..", "hardware", "soc_combined", "run_efx_map.sh")
    return send_file(os.path.abspath(p),
                     as_attachment=True,
                     download_name="run_efx_map.sh",
                     mimetype="text/plain")

@app.route("/dl/peri-xml")
def download_peri_xml():
    p = os.path.join(os.path.dirname(__file__), "..", "hardware", "soc_combined", "church_soc_cm.peri.xml")
    return send_file(os.path.abspath(p),
                     as_attachment=True,
                     download_name="church_soc_cm.peri.xml",
                     mimetype="text/xml")

@app.route("/dl/ti60zip")
def download_ti60zip():
    import zipfile, io, re as _re
    base = os.path.dirname(__file__)
    hw   = os.path.abspath(os.path.join(base, "..", "hardware"))
    bld  = os.path.abspath(os.path.join(base, "..", "build"))
    docs = os.path.abspath(os.path.join(base, "..", "docs"))
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        # Verilog source
        v = os.path.join(bld, "church_ti60_f225.v")
        if os.path.exists(v):
            zf.write(v, "church_ti60_f225.v")
        # Project XML — fix path so .v sits flat alongside .xml
        xml_path = os.path.join(hw, "ti60_f225_project.xml")
        if os.path.exists(xml_path):
            with open(xml_path) as f:
                xml = f.read()
            xml = xml.replace("../build/church_ti60_f225.v", "church_ti60_f225.v")
            xml = _re.sub(r'<efx:inter_file name="[^"]*"/>',
                          '<efx:inter_file name="church_ti60_f225.peri.xml"/>', xml)
            zf.writestr("church_ti60_f225.xml", xml)
        # Constraints + periphery
        for src, arc in [
            (os.path.join(hw, "ti60_f225.sdc"),      "church_ti60_f225.sdc"),
            (os.path.join(hw, "ti60_f225.peri.xml"), "church_ti60_f225.peri.xml"),
        ]:
            if os.path.exists(src):
                zf.write(src, arc)
        # DesignAPI PLL script, Makefile, and build instructions
        setup = os.path.join(hw, "setup_ti60_peri.py")
        if os.path.exists(setup):
            zf.write(setup, "setup_ti60_peri.py")
        makefile = os.path.join(hw, "Makefile.ti60")
        if os.path.exists(makefile):
            zf.write(makefile, "Makefile")
        # Pre-built bitstream — user can flash immediately without synthesising
        bitstreams = os.path.abspath(os.path.join(base, "..", "bitstreams"))
        hex_src = os.path.join(bitstreams, "church_ti60_f225.hex")
        if os.path.exists(hex_src):
            zf.write(hex_src, "outflow/church_ti60_f225.hex")
        zf.writestr("BUILD.md", BUILD_MD_TI60)
        # Serial bridge script (needed to connect the board to the IDE)
        bridge = os.path.join(base, "local_bridge.py")
        if os.path.exists(bridge):
            zf.write(bridge, "local_bridge.py")
        # Patch script (needed for SoC+CM firmware embedding)
        patch_script = os.path.join(base, "..", "scripts", "patch_sapphire_init.py")
        if os.path.exists(patch_script):
            zf.write(patch_script, "scripts/patch_sapphire_init.py")
        # SoC+CM combined source (full rebuild path — see Case 3 in BUILD.md)
        soc_combined = os.path.join(hw, "soc_combined")
        if os.path.isdir(soc_combined):
            for root, _dirs, files in os.walk(soc_combined):
                for fn in files:
                    full = os.path.join(root, fn)
                    arc = os.path.join("SoC", os.path.relpath(full, soc_combined))
                    zf.write(full, arc)
        # PDFs
        for pdf, arc in [
            ("introducing-cloomc.pdf",  "docs/Introducing CLOOMC.pdf"),
            ("hardware-ti60-f225.pdf",  "docs/Ti60 Hardware Guide.pdf"),
            ("cloomc-foundation.pdf",   "docs/Architecture Reference.pdf"),
            ("instruction-set.pdf",     "docs/Instruction Set Reference.pdf"),
        ]:
            src = os.path.join(docs, pdf)
            if os.path.exists(src):
                zf.write(src, arc)
    buf.seek(0)
    return send_file(buf, as_attachment=True,
                     download_name="church_ti60_f225_project.zip",
                     mimetype="application/zip")

@app.route("/dl/ti60peri")
def download_ti60peri():
    peri_path = os.path.join(os.path.dirname(__file__), "..", "hardware", "ti60_f225.peri.xml")
    return send_file(os.path.abspath(peri_path),
                     as_attachment=True,
                     download_name="church_ti60_f225.peri.xml",
                     mimetype="text/xml")

@app.route("/api/releases")
def api_releases():
    import hashlib as _hashlib
    manifest_path = os.path.join(os.path.dirname(__file__), "releases", "manifest.json")
    verilog_path  = os.path.join(os.path.dirname(__file__), "..", "build", "church_ti60_f225.v")
    try:
        with open(manifest_path) as _f:
            manifest = json.load(_f)
    except Exception as _e:
        return jsonify({"ok": False, "error": str(_e)}), 500
    latest_ver = manifest.get("latest")
    release = next((r for r in manifest.get("releases", []) if r["version"] == latest_ver), None)
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
    verilog_path  = os.path.join(os.path.dirname(__file__), "..", "build", "church_ti60_f225.v")
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
        "board":           "ti60-f225",
        "description":     data.get("description", ""),
        "boot_rom_words":  data.get("boot_rom_words", []),
        "verilog_sha256":  sha,
        "verilog_download": "/dl/ti60v",
        "zip_download":     "/dl/ti60zip",
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
    "tang-nano-20k-iot": {
        "label": "Sipeed Tang Nano 20K",
        "totalRamWords": 16384,
        "addressBits": 16,
        "addressRange": "0x0000_0000 – 0x0000_FFFF (64 KB byte-addressable)",
        "notes": "Gowin GW2AR-18 + BL702 call-home — 64 KB block SRAM available for namespace",
    },
    "ti60-f225": {
        "label": "Efinix Ti60 F225",
        "totalRamWords": 65536,
        "addressBits": 18,
        "addressRange": "0x0000_0000 – 0x0003_FFFF (256 KB byte-addressable)",
        "notes": "Efinix Titanium Ti60 F225 — ~256 KB embedded RAM available for namespace",
    },
    "wukong-xc7a100t": {
        "label": "QMTECH Wukong Artix-7 XC7A100T",
        "totalRamWords": 131072,
        "addressBits": 17,
        "addressRange": "0x0000_0000 – 0x0001_FFFF (512 KB byte-addressable)",
        "notes": "Xilinx Artix-7 XC7A100T — 4,860 Kb BRAM (≈607 KB total); 512 KB allocated for namespace; Vivado 2020+ required for P&R",
    },
}

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
# How many named NS entries the simulator's default abstraction catalog
# writes during _initNamespaceTable() (Boot.NS, Boot.Thread, Boot.Abstr,
# Salvation, …, Circle — slots 0..46). This is the baseline that Step 3
# empty-slot reservation must fit on top of, NOT just the foundational +
# device + Step 2 catalog slots — the simulator writes the whole default
# abstraction catalog regardless of what's in Step 2. Keep in sync with
# simulator.js _getAbstractionCatalog() default list length.
BASE_NAMED_NS_COUNT = 47

# Slots reserved for foundational lumps (Step 1) and device MMIO regions —
# the programmer cannot place an additional resident lump body here. Slots
# 0–3 are foundational lumps (NS, Thread, free/null slot 2, Boot.Abstr);
# 11–15 are device register windows (UART, LED, Button, Timer, Display)
# backed by hardware MMIO not by lump memory.
RESERVED_NS_SLOTS = set(range(0, 4)) | set(range(11, 16))

# Slot 2 is a free/null region (64 words) after Boot.Abstr director elimination (Task #247).
# Still counted in the foundational footprint so Boot.Abstr (slot 3) stays at 0x0180.
FREE_SLOT_SIZE = 64  # keep in sync with simulator.js SLOT_SIZE and boot_image.py
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
    _ns_slots_max_v2 = int(step1.get("nsSlotsMax") or MAX_NS_ENTRIES)
    NS_TABLE_RESERVE = _boot_image_gen.ns_table_reserve_words(_ns_slots_max_v2)
    total = step1["totalNamespaceWords"]
    # Determine actual Boot.Abstr size from saved 00000300.lump (Task #568).
    # A resident step-2 lump must not overlap whichever Boot.Abstr will actually be placed.
    _abstr_size_for_validation = BOOT_ABSTR_DEFAULT_SIZE
    _saved_abstr_path = os.path.join(LUMPS_DIR, '00000300.lump')
    if os.path.isfile(_saved_abstr_path):
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
                # Use the same validation criteria as generate_boot_image() (Task #568)
                # so that "placed size" is computed consistently between generation and
                # validation; an invalid/truncated lump falls back to BOOT_ABSTR_DEFAULT_SIZE.
                if (_magic == 0x1F and
                        64 <= _declared <= 16384 and
                        _n_words >= _declared and
                        _cw >= 1 and _cc >= 1 and _cc <= _declared):
                    _abstr_size_for_validation = _declared
        except OSError:
            pass
    foundation_end = (step1["namespaceLumpWords"] +
                      step1["threadLumpWords"] +
                      FREE_SLOT_SIZE +                  # free/null slot 2 (64 words — Task #247)
                      _abstr_size_for_validation)       # Boot.Abstr: saved lump size or 64w default
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
    if end > MAX_NS_ENTRIES:
        return (f"step3.emptySlotCount ({n}) plus the {BASE_NAMED_NS_COUNT} "
                f"named NS slots written at boot would need {end} entries "
                f"but the NS table only holds {MAX_NS_ENTRIES}")
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
                      step1["threadLumpWords"] +
                      FREE_SLOT_SIZE +               # free/null slot 2 (64 words — Task #247)
                      BOOT_ABSTR_DEFAULT_SIZE)        # Boot.Abstr (slot 3) — always 64w minimum
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
    # The simulator reserves the top NS_TABLE_RESERVE words of the namespace
    # window for the namespace table itself.  Reserve size is now dynamic:
    # nextPow2(nsSlotsMax × 4).
    _ns_slots_max_v1 = int(_raw_ns_slots_max or MAX_NS_ENTRIES)
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
    try:
        with open(BOOT_CONFIG_PATH, "w") as f:
            json.dump(cfg, f, indent=2)
    except Exception as e:
        return jsonify({"ok": False, "error": f"Failed to write boot-config.json: {e}"}), 500
    return jsonify({"ok": True, "config": cfg})

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
LUMPS_DIR = os.path.dirname(LUMPS_MANIFEST_PATH)

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
    try:
        blob = _boot_image_gen.generate_boot_image(cfg, LUMPS_DIR, boot_entry_slot=entry_slot)
    except Exception as e:
        return jsonify({"ok": False, "error": f"Generator failed: {e}"}), 500
    try:
        with open(BOOT_IMAGE_PATH, "wb") as f:
            f.write(blob)
    except Exception as e:
        return jsonify({"ok": False, "error": f"Failed to write boot-image.bin: {e}"}), 500
    return jsonify({
        "ok": True,
        "bytes": len(blob),
        "words": len(blob) // 4,
        "downloadUrl": "/api/boot-image/download",
        "binaryUrl": "/api/boot-image/binary",
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

@app.route("/api/boot-image/binary", methods=["GET"])
def boot_image_binary():
    """Same file as /download, served inline so the simulator can fetch
    it as an ArrayBuffer at boot without triggering a download dialog."""
    if not os.path.isfile(BOOT_IMAGE_PATH):
        return jsonify({"error": "boot-image.bin not generated yet"}), 404
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
    _ns_slots_max_mf = int(step1.get("nsSlotsMax") or _boot_image_gen.MAX_NS_ENTRIES)
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
        <li>Connect a Ti60 F225, Tang Nano 20K, or Wukong board via WebSerial</li>
        <li>The board sends call-home telemetry to the IDE on every fault event</li>
        <li>Open the <strong>Dashboard</strong> to see live MTBF scores per namespace slot</li>
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
        <div class="lc-desc">One-click proof-of-life for the Ti60 F225 via WebSerial to start receiving telemetry.</div>
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
<title>Church Machine — Ti60 F225 Download</title>
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

<h1>&#x2B21; Church Machine — Ti60 F225</h1>
<div class="tag">Efinix Ti60 F225 &middot; JTAG &middot; Everything in one ZIP &nbsp;&middot;&nbsp;
  <a href="https://www.digikey.com/en/products/detail/efinix-inc./TI60F225C-DK/15672425"
     target="_blank" rel="noopener"
     style="color:#4ade80;text-decoration:none;">&#x1F6D2; Buy the Ti60 F225 Dev Kit on Digi-Key</a>
</div>

<div class="hero">
  <div class="hero-title">Complete build package &amp; pre-built bitstream</div>
  <div class="hero-sub">One download. Extract, then <code>make flash</code> — board running in under a minute.</div>
  <a class="dl-btn" href="/dl/ti60zip"><span class="dl-btn-icon">&#x2B07;</span>Download church_ti60_f225_project.zip</a>
  <div class="hero-meta">Includes Verilog source &middot; Efinity project &middot; pre-built .hex &middot; Makefile &middot; PDFs</div>
</div>

<div class="box-title">&#x1F4E6; What&rsquo;s inside the ZIP</div>
<div class="contents-grid">
  <div class="highlight"><span class="file">outflow/church_ti60_f225.hex</span><span class="note"> — pre-built bitstream ✓</span></div>
  <div><span class="file">church_ti60_f225.xml</span><span class="note"> — Efinity project</span></div>
  <div><span class="file">church_ti60_f225.v</span><span class="note"> — Verilog source</span></div>
  <div><span class="file">church_ti60_f225.sdc</span><span class="note"> — timing constraints</span></div>
  <div><span class="file">church_ti60_f225.peri.xml</span><span class="note"> — periphery I/O</span></div>
  <div><span class="file">setup_ti60_peri.py</span><span class="note"> — DesignAPI PLL script</span></div>
  <div><span class="file">Makefile</span><span class="note"> — peri / efinity / flash / clean</span></div>
  <div><span class="file">BUILD.md</span><span class="note"> — full instructions</span></div>
  <div><span class="file">docs/</span><span class="note"> — PDF documentation bundle</span></div>
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
      <pre>make flash</pre>
      <p>Uses <code>~/oss-cad-suite/bin/openFPGALoader</code> with the included <code>outflow/church_ti60_f225.hex</code>.<br>
      No Efinity IDE or synthesis needed.</p>
      <p class="alt">Or via Efinity: <strong>Tool → Programmer</strong> → Efinix USB2.0 Device → JTAG → load <code>outflow/church_ti60_f225.hex</code> → Program.</p>
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
      <p>Open the <a href="/simulator" style="color:#a78bfa">Church Machine IDE</a> → click <strong>&#x1F50C; Connect Ti60</strong> → pick your board from the list. The IDE uploads the boot image automatically and the Church Machine starts running.</p>
    </div>
  </div>
</div>

<hr class="step-divider">

<details>
  <summary>&#x1F527; Rebuild the bitstream from source (Efinity toolchain required)</summary>
  <div class="steps" style="margin-top:1rem">
    <div class="step">
      <div class="step-num">1</div>
      <div class="step-body">
        <strong>Generate the periphery XML</strong>
        <pre>make peri</pre>
        <p>Runs <code>setup_ti60_peri.py</code> via Efinity&rsquo;s Python. You should see <em>SUCCESS — church_ti60_f225.peri.xml written</em>.</p>
      </div>
    </div>
    <div class="step">
      <div class="step-num">2</div>
      <div class="step-body">
        <strong>Open Efinity IDE</strong>
        <pre>make efinity</pre>
        <p>Then <strong>File → Open Project → <code>church_ti60_f225.xml</code></strong></p>
      </div>
    </div>
    <div class="step">
      <div class="step-num">3</div>
      <div class="step-body">
        <strong>Synthesise &amp; generate bitstream</strong>
        <p>Run <strong>Synthesis → Place &amp; Route → Generate Bitstream</strong> (~30 min). Efinity writes <code>outflow/church_ti60_f225.hex</code> when done.</p>
      </div>
    </div>
    <div class="step">
      <div class="step-num">4</div>
      <div class="step-body">
        <strong>Flash</strong>
        <pre>make flash</pre>
      </div>
    </div>
  </div>
</details>

<hr class="step-divider">

<div class="box-title" style="margin-bottom:.8rem">&#x1F4BB; Other boards</div>
<div class="other-boards">
  <div class="board-card">
    <h3>QMTECH Wukong XC7A100T</h3>
    <div class="board-tag">Vivado 2020.x+ &middot; JTAG</div>
    <a href="/api/download/fpga-zip?board=wukong-xc7a100t">&#x2B07; Download ZIP</a>
  </div>
  <div class="board-card">
    <h3>Sipeed Tang Nano 20K</h3>
    <div class="board-tag">OSS CAD Suite &middot; Gowin</div>
    <a href="/api/download/fpga-zip?board=tang-nano-20k-iot">&#x2B07; Download ZIP</a>
  </div>
</div>

<p class="back"><a href="/">&larr; Home</a> &nbsp;&middot;&nbsp; <a href="/release/r1">Release 1 Documents</a> &nbsp;&middot;&nbsp; <a href="/simulator">IDE</a></p>
</body></html>"""
    return html

_SIMULATOR_HTML_VERSION = "r20260529b"
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
    # Redirect to a versioned URL that the proxy has never cached.
    return redirect(f"/simulator/~/{_SIMULATOR_HTML_VERSION}", code=302)

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
        return redirect(f"/simulator/~/{_SIMULATOR_HTML_VERSION}", code=302)
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
        "hardware-tang-nano-20k.md",
        "production_silicon_todo.md",
    ]),
    ("Part X: IDE Design Guide", [
        "IDE-Designer.md",
        "pet-name-language.md",
        "namespace-vocabulary-tutorial.md",
        "method-access-control.md",
        "foundation-lump-design.md",
        "Lump-Architecture.md",
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
    for part_title, filenames in BOOK_CHAPTERS:
        entries = []
        for fname in filenames:
            if fname in all_files:
                filepath = os.path.join(DOCS_DIR, fname)
                size = os.path.getsize(filepath)
                entries.append({"name": fname, "type": "doc", "size": size})
                catalogued.add(fname)
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
    "church_ti60_f225.v":  "text/plain",
    "church_ti60_f225.il": "text/plain",
    "church_tang_nano_20k.v":  "text/plain",
    "church_tang_nano_20k.il": "text/plain",
}

@app.route("/download/ti60_pol.py")
def download_ti60_pol():
    filepath = os.path.join(os.path.dirname(__file__), '..', 'scripts', 'ti60_pol.py')
    filepath = os.path.normpath(filepath)
    if not os.path.isfile(filepath):
        return make_response("Not found", 404)
    with open(filepath, 'r') as f:
        data = f.read()
    resp = make_response(data, 200)
    resp.headers['Content-Type'] = 'text/plain'
    resp.headers['Content-Disposition'] = 'attachment; filename="ti60_pol.py"'
    return resp

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
@app.route("/download/local_bridge.py")
def download_local_bridge():
    """Serve the local serial bridge script for download."""
    bridge_path = os.path.join(os.path.dirname(__file__), "local_bridge.py")
    if not os.path.isfile(bridge_path):
        return make_response("Not found", 404)
    with open(bridge_path, "rb") as f:
        data = f.read()
    resp = make_response(data, 200)
    resp.headers["Content-Type"] = "text/plain"
    resp.headers["Content-Disposition"] = 'attachment; filename="local_bridge.py"'
    return resp

@app.route("/callhome_bridge.py")
@app.route("/download/callhome_bridge.py")
def download_callhome_bridge():
    """Serve the ASCII CALLHOME bridge for Ti60 SoC (hardware/soc_combined/local_bridge.py)."""
    bridge_path = os.path.join(os.path.dirname(__file__), "..", "hardware", "soc_combined", "local_bridge.py")
    bridge_path = os.path.normpath(bridge_path)
    if not os.path.isfile(bridge_path):
        return make_response("Not found", 404)
    with open(bridge_path, "rb") as f:
        data = f.read()
    resp = make_response(data, 200)
    resp.headers["Content-Type"] = "text/plain"
    resp.headers["Content-Disposition"] = 'attachment; filename="callhome_bridge.py"'
    return resp

GITHUB_TOKEN = os.environ.get("GITHUB_TOKEN", "")
GITHUB_LIBRARY_REPO = os.environ.get("GITHUB_LIBRARY_REPO", "khhodges/cloomc-project")
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
        return jsonify({"commits": [], "error": err or "No data"})
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
    return jsonify({"commits": commits})

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

BUILD_MD_TANG = """# Church Machine — Tang Nano 20K Build Package

## What's Inside

- `church_tang_nano_20k.il` — Amaranth RTLIL (always included — the authoritative design)
- `church_tang_nano_20k.v` — Synthesisable Verilog (may be absent if server synthesis timed out)
- `church_tang_nano_20k.json` — Yosys synthesis netlist (may be absent — regenerated by flash.sh)
- `tang_nano_20k.cst` — Pin constraints for GW2AR-LV18QN88C8/I7
- `Makefile` — Build automation (pnr, pack, prog targets)
- `flash.sh` — One-command build + flash script (auto-runs Yosys if JSON is missing)
- `bridge.sh` — Connect the flashed board to the Church Machine IDE
- `local_bridge.py` — Serial bridge server (used by bridge.sh)
- `BUILD.md` — This file

> **Note:** If the server build shows "RTLIL only", the JSON and Verilog files
> were not produced on the server. `flash.sh` detects this automatically and
> runs Yosys synthesis locally before continuing. You just need OSS CAD Suite
> installed (see below).

## Quick Start

### 1. Install OSS CAD Suite + pyserial

```bash
# Linux
curl -L https://github.com/YosysHQ/oss-cad-suite-build/releases/latest/download/oss-cad-suite-linux-x64.tgz | tar xz
# macOS (Apple Silicon)
# curl -L https://github.com/YosysHQ/oss-cad-suite-build/releases/latest/download/oss-cad-suite-darwin-arm64.tgz | tar xz
source oss-cad-suite/environment

pip3 install pyserial
```

### 2. Build and flash

```bash
chmod +x flash.sh bridge.sh
./flash.sh
```

`flash.sh` runs nextpnr-himbaechel, gowin_pack, and openFPGALoader in
sequence. It stops on the first error with a diagnostic hint.

### 3. Verify success — LED checklist

| LED  | Pin | Signal    | Expected after flash          |
|------|-----|-----------|-------------------------------|
| led0 | 15  | Boot/Run  | Solid ON — boot complete      |
| led1 | 16  | Halt      | Blinking — core halted        |
| led2 | 19  | Fault     | OFF — no capability fault     |
| led3 | 20  | Heartbeat | Blinking ~1 Hz — clock alive  |

**One solid + two blinking = success.**

### 4. Connect to IDE

```bash
./bridge.sh --ide=https://cloomc.org
```

The board appears in the IDE **Devices** panel within seconds.

## Alternative: Makefile

If you prefer manual steps:

```bash
make pnr pack    # place-and-route + generate .fs bitstream
make prog        # flash via openFPGALoader
```

## Failure Diagnostic Table

| Symptom | Cause | Fix |
|---------|-------|-----|
| 0 LEDs lit | Flash failed or wrong board | Re-run `./flash.sh`; check USB cable is data-capable |
| 1 solid + 0 blinking | Clock not running | Bad bitstream — rebuild from IDE |
| 1 solid + 1 blinking only | led3 missing from port list | Stale Verilog — click Build in IDE and re-download |
| 2 blinking + 0 solid | Unexpected state | Report with serial log |
| 3 LEDs correct but serial blank | Wrong serial port | Use `/dev/ttyUSB1` (UART), not `/dev/ttyUSB0` (JTAG) |
| 3 LEDs + serial OK but no call-home | Bridge not running or wrong IDE URL | Run `./bridge.sh --ide=URL`; verify URL matches your IDE |
| Board shows offline after 90s | Heartbeat lost | Check USB connection |
| "Cell ledN not found" in nextpnr | Stale Verilog | Rebuild from IDE Builder |

## Device

- **FPGA**: Gowin GW2AR-LV18QN88C8/I7 (nextpnr device: GW2A-LV18QN88)
- **Board**: Sipeed Tang Nano 20K
- **Clock**: 27 MHz crystal
- **UART**: 115200 baud via BL616 USB bridge (pin 17 TX, pin 18 RX)
- **LEDs**: 4 usable (pins 15, 16, 19, 20) — active-low; pins 17–18 used by UART
"""

FLASH_SH = """#!/usr/bin/env bash
set -euo pipefail

RTLIL="church_tang_nano_20k.il"
DEVICE="GW2AR-LV18QN88C8/I7"
FAMILY="GW2A-18C"
JSON="church_tang_nano_20k.json"
VERILOG="church_tang_nano_20k.v"
CST="tang_nano_20k.cst"
FS="church_tang_nano_20k.fs"
FREQ="27"

echo "========================================"
echo " Church Machine — Tang Nano 20K Flash"
echo "========================================"
echo ""

# Step 0: Yosys synthesis (if JSON netlist is missing)
if [ ! -f "$JSON" ] && [ -f "$RTLIL" ]; then
    echo "[0/3] Running Yosys synthesis from RTLIL..."
    if ! yosys -p "read_rtlil $RTLIL; synth_gowin -top top -no-rw-check -json $JSON -vout $VERILOG" 2>&1; then
        echo ""
        echo "FAIL: Yosys synthesis failed."
        echo "  Hint: Ensure OSS CAD Suite is sourced (source oss-cad-suite/environment)"
        exit 1
    fi
    echo "  OK — $JSON generated"
    echo ""
elif [ ! -f "$JSON" ]; then
    echo "ERROR: Neither $JSON nor $RTLIL found."
    echo "  Re-download the build package from the IDE."
    exit 1
fi

# Step 1: Place and Route
echo "[1/3] Place and route (nextpnr-himbaechel)..."
if ! nextpnr-himbaechel --json "$JSON" \\
    --write "${JSON%.json}_pnr.json" \\
    --device "$DEVICE" \\
    --vopt family="$FAMILY" \\
    --vopt cst="$CST" \\
    --freq "$FREQ" 2>&1; then
    echo ""
    echo "FAIL: nextpnr-himbaechel failed."
    echo "  Hint: If you see 'Cell ledN not found', the Verilog is stale."
    echo "  Fix:  Click Build in the IDE and re-download the package."
    exit 1
fi
echo "  OK"
echo ""

# Step 2: Pack bitstream
echo "[2/3] Packing bitstream (gowin_pack)..."
if ! gowin_pack -d "$FAMILY" -o "$FS" "${JSON%.json}_pnr.json" 2>&1; then
    echo ""
    echo "FAIL: gowin_pack failed."
    echo "  Hint: Ensure OSS CAD Suite is sourced (source oss-cad-suite/environment)"
    exit 1
fi
echo "  OK — $FS generated"
echo ""

# Step 3: Flash
echo "[3/3] Flashing to Tang Nano 20K (openFPGALoader)..."
if ! openFPGALoader -b tangnano20k "$FS" 2>&1; then
    echo ""
    echo "FAIL: openFPGALoader failed."
    echo ""
    echo "  Troubleshooting:"
    echo "  1. Unplug USB-C, wait 5 seconds, plug back in, then retry."
    echo "  2. Try a different USB-C cable (some cables have flaky data lines)."
    echo "  3. Press the RESET button on the board while plugged in, then retry."
    echo "  4. Check USB ports:  ls /dev/ttyUSB*"
    echo "     → You should see BOTH ttyUSB0 (JTAG) and ttyUSB1 (UART)."
    echo "     → If only ttyUSB1 appears, the JTAG interface did not enumerate."
    echo "     → Run: dmesg | tail -20  to see kernel USB messages."
    echo "  5. If IDCODE shows 0x00fa00fa — the JTAG link is unstable."
    echo "     This usually means a loose cable or the BL616 needs a power cycle."
    exit 1
fi
echo ""

echo "========================================"
echo " SUCCESS — Church Machine flashed!"
echo "========================================"
echo ""
echo "Check the LEDs now:"
echo "  led0 (pin 15): Solid ON      — boot complete"
echo "  led1 (pin 16): Blinking      — core halted, waiting for code"
echo "  led2 (pin 19): OFF           — no capability fault"
echo "  led3 (pin 20): Blinking ~1Hz — heartbeat (clock alive)"
echo ""
echo "One solid + two blinking = success!"
echo ""
echo "Next step: run ./bridge.sh --ide=https://cloomc.org"
echo "  to connect this board to the Church Machine IDE."
"""

BRIDGE_SH = """#!/usr/bin/env bash
set -euo pipefail

echo "========================================"
echo " Church Machine — Serial Bridge"
echo "========================================"
echo ""

PORT=""
EXTRA_ARGS=()

for arg in "$@"; do
    if [[ "$arg" == /dev/* ]]; then
        PORT="$arg"
    else
        EXTRA_ARGS+=("$arg")
    fi
done

if [ -z "$PORT" ]; then
    for p in /dev/ttyUSB1 /dev/ttyUSB3 /dev/ttyUSB5 /dev/ttyACM0 /dev/ttyACM1; do
        if [ -e "$p" ]; then
            PORT="$p"
            break
        fi
    done
fi

if [ -z "$PORT" ]; then
    echo "ERROR: No serial port found."
    echo "  Plug in the Tang Nano 20K and try again."
    echo "  Expected: /dev/ttyUSB1 (UART channel of BL616)"
    echo "  Override: ./bridge.sh /dev/ttyUSBN [--ide=URL]"
    exit 1
fi

echo "  Serial port: $PORT"
echo ""

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
BRIDGE="$SCRIPT_DIR/local_bridge.py"

if [ ! -f "$BRIDGE" ]; then
    echo "ERROR: local_bridge.py not found in $SCRIPT_DIR"
    exit 1
fi

if ! python3 -c "import serial" 2>/dev/null; then
    echo "ERROR: pyserial not installed.  Run: pip3 install pyserial"
    exit 1
fi

exec python3 "$BRIDGE" "$PORT" "${EXTRA_ARGS[@]}"
"""

BUILD_MD_WUKONG = """# Church Machine — QMTECH Wukong Artix-7 XC7A100T Build Package

## What's Inside

- `church_wukong_xc7a100t.il`  — Amaranth RTLIL (authoritative design source)
- `church_wukong_xc7a100t.v`   — Generic Verilog (Yosys from RTLIL; Vivado synthesises this)
- `wukong_xc7a100t.xdc`        — Vivado XDC pin constraints (clock, UART, LEDs, button)
- `wukong_xc7a100t.tcl`        — Vivado project creation + build script (run once)
- `BUILD.md`                   — This file

## Quick Start

### Step 1 — Open Vivado (2020.x or later)

Extract the zip anywhere. From the Vivado Tcl Console or a shell with Vivado on PATH:

```tcl
cd /path/to/extracted/church-wukong-package
source wukong_xc7a100t.tcl
```

The script creates a project in `vivado_wukong/`, adds `church_wukong_xc7a100t.v` and
`wukong_xc7a100t.xdc`, runs synthesis + implementation, and writes the bitstream to:

```
vivado_wukong/church_wukong_xc7a100t.bit
```

### Step 2 — Flash

Connect the QMTECH Wukong board via JTAG (on-board Digilent HS2 or external programmer).
In Vivado: **Tools → Hardware Manager → Open Target → Program Device**.
Select `church_wukong_xc7a100t.bit` and click **Program**.

Alternatively from a shell with `openocd` (Artix-7 JTAG target):

```bash
openocd -f interface/ftdi/digilent-hs2.cfg -f target/xc7a.cfg \
  -c "init; program vivado_wukong/church_wukong_xc7a100t.bit verify reset exit"
```

### Step 3 — Connect UART

The Wukong board has no built-in USB-UART. Connect an external 3.3 V USB-UART adapter
to PMOD J1 pins 1/2: **TX = H17 (board → host), RX = G17 (host → board)**.

```bash
pip3 install pyserial
python3 local_bridge.py --port /dev/ttyUSB0 --baud 115200
```

The board then appears in the IDE **Devices** panel within seconds.

## LED Pinout (active-LOW — drive low to illuminate)

| LED | Pin | Signal            |
|-----|-----|-------------------|
| LD1 | M26 | Boot in progress  |
| LD2 | N26 | Running / Halted  |
| LD3 | P26 | Fault             |
| LD4 | P25 | Boot complete     |

Hold **KEY1** (P16) for 1 second to exit halted state and enter free-run mode.

## Clock

50 MHz crystal (W19) → MMCM → 100 MHz system clock. The MMCM is instantiated as a
black-box wrapper in the Amaranth Verilog; Vivado infers and constrains it from the XDC.

## Device

- **FPGA**: Xilinx Artix-7 XC7A100T-1FGG676C (101,440 LUTs, 4,860 Kbit BRAM)
- **UART**: 115200 baud — PMOD J1 pins 1/2 (external USB-UART adapter required)
- **Board**: QMTECH Wukong Starter Kit
"""


BUILD_MD_TI60 = """# Church Machine — Efinix Ti60 F225 Build Package

## What's Inside

### Quick-start (CM-only, no toolchain needed)
- `outflow/church_ti60_f225.hex` — **Pre-built bitstream** (flash immediately with `make flash`)
- `Makefile`                  — `make flash` runs openFPGALoader; `make clean` removes outflow

### Full rebuild (CM-only, Efinity toolchain required)
- `church_ti60_f225.xml`      — Efinity project file (open this in Efinity IDE)
- `church_ti60_f225.v`        — RTL Verilog (Yosys from Amaranth RTLIL, no vendor cells)
- `church_ti60_f225.sdc`      — Timing constraints (see Phase A / Phase B notes inside)
- `church_ti60_f225.peri.xml` — Periphery I/O configuration (GPIO banks, UART pins)
- `setup_ti60_peri.py`        — Efinity DesignAPI script to add the PLL (run once before first build)
- `local_bridge.py`           — Serial bridge to connect the board to the IDE

### SoC+CM combined rebuild (SoC firmware + Efinity toolchain required)
- `SoC/`                      — Full source for the Sapphire RISC-V SoC + Church Machine combined bitstream
  - `church_soc_cm.xml`       — Efinity project for the combined SoC+CM build
  - `top.v`                   — Top-level wrapper (SoC + CM + APB3 bridge)
  - `apb3_cm_bridge.v`        — APB3 register bridge (SoC firmware controls CM)
  - `firmware/`               — RISC-V firmware source (`main.c`, `crt0.S`, `link.ld`, `Makefile`)
  - `BUILD_SOC_CM.md`         — Authoritative step-by-step SoC+CM build guide
  - `local_bridge.py`         — Alternative bridge for the SoC+CM configuration
  - `bridge.sh`               — Auto-detects port and launches `local_bridge.py`
  - `Makefile`                — `make firmware` builds the RISC-V firmware
  - `build_soc_cm.sh`         — **One-step script** for Steps 1–5 (IP copy, firmware build, patch)
  - `run_efx_map.sh`          — Run synthesis (`efx_map`) with `work_syn/` auto-created
  - `run_efx_pnr.sh`          — Run place & route (`efx_pnr`) with `work_pnr/` auto-created

### Documentation
- `BUILD.md`                  — This file (you are reading it)
- `docs/`                     — PDF documentation bundle

---

## Case 1 — Flash the pre-built bitstream (no toolchain needed)

The official bitstream is already included in this ZIP at `outflow/church_ti60_f225.hex`.
No synthesis required — just extract the ZIP and flash:

### Step 1 — Extract the ZIP and open a terminal in the folder

```bash
cd /path/to/church_ti60_f225_project
```

### Step 2 — Flash the board

```bash
make flash
```

This runs `openFPGALoader` from `~/oss-cad-suite/bin/` using the included
`outflow/church_ti60_f225.hex`.

Alternatively, via Efinity IDE: **Tool → Programmer**, select
**Efinix USB2.0 Device**, JTAG mode, load `outflow/church_ti60_f225.hex`,
click **Program**.

---

## Case 2 — Rebuild the CM-only bitstream from this ZIP (Efinity toolchain required)

### Step 1 — Extract the ZIP

Unzip `church-ti60-package.zip` into a working folder.

### Step 2 — Run `setup_ti60_peri.py` (required once before first build)

The included `church_ti60_f225.peri.xml` is a placeholder.  Efinity's Interface
Designer requires a file generated by its own DesignAPI — hand-crafted XML is always
rejected.  Run `setup_ti60_peri.py` once from the extracted project folder:

```bash
cd /path/to/church-ti60-package

PYTHONPATH=$HOME/efinity/2025.2/lib:$HOME/efinity/2025.2/pt/bin \\
EFXPT_HOME=$HOME/efinity/2025.2/pt \\
  $HOME/efinity/2025.2/bin/python3.11 setup_ti60_peri.py
```

You should see **SUCCESS — church_ti60_f225.peri.xml written**.

### Step 3 — Launch Efinity IDE

```bash
QT_QPA_PLATFORM=xcb LIBGL_ALWAYS_SOFTWARE=1 ~/efinity/2025.2/bin/efinity &
```

### Step 4 — Open the project

**File → Open Project → `church_ti60_f225.xml`**

### Step 5 — Build the bitstream

Run **Synthesis → Place & Route → Generate Bitstream**.

Efinity writes the output to the `outflow/` folder:

- `outflow/church_ti60_f225.hex` — Intel HEX format (use this for flashing)
- `outflow/church_ti60_f225.bit` — raw bitstream (SPI active-serial format)

### Step 6 — Flash the board

Go to **Tool → Programmer**.
Select **Efinix USB2.0 Device**, JTAG mode.
Load `outflow/church_ti60_f225.hex` and click **Program**.

---

## Case 3 — Rebuild the SoC+CM combined bitstream from source (Efinity + RISC-V toolchain required)

This produces a combined bitstream that includes the Sapphire RISC-V SoC
running firmware alongside the Church Machine.  On boot, the SoC sends
`CHURCH Ti60 SoC+CM v1.1` over **ttyUSB2** (115200 baud) and the CM streams
NIA traces over **ttyUSB3**.

The full authoritative guide is **`SoC/BUILD_SOC_CM.md`** inside this ZIP.
A condensed summary follows:

### Prerequisites

- Efinity 2025.2 (installed at `~/efinity/2025.2`)
- Efinity RISC-V IDE 2025.2 (toolchain at `~/efinity/efinity-riscv-ide-2025.2/toolchain/bin`)
- Sapphire SoC IP (ships with Efinity)
- Python 3 + Amaranth (to generate CM RTL)
- `pyserial` (`pip install pyserial`)
- `openFPGALoader` (`~/oss-cad-suite/bin/openFPGALoader`)

### Quick Start — Run the all-in-one script

The ZIP includes a convenience script that does Steps 1–5 in one command:

```bash
cd /path/to/church_ti60_f225_project
bash SoC/build_soc_cm.sh
```

This copies IP files, builds the firmware, patches `sapphire.v`, and verifies
`optimize-zero-init-rom`. After it finishes, continue with Step 6 below.

---

### Manual Steps (for reference or debugging)

#### Step 1 — Copy the Sapphire SoC IP files

```bash
cp ~/efinity/2025.2/ipm/ip/efx_tsemac/fpga/Ti60F225_devkit/ip/sapphire/sapphire.v \
   SoC/
cp ~/efinity/2025.2/ipm/ip/efx_tsemac/fpga/Ti60F225_devkit/ip/sapphire/sapphire_define.vh \
   SoC/
```

> If the path does not exist: `find ~/efinity -name "sapphire.v" 2>/dev/null`

### Step 2 — Generate the Church Machine RTL

```bash
python hardware/gen_verilog.py --ti60
cp build/church_ti60_f225.v SoC/
```

### Step 3 — Build the SoC firmware

```bash
make -C SoC/firmware
```

Produces four byte-lane symbol files in `SoC/`:
```
EfxSapphireSoc.v_toplevel_system_ramA_logic_ram_symbol{0,1,2,3}.bin
```

### Step 4 — Patch `sapphire.v` with firmware (MUST re-run on every firmware change)

```bash
cd /path/to/church_ti60_f225_project
python3 ../../scripts/patch_sapphire_init.py \
  SoC/sapphire.v \
  SoC/EfxSapphireSoc.v_toplevel_system_ramA_logic_ram_symbol0.bin \
  SoC/EfxSapphireSoc.v_toplevel_system_ramA_logic_ram_symbol1.bin \
  SoC/EfxSapphireSoc.v_toplevel_system_ramA_logic_ram_symbol2.bin \
  SoC/EfxSapphireSoc.v_toplevel_system_ramA_logic_ram_symbol3.bin
```

Expected output:
```
symbol0: 131072 entries, NNN non-zero, [0]=0xXX
  -> replaced $readmemb          ← first run
  OR
  -> updated N inline block(s)   ← subsequent runs
...
sapphire.v OK (+N chars, M total)
```

### Step 5 — Ensure `optimize-zero-init-rom` is off

```bash
grep "optimize-zero-init-rom" SoC/church_soc_cm.xml
# Must show value="0"
```

If it shows `value="1"`:
```bash
sed -i 's/optimize-zero-init-rom" value="1"/optimize-zero-init-rom" value="0"/' \
  SoC/church_soc_cm.xml
```

### Step 6 — Synthesise

```bash
cd /path/to/church_ti60_f225_project
bash SoC/run_efx_map.sh
```

This runs `~/efinity/2025.2/bin/efx_map --project-xml SoC/church_soc_cm.xml` and creates `work_syn/` automatically.

Verify all 4 BRAM lanes have non-zero `INIT_0` (firmware confirmed embedded):
```bash
for sym in 0 1 2 3; do
  LINENUM=$(grep -n "EFX_RAM10" SoC/outflow/church_soc_cm.map.v \\
    | grep "ram_symbol${sym}__D\\$g1" | head -1 | cut -d: -f1)
  echo "symbol${sym}: $(sed -n "${LINENUM},$((LINENUM+3))p" \\
    SoC/outflow/church_soc_cm.map.v | grep INIT_0)"
done
# All four must show non-zero hex strings
```

### Step 7 — Place & Route

```bash
cd /path/to/church_ti60_f225_project
bash SoC/run_efx_pnr.sh
```

This runs `~/efinity/2025.2/bin/efx_pnr SoC/church_soc_cm.xml` (from the `SoC/` directory) and creates `work_pnr/` automatically.

### Step 8 — Generate the SPI flash hex (`efx_pgm`)

```bash
cd SoC
~/efinity/2025.2/bin/efx_pgm church_soc_cm.xml 2>&1 | tail -5
ls -lh outflow/church_soc_cm.hex outflow/church_soc_cm.bit
# Timestamps must be NEWER than the P&R run above
```

> **Note:** P&R does **not** generate the hex; `efx_pgm` does. The `church_soc_cm.xml` already references `church_soc_cm.peri.xml` for pin constraints — open the Efinity GUI once to generate the LPF file if needed.

### Step 9 — Flash and test

```bash
cd /path/to/church_ti60_f225_project
sudo ~/oss-cad-suite/bin/openFPGALoader \
  -b titanium_ti60_f225_jtag \
  -f SoC/outflow/church_soc_cm.hex

sleep 5 && python3 scripts/test_ti60_uart.py \
  --port=/dev/ttyUSB2 --timeout=30 --verbose
```

If the SoC boots correctly, the test script will show:
```
Connected to /dev/ttyUSB2 @ 115200 baud
Waiting for greeting...
← CHURCH Ti60 SoC+CM v1.1
Greeting received!
```

### Step 10 — Connect the board to the IDE

```bash
./SoC/bridge.sh --ide=http://localhost:5000
```

The Ti60 will appear in the Dashboard device list as **Ti60F225**.

---

## Resource Usage (CM-only synthesis result)

- **10,269 LUTs + 5,686 FFs + 970 adders** → **14,323 XLRs placed** (~24% of Ti60)
- `win_mem` (16 KB DEFLATE history window) → EBR block RAM ✓
- `dmem` (64 KB data memory) → EBR block RAM ✓
- Routing converged in 32 iterations

## LED Pinout (active-high, Ti60 F225 Dev Board)

| LED | Ball | Signal            |
|-----|------|-------------------|
| 0   | K14  | Boot in progress  |
| 1   | J15  | Running           |
| 2   | H10  | Fault             |
| 3   | J14  | Boot complete     |

## Device

- **FPGA**: Efinix Titanium Ti60F225 (60,800 LEs, F225 FBGA)
- **Clock**: 25 MHz crystal at ball B2 → PLL_TL0 (M=4 N=1 O=2) → 50 MHz GCLK
- **UART**: 115200 baud — external USB-UART adapter on balls H14 (TX) and M14 (RX)
            (The FT4232H on the Ti60 devkit is JTAG-only; no built-in USB-UART path)
"""


def _fpga_paths(board):
    """Return (is_ti60, paths_dict, zip_name, build_md) for the given board slug."""
    build_dir = os.path.join(BASE_DIR, "build")
    hw_dir = os.path.join(BASE_DIR, "hardware")
    is_ti60 = (board == "ti60-f225")
    if is_ti60:
        paths = {
            "rtlil":   os.path.join(build_dir, "church_ti60_f225.il"),
            "verilog": os.path.join(build_dir, "church_ti60_f225.v"),
            "isf":     os.path.join(hw_dir,    "ti60_f225.isf"),
            "project": os.path.join(hw_dir,    "ti60_f225_project.xml"),
            "peri":    os.path.join(hw_dir,    "ti60_f225.peri.xml"),
            "sdc":     os.path.join(hw_dir,    "ti60_f225.sdc"),
            "setup":   os.path.join(hw_dir,    "setup_ti60_peri.py"),
        }
        zip_name = "church-ti60-package.zip"
        build_md = BUILD_MD_TI60
        gen_args = ["python3", "-m", "hardware.gen_rtlil", "build", "--ti60"]
        synth_cmd_tpl = (
            "read_rtlil {rtlil}; "
            "hierarchy -top top; "
            "proc; flatten; "
            "opt -mux_undef -undriven; opt; opt_reduce; opt_clean; opt -fast; "
            "techmap; clean; "
            "write_verilog -noattr {verilog}"
        )
    elif board == "wukong-xc7a100t":
        paths = {
            "rtlil":   os.path.join(build_dir, "church_wukong_xc7a100t.il"),
            "verilog": os.path.join(build_dir, "church_wukong_xc7a100t.v"),
            "xdc":     os.path.join(hw_dir,    "wukong_xc7a100t.xdc"),
            "tcl":     os.path.join(hw_dir,    "wukong_xc7a100t.tcl"),
        }
        zip_name = "church-wukong-package.zip"
        build_md = BUILD_MD_WUKONG
        gen_args = ["python3", "-m", "hardware.gen_rtlil", "build", "--wukong"]
        synth_cmd_tpl = (
            "read_rtlil {rtlil}; "
            "hierarchy -top top; "
            "proc; flatten; "
            "opt -mux_undef -undriven; opt; opt_reduce; opt_clean; opt -fast; clean; "
            "write_verilog -noattr {verilog}"
        )
    else:
        paths = {
            "rtlil":   os.path.join(build_dir, "church_tang_nano_20k.il"),
            "verilog": os.path.join(build_dir, "church_tang_nano_20k.v"),
            "json":    os.path.join(build_dir, "church_tang_nano_20k.json"),
            "cst":     os.path.join(hw_dir,    "tang_nano_20k.cst"),
            "makefile":os.path.join(hw_dir,    "Makefile"),
        }
        zip_name = "church-nano-package.zip"
        build_md = BUILD_MD_TANG
        gen_args = ["python3", "-m", "hardware.gen_rtlil", "build"]
        synth_cmd_tpl = (
            "read_rtlil {rtlil}; "
            "synth_gowin -top top -no-rw-check -json {json} -vout {verilog}"
        )
    return is_ti60, paths, zip_name, build_md, gen_args, synth_cmd_tpl


def _make_fpga_zip(board, is_ti60, paths, zip_name, build_md):
    """Zip up already-built FPGA artifacts and return (BytesIO, zip_name, warnings)."""
    hw_dir = os.path.join(BASE_DIR, "hardware")
    buf = io.BytesIO()
    warnings = []
    if board == "wukong-xc7a100t":
        bridge_path = os.path.join(BASE_DIR, "server", "local_bridge.py")
        with zipfile.ZipFile(buf, 'w', zipfile.ZIP_DEFLATED) as zf:
            if os.path.isfile(paths["rtlil"]):
                zf.write(paths["rtlil"], os.path.basename(paths["rtlil"]))
            if os.path.isfile(paths["verilog"]):
                zf.write(paths["verilog"], os.path.basename(paths["verilog"]))
            zf.write(paths["xdc"], os.path.basename(paths["xdc"]))
            zf.write(paths["tcl"], os.path.basename(paths["tcl"]))
            if os.path.isfile(bridge_path):
                zf.write(bridge_path, "local_bridge.py")
            else:
                msg = "local_bridge.py not found — bridge.sh will not work until this file is present on the server"
                logging.warning("FPGA zip: %s", msg)
                warnings.append(msg)
            zf.writestr("BUILD.md", build_md)
        return buf, zip_name, warnings
    if is_ti60:
        with open(paths["project"], 'r') as f:
            project_xml = f.read()
        # Fix path so all files sit in the same flat directory
        project_xml = project_xml.replace(
            '../build/church_ti60_f225.v', 'church_ti60_f225.v'
        )
        # Inject peri.xml reference so Efinity can find the periphery configuration.
        # Use regex so this works whether the source XML has name="" or a dev path.
        project_xml = re.sub(
            r'<efx:inter_file name="[^"]*"/>',
            '<efx:inter_file name="church_ti60_f225.peri.xml"/>',
            project_xml
        )
        docs_dir = os.path.join(BASE_DIR, "docs")
        _doc_pdfs = [
            ("introducing-cloomc.pdf",  "docs/Introducing CLOOMC.pdf"),
            ("hardware-ti60-f225.pdf",  "docs/Ti60 Hardware Guide.pdf"),
            ("cloomc-foundation.pdf",   "docs/Architecture Reference.pdf"),
            ("instruction-set.pdf",     "docs/Instruction Set Reference.pdf"),
        ]
        with zipfile.ZipFile(buf, 'w', zipfile.ZIP_DEFLATED) as zf:
            zf.write(paths["verilog"], "church_ti60_f225.v")
            zf.writestr("church_ti60_f225.xml",      project_xml)
            zf.write(paths["sdc"],     "church_ti60_f225.sdc")
            zf.write(paths["peri"],    "church_ti60_f225.peri.xml")
            zf.write(paths["setup"],   "setup_ti60_peri.py")
            makefile_ti60 = os.path.join(hw_dir, "Makefile.ti60")
            if os.path.isfile(makefile_ti60):
                zf.write(makefile_ti60, "Makefile")
            zf.writestr("BUILD.md", build_md)
            # SoC+CM combined source (full rebuild path)
            soc_combined = os.path.join(hw_dir, "soc_combined")
            if os.path.isdir(soc_combined):
                for root, _dirs, files in os.walk(soc_combined):
                    for fn in files:
                        full = os.path.join(root, fn)
                        arc = os.path.join("SoC", os.path.relpath(full, soc_combined))
                        zf.write(full, arc)
            # Pre-built bitstream — quick flash without synthesis
            bitstreams_dir = os.path.join(BASE_DIR, "bitstreams")
            hex_src = os.path.join(bitstreams_dir, "church_ti60_f225.hex")
            bit_src = os.path.join(bitstreams_dir, "church_ti60_f225.bit")
            if os.path.isfile(hex_src):
                zf.write(hex_src, "outflow/church_ti60_f225.hex")
            if os.path.isfile(bit_src):
                zf.write(bit_src, "outflow/church_ti60_f225.bit")
            # Serial bridge script (needed to connect the board to the IDE)
            bridge_path = os.path.join(BASE_DIR, "server", "local_bridge.py")
            if os.path.isfile(bridge_path):
                zf.write(bridge_path, "local_bridge.py")
            else:
                msg = "local_bridge.py not found — bridge.sh will not work until this file is present on the server"
                logging.warning("FPGA zip: %s", msg)
                warnings.append(msg)
            # Patch script (needed for SoC+CM firmware embedding)
            patch_script = os.path.join(BASE_DIR, "scripts", "patch_sapphire_init.py")
            if os.path.isfile(patch_script):
                zf.write(patch_script, "scripts/patch_sapphire_init.py")
            for src_name, arc_name in _doc_pdfs:
                src = os.path.join(docs_dir, src_name)
                if os.path.isfile(src):
                    zf.write(src, arc_name)
    else:
        json_path = paths["json"]
        has_json = os.path.isfile(json_path)
        has_verilog = os.path.isfile(paths["verilog"])
        if has_json:
            with open(json_path, 'r') as f:
                json_text = f.read()
            json_text = json_text.replace('"speed": "ES"', '"speed": "C8"')
            with open(json_path, 'w') as f:
                f.write(json_text)
            logging.info("FPGA zip: patched JSON speed grade (ES -> C8)")
        bridge_path = os.path.join(BASE_DIR, "server", "local_bridge.py")
        with zipfile.ZipFile(buf, 'w', zipfile.ZIP_DEFLATED) as zf:
            if os.path.isfile(paths["rtlil"]):
                zf.write(paths["rtlil"], os.path.basename(paths["rtlil"]))
            if has_verilog:
                zf.write(paths["verilog"],  os.path.basename(paths["verilog"]))
            if has_json:
                zf.write(json_path,         os.path.basename(json_path))
            zf.write(paths["cst"],      os.path.basename(paths["cst"]))
            zf.write(paths["makefile"], "Makefile")
            flash_script = FLASH_SH
            flash_info = zipfile.ZipInfo("flash.sh")
            flash_info.external_attr = 0o755 << 16
            zf.writestr(flash_info, flash_script.lstrip('\n'))
            bridge_info = zipfile.ZipInfo("bridge.sh")
            bridge_info.external_attr = 0o755 << 16
            zf.writestr(bridge_info, BRIDGE_SH.lstrip('\n'))
            if not os.path.isfile(bridge_path):
                msg = "local_bridge.py not found — bridge.sh will not work until this file is present on the server"
                logging.warning("FPGA zip: %s", msg)
                warnings.append(msg)
            else:
                zf.write(bridge_path, "local_bridge.py")
            zf.writestr("BUILD.md", build_md)
    return buf, zip_name, warnings


@app.route("/api/build/fpga")
def build_fpga():
    """Run Amaranth elaboration + Yosys synthesis. Save artifacts to build/. Return JSON status."""
    build_dir = os.path.join(BASE_DIR, "build")
    board = request.args.get("board", "tang-nano-20k-iot").strip().lower()
    is_ti60, paths, zip_name, build_md, gen_args, synth_cmd_tpl = _fpga_paths(board)

    try:
        os.makedirs(build_dir, exist_ok=True)

        logging.info("FPGA build: generating RTLIL from Amaranth (board=%s)...", board)
        gen_result = subprocess.run(gen_args, cwd=BASE_DIR, capture_output=True, text=True, timeout=180)
        if gen_result.returncode != 0:
            return jsonify({
                "error": "Amaranth RTLIL generation failed",
                "stderr": gen_result.stderr[-2000:] if gen_result.stderr else "",
                "stdout": gen_result.stdout[-1000:] if gen_result.stdout else ""
            }), 500

        if not os.path.isfile(paths["rtlil"]):
            return jsonify({"error": "RTLIL file not generated", "stderr": ""}), 500

        fmt_args = {k: v for k, v in paths.items()}
        synth_cmd = synth_cmd_tpl.format(**fmt_args)

        logging.info("FPGA build: running Yosys synthesis...")
        synth_warning = None
        try:
            synth_result = subprocess.run(["yosys", "-p", synth_cmd], cwd=BASE_DIR, capture_output=True, text=True, timeout=300)
            if synth_result.returncode != 0:
                synth_warning = "Yosys synthesis failed (RTLIL still available)"
                logging.warning("Yosys synthesis returned non-zero: %s", synth_result.stderr[-500:] if synth_result.stderr else "")
        except subprocess.TimeoutExpired:
            synth_warning = "Yosys synthesis timed out (RTLIL still available)"
            logging.warning("Yosys synthesis timed out")
        except Exception as synth_exc:
            synth_warning = f"Yosys synthesis error: {synth_exc} (RTLIL still available)"
            logging.warning("Yosys synthesis exception: %s", synth_exc)

        marker_path = os.path.join(build_dir, "_last_board.txt")
        with open(marker_path, 'w') as f:
            f.write(board)

        files = [os.path.basename(p) for p in paths.values() if os.path.isfile(p)]
        file_paths = [p for p in paths.values() if os.path.isfile(p)]
        logging.info("FPGA build: complete, files=%s, warning=%s", files, synth_warning)
        result = {"ok": True, "board": board, "files": files, "file_paths": file_paths}
        if synth_warning:
            result["warning"] = synth_warning
        return jsonify(result)

    except subprocess.TimeoutExpired:
        return jsonify({"error": "Build timed out (300s limit)", "stderr": ""}), 500
    except Exception as e:
        logging.exception("FPGA build failed")
        return jsonify({"error": str(e), "stderr": ""}), 500


@app.route("/api/download/fpga-zip")
def download_fpga_zip():
    """Download the ZIP of the last successfully built FPGA artifacts (no rebuild)."""
    build_dir = os.path.join(BASE_DIR, "build")
    board = request.args.get("board", "tang-nano-20k-iot").strip().lower()
    is_ti60, paths, zip_name, build_md, _, _ = _fpga_paths(board)

    if not os.path.isfile(paths["verilog"]):
        return jsonify({"error": "No build found for this board. Run Build first."}), 404

    try:
        buf, zip_name, zip_warnings = _make_fpga_zip(board, is_ti60, paths, zip_name, build_md)
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
    board = request.args.get("board", "tang-nano-20k-iot").strip().lower()
    is_ti60, paths, _, _, _, _ = _fpga_paths(board)
    verilog_path = paths["verilog"]
    if not os.path.isfile(verilog_path):
        return jsonify({"error": "No build found for this board. Run Build first."}), 404
    filename = os.path.basename(verilog_path)
    return send_file(verilog_path, as_attachment=True, download_name=filename,
                     mimetype="text/plain")


@app.route("/api/download/fpga-sdc")
def download_fpga_sdc():
    """Download just the SDC constraints file for the selected board."""
    board = request.args.get("board", "ti60-f225").strip().lower()
    _, paths, _, _, _, _ = _fpga_paths(board)
    sdc_path = paths.get("sdc")
    if not sdc_path or not os.path.isfile(sdc_path):
        return jsonify({"error": "No SDC found for this board."}), 404
    filename = os.path.basename(sdc_path)
    return send_file(sdc_path, as_attachment=True, download_name=filename,
                     mimetype="text/plain")


@app.route("/api/download/fpga-peri")
def download_fpga_peri():
    """Download just the peri.xml periphery config for the selected board."""
    board = request.args.get("board", "ti60-f225").strip().lower()
    _, paths, _, _, _, _ = _fpga_paths(board)
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
    board = request.args.get("board", "tang-nano-20k-iot").strip().lower()
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
    "tang-nano-20k-iot": "church_tang_nano_20k_iot.fs",
    "ti60-f225": "church_ti60_f225.hex",
    "wukong-xc7a100t": "church_wukong_xc7a100t.bit",
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
        board_label = {
            "ti60-f225":       "Efinix Ti60 F225",
            "wukong-xc7a100t": "QMTECH Wukong Artix-7",
            "tang-nano-20k-iot": "Tang Nano 20K",
        }.get(board, board)
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
                ⬆ Upload
              </button>
            </form>
          </td>
          {"<td><a href='/api/bitstream/delete/" + board + "?token=" + token + "' "
           "onclick=\"return confirm('Delete " + fname + "?')\" "
           "style='color:#ef5350;font-size:0.8rem;text-decoration:none'>🗑 Delete</a></td>"
           if exists else "<td></td>"}
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
    path = os.path.join(BITSTREAM_DIR, expected)
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
    board = request.form.get("board", "tang-nano-20k-iot").strip().lower()
    expected = BITSTREAM_FILES.get(board)
    if not expected:
        return jsonify({"error": f"Unknown board: {board}"}), 400
    f = request.files.get("file")
    if not f:
        return jsonify({"error": "No file uploaded"}), 400
    dest = os.path.join(BITSTREAM_DIR, expected)
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
    path = os.path.join(BITSTREAM_DIR, expected)
    if not os.path.isfile(path):
        return jsonify({"error": f"No bitstream available for {board} yet. Build and upload one first."}), 404
    return send_file(path, as_attachment=True, download_name=expected)


@app.route("/api/bitstream/list")
def bitstream_list():
    """List available official bitstreams."""
    result = []
    for board, fname in BITSTREAM_FILES.items():
        path = os.path.join(BITSTREAM_DIR, fname)
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

_load_bundled_lumps()

# ── Boot Abstraction lump (NS slot 3, "LED flash") ───────────────────────────────
# The boot lump is baked directly into boot-image.bin rather than stored as a
# standalone .lump file.  Extract it at startup so the Lump Repository can show it.

_BOOT_ABSTR_META = {}   # populated by _load_boot_abstr_lump(); empty means not found
_BOOT_NS_META    = {}   # populated by _load_boot_ns_lump();    empty means not found

def _load_boot_abstr_lump():
    """Parse boot-image.bin, extract Boot.Abstr (NS slot 3) and cache in LAZY_LUMPS.

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
        # NS table lives at the last 1024 words of the image.
        ns_table_base = n_words - 1024   # NS_TABLE_RESERVE = 1024
        NS_ENTRY_WORDS = 4
        BOOT_ABSTR_NS_SLOT = 3
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
        LAZY_LUMPS['00000003'] = _struct.pack(f'>{lump_size}I', *lump_words)
        _BOOT_ABSTR_META.update({
            "token":       "00000003",
            "abstraction": "LED flash",
            "ns_slot":     BOOT_ABSTR_NS_SLOT,
            "lump_size":   lump_size,
            "cw":          cw,
            "cc":          cc,
            "lump_type":   "boot",
            "language":    "ISA",
            "description": (
                "Boot Abstraction (Boot.Abstr) — the lump executed by the hardware ROM "
                "during boot phases B:01–B:07.  Loads NS, Thread, and Boot.Abstr lumps, "
                "then CALL CR0 (Thread.CR[0]) enters the configured first abstraction directly."
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
        # SINGLE SOURCE OF TRUTH: LAZY_LUMPS['00000003'] always holds the binary
        # extracted from boot-image.bin above.  We deliberately do NOT override it
        # with any saved programmer lump (00000300.lump) because that would create
        # two different binaries under the same token — one shown by the Code View
        # (which reads sim.memory from boot-image.bin) and another shown by the LUMP
        # panel and audit (which read LAZY_LUMPS).  Any such divergence silently
        # misleads the programmer.  cw / cc / lump_size are authoritative from the
        # boot-image header already set above.
        #
        # Sidecar annotations (author, version, pet_names, capabilities) are
        # programmer-supplied metadata and are safe to merge — they do not affect the
        # binary.  Prefer 00000300.json (written by /api/lumps/save for ns_slot=3);
        # fall back to 00000003.json for backward-compat.
        _saved300_path = os.path.join(os.path.dirname(__file__), 'lumps', '00000300.lump')
        if os.path.isfile(_saved300_path):
            try:
                with open(_saved300_path, 'rb') as _s300f:
                    _s300raw = _s300f.read()
                _s300n = len(_s300raw) // 4
                if _s300n >= 1:
                    _s300words = list(_struct.unpack(f'>{_s300n}I', _s300raw[:_s300n * 4]))
                    _s300hdr  = _s300words[0]
                    _boot_raw = LAZY_LUMPS.get('00000003', b'')
                    if _s300raw[:len(_boot_raw)] != _boot_raw:
                        print('[boot] WARNING: 00000300.lump differs from boot-image.bin binary '
                              '— ignoring saved binary to keep Code View and LUMP panel in sync.',
                              flush=True)
                    else:
                        print('[boot] 00000300.lump matches boot-image.bin binary — consistent.',
                              flush=True)
            except Exception as _e300:
                print(f'[boot] 00000300.lump consistency check failed: {_e300}', flush=True)
        _lumps_dir_sc = os.path.dirname(__file__)
        _sidecar_300 = os.path.join(_lumps_dir_sc, 'lumps', '00000300.json')
        _sidecar_003 = os.path.join(_lumps_dir_sc, 'lumps', '00000003.json')
        _sidecar_path = _sidecar_300 if os.path.isfile(_sidecar_300) else (
            _sidecar_003 if os.path.isfile(_sidecar_003) else None)
        if _sidecar_path:
            try:
                with open(_sidecar_path) as _s03f:
                    _s03 = json.load(_s03f)
                # Only merge annotation fields — never cw/cc/lump_size, which must
                # always reflect the actual boot-image binary already set above.
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
        _ns_slots_max = int(_step1_ns.get("nsSlotsMax") or _boot_image_gen.MAX_NS_ENTRIES)
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

    payload = _lump_with_crc(data)
    resp = Response(payload, mimetype='application/octet-stream',
                    headers={'Content-Length': str(len(payload)),
                             'X-Lump-Source': source})
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

    abs_name   = metadata.get("abstraction", "Unnamed")
    ns_slot    = metadata.get("ns_slot", None)
    token_hint = metadata.get("token", None)

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
            _sl_slt = _sl_ww & 0x7FFF
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
    manifest = []
    if os.path.isfile(manifest_path):
        try:
            with open(manifest_path, 'r') as fh:
                manifest = json.load(fh)
        except Exception:
            manifest = []

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

    lump_filename    = f'{safe_name}_v{next_lump_version}.lump'
    sidecar_filename = f'{safe_name}_v{next_lump_version}.json'
    lump_path        = os.path.join(lumps_dir, lump_filename)
    sidecar_path     = os.path.join(lumps_dir, sidecar_filename)

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

    # ── Phase 5: Write new lump binary ────────────────────────────────────────
    lump_bytes = _struct.pack(f'>{len(words)}I',
                              *[int(w) & 0xFFFFFFFF for w in words])
    with open(lump_path, 'wb') as fh:
        fh.write(lump_bytes)

    LAZY_LUMPS[token8] = lump_bytes
    LAZY_LUMPS[token8.lstrip('0') or '0'] = lump_bytes

    # ── Phase 6: Build and write sidecar JSON ─────────────────────────────────
    sidecar = {
        "token":         token8,
        "abstraction":   abs_name,
        "filename":      lump_filename,
        "sidecar_file":  sidecar_filename,
        "ns_slot":       ns_slot,
        "lump_size":     len(words),
        "typ":           hdr_typ,
        "content_type":  content_type,
        "cw":            metadata.get("cw", 0),
        "cc":            metadata.get("cc", 0),
        "profile":       metadata.get("profile", "IoT"),
        "language":      metadata.get("language", "unknown"),
        "author":        metadata.get("author", ""),
        "version":       metadata.get("version", ""),
        "release_notes": metadata.get("release_notes", ""),
        "methods":       metadata.get("methods", []),
        "capabilities":  metadata.get("capabilities", []),
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
            "target_board": metadata.get("target_board", "ti60-f225"),
            "profile":      metadata.get("profile", "IoT"),
            "built_at":     _dt.datetime.utcnow().isoformat() + "Z",
            "builder":      "CLOOMC++ IDE v1.0"
        },
        "grants": metadata.get("grants", ["E"]),
        "source": metadata.get("source", ""),
    }

    import time as _time_save
    _compiled_at = _time_save.time()
    sidecar["lump_version"] = next_lump_version
    sidecar["compiled_at"]  = _compiled_at

    with open(sidecar_path, 'w') as fh:
        json.dump(sidecar, fh, indent=2)

    # ── Phase 7: Update manifest ───────────────────────────────────────────────
    manifest = [e for e in manifest if e.get('token') != token8]

    vg_key = f"compiled_{abs_name.lower().replace(' ', '_')}"
    if ns_slot is not None:
        for prev_entry in manifest:
            if (prev_entry.get("abstraction") == abs_name
                    and prev_entry.get("ns_slot") == ns_slot
                    and not prev_entry.get("variant_group")):
                prev_entry["variant_group"] = vg_key

    new_entry = {
        "token":         token8,
        "abstraction":   abs_name,
        "filename":      lump_filename,
        "sidecar_file":  sidecar_filename,
        "ns_slot":       ns_slot,
        "lump_size":     len(words),
        "cw":            sidecar["cw"],
        "cc":            sidecar["cc"],
        "author":        sidecar.get("author", ""),
        "version":       sidecar.get("version", ""),
        "lump_version":  next_lump_version,
        "compiled_at":   _compiled_at,
        "methods":       sidecar["methods"],
        "grants":        sidecar["grants"],
    }
    if ns_slot is not None:
        new_entry["variant_group"] = vg_key
    manifest.append(new_entry)

    with open(manifest_path, 'w') as fh:
        json.dump(manifest, fh, indent=2)

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
                _load_boot_abstr_lump()   # refresh _BOOT_ABSTR_META / LAZY_LUMPS['00000003']
                _load_boot_ns_lump()      # refresh _BOOT_NS_META from updated boot-image.bin
            else:
                boot_refresh_note = f'boot config unavailable: {err_bi}'
        except Exception as _bie:
            boot_refresh_note = str(_bie)
            logging.warning('[lumps] boot-image.bin regeneration failed: %s', _bie)

    resp: dict = {
        "ok":           True,
        "token":        token8,
        "lump":         lump_filename,
        "lump_path":    f'server/lumps/{lump_filename}',
        "sidecar":      sidecar_filename,
        "size_bytes":   len(lump_bytes),
        "lump_version": next_lump_version,
        "boot_image_refreshed": boot_refreshed,
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
    manifest = []
    if os.path.isfile(manifest_path):
        try:
            with open(manifest_path) as fh:
                manifest = json.load(fh)
        except Exception:
            manifest = []

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
    with open(manifest_path, 'w') as fh:
        json.dump(manifest, fh, indent=2)

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
                result.append(lean)
                continue
            except Exception:
                pass
        result.append(entry)

    # Prepend system LUMPs extracted live from boot-image.bin.
    # Boot.NS (slot 0, typ=1) comes first so it heads the list; Boot.Abstr (slot 3)
    # follows immediately after.  Filter any stale manifest duplicates first.
    if _BOOT_ABSTR_META:
        result = [e for e in result if e.get('token') not in ('00000300', '00000003')]
        result = [dict(_BOOT_ABSTR_META)] + result
    if _BOOT_NS_META:
        result = [e for e in result if e.get('token') != '00000000']
        result = [dict(_BOOT_NS_META)] + result

    # Add binary_valid: True when the .lump binary has a valid header magic
    # (bits [31:27] of word 0 == 0x1F).  Boot.Abstr and Boot.NS are always
    # valid — they are live in-memory copies from boot-image.bin.
    for _e in result:
        _tk = _e.get('token', '')
        if _tk in ('00000003', '00000000'):
            _e['binary_valid'] = True
        elif _tk:
            _lp = os.path.join(lumps_dir, f'{_tk}.lump')
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
    # Boot.Abstr (00000003): clist_entries already set inside _BOOT_ABSTR_META — skip.
    # All other LUMPs: read from the .lump file.
    for _e in result:
        _tk = _e.get('token', '')
        if _tk in ('00000000', '00000003') or 'clist_entries' in _e:
            continue
        _cc = int(_e.get('cc', 0) or 0)
        if _cc == 0:
            continue
        _lp = os.path.join(lumps_dir, f'{_tk}.lump')
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
    words = list(_struct.unpack(f'>{num_words}I', data[:num_words * 4]))
    return jsonify({"token": key8, "words": words, "count": num_words})


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

    Looks in simulator/cloomc/<name>.cloomc (case-insensitive match).
    Returns {"name": name, "source": "..."} on success.
    Returns {"error": "...", "binary_only": true} with 404 if no functional
    source file exists for this lump name.
    """
    import re as _re
    if not _re.match(r'^[A-Za-z0-9_ .\-]+$', name):
        return jsonify({"error": "Invalid name"}), 400

    cloomc_dir = os.path.join(os.path.dirname(__file__), '..', 'simulator', 'cloomc')
    cloomc_dir = os.path.normpath(cloomc_dir)

    candidate = os.path.join(cloomc_dir, f'{name}.cloomc')
    if os.path.isfile(candidate):
        with open(candidate, 'r', encoding='utf-8', errors='replace') as fh:
            source = fh.read()
        return jsonify({"name": name, "source": source, "binary_only": False})

    for fname in os.listdir(cloomc_dir) if os.path.isdir(cloomc_dir) else []:
        if fname.lower() == f'{name.lower()}.cloomc':
            with open(os.path.join(cloomc_dir, fname), 'r', encoding='utf-8', errors='replace') as fh:
                source = fh.read()
            return jsonify({"name": name, "source": source, "binary_only": False})

    return jsonify({
        "error": f"No functional CLOOMC++ source found for '{name}'",
        "binary_only": True
    }), 404


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

    # When no sidecar exists yet, bootstrap one so the PATCH can proceed and
    # subsequent reads return persisted metadata.  Priority:
    #   1. Boot.Abstr (token "00000003") — seed from in-memory _BOOT_ABSTR_META.
    #   2. Any other lump — seed from the matching manifest.json entry, or a
    #      minimal stub if it is in LAZY_LUMPS but not in the manifest.
    if not os.path.isfile(sidecar_path):
        seed = None
        if key8 == '00000003' and _BOOT_ABSTR_META:
            seed = dict(_BOOT_ABSTR_META)
        else:
            # Try the manifest first
            manifest_path = os.path.join(lumps_dir, 'manifest.json')
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
            # Fall back to a minimal stub when the lump binary is known
            if seed is None and (key8 in LAZY_LUMPS or
                                 os.path.isfile(os.path.join(lumps_dir, f'{key8}.lump'))):
                seed = {'token': key8, 'abstraction': key8}
        if seed is None:
            return jsonify({"error": "Lump sidecar not found"}), 404
        try:
            with open(sidecar_path, 'w') as _sf:
                json.dump(seed, _sf, indent=2)
        except Exception as _se:
            return jsonify({"error": f"Could not create sidecar: {_se}"}), 500

    payload = request.get_json(force=True, silent=True) or {}

    try:
        with open(sidecar_path, 'r') as fh:
            sidecar = json.load(fh)
    except Exception as exc:
        return jsonify({"error": f"Could not read sidecar: {exc}"}), 500

    updated = False
    for field in ("author", "version"):
        if field in payload:
            sidecar[field] = str(payload[field])
            updated = True

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
        updated = True

    if not updated:
        return jsonify({"ok": True, "token": key8, "message": "No fields updated"}), 200

    try:
        with open(sidecar_path, 'w') as fh:
            json.dump(sidecar, fh, indent=2)
    except Exception as exc:
        return jsonify({"error": f"Could not write sidecar: {exc}"}), 500

    # Keep _BOOT_ABSTR_META in sync so /api/lumps/list returns the new values immediately.
    if key8 == '00000003':
        for field in ("author", "version"):
            if field in payload:
                _BOOT_ABSTR_META[field] = sidecar[field]

    manifest_path = os.path.join(lumps_dir, 'manifest.json')
    if os.path.isfile(manifest_path):
        try:
            with open(manifest_path, 'r') as fh:
                manifest = json.load(fh)
            changed = False
            for entry in manifest:
                if entry.get('token') == key8:
                    for field in ("author", "version"):
                        if field in payload:
                            entry[field] = sidecar[field]
                    changed = True
            if changed:
                with open(manifest_path, 'w') as fh:
                    json.dump(manifest, fh, indent=2)
        except Exception:
            pass

    print(f'[lumps/meta PATCH] {key8} author={sidecar.get("author","")} version={sidecar.get("version","")}', flush=True)
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
    lump_path = os.path.join(lumps_dir, f'{key8}.lump')
    if not os.path.isfile(lump_path):
        return jsonify({"error": f"No standalone .lump file for token {key8}"}), 404

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


@app.route("/api/lump/<token_hex>/resize", methods=["POST"])
def resize_lump(token_hex):
    """Repack a LUMP to its minimum power-of-2 size by removing freespace.

    Keeps the code region (first cw words after the header) and c-list (last cc
    words) intact; removes the unused freespace words between them.  The new
    lump size is the smallest power of 2 >= (1 + cw + cc), minimum 64 words.

    Two paths are supported:

    * Standalone .lump files — read from the file, repack, write back, update
      the sidecar JSON and manifest.

    * Boot lump (token 00000003) embedded in boot-image.bin — repack the lump
      in-place inside the binary memory image, update NS slot 3 words 1 and 2
      (cr_limit and CRC-16/XMODEM seal), write boot-image.bin back, then
      refresh LAZY_LUMPS and _BOOT_ABSTR_META via _load_boot_abstr_lump().

    Lumps that do not fall into either category are rejected with a 400 error.
    """
    import math as _math
    raw   = token_hex.lower()
    key8  = (raw[:8] if len(raw) >= 8 else raw).zfill(8)
    lumps_dir    = os.path.join(os.path.dirname(__file__), 'lumps')
    lump_path    = os.path.join(lumps_dir, f'{key8}.lump')
    sidecar_path = os.path.join(lumps_dir, f'{key8}.json')

    # Special branch: boot lump embedded in boot-image.bin (token 00000003).
    # There is no standalone .lump file for this token; resize it in-place inside
    # the binary, update NS slot 3, then write the file back.
    if not os.path.isfile(lump_path) and key8 == '00000003' and _BOOT_ABSTR_META:
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

        # Locate NS slot 3 entry (NS_TABLE_RESERVE=1024, NS_ENTRY_WORDS=4, BOOT_ABSTR_NS_SLOT=3)
        ns_table_base = n_words - 1024
        boot_ns_base  = ns_table_base + 3 * 4
        word0_location = mem_bi[boot_ns_base]
        if word0_location == 0 or word0_location + 1 >= n_words:
            return jsonify({"error": "Boot lump location in NS slot 3 is invalid"}), 400

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

        # Compute minimum size (same formula as standalone path)
        min_content = 1 + cw + cc
        new_n = max(6, _math.ceil(_math.log2(max(min_content, 2))))
        new_n = min(new_n, 14)
        new_size = 1 << new_n

        if new_size >= old_size:
            return jsonify({"ok": True, "already_minimal": True,
                            "lump_size": old_size, "cw": cw, "cc": cc})

        # Capture code and c-list from the current lump region
        code_words  = mem_bi[word0_location + 1 : word0_location + 1 + cw]
        clist_words = (mem_bi[word0_location + old_size - cc : word0_location + old_size]
                       if cc > 0 else [])

        # Repack lump in-place: header | code | freespace zeros | c-list
        freespace = new_size - 1 - cw - cc
        mem_bi[word0_location] = _pack_lump_header(new_n - 6, cw, cc, typ)
        for i, w in enumerate(code_words):
            mem_bi[word0_location + 1 + i] = int(w) & 0xFFFFFFFF
        for i in range(freespace):
            mem_bi[word0_location + 1 + cw + i] = 0
        for i, w in enumerate(clist_words):
            mem_bi[word0_location + new_size - cc + i] = int(w) & 0xFFFFFFFF
        # Zero the freed tail of the old lump region
        for i in range(new_size, old_size):
            mem_bi[word0_location + i] = 0

        # Update NS slot 3 word 1 (new cr_limit) and word 2 (recomputed CRC-16/XMODEM seal)
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
        print(f'[lump/resize] boot-image 00000003: {old_size}w → {new_size}w '
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

    # Minimum lump size: header + code + c-list, rounded up to next power of 2, min 64.
    min_content = 1 + cw + cc
    new_n = max(6, _math.ceil(_math.log2(max(min_content, 2))))
    new_n = min(new_n, 14)
    new_size = 1 << new_n

    if new_size >= old_size:
        return jsonify({"ok": True, "already_minimal": True,
                        "lump_size": old_size, "cw": cw, "cc": cc})

    # Re-pack: new header | code words | freespace zeros | c-list words.
    code_words  = words[1:1 + cw]
    clist_words = words[old_size - cc:old_size] if cc > 0 else []
    freespace   = new_size - 1 - cw - cc
    new_words   = [_pack_lump_header(new_n - 6, cw, cc, typ)]
    new_words  += code_words
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
    manifest = []
    if os.path.isfile(manifest_path):
        try:
            with open(manifest_path, 'r') as fh:
                manifest = json.load(fh)
        except Exception:
            pass
    for entry in manifest:
        if entry.get('token') == key8:
            entry['lump_size'] = new_size
            break
    with open(manifest_path, 'w') as fh:
        json.dump(manifest, fh, indent=2)

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
        "deployment":   {"target_board": "ti60-f225", "profile": "IoT",
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
    manifest = []
    if os.path.isfile(manifest_path):
        try:
            with open(manifest_path, 'r') as mfh:
                manifest = json.load(mfh)
        except Exception:
            manifest = []
    manifest = [e for e in manifest if e.get('token') != token8]
    manifest.append({"token": token8, "abstraction": name, "ns_slot": None,
                      "lump_size": lump_size, "cw": cw, "cc": 0,
                      "methods": [], "grants": ["E"]})
    with open(manifest_path, 'w') as mfh:
        json.dump(manifest, mfh, indent=2)

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
        "deployment":   {"target_board": "ti60-f225", "profile": "IoT",
                         "built_at": _dt.datetime.utcnow().isoformat() + "Z",
                         "builder": "IDE LUMP Upload"},
        "grants":       ["E"],
    }
    sidecar_path = os.path.join(lumps_dir, f'{token8}.json')
    with open(sidecar_path, 'w') as fh:
        json.dump(sidecar, fh, indent=2)

    manifest_path = os.path.join(lumps_dir, 'manifest.json')
    manifest = []
    if os.path.isfile(manifest_path):
        try:
            with open(manifest_path, 'r') as mfh:
                manifest = json.load(mfh)
        except Exception:
            manifest = []
    manifest = [e for e in manifest if e.get('token') != token8]
    manifest.append({"token": token8, "abstraction": name, "ns_slot": None,
                      "lump_size": lump_size, "cw": cw, "cc": cc,
                      "methods": [], "grants": ["E"]})
    with open(manifest_path, 'w') as mfh:
        json.dump(manifest, mfh, indent=2)

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
    if ns_table_start < 1:
        ns_table_start = lump_size - (len(entries) * 3)
        if ns_table_start < 1:
            return jsonify({"error": "Too many entries for the given lump size"}), 400

    ns_table_words_needed = len(entries) * 3
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
        word_offset = ns_table_start + slot * 3

        if word_offset + 2 >= lump_size:
            return jsonify({"error": f"Slot {slot} exceeds lump size at offset {word_offset}"}), 400

        if state == "null":
            words[word_offset] = 0
            words[word_offset + 1] = 0
            words[word_offset + 2] = 0

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

        elif state == "bundled" or state == "live":
            lump_token = entry.get("lump_token", "").strip()
            if not lump_token:
                return jsonify({"error": f"Slot {slot}: Bundled entry requires a lump token"}), 400

            lump_path = os.path.join(lumps_dir, f'{lump_token}.lump')
            if not os.path.isfile(lump_path):
                return jsonify({"error": f"Slot {slot}: Lump file {lump_token}.lump not found"}), 400

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
            "target_board": "ti60-f225",
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
    manifest = []
    if os.path.isfile(manifest_path):
        try:
            with open(manifest_path, 'r') as fh2:
                manifest = json.load(fh2)
        except Exception:
            manifest = []
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
    with open(manifest_path, 'w') as fh2:
        json.dump(manifest, fh2, indent=2)

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

    lump_path = os.path.join(lumps_dir, f'{token8}.lump')
    sidecar_path = os.path.join(lumps_dir, f'{token8}.json')
    deleted = []

    if os.path.isfile(lump_path):
        os.remove(lump_path)
        deleted.append(f'{token8}.lump')
    if os.path.isfile(sidecar_path):
        os.remove(sidecar_path)
        deleted.append(f'{token8}.json')

    LAZY_LUMPS.pop(token8, None)
    LAZY_LUMPS.pop(token8.lstrip('0') or '0', None)

    manifest_removed = False
    manifest_path = os.path.join(lumps_dir, 'manifest.json')
    if os.path.isfile(manifest_path):
        try:
            with open(manifest_path, 'r') as fh:
                manifest = json.load(fh)
            before = len(manifest)
            manifest = [e for e in manifest if e.get('token') != token8]
            if len(manifest) < before:
                manifest_removed = True
            with open(manifest_path, 'w') as fh:
                json.dump(manifest, fh, indent=2)
        except Exception:
            pass

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
    "ti60f225":                       0x03,
    "ti60":                           0x03,
    "ti60-full":                      0x03,
    "tn20k-iot":                      0x01,
    "tn20k":                          0x01,
    "wukong xc7a100t (artix-7)":      0x06,
    "wukong":                         0x06,
    "xc7a100t":                       0x06,
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
    """Return c-list and code words for Boot.Abstr (NS slot 3) from the boot image.

    Used by the Connect tab stream panel to disassemble NIA lines and display
    the Golden Token (GT) value the instruction would access in the c-list.
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
        return jsonify({"ok": False, "error": "NS slot 3 entry out of range"})
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
    now = _time.time()
    devs = Device.query.order_by(Device.last_seen.desc()).all()
    result = []
    for d in devs:
        is_online = (now - (d.last_seen or 0)) < DEVICE_ONLINE_TIMEOUT
        if d.status == "online" and not is_online:
            d.status = "offline"
        result.append({
            "id": d.id,
            "device_uid": d.device_uid,
            "board_type": d.board_type,
            "board_name": d.board_name,
            "profile": d.profile,
            "fw_version": f"{d.fw_major}.{d.fw_minor}",
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
        })
    db.session.commit()
    return jsonify({"ok": True, "devices": result})


@app.route("/api/device/fault", methods=["POST"])
def device_fault_submit():
    """Accept a detailed fault telemetry record from a device.

    Body fields (all optional except device_uid):
      device_uid, lump_token, lump_version, fault_code, mnemonic,
      pipeline_stage, recovery_tier, instruction_address (=fault_nia),
      step_count
    """
    data = request.get_json(silent=True) or {}
    uid = data.get("device_uid", "").strip()
    if not uid:
        return jsonify({"ok": False, "error": "missing device_uid"}), 400
    now = _time.time()
    try:
        fault_nia = int(data.get("instruction_address", data.get("fault_nia", 0))) & 0xFFFFFFFF
    except (ValueError, TypeError):
        fault_nia = 0
    try:
        fault_type = int(data.get("fault_type", 0)) & 0xFF
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
    fe = FaultEvent(
        device_uid=uid,
        fault_type=fault_type,
        fault_nia=fault_nia,
        boot_reason=0,
        timestamp=now,
        lump_token=data.get("lump_token", None),
        lump_version=lump_version,
        fault_code=str(data.get("fault_code", ""))[:32],
        mnemonic=str(data.get("mnemonic", ""))[:32],
        pipeline_stage=str(data.get("pipeline_stage", ""))[:32],
        recovery_tier=recovery_tier,
        step_count=step_count,
    )
    db.session.add(fe)
    db.session.commit()
    logging.info("Fault telemetry: device=%s token=%s ver=%s tier=%s nia=0x%08X",
                 uid, fe.lump_token, lump_version, recovery_tier, fault_nia)
    return jsonify({"ok": True, "id": fe.id})


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
LaunchTest = None

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
    Project, TutorialProgress, Device, FaultEvent, LaunchTest = register_models(db)
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
        ("lump_token",     "VARCHAR(16) DEFAULT NULL"),
        ("lump_version",   "INTEGER DEFAULT 0"),
        ("fault_code",     "VARCHAR(32) DEFAULT ''"),
        ("mnemonic",       "VARCHAR(32) DEFAULT ''"),
        ("pipeline_stage", "VARCHAR(32) DEFAULT ''"),
        ("recovery_tier",  "INTEGER DEFAULT 0"),
        ("step_count",     "INTEGER DEFAULT 0"),
    ]:
        if _fe_col not in _existing_fe_cols:
            db.session.execute(_sa_text(f"ALTER TABLE fault_events ADD COLUMN {_fe_col} {_fe_def}"))
            db.session.commit()
            logging.info("Migrated: added %s column to fault_events table", _fe_col)

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
        from apscheduler.jobstores.sqlalchemy import SQLAlchemyJobStore
        from apscheduler.triggers.cron import CronTrigger

        _sched_db = os.path.join(os.path.dirname(os.path.abspath(__file__)), "scheduler.db")
        _jobstores = {
            "default": SQLAlchemyJobStore(url=f"sqlite:///{_sched_db}")
        }
        _scheduler = BackgroundScheduler(jobstores=_jobstores, timezone="UTC")

        from daily_report import send_daily_report as _send_report, run_lfs_backup as _run_lfs_backup

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
        _scheduler.start()
        logging.info(
            "APScheduler started — daily report at 05:00 UTC, LFS backup at 03:00 UTC"
        )
    except Exception as _sched_exc:
        logging.warning("APScheduler could not start: %s", _sched_exc)

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
    from the Ti60/simulator and verifies the GT.  This handler runs Greet() and
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


if __name__ == "__main__":
    _port = int(os.environ.get("E2E_PORT", 5000))
    _free_port(_port)
    logging.info("Starting Church Machine server on port %d", _port)
    app.run(host="0.0.0.0", port=_port, debug=True, use_reloader=False, threaded=True)
