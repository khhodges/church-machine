"""Exact-input admission tests, not vendor implementation results."""
import json
from pathlib import Path
import shutil
import pytest
from scripts.prepare_guarded_25mhz_build import prepare
from scripts.guarded_candidate_verify import verify, digest


@pytest.fixture(scope="module")
def package(tmp_path_factory):
    path = tmp_path_factory.mktemp("build25") / "package"
    prepare(path)
    return path


def test_admits_boot_only_without_inventing_executable_proof(package):
    result = verify(package)
    assert result["releaseVerified"] is False
    observation = json.loads((package / "vendor-boot.json").read_text())
    assert observation["executableSha256"] is None
    assert observation["physicalBoardTested"] is False
    assert "full UART reload" in result["pendingGates"]
    assert "three pre-existing conformance-suite failures" in result["pendingGates"]


@pytest.mark.parametrize("case", [
    "missing_clock_guard", "changed_rtl", "wrong_boot_entry", "failure_in_log",
    "missing_final_checks", "invented_executable", "changed_replay_tb",
    "wrong_clock", "wrong_input_clock", "stale_source", "missing_final_success",
])
def test_rejects_inconsistent_evidence(package, tmp_path, case):
    target = tmp_path / "modified"
    shutil.copytree(package, target)
    def update(name, change):
        p = target / name
        value = json.loads(p.read_text())
        change(value)
        p.write_text(json.dumps(value))
    if case == "missing_clock_guard":
        (target / "guarded_25mhz_clock_checks.tcl").unlink()
    elif case == "changed_rtl":
        with (target / "church_wukong_xc7a100t.v").open("a") as f:
            f.write("\n// altered\n")
    elif case == "invented_executable":
        update("vendor-boot.json", lambda x: x.update(executableSha256="invented"))
    elif case == "changed_replay_tb":
        (target / "boot_tb.v").write_text("not the tested observer")
    elif case in ("wrong_clock", "wrong_input_clock"):
        key = "clockHz" if case == "wrong_clock" else "inputClockHz"
        update("profile.json", lambda x: x.update({key: 123}))
    elif case == "stale_source":
        update("vendor-boot.json", lambda x: x.update(sourceFingerprint="stale"))
    else:
        p = target / "boot.txt"
        text = p.read_text()
        if case == "wrong_boot_entry":
            text = text.replace("entry=00003504", "entry=00003508")
        elif case == "failure_in_log":
            text += "\nFatal: another failure\n"
        elif case == "missing_final_checks":
            text = text[:text.rfind("boot_tb.v: OK")] + text[text.rfind("Boot replay passed;"):]
        else:
            text = text.replace("Boot replay passed;", "Boot replay unfinished;")
        p.write_text(text)
        update("vendor-boot.json", lambda x: x.update(transcriptSha256=digest(p)))
    # Rehash envelope to test inner consistency, not just outer file hashing.
    update("manifest.json", lambda x: x.update(files={
        name: digest(target / name) for name in x["files"] if (target / name).exists()}))
    with pytest.raises((ValueError, KeyError, OSError)):
        verify(target)
