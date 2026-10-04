"""Release-only, fresh source-bound behavioral evidence. No artifact admission.

Run via run-all-tests.sh --group release or method-dispatch-rtl-release.
Outputs (including failure evidence) are exclusively in a printed /tmp directory.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import signal
import subprocess
import sys
import tempfile

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from scripts.rtl_process_supervision import kill_session
TIMEOUT = 3600


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def source_hashes():
    # Include untracked source too; a git revision alone misses local edits.
    paths = set()
    for directory, patterns in {
        "hardware": ("*.py",), "scripts": ("*.py", "*.js"),
        "shared": ("*.py", "*.json", "*.js"),
        "server": ("*.py",),
        "simulator": ("*.js", "*.cloomc"),
        "tests/hardware": ("*.py",),
        "server/lumps": ("*.json", "*.lump"),
    }.items():
        for pattern in patterns:
            paths.update((ROOT / directory).rglob(pattern))
    hashes = {str(p.relative_to(ROOT)): digest(p) for p in sorted(paths)
              if "__pycache__" not in p.parts}
    isolated = os.environ.get("CHURCH_LUMPS_DIR") or os.environ.get("CHURCH_TEST_LUMPS_DIR")
    if isolated:
        for p in sorted(Path(isolated).rglob("*")):
            if p.is_file():
                hashes[f"isolated-lumps/{p.relative_to(isolated)}"] = digest(p)
    return hashes


def run(command, log, timeout):
    # A process group covers ProcessPool workers and Icarus's child compiler.
    with log.open("w") as output:
        process = subprocess.Popen(command, cwd=ROOT, stdout=output,
                                   stderr=subprocess.STDOUT, start_new_session=True)
        try:
            status = process.wait(timeout=timeout)
            if status:
                raise RuntimeError(f"Command exited {status}: {command}; see {log}")
        finally:
            kill_session(process.pid)
            process.wait()


def validate_report(report):
    if (report.get("release_gate") is not True or report.get("first_case") != 0
            or report.get("dispatch_count") != 13 or report.get("candidate_count") != 1
            or len(report.get("results", [])) != 14
            or len(set(report["results"])) != 14):
        raise RuntimeError("Incomplete release evidence: all 13 fixtures plus SelfTest required")

def validate(report, cases, candidate_hash, before, after):
    if len(cases) < 13 or before != after or report != {
            "schema": 1, "converter": "release-verilog",
            "cases": [list(c) for c in cases], "candidate_sha256": candidate_hash}:
        raise ValueError("Incomplete or stale release evidence")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--jobs", type=int, choices=range(1, 5), default=2)
    parser.add_argument("--verify-bundle", action="store_true")
    args = parser.parse_args()
    if sys.flags.optimize:
        parser.error("Release replay requires Python assertions; disable PYTHONOPTIMIZE/-O")
    directory = Path(tempfile.mkdtemp(prefix="method-dispatch-release-"))
    print(f"Method dispatch release evidence: {directory}", flush=True)
    evidence = {"status": "failed", "emitter": "hardware/gen_rtlil.py",
                "jobs": args.jobs, "approval_created": False}
    try:
        before = source_hashes()
        evidence["source_hashes"] = before
        candidate = directory / "candidate"
        run(["node", "scripts/build_selftest_lump.js", "--candidate-dir", str(candidate),
             "--ns-slot", "6"], directory / "candidate.log", 60)
        review = json.loads((candidate / "review.json").read_text())
        binary = candidate / review["filename"]
        if binary.parent != candidate or digest(binary) != review["binary_hash"]:
            raise RuntimeError("Candidate binary hash/path mismatch")
        source = ROOT / "simulator/examples/post_flash_selftest.cloomc"
        if review["source_sha256"] != digest(source):
            raise RuntimeError("Candidate source hash mismatch")
        evidence["candidate"] = review
        run([sys.executable, "scripts/replay_method_dispatch_rtl.py", str(candidate),
             "--release-gate", "--jobs", str(args.jobs),
             "--report", str(directory / "matrix.json")],
            directory / "replay.log", TIMEOUT)
        report = json.loads((directory / "matrix.json").read_text())
        validate_report(report)
        sys.path.insert(0, str(ROOT))
        from scripts.check_corrected_generated_rtl import load
        suite = load("release_dispatch_cases", "tests/hardware/test_method_table_dispatch.py")
        cases = next(m.args[1] for m in suite.test_numbered_call.pytestmark
                     if m.name == "parametrize")
        validate({k: report[k] for k in ("schema", "converter", "cases", "candidate_sha256")},
                 cases, review["binary_hash"], before, source_hashes())
        if digest(binary) != review["binary_hash"] or source_hashes() != before:
            raise RuntimeError("Source or candidate changed during replay; evidence invalid")
        evidence["matrix"] = report
        if args.verify_bundle:
            run([sys.executable, "scripts/wukong_build_provenance.py", "--verify-release"],
                directory / "bundle.log", 120)
        evidence["status"] = "passed"
    except BaseException as error:
        evidence["error"] = repr(error)
        print(f"FAIL: {error}\nReadable logs and evidence: {directory}", file=sys.stderr)
        return 1
    finally:
        (directory / "evidence.json").write_text(json.dumps(evidence, indent=2))
    print("PASS: all 13 release-Verilog dispatch fixtures and exact SelfTest candidate.")
    return 0


if __name__ == "__main__":
    sys.exit(main())