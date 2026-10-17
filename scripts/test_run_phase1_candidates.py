"""Real private compiler/admission/linking/runtime, not synthetic replacements."""
import json
from pathlib import Path
import struct
import subprocess

import pytest

from scripts.prepare_phase1_candidates import ROOT
from scripts.phase1_runtime_source import correct


@pytest.fixture(scope="module", params=[False, True], ids=["naming-only", "corrected-private"])
def report(request):
    command = ["python3", "scripts/run_phase1_candidates.py"]
    if request.param:
        command.append("--correct-runtime-source")
    result = subprocess.run(command, cwd=ROOT, text=True, capture_output=True, timeout=180)
    assert result.returncode == (0 if request.param else 2), result.stdout + result.stderr
    output = next(line for line in result.stdout.splitlines()
                  if line.startswith("generated-artifacts/phase1-linked-"))
    data = json.loads((ROOT / output / "report.json").read_text())
    return data, ROOT / output


def test_exact_inputs_and_real_authenticated_bindings(report):
    data, output = report
    assert data["protectedFilesUnchanged"]
    assert not data["installed"] and not data["hardwareTouched"] and not data["full17EntryAcceptance"]
    assert len(data["entries"]) == 17
    by_slot = {e["slot"]: e for e in data["entries"]}
    assert [e["slot"] for e in data["entries"] if e["status"] == "blocked"] == [9, 14, 15, 16, 17]
    for slot in (6, 7, 10):
        entry = by_slot[slot]
        assert entry["status"] == "admitted-private" and entry["approvalHash"]
        assert entry["binding"]["status"] == "bound"
        assert entry["candidateSha256"] != entry["localizedSha256"]
        raw = (output / entry["candidateFilename"]).read_bytes()
        words = struct.unpack(f">{len(raw)//4}I", raw)
        assert words[-(words[0] & 255)] == 0xFEED5E1F
    rows = by_slot[10]["binding"]["rows"]
    assert next(r for r in rows if r["name"] == "ide.UART_DEV")["newGT"] == 0x32010008
    assert next(r for r in rows if r["name"] == "ide.Thread2")["newGT"] == 0x0200000B
    assert next(r for r in rows if r["name"] == "ide.BTN_DEV")["newGT"] == 0x12000004


def test_approved_layout_and_fresh_thread_frames(report):
    data, output = report
    image = (output / "namespace.bin").read_bytes()
    memory = struct.unpack("<16384I", image)
    assert (memory[0] >> 10) & 8191 == 256
    assert memory[4] == 0  # Namespace self
    assert memory[8] == 1024  # Boot.Thread follows metadata and all 256 descriptors
    assert memory[8 * 4] == 1073741844 and ((memory[8 * 4 + 1] >> 21) & 511) == 1
    for slot in (9, 14, 15, 16, 17):
        assert memory[slot * 4:slot * 4 + 4] == (0, 0, 0, 0)
    for slot in (2, 11, 12):
        base = memory[slot * 4]
        sto = memory[base + 17] & 4095
        assert memory[base + sto + 1] == 0x4A00000A
        assert memory[base + sto + 2] & 4095 == sto + 2
    assert data["image"]["validation"]["bootTarget"] == {"slot": 10, "sequence": 0}


def test_real_workload_and_honest_fault_boundary(report):
    data, _ = report
    execution = data["execution"]
    assert execution["started"]
    assert len({run["evidenceSha256"] for run in data["repeatRuns"]}) == 1
    if data["sourceMode"] == "naming-only":
        assert data["status"] == "faulted" and execution["steps"] == 20
        assert execution["faults"][0]["type"] == "PERM_L"
        assert not execution["selfTest"]["returns"]
        return
    assert execution["steps"] == 6000 and execution["stopped"] == "step-budget"
    assert execution["faults"] == []
    assert len(execution["selfTest"]["returns"]) >= 10
    assert {r["status"] for r in execution["selfTest"]["returns"]} == {0}
    assert execution["selfTest"]["distinctGuards"] == 84
    assert execution["selfTest"]["guardsPassed"] >= 840
    assert execution["selfTest"]["failedGuards"] == []
    assert execution["slots"]["2"]["threadSteps"] > 0
    assert execution["slots"]["11"]["threadSteps"] > 0
    assert not execution["slots"]["12"].get("threadSteps")
    uart = bytes(e["value"] for e in execution["io"] if e["slot"] == 8 and e["kind"] == "write")
    assert uart.startswith(b"CM:WUKONG\r\n")
    assert execution["slots"]["8"]["dataReads"] > 0
    assert execution["slots"]["3"]["dataWrites"] > 0
    assert execution["slots"]["13"]["dataWrites"] > 0
    assert not execution["slots"]["4"].get("dataReads")
    assert not execution["slots"]["5"].get("dataReads")
    corrected = next(e for e in data["entries"] if e["slot"] == 10)
    assert len(corrected["sourceCorrections"]) == 4
    assert corrected["qualifiedSourceSha256"] != corrected["candidateSourceSha256"]


def test_runtime_source_correction_is_fail_closed_not_a_catalog_replacement():
    with pytest.raises(ValueError, match="anchor changed"):
        correct("abstraction ide.CapabilityTest { method Run { RETURN } }", "CapabilityTest")


def test_protection_rejections_are_separate_from_normal_replay(report):
    data, output = report
    if data["sourceMode"] == "naming-only":
        return
    result = subprocess.run(["node", "scripts/test_phase1_runtime.js", str(output / "namespace.bin")],
                            cwd=ROOT, text=True, capture_output=True, timeout=30)
    assert result.returncode == 0, result.stdout + result.stderr
