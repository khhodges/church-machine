"""
tests/server/test_version_telemetry.py

Automated test coverage for the version telemetry and device upgrade endpoints:

  POST /api/device/fault
  POST /api/device/lump-versions
  POST /api/device/upgrade-lump
  GET  /api/lump/version-telemetry/<name>

Each test function uses a fresh in-memory SQLite database so tests are fully
isolated from the development database.
"""

import json
import os
import sqlite3
import sys
import time
from contextlib import contextmanager
from unittest.mock import patch

import pytest
import sqlalchemy as sa

ROOT = os.path.normpath(os.path.join(os.path.dirname(__file__), "..", ".."))
if ROOT not in sys.path:
    sys.path.insert(0, ROOT)

import server.app as _app_module
from server.app import app, db


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _create_device_lump_versions_table(conn):
    conn.execute("""
        CREATE TABLE IF NOT EXISTS device_lump_versions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            device_uid TEXT NOT NULL,
            abstraction_name TEXT NOT NULL,
            lump_token TEXT NOT NULL,
            lump_version INTEGER NOT NULL DEFAULT 0,
            deployed_at REAL NOT NULL DEFAULT 0,
            UNIQUE(device_uid, abstraction_name)
        )
    """)
    conn.commit()


def _write_manifest(path, entries):
    with open(path, "w") as f:
        json.dump(entries, f)


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

@pytest.fixture()
def test_env(tmp_path):
    """
    Yield (flask_test_client, manifest_path, tmp_db_path).

    A fresh SQLite file is used for each test.  Both app.config and the
    module-level db_path variable (used by _compute_version_telemetry) are
    patched to point at the same temp file.  A minimal manifest JSON is
    written so telemetry can join fault data against token metadata.
    """
    db_file = str(tmp_path / "test.db")
    manifest_file = str(tmp_path / "manifest.json")

    test_manifest = [
        {
            "abstraction": "TestAbstr",
            "token": "deadbeef",
            "lump_version": 1,
            "compiled_at": "2026-01-01T00:00:00Z",
            "ns_slot": 10,
        },
        {
            "abstraction": "TestAbstr",
            "token": "cafef00d",
            "lump_version": 2,
            "compiled_at": "2026-02-01T00:00:00Z",
            "ns_slot": 10,
        },
    ]
    _write_manifest(manifest_file, test_manifest)

    uri = f"sqlite:///{db_file}"

    test_engine = sa.create_engine(uri, connect_args={"check_same_thread": False})

    original_engines = dict(db._app_engines.get(app, {}))
    original_uri = app.config.get("SQLALCHEMY_DATABASE_URI")

    db._app_engines[app] = {None: test_engine}
    app.config["SQLALCHEMY_DATABASE_URI"] = uri
    app.config["TESTING"] = True

    with (
        patch.object(_app_module, "db_path", db_file),
        patch.object(_app_module, "LUMPS_MANIFEST_PATH", manifest_file),
    ):
        with app.app_context():
            db.create_all()
            raw = sqlite3.connect(db_file)
            _create_device_lump_versions_table(raw)
            raw.close()

        with app.test_client() as client:
            yield client, manifest_file, db_file

    test_engine.dispose()
    db._app_engines[app] = original_engines
    if original_uri is not None:
        app.config["SQLALCHEMY_DATABASE_URI"] = original_uri


# ---------------------------------------------------------------------------
# POST /api/device/fault
# ---------------------------------------------------------------------------

class TestDeviceFaultSubmit:

    def test_missing_device_uid_returns_400(self, test_env):
        client, _, _ = test_env
        r = client.post(
            "/api/device/fault",
            json={"fault_code": "GT_PERM"},
        )
        assert r.status_code == 400
        body = r.get_json()
        assert body["ok"] is False
        assert "device_uid" in body["error"]

    def test_minimal_payload_creates_record(self, test_env):
        client, _, db_file = test_env
        r = client.post(
            "/api/device/fault",
            json={"device_uid": "aabbccdd11223344"},
        )
        assert r.status_code == 200
        body = r.get_json()
        assert body["ok"] is True
        assert isinstance(body["id"], int)

        conn = sqlite3.connect(db_file)
        row = conn.execute(
            "SELECT device_uid, fault_type, fault_nia FROM fault_events WHERE id=?",
            (body["id"],),
        ).fetchone()
        conn.close()
        assert row[0] == "aabbccdd11223344"
        assert row[1] == 0
        assert row[2] == 0

    def test_full_payload_stored_correctly(self, test_env):
        client, _, db_file = test_env
        payload = {
            "device_uid": "device001",
            "lump_token": "deadbeef",
            "lump_version": 3,
            "fault_code": "GT_PERM",
            "mnemonic": "ELOADCALL",
            "pipeline_stage": "FETCH",
            "recovery_tier": 1,
            "instruction_address": 0x1234,
            "step_count": 5000,
        }
        r = client.post("/api/device/fault", json=payload)
        assert r.status_code == 200
        row_id = r.get_json()["id"]

        conn = sqlite3.connect(db_file)
        conn.row_factory = sqlite3.Row
        row = conn.execute(
            "SELECT * FROM fault_events WHERE id=?", (row_id,)
        ).fetchone()
        conn.close()

        assert row["device_uid"] == "device001"
        assert row["lump_token"] == "deadbeef"
        assert row["lump_version"] == 3
        assert row["fault_code"] == "GT_PERM"
        assert row["mnemonic"] == "ELOADCALL"
        assert row["pipeline_stage"] == "FETCH"
        assert row["recovery_tier"] == 1
        assert row["fault_nia"] == 0x1234
        assert row["step_count"] == 5000

    def test_fault_nia_alias_accepted(self, test_env):
        """instruction_address and fault_nia are both accepted aliases."""
        client, _, db_file = test_env
        r = client.post(
            "/api/device/fault",
            json={"device_uid": "dev1", "fault_nia": 0xABCD},
        )
        row_id = r.get_json()["id"]
        conn = sqlite3.connect(db_file)
        nia = conn.execute(
            "SELECT fault_nia FROM fault_events WHERE id=?", (row_id,)
        ).fetchone()[0]
        conn.close()
        assert nia == 0xABCD

    def test_tier_alias_accepted(self, test_env):
        client, _, db_file = test_env
        r = client.post(
            "/api/device/fault",
            json={"device_uid": "dev1", "tier": 3},
        )
        row_id = r.get_json()["id"]
        conn = sqlite3.connect(db_file)
        tier = conn.execute(
            "SELECT recovery_tier FROM fault_events WHERE id=?", (row_id,)
        ).fetchone()[0]
        conn.close()
        assert tier == 3

    def test_invalid_numeric_fields_default_to_zero(self, test_env):
        client, _, db_file = test_env
        r = client.post(
            "/api/device/fault",
            json={
                "device_uid": "dev1",
                "lump_version": "not-a-number",
                "recovery_tier": None,
                "step_count": "bad",
                "instruction_address": "oops",
            },
        )
        assert r.status_code == 200
        row_id = r.get_json()["id"]
        conn = sqlite3.connect(db_file)
        row = conn.execute(
            "SELECT lump_version, recovery_tier, step_count, fault_nia FROM fault_events WHERE id=?",
            (row_id,),
        ).fetchone()
        conn.close()
        assert row == (0, 0, 0, 0)

    def test_multiple_faults_accumulate(self, test_env):
        client, _, db_file = test_env
        for i in range(5):
            r = client.post(
                "/api/device/fault",
                json={"device_uid": "dev1", "step_count": i * 100},
            )
            assert r.status_code == 200

        conn = sqlite3.connect(db_file)
        count = conn.execute(
            "SELECT COUNT(*) FROM fault_events WHERE device_uid='dev1'"
        ).fetchone()[0]
        conn.close()
        assert count == 5


# ---------------------------------------------------------------------------
# POST /api/device/lump-versions
# ---------------------------------------------------------------------------

class TestDeviceLumpVersionsUpdate:

    def test_missing_device_uid_returns_400(self, test_env):
        client, _, _ = test_env
        r = client.post("/api/device/lump-versions", json={"lumps": []})
        assert r.status_code == 400
        assert r.get_json()["ok"] is False

    def test_empty_lumps_list_ok(self, test_env):
        client, _, _ = test_env
        r = client.post(
            "/api/device/lump-versions",
            json={"device_uid": "dev1", "lumps": []},
        )
        assert r.status_code == 200
        body = r.get_json()
        assert body["ok"] is True
        assert body["updated"] == 0

    def test_bulk_registration_persisted(self, test_env):
        client, _, db_file = test_env
        lumps = [
            {"abstraction_name": "Foo", "lump_token": "tok1", "lump_version": 1},
            {"abstraction_name": "Bar", "lump_token": "tok2", "lump_version": 2},
        ]
        r = client.post(
            "/api/device/lump-versions",
            json={"device_uid": "dev-abc", "lumps": lumps},
        )
        assert r.status_code == 200
        assert r.get_json()["updated"] == 2

        conn = sqlite3.connect(db_file)
        rows = conn.execute(
            "SELECT abstraction_name, lump_token, lump_version FROM device_lump_versions WHERE device_uid='dev-abc' ORDER BY abstraction_name"
        ).fetchall()
        conn.close()
        assert len(rows) == 2
        assert rows[0] == ("Bar", "tok2", 2)
        assert rows[1] == ("Foo", "tok1", 1)

    def test_upsert_updates_existing_row(self, test_env):
        client, _, db_file = test_env
        uid = "dev-upsert"
        initial = [{"abstraction_name": "Foo", "lump_token": "old", "lump_version": 1}]
        client.post(
            "/api/device/lump-versions",
            json={"device_uid": uid, "lumps": initial},
        )
        updated = [{"abstraction_name": "Foo", "lump_token": "new", "lump_version": 2}]
        r = client.post(
            "/api/device/lump-versions",
            json={"device_uid": uid, "lumps": updated},
        )
        assert r.status_code == 200

        conn = sqlite3.connect(db_file)
        row = conn.execute(
            "SELECT lump_token, lump_version FROM device_lump_versions WHERE device_uid=? AND abstraction_name='Foo'",
            (uid,),
        ).fetchone()
        conn.close()
        assert row == ("new", 2)

    def test_entries_without_name_or_token_skipped(self, test_env):
        client, _, db_file = test_env
        lumps = [
            {"abstraction_name": "", "lump_token": "tok1", "lump_version": 1},
            {"abstraction_name": "Good", "lump_token": "", "lump_version": 1},
            {"abstraction_name": "Valid", "lump_token": "tok3", "lump_version": 1},
        ]
        r = client.post(
            "/api/device/lump-versions",
            json={"device_uid": "dev-skip", "lumps": lumps},
        )
        assert r.status_code == 200

        conn = sqlite3.connect(db_file)
        count = conn.execute(
            "SELECT COUNT(*) FROM device_lump_versions WHERE device_uid='dev-skip'"
        ).fetchone()[0]
        conn.close()
        assert count == 1


# ---------------------------------------------------------------------------
# POST /api/device/upgrade-lump
# ---------------------------------------------------------------------------

class TestDeviceUpgradeLump:

    def test_missing_required_fields_returns_400(self, test_env):
        client, _, _ = test_env
        cases = [
            {},
            {"device_uid": "d1"},
            {"device_uid": "d1", "abstraction_name": "Foo"},
            {"device_uid": "d1", "lump_token": "tok"},
            {"abstraction_name": "Foo", "lump_token": "tok"},
        ]
        for body in cases:
            r = client.post("/api/device/upgrade-lump", json=body)
            assert r.status_code == 400, f"expected 400 for payload {body}"
            assert r.get_json()["ok"] is False

    def test_upgrade_creates_new_row(self, test_env):
        client, _, db_file = test_env
        r = client.post(
            "/api/device/upgrade-lump",
            json={
                "device_uid": "dev-up1",
                "abstraction_name": "TestAbstr",
                "lump_token": "deadbeef",
                "lump_version": 5,
            },
        )
        assert r.status_code == 200
        assert r.get_json()["ok"] is True

        conn = sqlite3.connect(db_file)
        row = conn.execute(
            "SELECT lump_token, lump_version FROM device_lump_versions WHERE device_uid='dev-up1' AND abstraction_name='TestAbstr'"
        ).fetchone()
        conn.close()
        assert row == ("deadbeef", 5)

    def test_upgrade_overwrites_existing_row(self, test_env):
        client, _, db_file = test_env
        uid = "dev-up2"
        client.post(
            "/api/device/upgrade-lump",
            json={
                "device_uid": uid,
                "abstraction_name": "TestAbstr",
                "lump_token": "oldtok",
                "lump_version": 1,
            },
        )
        client.post(
            "/api/device/upgrade-lump",
            json={
                "device_uid": uid,
                "abstraction_name": "TestAbstr",
                "lump_token": "newtok",
                "lump_version": 9,
            },
        )
        conn = sqlite3.connect(db_file)
        row = conn.execute(
            "SELECT lump_token, lump_version FROM device_lump_versions WHERE device_uid=? AND abstraction_name='TestAbstr'",
            (uid,),
        ).fetchone()
        conn.close()
        assert row == ("newtok", 9)

    def test_invalid_lump_version_defaults_to_zero(self, test_env):
        client, _, db_file = test_env
        r = client.post(
            "/api/device/upgrade-lump",
            json={
                "device_uid": "dev-ver",
                "abstraction_name": "TestAbstr",
                "lump_token": "tok1",
                "lump_version": "bad",
            },
        )
        assert r.status_code == 200
        conn = sqlite3.connect(db_file)
        ver = conn.execute(
            "SELECT lump_version FROM device_lump_versions WHERE device_uid='dev-ver'"
        ).fetchone()[0]
        conn.close()
        assert ver == 0


# ---------------------------------------------------------------------------
# GET /api/lump/version-telemetry/<name>
# ---------------------------------------------------------------------------

class TestLumpVersionTelemetry:

    def _seed_faults(self, db_file, device_uid, lump_token, lump_version,
                     tier, count=1, step_count=10000):
        conn = sqlite3.connect(db_file)
        for _ in range(count):
            conn.execute("""
                INSERT INTO fault_events
                    (device_uid, fault_type, fault_nia, boot_reason, timestamp,
                     lump_token, lump_version, fault_code, mnemonic,
                     pipeline_stage, recovery_tier, step_count)
                VALUES (?, 0, 0, 0, ?, ?, ?, '', '', '', ?, ?)
            """, (device_uid, time.time(), lump_token, lump_version, tier, step_count))
        conn.commit()
        conn.close()

    def _seed_device_version(self, db_file, device_uid, abstraction_name,
                             lump_token, lump_version):
        conn = sqlite3.connect(db_file)
        conn.execute("""
            INSERT OR REPLACE INTO device_lump_versions
                (device_uid, abstraction_name, lump_token, lump_version, deployed_at)
            VALUES (?, ?, ?, ?, ?)
        """, (device_uid, abstraction_name, lump_token, lump_version, time.time()))
        conn.commit()
        conn.close()

    def test_unknown_abstraction_returns_empty_versions(self, test_env):
        client, _, _ = test_env
        r = client.get("/api/lump/version-telemetry/NoSuchAbstr")
        assert r.status_code == 200
        body = r.get_json()
        assert body["ok"] is True
        assert body["abstraction"] == "NoSuchAbstr"
        assert body["versions"] == []

    def test_response_shape_for_known_abstraction(self, test_env):
        client, _, db_file = test_env
        self._seed_device_version(db_file, "dev1", "TestAbstr", "deadbeef", 1)

        r = client.get("/api/lump/version-telemetry/TestAbstr")
        assert r.status_code == 200
        body = r.get_json()
        assert body["ok"] is True
        assert body["abstraction"] == "TestAbstr"

        versions = body["versions"]
        assert len(versions) >= 1

        required_keys = {
            "lump_version", "lump_token", "compiled_at", "device_count",
            "total_faults", "fault_rate", "fault_rate_per_1000",
            "tier1_count", "tier2_count", "tier3_count", "unrecovered_count",
            "mtbf", "stable_status", "production_stable",
        }
        for v in versions:
            assert required_keys.issubset(set(v.keys())), (
                f"Missing keys: {required_keys - set(v.keys())}"
            )

    def test_device_count_reflects_registered_devices(self, test_env):
        client, _, db_file = test_env
        for uid in ("dev1", "dev2", "dev3"):
            self._seed_device_version(db_file, uid, "TestAbstr", "deadbeef", 1)

        r = client.get("/api/lump/version-telemetry/TestAbstr")
        versions = r.get_json()["versions"]
        entry = next((v for v in versions if v["lump_token"] == "deadbeef"), None)
        assert entry is not None
        assert entry["device_count"] == 3

    def test_stable_status_green_when_no_faults(self, test_env):
        client, _, db_file = test_env
        self._seed_device_version(db_file, "dev1", "TestAbstr", "deadbeef", 1)

        r = client.get("/api/lump/version-telemetry/TestAbstr")
        versions = r.get_json()["versions"]
        entry = next(v for v in versions if v["lump_token"] == "deadbeef")
        assert entry["stable_status"] == "stable"
        assert entry["total_faults"] == 0

    def test_stable_status_amber_on_tier3_faults(self, test_env):
        """tier3 faults (with no unrecovered) → amber."""
        client, _, db_file = test_env
        self._seed_faults(db_file, "dev1", "deadbeef", 1, tier=3, count=2, step_count=50000)
        self._seed_device_version(db_file, "dev1", "TestAbstr", "deadbeef", 1)

        r = client.get("/api/lump/version-telemetry/TestAbstr")
        versions = r.get_json()["versions"]
        entry = next(v for v in versions if v["lump_token"] == "deadbeef")
        assert entry["stable_status"] == "amber"
        assert entry["tier3_count"] == 2
        assert entry["unrecovered_count"] == 0

    def test_stable_status_red_on_unrecovered_faults(self, test_env):
        """Unrecovered faults (tier=0) → red."""
        client, _, db_file = test_env
        self._seed_faults(db_file, "dev1", "deadbeef", 1, tier=0, count=1, step_count=1000)
        self._seed_device_version(db_file, "dev1", "TestAbstr", "deadbeef", 1)

        r = client.get("/api/lump/version-telemetry/TestAbstr")
        versions = r.get_json()["versions"]
        entry = next(v for v in versions if v["lump_token"] == "deadbeef")
        assert entry["stable_status"] == "red"
        assert entry["unrecovered_count"] >= 1

    def test_stable_status_stable_with_only_tier1_and_tier2(self, test_env):
        client, _, db_file = test_env
        self._seed_faults(db_file, "dev1", "deadbeef", 1, tier=1, count=3, step_count=100000)
        self._seed_faults(db_file, "dev1", "deadbeef", 1, tier=2, count=2, step_count=100000)
        self._seed_device_version(db_file, "dev1", "TestAbstr", "deadbeef", 1)

        r = client.get("/api/lump/version-telemetry/TestAbstr")
        versions = r.get_json()["versions"]
        entry = next(v for v in versions if v["lump_token"] == "deadbeef")
        assert entry["stable_status"] == "stable"
        assert entry["tier1_count"] == 3
        assert entry["tier2_count"] == 2

    def test_fault_rate_and_mtbf_computed(self, test_env):
        """With 2 faults and 20000 total steps, fault_rate and mtbf are correct."""
        client, _, db_file = test_env
        self._seed_faults(db_file, "dev1", "deadbeef", 1, tier=1, count=2, step_count=10000)
        self._seed_device_version(db_file, "dev1", "TestAbstr", "deadbeef", 1)

        r = client.get("/api/lump/version-telemetry/TestAbstr")
        entry = next(
            v for v in r.get_json()["versions"] if v["lump_token"] == "deadbeef"
        )
        assert entry["total_faults"] == 2
        expected_rate = round(2 / 20000, 6)
        assert abs(entry["fault_rate"] - expected_rate) < 1e-9
        assert entry["mtbf"] == round(20000 / 2, 1)

    def test_multiple_token_versions_tracked_independently(self, test_env):
        """Faults for v1 token and v2 token are reported as separate version entries."""
        client, _, db_file = test_env
        self._seed_faults(db_file, "dev1", "deadbeef", 1, tier=0, count=3, step_count=5000)
        self._seed_faults(db_file, "dev2", "cafef00d", 2, tier=1, count=1, step_count=5000)
        self._seed_device_version(db_file, "dev1", "TestAbstr", "deadbeef", 1)
        self._seed_device_version(db_file, "dev2", "TestAbstr", "cafef00d", 2)

        r = client.get("/api/lump/version-telemetry/TestAbstr")
        versions = r.get_json()["versions"]
        tokens = {v["lump_token"] for v in versions}
        assert "deadbeef" in tokens
        assert "cafef00d" in tokens

        v1 = next(v for v in versions if v["lump_token"] == "deadbeef")
        v2 = next(v for v in versions if v["lump_token"] == "cafef00d")
        assert v1["stable_status"] == "red"
        assert v2["stable_status"] == "stable"

    def test_abstraction_name_in_response(self, test_env):
        client, _, _ = test_env
        r = client.get("/api/lump/version-telemetry/TestAbstr")
        assert r.get_json()["abstraction"] == "TestAbstr"

    def test_compiled_at_present_when_in_manifest(self, test_env):
        client, _, db_file = test_env
        self._seed_device_version(db_file, "dev1", "TestAbstr", "deadbeef", 1)

        r = client.get("/api/lump/version-telemetry/TestAbstr")
        versions = r.get_json()["versions"]
        entry = next((v for v in versions if v["lump_token"] == "deadbeef"), None)
        assert entry is not None
        assert entry["compiled_at"] == "2026-01-01T00:00:00Z"

    def test_fault_ingestion_then_telemetry_roundtrip(self, test_env):
        """End-to-end: submit faults via endpoint, check telemetry reflects them."""
        client, _, _ = test_env
        for _ in range(4):
            r = client.post(
                "/api/device/fault",
                json={
                    "device_uid": "roundtrip-dev",
                    "lump_token": "deadbeef",
                    "lump_version": 1,
                    "recovery_tier": 3,
                    "step_count": 25000,
                },
            )
            assert r.status_code == 200

        r = client.post(
            "/api/device/lump-versions",
            json={
                "device_uid": "roundtrip-dev",
                "lumps": [
                    {
                        "abstraction_name": "TestAbstr",
                        "lump_token": "deadbeef",
                        "lump_version": 1,
                    }
                ],
            },
        )
        assert r.status_code == 200

        r = client.get("/api/lump/version-telemetry/TestAbstr")
        body = r.get_json()
        assert body["ok"] is True
        entry = next(
            (v for v in body["versions"] if v["lump_token"] == "deadbeef"), None
        )
        assert entry is not None
        assert entry["tier3_count"] == 4
        assert entry["total_faults"] == 4
        assert entry["stable_status"] == "amber"
        assert entry["device_count"] == 1
