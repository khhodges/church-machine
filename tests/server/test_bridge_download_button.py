"""Bridge downloads need no board, JTAG, or approved bitstream."""
import ast
from pathlib import Path
from html.parser import HTMLParser

from flask import Flask, jsonify, send_file
import os

ROOT = Path(__file__).resolve().parents[2]


def test_public_bridge_download_is_canonical_attachment():
    # Execute the actual route without starting hardware/relay services.
    source = ROOT / "server/app.py"
    tree = ast.parse(source.read_text())
    route = next(n for n in tree.body
                 if isinstance(n, ast.FunctionDef)
                 and n.name == "download_wukong_bridge")
    app = Flask(__name__)
    scope = dict(app=app, os=os, send_file=send_file, jsonify=jsonify,
                 __file__=str(source))
    exec(compile(ast.Module(body=[route], type_ignores=[]), str(source), "exec"), scope)
    with app.test_client() as client:
        response = client.get("/dl/wukong-bridge")
        assert response.status_code == 200
        assert response.mimetype == "application/octet-stream"
        assert 'attachment; filename=wukong_bridge.py' == response.headers["Content-Disposition"]
        assert response.data == (ROOT / "hardware/wukong_bridge.py").read_bytes()
        response.close()


def test_bridge_buttons_escape_preview_without_hardware_gates():
    class Links(HTMLParser):
        def __init__(self):
            super().__init__()
            self.links = []

        def handle_starttag(self, tag, attrs):
            attrs = dict(attrs)
            if tag == "a" and attrs.get("href") == "/dl/wukong-bridge":
                self.links.append(attrs)

    parser = Links()
    parser.feed((ROOT / "simulator/index.html").read_text())
    assert len(parser.links) >= 3
    for link in parser.links:
        assert link["target"] == "_blank"
        assert "noopener" in link["rel"]
        assert "onclick" not in link
        assert "download" not in link
        assert "disabled" not in link
