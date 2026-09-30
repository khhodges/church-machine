"""Pure/extracted publication tests: never import the live Flask application."""
import ast
import copy
import json
from pathlib import Path
import tempfile
import unittest

from server.namespace_authority import namespace_fingerprint, validate_namespace_rows


class NamespaceAuthorityTests(unittest.TestCase):
    def setUp(self):
        self.rows = [{"slot": 1, "name": "Boot.Thread", "boot": True},
                     {"slot": 14, "name": "ide.Alice", "resident": False,
                      "load_policy": "Lazy", "token": "old", "filename": "old.lump"}]

    def test_fingerprint_covers_policy_and_membership(self):
        before = namespace_fingerprint(self.rows)
        altered = copy.deepcopy(self.rows)
        altered[1]["load_policy"] = "Resident"
        self.assertNotEqual(before, namespace_fingerprint(altered))
        self.assertEqual(before, namespace_fingerprint(copy.deepcopy(self.rows)))

    def test_mixed_design_rejected_without_repair(self):
        self.rows[1].update(symbolic=True, implementationMissing=True, selection={})
        before = copy.deepcopy(self.rows)
        with self.assertRaisesRegex(ValueError, "design placement"):
            validate_namespace_rows(self.rows)
        self.assertEqual(before, self.rows)

    def test_duplicate_boolean_slot_and_invalid_flags(self):
        for replacement in ({"slot": True}, {"slot": 1}, {"resident": "false"}):
            rows = copy.deepcopy(self.rows)
            rows[1].update(replacement)
            with self.assertRaises(ValueError):
                validate_namespace_rows(rows)

    def test_design_and_mmio_are_assignments_not_lumps(self):
        rows = [{"slot": 13, "name": "M_BIT_DEV", "location": "0xFFFFFF1C"},
                {"slot": 15, "name": "ide.Mallory", "symbolic": True,
                 "implementationMissing": True, "location": "0x00000000",
                 "selection": {"status": "unresolved"}}]
        self.assertEqual(validate_namespace_rows(rows), rows)

    def test_saved_replacement_preserves_policy_and_rejects_design(self):
        source = Path("server/app.py").read_text()
        tree = ast.parse(source)
        names = {"_prepare_saved_lump_ns_state", "_check_namespace_save_revision"}
        extracted = ast.Module(body=[node for node in tree.body
                                    if isinstance(node, ast.FunctionDef) and node.name in names],
                               type_ignores=[])
        import os
        with tempfile.TemporaryDirectory() as directory:
            state = Path(directory) / "ns-state.json"
            state.write_text(json.dumps({"abstractions": self.rows}))
            scope = {"os": os, "json": json, "NS_STATE_PATH": str(state),
                     "_validate_namespace_publication": validate_namespace_rows,
                     "_expected_namespace_fingerprint": lambda m: m.get("namespaceFingerprint"),
                     "_read_authoritative_namespace_rows": lambda: (
                         self.rows, namespace_fingerprint(self.rows))}
            exec(compile(extracted, "isolated-app-functions", "exec"), scope)
            prepare = scope["_prepare_saved_lump_ns_state"]
            output = prepare("ide.Alice", 14, "new", "new.lump", 1, 2)
            self.assertEqual(output[1]["load_policy"], "Lazy")
            self.assertIs(output[1]["resident"], False)
            self.assertEqual(json.loads(state.read_text())["abstractions"], self.rows)
            self.rows[1] = {"slot": 14, "name": "ide.Alice", "symbolic": True,
                            "implementationMissing": True, "selection": {}}
            state.write_text(json.dumps({"abstractions": self.rows}))
            with self.assertRaisesRegex(ValueError, "explicit Namespace installation"):
                prepare("ide.Alice", 14, "new", "new.lump", 1, 2)
            check = scope["_check_namespace_save_revision"]
            with self.assertRaisesRegex(ValueError, "required"):
                check({})
            with self.assertRaisesRegex(ValueError, "changed"):
                check({"namespaceFingerprint": "stale"})
            check({"namespaceFingerprint": namespace_fingerprint(self.rows)})


if __name__ == "__main__":
    unittest.main()