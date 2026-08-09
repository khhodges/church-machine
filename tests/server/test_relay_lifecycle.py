"""
tests/server/test_relay_lifecycle.py

Concurrency / lifecycle tests for the Wukong relay worker.

Verified behaviours
-------------------
RL-1  URL validation blocks http:// and un-whitelisted hostnames; valid HTTPS accepted.
RL-2  Enable bumps generation; disable does not; source-URL change while running bumps again.
RL-3  Disable mid-poll (worker blocked in HTTP response): events are NOT injected.
RL-4  Source URL change while running (worker blocked): in-flight events from old source
      are NOT injected; cursor remains 0 for the new session.
RL-5  Rapid disable→enable: only the latest-generation worker injects events.
RL-6  Happy-path: events from a valid, enabled relay ARE injected into the queue.
"""

import json
import os
import sys
import threading
import time
from unittest.mock import MagicMock, patch

import pytest

ROOT = os.path.normpath(os.path.join(os.path.dirname(__file__), '..', '..'))
if ROOT not in sys.path:
    sys.path.insert(0, ROOT)

import server.app as _app_module
from server.app import app


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

_POLL_TIMEOUT = 5.0   # seconds to wait for worker interactions in tests


def _reset_relay_state():
    """Reset all relay and event-queue globals between tests."""
    with _app_module._wukong_relay_lock:
        _app_module._wukong_relay_enabled    = False
        _app_module._wukong_relay_url        = 'https://lab.cloomc.org'
        _app_module._wukong_relay_generation = 0
        _app_module._wukong_relay_cursor     = 0
        _app_module._wukong_relay_last_rx    = 0.0
        _app_module._wukong_relay_last_ok    = 0.0
    with _app_module._wukong_trace_lock:
        _app_module._wukong_event_queue[:]   = []
        _app_module._wukong_event_seq        = 0
        _app_module._wukong_call_depth       = 0


@pytest.fixture(autouse=True)
def relay_state_reset():
    _reset_relay_state()
    yield
    _reset_relay_state()


@pytest.fixture()
def client():
    app.config['TESTING'] = True
    with app.test_client() as c:
        yield c


def _relay_post(client, enabled, source_url='https://lab.cloomc.org'):
    return client.post(
        '/hardware/wukong/relay',
        data=json.dumps({'enabled': enabled, 'source_url': source_url}),
        content_type='application/json',
    )


def _event_queue_snapshot():
    with _app_module._wukong_trace_lock:
        return list(_app_module._wukong_event_queue)


def _wait_for(condition_fn, timeout=_POLL_TIMEOUT, interval=0.02):
    """Poll until condition_fn() returns truthy or timeout elapses."""
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if condition_fn():
            return True
        time.sleep(interval)
    return False


# ---------------------------------------------------------------------------
# Blocking mock HTTP helper
# ---------------------------------------------------------------------------

class _BlockingMockHttp:
    """
    Replaces http_requests.get with a controllable double.

    For the FIRST request to .../events:
      • Sets call_started when the worker calls us.
      • Blocks until release() is called.
      • Returns a 200 response with the configured events list.

    Subsequent /events calls (e.g. from a second worker after a lifecycle
    change) return an empty 200 immediately so they don't interfere with
    assertions about the first worker's behavior.

    For all other URLs (boot-info etc.) returns an empty 200 immediately.
    """

    def __init__(self, events, *, status_code=200):
        self.events       = events
        self.status_code  = status_code
        self.call_started = threading.Event()
        self._release     = threading.Event()
        self._call_lock   = threading.Lock()
        self._first_done  = False   # True once the first /events call completes

    def release(self):
        self._release.set()

    def get(self, url, **kwargs):
        if '/events' in url:
            # Claim the first-caller slot atomically BEFORE blocking so that a
            # concurrent caller (e.g. a new-generation worker) always sees
            # _first_done=True and takes the immediate-empty path.
            with self._call_lock:
                is_first = not self._first_done
                if is_first:
                    self._first_done = True   # claim before releasing the lock

            if is_first:
                self.call_started.set()        # signal: first worker reached us
                self._release.wait(timeout=10) # block until test releases
                resp = MagicMock()
                resp.status_code = self.status_code
                resp.json.return_value = {
                    'events':     self.events,
                    'server_seq': max((e.get('seq', 0) for e in self.events), default=0),
                }
                return resp
            else:
                # Subsequent callers (new-generation workers): return empty immediately.
                resp = MagicMock()
                resp.status_code = 200
                resp.json.return_value = {'events': [], 'server_seq': 0}
                return resp
        # boot-info and any other sub-requests: return empty 200 immediately.
        resp = MagicMock()
        resp.status_code = 200
        resp.json.return_value = {}
        return resp


# ---------------------------------------------------------------------------
# RL-1  URL validation
# ---------------------------------------------------------------------------

class TestUrlValidation:
    def test_http_rejected(self, client):
        r = _relay_post(client, True, 'http://lab.cloomc.org')
        assert r.status_code == 400
        body = r.get_json()
        assert body['ok'] is False
        assert 'https' in body['error'].lower()

    def test_non_allowlisted_host_rejected(self, client):
        r = _relay_post(client, True, 'https://evil.com')
        assert r.status_code == 400
        body = r.get_json()
        assert body['ok'] is False
        assert 'evil.com' in body['error']

    def test_ftp_rejected(self, client):
        r = _relay_post(client, True, 'ftp://lab.cloomc.org')
        assert r.status_code == 400

    def test_valid_url_accepted(self, client):
        r = _relay_post(client, True, 'https://lab.cloomc.org')
        assert r.status_code == 200
        body = r.get_json()
        assert body['ok'] is True
        assert body['enabled'] is True


# ---------------------------------------------------------------------------
# RL-2  Enable / disable lifecycle and generation bookkeeping
# ---------------------------------------------------------------------------

class TestEnableDisable:
    def test_enable_returns_ok(self, client):
        r = _relay_post(client, True)
        assert r.status_code == 200
        assert r.get_json()['enabled'] is True

    def test_disable_returns_ok(self, client):
        _relay_post(client, True)
        r = _relay_post(client, False)
        assert r.status_code == 200
        assert r.get_json()['enabled'] is False
        assert _app_module._wukong_relay_enabled is False

    def test_enable_bumps_generation(self, client):
        gen_before = _app_module._wukong_relay_generation
        _relay_post(client, True)
        assert _app_module._wukong_relay_generation == gen_before + 1

    def test_disable_does_not_bump_generation(self, client):
        _relay_post(client, True)
        gen_after_enable = _app_module._wukong_relay_generation
        _relay_post(client, False)
        assert _app_module._wukong_relay_generation == gen_after_enable

    def test_same_url_reenable_does_not_rebump(self, client):
        _relay_post(client, True, 'https://lab.cloomc.org')
        gen = _app_module._wukong_relay_generation
        _relay_post(client, True, 'https://lab.cloomc.org')
        assert _app_module._wukong_relay_generation == gen, (
            'Re-enabling with the same URL must not spawn a new worker'
        )

    def test_cursor_resets_on_fresh_enable(self, client):
        _relay_post(client, True)
        with _app_module._wukong_relay_lock:
            _app_module._wukong_relay_cursor = 99
        _relay_post(client, False)
        _relay_post(client, True)
        with _app_module._wukong_relay_lock:
            cursor = _app_module._wukong_relay_cursor
        assert cursor == 0, 'Cursor must be reset to 0 when relay is re-enabled'


# ---------------------------------------------------------------------------
# RL-3  Disable mid-poll: in-flight events must be discarded
# ---------------------------------------------------------------------------

class TestDisableMidPoll:
    def test_events_not_injected_after_disable(self, client):
        """
        Worker blocks inside http_requests.get().json() → relay disabled →
        response unblocked → events must NOT appear in the local queue.
        """
        fake_events = [{'ev_type': 0, 'nia': 0x100, 'seq': 1, 'flags': 0,
                        'fault_code': 0, 'fault_valid': False}]
        mock_http = _BlockingMockHttp(fake_events)

        with patch.object(_app_module, 'http_requests') as mock_reqs:
            mock_reqs.get.side_effect = mock_http.get

            # Start relay → worker thread begins.
            _relay_post(client, True)

            # Wait until the worker is blocked inside mock_http.get().
            assert mock_http.call_started.wait(timeout=_POLL_TIMEOUT), (
                'Worker never reached the events HTTP call'
            )

            # Disable relay WHILE the worker is blocked in the HTTP call.
            _relay_post(client, False)

            # Unblock the HTTP response — worker will now try to inject events.
            mock_http.release()

            # Give the worker enough time to complete its processing.
            time.sleep(0.2)

            # The queue must be empty: disabled relay must not inject events.
            queue = _event_queue_snapshot()
            assert queue == [], (
                f'Disabled relay injected {len(queue)} stale event(s) into the queue'
            )

    def test_cursor_not_advanced_after_disable(self, client):
        """Cursor must remain 0 after relay disabled mid-poll."""
        fake_events = [{'ev_type': 0, 'nia': 0x100, 'seq': 7, 'flags': 0,
                        'fault_code': 0, 'fault_valid': False}]
        mock_http = _BlockingMockHttp(fake_events)

        with patch.object(_app_module, 'http_requests') as mock_reqs:
            mock_reqs.get.side_effect = mock_http.get

            _relay_post(client, True)
            assert mock_http.call_started.wait(timeout=_POLL_TIMEOUT)
            _relay_post(client, False)
            mock_http.release()
            time.sleep(0.2)

            with _app_module._wukong_relay_lock:
                cursor = _app_module._wukong_relay_cursor
            assert cursor == 0, (
                f'Cursor was advanced to {cursor} even though relay was disabled mid-poll'
            )


# ---------------------------------------------------------------------------
# RL-4  Source URL change while running: old events discarded, cursor reset
# ---------------------------------------------------------------------------

class TestSourceUrlChange:
    def test_old_source_events_not_injected_after_source_change(self, client):
        """
        Worker blocked mid-poll for source A → source URL 'changed' (same
        allowed host, but endpoint treats it as a new session because URL
        differs from the currently-stored value).  After unblocking, old-source
        events must NOT appear in the queue.
        """
        fake_events = [{'ev_type': 0, 'nia': 0x200, 'seq': 5, 'flags': 0,
                        'fault_code': 0, 'fault_valid': False}]
        mock_http = _BlockingMockHttp(fake_events)

        with patch.object(_app_module, 'http_requests') as mock_reqs:
            mock_reqs.get.side_effect = mock_http.get

            _relay_post(client, True, 'https://lab.cloomc.org')
            old_gen = _app_module._wukong_relay_generation
            assert mock_http.call_started.wait(timeout=_POLL_TIMEOUT)

            # Simulate source change by directly updating the URL and bumping
            # generation under the relay lock (as the endpoint would do).
            with _app_module._wukong_relay_lock:
                _app_module._wukong_relay_url        = 'https://lab.cloomc.org/v2'
                _app_module._wukong_relay_generation += 1
                _app_module._wukong_relay_cursor      = 0

            new_gen = _app_module._wukong_relay_generation
            assert new_gen == old_gen + 1

            # Unblock the old-source HTTP response.
            mock_http.release()
            time.sleep(0.2)

            queue = _event_queue_snapshot()
            assert queue == [], (
                f'Source-changed relay injected {len(queue)} stale event(s) from old source'
            )

    def test_cursor_remains_zero_after_source_change(self, client):
        """Cursor must not be advanced by old-source events after a source change."""
        fake_events = [{'ev_type': 0, 'nia': 0x300, 'seq': 42, 'flags': 0,
                        'fault_code': 0, 'fault_valid': False}]
        mock_http = _BlockingMockHttp(fake_events)

        with patch.object(_app_module, 'http_requests') as mock_reqs:
            mock_reqs.get.side_effect = mock_http.get

            _relay_post(client, True, 'https://lab.cloomc.org')
            assert mock_http.call_started.wait(timeout=_POLL_TIMEOUT)

            with _app_module._wukong_relay_lock:
                _app_module._wukong_relay_url        = 'https://lab.cloomc.org/v2'
                _app_module._wukong_relay_generation += 1
                _app_module._wukong_relay_cursor      = 0

            mock_http.release()
            time.sleep(0.2)

            with _app_module._wukong_relay_lock:
                cursor = _app_module._wukong_relay_cursor
            assert cursor == 0, (
                f'Cursor advanced to {cursor} from stale old-source events'
            )


# ---------------------------------------------------------------------------
# RL-5  Rapid disable→enable: only latest-gen worker is authoritative
# ---------------------------------------------------------------------------

class TestRapidCycling:
    def test_stale_gen_worker_blocked_at_start(self, client):
        """
        First enable (gen N) → worker blocks → disable → second enable (gen N+1)
        → unblock first worker → first worker must NOT inject events.
        """
        fake_events = [{'ev_type': 0, 'nia': 0x400, 'seq': 1, 'flags': 0,
                        'fault_code': 0, 'fault_valid': False}]
        mock_http = _BlockingMockHttp(fake_events)

        with patch.object(_app_module, 'http_requests') as mock_reqs:
            mock_reqs.get.side_effect = mock_http.get

            _relay_post(client, True)
            gen1 = _app_module._wukong_relay_generation

            # Wait for the first worker to reach the HTTP call.
            assert mock_http.call_started.wait(timeout=_POLL_TIMEOUT)

            # Rapid disable + re-enable (spawns new gen-2 worker).
            _relay_post(client, False)
            _relay_post(client, True)
            gen2 = _app_module._wukong_relay_generation
            assert gen2 == gen1 + 1, 'Re-enable after disable must bump generation'

            # Unblock the stale gen-1 worker's HTTP call.
            mock_http.release()
            time.sleep(0.2)

            queue = _event_queue_snapshot()
            assert queue == [], (
                f'Stale gen-{gen1} worker injected {len(queue)} event(s) after gen-{gen2} took over'
            )


# ---------------------------------------------------------------------------
# RL-6  Happy-path: events ARE injected when relay stays enabled
# ---------------------------------------------------------------------------

class TestHappyPath:
    def test_events_injected_when_relay_active(self, client):
        """
        Worker completes a full poll cycle without any lifecycle interruption →
        events appear in the queue with relayed=True and local seq numbers.
        """
        fake_events = [
            {'ev_type': 0x08, 'nia': 0x140, 'seq': 1, 'flags': 0,
             'fault_code': 0, 'fault_valid': False},  # CALL_PUSH
            {'ev_type': 0x09, 'nia': 0x148, 'seq': 2, 'flags': 0,
             'fault_code': 0, 'fault_valid': False},  # CALL_POP
        ]
        mock_http = _BlockingMockHttp(fake_events)

        with patch.object(_app_module, 'http_requests') as mock_reqs:
            mock_reqs.get.side_effect = mock_http.get

            _relay_post(client, True)
            assert mock_http.call_started.wait(timeout=_POLL_TIMEOUT)

            # Release immediately — relay remains enabled.
            mock_http.release()

            # Wait for the worker to inject events.
            assert _wait_for(lambda: len(_event_queue_snapshot()) >= 2), (
                'Worker never injected events into the queue'
            )

            queue = _event_queue_snapshot()
            assert len(queue) == 2
            assert all(ev.get('relayed') is True for ev in queue), (
                'Relayed events must carry relayed=True'
            )
            # Local seq numbers must be assigned (they differ from remote seq).
            assert queue[0]['seq'] >= 1
            assert queue[1]['seq'] > queue[0]['seq']

    def test_call_depth_tracked_across_push_pop(self, client):
        """CALL_PUSH / CALL_POP update call_depth correctly during relay."""
        fake_events = [
            {'ev_type': 0x08, 'nia': 0x140, 'seq': 1, 'flags': 0,
             'fault_code': 0, 'fault_valid': False},  # CALL_PUSH → depth 1
            {'ev_type': 0x08, 'nia': 0x150, 'seq': 2, 'flags': 0,
             'fault_code': 0, 'fault_valid': False},  # CALL_PUSH → depth 2
            {'ev_type': 0x09, 'nia': 0x160, 'seq': 3, 'flags': 0,
             'fault_code': 0, 'fault_valid': False},  # CALL_POP  → depth 1
        ]
        mock_http = _BlockingMockHttp(fake_events)

        with patch.object(_app_module, 'http_requests') as mock_reqs:
            mock_reqs.get.side_effect = mock_http.get

            _relay_post(client, True)
            assert mock_http.call_started.wait(timeout=_POLL_TIMEOUT)
            mock_http.release()

            assert _wait_for(lambda: len(_event_queue_snapshot()) >= 3)

            queue = _event_queue_snapshot()
            depths = [ev['call_depth'] for ev in queue]
            assert depths == [1, 2, 1], f'Expected [1,2,1] call_depth sequence, got {depths}'
