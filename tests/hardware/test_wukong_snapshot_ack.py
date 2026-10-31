"""HTTP acknowledgement tests; no serial device or live IDE is accessed."""
from copy import deepcopy
import pytest
from hardware import wukong_bridge as bridge


def post_snapshot(monkeypatch, reason, reply, status=200):
    payload = {'reason': reason, 'snapshot': True, 'bridge_session': 'test-only'}
    original = deepcopy(payload)
    posts = []

    class Response:
        status_code = status

        def json(self):
            return reply

    def post(url, **kwargs):
        posts.append((url, kwargs['json']))
        return Response()

    monkeypatch.setattr(bridge.requests, 'post', post)
    monkeypatch.setattr(bridge, '_bridge_auth_headers', lambda: {})
    result = bridge._post_wukong_snapshot(
        'https://ide.invalid', payload, True, max_attempts=1)
    assert payload == original
    assert posts == [('https://ide.invalid/hardware/wukong/snapshot', original)]
    return result


@pytest.mark.parametrize('reason', [0, 1, 3])
def test_ordinary_snapshot_ack_is_not_reported_as_rejection(monkeypatch, capsys, reason):
    reply = {'ok': True, 'accepted': True, 'promoted': False,
             'decision': 'not_fault_snapshot', 'seq': 10}
    assert post_snapshot(monkeypatch, reason, reply) == reply
    assert 'rejected' not in capsys.readouterr().out
    recovery = bridge.FaultRecovery()
    assert not recovery.should_reboot_after_snapshot({'reason': reason}, reply)


@pytest.mark.parametrize('decision', ['promoted', 'duplicate'])
def test_fault_snapshot_still_requires_promotion(monkeypatch, decision):
    reply = {'accepted': True, 'promoted': True, 'decision': decision}
    assert post_snapshot(monkeypatch, 2, reply) == reply


@pytest.mark.parametrize('decision', [
    'not_fault_snapshot', 'correlated_history', 'pending', 'duplicate', 'promoted',
])
def test_unpromoted_fault_snapshot_is_rejected(monkeypatch, decision):
    assert post_snapshot(monkeypatch, 2, {
        'accepted': True, 'promoted': False, 'decision': decision,
    }) is None


@pytest.mark.parametrize('reason', [0, 1, 2, 3])
@pytest.mark.parametrize('reply', [
    {},
    {'accepted': False, 'promoted': False, 'decision': 'not_fault_snapshot'},
    {'accepted': True, 'decision': 'not_fault_snapshot'},
    {'accepted': True, 'promoted': False, 'decision': 'invalid_snapshot'},
])
def test_incomplete_or_rejected_ack_is_not_success(monkeypatch, reason, reply):
    assert post_snapshot(monkeypatch, reason, reply) is None


@pytest.mark.parametrize('reason', [0, 1, 3])
def test_ordinary_snapshot_does_not_accept_fault_promotion(monkeypatch, reason):
    assert post_snapshot(monkeypatch, reason, {
        'accepted': True, 'promoted': True, 'decision': 'promoted',
    }) is None


@pytest.mark.parametrize('reason', [None, '3', True, 4])
def test_unknown_reason_is_not_treated_as_ordinary(monkeypatch, reason):
    assert post_snapshot(monkeypatch, reason, {
        'accepted': True, 'promoted': False, 'decision': 'not_fault_snapshot',
    }) is None


@pytest.mark.parametrize('status', [401, 409, 500])
def test_http_errors_remain_fail_closed(monkeypatch, status):
    assert post_snapshot(monkeypatch, 3, {
        'accepted': True, 'promoted': False, 'decision': 'not_fault_snapshot',
    }, status) is None
