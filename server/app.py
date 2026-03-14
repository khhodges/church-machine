import os
import io
import json
import logging
import uuid
import base64
import mimetypes
import zipfile
import subprocess
import tempfile
import gzip as _gzip
import requests as http_requests
from flask import Flask, jsonify, send_from_directory, redirect, make_response, request
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

BOOT_ID = str(uuid.uuid4())

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
            return resp
        if raw is None:
            with open(filepath, 'rb') as f:
                raw = f.read()
        resp = make_response(raw)
        resp.headers['Content-Type'] = ct
        resp.headers['Content-Length'] = len(raw)
        resp.headers['ETag'] = etag
        return resp
    with open(filepath, 'rb') as f:
        data = f.read()
    resp = make_response(data)
    resp.headers['Content-Type'] = ct
    resp.headers['Content-Length'] = len(data)
    resp.headers['ETag'] = etag
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

@app.route("/")
def index():
    # Return 200 so Replit's deployment health checker doesn't see a redirect
    # as a failure. The meta-refresh takes the browser to the actual app.
    return (
        '<html><head><meta http-equiv="refresh" content="0;url=/simulator/">'
        "</head><body></body></html>",
        200,
    )

@app.route("/api/health")
@app.route("/health")
def health():
    return jsonify({"status": "ok"})

@app.route("/api/boot-id")
def boot_id():
    return jsonify({"bootId": BOOT_ID})

@app.route("/simulator/")
def simulator_index():
    filepath = os.path.join(SIMULATOR_DIR, "index.html")
    if os.path.isfile(filepath):
        return _serve_file(filepath, "index.html")
    return jsonify({"status": "simulator not yet built"})

@app.route("/simulator/<path:path>")
def simulator_static(path):
    filepath = os.path.join(SIMULATOR_DIR, path)
    return _serve_file(filepath, os.path.basename(path))

@app.route("/docs/figures/<path:path>")
def docs_figures(path):
    return send_from_directory(os.path.join(DOCS_DIR, "figures"), path)

BOOK_CHAPTERS = [
    ("Prologue", [
        "prologue.md",
    ]),
    ("Part I: Introduction", [
        "overview.md",
        "getting-started.md",
        "handbook.md",
    ]),
    ("Part II: Architecture", [
        "architecture.md",
        "instruction-set.md",
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
        "trusted-security-base.md",
        "boot-permission-rules.md",
        "risks.md",
    ]),
    ("Part IV: Runtime", [
        "abstractions.md",
        "garbage-collection.md",
        "family-registry.md",
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
    ]),
    ("Part IX: Hardware Implementation", [
        "chipflow-cover-letter.md",
        "chipflow-technical-summary.md",
        "church-machine-pico-ice.md",
        "tang-nano-20k.md",
        "production_silicon_todo.md",
    ]),
    ("Part X: Patents & Proposals", [
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

BUILD_MD_TEMPLATE = """# Church Machine — Tang Nano 20K Build Package

## What's Inside

- `church_tang_nano_20k.v` — Synthesisable Verilog (produced by Yosys from Amaranth RTLIL)
- `church_tang_nano_20k.json` — Yosys synthesis netlist (Gowin target)
- `tang_nano_20k.cst` — Pin constraints for GW2AR-LV18QN88C8/I7
- `Makefile` — Build automation (pnr, pack, prog targets)

## Prerequisites

```bash
# Linux
curl -L https://github.com/YosysHQ/oss-cad-suite-build/releases/latest/download/oss-cad-suite-linux-x64.tgz | tar xz
# macOS (Apple Silicon)
# curl -L https://github.com/YosysHQ/oss-cad-suite-build/releases/latest/download/oss-cad-suite-darwin-arm64.tgz | tar xz
source oss-cad-suite/environment
```

## Build and Flash

The Verilog and synthesis JSON are pre-built. You only need two commands:

```bash
make pnr pack    # place-and-route (nextpnr-gowin) + generate .fs bitstream (gowin_pack)
make prog        # flash to Tang Nano 20K via openFPGALoader (USB-C)
```

## Upload to Tang Nano 20K

1. Open the Church Machine IDE in **Chrome or Edge** (WebSerial required)
2. Plug in the Tang Nano 20K via USB-C
3. Go to the **Code** tab → **Console Output** sub-tab
4. Click **Deploy to Tang** to upload your program via WebSerial at 115200 baud

## LED Pinout (active-low)

| LED | Pin | Signal            |
|-----|-----|-------------------|
| 0   | 15  | Boot in progress  |
| 1   | 16  | Running / blink   |
| 2   | 10  | Fault             |
| 3   | 11  | Boot complete inv |
| 4   | 13  | Halted            |
| 5   | 14  | Stepping          |

## Device

- **FPGA**: Gowin GW2AR-LV18QN88C8/I7
- **Board**: Sipeed Tang Nano 20K
- **Clock**: 27 MHz crystal
- **UART**: 115200 baud via BL616 USB bridge
"""

@app.route("/api/download/fpga-package")
def download_fpga_package():
    hw_dir = os.path.join(BASE_DIR, "hardware")
    build_dir = os.path.join(BASE_DIR, "build")

    try:
        os.makedirs(build_dir, exist_ok=True)

        rtlil_path = os.path.join(build_dir, "church_tang_nano_20k.il")
        verilog_path = os.path.join(build_dir, "church_tang_nano_20k.v")
        json_path = os.path.join(build_dir, "church_tang_nano_20k.json")

        logging.info("FPGA package: generating RTLIL from Amaranth...")
        gen_result = subprocess.run(
            ["python3", "-m", "hardware.gen_rtlil", "build"],
            cwd=BASE_DIR,
            capture_output=True, text=True, timeout=120
        )
        if gen_result.returncode != 0:
            return jsonify({
                "error": "Amaranth RTLIL generation failed",
                "stderr": gen_result.stderr[-2000:] if gen_result.stderr else "",
                "stdout": gen_result.stdout[-1000:] if gen_result.stdout else ""
            }), 500

        if not os.path.isfile(rtlil_path):
            return jsonify({"error": "RTLIL file not generated"}), 500

        logging.info("FPGA package: running Yosys synthesis (RTLIL -> JSON + Verilog)...")
        synth_cmd = (
            f"read_rtlil {rtlil_path}; "
            f"synth_gowin -top top -json {json_path} -vout {verilog_path}"
        )
        synth_result = subprocess.run(
            ["yosys", "-p", synth_cmd],
            cwd=BASE_DIR,
            capture_output=True, text=True, timeout=120
        )
        if synth_result.returncode != 0:
            return jsonify({
                "error": "Yosys synthesis failed",
                "stderr": synth_result.stderr[-2000:] if synth_result.stderr else "",
                "stdout": synth_result.stdout[-2000:] if synth_result.stdout else ""
            }), 500

        if not os.path.isfile(json_path):
            return jsonify({"error": "Yosys JSON netlist not generated"}), 500
        if not os.path.isfile(verilog_path):
            return jsonify({"error": "Yosys Verilog output not generated"}), 500

        buf = io.BytesIO()
        with zipfile.ZipFile(buf, 'w', zipfile.ZIP_DEFLATED) as zf:
            zf.write(verilog_path, "church_tang_nano_20k.v")
            zf.write(json_path, "church_tang_nano_20k.json")

            cst_path = os.path.join(hw_dir, "tang_nano_20k.cst")
            if os.path.isfile(cst_path):
                zf.write(cst_path, "tang_nano_20k.cst")

            makefile_path = os.path.join(hw_dir, "Makefile")
            if os.path.isfile(makefile_path):
                zf.write(makefile_path, "Makefile")

            zf.writestr("BUILD.md", BUILD_MD_TEMPLATE)

        zip_data = buf.getvalue()
        resp = make_response(zip_data)
        resp.headers['Content-Type'] = 'application/zip'
        resp.headers['Content-Disposition'] = 'attachment; filename="church-nano-package.zip"'
        resp.headers['Content-Length'] = len(zip_data)

        logging.info("FPGA package: download ready (%d bytes)", len(zip_data))
        return resp

    except subprocess.TimeoutExpired:
        return jsonify({"error": "Build timed out (120s limit)"}), 500
    except Exception as e:
        logging.exception("FPGA package generation failed")
        return jsonify({"error": str(e)}), 500

with app.app_context():
    import sys
    sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    from server.models import register_models
    Project, TutorialProgress = register_models(db)
    db.create_all()
    logging.info("Database tables created")

if __name__ == "__main__":
    logging.info("Starting Church Machine server on port 5000")
    app.run(host="0.0.0.0", port=5000, debug=True, use_reloader=False, threaded=True)
