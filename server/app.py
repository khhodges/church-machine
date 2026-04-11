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
from flask import Flask, jsonify, send_from_directory, send_file, redirect, make_response, request
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

@app.route("/")
def index():
    # Return 200 so Replit's deployment health checker doesn't see a redirect
    # as a failure. The meta-refresh takes the browser to the actual app.
    return (
        '<html><head><meta http-equiv="refresh" content="0;url=/simulator/#docs">'
        "</head><body></body></html>",
        200,
    )

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
    ("Getting Started", [
        "quick-start.md",
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
    ]),
    ("Part IX: Hardware Implementation", [
        "boot-rom-layout.md",
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

BUILD_DIR = os.path.join(BASE_DIR, "build")

_ALLOWED_BUILD_FILES = {
    "church_ti60_f225.v":  "text/plain",
    "church_ti60_f225.il": "text/plain",
    "church_tang_nano_20k.v":  "text/plain",
    "church_tang_nano_20k.il": "text/plain",
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

- `church_tang_nano_20k.v` — Synthesisable Verilog (produced by Yosys from Amaranth RTLIL)
- `church_tang_nano_20k.json` — Yosys synthesis netlist (Gowin target)
- `tang_nano_20k.cst` — Pin constraints for GW2AR-LV18QN88C8/I7
- `Makefile` — Build automation (pnr, pack, prog targets)
- `flash.sh` — One-command build + flash script
- `bridge.sh` — Connect the flashed board to the Church Machine IDE
- `local_bridge.py` — Serial bridge server (used by bridge.sh)
- `BUILD.md` — This file

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
| 3 LEDs + serial OK but no call-home | Bridge not running | Run `./bridge.sh --ide=URL` |
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

DEVICE="GW2AR-LV18QN88C8/I7"
FAMILY="GW2A-18C"
JSON="church_tang_nano_20k.json"
CST="tang_nano_20k.cst"
FS="church_tang_nano_20k.fs"
FREQ="27"

echo "========================================"
echo " Church Machine — Tang Nano 20K Flash"
echo "========================================"
echo ""

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
    echo "  Hint: Is the board plugged in via USB-C? Is the cable data-capable?"
    echo "  Try:  ls /dev/ttyUSB*  — you should see ttyUSB0 and ttyUSB1"
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

BUILD_MD_TI60 = """# Church Machine — Efinix Ti60 F225 Build Package

## What's Inside

- `church_ti60_f225.xml`  — Efinity project file (open this in Efinity IDE)
- `church_ti60_f225.v`    — RTL Verilog (Yosys from Amaranth RTLIL, no vendor cells)
- `church_ti60_f225.sdc`  — Timing constraints (50 MHz clock)
- `ti60_f225.isf`         — Pin constraints (Interface Setup File)
- `setup_ti60_peri.py`    — **Run this first** — generates peri.xml via Efinity DesignAPI
- `BUILD.md`              — This file

> **`church_ti60_f225.peri.xml` is not bundled.**
> It must be generated by `setup_ti60_peri.py` using Efinity's DesignAPI.
> Efinity rejects any hand-crafted peri.xml as "corrupted" — the script writes
> the only format it will accept.

## Quick Start

### Step 1 — Generate the periphery file

From a terminal, run the setup script **using Efinity's own Python**:

```bash
cd ~/church_ti60/   # wherever you extracted the zip

PYTHONPATH=$HOME/efinity/2025.2/lib:$HOME/efinity/2025.2/pt/bin \\
EFXPT_HOME=$HOME/efinity/2025.2/pt \\
  $HOME/efinity/2025.2/bin/python3.11 setup_ti60_peri.py
```

You should see `SUCCESS — church_ti60_f225.peri.xml written` at the end.

### Step 2 — Open in Efinity IDE

```
File → Open Project → church_ti60_f225.xml
```

### Step 3 — Build and flash

Run **Synthesis → Place & Route → Generate Bitstream**.

The project file already includes a USB programmer target (JTAG, cable index 0).
Once the bitstream is generated, go to **Tool → Programmer** — your board should
appear pre-selected. Click **Program** to flash.

## Re-synthesise from Verilog (optional)

```bash
yosys -p "read_rtlil church_ti60_f225.il; synth_efinix -top top -run begin:map_ram; write_verilog church_ti60_f225.v"
```

## LED Pinout (active-high, Ti60 F225 Dev Board)

| LED | Ball | Signal            |
|-----|------|-------------------|
| 0   | A13  | Boot in progress  |
| 1   | B13  | Running           |
| 2   | A14  | Fault             |
| 3   | B14  | Boot complete     |

## Device

- **FPGA**: Efinix Titanium Ti60F225 (59,904 LEs, F225 FBGA)
- **Clock**: 50 MHz on-board crystal oscillator (pin B8)
- **UART**: 115200 baud via FTDI FT232H USB bridge
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
            "synth_efinix -top top -run begin:map_ram; "
            "write_verilog {verilog}"
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
            "synth_gowin -top top -json {json} -vout {verilog}"
        )
    return is_ti60, paths, zip_name, build_md, gen_args, synth_cmd_tpl


def _make_fpga_zip(is_ti60, paths, zip_name, build_md):
    """Zip up already-built FPGA artifacts and return (BytesIO, zip_name)."""
    hw_dir = os.path.join(BASE_DIR, "hardware")
    buf = io.BytesIO()
    if is_ti60:
        with open(paths["project"], 'r') as f:
            project_xml = f.read()
        # Fix path so all files sit in the same flat directory
        project_xml = project_xml.replace(
            '../build/church_ti60_f225.v', 'church_ti60_f225.v'
        )
        # Inject USB programmer target so Efinity IDE can flash without manual setup
        programmer_block = (
            '    <efx:programmer>\n'
            '        <efx:param name="cable_name"  value="Efinix USB2.0 Device" value_type="e_string"/>\n'
            '        <efx:param name="cable_index" value="0"                    value_type="e_integer"/>\n'
            '        <efx:param name="mode"        value="jtag"                 value_type="e_option"/>\n'
            '        <efx:param name="bitfile"     value="outflow/church_ti60_f225.bit" value_type="e_string"/>\n'
            '    </efx:programmer>\n'
        )
        if '<efx:programmer>' not in project_xml:
            project_xml = project_xml.replace('</efx:project>', programmer_block + '</efx:project>')
        with zipfile.ZipFile(buf, 'w', zipfile.ZIP_DEFLATED) as zf:
            zf.write(paths["verilog"], "church_ti60_f225.v")
            zf.write(paths["isf"],     "ti60_f225.isf")
            zf.writestr("church_ti60_f225.xml",      project_xml)
            zf.write(paths["sdc"],     "church_ti60_f225.sdc")
            zf.write(paths["setup"],   "setup_ti60_peri.py")
            zf.writestr("BUILD.md", build_md)
    else:
        json_path = paths["json"]
        with open(json_path, 'r') as f:
            json_text = f.read()
        json_text = json_text.replace('"speed": "ES"', '"speed": "C8"')
        with open(json_path, 'w') as f:
            f.write(json_text)
        logging.info("FPGA zip: patched JSON speed grade (ES -> C8)")
        bridge_path = os.path.join(BASE_DIR, "server", "local_bridge.py")
        with zipfile.ZipFile(buf, 'w', zipfile.ZIP_DEFLATED) as zf:
            zf.write(paths["verilog"],  "church_tang_nano_20k.v")
            zf.write(json_path,         "church_tang_nano_20k.json")
            zf.write(paths["cst"],      "tang_nano_20k.cst")
            zf.write(paths["makefile"], "Makefile")
            flash_info = zipfile.ZipInfo("flash.sh")
            flash_info.external_attr = 0o755 << 16
            zf.writestr(flash_info, FLASH_SH.lstrip('\n'))
            bridge_info = zipfile.ZipInfo("bridge.sh")
            bridge_info.external_attr = 0o755 << 16
            zf.writestr(bridge_info, BRIDGE_SH.lstrip('\n'))
            if not os.path.isfile(bridge_path):
                logging.warning("FPGA zip: local_bridge.py not found at %s", bridge_path)
            else:
                zf.write(bridge_path, "local_bridge.py")
            zf.writestr("BUILD.md", build_md)
    return buf, zip_name


@app.route("/api/build/fpga")
def build_fpga():
    """Run Amaranth elaboration + Yosys synthesis. Save artifacts to build/. Return JSON status."""
    build_dir = os.path.join(BASE_DIR, "build")
    board = request.args.get("board", "tang-nano-20k").strip().lower()
    is_ti60, paths, zip_name, build_md, gen_args, synth_cmd_tpl = _fpga_paths(board)

    try:
        os.makedirs(build_dir, exist_ok=True)

        logging.info("FPGA build: generating RTLIL from Amaranth (board=%s)...", board)
        gen_result = subprocess.run(gen_args, cwd=BASE_DIR, capture_output=True, text=True, timeout=120)
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
        synth_result = subprocess.run(["yosys", "-p", synth_cmd], cwd=BASE_DIR, capture_output=True, text=True, timeout=120)
        if synth_result.returncode != 0:
            return jsonify({
                "error": "Yosys synthesis failed",
                "stderr": synth_result.stderr[-2000:] if synth_result.stderr else "",
                "stdout": synth_result.stdout[-2000:] if synth_result.stdout else ""
            }), 500

        if not os.path.isfile(paths["verilog"]):
            return jsonify({"error": "Yosys Verilog output not generated", "stderr": ""}), 500

        marker_path = os.path.join(build_dir, "_last_board.txt")
        with open(marker_path, 'w') as f:
            f.write(board)

        files = [os.path.basename(p) for p in paths.values() if os.path.isfile(p)]
        file_paths = [p for p in paths.values() if os.path.isfile(p)]
        logging.info("FPGA build: synthesis complete, files=%s", files)
        return jsonify({"ok": True, "board": board, "files": files, "file_paths": file_paths})

    except subprocess.TimeoutExpired:
        return jsonify({"error": "Build timed out (120s limit)", "stderr": ""}), 500
    except Exception as e:
        logging.exception("FPGA build failed")
        return jsonify({"error": str(e), "stderr": ""}), 500


@app.route("/api/download/fpga-zip")
def download_fpga_zip():
    """Download the ZIP of the last successfully built FPGA artifacts (no rebuild)."""
    build_dir = os.path.join(BASE_DIR, "build")
    board = request.args.get("board", "tang-nano-20k").strip().lower()
    is_ti60, paths, zip_name, build_md, _, _ = _fpga_paths(board)

    if not os.path.isfile(paths["verilog"]):
        return jsonify({"error": "No build found for this board. Run Build first."}), 404

    try:
        buf, zip_name = _make_fpga_zip(is_ti60, paths, zip_name, build_md)
        zip_data = buf.getvalue()
        resp = make_response(zip_data)
        resp.headers['Content-Type'] = 'application/zip'
        resp.headers['Content-Disposition'] = f'attachment; filename="{zip_name}"'
        resp.headers['Content-Length'] = len(zip_data)
        logging.info("FPGA zip download: %s (%d bytes)", zip_name, len(zip_data))
        return resp
    except Exception as e:
        logging.exception("FPGA zip download failed")
        return jsonify({"error": str(e)}), 500


@app.route("/api/download/fpga-package")
def download_fpga_package():
    """Legacy: build + download in one shot (kept for backwards compatibility)."""
    build_dir = os.path.join(BASE_DIR, "build")
    board = request.args.get("board", "tang-nano-20k").strip().lower()
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
    "tang-nano-20k": "church_tang_nano_20k.fs",
    "tang-nano-20k-iot": "church_tang_nano_20k_iot.fs",
    "ti60-f225": "church_ti60_f225.hex",
}

@app.route("/api/bitstream/upload", methods=["POST"])
def bitstream_upload():
    """Upload an official bitstream file."""
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


import time as _time

DEVICE_ONLINE_TIMEOUT = 90

@app.route("/api/device/register", methods=["POST"])
def device_register():
    data = request.get_json(silent=True) or {}
    uid = data.get("device_uid", "").strip()
    if not uid:
        return jsonify({"ok": False, "error": "missing device_uid"}), 400
    board_type = int(data.get("board_type", 0))
    fw_major = int(data.get("fw_major", 1))
    fw_minor = int(data.get("fw_minor", 0))
    profile = data.get("profile", "Full")
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
    logging.info("Device registered: %s (%s) via %s:%s",
                 uid, dev.board_name, bridge_host, bridge_port)
    return jsonify({
        "ok": True,
        "device_id": dev.id,
        "board_name": dev.board_name,
        "boot_count": dev.boot_count,
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
    dev.status = "online"
    dev.last_seen = _time.time()
    db.session.commit()
    return jsonify({"ok": True})


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
            "label": d.label or "",
        })
    db.session.commit()
    return jsonify({"ok": True, "devices": result})


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


Device = None
Project = None
TutorialProgress = None

with app.app_context():
    import sys
    sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    from server.models import register_models, BOARD_TYPES, PROFILE_NAMES
    Project, TutorialProgress, Device = register_models(db)
    db.create_all()

    from sqlalchemy import inspect as _sa_inspect, text as _sa_text
    _inspector = _sa_inspect(db.engine)
    _existing_cols = {c["name"] for c in _inspector.get_columns("devices")}
    if "bridge_scheme" not in _existing_cols:
        db.session.execute(_sa_text("ALTER TABLE devices ADD COLUMN bridge_scheme VARCHAR(8) DEFAULT 'http'"))
        db.session.commit()
        logging.info("Migrated: added bridge_scheme column to devices table")

    logging.info("Database tables created")

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

if __name__ == "__main__":
    _free_port(5000)
    logging.info("Starting Church Machine server on port 5000")
    app.run(host="0.0.0.0", port=5000, debug=True, use_reloader=False, threaded=True)
