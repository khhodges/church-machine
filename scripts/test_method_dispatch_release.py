"""Fast negative checks for the release gate (no full-core recompilation)."""
import json
import subprocess
import sys
from pathlib import Path

import pytest
from scripts import check_method_dispatch_release as gate
import shutil
from scripts.check_corrected_generated_rtl import Recorder
ROOT = gate.ROOT


def ready_process(monkeypatch, pidfile):
    """Start timeout accounting only after the child has published readiness."""
    import time
    original = subprocess.Popen
    def start(*args, **kwargs):
        process = original(*args, **kwargs)
        deadline = time.monotonic() + 20
        while not pidfile.exists():
            if time.monotonic() > deadline:
                process.kill()
                process.wait()
                pytest.fail("test child did not publish readiness")
            time.sleep(.01)
        return process
    monkeypatch.setattr(subprocess, "Popen", start)

def test_effective_catalog_hashes(tmp_path, monkeypatch):
    (tmp_path / "input.lump").write_bytes(b"first")
    monkeypatch.setenv("CHURCH_LUMPS_DIR", str(tmp_path))
    before = gate.source_hashes()
    (tmp_path / "input.lump").write_bytes(b"second")
    assert gate.source_hashes() != before


@pytest.mark.parametrize("tool_timeout", [True, False])
def test_descendant_cleanup(tmp_path, tool_timeout, monkeypatch):
    from scripts.check_corrected_generated_rtl import bounded_tool
    import time
    pidfile = tmp_path / "pid"
    script = ("import subprocess,time; "
              "p=subprocess.Popen(['sleep','30']); "
              f"open({str(pidfile)!r},'w').write(str(p.pid)); "
              + ("time.sleep(30)" if tool_timeout else "raise SystemExit(7)"))
    ready_process(monkeypatch, pidfile)
    if tool_timeout:
        with pytest.raises(subprocess.TimeoutExpired):
            bounded_tool([sys.executable, "-c", script], 3)
    else:
        with pytest.raises(RuntimeError):
            gate.run([sys.executable, "-c", script], tmp_path / "log", 5)
    pid = pidfile.read_text()
    for _ in range(50):
        stat = Path(f"/proc/{pid}/stat")
        try:
            state = stat.read_text().split()[2]
        except FileNotFoundError:
            break
        if state == "Z":
            break
        time.sleep(.02)
    else:
        pytest.fail("compiler descendant survived")


def test_tool_nonzero_and_outer_cancellation(tmp_path, monkeypatch):
    from scripts.rtl_process_supervision import bounded_tool
    import time
    for nested in (False, True):
        pidfile = tmp_path / f"child-{nested}"
        script = ("import subprocess,time; p=subprocess.Popen(['sleep','30']); "
                  f"open({str(pidfile)!r},'w').write(str(p.pid)); "
                  + ("time.sleep(30)" if nested else "raise SystemExit(7)"))
        with monkeypatch.context() as patch:
            ready_process(patch, pidfile)
            if nested:
                wrapper = ("from scripts.rtl_process_supervision import bounded_tool; "
                           f"bounded_tool([{sys.executable!r},'-c',{script!r}],30)")
                with pytest.raises(subprocess.TimeoutExpired):
                    gate.run([sys.executable, "-c", wrapper], tmp_path / "outer.log", 1)
            else:
                assert bounded_tool([sys.executable, "-c", script], 5).returncode == 7
        pid = pidfile.read_text()
        for _ in range(100):
            try:
                if Path(f"/proc/{pid}/stat").read_text().split()[2] == "Z":
                    break
            except FileNotFoundError:
                break
            time.sleep(.02)
        else:
            pytest.fail("tool descendant survived cancellation")


def evidence():
    cases = [[n, 2, 2, None] for n in range(13)]
    return cases, {"schema": 1, "converter": "release-verilog",
                   "cases": cases, "candidate_sha256": "abc"}


def test_complete_evidence():
    cases, report = evidence()
    gate.validate(report, cases, "abc", {"source": "x"}, {"source": "x"})


@pytest.mark.parametrize("damage", ["missing", "duplicate", "hash", "converter", "drift", "empty"])
def test_rejects_incomplete_or_stale(damage):
    cases, report = evidence()
    report = json.loads(json.dumps(report))
    after = {"source": "x"}
    if damage == "missing":
        report["cases"].pop()
    elif damage == "duplicate":
        report["cases"][-1] = report["cases"][0]
    elif damage == "hash":
        report["candidate_sha256"] = "other"
    elif damage == "converter":
        report["converter"] = "systemverilog"
    elif damage == "drift":
        after["source"] = "y"
    else:
        cases = report["cases"] = []
    with pytest.raises(ValueError):
        gate.validate(report, cases, "abc", {"source": "x"}, after)


@pytest.mark.parametrize("args", [
    ["--first-case", "1"], ["--first-case", "13"], [],
])
def test_release_cannot_resume_or_skip_candidate(args):
    result = subprocess.run([sys.executable, "scripts/replay_method_dispatch_rtl.py",
                             "--release", *args], cwd=gate.ROOT,
                            capture_output=True, text=True, timeout=30)
    assert result.returncode != 0
    assert "--release requires" in result.stderr


def test_command_failure_and_timeout_are_closed(tmp_path):
    with pytest.raises(RuntimeError):
        gate.run([sys.executable, "-c", "raise SystemExit(3)"],
                 tmp_path / "failure.log", 10)
    with pytest.raises(subprocess.TimeoutExpired):
        gate.run([sys.executable, "-c", "import time; time.sleep(30)"],
                 tmp_path / "timeout.log", .1)


def test_incompatible_generated_consumer_is_rejected(monkeypatch):
    """Real release converter + Icarus: emulate legacy-only method decoding."""
    from amaranth import Elaboratable, Module, Signal
    from scripts.check_corrected_generated_rtl import Recorder
    from hardware import gen_rtlil
    import re

    class Consumer(Elaboratable):
        def __init__(self):
            self.entry = Signal(32)
            self.target = Signal(32)

        def elaborate(self, platform):
            m = Module()
            # Forward canonical branch at table index one should target word two.
            m.d.sync += self.target.eq(1 + self.entry[:15])
            return m

    original = gen_rtlil._rtlil_to_verilog

    def incompatible(il, output, module_name=None):
        result = original(il, output, module_name)
        assert result is not None
        path = Path(output)
        text, count = re.subn(r"assign check_0 = [^;]+;",
                             "assign check_0 = 32'hbf000001;", path.read_text())
        assert count == 1, "failed to inject legacy raw-offset consumer"
        path.write_text(text)
        return result

    monkeypatch.setattr(gen_rtlil, "_rtlil_to_verilog", incompatible)
    monkeypatch.setattr(Recorder, "release_converter", True)
    monkeypatch.setattr(Recorder, "release_rtl_cache", {})
    dut = Consumer()
    sim = Recorder(dut)
    sim.add_clock(1e-6)

    async def bench(ctx):
        ctx.set(dut.entry, 0xBF000001)
        await ctx.tick()
        assert ctx.get(dut.target) == 2

    sim.add_testbench(bench)
    with pytest.raises(RuntimeError, match="expected 2"):
        sim.run()


def test_release_registration():
    import tomllib
    runner = (gate.ROOT / "scripts/run-all-tests.sh").read_text()
    config = json.loads((gate.ROOT / "scripts/test-workflow-config.json").read_text())
    assert 'ALL_GROUPS["release"]="wukong-release-bundle"' in runner
    assert "method-dispatch-rtl|wukong-release-bundle|method-dispatch-rtl-release|method-dispatch-gate-tests) continue" in runner
    assert "method-dispatch-rtl" in config["scriptOnlySuites"]
    assert "method-dispatch-gate-tests" in config["scriptOnlySuites"]
    assert "check_method_dispatch_release.py --verify-bundle" in (gate.ROOT / ".replit").read_text()
    workflows = tomllib.loads((gate.ROOT / ".replit").read_text())["workflows"]["workflow"]
    parent = next(w for w in workflows if w["name"] == "all-tests")
    assert not any(t.get("args") == "wukong-release-bundle" for t in parent["tasks"])


def test_failure_preserves_replay_inputs():
    from scripts.check_corrected_generated_rtl import replay_directory
    import shutil
    with pytest.raises(RuntimeError, match="Evidence:") as caught:
        with replay_directory() as directory:
            (Path(directory) / "dut.il").write_text("conversion input")
            raise subprocess.TimeoutExpired("iverilog", 600)
    retained = Path(str(caught.value).split("Evidence: ")[1])
    try:
        assert (retained / "dut.il").read_text() == "conversion input"
        assert "600" in (retained / "error.txt").read_text()
    finally:
        shutil.rmtree(retained)

def test_requires_complete_matrix():
    complete = dict(release_gate=True, first_case=0, dispatch_count=13,
                    candidate_count=1, results=[str(i) for i in range(14)])
    gate.validate_report(complete)
    for change in (dict(first_case=1), dict(dispatch_count=12),
                   dict(candidate_count=0), dict(release_gate=False),
                   dict(results=["PASS"] * 14)):
        with pytest.raises(RuntimeError, match="Incomplete"):
            gate.validate_report({**complete, **change})

def test_recorder_keeps_failure_evidence():
    with pytest.raises(RuntimeError, match="Evidence:") as failure:
        with Recorder.replay_directory() as directory:
            (directory / "dut.v").write_text("bad consumer")
            raise subprocess.TimeoutExpired(["iverilog"], 180)
    evidence = Path(str(failure.value).split("Evidence: ")[-1])
    try:
        assert (evidence / "dut.v").read_text() == "bad consumer"
        assert "TimeoutExpired" in (evidence / "failure.txt").read_text()
    finally:
        shutil.rmtree(evidence)

def test_incompatible_method_consumer_is_rejected(tmp_path):
    # Change only an isolated copy: disable canonical BRANCH table consumption.
    # The runner must fail its independent behavioral assertions even if RTL
    # faithfully replays the now-incompatible model. Never edit the live consumer.
    for directory in ("hardware", "scripts", "shared", "tests/hardware"):
        shutil.copytree(ROOT / directory, tmp_path / directory,
                        ignore=shutil.ignore_patterns("__pycache__", "*.pyc"))
    (tmp_path / "server").mkdir()
    for path in (ROOT / "server").glob("*.py"):
        shutil.copy2(path, tmp_path / "server" / path.name)
    shutil.copytree(ROOT / "server/lumps", tmp_path / "server/lumps",
                    ignore=shutil.ignore_patterns("__pycache__", "*.pyc"))
    consumer = tmp_path / "hardware/call.py"
    text = consumer.read_text()
    old = "with m.Elif(self.mem_rd_data[27:32] == 23):"
    assert text.count(old) == 1
    consumer.write_text(text.replace(old, "with m.Elif(self.mem_rd_data[27:32] == 22):"))
    command = [sys.executable, "-c",
               "from scripts.replay_method_dispatch_rtl import replay_one; "
               "print(replay_one(('case', (1, 0xBF000001, 2, None))))"]
    result = subprocess.run(command, cwd=tmp_path, capture_output=True, text=True, timeout=600)
    (tmp_path / "negative-consumer.log").write_text(result.stdout + result.stderr)
    assert result.returncode != 0
    assert 'assert result["returned"] and not result["faults"]' in result.stderr
    assert "PASS release-Verilog" not in result.stdout

@pytest.mark.parametrize("arguments", [
    ["--first-case", "1"], ["--release-gate"], ["--jobs", "5"],
])
def test_gate_does_not_accept_resume_or_unbounded_workers(arguments, tmp_path):
    result = subprocess.run([sys.executable, str(ROOT / "scripts/check_method_dispatch_release.py"),
                             *arguments], capture_output=True, text=True, timeout=30)
    assert result.returncode != 0

def test_failed_command_and_timeout_are_not_success(tmp_path):
    with pytest.raises(RuntimeError, match="exited 7"):
        gate.run([sys.executable, "-c", "print('compiler failure'); exit(7)"],
                 tmp_path / "failure.log", 10)
    assert "compiler failure" in (tmp_path / "failure.log").read_text()
    with pytest.raises(subprocess.TimeoutExpired):
        gate.run([sys.executable, "-c", "import time; time.sleep(30)"],
                 tmp_path / "timeout.log", 0.1)

def test_runner_rejects_incomplete_release_request():
    for arguments in ([], ["unused", "--first-case", "1"]):
        result = subprocess.run(
            [sys.executable, "scripts/replay_method_dispatch_rtl.py",
             "--release-gate", *arguments], cwd=ROOT, capture_output=True,
            text=True, timeout=30)
        assert result.returncode != 0
        assert "complete 13-case matrix" in result.stderr
