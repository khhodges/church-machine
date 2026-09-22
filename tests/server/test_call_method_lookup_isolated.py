"""Read-only, isolated gate: executes production resolver/route without app boot."""
import ast
import json
import os
from pathlib import Path
from types import SimpleNamespace
import unittest


class LookupTests(unittest.TestCase):
    def setUp(self):
        source = Path(__file__).resolve().parents[2] / "server" / "app.py"
        tree = ast.parse(source.read_text())
        names = {"_compile_call_api_authorities", "api_compile_call_methods"}
        nodes = [n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name in names]
        for node in nodes:
            node.decorator_list = []
        self.rows = [{"name": "Alias", "token": "abcd", "binary_hash": "hash",
                      "filename": "selected.lump"}]
        self.api = {"methods": []}
        self.body = {"call_api_bindings": [{"petname": "Alias"}]}
        self.ns = {
            "os": os, "json": json, "LUMPS_DIR": "/not-read",
            "_COMPILE_API_TOKEN": "",
            "jsonify": lambda x: x,
            "request": SimpleNamespace(get_json=lambda **kw: self.body, headers={}, args={}),
            "_read_authoritative_namespace_rows": lambda: (self.rows, None),
            "_read_manifest_safe": lambda path: self.rows,
            "_inspect_lump_binary": lambda path: {"binary_hash": "hash", "words": []},
            "_parse_intrinsic_lump_content": lambda words: {"api_definition": self.api},
        }
        exec(compile(ast.Module(body=nodes, type_ignores=[]), str(source), "exec"), self.ns)

    def lookup(self):
        return self.ns["api_compile_call_methods"]()

    def test_empty_and_alias_exact_api(self):
        self.assertEqual(self.lookup()["call_api_authorities"]["Alias"]["api"]["methods"], [])
        self.api = {"methods": [{"name": "Real", "index": 7}]}
        self.body["call_api_bindings"] = [{"petname": "OtherAlias", "token": "abcd", "binary_hash": "hash"}]
        self.body["call_api_authorities"] = {"OtherAlias": {"api": {"methods": [{"name": "Run"}]}}}
        self.assertEqual(self.lookup()["call_api_authorities"]["OtherAlias"]["api"], self.api)

    def test_missing_collision_and_pin_mismatch(self):
        self.body["call_api_bindings"] = [{"petname": "Missing"}]
        self.assertEqual(self.lookup()["call_api_authorities"], {})
        self.body["call_api_bindings"] = [{"petname": "Alias", "token": "abcd", "binary_hash": "wrong"}]
        self.assertEqual(self.lookup()["call_api_authorities"], {})
        self.body["call_api_bindings"] = [{"petname": "Alias"}]
        self.rows.append(dict(self.rows[0]))
        self.assertEqual(self.lookup()["call_api_authorities"], {})

    def test_validation_and_auth(self):
        self.body = {}
        self.assertEqual(self.lookup()[1], 400)
        self.ns["_COMPILE_API_TOKEN"] = "test-only"
        self.assertEqual(self.lookup()[1], 401)


if __name__ == "__main__":
    unittest.main()