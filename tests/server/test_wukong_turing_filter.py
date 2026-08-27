"""
tests/server/test_wukong_turing_filter.py

Regression guard: the Turing-filter bridge flag must survive the full
POST /hardware/wukong/bridge-status → GET /hardware/wukong/status round-trip.

Background
──────────
The bridge runs with --church-only to suppress bare Turing RESULT packets when
only Church-Machine trace is needed.  It advertises this via:

    POST /hardware/wukong/bridge-status  {church_only: true, session_id: ...}

The IDE reads it back via:

    GET  /hardware/wukong/status  →  response['bridge']['church_only']

If either end of this path regresses (field not stored, field not returned, field
silently coerced to a wrong value), the amber "Turing filter ON" badge in the HW
Trace panel header stops updating and users lose visibility into filtering state.

Tests
─────
TestChurchOnlyRoundTrip
  • church_only=True is stored and returned correctly
  • church_only absent from POST body → defaults to False
  • church_only=False is returned as False (not None / missing)
  • True then False overwrite works; False then True overwrite works
  • No session_id → bridge_info not updated (server-side guard)
  • church_only field is a proper bool (not truthy int or string) in the response
"""

import json
import os
import sys

import pytest

ROOT = os.path.normpath(os.path.join(os.path.dirname(__file__), '..', '..'))
if ROOT not in sys.path:
    sys.path.insert(0, ROOT)

import server.app as _app_module
from server.app import app


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _reset_state():
    """Reset Wukong bridge state between tests."""
    with _app_module._wukong_bridge_lock:
        _app_module._wukong_bridge_timeline.clear()
        _app_module._wukong_bridge_info.clear()


@pytest.fixture()
def client():
    app.config['TESTING'] = True
    _reset_state()
    with app.test_client() as c:
        yield c
    _reset_state()


def _bridge_status(client, **body):
    """POST /hardware/wukong/bridge-status with the supplied JSON body."""
    return client.post(
        '/hardware/wukong/bridge-status',
        data=json.dumps(body),
        content_type='application/json',
    )


def _status(client):
    """GET /hardware/wukong/status and return parsed JSON."""
    r = client.get('/hardware/wukong/status')
    assert r.status_code == 200
    return r.get_json()


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------

class TestChurchOnlyRoundTrip:

    def test_bridge_version_round_trip(self, client):
        """The bridge build identity survives status POST → Versions status GET."""
        r = _bridge_status(client, session_id='version-session',
                           bridge_version=18, serial_port='COM4')
        assert r.status_code == 200
        status = _status(client)
        assert status['bridge']['bridge_version'] == 18
        assert status['bridge']['serial_port'] == 'COM4'

    def test_church_only_true_stored_and_returned(self, client):
        """POST church_only=True → GET status has bridge.church_only is True."""
        r = _bridge_status(client, session_id='test-session', church_only=True)
        assert r.status_code == 200
        assert r.get_json().get('ok') is True

        s = _status(client)
        assert 'bridge' in s, "status response must include 'bridge' key"
        assert s['bridge']['church_only'] is True, (
            "church_only should be True after posting True, got: "
            + repr(s['bridge'].get('church_only'))
        )

    def test_church_only_defaults_to_false(self, client):
        """POST without church_only → GET status has bridge.church_only is False."""
        r = _bridge_status(client, session_id='test-session', state='running')
        assert r.status_code == 200

        s = _status(client)
        assert s['bridge']['church_only'] is False, (
            "church_only should default to False when absent from POST body, got: "
            + repr(s['bridge'].get('church_only'))
        )

    def test_church_only_explicit_false_returned(self, client):
        """POST church_only=False → GET status has bridge.church_only is False."""
        _bridge_status(client, session_id='test-session', church_only=False)
        s = _status(client)
        assert s['bridge']['church_only'] is False, (
            "explicit church_only=False should return False, got: "
            + repr(s['bridge'].get('church_only'))
        )

    def test_church_only_true_then_false_overwrite(self, client):
        """POST True then False → final value is False."""
        _bridge_status(client, session_id='sess', church_only=True)
        assert _status(client)['bridge']['church_only'] is True

        _bridge_status(client, session_id='sess', church_only=False)
        assert _status(client)['bridge']['church_only'] is False, (
            "second POST (False) should overwrite the first (True)"
        )

    def test_church_only_false_then_true_overwrite(self, client):
        """POST False then True → final value is True."""
        _bridge_status(client, session_id='sess', church_only=False)
        assert _status(client)['bridge']['church_only'] is False

        _bridge_status(client, session_id='sess', church_only=True)
        assert _status(client)['bridge']['church_only'] is True, (
            "second POST (True) should overwrite the first (False)"
        )

    def test_no_session_id_does_not_update_church_only(self, client):
        """POST without session_id must NOT update bridge_info (server guard).

        The server only writes to _wukong_bridge_info when a session_id is
        present.  A body without it (e.g. a malformed bridge heartbeat) must
        not silently clear or alter the stored church_only flag.
        """
        # First establish a known state with a real session.
        _bridge_status(client, session_id='established', church_only=True)
        assert _status(client)['bridge']['church_only'] is True

        # POST without session_id — should NOT overwrite.
        _bridge_status(client, church_only=False)  # no session_id

        # State must be unchanged.
        assert _status(client)['bridge']['church_only'] is True, (
            "POST without session_id should not update bridge_info"
        )

    def test_church_only_is_bool_not_int(self, client):
        """The stored church_only value must be a proper Python bool.

        bool(1) is True and bool(0) is False in Python, but the server uses
        bool(data.get('church_only', False)) explicitly.  Confirm the round-trip
        returns an actual bool so JS === comparisons stay reliable.
        """
        _bridge_status(client, session_id='sess', church_only=True)
        val = _status(client)['bridge']['church_only']
        assert isinstance(val, bool), (
            "church_only should be a bool in the JSON response, got: " + type(val).__name__
        )
        assert val is True

    def test_status_endpoint_is_read_only_for_church_only(self, client):
        """Repeated GET /status polls must not alter the stored church_only value."""
        _bridge_status(client, session_id='sess', church_only=True)

        for _ in range(5):
            s = _status(client)
            assert s['bridge']['church_only'] is True, (
                "GET /status altered church_only after a poll"
            )
