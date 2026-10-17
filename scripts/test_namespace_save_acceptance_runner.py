"""Runner wiring and preservation checks without launching a live server."""
import importlib.util
from pathlib import Path
import subprocess
import sys

import pytest

SPEC = importlib.util.spec_from_file_location(
    "namespace_runner", Path(__file__).with_name("run_namespace_save_acceptance.py"))
runner = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(runner)


@pytest.fixture
def project(tmp_path, monkeypatch):
    for directory in ("server/lumps", "server/build-snapshots", "hardware/build"):
        (tmp_path / directory).mkdir(parents=True)
    for filename in ("boot-config.json", "ide-hierarchy.json", "church_machine.db"):
        (tmp_path / "server" / filename).write_bytes(b"private copy fixture")
    monkeypatch.setattr(runner, "ROOT", tmp_path)
    return tmp_path


@pytest.mark.parametrize("mode", ["endpoints", "browser"])
def test_runner_copies_and_forwards_hierarchy(project, monkeypatch, mode):
    monkeypatch.setattr(sys, "argv", ["runner", mode])
    copied = []

    def run(command, *, cwd, env, check):
        private = Path(env["CHURCH_TEST_IDE_HIERARCHY_PATH"])
        copied.append(private)
        assert private.read_bytes() == (project / "server/ide-hierarchy.json").read_bytes()
        assert not private.resolve().is_relative_to(project)
        assert env["CHURCH_TEST_ISOLATED_MODE"] == "1"
        assert env["E2E_PORT"] != "5000"
        assert any("namespace_ide_node_acceptance" in arg for arg in command)
        assert cwd == project and check is True
        private.write_bytes(b"only disposable settings changed")

    monkeypatch.setattr(runner.subprocess, "run", run)
    runner.main()
    assert copied and not copied[0].exists()
    assert (project / "server/ide-hierarchy.json").read_bytes() == b"private copy fixture"


@pytest.mark.parametrize("failure", [False, True])
def test_hash_guard_runs_even_when_child_fails(project, monkeypatch, failure):
    monkeypatch.setattr(sys, "argv", ["runner", "endpoints"])

    def run(command, **kwargs):
        # This is the fake project in tmp_path, NEVER the real configuration.
        (project / "server/ide-hierarchy.json").write_bytes(b"unexpected mutation")
        if failure:
            raise subprocess.CalledProcessError(1, command)

    monkeypatch.setattr(runner.subprocess, "run", run)
    with pytest.raises(RuntimeError, match="Live artifact preservation failed.*ide-hierarchy.json"):
        runner.main()


def test_failed_child_still_cleans_private_file(project, monkeypatch):
    monkeypatch.setattr(sys, "argv", ["runner", "endpoints"])
    copied = []

    def run(command, *, env, **kwargs):
        copied.append(Path(env["CHURCH_TEST_IDE_HIERARCHY_PATH"]))
        raise subprocess.CalledProcessError(1, command)

    monkeypatch.setattr(runner.subprocess, "run", run)
    with pytest.raises(subprocess.CalledProcessError):
        runner.main()
    assert copied and not copied[0].exists()


def test_unprovisioned_project_gets_explicit_private_null(project, monkeypatch):
    (project / "server/ide-hierarchy.json").unlink()
    monkeypatch.setattr(sys, "argv", ["runner", "endpoints"])

    def run(command, *, env, **kwargs):
        assert Path(env["CHURCH_TEST_IDE_HIERARCHY_PATH"]).read_text() == "null\n"

    monkeypatch.setattr(runner.subprocess, "run", run)
    runner.main()
    assert not (project / "server/ide-hierarchy.json").exists()
