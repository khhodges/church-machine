"""Slow HTTPS must not block UART parsing or dequeue commands ahead of use."""
from concurrent.futures import Future
from types import SimpleNamespace
import threading

import pytest
from hardware import wukong_bridge as bridge


class Executor:
    def __init__(self, **kwargs):
        assert kwargs["max_workers"] == 1
        self.calls = []
        self.closed = None

    def submit(self, fn, *args, **kwargs):
        future = Future()
        self.calls.append((fn, args, kwargs, future))
        return future

    def shutdown(self, **kwargs):
        self.closed = kwargs


@pytest.fixture
def poller(monkeypatch):
    monkeypatch.setattr(bridge, "ThreadPoolExecutor", Executor)
    monkeypatch.setattr(bridge, "_bridge_auth_headers", lambda: {})
    p = bridge.CommandPoll("https://ide.test", True, "session", "board")
    yield p
    p.close()


def test_only_one_inflight_request_and_one_response_consumption(poller):
    assert poller.poll() is None
    for _ in range(100):
        assert poller.poll() is None
    assert len(poller._executor.calls) == 1
    fn, args, kwargs, future = poller._executor.calls[0]
    assert fn == bridge.requests.get
    assert args == ("https://ide.test/hardware/wukong/command",)
    assert kwargs == {
        "headers": {"X-Wukong-Session": "session",
                    "X-Wukong-Device-UID": "board"},
        "timeout": (3.0, 2.0), "verify": True,
    }
    response = SimpleNamespace(status_code=200, json=lambda: {"cmd": "u", "id": 7})
    future.set_result(response)
    assert poller.poll() is response
    # No second GET is started while the caller handles this response/upload.
    assert len(poller._executor.calls) == 1
    assert poller.poll() is None
    assert len(poller._executor.calls) == 2


def test_timeout_surfaces_without_replaying_a_command(poller):
    poller.poll()
    poller._future.set_exception(bridge.requests.exceptions.ReadTimeout("offline"))
    with pytest.raises(bridge.requests.exceptions.ReadTimeout):
        poller.poll()
    assert poller._future is None
    assert len(poller._executor.calls) == 1


def test_shutdown_does_not_wait_or_start_more_requests(poller):
    poller.poll()
    poller.close()
    assert poller._executor.closed == {"wait": False, "cancel_futures": True}
    assert len(poller._executor.calls) == 1


def test_real_slow_get_does_not_block_caller(monkeypatch):
    entered, release = threading.Event(), threading.Event()
    response = SimpleNamespace(status_code=200)

    def get(*args, **kwargs):
        entered.set()
        assert release.wait(2)
        return response

    monkeypatch.setattr(bridge.requests, "get", get)
    p = bridge.CommandPoll("https://ide.test", True, "session", "board")
    try:
        assert p.poll() is None
        assert entered.wait(1)
        for _ in range(100):
            assert p.poll() is None
        release.set()
        assert p._future.result(timeout=1) is response
        assert p.poll() is response
    finally:
        release.set()
        p.close()
