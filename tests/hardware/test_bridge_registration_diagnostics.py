"""Registration HTTP failures are visible without credentials or UART writes."""
from types import SimpleNamespace
from hardware import wukong_bridge as bridge


def test_status_rejection_is_reported_by_delivery_worker(monkeypatch, capsys):
    requests_seen = []

    def post(url, **kwargs):
        assert kwargs["timeout"] == bridge.IDE_HTTP_TIMEOUT == (3.0, 2.0)
        requests_seen.append(url)
        # A response body may contain sensitive data; never render it.
        return SimpleNamespace(status_code=403, text="private-response-body")

    monkeypatch.setattr(bridge.requests, "post", post)
    worker = bridge.FaultDeliveryWorker("https://offline.invalid", True)
    try:
        worker.submit("status", {"event": "session_started"})
        worker.wait_for_idle()
    finally:
        worker.close()
        worker._thread.join(timeout=2)
    output = capsys.readouterr().out
    assert "HTTP 403" in output
    assert "REPORT_TOKEN" in output
    assert "private-response-body" not in output
    assert requests_seen == ["https://offline.invalid/hardware/wukong/bridge-status"]


def test_registration_diagnostic_rate_limit_and_recovery(monkeypatch, capsys):
    # No thread, serial object or network is required to exercise diagnostics.
    worker = object.__new__(bridge.FaultDeliveryWorker)
    worker._registration_http_failure = None
    worker._registration_http_log_at = 0
    clock = [100.0]
    monkeypatch.setattr(bridge.time, "monotonic", lambda: clock[0])
    worker._report_registration_http(401)
    worker._report_registration_http(401)
    assert capsys.readouterr().out.count("HTTP 401") == 1
    clock[0] += 31
    worker._report_registration_http(401)
    worker._report_registration_http(503)
    output = capsys.readouterr().out
    assert "HTTP 401" in output and "HTTP 503" in output
    assert "--ide address" in output
    worker._report_registration_http(200)
    worker._report_registration_http(200)
    assert capsys.readouterr().out.count("accepted again") == 1
