"""Read-only, isolated gate: executes production resolver/route without app boot."""
import ast
import json
import os
import struct
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
            "os": os, "json": json, "_struct": struct, "LUMPS_DIR": "/not-read",
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

    def test_library_name_latest_and_explicit_pin(self):
        self.rows = []
        catalog = [
            {"abstraction": "ide.CapabilityTest", "token": "old",
             "filename": "old.lump", "lump_version": 6},
            {"abstraction": "ide.CapabilityTest", "token": "new",
             "filename": "new.lump", "lump_version": 7},
            {"abstraction": "ide.CapabilityTest", "token": "archived",
             "filename": "archived.lump", "lump_version": 99, "archived": True},
        ]
        self.ns["_read_manifest_safe"] = lambda path: catalog
        self.body["call_api_bindings"] = [{"petname": "ide.CapabilityTest"}]
        self.api = {"methods": [{"name": "Run", "index": 0}]}
        authority = self.lookup()["call_api_authorities"]["ide.CapabilityTest"]
        self.assertEqual(authority["token"], "new")
        self.assertEqual(authority["api"]["methods"][0]["index"], 0)
        self.body["call_api_bindings"][0]["token"] = "old"
        self.assertEqual(self.lookup()["call_api_authorities"]["ide.CapabilityTest"]["token"], "old")
        self.body["call_api_bindings"][0]["token"] = "missing"
        self.assertEqual(self.lookup()["call_api_authorities"], {})
        del self.body["call_api_bindings"][0]["token"]
        catalog.append(dict(catalog[1], token="ambiguous"))
        self.assertEqual(self.lookup()["call_api_authorities"], {})

    def test_namespace_assignment_precedes_library_and_does_not_fall_back(self):
        self.ns["_read_manifest_safe"] = lambda path: [{
            "abstraction": "Alias", "token": "library", "filename": "library.lump",
            "lump_version": 99}]
        self.assertEqual(self.lookup()["call_api_authorities"]["Alias"]["token"], "abcd")
        self.rows[0]["binary_hash"] = "wrong"
        self.assertEqual(self.lookup()["call_api_authorities"], {})

    def test_compact_saved_api_exposes_run_without_inventing_a_method(self):
        source = Path(__file__).resolve().parents[2] / "server" / "app.py"
        node = next(n for n in ast.parse(source.read_text()).body
                    if isinstance(n, ast.FunctionDef) and n.name == "_parse_intrinsic_lump_content")
        exec(compile(ast.Module(body=[node], type_ignores=[]), str(source), "exec"), self.ns)
        api = {"name": "Alias",
               "methods": {"Run": {"selector": 0, "returns": "DR1"}}}
        raw = json.dumps(api, separators=(",", ":")).encode()
        padded = raw + b"\0" * (-len(raw) % 4)
        words = [(31 << 27) | (2 << 10) | 1, 2, 0x1f000000,
                 (0xab << 24) | len(raw)] + list(struct.unpack(f">{len(padded)//4}I", padded))
        words += [0] * (64 - len(words))
        self.ns["_inspect_lump_binary"] = lambda path: {"binary_hash": "hash", "words": words}
        methods = self.lookup()["call_api_authorities"]["Alias"]["api"]["methods"]
        self.assertEqual([(m["name"], m["index"]) for m in methods], [("Run", 0)])


if __name__ == "__main__":
    unittest.main()