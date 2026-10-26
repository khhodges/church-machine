"""Prepare a hash-pinned continuation of the known 25 MHz synthesis, not a rebuild."""
import hashlib
import json
from pathlib import Path
import subprocess
import sys
from scripts.resume_guarded_drc_build import SETUP

OLD_MANIFEST = "464250c40090f4bd7a68eaba9dbe211950ff6bd170e6b81fcece48697e9cc79a"


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def prepare(root, guard):
    original = (root / "manifest.json").read_bytes()
    if hashlib.sha256(original).hexdigest() != OLD_MANIFEST:
        raise ValueError("Not the original 25 MHz package, or already prepared")
    manifest = json.loads(original)
    for name, expected in manifest["files"].items():
        if Path(name).name != name or (root / name).is_symlink() or sha(root / name) != expected:
            raise ValueError(f"Original input mismatch: {name}")
    subprocess.run([sys.executable, str(root / "verify.py")], check=True, cwd=root)
    if (root / "build.exit").read_text().strip() != "1":
        raise ValueError("Original build must have stopped with exit code 1")
    if "Feedback clock: expected 1.0 ns, got 20.000" not in (root / "build.log").read_text():
        raise ValueError("Original failure does not match the diagnosed clock guard")
    checkpoint = root / "work/guarded_candidate.runs/synth_1/church_wukong_xc7a100t.dcp"
    if not checkpoint.is_file() or checkpoint.is_symlink() or checkpoint.stat().st_size == 0:
        raise ValueError("Missing original synthesis checkpoint")
    checkpoint_hash = sha(checkpoint)
    source = (root / "build.tcl").read_text()
    begin = source.index("if {[file exists work]")
    end = source.index("\nproc assert_board_io")
    source = source[:begin] + SETUP + source[end:]
    launch = "launch_runs synth_1 -jobs 2\nwait_on_run synth_1\n"
    old_guard = "source guarded_25mhz_clock_checks.tcl"
    if source.count(launch) != 1 or source.count(old_guard) != 1:
        raise ValueError("Unexpected original build script")
    source = source.replace(launch, "# Reuse the hash-pinned completed synthesis.\n")
    source = source.replace(old_guard, "source clock-resume-guard.tcl")
    # An explicit read-only preflight checks the saved project before any
    # implementation launch. The subsequent resume performs the same checks.
    split = source.index("report_utilization -file synth-utilization.txt")
    preflight = source[:split] + 'puts "CLOCK_RESUME_PREFLIGHT_PASS"\n'
    additions = {
        "clock-resume.tcl": source.encode(),
        "clock-resume-preflight.tcl": preflight.encode(),
        "clock-resume-guard.tcl": guard.read_bytes(),
        "original-clock-manifest.json": original,
    }
    for name in [*additions, "manifest.clock-resume.json"]:
        if (root / name).exists():
            raise ValueError(f"Continuation file already exists: {name}")
    for name, data in additions.items():
        with (root / name).open("xb") as stream:
            stream.write(data)
        manifest["files"][name] = hashlib.sha256(data).hexdigest()
    manifest["resumeCheckpointSha256"] = checkpoint_hash
    manifest["resumeReason"] = "Match observed feedback timing model and lowered clock gate; no RTL/XDC changes"
    temp = root / "manifest.clock-resume.json"
    with temp.open("x") as stream:
        json.dump(manifest, stream, indent=2)
        stream.write("\n")
    temp.replace(root / "manifest.json")
    subprocess.run([sys.executable, str(root / "verify.py")], check=True, cwd=root)
    print("Prepared clock continuation; no Vivado process or hardware command started.")
    print("Checkpoint SHA256:", checkpoint_hash)


if __name__ == "__main__":
    if len(sys.argv) != 2:
        sys.exit("Usage: python3 apply.py /absolute/path/to/original/build")
    prepare(Path(sys.argv[1]).resolve(), Path(__file__).with_name("clock-guard.tcl"))
