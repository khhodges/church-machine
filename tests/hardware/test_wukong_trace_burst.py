"""Bounded golden-image trace bursts; no network or hardware is accessed."""
import threading
from pathlib import Path
from types import SimpleNamespace

import hardware.wukong_bridge as bridge


def test_complete_burst_and_fault_priority(monkeypatch):
    entered, release = threading.Event(), threading.Event()
    received = []

    def post(_url, **kwargs):
        payload = kwargs["json"]
        if payload["bridge_trace_counter"] == 1:
            entered.set()
            assert release.wait(5)
        received.append(("trace", payload["bridge_trace_counter"]))
        return SimpleNamespace(status_code=200, content=b"{}", json=lambda: {})

    monkeypatch.setattr(bridge.requests, "post", post)
    monkeypatch.setattr(bridge, "_bridge_auth_headers", lambda: {})
    monkeypatch.setattr(
        bridge, "_post_wukong_trace",
        lambda *a, **kw: received.append(("fault", 1907)) or {"ok": True})
    worker = bridge.FaultDeliveryWorker("https://unused.invalid", False)
    try:
        assert worker.submit("trace", {"bridge_trace_counter": 1})
        assert entered.wait(2)
        for counter in range(2, 1907):
            assert worker.submit("trace", {"bridge_trace_counter": counter})
        assert worker.submit("trace_fault", {"bridge_trace_counter": 1907})
        release.set()
        # Bound the test even if a queue completion regresses.
        drained = threading.Event()
        threading.Thread(target=lambda: (worker.wait_for_idle(), drained.set()),
                         daemon=True).start()
        assert drained.wait(5)
        assert received[:2] == [("trace", 1), ("fault", 1907)]
        assert [n for kind, n in received if kind == "trace"] == list(range(1, 1907))
        assert worker.telemetry_overflows == 0
        assert worker.telemetry_delivery_failures == 0
    finally:
        release.set()
        worker.close()
        worker._thread.join(2)


def test_overflow_is_explicit_and_nonblocking(monkeypatch, capsys):
    monkeypatch.setattr(bridge.FaultDeliveryWorker, "_run", lambda self: None)
    worker = bridge.FaultDeliveryWorker("https://unused.invalid", False)
    try:
        for counter in range(bridge.TRACE_BACKLOG_CAPACITY):
            assert worker.submit("trace", {"bridge_trace_counter": counter})
        assert worker.submit("trace", {}) is False
        assert worker.telemetry_overflows == 1
        output = capsys.readouterr().out
        assert "BRIDGE DELIVERY ONLY" in output
        assert "events rejected" in output
        assert worker.submit("trace_fault", {"fault_valid": True})
    finally:
        worker.close()


def test_http_failure_is_explicit(monkeypatch, capsys):
    monkeypatch.setattr(bridge, "_bridge_auth_headers", lambda: {})
    monkeypatch.setattr(bridge.requests, "post", lambda *a, **kw:
                        SimpleNamespace(status_code=503, content=b""))
    worker = bridge.FaultDeliveryWorker("https://unused.invalid", False)
    try:
        worker.submit("trace", {"bridge_trace_counter": 1})
        done = threading.Event()
        threading.Thread(target=lambda: (worker.wait_for_idle(), done.set()),
                         daemon=True).start()
        assert done.wait(2)
        assert worker.telemetry_delivery_failures == 1
        output = capsys.readouterr().out
        assert "BRIDGE DELIVERY ONLY" in output
        assert "unconfirmed" in output
        assert "does not prove packet loss" in output
        assert "TRACE INCOMPLETE" not in output
        assert "IDE history is incomplete" not in output
    finally:
        worker.close()
        worker._thread.join(2)


def test_live_log_retains_complete_acceptance_run():
    page = Path("server/fpga_status.html").read_text()
    assert "logEl.childNodes.length > 8192" in page
