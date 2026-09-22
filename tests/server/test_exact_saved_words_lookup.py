"""Execute the real read-only route against private files, without app startup."""
import ast
import hashlib
import json
import os
from pathlib import Path
from types import SimpleNamespace
import tempfile
import unittest


class ExactSavedWordsTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.directory = Path(self.temp.name)
        self.filename = "CapabilityTest.1.new.lump"
        self.raw = bytes.fromhex("f8000800000000021f000000")
        (self.directory / self.filename).write_bytes(self.raw)
        self.digest = hashlib.sha256(self.raw).hexdigest()
        self.rows = [{"token": "4a00000a", "filename": self.filename,
                      "abstraction": "CapabilityTest", "lump_version": 33}]
        self.args = {"exact_filename": self.filename, "binary_hash": self.digest}
        self.inspected = []
        def inspect(path):
            self.inspected.append(path)
            data = Path(path).read_bytes()
            return {"raw_bytes": data, "words": [
                int.from_bytes(data[i:i + 4], "big") for i in range(0, len(data), 4)],
                "binary_hash": hashlib.sha256(data).hexdigest(), "cw": 2}
        source = Path(__file__).resolve().parents[2] / "server" / "app.py"
        tree = ast.parse(source.read_text())
        route = next(n for n in tree.body if isinstance(n, ast.FunctionDef)
                     and n.name == "get_lump_words")
        route.decorator_list = []
        self.env = {
            "os": os, "json": json, "LUMPS_DIR": str(self.directory),
            "request": SimpleNamespace(args=self.args), "jsonify": lambda body: body,
            "_read_manifest_safe": lambda _: self.rows,
            "_inspect_lump_binary": inspect,
            "_check_lump_canonical_integrity": lambda *a: True,
            "_matching_lump_approval": lambda *a: None,
            "_LumpApprovalStoreError": type("ApprovalError", (Exception,), {}),
            "_bootstrap_snapshot_identity": lambda *a: None,
            "_activation_eligibility": lambda **kw: {},
            "_lump_preview_issues": lambda *a, **kw: [],
            "_lump_archive_provenance": lambda *a, **kw: {"kind": "archived-manifest-row"},
            "_validate_lump_snapshot": lambda *a: {"errors": []},
        }
        exec(compile(ast.Module(body=[route], type_ignores=[]), str(source), "exec"), self.env)

    def get(self, token="4a00000a"):
        return self.env["get_lump_words"](token)

    def test_new_active_save_is_not_an_archive(self):
        # This was the actual erroneous client URL: active filename supplied
        # to archive-only lookup. It must remain rejected on the legacy route.
        self.args.clear()
        self.args["archive_filename"] = self.filename
        self.assertEqual(self.get()[1], 404)
        self.args.clear()
        self.args.update(exact_filename=self.filename, binary_hash=self.digest)
        result = self.get()
        self.assertEqual(result["filename"], self.filename)
        self.assertEqual(result["binary_hash"], self.digest)
        self.assertEqual(result["words"], [0xf8000800, 2, 0x1f000000])

    def test_same_token_new_revision_never_substitutes(self):
        self.rows.insert(0, dict(self.rows[0], filename="newer.lump", lump_version=34))
        (self.directory / "newer.lump").write_bytes(b"different")
        self.assertEqual(self.get()["binary_hash"], self.digest)
        self.assertEqual(self.inspected, [str(self.directory / self.filename)])
        self.args["binary_hash"] = "0" * 64
        self.assertEqual(self.get()[1], 409)

    def test_wrong_token_filename_traversal_duplicates_and_alias_fail_closed(self):
        self.assertEqual(self.get("12345678")[1], 404)
        self.args["exact_filename"] = "../outside.lump"
        self.assertEqual(self.get()[1], 400)
        self.args["exact_filename"] = self.filename
        self.rows.append(dict(self.rows[0]))
        self.assertEqual(self.get()[1], 409)
        self.rows.pop()
        (self.directory / self.filename).unlink()
        (self.directory / self.filename).symlink_to("newer.lump")
        self.assertEqual(self.get()[1], 409)
        self.assertEqual(self.inspected, [])

    def test_exact_historical_record_remains_historical(self):
        self.rows[0]["archived"] = True
        result = self.get()
        self.assertEqual(result["filename"], self.filename)
        self.assertTrue(result["historical_record"])


if __name__ == "__main__":
    unittest.main()