"""Private-store coverage for cross-worker canonical LUMP leases."""

import json
import multiprocessing
import os
import time

import pytest
import server.app as app_module


def _worker(root, name, queue):
    app_module.LUMPS_DIR = str(root)
    lease, busy = app_module._lump_lease_acquire(
        name, {"lease_session": os.getpid(), "ide_display_name": "Worker"},
        "operation-worker")
    queue.put((bool(lease), bool(busy)))


def test_same_dot_name_serializes_across_processes(tmp_path, monkeypatch):
    monkeypatch.setattr(app_module, "LUMPS_DIR", str(tmp_path))
    lease, busy = app_module._lump_lease_acquire(
        "SelfTest", {"lease_session": "holder", "display_name": "Alex"},
        "op-holder")
    assert lease and busy is None
    ctx = multiprocessing.get_context("fork")
    queue = ctx.Queue()
    process = ctx.Process(target=_worker, args=(tmp_path, "SelfTest", queue))
    process.start()
    assert queue.get(timeout=5) == (False, True)
    process.join(timeout=5)
    assert process.exitcode == 0
    app_module._lump_lease_release("SelfTest", owner_key="holder")


def test_different_dot_names_can_proceed_and_registry_is_private(tmp_path, monkeypatch):
    monkeypatch.setattr(app_module, "LUMPS_DIR", str(tmp_path))
    one, _ = app_module._lump_lease_acquire(
        "One", {"lease_session": "one"}, "op-one")
    two, busy = app_module._lump_lease_acquire(
        "Two", {"lease_session": "two"}, "op-two")
    assert one and two and busy is None
    registry = tmp_path / app_module._LUMP_LEASE_REGISTRY
    document = json.loads(registry.read_text())
    assert set(document["leases"]) == {"One", "Two"}
    assert "account" not in registry.read_text().lower()
    app_module._lump_lease_release("One", owner_key="one")
    app_module._lump_lease_release("Two", owner_key="two")


@pytest.fixture
def lease_app(tmp_path, monkeypatch):
    monkeypatch.setattr(app_module, "LUMPS_DIR", str(tmp_path))
    app_module.app.config.update(TESTING=True, SECRET_KEY="lease-test-secret")
    return app_module.app


def _acquire_for_client(app, client, dot_name="SelfTest", **metadata):
    with client.session_transaction() as saved:
        saved.setdefault("_lump_approval_session", f"session-{id(client)}")
        owner = saved["_lump_approval_session"]
    with app.test_request_context("/"):
        app_module.session["_lump_approval_session"] = owner
        lease, busy = app_module._lump_lease_acquire(
            dot_name, metadata, f"operation-{dot_name}")
    return lease, busy


def test_wait_response_is_safe_actionable_and_session_scoped(lease_app):
    holder = lease_app.test_client()
    waiter = lease_app.test_client()
    lease, _ = _acquire_for_client(
        lease_app, holder, display_name="Alex <alex@example.test>",
        operation_label="SelfTest")
    response = waiter.post("/api/lumps/lease/wait", json={
        "dot_name": "SelfTest", "operation_id": "wait-op",
        "lease_session": lease["owner_key"],
    })
    assert response.status_code == 200
    body = response.get_json()
    assert body["waiting"] is True
    assert body["lease"]["holder"] == "Another IDE session"
    assert body["lease"]["stage"] == "Preparing"
    assert set(body["actions"]) == {
        "message", "cancel", "wait", "renew", "work_on_copy"}
    serialized = json.dumps(body).lower()
    assert "owner_key" not in serialized
    assert "contact_thread" not in serialized

    spoof = waiter.post("/api/lumps/lease/renew", json={
        "dot_name": "SelfTest", "lease_session": lease["owner_key"],
        "operation_id": lease["operation_id"],
    })
    assert spoof.status_code == 409


def test_waiter_can_message_holder_but_unrelated_session_cannot(lease_app):
    holder = lease_app.test_client()
    waiter = lease_app.test_client()
    stranger = lease_app.test_client()
    lease, _ = _acquire_for_client(
        lease_app, holder, display_name="Alex", operation_label="SelfTest")
    waiter.post("/api/lumps/lease/wait", json={"dot_name": "SelfTest"})
    sent = waiter.post("/api/lumps/lease/message", json={
        "dot_name": "SelfTest", "text": "Can you share progress?"})
    assert sent.status_code == 200
    thread_id = sent.get_json()["contact_thread_id"]
    assert stranger.get(f"/api/lumps/lease/message/{thread_id}").status_code == 403
    holder_view = holder.get(f"/api/lumps/lease/message/{thread_id}")
    assert holder_view.status_code == 200
    assert holder_view.get_json()["messages"][0]["text"] == "Can you share progress?"
    assert "owner_key" not in json.dumps(holder_view.get_json())
    assert lease["contact_thread_id"] == thread_id


def test_cancel_and_expiry_allow_waiter_to_continue(lease_app, monkeypatch):
    holder = lease_app.test_client()
    waiter = lease_app.test_client()
    lease, _ = _acquire_for_client(lease_app, holder)
    waiter.post("/api/lumps/lease/wait", json={"dot_name": "SelfTest"})
    assert waiter.post("/api/lumps/lease/cancel",
                       json={"dot_name": "SelfTest"}).get_json()["lease_released"] is False
    released = holder.post("/api/lumps/lease/cancel",
                           json={"dot_name": "SelfTest"}).get_json()
    assert released["lease_released"] is True
    assert waiter.post("/api/lumps/lease/wait",
                       json={"dot_name": "SelfTest"}).get_json()["waiting"] is False

    lease, _ = _acquire_for_client(lease_app, holder)
    monkeypatch.setattr(app_module, "_lump_lease_now",
                        lambda: lease["expires_at"] + 1)
    assert waiter.post("/api/lumps/lease/wait",
                       json={"dot_name": "SelfTest"}).get_json()["waiting"] is False


def test_holder_renews_stage_and_corrupt_registry_fails_closed(
        lease_app, tmp_path):
    holder = lease_app.test_client()
    lease, _ = _acquire_for_client(lease_app, holder)
    renewed = holder.post("/api/lumps/lease/renew", json={
        "dot_name": "SelfTest", "stage": "Activating"})
    assert renewed.status_code == 200
    assert renewed.get_json()["lease"]["stage"] == "Activating"
    app_module._lump_lease_release("SelfTest", owner_key=lease["owner_key"])
    (tmp_path / app_module._LUMP_LEASE_REGISTRY).write_text("{broken")
    with pytest.raises(app_module._LumpLeaseRegistryCorrupt):
        app_module._lump_lease_acquire("SelfTest", {}, "operation")