"""
tests/server/test_wukong_trace_call_depth.py

Integration tests for GET /hardware/wukong/events — the ordered event queue
that lets the IDE track call-stack depth via CALL_PUSH (0x08) and CALL_POP
(0x09) without losing intermediate packets to the single-latest-trace slot.

Verifies:
  1. A full CALL sequence (CR6 → CR14 → PUSH) delivers all 3 events in order.
  2. CALL_PUSH and CALL_POP events carry per-event 'call_depth' (authoritative).
  3. The 'after' cursor correctly filters already-seen events.
  4. CR GTs appear in the events response (top-level cr6_gt / cr14_gt).
  5. server_seq, queue_min_seq, and call_depth metadata are always present.
  6. A queue overflow gap is detectable via queue_min_seq > cursor + 1.
  7. A server sequence-counter reset (restart) is detectable via
     server_seq < client cursor.
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
    """Reset all in-process trace globals between tests."""
    with _app_module._wukong_trace_lock:
        _app_module._wukong_latest_trace   = {}
        _app_module._wukong_latest_cr_gts  = {}
        _app_module._wukong_event_queue[:] = []
        _app_module._wukong_event_seq      = 0
        _app_module._wukong_call_depth     = 0


def _post(client, ev_type, payload_gt=0, nia=0x00000010, flags=0,
          fault_code=0, fault_valid=False, bp_hit=False):
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


def _drain(client, after=0):
    """GET /hardware/wukong/events?after=N and return the parsed JSON."""
    return client.get(f'/hardware/wukong/events?after={after}').get_json()


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
# Tests — event ordering and presence
# ---------------------------------------------------------------------------

class TestEventQueueOrdering:
    def test_call_sequence_all_three_events_present(self, client):
        """CR6 → CR14 → PUSH posts 3 packets; all 3 must appear in /events."""
        nia = 0x00000040
        _post(client, ev_type=0x06, payload_gt=0x11223344, nia=nia)
        _post(client, ev_type=0x07, payload_gt=0x55667788, nia=nia)
        _post(client, ev_type=0x08, payload_gt=0,          nia=nia)

        data = _drain(client, after=0)
        ev_types = [e['ev_type'] for e in data['events']]
        assert ev_types == [0x06, 0x07, 0x08], (
            f'expected [0x06, 0x07, 0x08], got {[hex(t) for t in ev_types]}'
        )

    def test_events_have_monotonically_increasing_seq(self, client):
        """Each event must carry a strictly increasing seq number."""
        for ev_type in (0x06, 0x07, 0x08):
            _post(client, ev_type=ev_type)

        data = _drain(client, after=0)
        seqs = [e['seq'] for e in data['events']]
        assert seqs == sorted(set(seqs)), f'seq not strictly increasing: {seqs}'

    def test_return_pop_event_delivered(self, client):
        """A CALL_POP packet (ev_type=0x09) must appear in the events list."""
        _post(client, ev_type=0x08)
        _post(client, ev_type=0x09)

        data = _drain(client, after=0)
        ev_types = [e['ev_type'] for e in data['events']]
        assert 0x09 in ev_types, (
            f'CALL_POP (0x09) missing; got {[hex(t) for t in ev_types]}'
        )


# ---------------------------------------------------------------------------
# Tests — per-event authoritative call_depth
# ---------------------------------------------------------------------------

class TestPerEventCallDepth:
    def test_push_event_carries_call_depth_one(self, client):
        """First CALL_PUSH event must have call_depth=1."""
        _post(client, ev_type=0x08)
        data = _drain(client, after=0)
        push = next(e for e in data['events'] if e['ev_type'] == 0x08)
        assert push['call_depth'] == 1, (
            f'expected call_depth=1, got {push["call_depth"]}'
        )

    def test_pop_event_carries_call_depth_zero(self, client):
        """CALL_PUSH then CALL_POP: POP event must have call_depth=0."""
        _post(client, ev_type=0x08)
        _post(client, ev_type=0x09)
        data = _drain(client, after=0)
        pop = next(e for e in data['events'] if e['ev_type'] == 0x09)
        assert pop['call_depth'] == 0, (
            f'expected call_depth=0, got {pop["call_depth"]}'
        )

    def test_nested_calls_per_event_depth_increments(self, client):
        """Three PUSH events must carry call_depth 1, 2, 3 respectively."""
        for _ in range(3):
            _post(client, ev_type=0x08)
        data = _drain(client, after=0)
        depths = [e['call_depth'] for e in data['events'] if e['ev_type'] == 0x08]
        assert depths == [1, 2, 3], f'expected [1,2,3], got {depths}'

    def test_top_level_call_depth_matches_last_push(self, client):
        """Top-level call_depth in response must equal the last PUSH depth."""
        for _ in range(2):
            _post(client, ev_type=0x08)
        data = _drain(client, after=0)
        assert data['call_depth'] == 2

    def test_spurious_pop_does_not_go_negative(self, client):
        """A POP with no prior PUSH must leave call_depth at 0."""
        _post(client, ev_type=0x09)
        data = _drain(client, after=0)
        pop = next(e for e in data['events'] if e['ev_type'] == 0x09)
        assert pop['call_depth'] == 0
        assert data['call_depth'] == 0

    def test_non_push_pop_events_do_not_change_call_depth(self, client):
        """RETIRE (0x00) and CALL_CR6 (0x06) must not alter call_depth."""
        _post(client, ev_type=0x00)
        _post(client, ev_type=0x06, payload_gt=0xABCD)
        data = _drain(client, after=0)
        assert data['call_depth'] == 0


# ---------------------------------------------------------------------------
# Tests — after cursor
# ---------------------------------------------------------------------------

class TestAfterCursor:
    def test_after_cursor_filters_seen_events(self, client):
        """Events with seq ≤ after must be excluded from the response."""
        _post(client, ev_type=0x06)
        _post(client, ev_type=0x07)
        first = _drain(client, after=0)
        max_seq = max(e['seq'] for e in first['events'])

        _post(client, ev_type=0x08)
        second = _drain(client, after=max_seq)

        assert len(second['events']) == 1
        assert second['events'][0]['ev_type'] == 0x08

    def test_after_cursor_at_latest_returns_empty_events(self, client):
        """Draining with after=latest_seq must return an empty events list."""
        _post(client, ev_type=0x00)
        data = _drain(client, after=0)
        latest_seq = max(e['seq'] for e in data['events'])

        empty = _drain(client, after=latest_seq)
        assert empty['events'] == []


# ---------------------------------------------------------------------------
# Tests — metadata fields
# ---------------------------------------------------------------------------

class TestResponseMetadata:
    def test_server_seq_queue_min_seq_call_depth_always_present(self, client):
        """server_seq, queue_min_seq, and call_depth must be in every response."""
        _post(client, ev_type=0x00)
        data = _drain(client, after=0)
        for field in ('server_seq', 'queue_min_seq', 'call_depth'):
            assert field in data, f'{field!r} missing from /events response'

    def test_server_seq_equals_event_count(self, client):
        """server_seq must equal the number of events posted."""
        for _ in range(4):
            _post(client, ev_type=0x00)
        data = _drain(client, after=0)
        assert data['server_seq'] == 4

    def test_queue_min_seq_is_one_after_first_post(self, client):
        """After one POST, queue_min_seq must be 1 (oldest = first event)."""
        _post(client, ev_type=0x00)
        data = _drain(client, after=0)
        assert data['queue_min_seq'] == 1

    def test_queue_min_seq_is_zero_on_empty_queue(self, client):
        """With no events, queue_min_seq must be 0."""
        data = _drain(client, after=0)
        assert data['queue_min_seq'] == 0
        assert data['server_seq'] == 0


# ---------------------------------------------------------------------------
# Tests — gap detection (queue overflow simulation)
# ---------------------------------------------------------------------------

class TestGapDetection:
    def _simulate_overflow(self, client, n_events=5, maxlen_override=3):
        """Post n_events but cap the queue at maxlen_override to simulate overflow."""
        for i in range(n_events):
            _post(client, ev_type=0x08)  # each is a CALL_PUSH

        # Trim the queue directly to simulate what happens when it overflows.
        with _app_module._wukong_trace_lock:
            del _app_module._wukong_event_queue[:-maxlen_override]

    def test_gap_detectable_via_queue_min_seq(self, client):
        """After trimming old events, queue_min_seq > 1 signals a gap."""
        self._simulate_overflow(client, n_events=5, maxlen_override=3)

        data = _drain(client, after=0)
        # client cursor was 0; queue_min_seq should now be > 1 (entries lost)
        assert data['queue_min_seq'] > 1, (
            f'gap not detectable: queue_min_seq={data["queue_min_seq"]}'
        )

    def test_call_depth_still_correct_after_gap(self, client):
        """Even if intermediate events are lost, top-level call_depth is accurate."""
        self._simulate_overflow(client, n_events=5, maxlen_override=3)

        data = _drain(client, after=0)
        # Server tracked all 5 PUSH events, so call_depth must be 5.
        assert data['call_depth'] == 5, (
            f'expected call_depth=5 after 5 pushes, got {data["call_depth"]}'
        )

    def test_retained_events_carry_correct_per_event_depth(self, client):
        """Events still in the queue after overflow carry accurate call_depth."""
        self._simulate_overflow(client, n_events=5, maxlen_override=3)

        data = _drain(client, after=0)
        # The 3 retained events should have depths 3, 4, 5 (pushes 3, 4, 5 of 5).
        depths = [e['call_depth'] for e in data['events']]
        assert depths == sorted(depths), 'per-event depths not ascending'
        assert depths[-1] == 5, (
            f'last retained event should have call_depth=5, got {depths[-1]}'
        )


# ---------------------------------------------------------------------------
# Tests — server restart detection
# ---------------------------------------------------------------------------

class TestServerRestartDetection:
    def test_server_seq_resets_to_zero_on_restart(self, client):
        """After a restart (seq reset), server_seq < a previously seen cursor."""
        # Simulate 5 events on 'old server'.
        for _ in range(5):
            _post(client, ev_type=0x00)
        first = _drain(client, after=0)
        old_server_seq = first['server_seq']
        assert old_server_seq == 5

        # Simulate server restart: reset all state.
        with _app_module._wukong_trace_lock:
            _app_module._wukong_event_queue[:] = []
            _app_module._wukong_event_seq      = 0
            _app_module._wukong_call_depth     = 0

        # Post a new event on the 'restarted server'.
        _post(client, ev_type=0x08)
        data = _drain(client, after=0)

        # server_seq is now 1 — client (cursor=5) can detect this as a restart.
        assert data['server_seq'] == 1, (
            f'expected server_seq=1 after restart, got {data["server_seq"]}'
        )
        assert data['server_seq'] < old_server_seq, (
            'server_seq should be less than old cursor, signalling restart'
        )

    def test_call_depth_resets_on_restart(self, client):
        """After a restart, call_depth is accurate from the new event stream."""
        for _ in range(3):
            _post(client, ev_type=0x08)

        # Simulate restart.
        with _app_module._wukong_trace_lock:
            _app_module._wukong_event_queue[:] = []
            _app_module._wukong_event_seq      = 0
            _app_module._wukong_call_depth     = 0

        # One push on the restarted server.
        _post(client, ev_type=0x08)
        data = _drain(client, after=0)
        assert data['call_depth'] == 1, (
            f'expected call_depth=1 after restart+one push, got {data["call_depth"]}'
        )


# ---------------------------------------------------------------------------
# Tests — CR GTs in events response
# ---------------------------------------------------------------------------

class TestCrGtsInEventsResponse:
    def test_cr6_gt_present_after_call_cr6(self, client):
        _post(client, ev_type=0x06, payload_gt=0xCAFEBABE)
        data = _drain(client, after=0)
        assert data.get('cr6_gt') == 0xCAFEBABE

    def test_cr14_gt_present_after_call_cr14(self, client):
        _post(client, ev_type=0x07, payload_gt=0xDEAD1234)
        data = _drain(client, after=0)
        assert data.get('cr14_gt') == 0xDEAD1234

    def test_push_does_not_clear_cr_gts(self, client):
        _post(client, ev_type=0x06, payload_gt=0xAAAA1111)
        _post(client, ev_type=0x07, payload_gt=0xBBBB2222)
        _post(client, ev_type=0x08, payload_gt=0)
        data = _drain(client, after=0)
        assert data.get('cr6_gt')  == 0xAAAA1111
        assert data.get('cr14_gt') == 0xBBBB2222
