"""
tests/server/test_pipeline_health_status_fields.py

Verifies that /hardware/wukong/status exposes the two new pipeline-health
counter fields (total_trace_posts, total_bridge_polls) and that they:

  - start at 0 (never-seen) before any bridge activity
  - increment correctly as trace POSTs and bridge command-GETs arrive
  - are never reset by read-only status polls
  - remain correct after many mixed operations
"""

import json
import os
import sys
import time

import pytest

ROOT = os.path.normpath(os.path.join(os.path.dirname(__file__), '..', '..'))
if ROOT not in sys.path:
    sys.path.insert(0, ROOT)

import server.app as _app_module
from server.app import app


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _reset():
    """Reset every Wukong global that matters for these tests."""
    with _app_module._wukong_trace_lock:
        _app_module._wukong_latest_trace  = {}
        _app_module._wukong_latest_cr_gts = {}
        _app_module._wukong_event_queue[:] = []
        _app_module._wukong_event_seq      = 0
        _app_module._wukong_call_depth     = 0
    with _app_module._wukong_command_lock:
        _app_module._wukong_pending_cmd  = None
        _app_module._wukong_cmd_delivery = None
        _app_module._wukong_cmd_id       = 0
    with _app_module._upload_in_flight_lock:
        _app_module._upload_in_flight = False
    with _app_module._wukong_boot_info_lock:
        _app_module._wukong_boot_info = {}
    _app_module._wukong_last_bridge_poll   = 0.0
    _app_module._wukong_last_trace_post    = 0.0
    _app_module._wukong_total_trace_posts  = 0
    _app_module._wukong_total_bridge_polls = 0


def _status(client):
    resp = client.get('/hardware/wukong/status')
    assert resp.status_code == 200
    return resp.get_json()


def _post_trace(client, ev_type=0x00, nia=0x10):
    return client.post(
        '/hardware/wukong/trace',
        data=json.dumps({
            'nia': nia, 'ev_type': ev_type, 'payload_gt': 0,
            'flags': 0, 'fault_code': 0, 'fault_valid': False,
            'bp_hit': False, 'ts': time.time(),
        }),
        content_type='application/json',
    )


def _bridge_poll(client):
    return client.get('/hardware/wukong/command')


@pytest.fixture()
def client():
    app.config['TESTING'] = True
    _reset()
    with app.test_client() as c:
        yield c
    _reset()


# ---------------------------------------------------------------------------
# Tests — new fields present and zero before any activity
# ---------------------------------------------------------------------------

class TestNewFieldsPresent:
    def test_fields_exist_in_response(self, client):
        data = _status(client)
        assert 'total_trace_posts'  in data, 'total_trace_posts missing from status'
        assert 'total_bridge_polls' in data, 'total_bridge_polls missing from status'

    def test_fields_zero_before_any_activity(self, client):
        data = _status(client)
        assert data['total_trace_posts']  == 0, 'total_trace_posts should be 0 initially'
        assert data['total_bridge_polls'] == 0, 'total_bridge_polls should be 0 initially'

    def test_status_polls_do_not_increment_counters(self, client):
        """Read-only status polls must not count as bridge or trace activity."""
        for _ in range(10):
            data = _status(client)
        assert data['total_trace_posts']  == 0
        assert data['total_bridge_polls'] == 0


# ---------------------------------------------------------------------------
# Tests — counters increment correctly
# ---------------------------------------------------------------------------

class TestCounterIncrements:
    def test_trace_post_increments_total_trace_posts(self, client):
        assert _status(client)['total_trace_posts'] == 0
        _post_trace(client)
        assert _status(client)['total_trace_posts'] == 1
        _post_trace(client)
        _post_trace(client)
        assert _status(client)['total_trace_posts'] == 3

    def test_bridge_poll_increments_total_bridge_polls(self, client):
        assert _status(client)['total_bridge_polls'] == 0
        _bridge_poll(client)
        assert _status(client)['total_bridge_polls'] == 1
        _bridge_poll(client)
        _bridge_poll(client)
        assert _status(client)['total_bridge_polls'] == 3

    def test_counters_are_independent(self, client):
        """Trace posts do not affect bridge polls and vice versa."""
        _post_trace(client)
        _post_trace(client)
        _bridge_poll(client)
        data = _status(client)
        assert data['total_trace_posts']  == 2
        assert data['total_bridge_polls'] == 1

    def test_counters_survive_repeated_status_polls(self, client):
        """Status reads must not reset the counters."""
        _post_trace(client)
        _bridge_poll(client)
        for _ in range(10):
            data = _status(client)
        assert data['total_trace_posts']  == 1
        assert data['total_bridge_polls'] == 1

    def test_counters_accumulate_across_many_events(self, client):
        N = 20
        for _ in range(N):
            _post_trace(client)
        for _ in range(N // 2):
            _bridge_poll(client)
        data = _status(client)
        assert data['total_trace_posts']  == N
        assert data['total_bridge_polls'] == N // 2


# ---------------------------------------------------------------------------
# Tests — never-seen vs stale distinction
# ---------------------------------------------------------------------------

class TestNeverSeenDistinction:
    def test_never_seen_bridge_zero_counter_and_null_age(self, client):
        """When the bridge has never polled: counter == 0 AND age is null."""
        data = _status(client)
        assert data['total_bridge_polls'] == 0
        assert data['bridge_poll_age']    is None

    def test_stale_bridge_nonzero_counter_and_positive_age(self, client):
        """After one old poll: counter > 0 even if the age is large."""
        _bridge_poll(client)
        # Artificially backdate the timestamp so it appears stale.
        _app_module._wukong_last_bridge_poll = time.time() - 120
        data = _status(client)
        assert data['total_bridge_polls'] >= 1
        assert data['bridge_poll_age'] > 100

    def test_never_seen_trace_zero_counter_and_null_age(self, client):
        data = _status(client)
        assert data['total_trace_posts'] == 0
        assert data['last_trace_age']    is None

    def test_stale_trace_nonzero_counter_and_positive_age(self, client):
        _post_trace(client)
        _app_module._wukong_last_trace_post = time.time() - 60
        data = _status(client)
        assert data['total_trace_posts'] >= 1
        assert data['last_trace_age'] > 50
