"""Retained candidate checks and a narrowly bounded full-top known-failure probe."""
import json
import struct
import pytest

from scripts.prepare_actor_manager_runtime_trial import BASE, build
from scripts.probe_actor_manager_runtime_trial import replay


class KnownThreadAddressMismatch(AssertionError):
    pass


class KnownThreadContinuationMismatch(AssertionError):
    pass


def require_current_incoming_thread(result):
    if result["incomingThreadExecuted"]:
        return
    assert result["outcome"] == "fault"
    assert (result["faultCode"], result["faultStage"], result["fetchAddress"],
            result["faultInstruction"]) == (29, 7, 0x350c, 0x27010000)
    assert result["sources"] == {"change": 1}
    assert not result["firstChangeRetired"]
    assert [r["address"] for r in result["retired"]] == [4, 8, 0x3504, 0x3508]
    reads = [(r["address"], r["readData"]) for r in result["memorySignals"]
             if r["readEnable"] and r["readValid"]]
    assert (0x2400, 0xf900820c) in reads
    assert (0x27c4, 0x30f1) in reads  # continuation NIA=1
    assert reads[-1] == (0x3900, 0xf8801c02)
    raise KnownThreadContinuationMismatch("Saved NIA=1 fails absolute RTL entry-range check")


def require_incoming_thread(result):
    if result["incomingThreadExecuted"]:
        return
    assert result["outcome"] == "fault"
    assert (result["faultCode"], result["faultStage"], result["fetchAddress"],
            result["faultInstruction"]) == (29, 7, 0x350c, 0x27010000)
    assert result["sources"] == {"change": 1}
    assert not result["firstChangeRetired"]
    assert [r["address"] for r in result["retired"]] == [4, 8, 0x3504, 0x3508]
    assert result["registers"]["2"] == [0x0200000b, 0x2400, 255]
    last_read = [r for r in result["memorySignals"] if r["readEnable"] and r["readValid"]][-1]
    assert (last_read["address"], last_read["readData"]) == (0x900, 0xaf084008)
    raise KnownThreadAddressMismatch("CHANGE consumes word location as byte address")


def test_retained_image_is_exact_compiler_binding():
    candidate, evidence = build()
    folder = BASE / "new-layout-change-runtime"
    assert (folder / "candidate-le.bin").read_bytes() == candidate
    assert json.loads((folder / "evidence.json").read_text()) == evidence
    assert evidence["changedImageWords"] == [3395, 3397]
    words = struct.unpack("<16384I", candidate)
    assert words[44:46] == (2304, 255)
    assert words[2304] == 0xf900820c
    assert words[576] == 0xaf084008


def test_retained_observation_identifies_only_known_failure():
    result = json.loads((BASE / "new-layout-change-runtime/full-top-result.json").read_text())
    with pytest.raises(KnownThreadAddressMismatch):
        require_incoming_thread(result)


def test_retained_address_correction_observation():
    result = json.loads((BASE / "new-layout-change-runtime/address-correction-result.json").read_text())
    with pytest.raises(KnownThreadContinuationMismatch):
        require_current_incoming_thread(result)


def test_full_top_switch_call_and_return():
    result = replay(through_return=True)
    assert result["firstChangeRetired"] and result["incomingThreadExecuted"], result
    assert result["returnRetired"] and result["callerResumed"], result
    assert result["retired"][-1]["address"] == 0x3910


def test_retained_relative_nia_success_observation():
    result = json.loads((BASE / "new-layout-change-runtime/relative-nia-home-result.json").read_text())
    assert result["imageSha256"] == build()[1]["sha256"]
    assert result["firstChangeRetired"] and result["incomingThreadExecuted"]
    assert [(r["address"], r["instruction"]) for r in result["retired"][-2:]] == [
        (0x350c, 0x27010000), (0x3908, 0xaf084000)]
    assert any(r["writeEnable"] and (r["address"], r["writeData"]) == (0x7c4, 0x70f1)
               for r in result["memorySignals"])  # outgoing relative NIA=3


def test_retained_call_return_success_observation():
    result = json.loads((BASE / "new-layout-change-runtime/relative-nia-return-header-result.json").read_text())
    assert result["imageSha256"] == build()[1]["sha256"]
    assert result["returnRetired"] and result["callerResumed"]
    assert result["retired"][-1]["address"] == 0x3910
