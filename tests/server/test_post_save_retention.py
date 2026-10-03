"""Exercise maintenance through the actual reviewed artifact-only save path."""
import pytest
from test_artifact_only_publication import (
    app_module, isolated_lumps, publish, candidate,
)


@pytest.mark.parametrize("cleanup_failure", [False, True])
def test_authorized_save_runs_independent_retention(isolated_lumps, monkeypatch, cleanup_failure):
    calls = []
    original = app_module._prune_lump_history

    def maintenance(token, *, trigger):
        calls.append((token, trigger))
        if cleanup_failure:
            raise OSError("isolated cleanup failure")
        return original(token, trigger=trigger)

    monkeypatch.setattr(app_module, "_prune_lump_history", maintenance)

    def review_pending(response):
        assert calls == []  # Finalize, approval and unconfirmed save do not prune.

    with app_module.app.test_client() as client:
        body = publish(client, candidate(), on_review=review_pending)
    assert body["ok"] and body["committed"]
    assert calls == [(body["token"], "authorized_save")]
    assert body["history_retention"]["ok"] is not cleanup_failure
    assert (isolated_lumps / body["filename"]).is_file()
    if cleanup_failure:
        assert "isolated cleanup failure" in body["history_retention"]["reason"]
        assert any(w["code"] == "history_retention_incomplete" for w in body["warnings"])