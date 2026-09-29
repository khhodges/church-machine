"""Disposable repository and explicit protected publication helpers."""
import atexit
import hashlib
import json
import os
from pathlib import Path
import shutil
import tempfile

_PRIVATE = None


def isolate_application():
    global _PRIVATE
    if _PRIVATE is not None:
        return _PRIVATE
    root = Path(__file__).resolve().parents[2]
    private = Path(tempfile.mkdtemp(prefix="bootstrap-admission-tests-"))
    shutil.copytree(root / "server/lumps", private / "lumps", symlinks=True)
    shutil.copy2(root / "server/boot-config.json", private / "boot-config.json")
    for key, path in {
        "CHURCH_TEST_LUMPS_DIR": private / "lumps",
        "CHURCH_TEST_BOOT_CONFIG_PATH": private / "boot-config.json",
        "CHURCH_TEST_BUILD_SNAPSHOTS_DIR": private / "build-snapshots",
        "CHURCH_TEST_DB_PATH": private / "church_machine.db",
    }.items():
        os.environ[key] = str(path)
    os.environ["CHURCH_TEST_ISOLATED_MODE"] = "1"
    atexit.register(shutil.rmtree, private, ignore_errors=True)
    _PRIVATE = private
    return private


def reviewed_post(client, path, payload):
    review = client.post(path, json=payload)
    assert review.status_code == 428, review.get_data(as_text=True)
    assert review.json["committed"] is False
    return client.post(path, json=payload, headers={
        "X-Change-Confirmation": review.json["change_confirmation"]["id"],
    })


def select_bootstrap_residents(lumps):
    """Select the approved live bootstrap catalog in a disposable test copy.

    The checked-in Namespace may contain an IDE draft that has no authenticated
    compiler provenance, and its CapabilityTest binding may point to an archived
    publication. Neither is part of this bootstrap-only fixture.
    """
    state_path = lumps / "ns-state.json"
    state = json.loads(state_path.read_text())
    manifest = json.loads((lumps / "manifest.json").read_text())
    approvals = json.loads((lumps / "approvals.json").read_text())["approvals"]
    for row in state["abstractions"]:
        if row.get("name") in {"Tunnel", "Ethernet", "ide.Alice"}:
            for field in ("token", "filename", "binary_hash"):
                row.pop(field, None)
        if row.get("name") == "CapabilityTest" and row.get("slot") == 10:
            active = [entry for entry in manifest
                      if entry.get("abstraction") == "CapabilityTest"
                      and entry.get("token") == row["token"]
                      and entry.get("archived") is not True]
            assert len(active) == 1
            selected = active[0]
            body = (lumps / selected["filename"]).read_bytes()
            digest = hashlib.sha256(body).hexdigest()
            assert approvals[digest]["filename"] == selected["filename"]
            assert approvals[digest]["bootstrap_t"] == row["token"]
            assert approvals[digest]["bootstrap_runtime_gt"] == int(row["token"], 16)
            row["filename"] = selected["filename"]
            row["binary_hash"] = digest
            row["lump_version"] = selected["lump_version"]
    state_path.write_text(json.dumps(state))