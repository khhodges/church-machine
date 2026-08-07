"""
tests/server/test_wukong_trace_cr_update.py

Integration tests for the /hardware/wukong/trace CR6/CR14 update path.

Verifies that:
  1. POST with ev_type=0x06 (TRACE_EV_CALL_CR6) stores cr6_gt in the GET response.
  2. POST with ev_type=0x07 (TRACE_EV_CALL_CR14) stores cr14_gt in the GET response.
  3. A full CALL sequence (CR6 → CR14 → PUSH, same NIA) leaves both cr6_gt and
     cr14_gt intact — the PUSH packet (ev_type=0x08, payload_gt=0) must NOT
     overwrite the previously-stored CR GTs.
  4. A RESULT packet (ev_type=0x00) does not inject cr6_gt / cr14_gt into the
     GET response when no prior CALL packets have been seen.
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

def _reset_trace_state():
    """Reset the in-process trace globals between tests."""
    with _app_module._wukong_trace_lock:
        _app_module._wukong_latest_trace   = {}
        _app_module._wukong_latest_cr_gts  = {}
        _app_module._wukong_event_queue[:] = []
        _app_module._wukong_event_seq      = 0
        _app_module._wukong_call_depth     = 0


def _post(client, ev_type, payload_gt, nia=0x00000010, flags=0, fault_code=0,
          fault_valid=False, bp_hit=False):
    """POST a synthetic trace packet to /hardware/wukong/trace."""
    return client.post(
        '/hardware/wukong/trace',
        data=json.dumps({
            'nia':         nia,
            'ev_type':     ev_type,
            'payload_gt':  payload_gt,
            'flags':       flags,
            'fault_code':  fault_code,
            'fault_valid': fault_valid,
            'bp_hit':      bp_hit,
            'ts':          time.time(),
        }),
        content_type='application/json',
    )


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

@pytest.fixture()
def client():
    app.config['TESTING'] = True
    _reset_trace_state()
    with app.test_client() as c:
        yield c
    _reset_trace_state()


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------

class TestCallCr6Event:
    def test_cr6_gt_appears_in_get_response(self, client):
        """CALL_CR6 packet → GET response includes cr6_gt."""
        gt_val = 0x1A2B3C4D
        r = _post(client, ev_type=0x06, payload_gt=gt_val)
        assert r.status_code == 200
        data = client.get('/hardware/wukong/trace').get_json()
        assert 'cr6_gt' in data, 'cr6_gt missing from GET response after CALL_CR6 POST'
        assert data['cr6_gt'] == gt_val

    def test_cr14_gt_absent_before_call_cr14(self, client):
        """cr14_gt must not appear in GET when only CALL_CR6 has been posted."""
        _post(client, ev_type=0x06, payload_gt=0xAAAAAAAA)
        data = client.get('/hardware/wukong/trace').get_json()
        assert 'cr14_gt' not in data


class TestCallCr14Event:
    def test_cr14_gt_appears_in_get_response(self, client):
        """CALL_CR14 packet → GET response includes cr14_gt."""
        gt_val = 0xDEADBEEF
        r = _post(client, ev_type=0x07, payload_gt=gt_val)
        assert r.status_code == 200
        data = client.get('/hardware/wukong/trace').get_json()
        assert 'cr14_gt' in data, 'cr14_gt missing from GET response after CALL_CR14 POST'
        assert data['cr14_gt'] == gt_val


class TestFullCallSequence:
    """A CALL instruction emits 3 consecutive packets: CR6, CR14, PUSH.

    The PUSH packet (ev_type=0x08, payload_gt=0) is the LAST packet and must
    NOT overwrite the CR6/CR14 GTs stored earlier.
    """

    def test_push_does_not_overwrite_cr6_cr14_gts(self, client):
        cr6_val  = 0x11223344
        cr14_val = 0x55667788
        nia      = 0x00000040

        _post(client, ev_type=0x06, payload_gt=cr6_val,  nia=nia)
        _post(client, ev_type=0x07, payload_gt=cr14_val, nia=nia)
        _post(client, ev_type=0x08, payload_gt=0,        nia=nia)   # CALL_PUSH

        data = client.get('/hardware/wukong/trace').get_json()

        assert 'cr6_gt'  in data, 'cr6_gt lost after CALL_PUSH'
        assert 'cr14_gt' in data, 'cr14_gt lost after CALL_PUSH'
        assert data['cr6_gt']  == cr6_val,  f"cr6_gt corrupted: {data['cr6_gt']:#010x} != {cr6_val:#010x}"
        assert data['cr14_gt'] == cr14_val, f"cr14_gt corrupted: {data['cr14_gt']:#010x} != {cr14_val:#010x}"

    def test_latest_trace_reflects_push_packet(self, client):
        """The ts and ev_type in the latest-trace slot must come from the last (PUSH) packet."""
        nia = 0x00000060
        _post(client, ev_type=0x06, payload_gt=0x11111111, nia=nia)
        _post(client, ev_type=0x07, payload_gt=0x22222222, nia=nia)
        _post(client, ev_type=0x08, payload_gt=0,          nia=nia)

        data = client.get('/hardware/wukong/trace').get_json()
        assert data.get('ev_type') == 0x08, (
            'latest trace ev_type should be 0x08 (CALL_PUSH), '
            f'got {data.get("ev_type")}'
        )
        assert data.get('payload_gt') == 0


class TestResultPacketNoSpuriousCrFields:
    def test_result_packet_does_not_inject_cr_gts(self, client):
        """A fresh server with only a RESULT packet must not emit cr6_gt or cr14_gt."""
        _post(client, ev_type=0x00, payload_gt=0)
        data = client.get('/hardware/wukong/trace').get_json()
        assert 'cr6_gt'  not in data, 'cr6_gt should be absent until CALL_CR6 is seen'
        assert 'cr14_gt' not in data, 'cr14_gt should be absent until CALL_CR14 is seen'


class TestConsecutiveCalls:
    def test_second_call_updates_cr6_cr14(self, client):
        """A second CALL sequence overwrites the GT values from the first."""
        _post(client, ev_type=0x06, payload_gt=0xAAAA0001, nia=0x10)
        _post(client, ev_type=0x07, payload_gt=0xBBBB0001, nia=0x10)
        _post(client, ev_type=0x08, payload_gt=0,          nia=0x10)

        _post(client, ev_type=0x06, payload_gt=0xAAAA0002, nia=0x20)
        _post(client, ev_type=0x07, payload_gt=0xBBBB0002, nia=0x20)
        _post(client, ev_type=0x08, payload_gt=0,          nia=0x20)

        data = client.get('/hardware/wukong/trace').get_json()
        assert data['cr6_gt']  == 0xAAAA0002
        assert data['cr14_gt'] == 0xBBBB0002
