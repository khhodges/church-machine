"""Selected immutable SelfTest execution, independent of repository freshness.

Identity/structure setup failures are not execution faults. Numbered CALL and
RETURN are exercised on the simulator; this is not evidence for deployed RTL.
The separately registered strict freshness guard remains active.
"""
import json
import hashlib
import struct
import zlib
from pathlib import Path
import shutil
import subprocess

import pytest

ROOT = Path(__file__).resolve().parents[2]
HARNESS = ROOT / "tests/simulator/sim_selftest_lump_runs.js"


def run_selected(directory=None):
    args = ["node", str(HARNESS)]
    if directory is not None:
        args += ["--lumps-dir", str(directory)]
    proc = subprocess.run(args, cwd=ROOT, capture_output=True, text=True, timeout=60)
    return json.loads(proc.stdout), proc.returncode, proc.stderr


@pytest.fixture(scope="module")
def selected_run():
    if not shutil.which("node"):
        pytest.skip("Node.js not available")
    report, code, stderr = run_selected()
    if not report["executionReached"]:
        pytest.fail(f"SelfTest setup failed; no execution observed: {report}; {stderr}")
    return report, code


def test_selftest_lump_loads_and_boots(selected_run):
    report, _ = selected_run
    assert report["bootComplete"] and report["loaded"], report


def test_selftest_lump_runs_to_completion(selected_run):
    report, code = selected_run
    assert report["terminatedBy"] == "RETURN", report
    assert report["faultType"] is None and not report["faultLog"], report
    assert report["pass"] and code == 0, report


def test_selftest_lump_dr1_is_zero_and_dr0_is_hardwired_zero(selected_run):
    report, _ = selected_run
    assert report["dr1"] == 0 and report["dr0"] == 0, report


@pytest.fixture(scope="module")
def built_fixture(tmp_path_factory):
    """Synthetic offline approval, never admission of modified live bytes."""
    directory = tmp_path_factory.mktemp("selftest-built")
    (directory / "manifest.json").write_text("[]")
    (directory / "ns-state.json").write_text(json.dumps({
        "abstractions": [{"name": "SelfTest", "slot": 41, "seq": 3}]
    }))
    subprocess.run(["node", str(ROOT / "scripts/build_selftest_lump.js"),
                    "--lumps-dir", str(directory)], cwd=ROOT, check=True,
                   capture_output=True, timeout=60)
    return directory


def mutate_fixture(directory, kind):
    state_path = directory / "ns-state.json"
    state = json.loads(state_path.read_text())
    row = state["abstractions"][0]
    binary = directory / row["filename"]
    data = bytearray(binary.read_bytes())
    old_hash = row["binary_hash"]
    if kind == "text":
        cw = (struct.unpack_from(">I", data)[0] >> 10) & 8191
        start = (cw + 1) * 4
        frame = struct.unpack_from(">I", data, start)[0]
        cursor = start + 4 + ((frame & 65535) + 3) // 4 * 4
        size = struct.unpack_from(">I", data, cursor)[0]
        source = zlib.decompress(data[cursor + 4:cursor + 4 + size], -15)
        compressor = zlib.compressobj(wbits=-15)
        compressed = compressor.compress(source + b"\n; isolated older text fixture\n") + compressor.flush()
        data[cursor:-4] = bytes(len(data) - cursor - 4)
        struct.pack_into(">I", data, cursor, len(compressed))
        data[cursor + 4:cursor + 4 + len(compressed)] = compressed
    elif kind == "legacy":
        struct.pack_into(">I", data, 4, 2)
    elif kind == "dispatch":
        struct.pack_into(">I", data, 4, 0)  # private method, DR1 still zero
    elif kind == "execution":
        struct.pack_into(">I", data, 8, 0x17000001)  # CALL CR0 method 1
        # Recursive calls overflow the real protected stack; no sentinel success.
    elif kind == "identity":
        data[-1] ^= 1
    binary.write_bytes(data)
    # Only the synthetic regression fixtures receive new hash-bound records.
    # Identity tampering intentionally retains old evidence and must fail setup.
    if kind != "identity":
        new_hash = hashlib.sha256(data).hexdigest()
        row["binary_hash"] = new_hash
        state_path.write_text(json.dumps(state))
        approvals_path = directory / "approvals.json"
        approvals = json.loads(approvals_path.read_text())
        approval = approvals["approvals"].pop(old_hash)
        approval["binary_hash"] = new_hash
        approvals["approvals"][new_hash] = approval
        approvals_path.write_text(json.dumps(approvals))


@pytest.mark.parametrize("kind", ["fresh", "text", "legacy", "dispatch", "execution", "identity"])
def test_freshness_is_not_execution(built_fixture, tmp_path, kind):
    directory = tmp_path / "selected"
    shutil.copytree(built_fixture, directory)
    if kind != "fresh":
        mutate_fixture(directory, kind)
    before = {p.name: p.read_bytes() for p in directory.iterdir() if p.is_file()}
    guard = subprocess.run(["node", str(ROOT / "scripts/check_selftest_lump_stale.js"),
                            "--lumps-dir", str(directory)], cwd=ROOT,
                           capture_output=True, text=True, timeout=60)
    report, code, _ = run_selected(directory)
    assert before == {p.name: p.read_bytes() for p in directory.iterdir() if p.is_file()}
    assert (guard.returncode == 0) == (kind == "fresh"), guard.stdout + guard.stderr
    if kind in ("fresh", "text", "legacy"):
        assert report["pass"] and code == 0 and report["terminatedBy"] == "RETURN", report
        assert not report["faultLog"], report
    elif kind == "identity":
        assert not report["executionReached"] and report["steps"] == 0, report
        assert report["terminatedBy"] == "SETUP_FAILED" and report["faultType"] is None, report
    else:
        assert code == 1 and report["executionReached"] and not report["pass"], report
        assert report["terminatedBy"] == "UNEXPECTED_FAULT", report
        assert report["phase"] == kind and report["dr1"] == 0, report
    if kind == "text":
        assert "Embedded-text freshness: DIFFERENT" in guard.stdout
        assert "Instruction-body freshness: MATCH" in guard.stdout
        assert "Method-entry format: MATCH" in guard.stdout
    if kind == "legacy":
        assert "Embedded-text freshness: MATCH" in guard.stdout
        assert "Instruction-body freshness: MATCH" in guard.stdout
        assert "Method-entry format: DIFFERENT" in guard.stdout
    if kind == "execution":
        assert "Embedded-text freshness: MATCH" in guard.stdout
        assert "Instruction-body freshness: DIFFERENT" in guard.stdout
        assert "Method-entry format: MATCH" in guard.stdout
