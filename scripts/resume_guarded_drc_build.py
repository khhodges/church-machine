"""Upgrade only the known experimental package; keep synthesis and original inputs."""
import hashlib
import json
from pathlib import Path
import sys

OLD_SCRIPT = "03dd696355515ca02f624937d013961f998756032f4bee05fae8965e7d51e2e9"
OLD_MANIFEST = "9aae626d99f2b9e95ee5f39cc7cfe206b73f837752b94c6899e36e64151ffe0a"
SETUP = '''set_param general.maxThreads 2
open_project work/guarded_candidate.xpr
if {[get_property PART [current_project]] ne "xc7a100tfgg676-2" ||
    [get_property TOP [current_fileset]] ne "church_wukong_xc7a100t"} {
    error "Saved project target mismatch"
}
foreach name {church_wukong_xc7a100t.v wukong_xc7a100t.xdc} {
    set paths [get_files -quiet *$name]
    if {[llength $paths] != 1 || [file normalize [lindex $paths 0]] ne [file normalize $name]} {
        error "Saved project input mismatch: $name"
    }
}
set synth_dir [file normalize [get_property DIRECTORY [get_runs synth_1]]]
if {$synth_dir ne [file normalize work/guarded_candidate.runs/synth_1]} {
    error "Unexpected saved synthesis location"
}
if {[get_property NEEDS_REFRESH [get_runs synth_1]] ||
    [get_property PROGRESS [get_runs impl_1]] ne "0%"} {
    error "Synthesis is stale or implementation already started"
}
puts [exec python3 -c {import hashlib,json,pathlib; m=json.load(open("manifest.json")); p=pathlib.Path("work/guarded_candidate.runs/synth_1/church_wukong_xc7a100t.dcp"); assert hashlib.sha256(p.read_bytes()).hexdigest()==m["resumeCheckpointSha256"], "Checkpoint changed"}]
if {[file exists candidate-EXPERIMENTAL.bit]} {error "Output already exists"}
'''


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def upgrade(root):
    if sha(root / "manifest.json") != OLD_MANIFEST or sha(root / "build.tcl") != OLD_SCRIPT:
        raise ValueError("Not the original package, or upgrade already applied")
    manifest = json.loads((root / "manifest.json").read_text())
    for name, expected in manifest["files"].items():
        if sha(root / name) != expected:
            raise ValueError(f"Changed original input: {name}")
    checkpoint = root / "work/guarded_candidate.runs/synth_1/church_wukong_xc7a100t.dcp"
    checkpoint_hash = sha(checkpoint)
    source = (root / "build.tcl").read_text()
    begin = source.index("if {[file exists work]")
    end = source.index("\nproc assert_board_io")
    source = source[:begin] + SETUP + source[end:]
    old = "launch_runs synth_1 -jobs 2\nwait_on_run synth_1\n"
    if source.count(old) != 1:
        raise ValueError("Unexpected synthesis block")
    source = source.replace(old, "# Reuse the hash-pinned completed synthesis; do not relaunch it.\n")
    old = "    foreach rule {NSTD-1 UCIO-1} {\n"
    if source.count(old) != 1:
        raise ValueError("Unexpected DRC block")
    source = source.replace(old, old +
        "        set_property SEVERITY Error [get_drc_checks $rule]\n"
        "        if {![get_property IS_ENABLED [get_drc_checks $rule]]} {error \"DRC $rule disabled\"}\n")
    # Originals are never rewritten. New manifest binds the old one and resume script.
    with (root / "resume.tcl").open("x") as stream:
        stream.write(source)
    with (root / "original-manifest.json").open("xb") as stream:
        stream.write((root / "manifest.json").read_bytes())
    manifest["files"]["original-manifest.json"] = OLD_MANIFEST
    manifest["files"]["resume.tcl"] = sha(root / "resume.tcl")
    manifest["resumeCheckpointSha256"] = checkpoint_hash
    manifest["resumeReason"] = "Promote stage-default Critical Warning to Error; no synthesis/input changes"
    temp = root / "manifest.resume.json"
    with temp.open("x") as stream:
        json.dump(manifest, stream, indent=2)
        stream.write("\n")
    temp.replace(root / "manifest.json")
    print("Resume prepared. Original RTL, constraints, build script and synthesis retained.")
    print("Checkpoint SHA256:", checkpoint_hash)


if __name__ == "__main__":
    upgrade(Path.cwd())
