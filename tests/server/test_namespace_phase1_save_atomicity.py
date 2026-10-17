"""Storage fault/contender checks; no app startup, live drafts, or hardware.

Run directly with pytest, or through the Phase 1 endpoint acceptance runner.
Only frozen selected binaries and installed-state files are read from the
checkout; every DesignStore path and every write belongs to pytest's tmp_path.
"""
import copy
import hashlib
import json
import multiprocessing
import os
from pathlib import Path
from unittest.mock import patch

import pytest

from server import namespace_design_v1 as design

ROOT = Path(__file__).resolve().parents[2]
TARGET_PATH = ROOT / "tests/fixtures/phase1_namespace_target.json"
TARGET = json.loads(TARGET_PATH.read_bytes())
TIMEOUT = 20


def snapshot(root, excluded=()):
    return {p.relative_to(root): p.read_bytes() for p in root.rglob("*")
            if p.is_file() and p not in excluded}


def reopen(store):
    return design.DesignStore(store.path, store.lumps, store.legacy_path, phase1=True)


def candidate(boot_slot):
    document = copy.deepcopy(TARGET)
    for row in document["rows"]:
        if "boot" in row:
            row["boot"] = row["slot"] == boot_slot
    return document


def assert_exact_intent(document):
    assert {r["slot"]: r["selection"] for r in document["rows"] if "selection" in r} == {
        r["slot"]: r["selection"] for r in TARGET["rows"] if "selection" in r}
    unfinished = [r for r in document["rows"]
                  if r["kind"] == "lump" and "selection" not in r]
    assert unfinished == [r for r in TARGET["rows"]
                          if r["kind"] == "lump" and "selection" not in r]
    assert [r["slot"] for r in unfinished] == [9, 14, 15, 16, 17]
    assert all(r["policy"] == "Resident" for r in unfinished)


def assert_saved(store, payload, result):
    assert result["persisted"] is True
    assert result["document"] == payload["document"]
    assert result["fingerprint"] == design.digest(payload["document"])
    assert result["fingerprint"] != payload["fingerprint"]
    assert result["projection"]["activationAllowed"] is False
    assert result["projection"]["buildReady"] is False
    assert [r["slot"] for r in result["projection"]["rows"] if r.get("unresolved")] == [
        9, 14, 15, 16, 17]
    assert json.loads(store.path.read_bytes()) == payload["document"]
    assert reopen(store).read_document() == payload["document"]
    assert_exact_intent(result["document"])


@pytest.fixture
def private_store(tmp_path):
    lumps = tmp_path / "lumps"
    drafts = lumps / "design-drafts"
    drafts.mkdir(parents=True)
    # Deliberately retain the fixture's formatting: failure assertions compare
    # bytes, not just parsed JSON or a normalized fingerprint.
    path = drafts / "phase1.json"
    path.write_bytes(TARGET_PATH.read_bytes())
    (drafts / "ascending-v1.json").write_text(json.dumps(design.seed({}), indent=4) + "\n")
    for row in TARGET["rows"]:
        if "selection" not in row:
            continue
        selected = row["selection"]
        raw = (ROOT / "server/lumps" / selected["filename"]).read_bytes()
        assert hashlib.sha256(raw).hexdigest() == selected["binaryHash"]
        (lumps / selected["filename"]).write_bytes(raw)
    # Installed Namespace is evidence to preserve, never an installation target.
    for name in ("ns-state.json", "boot-image.bin"):
        (lumps / name).write_bytes((ROOT / "server/lumps" / name).read_bytes())
    (tmp_path / "boot-config.json").write_bytes((ROOT / "server/boot-config.json").read_bytes())
    store = design.DesignStore(path, lumps, lumps / "ns-state.json", phase1=True)
    lock = Path(str(path) + ".lock")
    protected = snapshot(tmp_path, excluded=(path, lock))
    try:
        yield store
    finally:
        # Includes the other profile, every selected binary, installed state,
        # hidden temporary files, and unexpected newly created files.
        assert snapshot(tmp_path, excluded=(path, lock)) == protected


@pytest.mark.parametrize("stage", [
    "create", "partial-write", "flush", "fsync", "replace", "interrupt",
])
def test_pre_replace_failure_preserves_prior_bytes_and_cleans_temporary(
        private_store, monkeypatch, stage):
    store = private_store
    before = store.path.read_bytes()
    root = store.lumps.parent
    lock = Path(str(store.path) + ".lock")
    files_before = snapshot(root, excluded=(lock,))
    payload = dict(fingerprint=store.read()["fingerprint"], document=candidate(7))
    original_payload = copy.deepcopy(payload)
    temporary_paths = []
    reached = []
    real_mkstemp, real_fdopen = design.tempfile.mkstemp, design.os.fdopen

    def fail():
        reached.append(stage)
        if stage == "interrupt":
            raise KeyboardInterrupt("injected save interruption")
        raise OSError("injected save failure: " + stage)

    def mkstemp(*args, **kwargs):
        if stage == "create":
            fail()
        fd, name = real_mkstemp(*args, **kwargs)
        temporary_paths.append(Path(name))
        assert Path(name).parent == store.path.parent
        return fd, name

    def partial_write(document, out, **kwargs):
        out.write('{"format": "incomplete')
        out.flush()
        fail()

    class FlushFailure:
        def __init__(self, out):
            self.out = out

        def __enter__(self):
            return self

        def __exit__(self, *args):
            return self.out.__exit__(*args)

        def write(self, text):
            return self.out.write(text)

        def flush(self):
            fail()

    def fsync(fd):
        assert Path(os.readlink(f"/proc/self/fd/{fd}")) == temporary_paths[0]
        assert json.loads(temporary_paths[0].read_bytes()) == payload["document"]
        fail()

    def replace(source, destination):
        assert Path(source) == temporary_paths[0]
        assert Path(destination) == store.path
        assert json.loads(Path(source).read_bytes()) == payload["document"]
        assert store.path.read_bytes() == before
        fail()

    with monkeypatch.context() as m:
        m.setattr(design.tempfile, "mkstemp", mkstemp)
        if stage == "partial-write":
            m.setattr(design.json, "dump", partial_write)
        elif stage == "flush":
            m.setattr(design.os, "fdopen", lambda *a, **kw: FlushFailure(real_fdopen(*a, **kw)))
        elif stage == "fsync":
            m.setattr(design.os, "fsync", fsync)
        elif stage in ("replace", "interrupt"):
            m.setattr(design.os, "replace", replace)
        with pytest.raises(KeyboardInterrupt if stage == "interrupt" else OSError,
                           match="injected save"):
            store.save(payload)

    assert reached == [stage], "Injection must actually reach the intended boundary"
    assert len(temporary_paths) == (0 if stage == "create" else 1)
    assert all(not p.exists() for p in temporary_paths)
    assert not list(store.path.parent.glob(".namespace-design-*"))
    assert snapshot(root, excluded=(lock,)) == files_before
    assert store.path.read_bytes() == before
    assert reopen(store).read_document() == TARGET
    assert payload == original_payload
    assert_exact_intent(reopen(store).read_document())
    # A failed write must neither consume the fingerprint nor strand the lock.
    result = reopen(store).save(payload)
    assert_saved(store, payload, result)


def save_worker(paths, payload, role, paused, contended, release, connection):
    """Spawned OS process: real flock and replace, with event-driven overlap."""
    store = design.DesignStore(*paths, phase1=True)
    real_replace, real_flock = design.os.replace, design.fcntl.flock

    def gated_replace(source, destination):
        paused.set()  # First saver holds the exclusive lock and a complete temp.
        if not release.wait(TIMEOUT):
            raise TimeoutError("Parent did not release the first saver")
        return real_replace(source, destination)

    def observed_flock(fd, operation):
        # Prove real kernel contention rather than just starting two processes
        # close together and hoping the scheduler overlaps their save calls.
        assert operation == design.fcntl.LOCK_EX
        try:
            real_flock(fd, operation | design.fcntl.LOCK_NB)
        except BlockingIOError:
            contended.set()
        else:
            real_flock(fd, design.fcntl.LOCK_UN)
            raise AssertionError("Second saver did not encounter the held lock")
        return real_flock(fd, operation)

    try:
        target, replacement = (("replace", gated_replace) if role == "first"
                               else ("flock", observed_flock))
        module = design.os if role == "first" else design.fcntl
        with patch.object(module, target, replacement):
            try:
                result = store.save(payload)
            except ValueError as exc:
                outcome = dict(status="rejected", error=str(exc))
            else:
                outcome = dict(status="saved", fingerprint=result["fingerprint"])
        connection.send(dict(pid=os.getpid(), **outcome))
    finally:
        connection.close()


@pytest.mark.parametrize("first_index", [0, 1])
def test_two_processes_one_fingerprint_exactly_one_winner(private_store, first_index):
    store = private_store
    before = store.path.read_bytes()
    fingerprint = store.read()["fingerprint"]
    payloads = [dict(fingerprint=fingerprint, document=candidate(slot)) for slot in (6, 7)]
    # Spawn prevents accidentally inheriting a parent's lock/descriptor or app.
    context = multiprocessing.get_context("spawn")
    paused, contended, release = (context.Event() for _ in range(3))
    processes, receivers = [], []
    order = [first_index, 1 - first_index]
    try:
        for role, index in zip(("first", "second"), order):
            receive, send = context.Pipe(duplex=False)
            process = context.Process(target=save_worker, args=(
                (store.path, store.lumps, store.legacy_path), payloads[index],
                role, paused, contended, release, send))
            process.start()
            send.close()
            processes.append(process)
            receivers.append(receive)
            if role == "first":
                assert paused.wait(TIMEOUT), "First saver never reached atomic replace"
        assert contended.wait(TIMEOUT), "No real cross-process lock contention observed"
        # Reader sees the complete old JSON while a new complete temp is pending.
        assert store.path.read_bytes() == before
        assert reopen(store).read_document() == TARGET
        pending = list(store.path.parent.glob(".namespace-design-*"))
        assert len(pending) == 1
        assert json.loads(pending[0].read_bytes()) == payloads[first_index]["document"]
        release.set()
        results = []
        for receive in receivers:
            assert receive.poll(TIMEOUT), "Saver failed to report its outcome"
            results.append(receive.recv())
        for process in processes:
            process.join(TIMEOUT)
            assert process.exitcode == 0
        assert len({r["pid"] for r in results} | {os.getpid()}) == 3
        assert [r["status"] for r in results] == ["saved", "rejected"]
        assert "another tab" in results[1]["error"]
        assert results[0]["fingerprint"] == design.digest(payloads[first_index]["document"])
        assert_saved(store, payloads[first_index], reopen(store).read())
        assert not list(store.path.parent.glob(".namespace-design-*"))
        winner_bytes = store.path.read_bytes()
        # Replaying the loser still cannot overwrite the winner.
        with pytest.raises(ValueError, match="another tab"):
            reopen(store).save(payloads[1 - first_index])
        assert store.path.read_bytes() == winner_bytes
    finally:
        release.set()
        for process in processes:
            process.join(TIMEOUT)
            if process.is_alive():
                process.terminate()
                process.join(TIMEOUT)
            process.close()
        for receive in receivers:
            receive.close()
