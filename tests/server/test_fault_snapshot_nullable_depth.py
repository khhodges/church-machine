"""Exercise the endpoint body without importing the live server or its state."""
import ast
from pathlib import Path
import threading
import uuid

from flask import Flask, jsonify, request


def test_hardware_snapshot_preserves_unknown_call_depth():
    source = Path(__file__).resolve().parents[2] / "server/app.py"
    fn = next(n for n in ast.parse(source.read_text()).body
              if isinstance(n, ast.FunctionDef) and n.name == "fault_snapshot_post")
    fn.decorator_list = []
    namespace = {"request": request, "jsonify": jsonify, "uuid": uuid,
                 "_fault_snapshot": None, "_fault_snapshot_lock": threading.Lock()}
    exec(compile(ast.Module(body=[fn], type_ignores=[]), str(source), "exec"), namespace)
    app = Flask(__name__)
    app.add_url_rule("/snapshot", view_func=namespace["fault_snapshot_post"], methods=["POST"])
    with app.test_client() as client:
        for depth in (None, 0, 3):
            response = client.post("/snapshot", json={
                "source": "hardware", "fault_code": 8, "nia": 0x3A08,
                "call_depth": depth, "snapshot_complete": True,
            })
            assert response.status_code == 200
            assert namespace["_fault_snapshot"]["call_depth"] == depth
