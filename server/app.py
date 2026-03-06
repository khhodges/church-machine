import os
import json
import logging
import uuid
import base64
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

@app.after_request
def add_cache_control(response):
    if response.content_type and (
        "javascript" in response.content_type
        or "text/css" in response.content_type
        or "text/html" in response.content_type
    ):
        response.headers["Cache-Control"] = "no-cache, no-store, must-revalidate"
        response.headers["Pragma"] = "no-cache"
        response.headers["Expires"] = "0"
    response.headers["Permissions-Policy"] = "serial=(self)"
    return response

@app.route("/")
def index():
    return redirect("/simulator/")

@app.route("/api/health")
def health():
    return jsonify({"status": "ok"})

@app.route("/api/boot-id")
def boot_id():
    return jsonify({"bootId": BOOT_ID})

@app.route("/simulator/")
def simulator_index():
    if os.path.isfile(os.path.join(SIMULATOR_DIR, "index.html")):
        resp = make_response(send_from_directory(SIMULATOR_DIR, "index.html"))
        resp.headers['Cache-Control'] = 'no-cache, no-store, must-revalidate'
        return resp
    return jsonify({"status": "simulator not yet built"})

@app.route("/simulator/<path:path>")
def simulator_static(path):
    resp = make_response(send_from_directory(SIMULATOR_DIR, path))
    resp.headers['Cache-Control'] = 'no-cache, no-store, must-revalidate'
    return resp

@app.route("/docs/figures/<path:path>")
def docs_figures(path):
    return send_from_directory(os.path.join(DOCS_DIR, "figures"), path)

@app.route("/api/docs/list")
def docs_list():
    docs = []
    for f in sorted(os.listdir(DOCS_DIR)):
        if f.endswith('.md'):
            filepath = os.path.join(DOCS_DIR, f)
            size = os.path.getsize(filepath)
            docs.append({"name": f, "type": "doc", "size": size})
    figures = []
    figures_dir = os.path.join(DOCS_DIR, "figures")
    if os.path.isdir(figures_dir):
        for f in sorted(os.listdir(figures_dir)):
            if f.endswith('.html'):
                filepath = os.path.join(figures_dir, f)
                size = os.path.getsize(filepath)
                figures.append({"name": f, "type": "figure", "size": size})
    return jsonify({"docs": docs, "figures": figures})

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

with app.app_context():
    import sys
    sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    from server.models import register_models
    Project, TutorialProgress = register_models(db)
    db.create_all()
    logging.info("Database tables created")

if __name__ == "__main__":
    logging.info("Starting Church Machine server on port 5000")
    app.run(host="0.0.0.0", port=5000, debug=True)
