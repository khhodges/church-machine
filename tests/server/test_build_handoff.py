"""Isolated handoff routes: never import the live application or write its artifacts."""
import ast
import hashlib
import json
import os
from pathlib import Path
import re
import sqlite3
import tempfile
import unittest
from contextlib import nullcontext

from flask import Flask, request
from server.build_handoff import install


class HandoffTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.raw = b"exact immutable test artifact"
        self.filename = "Example.1.saved.lump"
        (self.root / self.filename).write_bytes(self.raw)
        self.digest = hashlib.sha256(self.raw).hexdigest()
        self.rows = [{"token": "4a000007", "filename": self.filename,
                      "lump_version": 16, "compiled_at": 1700000000,
                      "abstraction": "Example"}]
        self.eligible = True
        self.canonical = True
        def snapshot(path, _row):
            return {"binary_hash": hashlib.sha256(Path(path).read_bytes()).hexdigest(),
                    "raw_bytes": Path(path).read_bytes(),
                    "valid": self.eligible, "approved": self.eligible, "trusted": self.eligible}
        tree = ast.parse(Path("server/app.py").read_text())
        resolver = next(n for n in tree.body if isinstance(n, ast.FunctionDef)
                        and n.name == "_resolve_build_handoff_identity")
        origin = next(n for n in tree.body if isinstance(n, ast.FunctionDef)
                      and n.name == "_diagnostic_origin_is_same_site")
        env = {"os": os, "re": re, "request": request, "LUMPS_DIR": str(self.root),
               "_read_manifest_safe": lambda _: self.rows,
               "_check_lump_canonical_integrity": lambda *args: self.canonical,
               "_validate_lump_snapshot": snapshot}
        exec(compile(ast.Module(body=[resolver, origin], type_ignores=[]), "isolated", "exec"), env)
        self.app = Flask(__name__)
        self.app.secret_key = "isolated-test-only"
        self.db = self.root / "metadata" / "handoff.sqlite"
        self.app.config["BUILD_HANDOFF_DB"] = str(self.db)
        install(self.app, env[resolver.name], nullcontext, env[origin.name])
        self.client = self.app.test_client()
        self.locator = {"token": "4a000007", "filename": self.filename, "binary_hash": self.digest}

    def read(self, client=None):
        return (client or self.client).get("/api/build-handoff", query_string=self.locator)

    def write(self, state, released=True, client=None, **overrides):
        data = dict(self.locator, lump_version=16, released=released)
        data.update(overrides)
        return (client or self.client).post("/api/build-handoff", json=data, headers={
            "X-Build-Handoff-CSRF": state["csrf"], "If-Match": str(state["handoff"]["revision"])})

    def test_date_version_release_revoke_reload_audit_no_artifact_writes(self):
        initial = self.read()
        self.assertEqual(initial.status_code, 200)
        self.assertEqual(initial.headers["Cache-Control"], "no-store")
        state = initial.json
        self.assertEqual(state["identity"]["lump_version"], 16)
        self.assertEqual(state["identity"]["compiled_at"], "2023-11-14T22:13:20+00:00")
        self.assertFalse(self.db.exists(), "GET does not persist handoff records")
        self.assertFalse(state["handoff"]["released"])
        result = self.write(state)
        self.assertTrue(result.json["committed"])
        self.assertTrue(self.read().json["handoff"]["released"])
        result = self.write(self.read().json, False)
        self.assertFalse(result.json["handoff"]["released"])
        self.assertIsNotNone(result.json["handoff"]["updated_at"])
        with sqlite3.connect(self.db) as db:
            events = db.execute("SELECT released, artifact, actor FROM events ORDER BY id").fetchall()
        self.assertEqual([e[0] for e in events], [1, 0])
        self.assertNotIn(state["csrf"], json.dumps(events))
        self.assertEqual((self.root / self.filename).read_bytes(), self.raw)
        self.assertEqual(sorted(p.name for p in self.root.iterdir()), [self.filename, "metadata"])

    def test_revision_identity_isolation_and_stale_write(self):
        state = self.read().json
        self.assertEqual(self.write(state).status_code, 200)
        self.assertEqual(self.write(state, False).status_code, 409)
        self.rows[0]["lump_version"] = 17
        new = self.read().json
        self.assertFalse(new["handoff"]["released"])
        self.assertEqual(self.write(new).status_code, 409)
        self.assertEqual(self.write(new, lump_version=17).status_code, 200)

    def test_exact_hash_filename_token_ambiguity_symlink_and_version(self):
        state = self.read().json
        for fields in ({"binary_hash": "0" * 64}, {"filename": "../bad.lump"},
                       {"token": "00000001"}, {"lump_version": True}):
            self.assertEqual(self.write(state, **fields).status_code, 409)
        self.rows.append(dict(self.rows[0]))
        self.assertEqual(self.read().status_code, 409)
        self.rows.pop()
        artifact = self.root / self.filename
        artifact.unlink()
        artifact.symlink_to(self.root / "missing")
        self.assertEqual(self.read().status_code, 409)
        self.assertFalse(self.db.exists())

    def test_proof_origin_and_eligibility_fail_closed(self):
        state = self.read().json
        self.assertEqual(self.write(state, client=self.app.test_client()).status_code, 403)
        self.assertEqual(self.client.post("/api/build-handoff", json=self.locator,
                        headers={"Sec-Fetch-Site": "cross-site"}).status_code, 403)
        self.assertEqual(self.client.get("/api/build-handoff", query_string=self.locator,
                        headers={"Origin": "https://attacker.example"}).status_code, 403)
        self.eligible = False
        self.assertFalse(self.read().json["identity"]["eligible"])
        self.assertEqual(self.write(state).status_code, 409)
        self.assertFalse(self.db.exists())

    def test_storage_error_is_explicit_no_success(self):
        self.db.parent.mkdir()
        self.db.write_bytes(b"not sqlite")
        result = self.read()
        self.assertEqual(result.status_code, 503)
        self.assertIsNone(result.json["committed"])

    def test_canonical_failure_cannot_release_and_new_digest_is_unreleased(self):
        state = self.read().json
        self.canonical = "canonical integrity mismatch"
        self.assertFalse(self.read().json["identity"]["eligible"])
        self.assertEqual(self.write(state).status_code, 409)
        self.canonical = True
        self.assertEqual(self.write(state).status_code, 200)
        raw = b"different exact revision bytes"
        (self.root / self.filename).write_bytes(raw)
        self.locator["binary_hash"] = hashlib.sha256(raw).hexdigest()
        self.assertFalse(self.read().json["handoff"]["released"])


if __name__ == "__main__":
    unittest.main()