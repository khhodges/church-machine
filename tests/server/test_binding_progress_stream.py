import json
import threading

from flask import Flask
from server.binding_progress_stream import stream_binding_save


def test_entry_arrives_before_save_finishes():
    release = threading.Event()
    app = Flask(__name__)

    def operation(emit):
        item = dict(slot=21, status="binding")
        emit(dict(type="binding", item=item))
        item["status"] = "bound"
        emit(dict(type="entry", item=item))
        assert release.wait(5)
        return dict(ok=True, persisted=True)

    with app.test_request_context():
        response = stream_binding_save(operation)
        chunks = iter(response.response)
        assert json.loads(next(chunks))["type"] == "started"
        assert json.loads(next(chunks))["item"]["status"] == "binding"
        assert json.loads(next(chunks))["item"]["status"] == "bound"
        release.set()
        assert json.loads(next(chunks))["result"]["persisted"]
        assert list(chunks) == []
        assert response.headers["X-Accel-Buffering"] == "no"


def test_conflict_streams_error_not_success():
    app = Flask(__name__)

    def operation(emit):
        raise ValueError("Namespace design changed in another tab")

    with app.test_request_context():
        events = [json.loads(chunk) for chunk in stream_binding_save(operation).response]
    assert [event["type"] for event in events] == ["started", "error"]
    assert "another tab" in events[-1]["error"]
