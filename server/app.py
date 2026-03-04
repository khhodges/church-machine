import os
import logging
from flask import Flask, jsonify, send_from_directory, redirect
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

@app.route("/simulator/")
def simulator_index():
    if os.path.isfile(os.path.join(SIMULATOR_DIR, "index.html")):
        return send_from_directory(SIMULATOR_DIR, "index.html")
    return jsonify({"status": "simulator not yet built"})

@app.route("/simulator/<path:path>")
def simulator_static(path):
    return send_from_directory(SIMULATOR_DIR, path)

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
