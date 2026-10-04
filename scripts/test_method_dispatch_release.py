"""Fast negative checks for the release gate (no full-core recompilation)."""
import json
import subprocess
import sys
from pathlib import Path

import pytest
from scripts import check_method_dispatch_release as gate


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
    assert "method-dispatch-rtl|wukong-release-bundle) continue" in runner
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