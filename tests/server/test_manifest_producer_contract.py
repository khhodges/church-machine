"""Exercise the save index construction without importing the live server."""

import ast
from pathlib import Path


APP = Path(__file__).resolve().parents[2] / "server" / "app.py"


def test_save_manifest_producer_contains_only_locators_and_history():
    tree = ast.parse(APP.read_text(encoding="utf-8"))
    assignments = [
        node for node in ast.walk(tree)
        if isinstance(node, ast.Assign)
        and any(isinstance(target, ast.Name) and target.id == "new_entry"
                for target in node.targets)
        and isinstance(node.value, ast.Dict)
        and any(isinstance(key, ast.Constant) and key.value == "compiled_at"
                for key in node.value.keys)
    ]
    assert len(assignments) == 1
    values = {
        "_transition_token": "1234abcd",
        "abs_name": "Example",
        "lump_filename": "Example.2.1234abcd.lump",
        "next_lump_version": 2,
        "_compiled_at": 123.5,
    }
    expression = ast.Expression(body=assignments[0].value)
    entry = eval(compile(expression, str(APP), "eval"), {"__builtins__": {}}, values)
    assert entry == {
        "token": "1234abcd",
        "abstraction": "Example",
        "filename": "Example.2.1234abcd.lump",
        "lump_version": 2,
        "compiled_at": 123.5,
    }


def test_unverified_exact_source_is_display_only_and_preserves_embedded_source(tmp_path):
    tree = ast.parse(APP.read_text(encoding="utf-8"))
    helper = next(node for node in tree.body if isinstance(node, ast.FunctionDef)
                  and node.name == "_attach_unverified_exact_source")
    import json
    import os

    namespace = {"json": json, "os": os}
    exec(compile(ast.Module(body=[helper], type_ignores=[]), str(APP), "exec"),
         namespace)
    attach = namespace[helper.name]
    binary = tmp_path / "Example.2.1234abcd.lump"
    binary.write_bytes(b"unchanged evidence")
    evidence = binary.with_suffix(".json")
    evidence.write_text(json.dumps({
        "source": "historical display text",
        "authorized": True,
        "grants": ["RWX"],
        "capabilities": ["must not become authority"],
    }))
    before = {path: path.read_bytes() for path in (binary, evidence)}
    response = {"trusted": False, "source": None}
    assert attach(response, str(binary)) == {
        "trusted": False,
        "source": None,
        "unverified_source": "historical display text",
        "unverified_source_provenance": "legacy sidecar for exact filename",
    }
    embedded = {"source": "embedded source", "trusted": True}
    assert attach(embedded, str(binary)) == embedded
    assert "unverified_source" not in embedded
    assert {path: path.read_bytes() for path in before} == before