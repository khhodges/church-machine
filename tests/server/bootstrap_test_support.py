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

    The checked-in Namespace may contain IDE drafts (including an IDX1
    selection at slot 15) that cannot be prepared as bootstrap residents,
    and its CapabilityTest binding may point to an archived publication.
    Neither is part of this bootstrap-only fixture.
    """
    assert lumps.resolve() != (Path(__file__).resolve().parents[2] / "server/lumps").resolve(), \
        "Bootstrap fixture selection must never change the live library"
    state_path = lumps / "ns-state.json"
    state = json.loads(state_path.read_text())
    manifest = json.loads((lumps / "manifest.json").read_text())
    approvals = json.loads((lumps / "approvals.json").read_text())["approvals"]
    draft_names = {"ide.Alice", "ide.Mallory"}
    drafts = [row for row in state["abstractions"]
              if row.get("name") in draft_names]
    assert all(row.get("boot_resident") is not True for row in drafts)
    # These are unrelated IDE designs, not approved legacy bootstrap bodies.
    # Keep their immutable files/history but omit their Namespace placements
    # from this bootstrap-only copy so the strict image validator sees none.
    state["abstractions"] = [row for row in state["abstractions"]
                             if row.get("name") not in draft_names]
    for row in state["abstractions"]:
        # This historical fixture constructs its foundational objects from
        # architecture geometry, not from selected executable library LUMPs.
        # An Inform+Resident row incorrectly asks the artifact loader to find a
        # filename. Make the generated object's type explicit in the copy.
        if row.get("slot") == 0 and row.get("name") == "Boot.NS":
            row["type"] = "Namespace"
        if (row.get("slot"), row.get("name")) in {
                (1, "Boot.Thread"), (11, "Thread.2"), (12, "Thread.3")}:
            row.update(type="Thread", allocationWords=256, stackWords=32)
        if row.get("name") in {"Tunnel", "Ethernet"}:
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