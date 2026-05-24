"""
tests/server/test_ti60_call_home.py

Tests that /api/device/call-home correctly handles the Ti60 local_bridge.py
payload format, which sends board_type as the string "Ti60F225" and now also
sends fw_major/fw_minor fields.
"""

import json
import os
import sqlite3
import sys

import pytest
import sqlalchemy as sa
from unittest.mock import patch

ROOT = os.path.normpath(os.path.join(os.path.dirname(__file__), "..", ".."))
if ROOT not in sys.path:
    sys.path.insert(0, ROOT)

import server.app as _app_module
from server.app import app, db, _parse_board_type


# ---------------------------------------------------------------------------
# Fixture
# ---------------------------------------------------------------------------

@pytest.fixture()
def client(tmp_path):
    db_file = str(tmp_path / "test.db")
    uri = f"sqlite:///{db_file}"
    test_engine = sa.create_engine(uri, connect_args={"check_same_thread": False})

    original_engines = dict(db._app_engines.get(app, {}))
    original_uri = app.config.get("SQLALCHEMY_DATABASE_URI")

    db._app_engines[app] = {None: test_engine}
    app.config["SQLALCHEMY_DATABASE_URI"] = uri
    app.config["TESTING"] = True

    with patch.object(_app_module, "db_path", db_file):
        with app.app_context():
            db.create_all()
            raw = sqlite3.connect(db_file)
            raw.execute("""
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
            raw.commit()
            raw.close()

        with app.test_client() as c:
            yield c

    test_engine.dispose()
    db._app_engines[app] = original_engines
    if original_uri is not None:
        app.config["SQLALCHEMY_DATABASE_URI"] = original_uri


# ---------------------------------------------------------------------------
# _parse_board_type unit tests
# ---------------------------------------------------------------------------

class TestParseBoardType:
    def test_integer_passthrough(self):
        assert _parse_board_type(0x03) == 0x03

    def test_numeric_string(self):
        assert _parse_board_type("3") == 3
        assert _parse_board_type("0x03") == 3

    def test_ti60f225_string(self):
        assert _parse_board_type("Ti60F225") == 0x03

    def test_ti60f225_case_insensitive(self):
        assert _parse_board_type("ti60f225") == 0x03
        assert _parse_board_type("TI60F225") == 0x03

    def test_ti60_short_name(self):
        assert _parse_board_type("Ti60") == 0x03

    def test_ti60_full_name(self):
        assert _parse_board_type("Ti60-Full") == 0x03

    def test_tn20k(self):
        assert _parse_board_type("TN20K-IoT") == 0x01
        assert _parse_board_type("TN20K") == 0x01

    def test_wukong(self):
        assert _parse_board_type("Wukong XC7A100T (Artix-7)") == 0x06
        assert _parse_board_type("Wukong") == 0x06

    def test_unknown_string_returns_zero(self):
        assert _parse_board_type("SomeUnknownBoard") == 0

    def test_zero_default(self):
        assert _parse_board_type(0) == 0


# ---------------------------------------------------------------------------
# Integration tests: POST /api/device/call-home with Ti60 bridge payload
# ---------------------------------------------------------------------------

_TI60_UID = "aabbccdd11223344"

_TI60_PAYLOAD = {
    "board_type":    "Ti60F225",
    "device_uid":    _TI60_UID,
    "nia":           "0x00000014",
    "boot_complete": 1,
    "fault_latched": 0,
    "fault_code":    0,
    "fw_major":      1,
    "fw_minor":      0,
}


class TestTi60CallHome:
    def test_returns_200(self, client):
        resp = client.post(
            "/api/device/call-home",
            data=json.dumps(_TI60_PAYLOAD),
            content_type="application/json",
        )
        assert resp.status_code == 200, f"Expected 200, got {resp.status_code}: {resp.data}"

    def test_response_ok_true(self, client):
        resp = client.post(
            "/api/device/call-home",
            data=json.dumps(_TI60_PAYLOAD),
            content_type="application/json",
        )
        body = json.loads(resp.data)
        assert body.get("ok") is True, f"Expected ok=true, got {body}"

    def _get_ti60_device(self, client):
        resp = client.get("/api/device/list")
        assert resp.status_code == 200
        data = json.loads(resp.data)
        devices = data.get("devices", data) if isinstance(data, dict) else data
        return next((d for d in devices if d.get("device_uid") == _TI60_UID), None)

    def test_fw_version_persisted(self, client):
        client.post(
            "/api/device/call-home",
            data=json.dumps(_TI60_PAYLOAD),
            content_type="application/json",
        )
        ti60 = self._get_ti60_device(client)
        assert ti60 is not None, "Ti60 device not found in /api/device/list"
        assert ti60.get("fw_version") == "1.0", (
            f"Expected fw_version='1.0', got {ti60.get('fw_version')!r}"
        )

    def test_board_name_resolved(self, client):
        client.post(
            "/api/device/call-home",
            data=json.dumps(_TI60_PAYLOAD),
            content_type="application/json",
        )
        ti60 = self._get_ti60_device(client)
        assert ti60 is not None
        board_name = ti60.get("board_name", "")
        assert "Ti60" in board_name or "ti60" in board_name.lower(), (
            f"Expected board_name to contain 'Ti60', got {board_name!r}"
        )

    def test_second_call_home_increments_boot_count(self, client):
        for _ in range(2):
            client.post(
                "/api/device/call-home",
                data=json.dumps(_TI60_PAYLOAD),
                content_type="application/json",
            )
        ti60 = self._get_ti60_device(client)
        assert ti60 is not None
        assert ti60.get("boot_count") == 2, (
            f"Expected boot_count=2, got {ti60.get('boot_count')}"
        )

    def test_fw_minor_1_persisted(self, client):
        payload = dict(_TI60_PAYLOAD, fw_minor=1)
        client.post(
            "/api/device/call-home",
            data=json.dumps(payload),
            content_type="application/json",
        )
        ti60 = self._get_ti60_device(client)
        assert ti60 is not None
        assert ti60.get("fw_version") == "1.1", (
            f"Expected fw_version='1.1', got {ti60.get('fw_version')!r}"
        )
